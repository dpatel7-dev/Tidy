'use strict';
// Making a plan: the AI suggests, tidy checks every single suggestion.
//
//   1. The AI looks at an overview (current folders, what kinds of files,
//      a sample of names) and your request, and designs a set of folders.
//   2. It goes through the items in batches and says which folder each one
//      belongs in, and why. Anything it doesn't mention stays where it is.
//   3. tidy checks each move: the item must be one it actually saw, the
//      folder must be inside the one you picked and one of the planned ones,
//      nothing gets replaced, nothing is deleted, names stay the same.
//
// Nothing happens to your files here: a plan is just a list until you apply it.

const path = require('path');
const fs = require('fs');
const AI = require('./ai');
const { overview, line } = require('./scan');

const BATCH = 120;
const MAX_FOLDERS = 40;

const RULES = `Rules you must follow:
- You only suggest moves. Never suggest deleting, renaming, merging or editing files.
- Keep folder names short, clear and human (like "School/English" or "Photos/2026"), using / between levels, at most 3 levels deep.
- Respect how things are already organised: if a folder is already tidy, leave its files alone unless the request says otherwise.
- Projects, apps and bundles move as one piece; never split them.
- Files marked PRIVATE: you may file them, but say nothing about what they contain.
- When unsure, leave the item where it is.`;

/** Phase 1: the folders to make. */
async function design(model, s, request, { signal } = {}) {
  const ov = overview(s);
  const system = `You are tidy, a careful assistant that organises a folder on someone's computer. You design a folder structure, then the person reviews it before anything moves.\n\n${RULES}\n\nAnswer with JSON: {"summary": "one sentence about the plan", "folders": [{"path": "Folder/Sub", "for": "what goes here"}]}`;
  const user = `The folder: ${path.basename(s.root)}\nWhat the person wants: ${request || 'tidy it up sensibly'}\n\nWhat's in it now: ${ov.total} items. Kinds: ${JSON.stringify(ov.kinds)}\nItems per top-level folder: ${JSON.stringify(ov.perTopFolder)}\nExisting folders: ${ov.folders.join(', ') || '(none)'}\nA sample of the items:\n${ov.sample.join('\n')}\n\nDesign the folders (at most ${MAX_FOLDERS}). Reuse existing folders where they fit.`;
  const j = await AI.askJson(model, system, user, { signal });
  const folders = [];
  for (const f of Array.isArray(j.folders) ? j.folders : []) {
    const p = cleanFolder(typeof f === 'string' ? f : f && f.path);
    if (p && !folders.some((x) => x.path.toLowerCase() === p.toLowerCase())) folders.push({ path: p, for: String((f && f.for) || '').slice(0, 160) });
    if (folders.length >= MAX_FOLDERS) break;
  }
  if (!folders.length) throw new Error("The AI didn't suggest any folders. Try saying a bit more about what you want.");
  return { summary: String(j.summary || '').slice(0, 300), folders };
}

/** Phase 2: where each item goes, in batches. onBatch(done, total) for progress. */
async function assign(model, s, design_, request, { signal, onBatch = () => {} } = {}) {
  const list = design_.folders.map((f) => `- ${f.path}: ${f.for}`).join('\n');
  const system = `You are tidy, a careful assistant that organises a folder. The folders below were chosen; now decide where items go.\n\n${RULES}\n\nAnswer with JSON: {"moves": [{"i": <item number>, "to": "<one of the folders, exactly as written>", "why": "a few words"}]}. Leave out items that should stay where they are.`;
  const items = s.items;
  const batches = [];
  for (let at = 0; at < items.length; at += BATCH) batches.push(items.slice(at, at + BATCH));
  // a few batches at a time: much quicker than one after another
  const results = new Array(batches.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < batches.length) {
      const k = next++;
      const user = `What the person wants: ${request || 'tidy it up sensibly'}\n\nFolders:\n${list}\n\nItems (number. path | kind size | date | what it says):\n${batches[k].map(line).join('\n')}`;
      const j = await AI.askJson(model, system, user, { signal });
      results[k] = movesOf(j);
      done += batches[k].length;
      onBatch(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
  return results.flat();
}

/** A folder path the AI wrote, made safe, or null. */
function cleanFolder(p) {
  if (typeof p !== 'string') return null;
  const parts = p.replace(/\\/g, '/').split('/').map((x) => x.trim()).filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  for (const x of parts) {
    if (x === '.' || x === '..' || x.startsWith('.') || x.length > 80) return null;
    if (/[<>:"|?*\u0000-\u001f]/.test(x)) return null; // not allowed in file names somewhere
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(x)) return null; // Windows reserved
  }
  return parts.join('/');
}

/**
 * Check every suggestion and turn it into concrete moves:
 * [{ i, from, to, why, isDir, on: true }]. Anything unsafe is dropped (and counted).
 */
function validate(s, design_, raw) {
  const allowed = new Map(design_.folders.map((f) => [f.path.toLowerCase(), f.path]));
  for (const d of s.dirs) allowed.set(d.toLowerCase(), d); // existing folders are fine too
  allowed.set('', ''); // and the top of the folder
  const units = new Set(s.items.filter((x) => x.unit).map((x) => x.rel.toLowerCase())); // projects, apps, deep folders
  const inUnit = (dest) => { const parts = dest.toLowerCase().split('/'); return parts.some((_, k) => units.has(parts.slice(0, k + 1).join('/'))); };
  const taken = new Set();
  const used = new Set();
  const out = [];
  const dropped = { unknown: 0, folder: 0, same: 0, clash: 0, inside: 0 };
  // AIs don't all answer the same way: some say "item" or "file" instead of
  // "i", some give the name instead of the number, some put the file name on
  // the end of the folder. Understand all of those.
  const listedNone = !design_.folders.length;
  const tops = new Set([...allowed.values()].filter(Boolean).map((f) => f.split('/')[0].toLowerCase()));
  const byRel = new Map(s.items.map((x) => [x.rel.toLowerCase(), x]));
  const byName = new Map();
  for (const x of s.items) { const k = x.name.toLowerCase(); byName.set(k, byName.has(k) ? null : x); } // null: two share it
  const find = (m) => {
    if (m == null) return null;
    if (typeof m !== 'object') return find({ i: m });
    for (const key of ['i', 'item', 'n', 'index', 'id', 'number', 'num']) {
      const v = m[key];
      if (typeof v === 'number' && s.items[v]) return s.items[v];
      if (typeof v === 'string' && /^\s*#?\d+\.?\s*$/.test(v) && s.items[parseInt(v.replace(/\D/g, ''), 10)]) return s.items[parseInt(v.replace(/\D/g, ''), 10)];
    }
    for (const key of ['from', 'path', 'file', 'name', 'item', 'source']) {
      const v = typeof m[key] === 'string' ? m[key].replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '').replace(/^\d+\.\s+/, '').toLowerCase() : '';
      if (v && byRel.has(v)) return byRel.get(v);
      if (v && byName.get(v)) return byName.get(v);
    }
    return null;
  };
  for (const m of raw) {
    const it = find(m);
    if (!it) { dropped.unknown++; continue; }
    if (used.has(it.i)) continue;
    let want = String((m && (m.to || m.folder || m.dest || m.destination || m.into || m.move_to)) || '').replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');
    if (want.toLowerCase().endsWith('/' + it.name.toLowerCase())) want = want.slice(0, -(it.name.length + 1)); // "Pictures/cat.png" means "Pictures"
    let dest = allowed.get(want.toLowerCase());
    if (dest === undefined) { // a folder it didn't list: fine inside one it did ("Documents/PDF" for "Documents/PDFs"), or if it listed none
      const clean = cleanFolder(want);
      const top = clean && clean.split('/')[0].toLowerCase();
      if (clean && (listedNone || tops.has(top)) && !inUnit(clean) && design_.folders.length < MAX_FOLDERS) { design_.folders.push({ path: clean, for: '' }); allowed.set(clean.toLowerCase(), clean); tops.add(top); dest = clean; }
    }
    if (dest === undefined) { dropped.folder++; continue; }
    const from = it.rel;
    const parent = path.posix.dirname(from) === '.' ? '' : path.posix.dirname(from);
    if (parent.toLowerCase() === dest.toLowerCase()) { dropped.same++; continue; }
    if (it.isDir && (dest + '/').toLowerCase().startsWith(from.toLowerCase() + '/')) { dropped.inside++; continue; } // a folder into itself
    if (dest && inUnit(dest)) { dropped.inside++; continue; } // never into a project or app
    let to = dest ? `${dest}/${it.name}` : it.name;
    let n = 2;
    while (taken.has(to.toLowerCase()) || fs.existsSync(path.join(s.root, ...to.split('/')))) { // never replace anything
      const ext = it.isDir ? '' : path.extname(it.name);
      to = `${dest ? dest + '/' : ''}${path.basename(it.name, ext)} (${n++})${ext}`;
      if (n > 50) break;
    }
    if (n > 50) { dropped.clash++; continue; }
    taken.add(to.toLowerCase());
    used.add(it.i);
    out.push({ i: it.i, from, to, why: String((m && m.why) || '').slice(0, 120), isDir: it.isDir, size: it.size, mtime: it.mtime, kind: it.kind, on: true });
  }
  // grouped by where they're going, like the folders shown beside them
  out.sort((a, b) => a.to.toLowerCase().localeCompare(b.to.toLowerCase()));
  return { moves: out, dropped };
}

/** The list of moves in an answer, whatever the AI called it. */
function movesOf(j) {
  for (const k of ['moves', 'items', 'plan', 'files', 'assignments', 'result']) if (Array.isArray(j && j[k])) return j[k];
  if (j && j.moves && typeof j.moves === 'object') return Object.entries(j.moves).map(([k, to]) => ({ ...(/^\d+$/.test(k) ? { i: Number(k) } : { from: k }), ...(typeof to === 'string' ? { to } : to) })); // {"3": "Pictures"} or {"cat.png": "Pictures"}
  return [];
}

/** Small folders: the folders and the moves in one question, so it's quick. */
async function oneGo(model, s, request, { signal } = {}) {
  const ov = overview(s);
  const system = `You are tidy, a careful assistant that organises a folder on someone's computer. Plan the whole tidy in one go: design the folders, then say where each item goes. The person reviews it before anything moves.\n\n${RULES}\n\nAnswer with JSON: {"summary": "one sentence about the plan", "folders": [{"path": "Folder/Sub", "for": "what goes here"}], "moves": [{"i": <item number>, "to": "<one of your folders, exactly as written>", "why": "a few words"}]}. Leave out items that should stay where they are.`;
  const user = `The folder: ${path.basename(s.root)}\nWhat the person wants: ${request || 'tidy it up sensibly'}\nExisting folders: ${ov.folders.join(', ') || '(none)'}\n\nItems (number. path | kind size | date | what it says):\n${s.items.map(line).join('\n')}\n\nUse at most ${MAX_FOLDERS} folders. Reuse existing folders where they fit.`;
  const j = await AI.askJson(model, system, user, { signal });
  const folders = [];
  for (const f of Array.isArray(j.folders) ? j.folders : []) {
    const p = cleanFolder(typeof f === 'string' ? f : f && f.path);
    if (p && !folders.some((x) => x.path.toLowerCase() === p.toLowerCase())) folders.push({ path: p, for: String((f && f.for) || '').slice(0, 160) });
    if (folders.length >= MAX_FOLDERS) break;
  }
  const raw = movesOf(j);
  if (!folders.length && !raw.length) throw new Error("The AI didn't suggest any folders. Try saying a bit more about what you want.");
  return { design: { summary: String(j.summary || '').slice(0, 300), folders }, raw };
}

/** Up to this many items are planned with a single question. */
const ONE_GO = 150;

/** The whole thing: design, assign, check. onStep({ step, done, total }). */
async function makePlan(model, s, request, { signal, onStep = () => {}, oneGoUpTo = ONE_GO } = {}) {
  let d;
  let raw;
  if (s.items.length <= oneGoUpTo) {
    onStep({ step: 'one', done: 0, total: s.items.length });
    ({ design: d, raw } = await oneGo(model, s, request, { signal }));
  } else {
    onStep({ step: 'design' });
    d = await design(model, s, request, { signal });
    onStep({ step: 'assign', done: 0, total: s.items.length });
    raw = await assign(model, s, d, request, { signal, onBatch: (done, total) => onStep({ step: 'assign', done, total }) });
  }
  const { moves, dropped } = validate(s, d, raw);
  return { root: s.root, request, how: 'ai', model: AI.keyOf(model), made: Date.now(), summary: d.summary, folders: d.folders, moves, dropped, items: s.items.length };
}

/** Before → after, as a little tree of the new folders. */
function treeOf(plan) {
  const root = { kids: new Map(), files: [] };
  for (const m of plan.moves.filter((x) => x.on)) {
    const parts = m.to.split('/');
    let node = root;
    for (const p of parts.slice(0, -1)) { if (!node.kids.has(p)) node.kids.set(p, { kids: new Map(), files: [] }); node = node.kids.get(p); }
    node.files.push(m);
  }
  const lines = [];
  const walk = (node, depth) => {
    for (const [name, kid] of [...node.kids.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const count = (function n(k) { return k.files.length + [...k.kids.values()].reduce((a, c) => a + n(c), 0); })(kid);
      lines.push({ depth, name: name + '/', count });
      walk(kid, depth + 1);
    }
  };
  walk(root, 0);
  return lines;
}

module.exports = { makePlan, design, assign, oneGo, validate, cleanFolder, treeOf, RULES, ONE_GO };
