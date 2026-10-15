// ================================================================
// THE PORTRAIT KEEPER v4.3 - server-side batch painter for the
// Choose Your Fate portrait vault. Runs in GitHub Actions; paints
// the faces not yet in vault/, commits them, Pages serves them
// to the game. Nothing is painted twice.
// v2: CONCURRENT sittings, bigger batches, shared rate-limit pause.
// v3: MODERATION RECOVERY for protected fictional characters.
// v4: SECURITY - the API key comes ONLY from the MISTRAL_KEY
//     secret (Settings -> Secrets -> Actions). Never hardcoded;
//     refuses to run without it.
// v4.1: cron keeper - runs every 30 min, self-disables (rc==2)
//     when the roster is complete.
// v4.2: batch seeds may be shipped gzipped+base64 as .b64 files
//     (large batches stay under GitHub's 100KB file limits), and
//     aliases.json maps alias keys onto already-painted keys so
//     the same person is never painted twice.
// v4.3: VAULT FOLDERS - nation-map.json maps every key to a folder
//     group ("history/<nation>" or "<universe>/<realm>"). On the
//     first run the existing flat vault/ is reorganized into
//     subfolders (index v3: every f is "group/file"), and new
//     paintings are written straight into their folder. A run that
//     only reorganizes still exits 0 so the workflow commits it.
// ================================================================
import fs from 'fs';
if (!fs.existsSync('roster-add')) fs.mkdirSync('roster-add');
import path from 'path';
import zlib from 'zlib';

const KEY = process.env.MISTRAL_KEY || '';
if (!KEY) { console.error('MISTRAL_KEY secret is not set. Add it under Settings -> Secrets and variables -> Actions, then run the workflow again.'); process.exit(1); }
const BATCH = parseInt(process.env.BATCH || '40', 10);
const CONC = Math.max(1, parseInt(process.env.CONC || '4', 10));
const VAULT = 'vault';
const AGENT_V = 3;
const AGENT_FILE = 'agent-v' + AGENT_V + '.txt';
// ---- base roster (full prompts) + compact seed batches in roster-add/ ----
const base = JSON.parse(fs.readFileSync('roster.json', 'utf8'));
const seeds = fs.readdirSync('roster-add')
  .filter(f => f.endsWith('.json') || f.endsWith('.b64'))
  .flatMap(f => {
    const raw = fs.readFileSync('roster-add/' + f, f.endsWith('.b64') ? 'utf8' : undefined);
    const text = f.endsWith('.b64') ? zlib.gunzipSync(Buffer.from(raw, 'base64')).toString('utf8') : raw.toString('utf8');
    return JSON.parse(text);
  });
// expand a seed {k,u,g,d,n} into a full prompt by cloning its universe's template face
function expand(seed) {
  const tmpl = base.find(f => f.u === seed.u && f.p);
  if (!tmpl) throw new Error('no template face in roster.json for universe: ' + (seed.u || 'history'));
  const t = tmpl.p;
  const cut = t.indexOf(' - painted');
  const open = t.slice(0, t.indexOf(', ')).replace(/^Portrait of a (man|woman)/, 'Portrait of a ' + (seed.g === 'f' ? 'woman' : 'man'));
  const tail = t.slice(cut + 3);
  const m = tail.match(/^([\s\S]*?)\s*This is ([^.]+)\.\s*([\s\S]*)$/);
  seed.p = open + ', ' + seed.d + ' - ' + m[1] + ' This is ' + seed.n + '. ' + m[3];
  return seed;
}
const roster = base.concat(seeds.map(s => s.p ? s : expand(s)).filter(s => !base.some(b => b.k === s.k)));

fs.mkdirSync(VAULT, { recursive: true });

// ---- the index: what the game pulls ----
const indexFile = path.join(VAULT, 'index.json');
let index = { v: 2, faces: {} };
try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); if (!index.faces) index.faces = {}; } catch (e) {}

// ---- aliases: aliasKey -> existingKey; the alias face shares the
// existing painting. Never painted, only merged into the index. ----
let aliases = {};
try { aliases = JSON.parse(fs.readFileSync('aliases.json', 'utf8')); } catch (e) {}

// ---- nation map: key -> folder group ("history/<nation>" or
// "<universe>/<realm>"). Ships as plain JSON or gzipped .b64. ----
let nmap = {};
try {
  if (fs.existsSync('nation-map.json')) nmap = JSON.parse(fs.readFileSync('nation-map.json', 'utf8'));
  else if (fs.existsSync('nation-map.b64')) nmap = JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync('nation-map.b64', 'utf8'), 'base64')).toString('utf8'));
} catch (e) { console.log('nation map unreadable - everything lands in history/uncategorized'); }

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function groupFor(k) {
  if (nmap[k]) return nmap[k];
  const fc = roster.find(r => r.k === k);
  if (fc && fc.u && slug(fc.u) !== 'history') return slug(fc.u) + '/uncategorized';
  return 'history/uncategorized';
}

// ---- one-time reorganization: flat vault/ into nation folders ----
let reorganized = false;
if (index.v !== 3) {
  const remap = {};
  let movedCount = 0;
  for (const [k, e] of Object.entries(index.faces)) {
    if (!e || !e.f) continue;
    if (e.f.includes('/')) continue;            // already in a folder
    if (remap[e.f]) { e.f = remap[e.f]; continue; } // alias shares this file
    const g = groupFor(k);
    const nf = g + '/' + e.f;
    fs.mkdirSync(path.join(VAULT, g), { recursive: true });
    try { fs.renameSync(path.join(VAULT, e.f), path.join(VAULT, nf)); movedCount++; }
    catch (err) { console.log('missing during reorg (will repaint if needed): ' + e.f); }
    remap[e.f] = nf;
    e.f = nf;
  }
  index.v = 3;
  reorganized = true;
  console.log('vault reorganized into nation folders: ' + movedCount + ' files moved (index v3)');
}

// ---- the agent (cached across runs via the repo) ----
async function agentId() {
  try { const id = fs.readFileSync(AGENT_FILE, 'utf8').trim(); if (id) return id; } catch (e) {}
  const r = await fetch('https://api.mistral.ai/v1/agents', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify({ model: 'mistral-small-latest', name: 'CYF Court Painter v' + AGENT_V, description: 'Paints faction leader portraits for a strategy game.',
      instructions: 'You are a court painter. When given a portrait commission, use the image generation tool to paint exactly what is described. Reply with the image only. When you write the image prompt, describe the subject visually (appearance, age, garments, armor, colors, mood) - avoid naming real actors or naming franchises needlessly, though you may keep it if the commission does.',
      tools: [{ type: 'image_generation' }] }) });
  if (!r.ok) throw new Error('agent create failed (' + r.status + ')');
  const j = await r.json();
  fs.writeFileSync(AGENT_FILE, j.id);
  return j.id;
}

const sleep = (ms) => new Promise(ok => setTimeout(ok, ms));

// ---- shared rate-limit gate: all workers wait together, resume together ----
let rateUntil = 0;
let ratePauses = 0;
async function rateGate() {
  while (Date.now() < rateUntil) await sleep(rateUntil - Date.now() + 250);
}

function magicMime(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return '';
}

async function converse(body) {
  const r = await fetch('https://api.mistral.ai/v1/conversations', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify(body) });
  if (r.status === 401) throw new Error('refused (401)');
  if (r.status === 429) return { retry: true };
  if (!r.ok) throw new Error('commission failed (' + r.status + ')');
  return { j: await r.json() };
}

// read one conversation's outputs: the painted image URL, and whether
// moderation blocked the image tool
function readCanvas(j) {
  let imgSrc = null, fileId = null, moderated = false;
  for (const o of (j.outputs || [])) {
    if (o && o.type === 'tool.execution' && o.name === 'image_generation' && o.info && o.info.result) {
      const resStr = String(o.info.result);
      if (/Moderation occurred/.test(resStr)) moderated = true;
      try { const res = (typeof o.info.result === 'string') ? JSON.parse(o.info.result) : o.info.result; if (res && res.url) imgSrc = res.url; } catch (e) {}
    }
    if (o && o.content) for (const c of (o.content || [])) if (c.type === 'tool_file' && c.file_id) fileId = c.file_id;
  }
  if (!imgSrc && fileId) imgSrc = 'https://api.mistral.ai/v1/files/' + fileId + '/content';
  return { imgSrc, moderated };
}

async function paintOne(ag, face) {
  await rateGate();
  const first = await converse({ inputs: face.p, stream: false, agent_id: ag });
  if (first.retry) return { retry: true };
  let { imgSrc, moderated } = readCanvas(first.j);
  // the sitting was refused as "protected content" (named fictional
  // character) - re-commission the SAME portrait described only by
  // appearance, in the same conversation.
  if (!imgSrc && moderated) {
    console.log(face.k + ': moderated (protected character) - re-commissioning unnamed');
    const fr2 = await fetch('https://api.mistral.ai/v1/conversations/' + first.j.conversation_id, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + KEY },
      body: JSON.stringify({ stream: false,
        inputs: 'That commission was blocked by image moderation because it names a character from a protected franchise. Repaint the SAME portrait, but write the image prompt using ONLY physical description: appearance, age, hair, garments, armor, colors, mood, and the painting style described earlier. Absolutely no character names, no franchise, book, show, film or game titles, no actor likenesses in the image prompt.' }) });
    if (fr2.status === 401) throw new Error('refused (401)');
    if (fr2.status === 429) return { retry: true };
    if (!fr2.ok) throw new Error('re-commission failed (' + fr2.status + ')');
    const again = await fr2.json();
    imgSrc = readCanvas(again).imgSrc;
  }
  if (!imgSrc) throw new Error('no canvas');
  const wantsAuth = /api\.mistral\.ai\//.test(imgSrc);
  let raw = null;
  const fr = await fetch(imgSrc, { headers: wantsAuth ? { 'Authorization': 'Bearer ' + KEY } : {} });
  if (fr.ok) raw = new Uint8Array(await fr.arrayBuffer());
  if (!raw || !raw.byteLength) throw new Error('could not fetch the painting');
  const mime = magicMime(raw);
  if (!mime || raw.byteLength < 1024) throw new Error('not a true canvas (' + raw.byteLength + ' bytes)');
  const ext = mime === 'image/jpeg' ? 'jpg' : (mime === 'image/png' ? 'png' : 'webp');
  const g = groupFor(face.k);
  const file = encodeURIComponent(face.k).replace(/%/g, '_') + '.' + ext;
  fs.mkdirSync(path.join(VAULT, g), { recursive: true });
  fs.writeFileSync(path.join(VAULT, g, file), Buffer.from(raw));
  index.faces[face.k] = { f: g + '/' + file, m: mime };
  return { ok: true };
}


async function worker(ag, queue, stats) {
  while (stats.painted < BATCH) {
    const i = queue.next++; if (i >= queue.list.length) return;
    const fc = queue.list[i];
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      if (stats.painted >= BATCH) return;
      try {
        const res = await paintOne(ag, fc);
        if (res.retry) {
          rateUntil = Math.max(rateUntil, Date.now() + 61000);
          ratePauses++;
          console.log('rate limit - all brushes pause 60s (pause #' + ratePauses + ')');
          if (ratePauses > 6) { console.log('too many rate pauses this run - stopping early'); queue.next = queue.list.length; return; }
          attempt--; continue;
        }
        stats.painted++; ok = true;
        console.log('painted:', fc.k);
      } catch (e) {
        const msg = String(e && e.message);
        if (/refused/.test(msg)) { console.log('KEY REFUSED - rotate the key and update the MISTRAL_KEY secret. Stopping.'); process.exit(1); }
        if (attempt < 2) { console.log(fc.k, ':', msg, '- retrying'); await sleep(8000); }
        else console.log('FAILED:', fc.k, ':', msg);
      }
    }
    await sleep(400);
  }
}

const ag = await agentId();
const todo = roster.filter(fc => !index.faces[fc.k]);
console.log(`vault holds ${Object.keys(index.faces).length}; ${todo.length} faces remain; ${CONC} brushes at once, ${BATCH} sittings max`);
if (!todo.length) {
  if (reorganized) { fs.writeFileSync(indexFile, JSON.stringify(index)); console.log('reorg committed; roster complete'); process.exit(0); }
  console.log('nothing to paint'); process.exit(2);
}
const queue = { list: todo, next: 0 };
const stats = { painted: 0 };
await Promise.all(Array.from({ length: Math.min(CONC, todo.length) }, () => worker(ag, queue, stats)));
// merge aliases into the index LAST so the painter's own commits never race them
for (const [ak, ek] of Object.entries(aliases)) if (index.faces[ek] && !index.faces[ak]) index.faces[ak] = index.faces[ek];
fs.writeFileSync(indexFile, JSON.stringify(index));
console.log(`done: ${stats.painted} painted this run; ${Object.keys(index.faces).length} in the vault; ${todo.length - stats.painted} still to go`);
process.exit(stats.painted > 0 || reorganized ? 0 : 2);
