'use strict';
// Instant plans: no AI, no waiting. tidy looks at the loose files at the top
// of the folder and files them by what they are, or by when they're from.
// Folders you already made, and everything inside them, are left alone.
//
// These go through exactly the same checks as an AI plan (Plan.validate), so
// they can't do anything an AI plan couldn't.

const path = require('path');
const Plan = require('./plan');

// What each kind of file is filed under, and the names you might already use for it.
const HOMES = [
  { key: 'screenshot', folder: 'Screenshots', also: ['screenshots', 'screen shots', 'screen recordings'], why: 'a screenshot' },
  { key: 'image', folder: 'Images', also: ['images', 'pictures', 'photos', 'pics', 'imgs'], why: 'a picture' },
  { key: 'video', folder: 'Videos', also: ['videos', 'movies', 'video', 'clips'], why: 'a video' },
  { key: 'audio', folder: 'Music & Audio', also: ['music', 'audio', 'sounds', 'music & audio', 'songs'], why: 'music or sound' },
  { key: 'pdf', folder: 'PDFs', also: ['pdfs', 'pdf'], why: 'a PDF' },
  { key: 'document', folder: 'Documents', also: ['documents', 'docs', 'document', 'writing'], why: 'a document' },
  { key: 'spreadsheet', folder: 'Spreadsheets', also: ['spreadsheets', 'sheets'], why: 'a spreadsheet' },
  { key: 'slides', folder: 'Slides', also: ['slides', 'presentations', 'decks'], why: 'a slide deck' },
  { key: 'archive', folder: 'Archives', also: ['archives', 'zips', 'zip files', 'compressed'], why: 'a zip or archive' },
  { key: 'installer', folder: 'Installers', also: ['installers', 'dmgs', 'setup', 'installs', 'setups'], why: 'an installer' },
  { key: 'font', folder: 'Fonts', also: ['fonts'], why: 'a font' },
  { key: '3d model', folder: '3D Models', also: ['3d models', '3d', 'models', 'stl'], why: 'a 3D model' },
  { key: 'text/code', folder: 'Code & Notes', also: ['code', 'scripts', 'notes', 'code & notes', 'text'], why: 'code or notes' },
];

const FAMILIES = [{ keys: ['document', 'pdf', 'spreadsheet', 'slides'] }, { keys: ['image', 'screenshot'] }];
const SCREENSHOT = /^(screen ?shot|screenshot|screen recording|capture d|bildschirmfoto|captura de pantalla|snip)/i;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The top-level folder you already have for this kind of thing, if any. */
function existing(s, home) {
  const tops = s.dirs.filter((d) => !d.includes('/'));
  return tops.find((d) => home.also.includes(d.toLowerCase())) || null;
}

const loose = (s) => s.items.filter((it) => !it.isDir && !it.rel.includes('/'));

/** By what things are: installers together, screenshots together, and so on. */
function byKind(s) {
  const groups = new Map();
  for (const it of loose(s)) {
    const key = it.kind === 'image' && SCREENSHOT.test(it.name) ? 'screenshot' : it.kind;
    const home = HOMES.find((h) => h.key === key);
    if (!home) continue; // "other" things stay where they are
    if (!groups.has(home)) groups.set(home, []);
    groups.get(home).push(it);
  }
  const folders = [];
  const raw = [];
  const placed = new Map(); // home key → the folder it went to
  const later = [];
  for (const [home, list] of groups) {
    const have = existing(s, home);
    if (!have && list.length < 2) { later.push([home, list]); continue; } // a whole folder for one file is no tidier
    const folder = have || home.folder;
    placed.set(home.key, folder);
    if (!folders.some((f) => f.path === folder)) folders.push({ path: folder, for: home.why });
    for (const it of list) raw.push({ i: it.i, to: folder, why: home.why });
  }
  // lone ones join their family: a lone PDF goes with the documents, a lone
  // screenshot with the pictures, and two lone documents of different kinds
  // still make a Documents folder between them
  for (const fam of FAMILIES) {
    const left = later.filter(([home]) => fam.keys.includes(home.key));
    if (!left.length) continue;
    const main = HOMES.find((h) => h.key === fam.keys[0]);
    const to = fam.keys.map((k) => placed.get(k)).find(Boolean) || existing(s, main) || (left.reduce((n, [, l]) => n + l.length, 0) >= 2 ? main.folder : null);
    if (!to) continue;
    if (!folders.some((f) => f.path === to)) folders.push({ path: to, for: main.why });
    for (const [home, list] of left) for (const it of list) raw.push({ i: it.i, to, why: home.why });
  }
  return finish(s, folders, raw, 'kind', 'Loose files sorted by what they are. Folders you made stay as they are.');
}

/** By when things are from: a folder per year, and one per month inside it. */
function byDate(s) {
  const files = loose(s);
  const years = new Set(files.map((it) => new Date(it.mtime).getFullYear()));
  const folders = [];
  const raw = [];
  for (const it of files) {
    const d = new Date(it.mtime);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    // one year only: just months; otherwise years with months inside
    const folder = years.size === 1 ? `${m} ${MONTHS[d.getMonth()]} ${y}` : `${y}/${m} ${MONTHS[d.getMonth()]}`;
    if (!folders.some((f) => f.path === folder)) folders.push({ path: folder, for: `things from ${MONTHS[d.getMonth()]} ${y}` });
    raw.push({ i: it.i, to: folder, why: `last changed ${MONTHS[d.getMonth()]} ${y}` });
  }
  folders.sort((a, b) => a.path.localeCompare(b.path));
  if (folders.length < 2) { // everything is from the same month: nothing to sort
    const when = folders[0] ? folders[0].for.replace('things from ', '') : '';
    return finish(s, [], [], 'date', files.length ? `Every loose file here is from ${when}, so sorting by date wouldn't help.` : 'There are no loose files here to sort.');
  }
  return finish(s, folders, raw, 'date', 'Loose files sorted by the month they were last changed. Folders you made stay as they are.');
}

function finish(s, folders, raw, how, summary) {
  const { moves, dropped } = Plan.validate(s, { folders }, raw);
  return { root: s.root, request: how === 'kind' ? 'sort by kind (instant)' : 'sort by date (instant)', how, model: null, made: Date.now(), summary, folders, moves, dropped, items: s.items.length };
}

module.exports = { byKind, byDate, HOMES, SCREENSHOT };
