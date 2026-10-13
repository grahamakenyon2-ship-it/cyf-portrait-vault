// ================================================================
// THE PORTRAIT KEEPER v2 (fast) - server-side batch painter for the
// Choose Your Fate portrait vault. Runs in GitHub Actions; paints the
// faces not yet in vault/, commits them, Pages serves them to the
// game. Nothing is painted twice.
// v2: CONCURRENT sittings (default 4 at once), bigger batches, and a
// shared rate-limit pause - the fast lane, still gentle on the limit.
// ================================================================
import fs from 'fs';
import path from 'path';

const KEY = process.env.MISTRAL_KEY || 'mstrl_muijjVs3uYWuzgcVdAr1xBaFEtRhJavC_2fLYgR';
const BATCH = parseInt(process.env.BATCH || '40', 10);            // sittings per run
const CONC = Math.max(1, parseInt(process.env.CONC || '4', 10)); // at once
const VAULT = 'vault';
const roster = JSON.parse(fs.readFileSync('roster.json', 'utf8'));

fs.mkdirSync(VAULT, { recursive: true });

// ---- the index: what the game pulls ----
const indexFile = path.join(VAULT, 'index.json');
let index = { v: 2, faces: {} };
try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')); if (!index.faces) index.faces = {}; } catch (e) {}

// ---- the agent (cached across runs via the repo) ----
async function agentId() {
  try { const id = fs.readFileSync('agent-id.txt', 'utf8').trim(); if (id) return id; } catch (e) {}
  const r = await fetch('https://api.mistral.ai/v1/agents', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify({ model: 'mistral-small-latest', name: 'CYF Court Painter', description: 'Paints faction leader portraits for a strategy game.',
      instructions: 'You are a court painter. When given a portrait commission, use the image generation tool to paint exactly what is described. Reply with the image only.',
      tools: [{ type: 'image_generation' }] }) });
  if (!r.ok) throw new Error('agent create failed (' + r.status + ')');
  const j = await r.json();
  fs.writeFileSync('agent-id.txt', j.id);
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

async function paintOne(ag, face) {
  await rateGate();
  const r = await fetch('https://api.mistral.ai/v1/conversations', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify({ inputs: face.p, stream: false, agent_id: ag }) });
  if (r.status === 401) throw new Error('refused (401)');
  if (r.status === 429) return { retry: true };
  if (!r.ok) throw new Error('commission failed (' + r.status + ')');
  const j = await r.json();
  let imgSrc = null, fileId = null;
  for (const o of (j.outputs || [])) {
    if (o && o.type === 'tool.execution' && o.name === 'image_generation' && o.info && o.info.result) {
      try { const res = (typeof o.info.result === 'string') ? JSON.parse(o.info.result) : o.info.result; if (res && res.url) imgSrc = res.url; } catch (e) {}
    }
    if (o && o.content) for (const c of (o.content || [])) if (c.type === 'tool_file' && c.file_id) fileId = c.file_id;
  }
  if (!imgSrc && fileId) imgSrc = 'https://api.mistral.ai/v1/files/' + fileId + '/content';
  if (!imgSrc) throw new Error('no canvas');
  const wantsAuth = /api\.mistral\.ai\//.test(imgSrc);
  let raw = null;
  const fr = await fetch(imgSrc, { headers: wantsAuth ? { 'Authorization': 'Bearer ' + KEY } : {} });
  if (fr.ok) raw = new Uint8Array(await fr.arrayBuffer());
  if (!raw || !raw.byteLength) throw new Error('could not fetch the painting');
  const mime = magicMime(raw);
  if (!mime || raw.byteLength < 1024) throw new Error('not a true canvas (' + raw.byteLength + ' bytes)');
  const ext = mime === 'image/jpeg' ? 'jpg' : (mime === 'image/png' ? 'png' : 'webp');
  const file = encodeURIComponent(face.k).replace(/%/g, '_') + '.' + ext;
  fs.writeFileSync(path.join(VAULT, file), Buffer.from(raw));
  index.faces[face.k] = { f: file, m: mime };
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
          // the paints are out for this minute: every brush pauses together,
          // and the pause costs this face none of its retries
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
        if (/refused/.test(msg)) { console.log('KEY REFUSED - stopping'); process.exit(1); }
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
const queue = { list: todo, next: 0 };
const stats = { painted: 0 };
await Promise.all(Array.from({ length: Math.min(CONC, todo.length) }, () => worker(ag, queue, stats)));
fs.writeFileSync(indexFile, JSON.stringify(index));
console.log(`done: ${stats.painted} painted this run; ${Object.keys(index.faces).length} in the vault; ${todo.length - stats.painted} still to go`);
process.exit(stats.painted > 0 ? 0 : 2);
