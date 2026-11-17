'use strict';
// Which AI tidy asks, and asking it. tidy borrows Tree of Thought's keys and
// models (~/.tot) so there's nothing new to set up, and prefers a model on
// this computer (Ollama) when there is one: then nothing leaves your Mac.

const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./providers');

const home = () => process.env.TIDY_HOME || path.join(os.homedir(), '.tidy');
const totHome = () => process.env.TOT_HOME || path.join(os.homedir(), '.tot');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

const config = {
  load: () => readJson(path.join(home(), 'config.json'), {}),
  save(c) { fs.mkdirSync(home(), { recursive: true }); fs.writeFileSync(path.join(home(), 'config.json'), JSON.stringify(c, null, 2)); },
};

const keyOf = (m) => `${m.provider}:${m.id}`;
const local = (m) => m && m.provider === 'ollama';

/** Every model tidy could use: on this computer first, then Tree of Thought's garden. */
async function models() {
  const out = [];
  const totCfg = readJson(path.join(totHome(), 'config.json'), {});
  if (totCfg.customBase) P.setCustomBase(totCfg.customBase);
  const keys = readJson(path.join(totHome(), 'keys.json'), {});
  const mine = await P.ollamaModels();
  for (const m of mine || []) if (!/embed/i.test(m.name)) out.push({ provider: 'ollama', id: m.name, name: m.name, size: m.size });
  for (const m of totCfg.garden || []) {
    if (m.provider === 'ollama' || m.provider === 'auto' || out.some((x) => keyOf(x) === keyOf(m))) continue;
    if (P.PROVIDERS[m.provider] && keys[m.provider]) out.push({ provider: m.provider, id: m.id, name: m.name, free: !!m.free, power: m.power || 0 });
  }
  return out;
}

/**
 * The model to use: the one you picked; else the strongest free cloud model
 * from Tree of Thought (tot free); else the biggest one on this computer;
 * else Tree of Thought's current one.
 */
async function current() {
  const all = await models();
  const pick = config.load().model;
  const chosen = pick && all.find((m) => keyOf(m) === pick);
  if (chosen) return { model: chosen, all };
  const free = all.filter((m) => m.free && !local(m)).sort((a, b) => (b.power || 0) - (a.power || 0));
  if (free.length) return { model: free[0], all };
  const locals = all.filter(local).sort((a, b) => (b.size || 0) - (a.size || 0));
  if (locals.length) return { model: locals[0], all };
  const totCfg = readJson(path.join(totHome(), 'config.json'), {});
  const g = (totCfg.garden || [])[totCfg.current || 0];
  return { model: (g && all.find((m) => keyOf(m) === keyOf(g))) || all[0] || null, all };
}

function choose(m) { config.save({ ...config.load(), model: keyOf(m) }); }

/** Pull a JSON object out of a model's answer (it may wrap it in ``` or chat around it). */
function parseJson(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error("The AI didn't answer with a plan.");
  t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch {
    return JSON.parse(t.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"')); // trailing commas, curly quotes
  }
}

/** Ask once and get JSON back (retries once if the answer wasn't JSON). */
async function askJson(model, system, user, { signal } = {}) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await ask(model, system, attempt ? user + '\n\nReply with the JSON object only.' : user, { signal });
    try { return parseJson(text); } catch (e) { last = e; }
  }
  throw last;
}

async function ask(model, system, user, { signal } = {}) {
  if (local(model)) {
    // Ollama's own API lets us ask for JSON and a bigger memory than its default
    const root = P.baseOf('ollama').replace(/\/v1$/, '');
    let res;
    try {
      res = await fetch(root + '/api/chat', {
        method: 'POST', signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: model.id, stream: false, format: 'json', options: { num_ctx: 16384, temperature: 0.2 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
    } catch (e) { if (e.name === 'AbortError') throw e; throw new Error("Couldn't reach Ollama on this computer. Is it running?"); }
    if (!res.ok) throw new Error(`Ollama said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return (j.message && j.message.content) || '';
  }
  const keys = readJson(path.join(totHome(), 'keys.json'), {});
  // a free model that's busy or over its limit hands over to another free one
  const others = model.free ? (await models()).filter((m) => m.free && !local(m) && keyOf(m) !== keyOf(model)).sort((a, b) => (b.power || 0) - (a.power || 0)) : [];
  let last;
  for (const m of [model, ...others].slice(0, 4)) {
    try {
      const r = await P.chat({ provider: m.provider, key: keys[m.provider], model: m.id, system, messages: [{ role: 'user', content: user }], signal });
      return r.text;
    } catch (e) {
      last = e;
      const s = Number(e.status) || 0;
      if (e.name === 'AbortError' || !(s === 429 || s >= 500 || (!s && /couldn't reach|cut off/i.test(e.message)))) throw e;
    }
  }
  throw last;
}

module.exports = { models, current, choose, ask, askJson, parseJson, keyOf, local, config, home };
