#!/usr/bin/env node
// ================================================================
// FATEBLADE PORTRAIT FORGE v1.2 - mints AI-generated non-human
// character portraits for the Fateblade canon pool + stockpile.
//
// v1.2 FAILSAFE STACK (Oct 21, after the lost 103-run):
// The real root cause was NOT the timeout: the workflow's ONLY save
// point was the end-of-run Commit step, and its `git pull --rebase`
// DIED on a queue-file conflict (a queue push landed mid-run), so
// every minted image was stranded on the ephemeral runner.
// Layer 1: every mint is committed + pushed IMMEDIATELY, in-script.
// Layer 2: push rejection is reconciled CONFLICT-FREE - never rebase;
//          instead fetch remote, JSON-merge queue+manifest into our
//          state (union; minted/failed entries win), reset --soft to
//          the remote tip, recommit, push. No file conflict possible.
// Layer 3: STOP-THE-LINE - if work cannot be saved twice in a row,
//          the run STOPS instead of painting more paid images into
//          a state we cannot save.
// Layer 4: startup sync - merge the remote queue before minting, so
//          a run never starts from a stale queue.
// (Layer 5 lives in the workflow yml: actions/upload-artifact of the
//  art dir on every run - even a total git failure leaves the
//  images downloadable from the run page.)
//
// fateblade/portrait-queue.json:
//   { style, queue: [{ name, category, prompt,
//     status: queued | minted | failed, file?, bytes?, error? }] }
//
// exit 0 = minted some - rerun to continue the queue
// exit 1 = nothing minted this run (key refused or all failed) - check the log
// exit 2 = queue empty - the workflow self-disables
// exit 3 = DURABILITY FAILURE - work could not be saved to the repo; do NOT
//          re-run until git is fixed - check the log
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
const TIME_BUDGET_MS = 40 * 60 * 1000;  // wrap up before the 50-min job timeout
const IN_CI = !!process.env.GITHUB_ACTIONS;
const REF = process.env.GITHUB_REF_NAME || 'main';
let saveBroken = false;  // Layer 3 flag

function sh(cmd) { return execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] }).toString(); }
function trySh(cmd) { try { sh(cmd); return true; } catch (e) { return false; } }

let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) {}
if (!manifest || !Array.isArray(manifest.files)) { console.error('cannot read ' + MANIFEST + ' - refusing to run'); process.exit(1); }
const mpath = new Map(manifest.files.map(e => [e.path, e]));

let queueDoc = null;
try { queueDoc = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); } catch (e) {}
if (!queueDoc || !Array.isArray(queueDoc.queue)) { console.error('cannot read ' + QUEUE_FILE + ' - refusing to run'); process.exit(1); }
const style = queueDoc.style || '';

function persist() {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queueDoc, null, 1) + '\n');
  manifest.files = [...mpath.values()];
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}

// ---- Layer 4: startup sync - merge the REMOTE queue/manifest into ours
// so a run never mints from a stale state. Union by name; a remote
// minted/failed status is authoritative (another run earned it).
function syncFromRemote() {
  if (!IN_CI) return;
  if (!trySh('git fetch origin ' + REF)) { console.log('startup sync: fetch failed (continuing - per-mint saves protect the run)'); return; }
  const originRef = 'origin/' + REF;
  try {
    const rQ = JSON.parse(sh('git show ' + originRef + ':' + QUEUE_FILE));
    const byName = new Map(queueDoc.queue.map(e => [e.name, e]));
    let added = 0, updated = 0;
    for (const re of (rQ.queue || [])) {
      const ours = byName.get(re.name);
      if (!ours) { queueDoc.queue.push(re); byName.set(re.name, re); added++; }
      else if (ours.status === 'queued' && re.status !== 'queued') { Object.assign(ours, re); updated++; }
    }
    const rM = JSON.parse(sh('git show ' + originRef + ':' + MANIFEST));
    const byPath = new Map(rM.files.map(e => [e.path, e]));
    for (const [p, e] of mpath) byPath.set(p, e);
    manifest.files = [...byPath.values()];
    if (rM.version) manifest.version = rM.version;
    persist();
    console.log('startup sync: +' + added + ' remote queue entries merged, ' + updated + ' statuses adopted');
  } catch (e) { console.log('startup sync skipped (' + e.message.slice(0, 120) + ')'); }
}

// ---- Layer 2: conflict-free reconciliation. NEVER rebase (the 103-run
// died on a rebase conflict). Instead: rebuild our commit on top of the
// remote tip with a programmatic JSON merge, so both sides' work lives.
function reconcileAndPush(label) {
  trySh('git rebase --abort');          // clear any half-applied rebase
  trySh('git merge --abort');           // clear any half-applied merge
  sh('git fetch origin ' + REF);
  const originRef = 'origin/' + REF;
  // merge remote queue entries we do not have (e.g. commissions appended mid-run)
  const rQ = JSON.parse(sh('git show ' + originRef + ':' + QUEUE_FILE));
  const byName = new Map(queueDoc.queue.map(e => [e.name, e]));
  for (const re of (rQ.queue || [])) {
    const ours = byName.get(re.name);
    if (!ours) { queueDoc.queue.push(re); byName.set(re.name, re); }
    else if (ours.status === 'queued' && re.status !== 'queued') { Object.assign(ours, re); }
  }
  // merge manifest: remote entries + our new mints win
  const rM = JSON.parse(sh('git show ' + originRef + ':' + MANIFEST));
  const byPath = new Map(rM.files.map(e => [e.path, e]));
  for (const [p, e] of mpath) byPath.set(p, e);
  manifest.files = [...byPath.values()];
  if (rM.version) manifest.version = rM.version;
  // move our branch to the remote tip WITHOUT touching the working tree,
  // then commit our full state (mints + merged queue/manifest) on top
  sh('git reset --soft ' + originRef);
  persist();
  sh('git add -A fateblade ' + AGENT_FILE);
  sh('git commit -m "fateblade: portrait forge mint (' + label + ') [reconciled]"');
  sh('git push');
  console.log('reconciled with remote after push rejection (' + label + ')');
  return true;
}

// ---- Layer 1 + 3: save EVERY mint the moment it exists; if saving
// fails twice in a row, STOP the run - never mint paid images we
// cannot save.
function commitNow(label) {
  persist();
  if (!IN_CI) return true;
  let failures = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      sh('git add -A fateblade ' + AGENT_FILE);
      trySh('git commit -m "fateblade: portrait forge mint (' + label + ')"');
      sh('git push');
      return true;
    } catch (e) {
      failures++;
      if (attempt < 2) {
        console.log('save attempt ' + (attempt + 1) + ' rejected (' + label + ') - reconciling conflict-free');
        try { if (reconcileAndPush(label)) return true; } catch (e2) { console.log('reconcile failed: ' + String(e2.message).slice(0, 160)); }
      }
    }
  }
  saveBroken = true;
  console.log('DURABILITY FAILURE - cannot save work to the repo after ' + failures + ' attempts. STOPPING the run so no more paid commissions are stranded. The minted images are still uploaded as a run artifact - recover them from the run page, then fix git and re-run.');
  return false;
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

syncFromRemote();
let todo = queueDoc.queue.filter(e => (e.status || 'queued') === 'queued' && e.name && e.prompt);
console.log('queue: ' + queueDoc.queue.length + ' entries, ' + todo.length + ' queued');
if (!todo.length) { console.log('PORTRAIT QUEUE EMPTY - every commission is minted or accounted for. Append queued entries to fateblade/portrait-queue.json and re-run.'); process.exit(2); }
const batch = todo.slice(0, LIMIT);

const ag = await agentId();
// Layer 3: save the agent id BEFORE the first mint can fail
commitNow('agent-bootstrap');
let minted = 0, failedCount = 0;
for (const entry of batch) {
  if (saveBroken) { console.log('STOP-THE-LINE: saving is broken - halting before minting ' + entry.name); break; }
  if (Date.now() - T0 > TIME_BUDGET_MS) { console.log('time budget reached - wrapping up cleanly'); break; }
  let done = false;
  for (let attempt = 0; attempt < 3 && !done; attempt++) {
    try {
      const res = await paintOne(ag, entry);
      if (res.retry) { rateUntil = Math.max(rateUntil, Date.now() + 61000); console.log('rate limit - pausing 60s'); attempt--; continue; }
      minted++; done = true;
      console.log('minted: ' + entry.name + ' -> fateblade/' + entry.file);
      if (!commitNow(entry.name)) break;   // stop-the-line inside the retry loop too
    } catch (e) {
      const msg = String(e && e.message);
      if (/refused/.test(msg)) { console.log('KEY REFUSED - rotate the key and update the MISTRAL_KEY secret. Stopping.'); persist(); process.exit(1); }
      if (attempt < 2) { console.log(entry.name + ': ' + msg + ' - retrying'); await sleep(8000); }
      else { failedCount++; entry.status = 'failed'; entry.error = msg; console.log('FAILED: ' + entry.name + ': ' + msg); persist(); }
    }
  }
}
if (saveBroken) process.exit(3);
persist();
console.log('minted ' + minted + ', failed ' + failedCount + '; ' + (todo.length - minted) + ' still queued');
if (minted === 0) process.exit(1);
process.exit(0);
