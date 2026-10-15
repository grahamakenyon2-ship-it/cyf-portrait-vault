// ================================================================
// THE THEME KEEPER v1 - server-side texture painter for the
// Choose Your Fate THEME VAULT (v242 THE COSTUMED COURT).
// Same pattern as the portrait keeper: runs in GitHub Actions
// with the MISTRAL_KEY secret, paints each theme background
// texture ONCE into themes/<key>/bg.jpg, writes themes/index.json,
// commits, and exits 2 (self-disable) when every texture exists.
// The game fetches themes/<key>/bg.jpg from Pages (cached in
// localStorage as cyf-theme-v1:) and falls back to the token-only
// dress when the vault is empty or unreachable.
// ================================================================
import fs from 'fs';
import path from 'path';

const KEY = process.env.MISTRAL_KEY || '';
if (!KEY) { console.error('MISTRAL_KEY secret is not set.'); process.exit(1); }
const AGENT_FILE = 'agent-theme.txt';
const THEMES_DIR = 'themes';

// ---- the briefs: one background texture per dress ----
// Materials only - no franchises, no characters, nothing moderation can bite.
const BRIEFS = {
  ironhall: 'A seamless full-screen background texture for a dark medieval strategy game interface: weathered aged oak planks and cracked dark leather with faint iron rivet heads, very dark brown-black tones, subtle warm candlelight tint, very low contrast and muted so that light text stays perfectly readable on top, flat even lighting, no objects, no text, no vignette, no bright highlights.',
  inkwash: 'A seamless full-screen background texture for a strategy game interface in the style of traditional Japanese washi rice paper: deep indigo-navy paper fibers with an extremely subtle faint grey sumi-e ink-wash mountain silhouette far in the background, very low contrast, muted and refined, flat even lighting, no text, no objects, no vignette, light text must stay readable on top.',
  starmaps: 'A seamless full-screen background texture for a space opera strategy game interface: very dark navy-black spaceship bridge steel panels with faint panel seams, tiny dim distant stars, and a faint blue signal glow, extremely dark and muted, flat even lighting, no text, no objects, no bright highlights, light text must stay readable on top.',
  dunes: 'A seamless full-screen background texture for a desert planet strategy game interface: very dark sun-baked sand and weathered ochre rock with subtle wind ripples, dark muted brown-amber tones, flat even lighting, low contrast, no text, no objects, no vignette, light text must stay readable on top.'
};

// ---- what the game pulls ----
const INDEX = 'themes/index.json';
function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch (e) { return { v: 1, themes: {} }; }
}
function have(key) {
  const idx = readIndex();
  if (idx.themes && idx.themes[key] && idx.themes[key].bg && fs.existsSync(path.join(THEMES_DIR, idx.themes[key].bg))) return true;
  return fs.existsSync(path.join(THEMES_DIR, key, 'bg.jpg'));
}

// ---- the agent (cached across runs via the repo) ----
async function agentId() {
  try { const id = fs.readFileSync(AGENT_FILE, 'utf8').trim(); if (id) return id; } catch (e) {}
  const r = await fetch('https://api.mistral.ai/v1/agents', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify({ model: 'mistral-small-latest', name: 'CYF Theme Keeper v1', description: 'Paints UI background textures for a strategy game.',
      instructions: 'You are a court decorator. When given a texture commission, use the image generation tool to paint exactly what is described. Reply with the image only. Keep the texture seamless, dark, muted and low-contrast - it sits behind readable text in a game interface.',
      tools: [{ type: 'image_generation' }] }) });
  if (!r.ok) throw new Error('agent create failed (' + r.status + ')');
  const j = await r.json();
  fs.writeFileSync(AGENT_FILE, j.id);
  return j.id;
}

const sleep = (ms) => new Promise(ok => setTimeout(ok, ms));

function magicMime(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return '';
}

function readCanvas(j) {
  let imgSrc = null, fileId = null;
  for (const o of (j.outputs || [])) {
    if (o && o.type === 'tool.execution' && o.name === 'image_generation' && o.info && o.info.result) {
      try { const res = (typeof o.info.result === 'string') ? JSON.parse(o.info.result) : o.info.result; if (res && res.url) imgSrc = res.url; } catch (e) {}
    }
    if (o && o.content) for (const c of (o.content || [])) if (c.type === 'tool_file' && c.file_id) fileId = c.file_id;
  }
  if (!imgSrc && fileId) imgSrc = 'https://api.mistral.ai/v1/files/' + fileId + '/content';
  return imgSrc;
}

async function paintOne(ag, key, prompt) {
  const r = await fetch('https://api.mistral.ai/v1/conversations', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify({ inputs: prompt, stream: false, agent_id: ag }) });
  if (r.status === 401) throw new Error('refused (401)');
  if (r.status === 429) { console.log(key + ': rate-limited - pausing 30s'); await sleep(30000); return paintOne(ag, key, prompt); }
  if (!r.ok) throw new Error('commission failed (' + r.status + ')');
  const j = await r.json();
  const imgSrc = readCanvas(j);
  if (!imgSrc) throw new Error('no canvas');
  const wantsAuth = /api\.mistral\.ai\/.test(imgSrc);
  const fr = await fetch(imgSrc, { headers: wantsAuth ? { Authorization: 'Bearer ' + KEY } : {} });
  const raw = fr.ok ? new Uint8Array(await fr.arrayBuffer()) : null;
  if (!raw || !raw.byteLength) throw new Error('could not fetch the texture');
  const mime = magicMime(raw);
  if (!mime || raw.byteLength < 1024) throw new Error('not a true canvas (' + raw.byteLength + ' bytes)');
  const ext = mime === 'image/jpeg' ? 'jpg' : (mime === 'image/png' ? 'png' : 'webp');
  fs.mkdirSync(path.join(THEMES_DIR, key), { recursive: true });
  const file = key + '/bg.' + ext;
  fs.writeFileSync(path.join(THEMES_DIR, file), Buffer.from(raw));
  const idx = readIndex();
  idx.themes = idx.themes || {};
  idx.themes[key] = { name: key, bg: file, m: mime, bytes: raw.byteLength };
  fs.writeFileSync(INDEX, JSON.stringify(idx, null, 1));
  console.log(key + ': painted ' + file + ' (' + raw.byteLength + ' bytes)');
}

// ---- the run ----
const todo = Object.keys(BRIEFS).filter(k => !have(k));
if (!todo.length) { console.log('THEME VAULT COMPLETE - every dress has its texture.'); process.exit(2); }
const ag = await agentId();
let painted = 0, failed = 0;
for (const k of todo) {
  try { await paintOne(ag, k, BRIEFS[k]); painted++; }
  catch (e) { console.log(k + ': FAILED - ' + e.message); failed++; }
  await sleep(2000);
}
console.log('painted ' + painted + ', failed ' + failed);
process.exit(failed && !painted ? 1 : 0);
