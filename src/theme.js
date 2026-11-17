'use strict';
// tidy's colours: a warm pantry. "walnut" is dark, "linen" is light.

const A = require('./ansi');

const THEMES = {
  walnut: {
    paper: { bg: '#17130f', fg: '#efe5d6' },
    dim: '#9b8b78', faint: '#5d4f41', line: '#3a2f25', select: '#251e17',
    acorn: '#e8913a', moss: '#9bbf6a', sky: '#7fb3d5', berry: '#e0607a', cream: '#f3e0c2', ok: '#9bbf6a', warn: '#f2c14e', err: '#ff6b5b',
  },
  linen: {
    paper: { bg: '#f6f1e8', fg: '#2a2018' },
    dim: '#7a6a58', faint: '#b9aa96', line: '#e2d8c8', select: '#ece3d5',
    acorn: '#b9601a', moss: '#4f7a2a', sky: '#2f6f9a', berry: '#b8324f', cream: '#8a6a3a', ok: '#3f7a2a', warn: '#9a6a06', err: '#c0392b',
  },
};
let current = THEMES.walnut;
let name = 'walnut';
function use(n) { name = THEMES[n] ? n : 'walnut'; current = THEMES[name]; return current; }
const t = () => current;
const c = (key) => (s, extra = {}) => A.paint(s, { fg: current[key], ...extra });

module.exports = {
  THEMES, use, t, name: () => name,
  dim: c('dim'), faint: c('faint'), acorn: c('acorn'), moss: c('moss'), sky: c('sky'), berry: c('berry'), cream: c('cream'), ok: c('ok'), warn: c('warn'), err: c('err'),
  bold: (s) => A.paint(s, { bold: true }),
};
