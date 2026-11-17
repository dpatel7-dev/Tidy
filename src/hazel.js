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

const f = (grid, ms = 260) => ({ grid, ms });
const SCENES = {
  idle: [f(BASE, 1400), f(blink(BASE), 150), f(BASE, 1200), f(flick(BASE), 260), f(BASE, 900)],
  think: [f(think(BASE, 0), 300), f(think(BASE, 1), 300), f(think(BASE, 2), 500), f(think(flick(BASE), 2), 300), f(blink(think(BASE, 2)), 150)],
  work: [f(BASE, 200), f(nibble(BASE), 200), f(flick(BASE), 200), f(nibble(BASE), 200)],
  done: [f(hop(BASE), 220), f(BASE, 220), f(hop(BASE), 220), f(sprout(BASE), 1600)],
  oops: [f(sad(BASE), 1200), f(blink(sad(BASE)), 160)],
};

function frameAt(scene, ms) {
  const frames = SCENES[scene] || SCENES.idle;
  const total = frames.reduce((n, x) => n + x.ms, 0);
  let at = ms % total;
  for (const fr of frames) { if (at < fr.ms) return fr.grid; at -= fr.ms; }
  return frames[0].grid;
}

const draw = (scene = 'idle', ms = 0, bg = Th.t().paper.bg) => S.draw(frameAt(scene, ms), ink(), { bg });
const length = (scene) => (SCENES[scene] || SCENES.idle).reduce((n, x) => n + x.ms, 0);

module.exports = { draw, length, BASE, ink, SCENES, WIDTH: 20, HEIGHT: 8 };
