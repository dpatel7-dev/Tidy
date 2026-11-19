'use strict';
// tidy's screen.
//
//   tidy  Downloads  ~/Downloads · 214 things · 1.3 GB                          1.2.0
//   ──────────────────────────────────────────────────────────────────────────────
//    By kind   By date   Ask the AI                          46 moves into 7 folders
//    Loose files sorted by what they are. Folders you made stay as they are.
//
//    Installers/    8   › ● setup-tool.dmg                 → Installers/
//    Screenshots/  12     ● Screenshot 2026-11-01.png      → Screenshots/
//   ──────────────────────────────────────────────────────────────────────────────
//    only moves · never deletes or replaces · u undoes
//     enter  move 46 things    ←→ another way   space skip   tab other folder   esc quit
//
// "By kind" and "By date" need no AI, so they're ready the moment a folder
// opens. "Ask the AI" is for anything they can't do ("by school subject").
// One Enter moves what you see; u puts it all back.

const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./ansi');
const Th = require('./theme');
const Hazel = require('./hazel');
const AI = require('./ai');
const P = require('./providers');
const Scan = require('./scan');
const Plan = require('./plan');
const Quick = require('./quick');
const Run = require('./apply');
const { Editor } = require('./editor');
const { Tui, fit, spread, size, ago, bar, open: openThing } = require('./tui');
const pkg = require('../package.json');

const tilde = (p) => (p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p);
const untilde = (p) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const WAYS = [
  { id: 'kind', name: 'By kind', hue: 'acorn' },
  { id: 'date', name: 'By date', hue: 'sky' },
  { id: 'ai', name: 'Ask the AI', hue: 'berry' },
];
// ready-made requests for the AI: [what it's told, what you see]
const IDEAS = [
  ['', 'Tidy it up sensibly'],
  ['sort by school subject', 'By school subject'],
  ['group things by project or topic', 'By project or topic'],
  ['photos and screenshots by year, everything else by what it is', 'Photos by year, the rest by kind'],
  ["put anything older than a year into one folder called Old stuff", 'Old things into one folder'],
];
const HUES = ['acorn', 'moss', 'sky', 'berry', 'warn', 'plum', 'teal', 'cream', 'clay'];
const SPIN = ['◐', '◓', '◑', '◒'];

/** k of colour a, the rest b (both #rrggbb). */
function mix(a, b, k) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v * k + y[i] * (1 - k)).toString(16).padStart(2, '0')).join('');
}

class App {
  constructor({ input = process.stdin, output = process.stdout, folder = null, request = '' } = {}) {
    Th.use(AI.config.load().theme || 'walnut');
    this.ed = new Editor(); // what to ask the AI
    this.fed = new Editor(); // a folder path you type
    this.mode = 'pick'; // pick | path | plan | done
    this.way = 'kind';
    this.ai = { plan: null, asking: true, thinking: false, step: '', started: 0, done: 0, total: 0, request: '' };
    this.idea = 0;
    this.sel = 0;
    this.top = 0;
    this.prune = false;
    this.consent = false;
    this.calm = 0;
    this.mood = { scene: 'idle', at: Date.now() };
    this.flash = null;
    this.ui = new Tui({ input, output, paper: Th.t().paper, render: (w, h) => this.frame(w, h) });
    this.ui.on('key', (s, k) => this.onKey(s || '', k || {}));
    this.ui.on('paste', (t) => { const ed = this.mode === 'path' ? this.fed : this.typing() ? this.ed : null; if (ed) ed.insert(t.replace(/\s*\n\s*/g, ' ').trim()); this.dirty(); });
    this.ui.on('mouse', (m) => { if (m.wheel && this.mode === 'plan' && this.plan()) { this.move(m.wheel); this.dirty(); } });
    this.places = this.candidates();
    this.pickSel = 0;
    if (folder) {
      if (this.open(folder) && request) { this.ed.set(request); this.way = 'ai'; this.autoAsk = true; }
    }
  }

  run() {
    return new Promise((resolve) => {
      this.done = resolve;
      this.ui.start();
      this.ticker = setInterval(() => { if (this.flash && this.flash.until < Date.now()) this.flash = null; this.dirty(); }, 130);
      AI.current().then(({ model, all }) => {
        this.model = model;
        this.models = all;
        if (this.autoAsk) { this.autoAsk = false; this.askAI(); }
        this.dirty();
      }, () => {});
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
  /** A fresh plan just appeared: ignore Enter for a moment so a double-tap can't move things by accident. */
  guard() { this.calm = Date.now() + 400; }
  typing() { return this.mode === 'plan' && this.way === 'ai' && this.ai.asking && !this.ai.thinking; }

  // ── folders ─────────────────────────────────────────────────────────────────
  /** Downloads, Desktop, Documents and the folder you're in, if tidy may sort them. */
  candidates() {
    const home = os.homedir();
    const list = [];
    const add = (label, dir) => {
      const real = Scan.safeReal(dir);
      if (!real || !isDir(real) || Scan.refuse(real) || list.some((x) => x.dir === real)) return;
      let count = 0;
      try { count = fs.readdirSync(real).filter((n) => !n.startsWith('.')).length; } catch { /* unreadable */ }
      const last = Run.runs().find((r) => r.root === real && r.moved.length);
      list.push({ label, dir: real, count, last });
    };
    add('This folder', process.cwd());
    for (const name of ['Downloads', 'Desktop', 'Documents']) add(name, path.join(home, name));
    if (list[0] && list[0].label === 'This folder' && list.slice(1).some((x) => x.dir === list[0].dir)) list.shift();
    list.push({ label: 'Somewhere else…', dir: null });
    return list;
  }

  open(dir) {
    const why = Scan.refuse(untilde(dir));
    if (why) { this.say(why, 'err', 8000); return false; }
    this.folder = Scan.safeReal(untilde(dir));
    this.refresh();
    this.mode = 'plan';
    this.react('idle');
    this.guard();
    return true;
  }

  /** Look at the folder again and remake the instant plans. */
  refresh() {
    try { this.scanned = Scan.scan(this.folder); } catch { this.scanned = { root: this.folder, items: [], dirs: [], skipped: {}, truncated: false }; }
    this.plans = { kind: Quick.byKind(this.scanned), date: Quick.byDate(this.scanned) };
    this.ai.plan = null; // files moved: an older AI plan no longer fits
    this.ai.asking = true;
    this.lastHere = Run.runs().find((r) => r.root === this.folder && !r.undone && r.moved.length) || null;
    this.sel = 0;
    this.top = 0;
  }

  plan() { return this.way === 'ai' ? (this.ai.thinking || this.ai.asking ? null : this.ai.plan) : this.plans && this.plans[this.way]; }

  // ── the AI ──────────────────────────────────────────────────────────────────
  allowed(m) { return AI.local(m) || (AI.config.load().cloudOk || []).includes(m.provider); }

  askAI() {
    if (!this.model) return this.say('Asking the AI needs one: install Ollama (ollama.com) and a model, or set up Tree of Thought. By kind and By date work without one.', 'err', 10000);
    if (!this.allowed(this.model)) { this.consent = true; return this.dirty(); }
    this.think();
  }

  async think() {
    const ai = this.ai;
    Object.assign(ai, { thinking: true, asking: false, started: Date.now(), step: 'Reading what is here…', done: 0, total: 0 });
    this.react('think');
    this.dirty();
    this.ac = new AbortController();
    const request = this.ed.text.trim();
    try {
      const s = Scan.scan(this.folder);
      if (!s.items.length) throw new Error('There is nothing here to sort.');
      ai.total = s.items.length;
      const plan = await Plan.makePlan(this.model, s, request, {
        signal: this.ac.signal,
        onStep: (p) => {
          ai.step = p.step === 'design' ? 'Designing the folders…' : p.step === 'one' ? `Planning ${plural(s.items.length, 'thing')}…` : 'Deciding where things go…';
          ai.done = p.done || 0;
          this.dirty();
        },
      });
      ai.plan = plan;
      ai.request = request;
      if (this.way === 'ai') { this.sel = 0; this.top = 0; this.guard(); }
      this.react(plan.moves.length ? 'idle' : 'oops');
    } catch (e) {
      ai.asking = true;
      this.react('oops');
      if (e.name !== 'AbortError') this.say(e.message, 'err', 10000);
    }
    ai.thinking = false;
    this.ac = null;
    this.dirty();
  }

  nextModel() {
    if (!this.models || !this.models.length) return this.say('No AIs found. Install Ollama (ollama.com), or set up Tree of Thought.', 'warn', 7000);
    const i = this.models.findIndex((m) => this.model && AI.keyOf(m) === AI.keyOf(this.model));
    this.model = this.models[(i + 1) % this.models.length];
    AI.choose(this.model);
    this.say(`The AI is now ${this.model.name}${AI.local(this.model) ? ', on this computer: nothing leaves it' : ''}.`, 'ok');
  }

  // ── doing it ────────────────────────────────────────────────────────────────
  applyPlan() {
    const p = this.plan();
    if (!p || !p.moves.length) return;
    const n = p.moves.filter((m) => m.on).length;
    if (!n) return this.say('Every move is switched off. Space switches one back on, a switches them all.', 'warn');
    this.react('work');
    try {
      this.result = Run.apply(p, { prune: this.prune });
    } catch (e) {
      this.react('oops');
      return this.say(`Couldn't move things: ${e.message}. Nothing was lost; try again, or press u if some moved.`, 'err', 15000);
    }
    const where = new Map();
    for (const m of this.result.moved) { const top = path.posix.dirname(m.to).split('/')[0]; where.set(top, (where.get(top) || 0) + 1); }
    this.result.where = [...where.entries()].map(([name, n]) => ({ name, n, hue: this.hueOf(p, name) }));
    this.result.into = where.size;
    this.flash = null;
    try { this.scanned = Scan.scan(this.folder); } catch { /* the header can wait */ }
    this.mode = 'done';
    this.react(this.result.moved.length ? 'done' : 'oops');
    this.guard();
    this.dirty();
  }

  undoHere() {
    const last = this.lastHere || Run.runs().find((r) => r.root === this.folder && !r.undone && r.moved.length);
    if (!last) return this.say('There is no tidy to undo here.', 'warn');
    try {
      const r = Run.undo(last.id);
      this.say(`Put back ${plural(r.back.length, 'thing')}${r.stuck.length ? `; ${r.stuck.length} couldn't be (they moved again)` : ''}.`, 'ok', 7000);
      this.react('idle');
    } catch (e) { this.say(e.message, 'warn'); }
    this.refresh();
    this.mode = 'plan';
    this.guard();
  }

  setWay(id) {
    this.way = id;
    this.sel = 0;
    this.top = 0;
    if (id === 'ai' && !this.ai.plan && !this.ai.thinking) this.ai.asking = true;
    this.guard();
  }

  turn(step) {
    const i = WAYS.findIndex((w) => w.id === this.way);
    this.setWay(WAYS[(i + step + WAYS.length) % WAYS.length].id);
  }

  move(step) {
    const p = this.plan();
    const n = p ? p.moves.length : 0;
    this.sel = Math.max(0, Math.min(n - 1, this.sel + step));
  }

  // ── keys ────────────────────────────────────────────────────────────────────
  onKey(s, k) {
    if (k.name === 'enter') k = { ...k, name: 'return' }; // some keyboards send \n for Enter
    if (k.ctrl && (k.name === 'c' || k.name === 'd')) return this.quit();
    if (k.ctrl && k.name === 't') { Th.use(Th.name() === 'walnut' ? 'linen' : 'walnut'); AI.config.save({ ...AI.config.load(), theme: Th.name() }); this.ui.setPaper(Th.t().paper); return this.dirty(); }
    if (this.consent) {
      if (s === 'y' || k.name === 'return') {
        const c = AI.config.load();
        AI.config.save({ ...c, cloudOk: [...new Set([...(c.cloudOk || []), this.model.provider])] });
        this.consent = false;
        this.think();
      } else if (s === 'n' || k.name === 'escape') { this.consent = false; this.say('Nothing was sent. Ctrl+O picks another AI, or use By kind or By date.', 'dim', 7000); }
      else if (k.ctrl && k.name === 'o') { this.nextModel(); if (this.allowed(this.model)) { this.consent = false; this.think(); } }
      return this.dirty();
    }
    const m = this.mode;
    if (m === 'pick') {
      if (k.name === 'up') this.pickSel = Math.max(0, this.pickSel - 1);
      else if (k.name === 'down') this.pickSel = Math.min(this.places.length - 1, this.pickSel + 1);
      else if (k.name === 'return') {
        const p = this.places[this.pickSel];
        if (p.dir) this.open(p.dir);
        else { this.fed.set('~/'); this.mode = 'path'; }
      } else if (k.name === 'escape' || s === 'q') {
        if (this.folder) { this.mode = 'plan'; this.guard(); } else return this.quit();
      }
      return this.dirty();
    }
    if (m === 'path') {
      if (k.name === 'return') this.open(this.fed.text.trim() || '.');
      else if (k.name === 'escape') this.mode = 'pick';
      else edit(this.fed, s, k);
      return this.dirty();
    }
    if (m === 'done') {
      if (s === 'u') this.undoHere();
      else if (s === 'o') { openThing(this.folder); this.say(`Opened ${path.basename(this.folder)} in ${process.platform === 'darwin' ? 'Finder' : 'your file browser'}.`, 'ok'); }
      else if (k.name === 'return') { if (Date.now() >= this.calm) return this.quit(); }
      else if (s === 'b' || k.name === 'left' || k.name === 'backspace') { this.refresh(); this.mode = 'plan'; this.react('idle'); this.guard(); }
      else if (s === 'q' || k.name === 'escape') return this.quit();
      return this.dirty();
    }
    // the plan screen
    if (k.name === 'tab') { this.places = this.candidates(); this.pickSel = Math.max(0, this.places.findIndex((x) => x.dir === this.folder)); this.mode = 'pick'; return this.dirty(); }
    if (k.ctrl && k.name === 'o') { this.nextModel(); return this.dirty(); }
    if (this.typing()) {
      const empty = !this.ed.text;
      if (k.name === 'return') this.askAI();
      else if (k.name === 'up' || k.name === 'down') { this.idea = Math.max(0, Math.min(IDEAS.length - 1, this.idea + (k.name === 'up' ? -1 : 1))); this.ed.set(IDEAS[this.idea][0]); }
      else if (empty && (k.name === 'left' || k.name === 'right')) this.turn(k.name === 'left' ? -1 : 1);
      else if (k.name === 'escape') { if (this.ai.plan) { this.ai.asking = false; this.guard(); } else if (!empty) this.ed.clear(); else this.setWay('kind'); }
      else if (k.ctrl && k.name === 'z') this.undoHere();
      else edit(this.ed, s, k);
      return this.dirty();
    }
    if (k.name === 'left' || k.name === 'right') this.turn(k.name === 'left' ? -1 : 1);
    else if (s >= '1' && s <= '3') this.setWay(WAYS[Number(s) - 1].id);
    else if (k.name === 'up') this.move(-1);
    else if (k.name === 'down') this.move(1);
    else if (k.name === 'pageup') this.move(-10);
    else if (k.name === 'pagedown') this.move(10);
    else if (s === ' ') { const mv = this.plan() && this.plan().moves[this.sel]; if (mv) mv.on = !mv.on; }
    else if (s === 'a') { const p = this.plan(); if (p) { const all = p.moves.every((x) => x.on); p.moves.forEach((x) => { x.on = !all; }); } }
    else if (s === 'p') { this.prune = !this.prune; this.say(this.prune ? 'Folders this leaves empty will be removed too (undo brings them back).' : 'Empty folders will be left alone.'); }
    else if (s === 'u') this.undoHere();
    else if ((s === 'e' || s === '/') && this.way === 'ai' && !this.ai.thinking) { this.ai.asking = true; this.ed.set(this.ai.request); }
    else if (k.name === 'return') {
      const p = this.plan();
      if (Date.now() < this.calm) { /* a fresh plan: wait a moment */ }
      else if (this.way === 'ai' && p && !p.moves.length) { this.ai.asking = true; this.ed.set(this.ai.request); }
      else if (!p || !p.moves.length) this.say(this.way === 'ai' ? 'Type what you want first, then press Enter.' : 'Nothing to move this way. Use ←→ to look at the other ways.', 'warn');
      else this.applyPlan();
    }
    else if (k.name === 'escape') { if (this.way === 'ai' && this.ai.thinking) { this.ac.abort(); this.say('Stopped. Nothing was moved.'); } else return this.quit(); }
    else if (s === 'q') return this.quit();
    this.dirty();
  }

  // ── drawing ─────────────────────────────────────────────────────────────────
  frame(W, H) {
    const t = Th.t();
    const out = [];
    // the top line: where you are
    const sc = this.scanned;
    const facts = this.folder && sc ? `${plural(sc.items.length, 'thing')}${sc.truncated ? '+' : ''} · ${size(sc.items.reduce((a, b) => a + b.size, 0))}` : '';
    const left = ' ' + A.paint('tidy', { bold: true, fg: t.acorn }) + (this.folder && this.mode !== 'pick' && this.mode !== 'path'
      ? '   ' + A.paint(path.basename(this.folder), { bold: true }) + Th.dim('  ' + tilde(this.folder)) + Th.faint('  ·  ' + facts)
      : Th.dim('   sorts a folder for you, carefully'));
    out.push(spread(left, Th.faint(pkg.version + ' '), W));
    out.push(Th.faint('─'.repeat(W)));
    const bodyH = Math.max(4, H - out.length - 3);
    let body;
    if (this.mode === 'pick' || this.mode === 'path') body = this.pickLines(W, bodyH);
    else if (this.mode === 'done') body = this.doneLines(W, bodyH);
    else body = this.planLines(W, bodyH);
    let cursor = null;
    if (body.cursor) cursor = { row: out.length + body.cursor.row, col: body.cursor.col };
    const lines = body.lines || body;
    while (lines.length < bodyH) lines.push('');
    out.push(...lines.slice(0, bodyH).map((l) => A.clip(l, W)));
    out.push(Th.faint('─'.repeat(W)));
    // the status line: a message, a question, the folder you're typing, or the promises
    const f = this.flash;
    if (this.consent) {
      const who = (P.PROVIDERS[this.model.provider] || { name: this.model.provider }).name;
      const ask = `${this.model.name} runs on ${who}, not this computer. Let it see file names and short snippets from now on?`;
      out.push(' ' + A.clip(Th.warn(A.vwidth(ask) <= W - 2 ? ask : `Let ${who} see file names and short snippets?`), W - 2));
    } else if (this.mode === 'path') {
      const label = 'Folder to sort: ';
      const lay = this.fed.layout(Math.max(10, W - label.length - 3), 1);
      out.push(' ' + Th.acorn(label, { bold: true }) + lay.lines[0]);
      cursor = { row: out.length - 1, col: 1 + label.length + lay.col };
    } else if (f) out.push(' ' + A.clip(A.paint(f.text, { fg: t[f.kind] || t.dim }), W - 2));
    else if (this.mode === 'plan' && !this.typing() && this.plan() && this.plan().moves.some((m) => m.on)) {
      const p = this.plan();
      const on = p.moves.filter((m) => m.on);
      const into = new Set(on.map((m) => path.posix.dirname(m.to).split('/')[0])).size;
      const go = `Press Enter to move ${plural(on.length, 'thing')} into ${plural(into, 'folder')}.`;
      const safe = W >= 100 ? '  Nothing gets deleted, and u puts it all back.' : W >= 70 ? '  Nothing gets deleted.' : '';
      out.push(' ' + A.paint(go, { fg: t.cream, bold: true }) + Th.dim(safe));
    } else out.push(' ' + Th.faint(W >= 90 ? 'only moves things into folders  ·  never deletes or replaces anything  ·  u undoes' : 'only moves things  ·  never deletes or replaces  ·  u undoes'));
    out.push(this.keyBar(W));
    return { lines: out.slice(0, H), cursor };
  }

  /** The keys that do something right now; the main one stands out. */
  keyBar(W) {
    const t = Th.t();
    const p = this.mode === 'plan' ? this.plan() : null;
    const on = p ? p.moves.filter((m) => m.on).length : 0;
    let keys;
    if (this.consent) keys = [['y', 'allow', true], ['n', 'not now'], ['ctrl+o', 'another AI']];
    else if (this.mode === 'pick') keys = [['enter', 'open', true], ['↑↓', 'choose'], ['esc', this.folder ? 'back' : 'quit']];
    else if (this.mode === 'path') keys = [['enter', 'open', true], ['esc', 'back']];
    else if (this.mode === 'done') keys = this.result && this.result.moved.length ? [['enter', 'all done', true], ['o', 'show me'], ['u', 'put it all back'], ['b', 'sort more']] : [['b', 'go back', true], ['enter', 'close tidy']];
    else if (this.typing()) keys = [['enter', 'ask the AI', true], ['↑↓', 'pick an idea'], ['ctrl+o', 'another AI'], ['esc', this.ai.plan ? 'back to the plan' : 'back']];
    else if (this.way === 'ai' && p && !p.moves.length) keys = [['enter', 'ask again', true], ['←→', 'another way'], ['ctrl+o', 'another AI'], ['esc', 'quit']];
    else if (this.way === 'ai' && this.ai.thinking) keys = [['esc', 'stop'], ['←→', 'look at another way']];
    else {
      keys = [];
      if (on) keys.push(['enter', `move ${plural(on, 'thing')}`, true]);
      keys.push(['←→', 'another way']);
      if (p && p.moves.length) keys.push(['space', 'leave one']);
      if (this.way === 'ai') keys.push(['e', 'ask differently']);
      if (this.lastHere) keys.push(['u', 'undo last tidy']);
      keys.push(['tab', 'other folder'], ['esc', 'quit']);
    }
    const chip = ([key, label, main]) => (main
      ? A.paint(` ${key} `, { bg: t.acorn, fg: t.paper.bg, bold: true }) + ' ' + A.paint(label, { fg: t.cream, bold: true })
      : A.paint(key, { fg: t.cream }) + ' ' + Th.dim(label));
    let parts = keys.map(chip);
    while (parts.length > 1 && A.vwidth(' ' + parts.join('   ')) > W) parts = parts.slice(0, -1);
    return ' ' + parts.join('   ');
  }

  /** Hazel on the left, words on the right. */
  beside(scene, lines, W) {
    const pic = Hazel.draw(scene, Date.now() - this.mood.at, Th.t().paper.bg);
    const hw = Hazel.WIDTH;
    const out = [];
    for (let i = 0; i < Math.max(pic.length, lines.length); i++) out.push('  ' + (pic[i] || ' '.repeat(hw)) + '    ' + (lines[i] || ''));
    return { lines: out, col: 2 + hw + 4 };
  }

  pickLines(W) {
    const t = Th.t();
    const right = [A.paint('Which folder should tidy sort?', { bold: true }), ''];
    const nameW = Math.max(...this.places.map((p) => A.vwidth(p.label))) + 3;
    this.places.forEach((p, i) => {
      const cur = i === this.pickSel;
      const mark = cur ? Th.acorn('› ') : '  ';
      const name = A.paint(p.label.padEnd(nameW), cur ? { bold: true, fg: t.acorn } : { fg: t.cream });
      let info = '';
      if (p.dir) info = (p.count ? Th.dim(plural(p.count, 'thing').padStart(11)) : Th.faint('empty'.padStart(11))) + (p.label === 'This folder' ? Th.faint('  ' + tilde(p.dir)) : '') + (p.last ? Th.faint(`   tidied ${ago(p.last.started)}`) : '');
      else info = Th.faint('type where it is');
      right.push(mark + name + info);
    });
    right.push('', Th.dim('You see the whole plan before anything moves.'));
    return this.beside(this.mood.scene, right, W).lines;
  }

  planLines(W, H) {
    const t = Th.t();
    const out = [];
    const p = this.plan();
    // the ways, as tabs
    const tabs = WAYS.map((w) => {
      const on = w.id === this.way;
      const hue = t[w.hue];
      let label = w.name;
      if (w.id === 'ai' && this.ai.thinking) label += ' ' + SPIN[Math.floor(Date.now() / 160) % SPIN.length];
      else if (w.id === 'ai' && this.ai.plan && !on) label += ' •';
      return on ? A.paint(` ${label} `, { bg: mix(hue, t.paper.bg, 0.22), fg: hue, bold: true }) : A.paint(` ${label} `, { fg: t.dim });
    }).join(' ');
    let summary = '';
    if (p) {
      const on = p.moves.filter((m) => m.on).length;
      summary = p.moves.length ? Th.cream(`${on === p.moves.length ? plural(on, 'move') : `${on} of ${plural(p.moves.length, 'move')}`} into ${plural(p.folders.length, 'folder')}`) : '';
    }
    out.push(spread(' ' + tabs, summary + ' ', W));
    if (this.way === 'ai' && this.ai.thinking) return out.concat([''], this.thinkingLines(W).lines);
    if (this.typing()) {
      const a = this.askLines(W);
      return { lines: out.concat([''], a.lines), cursor: a.cursor && { row: a.cursor.row + 2, col: a.cursor.col } };
    }
    if (!p) return out;
    if (!p.moves.length) return out.concat([''], this.emptyLines(p, W));
    out.push(' ' + Th.dim(A.clip(p.summary || '', W - 2)));
    const dropped = Object.values(p.dropped || {}).reduce((a, b) => a + b, 0);
    if (dropped && p.how === 'ai') out.push(' ' + Th.faint(`${plural(dropped, 'suggestion')} from the AI didn't pass tidy's safety checks and ${dropped === 1 ? 'was' : 'were'} left out.`));
    out.push('');
    return out.concat(this.moveLines(p, W, H - out.length));
  }

  /** Each top-level folder of a plan gets its own colour. */
  hueOf(p, dest) {
    if (!p._hues) {
      p._hues = new Map();
      for (const f of p.folders) { const top = f.path.split('/')[0].toLowerCase(); if (!p._hues.has(top)) p._hues.set(top, Th.t()[HUES[p._hues.size % HUES.length]]); }
    }
    const top = dest.split('/')[0].toLowerCase();
    if (!p._hues.has(top)) p._hues.set(top, Th.t()[HUES[p._hues.size % HUES.length]]);
    return p._hues.get(top);
  }

  moveLines(p, W, rows) {
    const t = Th.t();
    const tree = Plan.treeOf(p);
    const wide = W >= 96 && tree.length;
    const out = [];
    let leftW = 0;
    const left = [];
    if (wide) {
      let parent = '';
      for (const x of tree) {
        const top = x.depth === 0;
        if (top) parent = x.name;
        const name = '  '.repeat(Math.max(0, x.depth - 1)) + (top ? '' : Th.faint('└ ')) + A.paint(x.name, { fg: this.hueOf(p, parent), bold: top });
        left.push({ name, count: x.count });
      }
      leftW = Math.min(36, Math.max(...left.map((x) => A.vwidth(x.name) + String(x.count).length + 3), 14)) + 2;
    } else if (tree.length) {
      // narrow: the folders on one line
      const chips = tree.filter((x) => x.depth === 0).map((x) => A.paint(x.name, { fg: this.hueOf(p, x.name), bold: true }) + Th.faint(' ' + x.count));
      out.push(' ' + A.clip(chips.join('   '), W - 2));
      out.push('');
      rows -= 2;
    }
    const over = p.moves.length + 1 > rows; // +1: the reason under the chosen move
    if (over) rows -= 1; // room to say where you are in the list
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + rows - 1) this.top = Math.max(0, this.sel - rows + 2);
    const listW = W - leftW - 2;
    const toW = Math.min(30, Math.max(12, Math.floor(listW * 0.36)));
    const nameW = Math.max(10, listW - toW - 6);
    const right = [];
    for (let i = this.top; i < p.moves.length && right.length < rows; i++) {
      const m = p.moves[i];
      const cur = i === this.sel;
      const dest = path.posix.dirname(m.to);
      const hue = this.hueOf(p, dest);
      const dot = m.on ? A.paint('●', { fg: hue }) : Th.faint('○');
      const name = A.paint(fit(m.from + (m.isDir ? '/' : ''), nameW), m.on ? (cur ? { bold: true } : {}) : { fg: t.faint });
      const to = m.on ? A.paint(fit('→ ' + dest + '/', toW), { fg: hue }) : Th.faint(fit('stays here', toW));
      right.push((cur ? Th.acorn('›') : ' ') + ' ' + dot + ' ' + name + ' ' + to);
      if (cur && m.why && right.length < rows) right.push('     ' + Th.dim(A.clip(m.why, listW - 6)));
    }
    const shownTo = this.top + right.filter((l) => !l.startsWith('     ')).length;
    for (let i = 0; i < Math.max(rows, 0); i++) {
      const l = wide ? (left[i] ? fit(' ' + spread(left[i].name, Th.faint(String(left[i].count)), leftW - 3), leftW) : ' '.repeat(leftW)) : '';
      out.push(l + (right[i] || ''));
    }
    if (over) {
      const extra = left.length > rows ? Th.faint(`  (+${left.length - rows} more folders)`) : '';
      out.push((wide ? ' '.repeat(leftW) : '') + '  ' + Th.faint(`${this.top + 1}–${shownTo} of ${p.moves.length}  ·  ↑↓ to look through them`) + extra);
    }
    return out;
  }

  emptyLines(p, W) {
    const w = Math.max(20, W - Hazel.WIDTH - 10);
    const para = (text, paint) => A.wrap(text, w).map((l) => paint(l));
    const lines = [];
    if (this.scanned && !this.scanned.items.length) lines.push(A.paint(`${path.basename(this.folder)} is empty.`, { bold: true }), '', ...para('There is nothing here to sort. Press Tab to pick another folder.', Th.dim));
    else if (p.how === 'kind') lines.push(A.paint('Nothing to sort by kind.', { bold: true }), '', ...para('The loose files here are already in folders, or there is only one of each kind.', Th.dim));
    else if (p.how === 'date') lines.push(A.paint('Nothing to sort by date.', { bold: true }), '', ...para(p.summary, Th.dim));
    else {
      const lost = Object.values(p.dropped || {}).reduce((a, b) => a + b, 0);
      if (lost) lines.push(A.paint("The AI's answer didn't fit the files here.", { bold: true }), '', ...para(`It suggested ${plural(lost, 'move')}, but none of them pointed at real files and sensible folders, so tidy left everything alone. Press Enter to ask again, or Ctrl+O to try a different AI.`, Th.dim));
      else lines.push(A.paint('The AI thinks everything is where it belongs.', { bold: true }), '', ...para('Press Enter and say more about what you want.', Th.dim));
    }
    if (this.scanned && this.scanned.items.length) lines.push('', ...para(p.how === 'ai' ? 'Use ←→ to see the other ways.' : 'Use ←→ to see the other ways, or ask the AI for something smarter.', Th.cream));
    return this.beside('oops', lines, W).lines;
  }

  askLines(W) {
    const t = Th.t();
    const m = this.model;
    const name = this.folder ? path.basename(this.folder) : 'this folder';
    const right = [A.paint(`How should the AI sort ${name}?`, { bold: true }), ''];
    const boxW = Math.max(20, Math.min(64, W - Hazel.WIDTH - 12));
    const lay = this.ed.layout(boxW - 4, 1);
    const edge = { fg: t.berry };
    right.push(A.paint('╭' + '─'.repeat(boxW - 2) + '╮', edge));
    right.push(A.paint('│ ', edge) + fit(this.ed.text ? lay.lines[0] : Th.faint('say it in your own words, or pick an idea'), boxW - 4) + A.paint(' │', edge));
    right.push(A.paint('╰' + '─'.repeat(boxW - 2) + '╯', edge));
    const cursorRow = 3;
    right.push('');
    IDEAS.forEach(([ask, label], i) => {
      const cur = this.ed.text === ask && (ask || i === this.idea);
      right.push((cur ? Th.berry('› ') : '  ') + A.paint(label, cur ? { fg: t.cream, bold: true } : { fg: t.dim }));
    });
    right.push('');
    const wrapW = Math.max(20, W - Hazel.WIDTH - 8);
    if (!m) right.push(...A.wrap('No AI found yet. Install Ollama (ollama.com), or set up Tree of Thought.', wrapW).map((l) => Th.err(l)));
    else if (AI.local(m)) right.push(...A.wrap(`${m.name} runs on this computer, so nothing leaves it.`, wrapW).map((l) => Th.moss(l)));
    else right.push(...A.wrap(`${m.name} on ${(P.PROVIDERS[m.provider] || { name: m.provider }).name}. It sees file names and short snippets, never private-looking files.`, wrapW).map((l) => Th.dim(l)));
    const b = this.beside('idle', right, W);
    return { lines: b.lines, cursor: { row: cursorRow, col: b.col + 2 + lay.col } };
  }

  thinkingLines(W) {
    const ai = this.ai;
    const secs = Math.floor((Date.now() - ai.started) / 1000);
    const right = [A.paint(ai.step, { bold: true, fg: Th.t().berry }), ''];
    if (ai.total && ai.done) right.push(Th.berry(bar(ai.done / ai.total, 24, '━', '─')) + Th.dim(`  ${ai.done} of ${ai.total}`), '');
    right.push(Th.dim(`${this.model ? this.model.name : 'The AI'} is reading the names.  ${secs}s`));
    right.push(Th.dim('Nothing moves until you see the plan and press Enter.'));
    right.push('', Th.faint('By kind and By date are ready now, if you want to look (←→).'));
    return this.beside('think', right, W);
  }

  doneLines(W) {
    const r = this.result;
    const t = Th.t();
    if (!r.moved.length) {
      const why = [A.paint('Nothing was moved.', { bold: true, fg: t.warn }), ''];
      if (r.skipped.length) {
        why.push(Th.dim(`tidy checked all ${plural(r.skipped.length, 'move')} and stopped ${r.skipped.length === 1 ? 'it' : 'them'} to keep your files safe:`), '');
        const reasons = new Map();
        for (const x of r.skipped) reasons.set(x.why, (reasons.get(x.why) || 0) + 1);
        for (const [w, n] of [...reasons.entries()].slice(0, 5)) why.push(Th.cream(`  ${plural(n, 'thing')}: `) + Th.dim(w));
        why.push('', Th.dim('Press b to look again; tidy reads the folder fresh.'));
      } else why.push(Th.dim('Every move was switched off.'));
      return this.beside('oops', why, W).lines;
    }
    const right = [A.paint(`Done! Moved ${plural(r.moved.length, 'thing')}${r.into ? ` into ${plural(r.into, 'folder')}` : ''}.`, { bold: true, fg: t.ok })];
    if (r.where.length) {
      right.push('');
      const chips = r.where.map((x) => A.paint(x.name + '/', { fg: x.hue, bold: true }) + Th.faint(' ' + x.n));
      let line = '';
      for (const c of chips) { if (line && A.vwidth(line + '   ' + c) > W - Hazel.WIDTH - 10) { right.push(line); line = c; } else line = line ? line + '   ' + c : c; }
      if (line) right.push(line);
    }
    if (r.pruned.length) right.push('', Th.dim(`Removed ${plural(r.pruned.length, 'folder')} it left empty.`));
    if (r.skipped.length) {
      right.push('', Th.warn(`Left ${r.skipped.length} where ${r.skipped.length === 1 ? 'it was' : 'they were'}:`));
      for (const s of r.skipped.slice(0, 4)) right.push(Th.dim(`  ${A.clip(s.from, 40)}: ${s.why}`));
    }
    right.push('', Th.cream('Changed your mind? Press u and everything goes back where it was.'));
    right.push(Th.faint('Later, you can undo it by typing: tidy undo'));
    right.push('', Th.dim('Press Enter to close tidy.'));
    return this.beside(this.mood.scene, right, W).lines;
  }
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

module.exports = { App, IDEAS, WAYS };
