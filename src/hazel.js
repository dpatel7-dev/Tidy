'use strict';
// Hazel, tidy's squirrel: she keeps her acorns in order, and yours.

const S = require('./sprite');
const Th = require('./theme');

const BASE = [
  '....................',
  '...TTTT.............',
  '..TTTTTT.....oO.oO..',
  '.TTTooTTT....OOOOOO.',
  '.TTo..oTT...OOOOOOO.',
  '.TTo...TT...OOEOOON.',
  '..To...TT..OOOOOOOO.',
  '...o..TTT..OOCCOOO..',
  '.....TTT..OOCCCC....',
  '....TTT.OOOOCCCaA...',
  '...TTT.OOOOOCCaaaA..',
  '...TT.OOOOOOCCaaaA..',
  '...TT.OOOOOOOCCaa...',
  '....TTOOOOOOOOCC....',
  '.....toOOOoo.oOOo...',
  '....tttoo....ooo....',
];

function ink() {
  const light = Th.name() === 'linen';
  return { O: '#d9823b', o: '#a2581f', T: '#eda865', t: '#c97a35', C: '#f3e0c2', E: '#1b1410', N: '#3a2418', A: '#6e4a2c', a: '#c99a58', q: light ? '#7a6a58' : '#f3e0c2', s: Th.t().moss };
}

const blink = (g) => g.map((r) => r.replace('E', 'O'));
const flick = (g) => S.shift(g, -1, 7); // the tail swishes (rows 0-6 move a little)
const hop = (g) => ['....................'].concat(g.slice(0, 15));
const think = (g, n) => S.dots(g, [[19, 1, n > 0 ? 'q' : '.'], [18, 0, n > 1 ? 'q' : '.']]);
const nibble = (g) => g.map((r, y) => (y >= 9 && y <= 12 ? r.replace(/a/g, (m, i) => (i % 2 ? 'O' : m)) : r));
const sad = (g) => g.map((r) => r.replace('E', 'o')).map((r, y) => (y === 2 ? r.replace('oO.oO', 'oo.oo') : r));
const sprout = (g) => S.dots(g, [[0, 14, 's'], [1, 13, 's'], [1, 15, 's']]);

// A smaller Hazel for terminals that draw thin lines through half-blocks
// (macOS Terminal): every pixel is a whole cell there, so she stays crisp.
const MINI = [
  '.TT.....O.O.',
  'TTtT....OOOO',
  'TT.TT..OOEON',
  'T...T.OOOOOO',
  '.T.TTOOCCOO.',
  '..TTOOCCCAA.',
  '..TTOOOCCaa.',
  '...TOOOOOO..',
  '....oo...oo.',
];
const mBlink = (g) => g.map((r) => r.replace('E', 'O'));
const mFlick = (g) => g.map((r, y) => (y < 4 ? '.' + r.slice(0, 5) + r.slice(6) : r)); // just the tail swishes
const mHop = (g) => ['............'].concat(g.slice(0, 8));
const mNibble = (g) => g.map((r, y) => (y === 5 || y === 6 ? r.replace(/[Aa]/g, (m, i) => (i % 2 ? 'O' : m)) : r));
const mSad = (g) => g.map((r) => r.replace('E', 'o')).map((r, y) => (y === 0 ? r.replace('O.O', '...') : r));
const mThink = (g) => S.dots(g, [[11, 0, 'q']]);

const f = (grid, ms = 260) => ({ grid, ms });
const MINI_SCENES = {
  idle: [f(MINI, 1400), f(mBlink(MINI), 150), f(MINI, 1200), f(mFlick(MINI), 260), f(MINI, 900)],
  think: [f(MINI, 300), f(mThink(MINI), 300), f(mFlick(mThink(MINI)), 300), f(mBlink(MINI), 150)],
  work: [f(MINI, 200), f(mNibble(MINI), 200), f(mFlick(MINI), 200), f(mNibble(MINI), 200)],
  done: [f(mHop(MINI), 220), f(MINI, 220), f(mHop(MINI), 220), f(MINI, 1600)],
  oops: [f(mSad(MINI), 1200), f(mBlink(mSad(MINI)), 160)],
};
const blocky = () => S.style() === 'blocky';
const SCENES = {
  idle: [f(BASE, 1400), f(blink(BASE), 150), f(BASE, 1200), f(flick(BASE), 260), f(BASE, 900)],
  think: [f(think(BASE, 0), 300), f(think(BASE, 1), 300), f(think(BASE, 2), 500), f(think(flick(BASE), 2), 300), f(blink(think(BASE, 2)), 150)],
  work: [f(BASE, 200), f(nibble(BASE), 200), f(flick(BASE), 200), f(nibble(BASE), 200)],
  done: [f(hop(BASE), 220), f(BASE, 220), f(hop(BASE), 220), f(sprout(BASE), 1600)],
  oops: [f(sad(BASE), 1200), f(blink(sad(BASE)), 160)],
};

function frameAt(scene, ms) {
  const set = blocky() ? MINI_SCENES : SCENES;
  const frames = set[scene] || set.idle;
  const total = frames.reduce((n, x) => n + x.ms, 0);
  let at = ms % total;
  for (const fr of frames) { if (at < fr.ms) return fr.grid; at -= fr.ms; }
  return frames[0].grid;
}

const draw = (scene = 'idle', ms = 0, bg = Th.t().paper.bg) => (blocky() ? S.drawBlocky : S.draw)(frameAt(scene, ms), ink(), { bg });
const length = (scene) => { const set = blocky() ? MINI_SCENES : SCENES; return (set[scene] || set.idle).reduce((n, x) => n + x.ms, 0); };

module.exports = {
  draw, length, BASE, MINI, ink, SCENES,
  get WIDTH() { return blocky() ? MINI[0].length * 2 : 20; },
  get HEIGHT() { return blocky() ? MINI.length : 8; },
};
