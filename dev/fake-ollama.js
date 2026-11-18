'use strict';
// A pretend Ollama for tests and trying tidy without a real AI.
//
//   node dev/fake-ollama.js [port]     then: TOT_URL_OLLAMA=http://127.0.0.1:<port>/v1 tidy
//
// It answers like a sensible (if simple-minded) model: folders by kind of file.
// With FAKE_NASTY=1 it also slips in every bad idea it can think of, so the
// tests can check that tidy refuses them.

const http = require('http');

const FOLDERS = { image: 'Pictures', video: 'Videos', audio: 'Music', pdf: 'Documents/PDFs', document: 'Documents', spreadsheet: 'Documents/Spreadsheets', slides: 'Documents/Slides', archive: 'Archives', installer: 'Installers', 'text/code': 'Notes and code', '3d model': '3D', font: 'Fonts', project: 'Projects', 'app or bundle': 'Apps' };

function answer(system, user, nasty) {
  if (/in one go/i.test(system)) { // folders and moves together
    const { moves } = answer('', user, nasty);
    const folders = [...new Set(moves.map((m) => m.to))].map((p) => ({ path: p, for: `${String(p).toLowerCase()} go here` }));
    if (nasty) folders.push({ path: '../Escape', for: 'outside' }, { path: '/etc', for: 'system' }, { path: '.hidden', for: 'hidden' }, { path: 'a/b/c/d/e', for: 'too deep' }, { path: 'CON', for: 'reserved' });
    return { summary: 'Everything sorted into folders by what kind of file it is.', folders: folders.filter((f) => !/^(\.\.\/Escape|\/etc|Not\/Designed|DELETE)$/.test(f.path)), moves };
  }
  if (/design a folder structure/i.test(system)) {
    const kinds = JSON.parse((user.match(/Kinds: (\{.*\})/) || [0, '{}'])[1]);
    const folders = [...new Set(Object.keys(kinds).map((k) => FOLDERS[k]).filter(Boolean))].map((p) => ({ path: p, for: `${p.toLowerCase()} go here` }));
    if (nasty) folders.push({ path: '../Escape', for: 'outside' }, { path: '/etc', for: 'system' }, { path: '.hidden', for: 'hidden' }, { path: 'a/b/c/d/e', for: 'too deep' }, { path: 'CON', for: 'reserved' });
    return { summary: 'Everything sorted into folders by what kind of file it is.', folders };
  }
  // the bad ideas go first, so tidy has to look at each one
  const moves = nasty ? [{ i: 99999, to: 'Pictures' }, { i: 0, to: '../Escape' }, { i: 1, to: '/etc' }, { i: 2, to: 'Not/Designed' }, { i: 3, to: 'DELETE' }] : [];
  for (const l of user.split('\n')) {
    const m = l.match(/^(\d+)\. (.+?)(\/)? \| ([^|0-9]+?)(?: [\d.]+[KM]B)? \|/);
    if (!m) continue;
    const to = FOLDERS[m[4].trim()];
    if (to) moves.push({ i: Number(m[1]), to, why: `it's a ${m[4].trim()}` });
  }
  if (nasty) moves.push({ i: 0, to: 'Pictures', why: 'twice' });
  return { moves };
}

function start(port = 0, { nasty = !!process.env.FAKE_NASTY, model = 'tidy-test:3b' } = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: model, size: 2e9, details: { family: 'llama' } }] }));
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: model }] }));
      if (req.url === '/api/chat') {
        const j = JSON.parse(body || '{}');
        log.push(j);
        const sys = (j.messages.find((m) => m.role === 'system') || {}).content || '';
        const user = (j.messages.find((m) => m.role === 'user') || {}).content || '';
        const reply = '```json\n' + JSON.stringify(answer(sys, user, nasty), null, 1) + '\n```';
        return res.end(JSON.stringify({ model: j.model, message: { role: 'assistant', content: reply }, done: true }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, log, port: server.address().port, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => new Promise((r) => server.close(r)) })));
}

if (require.main === module) {
  start(Number(process.argv[2]) || 11999).then((f) => console.log(`fake Ollama on ${f.url}  (TOT_URL_OLLAMA=${f.url})`));
}

module.exports = { start, FOLDERS };
