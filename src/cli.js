'use strict';
// `tidy` and its sub-commands.

const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./ansi');
const Th = require('./theme');
const AI = require('./ai');
const Scan = require('./scan');
const Plan = require('./plan');
const Quick = require('./quick');
const Run = require('./apply');
const { size, ago } = require('./tui');
const pkg = require('../package.json');

const HELP = `
  tidy ${pkg.version} - an AI that tidies a folder, carefully

  tidy                         pick a folder (Downloads, Desktop…) and sort it
  tidy ~/Downloads             sort that folder
  tidy ~/Downloads "how"       ...and ask the AI to sort it your way
  tidy plan <folder> ["how"]   make a plan and print it (moves nothing)
                               no "how": sorted by kind at once, no AI needed
  tidy plan <folder> "how" --apply
                               make a plan, show it, and move after you type yes
  tidy undo                    put the last tidy back exactly as it was
  tidy history                 every tidy, newest first
  tidy models                  which AIs tidy can use
  tidy model <name>            use that one (a model on this computer is the most private)
  tidy update                  get the newest version
  tidy uninstall               remove tidy (add --all to delete its history too)
  tidy --version

  tidy only ever moves things into folders. It never deletes, renames or
  replaces a file, never leaves the folder you gave it, leaves projects, apps and
  hidden files alone, and writes every move down first so undo always works.
`;

function out(s = '') { process.stdout.write(s + '\n'); }
const tilde = (p) => (p.startsWith(os.homedir()) ? '~' + p.slice(os.homedir().length) : p);

async function main(argv) {
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); }); // e.g. tidy plan … | head
  Th.use(AI.config.load().theme || 'walnut');
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case '--version': case '-v': case 'version': out(`tidy ${pkg.version}`); return;
    case 'help': case '--help': case '-h': out(HELP); return;
    case 'undo': return undo(rest[0]);
    case 'history': case 'runs': return history();
    case 'models': return listModels();
    case 'model': return pickModel(rest.join(' '));
    case 'plan': return planCmd(rest);
    case 'update': return update();
    case 'uninstall': return uninstall(rest.includes('--all'));
    default: {
      if (cmd && cmd.startsWith('-')) throw new Error(`"${cmd}" isn't something tidy knows. Try: tidy help`);
      const folder = cmd ? path.resolve(cmd.replace(/^~(?=$|\/|\\)/, os.homedir())) : null;
      if (cmd && !isDir(folder)) throw new Error(`"${cmd}" isn't a folder here. Try: tidy help`);
      if (!process.stdin.isTTY || !process.stdout.isTTY) { out(HELP); return; }
      const { App } = require('./app');
      await new App({ folder, request: rest.join(' ') }).run();
    }
  }
}

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

async function planCmd(args) {
  const yes = args.includes('--apply');
  args = args.filter((a) => a !== '--apply');
  const [where, ...words] = args;
  if (!where) throw new Error('Which folder? tidy plan ~/Downloads "sort by type"');
  const folder = path.resolve(where.replace(/^~(?=$|\/|\\)/, os.homedir()));
  if (!isDir(folder)) throw new Error(`"${where}" isn't a folder.`);
  const why = Scan.refuse(folder);
  if (why) throw new Error(why);
  const s = Scan.scan(folder);
  if (!s.items.length) throw new Error('There is nothing here to tidy.');
  if (!words.length || /^by (kind|date)$/i.test(words.join(' ').trim())) { // instant: no AI
    const plan = /date/i.test(words.join(' ')) ? Quick.byDate(s) : Quick.byKind(s);
    printPlan(plan);
    if (!plan.moves.length) return;
    return maybeApply(plan, yes);
  }
  const { model } = await AI.current();
  if (!model) throw new Error('Asking the AI needs one: install Ollama (ollama.com) and run "ollama pull llama3.2", or set up Tree of Thought. Without "how", tidy plan sorts by kind with no AI.');
  if (!AI.local(model)) out(Th.dim(`  ${model.name} isn't on this computer: tidy sends it file names, sizes, dates and short snippets (private-looking files: name only).`));
  out(Th.dim(`  ${model.name} is looking at ${s.items.length} things in ${tilde(folder)}…`));
  const ac = new AbortController();
  process.on('SIGINT', () => { ac.abort(); out('\n  Stopped. Nothing was moved.'); process.exit(130); });
  const plan = await Plan.makePlan(model, s, words.join(' '), {
    signal: ac.signal,
    onStep: (p) => { if (process.stderr.isTTY && p.step === 'assign') process.stderr.write(`\r  Deciding where things go: ${p.done} of ${p.total}…   `); },
    // (small folders are planned in one go, so there's no count to show)
  });
  if (process.stderr.isTTY) process.stderr.write('\r' + ' '.repeat(50) + '\r');
  printPlan(plan);
  if (!plan.moves.length) return;
  return maybeApply(plan, yes);
}

async function maybeApply(plan, yes) {
  if (!yes) { out(Th.dim('\n  Nothing moved. Add --apply to move these (you will be asked first), or run tidy to pick moves one by one.')); return; }
  if (!process.stdin.isTTY) throw new Error('To move things, run this in a terminal so tidy can ask you first.');
  const ans = await question(`\n  Move these ${plan.moves.length}? (y/n) `);
  if (!/^y(es)?$/i.test(ans.trim())) { out('  Nothing moved.'); return; }
  const r = Run.apply(plan, {});
  out(`  ${A.paint('✓', { fg: Th.t().ok })} Moved ${r.moved.length}${r.skipped.length ? `, left ${r.skipped.length} where they were` : ''}. ${Th.dim('tidy undo puts them back.')}`);
}

function printPlan(plan) {
  out('');
  if (!plan.moves.length) { out('  ' + Th.dim(plan.how === 'ai' ? 'The AI thinks everything is where it belongs.' : plan.summary || 'Nothing to sort.')); return; }
  out('  ' + A.paint(`${plan.moves.length} moves into ${plan.folders.length} folders`, { bold: true }) + Th.dim('  ·  nothing deleted, nothing replaced'));
  if (plan.summary) out('  ' + Th.dim(plan.summary));
  out('');
  for (const f of Plan.treeOf(plan)) out('  ' + '  '.repeat(f.depth) + Th.acorn(f.name) + Th.faint(` ${f.count}`));
  out('');
  for (const m of plan.moves) out(`  ${m.from}${m.isDir ? '/' : ''} ${Th.faint('→')} ${Th.sky(path.posix.dirname(m.to) + '/')}${m.why ? Th.faint(`  ${m.why}`) : ''}`);
  const dropped = Object.values(plan.dropped).reduce((a, b) => a + b, 0);
  if (dropped) out(Th.faint(`\n  (${dropped} of the AI's suggestions didn't pass tidy's checks and were left out)`));
}

function question(q) {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a); }));
}

function undo(id) {
  const r = Run.undo(id);
  out(`  ${A.paint('✓', { fg: Th.t().ok })} Put back ${r.back.length} thing${r.back.length === 1 ? '' : 's'} in ${tilde(r.run.root)}.`);
  for (const s of r.stuck) out(Th.warn(`  ! ${s.to}: ${s.why}`));
}

function history() {
  const all = Run.runs();
  if (!all.length) { out('  No tidies yet.'); return; }
  for (const r of all) {
    out(`  ${Th.faint(ago(r.started).padEnd(10))}${tilde(r.root)}  ${Th.dim(`${r.moved.length} moved`)}${r.undone ? Th.faint(' · undone') : ''}${r.request ? Th.faint(`  "${r.request.slice(0, 50)}"`) : ''}`);
    out(Th.faint(`  ${''.padEnd(10)}id ${r.id}`));
  }
  out(Th.dim('\n  tidy undo <id> puts a particular one back.'));
}

async function listModels() {
  const { model, all } = await AI.current();
  if (!all.length) { out('  No AIs found. Install Ollama (ollama.com) and run: ollama pull llama3.2'); return; }
  for (const m of all) {
    const on = model && AI.keyOf(m) === AI.keyOf(model);
    out(`  ${on ? Th.acorn('›') : ' '} ${m.name.padEnd(34)} ${AI.local(m) ? Th.moss('on this computer') : Th.dim(m.provider)}${m.size ? Th.faint('  ' + size(m.size)) : ''}`);
  }
}

async function pickModel(want) {
  const { all } = await AI.current();
  const w = want.toLowerCase();
  const m = all.find((x) => `${x.name} ${x.id}`.toLowerCase().includes(w));
  if (!w || !m) throw new Error('Which one? See: tidy models');
  AI.choose(m);
  out(`  tidy will use ${m.name}.`);
}

function installUrl(kind) {
  let site = '';
  try { site = fs.readFileSync(path.join(AI.home(), 'hub'), 'utf8').trim(); } catch { /* installed from GitHub */ }
  if (/^https?:\/\//.test(site)) return `${site.replace(/\/+$/, '')}/tidy/install.${kind}`;
  return `https://raw.githubusercontent.com/dpatel7-dev/tidy/main/install.${kind}`;
}

function update() {
  const { spawnSync } = require('child_process');
  const win = process.platform === 'win32';
  const url = installUrl(win ? 'ps1' : 'sh');
  out(`  Updating from ${url}`);
  const r = win
    ? spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${url} | iex`], { stdio: 'inherit' })
    : spawnSync('sh', ['-c', `curl -fsSL "${url}" | sh`], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('The update did not finish. Your current version still works.');
}

function uninstall(all) {
  const root = AI.home();
  let launcher = '';
  try { launcher = fs.readFileSync(path.join(root, 'launcher'), 'utf8').trim(); } catch { /* not installed by the installer */ }
  for (const p of [path.join(root, 'app'), path.join(root, 'node')]) fs.rmSync(p, { recursive: true, force: true });
  if (launcher && /tidy(\.cmd)?$/.test(launcher)) fs.rmSync(launcher, { force: true });
  if (all) fs.rmSync(root, { recursive: true, force: true });
  out(`  tidy is uninstalled.${all ? '' : ` Its history (for undo) is still in ${root}.`}`);
}

module.exports = { main, HELP };
