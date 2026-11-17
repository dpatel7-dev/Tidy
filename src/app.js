'use strict';
// tidy's screen.
//
//   [Hazel]  tidy                                  ~/Downloads · 214 things · 1.3 GB
//            an AI that tidies folders, carefully          model: llama3.2 (this Mac)
//   ───────────────────────────────────────────────────────────────────────────────
//   (ask)     How should I tidy Downloads?  › sort by class, and put installers away
//   (review)  46 moves into 7 folders · nothing deleted, nothing replaced
//             School/ (12)   Games/ (8) …         [x] essay.docx → School/English/  "an essay"
//   (done)    Moved 46 things.  u puts them all back.

const os = require('os');
const path = require('path');
const A = require('./ansi');
const Th = require('./theme');
const Hazel = require('./hazel');
const AI = require('./ai');
const P = require('./providers');
const Scan = require('./scan');
const Plan = require('./plan');
const Run = require('./apply');
const { Editor } = require('./editor');
const { Tui, fit, spread, size, ago } = require('./tui');
const pkg = require('../package.json');

const tilde = (p) => (p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p);
const untilde = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

class App {
  constructor({ input = process.stdin, output = process.stdout, folder = process.cwd(), request = '' } = {}) {
    Th.use(AI.config.load().theme || 'walnut');
    this.ed = new Editor();
    if (request) this.ed.set(request);
    this.mode = 'ask'; // ask | folder | privacy | thinking | review | done
    this.mood = { scene: 'idle', at: Date.now() };
    this.flash = null;
    this.sel = 0;
    this.top = 0;
    this.prune = false;
    this.ui = new Tui({ input, output, paper: Th.t().paper, render: (w, h) => this.frame(w, h) });
    this.ui.on('key', (s, k) => this.onKey(s || '', k || {}));
    this.ui.on('paste', (t) => { const ed = this.mode === 'folder' ? this.fed : this.ed; if (ed) ed.insert(t.replace(/\s*\n\s*/g, ' ').trim()); this.dirty(); });
    this.ui.on('mouse', (m) => { if (m.wheel && this.mode === 'review') { this.move(m.wheel); this.dirty(); } });
    this.setFolder(folder, true);
  }

  run() {
    return new Promise((resolve) => {
      this.done = resolve;
      this.ui.start();
      this.ticker = setInterval(() => { if (this.flash && this.flash.until < Date.now()) this.flash = null; this.dirty(); }, 130);
      AI.current().then(({ model, all }) => { this.model = model; this.models = all; this.dirty(); }, () => {});
    });
  }

  quit() {
    if (this.ac) this.ac.abort();
    clearInterval(this.ticker);
    this.ui.stop();
    if (this.done) this.done();
  }

  dirty() { this.ui.schedule(); }
  say(text, kind = 'dim', ms = 4500) { this.flash = { text, kind, until: Date.now() + ms }; this.dirty(); }
  react(scene) { this.mood = { scene, at: Date.now() }; }

  setFolder(dir, quiet) {
    const why = Scan.refuse(untilde(dir));
    if (why) { if (!quiet) this.say(why, 'err', 7000); else { this.folder = null; this.folderWhy = why; } return false; }
    this.folder = Scan.safeReal(untilde(dir));
    this.folderWhy = null;
    try { this.peek = Scan.scan(this.folder); } catch (e) { this.peek = null; }
    return true;
  }

  // ── the flow ────────────────────────────────────────────────────────────────
  start() {
    if (!this.folder) return this.say(this.folderWhy || 'Pick a folder first (Tab).', 'err', 7000);
    if (!this.model) return this.say('tidy needs an AI: install Ollama (ollama.com) and a model, or set up Tree of Thought first.', 'err', 9000);
    if (!AI.local(this.model) && this.mode !== 'privacy') { this.mode = 'privacy'; return this.dirty(); }
    this.think();
  }

  async think() {
    this.mode = 'thinking';
    this.react('think');
    this.step = 'Looking around…';
    this.dirty();
    this.ac = new AbortController();
    try {
      const s = Scan.scan(this.folder);
      if (!s.items.length) throw new Error('There is nothing here to tidy.');
      this.step = `Designing folders for ${s.items.length} things…`;
      this.plan = await Plan.makePlan(this.model, s, this.ed.text.trim(), {
        signal: this.ac.signal,
        onStep: (p) => { this.step = p.step === 'design' ? `Designing folders for ${s.items.length} things…` : `Deciding where things go: ${p.done} of ${p.total}…`; this.dirty(); },
      });
      this.scanned = s;
      this.sel = 0;
      this.top = 0;
      this.mode = 'review';
      this.react(this.plan.moves.length ? 'idle' : 'oops');
      if (!this.plan.moves.length) this.say('Everything already looks like it is where it should be. Try asking for something more specific.', 'warn', 8000);
    } catch (e) {
      this.mode = 'ask';
      this.react('oops');
      if (e.name !== 'AbortError') this.say(e.message, 'err', 9000);
    }
    this.ac = null;
    this.dirty();
  }

  applyPlan() {
    const n = this.plan.moves.filter((m) => m.on).length;
    if (!n) return this.say('Nothing is switched on. Press a to switch everything on.', 'warn');
    if (!this.armed) { this.armed = true; return this.say(`Press Enter again to move ${n} thing${n === 1 ? '' : 's'}. Nothing is deleted, and u puts it all back.`, 'acorn', 6000); }
    this.armed = false;
    this.react('work');
    this.result = Run.apply(this.plan, { prune: this.prune, onMove: () => {} });
    this.flash = null;
    this.setFolder(this.folder, true);
    this.mode = 'done';
    this.react('done');
    this.dirty();
  }

  undoLast() {
    try {
      const r = Run.undo();
      this.say(`Put back ${r.back.length} thing${r.back.length === 1 ? '' : 's'}${r.stuck.length ? `; ${r.stuck.length} couldn't be (they moved again)` : ''}.`, 'ok', 7000);
      this.react('idle');
      if (this.folder) this.setFolder(this.folder, true);
    } catch (e) { this.say(e.message, 'warn'); }
  }

  nextModel() {
    if (!this.models || !this.models.length) return this.say('No models found. Install Ollama (ollama.com) or set up Tree of Thought.', 'warn', 7000);
    const i = this.models.findIndex((m) => this.model && AI.keyOf(m) === AI.keyOf(this.model));
    this.model = this.models[(i + 1) % this.models.length];
    AI.choose(this.model);
    this.say(`Using ${this.model.name}${AI.local(this.model) ? ' (on this computer: nothing leaves it)' : ''}.`, 'ok');
  }

  move(step) {
    const n = this.plan ? this.plan.moves.length : 0;
    this.sel = Math.max(0, Math.min(n - 1, this.sel + step));
  }

  // ── keys ──────────────────────────────────────────────────────────────────
  onKey(s, k) {
    if (k.ctrl && (k.name === 'c' || k.name === 'd')) return this.quit();
    const m = this.mode;
    if (m === 'thinking') { if (k.name === 'escape') { if (this.ac) this.ac.abort(); this.say('Stopped. Nothing was moved.'); } return; }
    if (m === 'privacy') {
      if (s === 'y' || k.name === 'return') { this.mode = 'ask'; this.think(); }
      else if (s === 'm') { this.mode = 'ask'; this.nextModel(); }
      else if (k.name === 'escape' || s === 'n' || s === 'q') this.mode = 'ask';
      return this.dirty();
    }
    if (m === 'folder') {
      if (k.name === 'return') { if (this.setFolder(this.fed.text.trim() || '.')) { this.mode = 'ask'; this.say(`Tidying ${tilde(this.folder)}.`, 'ok'); } }
      else if (k.name === 'escape') this.mode = 'ask';
      else edit(this.fed, s, k);
      return this.dirty();
    }
    if (m === 'review') {
      const mv = this.plan.moves[this.sel];
      if (k.name === 'up') this.move(-1);
      else if (k.name === 'down') this.move(1);
      else if (k.name === 'pageup') this.move(-10);
      else if (k.name === 'pagedown') this.move(10);
      else if (s === ' ' && mv) { mv.on = !mv.on; this.armed = false; }
      else if (s === 'a') { const all = this.plan.moves.every((x) => x.on); this.plan.moves.forEach((x) => { x.on = !all; }); this.armed = false; }
      else if (s === 'p') { this.prune = !this.prune; this.say(this.prune ? 'Folders this leaves completely empty will be removed (undo brings them back).' : 'Empty folders will be left alone.'); }
      else if (k.name === 'return') this.applyPlan();
      else if (s === 'e' || k.name === 'escape') { this.mode = 'ask'; this.armed = false; this.react('idle'); }
      else if (s === 'q') this.quit();
      return this.dirty();
    }
    if (m === 'done') {
      if (s === 'u') { this.undoLast(); this.mode = 'ask'; }
      else if (k.name === 'return' || k.name === 'escape') { this.mode = 'ask'; this.ed.clear(); this.react('idle'); this.setFolder(this.folder, true); }
      else if (s === 'q') this.quit();
      return this.dirty();
    }
    // ask
    const empty = !this.ed.text;
    if (k.name === 'return') return this.start();
    if (k.name === 'tab') { this.fed = new Editor(); this.fed.set(this.folder ? tilde(this.folder) : '~/Downloads'); this.mode = 'folder'; return this.dirty(); }
    if (k.name === 'escape') { if (empty) return this.quit(); this.ed.clear(); return this.dirty(); }
    if (empty && s === 'q') return this.quit();
    if (k.ctrl && k.name === 'o') { this.nextModel(); return this.dirty(); }
    if (k.ctrl && k.name === 'z') { this.undoLast(); return this.dirty(); }
    if (k.ctrl && k.name === 't') { Th.use(Th.name() === 'walnut' ? 'linen' : 'walnut'); AI.config.save({ ...AI.config.load(), theme: Th.name() }); this.ui.setPaper(Th.t().paper); return this.dirty(); }
    edit(this.ed, s, k);
    this.dirty();
  }

  // ── drawing ───────────────────────────────────────────────────────────────
  frame(W, H) {
    const t = Th.t();
    const out = [];
    const ms = Date.now() - this.mood.at;
    const bird = Hazel.draw(this.mood.scene, ms, t.paper.bg);
    const where = this.folder ? tilde(this.folder) : Th.err('no folder yet');
    const peek = this.peek ? `${this.peek.items.length}${this.peek.truncated ? '+' : ''} things · ${size(this.peek.items.reduce((a, b) => a + b.size, 0))}` : '';
    const mdl = this.model ? `${this.model.name}${AI.local(this.model) ? Th.moss(' · on this computer') : Th.dim(` · ${(P.PROVIDERS[this.model.provider] || { name: this.model.provider }).name}`)}` : Th.err('no AI yet');
    const info = [
      spread(A.paint('tidy', { bold: true, fg: t.acorn }) + Th.dim('  ·  an AI that tidies folders, carefully'), Th.dim(`v${pkg.version}`), W - 24),
      '',
      Th.dim('folder  ') + where + (peek ? Th.faint('  ·  ' + peek) : ''),
      Th.dim('AI      ') + mdl,
      '',
      Th.faint('never deletes · never replaces · stays in this folder · u undoes'),
    ];
    for (let i = 0; i < 8; i++) out.push(' ' + bird[i] + '  ' + (info[i - 1] || ''));
    out.push(Th.faint('─'.repeat(W)));
    const bodyH = H - out.length - 3;
    let body = [];
    let cursor = null;
    if (this.mode === 'review') body = this.reviewLines(W, bodyH);
    else if (this.mode === 'done') body = this.doneLines(W, bodyH);
    else if (this.mode === 'thinking') body = ['', '  ' + A.paint(this.step || 'Thinking…', { fg: t.acorn }), '', '  ' + Th.dim(`${this.model ? this.model.name : 'The AI'} is reading what's here. Nothing moves until you say so.`), '  ' + Th.faint('esc stops')];
    else if (this.mode === 'privacy') body = this.privacyLines(W);
    else body = this.askLines(W, bodyH);
    while (body.length < bodyH) body.push('');
    out.push(...body.slice(0, bodyH));
    out.push(Th.faint('─'.repeat(W)));
    // the line you type on
    if (this.mode === 'folder') {
      const label = 'Folder to tidy: ';
      const lay = this.fed.layout(Math.max(10, W - label.length - 3), 1);
      out.push(' ' + Th.acorn(label, { bold: true }) + lay.lines[0]);
      cursor = { row: out.length - 1, col: 1 + label.length + lay.col };
    } else if (this.mode === 'ask') {
      const label = this.folder ? `How should I tidy ${path.basename(this.folder)}? ` : 'Press Tab to pick a folder ';
      const lay = this.ed.layout(Math.max(10, W - A.vwidth(label) - 5), 1);
      out.push(' ' + Th.acorn(label, { bold: true }) + Th.acorn('› ') + (this.ed.text ? lay.lines[0] : Th.faint('say what you want, or just press Enter')));
      cursor = { row: out.length - 1, col: 1 + A.vwidth(label) + 2 + lay.col };
    } else out.push('');
    const hints = {
      ask: 'enter make a plan · tab another folder · ctrl+o change AI · ctrl+z undo last tidy · ctrl+t colours · esc quit',
      folder: 'enter use this folder · esc cancel',
      privacy: 'y continue · m use another AI · esc cancel',
      thinking: 'esc stop',
      review: '↑↓ look · space skip/keep · a all · p also remove emptied folders · enter move · e change request',
      done: 'u put it all back · enter tidy again · q quit',
    };
    const f = this.flash;
    out.push(' ' + A.clip(f ? A.paint(f.text, { fg: t[f.kind] || t.dim }) : Th.faint(hints[this.mode]), W - 2));
    return { lines: out.slice(0, H), cursor };
  }

  askLines(W) {
    const out = [''];
    if (!this.folder) out.push('  ' + Th.err(this.folderWhy || 'Pick a folder to tidy.'), '');
    out.push('  ' + Th.bold('Tell tidy what you want, in your own words. For example:'));
    for (const ex of ['sort these by school subject, and put installers in one place', 'organise my photos by year and month', 'group these by project, and keep the folders I already made', 'just clean it up']) out.push('    ' + Th.dim('· ') + Th.cream(ex));
    out.push('');
    out.push('  ' + Th.bold('How tidy stays safe'));
    const safe = [
      ['plans first', 'nothing moves until you have seen every move and pressed Enter twice'],
      ['only moves', 'never deletes, never renames, never replaces a file'],
      ['stays inside', `only touches ${this.folder ? path.basename(this.folder) : 'the folder you pick'}, never system folders or your whole home`],
      ['keeps whole', 'projects (with .git, package.json…), apps and hidden files are left as they are'],
      ['keeps private', 'passwords, keys and tax-looking files are never read; other files only as a short snippet'],
      ['undo', 'every move is written down first: u (or tidy undo) puts everything back'],
    ];
    for (const [k, d] of safe) out.push('    ' + Th.moss(k.padEnd(14)) + Th.dim(d));
    const last = Run.runs().slice(0, 3);
    if (last.length) {
      out.push('', '  ' + Th.bold('Recent tidies'));
      for (const r of last) out.push('    ' + Th.faint(ago(r.started).padEnd(9)) + fit(tilde(r.root), 28) + Th.dim(`  ${r.moved.length} moved`) + (r.undone ? Th.faint('  · undone') : '') + Th.faint(r.request ? `  · "${A.clip(r.request, 30)}"` : ''));
    }
    return out;
  }

  privacyLines(W) {
    const items = this.peek ? this.peek.items : [];
    const snippets = items.filter((i) => i.hint).length;
    const priv = items.filter((i) => i.private).length;
    const who = (P.PROVIDERS[this.model.provider] || { name: this.model.provider }).name;
    const para = (text, paint) => wrap(text, W - 4).map((l) => '  ' + paint(l));
    return ['',
      '  ' + A.paint(`${this.model.name} runs on ${who}'s computers, not yours.`, { bold: true }),
      '',
      ...para(`To plan, tidy sends it the names of ${items.length} things with their sizes and dates, and ${snippets} short snippet${snippets === 1 ? '' : 's'} of text (a few lines each, with anything that looks like a password or key blanked out).${priv ? ` ${priv} private-looking file${priv === 1 ? '' : 's'}: the name only.` : ''}`, Th.dim),
      '',
      ...para('Want nothing to leave this computer? Use a model from Ollama (press m to switch).', Th.cream),
      '',
      '  ' + Th.acorn('Continue? ') + Th.dim('y yes · m another AI · esc no'),
    ];
  }

  reviewLines(W, h) {
    const p = this.plan;
    const t = Th.t();
    const on = p.moves.filter((m) => m.on).length;
    const out = [];
    out.push(' ' + A.paint(`${on} of ${p.moves.length} moves into ${p.folders.length} folders`, { bold: true }) + Th.dim('  ·  nothing deleted, nothing replaced') + (this.prune ? Th.acorn('  ·  emptied folders removed') : ''));
    if (p.summary) out.push(' ' + Th.dim(A.clip(p.summary, W - 2)));
    const dropped = Object.values(p.dropped).reduce((a, b) => a + b, 0);
    if (dropped) out.push(' ' + Th.faint(`(${dropped} of the AI's suggestions didn't pass tidy's checks and were left out)`));
    out.push('');
    // new folders on the left, the moves on the right (or stacked when narrow)
    const tree = Plan.treeOf(p).map((x) => '  '.repeat(x.depth) + Th.acorn(x.name) + Th.faint(` ${x.count}`));
    const wide = W >= 100;
    const leftW = wide ? Math.min(34, Math.max(...tree.map((x) => A.vwidth(x)), 12) + 2) : 0;
    const rows = h - out.length;
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + rows) this.top = this.sel - rows + 1;
    const right = [];
    const nameW = Math.max(12, Math.floor((W - leftW - 10) * 0.42));
    const toW = Math.max(10, W - leftW - nameW - 14);
    for (let i = this.top; i < p.moves.length && right.length < rows; i++) {
      const m = p.moves[i];
      const cur = i === this.sel;
      const box = m.on ? Th.moss('[x]') : Th.faint('[ ]');
      const name = A.paint(fit(m.from + (m.isDir ? '/' : ''), nameW), m.on ? (cur ? { bold: true } : {}) : { fg: t.faint });
      const to = A.paint(fit('→ ' + path.posix.dirname(m.to) + '/', toW), { fg: m.on ? t.sky : t.faint });
      right.push((cur ? Th.acorn('›') : ' ') + box + ' ' + name + ' ' + to);
      if (cur && m.why && right.length < rows) right.push('      ' + Th.dim(A.clip(`"${m.why}"`, W - leftW - 8)));
    }
    for (let i = 0; i < rows; i++) {
      const l = wide ? fit(' ' + (tree[i] || ''), leftW) : '';
      out.push(l + (right[i] || ''));
    }
    return out;
  }

  doneLines() {
    const r = this.result;
    const out = ['', '  ' + A.paint(`Moved ${r.moved.length} thing${r.moved.length === 1 ? '' : 's'}${r.made.length ? ` into ${r.made.length} new folder${r.made.length === 1 ? '' : 's'}` : ''}.`, { bold: true, fg: Th.t().ok })];
    if (r.pruned.length) out.push('  ' + Th.dim(`Removed ${r.pruned.length} folder${r.pruned.length === 1 ? '' : 's'} it left empty.`));
    if (r.skipped.length) {
      out.push('', '  ' + Th.warn(`Left ${r.skipped.length} where ${r.skipped.length === 1 ? 'it was' : 'they were'}:`));
      for (const s of r.skipped.slice(0, 6)) out.push('    ' + Th.dim(`${s.from}: ${s.why}`));
    }
    out.push('', '  ' + Th.cream('Changed your mind? Press u (or run tidy undo later) and everything goes back.'));
    out.push('  ' + Th.faint(`The record of this tidy: ${tilde(path.join(AI.home(), 'runs', r.id + '.json'))}`));
    return out;
  }
}

/** Plain text broken into lines at most w wide, at spaces. */
function wrap(text, w) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && A.vwidth(line + ' ' + word) > w) { out.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) out.push(line);
  return out;
}

function edit(ed, s, k) {
  if (k.ctrl) {
    if (k.name === 'a') return ed.home();
    if (k.name === 'e') return ed.end();
    if (k.name === 'u') return ed.killToStart();
    if (k.name === 'k') return ed.killToEnd();
    if (k.name === 'w') return ed.deleteWord();
    return;
  }
  switch (k.name) {
    case 'backspace': return ed.backspace();
    case 'delete': return ed.del();
    case 'left': return ed.left();
    case 'right': return ed.right();
    case 'home': return ed.home();
    case 'end': return ed.end();
    default: if (s && !k.meta && s >= ' ') ed.insert(s);
  }
}

module.exports = { App };
