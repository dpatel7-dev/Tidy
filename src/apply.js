'use strict';
// Doing a plan, and undoing it.
//
// Before the first file moves, the whole plan is written to a journal in
// ~/.tidy/runs/. Each move is recorded the moment it happens, so even if your
// computer turns off halfway, `tidy undo` can put everything back. A move only
// happens if the thing is still exactly where (and as big as) it was when
// tidy looked, and nothing is waiting where it's going.

const fs = require('fs');
const path = require('path');
const { home } = require('./ai');

const runsDir = () => path.join(home(), 'runs');
const abs = (root, rel) => path.join(root, ...rel.split('/'));

function writeRun(run) {
  fs.mkdirSync(runsDir(), { recursive: true });
  const file = path.join(runsDir(), `${run.id}.json`);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(run, null, 1));
  fs.renameSync(tmp, file);
}

/** Every run, newest first. */
function runs() {
  let names = [];
  try { names = fs.readdirSync(runsDir()).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.map((n) => { try { return JSON.parse(fs.readFileSync(path.join(runsDir(), n), 'utf8')); } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.started - a.started);
}

/**
 * Move what's switched on. onMove(done, total, move). Returns the run:
 * { id, root, moved: [{ from, to }], skipped: [{ from, to, why }], made: [dirs], pruned: [dirs] }.
 */
function apply(plan, { onMove = () => {}, prune = false } = {}) {
  const todo = plan.moves.filter((m) => m.on);
  const run = { id: new Date().toISOString().replace(/[:.]/g, '-'), root: plan.root, request: plan.request, started: Date.now(), state: 'moving', planned: todo.map(({ from, to }) => ({ from, to })), moved: [], skipped: [], made: [], pruned: [], undone: false };
  writeRun(run);
  const parents = new Set();
  let i = 0;
  for (const m of todo) {
    i++;
    const src = abs(plan.root, m.from);
    const dst = abs(plan.root, m.to);
    let why = null;
    let st = null;
    try { st = fs.lstatSync(src); } catch { why = "it isn't there any more"; }
    if (!why && st.isSymbolicLink()) why = 'it became a link';
    if (!why && !m.isDir && st.size !== m.size) why = 'it changed since tidy looked';
    if (!why && fs.existsSync(dst)) why = 'something is already there';
    if (!why && (!inside(plan.root, dst) || !inside(plan.root, src))) why = 'that would leave the folder';
    if (!why && linkOnTheWay(plan.root, m.to)) why = 'a folder on the way is a link to somewhere else';
    if (why) { run.skipped.push({ from: m.from, to: m.to, why }); onMove(i, todo.length, m); continue; }
    try {
      // make missing folders one level at a time, remembering each for undo
      const parts = m.to.split('/').slice(0, -1);
      for (let k = 1; k <= parts.length; k++) {
        const d = abs(plan.root, parts.slice(0, k).join('/'));
        if (!fs.existsSync(d)) { fs.mkdirSync(d); run.made.push(parts.slice(0, k).join('/')); }
      }
      fs.renameSync(src, dst);
      run.moved.push({ from: m.from, to: m.to });
      parents.add(path.posix.dirname(m.from));
    } catch (e) {
      run.skipped.push({ from: m.from, to: m.to, why: e.code === 'EXDEV' ? "it's on a different disk" : e.code || e.message });
    }
    writeRun(run);
    onMove(i, todo.length, m);
  }
  if (prune) { // only folders this run emptied, and only if truly empty (not even hidden files)
    for (const rel of [...parents].filter((p) => p && p !== '.').sort((a, b) => b.length - a.length)) {
      let dir = rel;
      while (dir && dir !== '.') {
        const full = abs(plan.root, dir);
        let left;
        try { left = fs.readdirSync(full); } catch { break; }
        if (left.length) break;
        try { fs.rmdirSync(full); run.pruned.push(dir); } catch { break; }
        dir = path.posix.dirname(dir);
      }
    }
  }
  run.state = 'done';
  run.finished = Date.now();
  writeRun(run);
  return run;
}

/** Is any folder between root and rel (not counting the last part) a symlink? Then the move could escape. */
function linkOnTheWay(root, rel) {
  const parts = rel.split('/').slice(0, -1);
  for (let k = 1; k <= parts.length; k++) {
    try { if (fs.lstatSync(abs(root, parts.slice(0, k).join('/'))).isSymbolicLink()) return true; } catch { return false; } // missing: tidy will make a real folder
  }
  return false;
}

function inside(root, p) {
  const rel = path.relative(root, p);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Put a run back the way it was (the newest one, unless you say which). */
function undo(id) {
  const all = runs();
  const run = id ? all.find((r) => r.id === id) : all.find((r) => !r.undone && r.moved.length);
  if (!run) throw new Error('There is nothing to undo.');
  if (run.undone) throw new Error('That one was already undone.');
  const back = [];
  const stuck = [];
  for (const dir of [...run.pruned].reverse()) { try { fs.mkdirSync(abs(run.root, dir), { recursive: true }); } catch { /* fine */ } }
  for (const m of [...run.moved].reverse()) {
    const now = abs(run.root, m.to);
    const was = abs(run.root, m.from);
    if (!fs.existsSync(now)) { stuck.push({ ...m, why: "it isn't where tidy put it any more" }); continue; }
    if (fs.existsSync(was)) { stuck.push({ ...m, why: 'something else is in its old place now' }); continue; }
    if (linkOnTheWay(run.root, m.from) || linkOnTheWay(run.root, m.to)) { stuck.push({ ...m, why: 'a folder on the way became a link' }); continue; }
    try { fs.mkdirSync(path.dirname(was), { recursive: true }); fs.renameSync(now, was); back.push(m); } catch (e) { stuck.push({ ...m, why: e.code || e.message }); }
  }
  for (const dir of [...run.made].reverse()) { // folders tidy made, if they're empty again
    try { if (!fs.readdirSync(abs(run.root, dir)).length) fs.rmdirSync(abs(run.root, dir)); } catch { /* keep it */ }
  }
  run.undone = Date.now();
  run.undoResult = { back: back.length, stuck };
  writeRun(run);
  return { run, back, stuck };
}

module.exports = { apply, undo, runs, inside };
