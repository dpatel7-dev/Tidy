'use strict';
// tidy's tests: the safety rules first, then a whole plan → apply → undo with a pretend AI.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tidy-test-'));
process.env.TIDY_HOME = path.join(tmp, 'home-tidy');
process.env.TOT_HOME = path.join(tmp, 'home-tot');

const Scan = require('../src/scan');
const Plan = require('../src/plan');
const Run = require('../src/apply');
const AI = require('../src/ai');
const Fake = require('../dev/fake-ollama');

function messy(name) {
  const d = path.join(tmp, name);
  const put = (rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); };
  put('holiday.jpg', 'jpg');
  put('IMG_0042.png', 'png');
  put('essay-draft.docx', 'doc');
  put('budget.xlsx', 'xls');
  put('notes.txt', 'Biology test on Friday: cells, mitochondria, osmosis');
  put('setup-tool.dmg', 'dmg');
  put('song.mp3', 'mp3');
  put('passwords.txt', 'bank: hunter2');
  put('.secret-hidden', 'hidden');
  put('my-game/package.json', '{"name":"my-game","description":"a little platformer"}');
  put('my-game/index.js', 'console.log(1)');
  put('Already/kept.pdf', 'pdf');
  return d;
}

test('refuses places it should never touch', () => {
  assert.ok(Scan.refuse('/'), 'the whole disk');
  assert.ok(Scan.refuse(os.homedir()), 'the whole home folder');
  assert.ok(Scan.refuse('/usr'), 'system folders');
  assert.ok(Scan.refuse(path.join(os.homedir(), 'Library')) || process.platform !== 'darwin', 'Library');
  const d = messy('refuse');
  assert.ok(Scan.refuse(path.join(d, 'my-game')), 'a project folder');
  assert.strictEqual(Scan.refuse(d), null, 'an ordinary folder is fine');
});

test('scanning: hidden files skipped, projects whole, private files never read', () => {
  const s = Scan.scan(messy('scan'));
  const names = s.items.map((i) => i.rel);
  assert.ok(!names.some((n) => n.includes('.secret-hidden')), 'hidden files are left alone');
  assert.ok(names.includes('my-game'), 'the project is one item');
  assert.ok(!names.some((n) => n.startsWith('my-game/')), "tidy doesn't look inside projects");
  const pw = s.items.find((i) => i.name === 'passwords.txt');
  assert.ok(pw.private, 'passwords.txt is private');
  assert.strictEqual(pw.hint, '', 'and its contents were not read');
  assert.match(Scan.line(pw), /PRIVATE: contents not read/);
  assert.doesNotMatch(Scan.line(pw), /hunter2/);
  const notes = s.items.find((i) => i.name === 'notes.txt');
  assert.match(notes.hint, /mitochondria/, 'ordinary text gets a short snippet');
});

test('redaction blanks things that look like secrets', () => {
  const r = Scan.redact('key sk-abcdefghijklmnopqrstuvwxyz123456 and password=letmein and ghp_abcdefghijklmnopqrstuvwxyz0123456789 and 123-45-6789');
  assert.doesNotMatch(r, /sk-abcdefghij|letmein|ghp_abcdef|123-45-6789/);
});

test('folder names from the AI are cleaned', () => {
  assert.strictEqual(Plan.cleanFolder('School/English'), 'School/English');
  assert.strictEqual(Plan.cleanFolder(' School\\Maths '), 'School/Maths');
  for (const bad of ['../Escape', '.hidden', 'a/../../b', 'a/b/c/d/e', 'CON', 'bad:name', '', null, 42]) assert.strictEqual(Plan.cleanFolder(bad), null, String(bad));
  assert.strictEqual(Plan.cleanFolder('/etc'), 'etc', 'a leading slash just means "at the top of this folder"');
});

test('a whole tidy with a pretend AI: plan, apply, undo', async () => {
  const fake = await Fake.start(0);
  process.env.TOT_URL_OLLAMA = fake.url;
  try {
    const dir = messy('whole');
    const before = listAll(dir);
    const { model } = await AI.current();
    assert.ok(model && AI.local(model), 'finds the model on "this computer"');
    const s = Scan.scan(dir);
    const plan = await Plan.makePlan(model, s, 'sort by type', {});
    assert.ok(plan.moves.length >= 6, `planned ${plan.moves.length} moves`);
    // nothing has moved yet
    assert.deepStrictEqual(listAll(dir), before, 'planning moves nothing');
    // nothing private was sent
    const sent = JSON.stringify(fake.log);
    assert.doesNotMatch(sent, /hunter2/, "a private file's contents never reach the AI");
    assert.doesNotMatch(sent, /secret-hidden/, 'hidden files are never mentioned');
    const pdf = plan.moves.find((m) => m.from === 'Already/kept.pdf');
    assert.ok(pdf && pdf.to === 'Documents/PDFs/kept.pdf');
    // switch one off: it must stay put
    plan.moves.find((m) => m.from === 'song.mp3').on = false;
    const run = Run.apply(plan, { prune: true });
    assert.strictEqual(run.skipped.length, 0, JSON.stringify(run.skipped));
    assert.ok(fs.existsSync(path.join(dir, 'Pictures', 'holiday.jpg')));
    assert.ok(fs.existsSync(path.join(dir, 'Projects', 'my-game', 'package.json')), 'the project moved whole');
    assert.ok(fs.existsSync(path.join(dir, 'song.mp3')), 'a switched-off move stays put');
    assert.ok(fs.existsSync(path.join(dir, '.secret-hidden')), 'hidden files untouched');
    assert.ok(!fs.existsSync(path.join(dir, 'Already')), 'prune removed the folder this tidy emptied');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'Notes and code', 'notes.txt'), 'utf8'), 'Biology test on Friday: cells, mitochondria, osmosis', 'contents unchanged');
    // the journal is on disk
    assert.ok(fs.existsSync(path.join(process.env.TIDY_HOME, 'runs', run.id + '.json')));
    // undo puts everything back exactly
    const u = Run.undo();
    assert.strictEqual(u.stuck.length, 0, JSON.stringify(u.stuck));
    assert.deepStrictEqual(listAll(dir), before, 'undo restores every file and folder');
    assert.throws(() => Run.undo(run.id), /already undone/);
  } finally { await fake.close(); delete process.env.TOT_URL_OLLAMA; }
});

test("a misbehaving AI can't make tidy do anything unsafe", async () => {
  const fake = await Fake.start(0, { nasty: true });
  process.env.TOT_URL_OLLAMA = fake.url;
  try {
    const dir = messy('nasty');
    const { model } = await AI.current();
    for (const oneGoUpTo of [1000, 0]) { // planned in one question, and in batches
    const plan = await Plan.makePlan(model, Scan.scan(dir), '', { oneGoUpTo });
    for (const m of plan.moves) {
      assert.ok(!m.to.includes('..') && !path.isAbsolute(m.to) && !m.to.startsWith('.'), `unsafe destination ${m.to}`);
      assert.ok(!/Not\/Designed|DELETE|Escape/.test(m.to), `undesigned destination ${m.to}`);
    }
    assert.ok(!plan.folders.some((f) => /\.\.|^\.|^CON$|a\/b\/c\/d/.test(f.path)), 'bad folders were dropped');
    assert.ok(plan.dropped.unknown >= 1 && plan.dropped.folder >= 2, JSON.stringify(plan.dropped));
    const froms = plan.moves.map((m) => m.from);
    assert.strictEqual(new Set(froms).size, froms.length, 'each thing moves at most once');
    }
  } finally { await fake.close(); delete process.env.TOT_URL_OLLAMA; }
});

test('never replaces a file, never moves into a project, never follows a link out', () => {
  const dir = messy('clash');
  fs.mkdirSync(path.join(dir, 'Pictures'));
  fs.writeFileSync(path.join(dir, 'Pictures', 'holiday.jpg'), 'the one already there');
  const outside = fs.mkdtempSync(path.join(tmp, 'outside-'));
  fs.symlinkSync(outside, path.join(dir, 'Sneaky'));
  const s = Scan.scan(dir);
  const it = (n) => s.items.find((x) => x.name === n).i;
  const design = { folders: [{ path: 'Pictures' }, { path: 'my-game/assets' }, { path: 'Sneaky' }] };
  const { moves, dropped } = Plan.validate(s, design, [
    { i: it('holiday.jpg'), to: 'Pictures' },
    { i: it('IMG_0042.png'), to: 'my-game/assets' },
    { i: it('song.mp3'), to: 'Sneaky' },
  ]);
  const hol = moves.find((m) => m.from === 'holiday.jpg');
  assert.strictEqual(hol.to, 'Pictures/holiday (2).jpg', 'renamed beside, never replaced');
  assert.ok(!moves.some((m) => m.to.startsWith('my-game/')), 'nothing goes into a project');
  assert.ok(dropped.inside >= 1);
  const run = Run.apply({ root: s.root, moves });
  assert.strictEqual(fs.readFileSync(path.join(dir, 'Pictures', 'holiday.jpg'), 'utf8'), 'the one already there');
  assert.deepStrictEqual(fs.readdirSync(outside), [], 'nothing escaped through the link');
  assert.ok(run.skipped.some((x) => x.from === 'song.mp3' && /link/.test(x.why)), JSON.stringify(run.skipped));
  assert.ok(fs.existsSync(path.join(dir, 'song.mp3')));
});

test("apply skips anything that changed since tidy looked", () => {
  const dir = messy('changed');
  const s = Scan.scan(dir);
  const { moves } = Plan.validate(s, { folders: [{ path: 'Pictures' }, { path: 'Docs' }] }, [
    { i: s.items.find((x) => x.name === 'holiday.jpg').i, to: 'Pictures' },
    { i: s.items.find((x) => x.name === 'essay-draft.docx').i, to: 'Docs' },
  ]);
  fs.writeFileSync(path.join(dir, 'holiday.jpg'), 'now it is bigger than before');
  fs.unlinkSync(path.join(dir, 'essay-draft.docx'));
  const run = Run.apply({ root: s.root, moves });
  assert.strictEqual(run.moved.length, 0);
  assert.strictEqual(run.skipped.length, 2);
  assert.ok(fs.existsSync(path.join(dir, 'holiday.jpg')));
});

test('instant plans: by kind and by date, no AI, only loose files', () => {
  const Quick = require('../src/quick');
  const dir = path.join(tmp, 'quick');
  const put = (rel, text = 'x', when) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); if (when) fs.utimesSync(f, when, when); };
  put('Screenshot 2026-11-01 at 09.12.png');
  put('Screen Shot 2025-02-03.png');
  put('cat.jpg');
  put('dog.heic');
  put('setup.dmg');
  put('other-setup.pkg');
  put('lonely.pdf');
  put('essay.docx');
  put('story.docx');
  put('weird.thing');
  put('Pictures/old.jpg'); // a folder you made: kept, and reused
  put('School/notes.txt'); // inside a folder: never touched
  const s = Scan.scan(dir);
  const k = Quick.byKind(s);
  const to = Object.fromEntries(k.moves.map((m) => [m.from, m.to]));
  assert.strictEqual(to['cat.jpg'], 'Pictures/cat.jpg', 'reuses the Pictures folder you already have');
  assert.strictEqual(to['Screenshot 2026-11-01 at 09.12.png'], 'Screenshots/Screenshot 2026-11-01 at 09.12.png');
  assert.strictEqual(to['setup.dmg'], 'Installers/setup.dmg');
  assert.strictEqual(to['lonely.pdf'], 'Documents/lonely.pdf', 'a lone PDF joins the documents');
  assert.ok(!to['weird.thing'], 'unknown things stay put');
  assert.ok(!k.moves.some((m) => m.from.includes('/')), 'nothing inside your folders moves');
  assert.ok(k.moves.every((m) => m.on));
  // by date: two different years, so years with months inside
  put('old-a.txt', 'x', new Date('2024-03-05T12:00:00'));
  put('old-b.txt', 'x', new Date('2024-03-09T12:00:00'));
  const d = Quick.byDate(Scan.scan(dir));
  const a = d.moves.find((m) => m.from === 'old-a.txt');
  assert.strictEqual(a.to, '2024/03 March/old-a.txt');
  // everything from one month: nothing to do
  const one = path.join(tmp, 'one-month');
  fs.mkdirSync(one);
  for (const n of ['a.txt', 'b.txt']) fs.writeFileSync(path.join(one, n), 'x');
  const e = Quick.byDate(Scan.scan(one));
  assert.strictEqual(e.moves.length, 0);
  assert.match(e.summary, /wouldn't help/);
});

test('the screen: pick a folder, see a plan at once, one Enter moves, u undoes', async () => {
  const { App } = require('../src/app');
  const { PassThrough } = require('stream');
  const A = require('../src/ansi');
  const plain = (lines) => lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
  const input = new PassThrough();
  const output = new PassThrough();
  output.columns = 110; output.rows = 34;
  // no folder: the picker
  A.setLevel(3);
  const picker = new App({ input, output });
  const p0 = plain(picker.frame(110, 34).lines);
  assert.match(p0, /Which folder should tidy sort\?/);
  assert.match(p0, /Somewhere else/);
  // a folder: the plan is already there, no AI needed
  const dir = messy('screen');
  const before = listAll(dir);
  const app = new App({ input, output, folder: dir });
  const text = plain(app.frame(110, 34).lines);
  assert.match(text, /By kind/);
  assert.match(text, /never deletes/);
  assert.match(text, /move \d+ things/);
  assert.match(text, /→ Documents\//, 'a lone essay and a lone budget still make a Documents folder');
  // Hazel: half blocks normally (never ▀), whole cells in macOS Terminal
  process.env.TERM_PROGRAM = 'Apple_Terminal';
  const blocky = app.frame(110, 34).lines.join('\n');
  delete process.env.TERM_PROGRAM;
  assert.ok(!/[▀▄]/.test(blocky.replace(/\x1b\[[0-9;]*m/g, '')), 'no half blocks in macOS Terminal');
  // Enter right after the plan appears is ignored (a double-tap can't move things)
  app.onKey('', { name: 'return' });
  assert.strictEqual(app.mode, 'plan');
  app.calm = 0;
  app.onKey('', { name: 'return' });
  assert.strictEqual(app.mode, 'done');
  assert.ok(fs.existsSync(path.join(dir, 'Documents', 'essay-draft.docx')), 'moved');
  assert.ok(fs.existsSync(path.join(dir, 'setup-tool.dmg')), 'a single installer stays where it is');
  assert.match(plain(app.frame(110, 34).lines), /Moved \d+ things/);
  app.onKey('u', {});
  assert.deepStrictEqual(listAll(dir), before, 'u put everything back');
  A.setLevel(0);
});

function listAll(dir) {
  const out = [];
  const walk = (rel) => {
    for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) { out.push(r + '/'); walk(r); } else out.push(`${r}=${fs.readFileSync(path.join(dir, r), 'utf8')}`);
    }
  };
  walk('');
  return out;
}
