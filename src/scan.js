'use strict';
// Looking at a folder before anything happens: what's in it, what each thing
// seems to be, and what must never be touched or sent anywhere.
//
// Safety rules that live here:
//   - only folders you could reasonably mean: never /, never your whole home
//     folder, never system or app folders
//   - hidden files and folders (.git, .env, .DS_Store…) are never moved
//   - symlinks are never followed or moved
//   - a project (a .git folder, package.json, Cargo.toml…) or an app/bundle is
//     one thing: it can move as a whole, but nothing inside it is touched
//   - files that look private (keys, passwords, .env, tax forms…) never have
//     their contents read; only the name goes to the AI
//   - contents are only ever a short snippet of a text file, with anything
//     that looks like a secret blanked out

const fs = require('fs');
const os = require('os');
const path = require('path');

const LIMITS = { depth: 3, items: 1500, snippet: 360, readBytes: 64 * 1024, textMax: 2 * 1024 * 1024 };

// Signs that a folder is a project (code, a game, a site): it then moves as one piece.
const STRONG = ['.git', '.hg', '.svn', 'package.json', 'Cargo.toml', 'pyproject.toml', 'setup.py', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'Gemfile', 'composer.json', 'CMakeLists.txt', 'project.godot', 'ProjectSettings', 'pubspec.yaml', 'deno.json', 'mix.exs', 'stack.yaml', '.sln', '.xcodeproj', '.csproj'];
const WEAK = ['Makefile', 'requirements.txt', 'index.html', 'src', 'README.md', 'main.py', 'main.go', 'Dockerfile', 'tsconfig.json', '.gitignore'];
const BUNDLES = /\.(app|bundle|framework|photoslibrary|musiclibrary|pages|numbers|key|xcodeproj|xcworkspace|logicx|band|fcpbundle|imovielibrary|lrlibrary|rtfd|playground|swiftpm)$/i;
const PRIVATE = /(^\.env|\.env$|secret|password|passwd|credential|private[-_ ]?key|\bid_(rsa|dsa|ecdsa|ed25519)\b|\.(pem|key|p12|pfx|kdbx|keychain|asc|gpg|ovpn)$|wallet|seed[-_ ]?phrase|recovery[-_ ]?(code|key)|2fa|backup[-_ ]?codes|\btax(es)?\b|w-?2\b|1099|ssn|social[-_ ]?security|passport|bank[-_ ]?statement|license[-_ ]?scan)/i;
const TEXTY = /\.(txt|md|markdown|rst|csv|tsv|json|ya?ml|toml|ini|cfg|conf|log|xml|html?|css|scss|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|lua|gd|sh|bash|zsh|sql|r|m|tex|bib|srt|vtt)$/i;

const KIND = [
  [/\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp|svg|raw|cr2|nef|arw|dng|psd|ai|xcf|kra|aseprite)$/i, 'image'],
  [/\.(mp4|mov|m4v|mkv|avi|webm|wmv|flv)$/i, 'video'],
  [/\.(mp3|wav|aiff?|flac|m4a|aac|ogg|opus|mid|midi)$/i, 'audio'],
  [/\.(pdf)$/i, 'pdf'],
  [/\.(docx?|odt|rtf|pages)$/i, 'document'],
  [/\.(xlsx?|ods|numbers|csv|tsv)$/i, 'spreadsheet'],
  [/\.(pptx?|odp|key)$/i, 'slides'],
  [/\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i, 'archive'],
  [/\.(dmg|pkg|exe|msi|deb|rpm|appimage|iso)$/i, 'installer'],
  [/\.(ttf|otf|woff2?)$/i, 'font'],
  [/\.(stl|obj|fbx|blend|gltf|glb|3mf|step|stp)$/i, '3d model'],
  [TEXTY, 'text/code'],
];
const kindOf = (name) => (KIND.find(([re]) => re.test(name)) || [null, 'other'])[1];

/** Why a folder can't be tidied, or null if it can. */
function refuse(dir) {
  const real = safeReal(dir);
  if (!real) return `Can't find ${dir}.`;
  let st;
  try { st = fs.statSync(real); } catch { return `Can't open ${dir}.`; }
  if (!st.isDirectory()) return `${dir} isn't a folder.`;
  const home = os.homedir();
  const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  if (norm(real) === norm(path.parse(real).root)) return "That's the whole disk. Pick a folder inside it, like Downloads.";
  if (norm(real) === norm(home)) return "That's your whole home folder. Pick a folder inside it, like Downloads, Desktop or Documents.";
  const systemish = ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/var', '/private', '/opt', '/boot', '/dev', '/proc', '/sys', '/snap',
    path.join(home, 'Library'), path.join(home, 'Applications'), path.join(home, 'AppData'), 'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'];
  for (const s of systemish) {
    const n = norm(s);
    if (norm(real) === n || norm(real).startsWith(n + path.sep.toLowerCase()) || norm(real).startsWith(n + '/')) return `${real} belongs to the system or to apps. tidy won't touch it.`;
  }
  if (isProject(real)) return `${path.basename(real)} looks like a project (it has ${projectMarker(real)}). tidy keeps projects exactly as they are.`;
  return null;
}

function safeReal(p) { try { return fs.realpathSync(path.resolve(p)); } catch { return null; } }
function projectMarker(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const strong = STRONG.find((m) => names.includes(m) || (m.startsWith('.') && names.some((n) => n.endsWith(m) && n !== m)));
  if (strong) return strong;
  const weak = WEAK.filter((m) => names.includes(m));
  return weak.length >= 2 ? weak.join(' and ') : null; // one README or index.html alone isn't a project
}
const isProject = (dir) => !!projectMarker(dir);

/** A short, safe glimpse of what a text file says. */
function snippet(file, size) {
  if (size > LIMITS.textMax) return '';
  let buf;
  try {
    const fd = fs.openSync(file, 'r');
    buf = Buffer.alloc(Math.min(size, LIMITS.readBytes));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
  } catch { return ''; }
  if (buf.includes(0)) return ''; // binary after all
  return redact(buf.toString('utf8')).replace(/\s+/g, ' ').trim().slice(0, LIMITS.snippet);
}

/** Blank out anything that looks like a key, password or token. */
function redact(text) {
  return text
    .replace(/-----BEGIN [^-]+-----[\s\S]*?(-----END [^-]+-----|$)/g, '[hidden key]')
    .replace(/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abp]|AKIA|AIza|ya29|hf)[-_A-Za-z0-9]{12,}/g, '[hidden]')
    .replace(/((?:pass(?:word)?|pwd|secret|token|api[-_ ]?key|auth)\s*[:=]\s*)\S+/gi, '$1[hidden]')
    .replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, '[hidden]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[hidden]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[hidden]');
}

/** What a project is, from its own description. */
function projectHint(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (pkg.description || pkg.name) return redact(`${pkg.name || ''}: ${pkg.description || ''}`).slice(0, 200);
  } catch { /* no package.json */ }
  for (const r of ['README.md', 'README.txt', 'README', 'readme.md']) {
    const s = snippet(path.join(dir, r), 4096);
    if (s) return s.slice(0, 200);
  }
  return '';
}

/**
 * Everything tidy could move inside `root`. Returns
 * { root, items: [{ i, rel, name, kind, size, mtime, isDir, unit, private, hint }], dirs: [rel], skipped: {…}, truncated }
 */
function scan(root, opts = {}) {
  const lim = { ...LIMITS, ...opts };
  root = safeReal(root);
  const items = [];
  const dirs = [];
  const skipped = { hidden: 0, links: 0, deep: 0, unreadable: 0 };
  let truncated = false;
  const walk = (rel, depth) => {
    let list;
    try { list = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { skipped.unreadable++; return; }
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of list) {
      if (items.length >= lim.items) { truncated = true; return; }
      const r = rel ? `${rel}/${d.name}` : d.name;
      const full = path.join(root, rel, d.name);
      if (d.name.startsWith('.') || d.name === 'desktop.ini' || d.name === 'Thumbs.db' || d.name === 'Icon\r') { skipped.hidden++; continue; }
      if (d.isSymbolicLink()) { skipped.links++; continue; }
      let st;
      try { st = fs.lstatSync(full); } catch { skipped.unreadable++; continue; }
      if (d.isDirectory()) {
        const bundle = BUNDLES.test(d.name);
        const marker = bundle ? null : projectMarker(full);
        if (bundle || marker) {
          items.push({ rel: r, name: d.name, kind: bundle ? 'app or bundle' : 'project', size: 0, mtime: st.mtimeMs, isDir: true, unit: true, private: false, hint: bundle ? '' : projectHint(full) });
          continue;
        }
        dirs.push(r);
        if (depth + 1 >= lim.depth) { skipped.deep++; items.push({ rel: r, name: d.name, kind: 'folder', size: 0, mtime: st.mtimeMs, isDir: true, unit: true, private: false, hint: 'a folder (not looked inside: too deep)' }); continue; }
        walk(r, depth + 1);
        continue;
      }
      if (!d.isFile()) continue;
      const priv = PRIVATE.test(d.name);
      const kind = kindOf(d.name);
      items.push({ rel: r, name: d.name, kind, size: st.size, mtime: st.mtimeMs, isDir: false, unit: false, private: priv, hint: !priv && TEXTY.test(d.name) ? snippet(full, st.size) : '' });
    }
  };
  walk('', 0);
  items.forEach((it, i) => { it.i = i; });
  return { root, items, dirs, skipped, truncated };
}

/** A compact picture of the folder for the AI's first look. */
function overview(s, { samples = 80 } = {}) {
  const byKind = {};
  for (const it of s.items) byKind[it.kind] = (byKind[it.kind] || 0) + 1;
  const counts = {};
  for (const it of s.items) { const top = it.rel.includes('/') ? it.rel.split('/')[0] + '/' : '(top level)'; counts[top] = (counts[top] || 0) + 1; }
  const step = Math.max(1, Math.floor(s.items.length / samples));
  const sample = s.items.filter((_, i) => i % step === 0).slice(0, samples).map((it) => `${it.rel}${it.isDir ? '/' : ''} (${it.kind})`);
  return {
    total: s.items.length,
    kinds: byKind,
    folders: s.dirs.slice(0, 120),
    perTopFolder: counts,
    sample,
  };
}

/** One line per item for the AI, short and safe. */
function line(it) {
  const date = new Date(it.mtime).toISOString().slice(0, 10);
  const size = it.isDir ? '' : it.size > 1048576 ? `${(it.size / 1048576).toFixed(1)}MB` : `${Math.ceil(it.size / 1024)}KB`;
  const hint = it.private ? 'PRIVATE: contents not read' : it.hint ? `says: ${it.hint.slice(0, 220)}` : '';
  return `${it.i}. ${it.rel}${it.isDir ? '/' : ''} | ${it.kind}${size ? ' ' + size : ''} | ${date}${hint ? ' | ' + hint : ''}`;
}

module.exports = { scan, refuse, overview, line, redact, kindOf, isProject, LIMITS, PRIVATE, safeReal };
