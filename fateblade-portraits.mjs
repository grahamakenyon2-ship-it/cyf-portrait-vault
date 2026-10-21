#!/usr/bin/env node
// ================================================================
// FATEBLADE PORTRAIT FORGE v1.1 - mints AI-generated non-human
// character portraits (undead, elf, dwarf, orc, ...) for the
// Fateblade canon pool + stockpile. Same pattern as paint.mjs: a
// Mistral agent with the image_generation tool, MISTRAL_KEY from the
// repo secret, queue shipped in the repo so runs are resumable, and
// fateblade/manifest.json kept in lockstep so the Patcher ships
// every minted portrait (license + src recorded for the audit trail).
//
// v1.1 DURABILITY FIX (Oct 21): the 103-portrait run hit the 50-min
// job timeout BEFORE the end-of-script persist() ran, so every
// painting it made died with the ephemeral runner. Now: (a) every
// mint is committed + pushed IMMEDIATELY, (b) a 40-min soft budget
// wraps the run up cleanly so the workflow's commit step always
// runs. A timeout can now only ever cost the single image in flight.
//
// fateblade/portrait-queue.json:
//   { style, queue: [{ name, category, prompt,
//     status: queued | minted | failed, file?, bytes?, error? }] }
//
// exit 0 = minted some - rerun to continue the queue
// exit 1 = nothing minted this run (key refused or all failed) - check the log
// exit 2 = queue empty - the workflow self-disables
// ================================================================
import fs from 'fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const KEY = process.env.MISTRAL_KEY || '';
if (!KEY) { console.error('MISTRAL_KEY secret is not set. Add it under Settings -> Secrets and variables -> Actions, then run the workflow again.'); process.exit(1); }
const LIMIT = parseInt(process.env.LIMIT || '5', 10);
const QUEUE_FILE = 'fateblade/portrait-queue.json';
const MANIFEST = 'fateblade/manifest.json';
const STOCKPILE = 'fateblade/art/stockpile';
const AGENT_FILE = 'agent-fateblade-portraits.txt';
const PAGES = 'https://grahamakenyon2-ship-it.github.io/cyf-portrait-vault/fateblade/';

const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const T0 = Date.now();
const TIME_BUDGET_MS = 40 * 60 * 1000;  // wrap up before the 50-min job timeout can kill us

let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) {}
if (!manifest || !Array.isArray(manifest.files)) { console.error('cannot read ' + MANIFEST + ' - refusing to run'); process.exit(1); }
const mpath = new Map(manifest.files.map(e => [e.path, e]));

let queueDoc = null;
try { queueDoc = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch (e) {}
if (!queueDoc || !Array.isArray(queueDoc.queue)) { console.error('cannot read ' + QUEUE_FILE + ' - refusing to run'); process.exit(1); }
const style = queueDoc.style || '';
const todo = queueDoc.queue.filter(e => (e.status || 'queued') === 'queued' && e.name && e.prompt);
console.log('queue: ' + queueDoc.queue.length + ' entries, ' + todo.length + ' queued');
if (!todo.length) { console.log('PORTRAIT QUEUE EMPTY - every commission is minted or accounted for. Append queued entries to fateblade/portrait-queue.json and re-run.'); process.exit(2); }
const batch = todo.slice(0, LIMIT);

function persist() {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queueDoc, null, 1) + '\n');
  manifest.files = [...mpath.values()];
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}

// DURABILITY: save queue+manifest AND commit+push right now, so a job
// kill can never strand more than the image currently being painted.
function commitNow(label) {
  persist();
  if (!process.env.GITHUB_ACTIONS) return;
  try {
    execSync('git add -A fateblade ' + AGENT_FILE, { stdio: 'pipe' });
    execSync('git commit -m "fateblade: portrait forge mint (' + label + ')"', { stdio: 'pipe' });
    for (let i = 0; i < 3; i++) {
      try { execSync('git push', { stdio: 'pipe' }); return; } catch (e) {}
      try { execSync('git pull --rebase --autostash origin ' + (process.env.GITHUB_REF_NAME || 'main'), { stdio: 'pipe' }); } catch (e) { break; }
    }
    console.log('WARNING: durable push failed after ' + label + ' - changes stay local and ride the next commit');
  } catch (e) { console.log('WARNING: durable commit failed after ' + label + ': ' + e.message); }
}

// ---- the agent (cached across runs via the repo) ----
async function agentId() {
  try { const id = fs.readFileSync(AGENT_FILE, 'utf8').trim(); if (id) return id; } catch (e) {}
  const r = await fetch('https://api.mistral.ai/v1/agents', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify({ model: 'mistral-small-latest', name: 'Fateblade Portrait Forge v1', description: 'Paints non-human character portraits for a dark fantasy card game.',
      instructions: 'You are a court painter. When given a portrait commission, use the image generation tool to paint exactly what is described. Reply with the image only. Describe the subject visually; never name real people or franchises.',
      tools: [{ type: 'image_generation' }] }) });
  if (!r.ok) throw new Error('agent create failed (' + r.status + ')');
  const j = await r.json();
  fs.writeFileSync(AGENT_FILE, j.id);
  return j.id;
}

let rateUntil = 0;
async function rateGate() { while (Date.now() < rateUntil) await sleep(rateUntil - Date.now() + 250); }

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
  return { imgSrc: imgSrc, moderated: moderated };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function paintOne(ag, entry) {
  await rateGate();
  const prompt = 'Paint a portrait commission for a dark fantasy card game. Reply with the image only. Painting style: ' + style + '. Subject: ' + entry.prompt + '.';
  const first = await converse({ inputs: prompt, stream: false, agent_id: ag });
  if (first.retry) return { retry: true };
  const read = readCanvas(first.j);
  const imgSrc = read.imgSrc;
  if (!imgSrc) throw new Error(read.moderated ? 'blocked by moderation - rewrite the prompt to avoid protected characters' : 'no canvas');
  const wantsAuth = /api\.mistral\.ai\//.test(imgSrc);
  const fr = await fetch(imgSrc, { headers: wantsAuth ? { 'Authorization': 'Bearer ' + KEY } : {} });
  if (!fr.ok) throw new Error('could not fetch the painting (' + fr.status + ')');
  const raw = new Uint8Array(await fr.arrayBuffer());
  const mime = magicMime(raw);
  if (!mime || raw.byteLength < 1024) throw new Error('not a true canvas (' + raw.byteLength + ' bytes)');
  const ext = mime === 'image/jpeg' ? 'jpg' : (mime === 'image/png' ? 'png' : 'webp');
  const rel = 'art/stockpile/' + slug(entry.name) + '.' + ext;
  fs.mkdirSync(STOCKPILE, { recursive: true });
  fs.writeFileSync('fateblade/' + rel, Buffer.from(raw));
  entry.status = 'minted';
  entry.file = rel;
  entry.bytes = raw.byteLength;
  mpath.set(rel, { path: rel, sha256: createHash('sha256').update(Buffer.from(raw)).digest('hex'), url: PAGES + rel, license: 'AI-generated', src: 'Mistral image generation' });
  return { ok: true };
}

const ag = await agentId();
let minted = 0, failedCount = 0;
for (const entry of batch) {
  if (Date.now() - T0 > TIME_BUDGET_MS) { console.log('time budget reached - wrapping up cleanly so nothing is stranded'); break; }
  let done = false;
  for (let attempt = 0; attempt < 3 && !done; attempt++) {
    try {
      const res = await paintOne(ag, entry);
      if (res.retry) { rateUntil = Math.max(rateUntil, Date.now() + 61000); console.log('rate limit - pausing 60s'); attempt--; continue; }
      minted++; done = true;
      console.log('minted: ' + entry.name + ' -> fateblade/' + entry.file);
      commitNow(entry.name);
    } catch (e) {
      const msg = String(e && e.message);
      if (/refused/.test(msg)) { console.log('KEY REFUSED - rotate the key and update the MISTRAL_KEY secret. Stopping.'); persist(); process.exit(1); }
      if (attempt < 2) { console.log(entry.name + ': ' + msg + ' - retrying'); await sleep(8000); }
      else { failedCount++; entry.status = 'failed'; entry.error = msg; console.log('FAILED: ' + entry.name + ': ' + msg); }
    }
  }
  await sleep(400);
}
persist();
console.log('minted ' + minted + ', failed ' + failedCount + '; ' + (todo.length - minted) + ' still queued');
if (minted === 0) process.exit(1);
process.exit(0);
