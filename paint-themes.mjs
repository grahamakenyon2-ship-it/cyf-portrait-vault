// ================================================================
// THE THEME KEEPER v2 - server-side texture painter for the
// Choose Your Fate THEME VAULT (v242 THE COSTUMED COURT, v243 THE
// FULL WARDROBE). Same pattern as the portrait keeper: runs in
// GitHub Actions with the MISTRAL_KEY secret, paints each theme's
// three textures ONCE (bg.jpg full-screen sheet, panel.jpg 9-slice
// panel frame, btn.jpg 9-slice button face) into themes/<key>/,
// writes themes/index.json, commits, and exits 2 (self-disable)
// when every texture exists. The game fetches these over Pages
// (cached in localStorage as cyf-theme-v1:) and falls back to the
// token-only dress when the vault is empty or unreachable.
// v2: 10 themes x 3 assets, no regexes (indexOf checks only).
// ================================================================
import fs from 'fs';
import path from 'path';

const KEY = process.env.MISTRAL_KEY || '';
if (!KEY) { console.error('MISTRAL_KEY secret is not set.'); process.exit(1); }
const AGENT_FILE = 'agent-theme.txt';
const THEMES_DIR = 'themes';

// ---- the briefs: one full-screen sheet, one 9-slice panel frame and
// one 9-slice button face per dress. Materials only - no franchises,
// no characters, nothing moderation can bite. Every texture must be
// DARK, MUTED and LOW-CONTRAST: it sits behind readable game text.
const BRIEFS = {};
function briefs(key, sheet, panel, btn) {
  BRIEFS[key + '/bg'] = 'A seamless full-screen background texture for a strategy game interface. ' + sheet;
  BRIEFS[key + '/panel'] = 'A square 9-slice UI panel frame texture for a strategy game interface: a simple ornamental border decoration occupying ONLY the outer 12 percent of the square, with a completely plain very dark center (the center is covered by game content). ' + panel + ' Dark, muted, low-contrast, flat even lighting, no text, no objects, no vignette.';
  BRIEFS[key + '/btn'] = 'A square 9-slice UI button face texture for a strategy game interface: a flat plaque face filling the whole square with subtle beveled edges, uniform and tileable so it stretches cleanly. ' + btn + ' Dark, muted, low-contrast, flat even lighting, absolutely no text, no letters, no icons in the center.';
}
briefs('ironhall',
  'Weathered aged oak planks and cracked dark leather with faint iron rivet heads, very dark brown-black tones, subtle warm candlelight tint, flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Carved dark oak with iron corner brackets and rivets.',
  'Forged dark iron plaque with a warm candlelit sheen.');
briefs('inkwash',
  'Traditional Japanese washi rice paper: deep indigo-navy paper fibers with an extremely subtle faint grey sumi-e ink-wash mountain silhouette far in the background, muted and refined, flat even lighting, no text, no vignette.',
  'Dark indigo lacquer frame with a thin gold leaf line.',
  'Dark indigo lacquer seal-plaque with a vermilion edge.');
briefs('starmaps',
  'Space opera bridge steel: very dark navy-black panels with faint seams, tiny dim distant stars, a faint blue signal glow, extremely dark and muted, flat even lighting, no text, no objects, no bright highlights.',
  'Dark holo-steel frame with a thin cyan signal line.',
  'Gunmetal console key face with a faint blue rim glow.');
briefs('dunes',
  'Desert planet: very dark sun-baked sand and weathered ochre rock with subtle wind ripples, dark muted brown-amber tones, flat even lighting, low contrast, no text, no objects, no vignette.',
  'Weathered ochre stone frame with brass inlay corners.',
  'Aged brass plaque with sun-bleached patina.');
briefs('tamriel',
  'Ancient carved stone hall: very dark grey-brown stone blocks with faint chisel marks and old bronze accents, very dark and muted, flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Carved dark stone frame with bronze corner mounts.',
  'Aged bronze plaque with a soft stone-grey patina.');
briefs('teyvat',
  'Soft fantasy dusk sky: very dark blue-violet with a faint suggestion of distant clouds and starlight, gentle and airy but very dark and muted, flat even lighting, no text, no objects, no vignette.',
  'Dark blue-violet frame with a soft gold filigree line.',
  'Smooth dark blue-grey plaque with a soft golden rim.');
briefs('roshar',
  'Storm slate: very dark blue-grey storm stone with faint chasm-fissure lines and a subtle pale blue glow, extremely dark and muted, flat even lighting, no text, no objects, no bright highlights.',
  'Dark blue-grey stormstone frame with glowing hairline seams.',
  'Dark slate plaque with a faint stormlight-blue rim.');
briefs('antiquity',
  'Ancient world: very dark aged marble with faint veining and warm bronze light, dark muted parchment-brown tones, flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Aged dark marble frame with simple laurel-border etching.',
  'Dark bronze plaque with a worn classical sheen.');
briefs('regency',
  'Early modern study: very dark navy vellum with faint ink-stain clouds and a hint of gilt, extremely dark and muted, flat even lighting, no text, no objects, no vignette.',
  'Dark vellum-and-mahogany frame with a thin gilt line.',
  'Dark oxblood leather plaque with faint gilt edging.');
briefs('modern',
  'Industrial age: very dark gunmetal with faint wire-grain and a cold blue window light, extremely dark and muted, flat even lighting, no text, no objects, no bright highlights.',
  'Riveted dark gunmetal frame with a thin steel line.',
  'Dark brushed-steel plate with a faint blue rim.');

// ---- what the game pulls ----
const INDEX = 'themes/index.json';
function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch (e) { return { v: 2, themes: {} }; }
}
function have(key) {
  const idx = readIndex();
  const t = idx.themes && idx.themes[key];
  const want = ['bg', 'panel', 'btn'];
  return want.every(a => t && t[a] && t[a].f && fs.existsSync(path.join(THEMES_DIR, t[a].f)));
}

// ---- the agent (cached across runs via the repo) ----
async function agentId() {
  try { const id = fs.readFileSync(AGENT_FILE, 'utf8').trim(); if (id) return id; } catch (e) {}
  const r = await fetch('https://api.mistral.ai/v1/agents', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify({ model: 'mistral-small-latest', name: 'CYF Theme Keeper v2', description: 'Paints UI background and frame textures for a strategy game.',
      instructions: 'You are a court decorator. When given a texture commission, use the image generation tool to paint exactly what is described. Reply with the image only. Keep every texture seamless, dark, muted and low-contrast - it sits behind readable text in a game interface. Never paint letters, words or icons.',
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

async function paintOne(ag, spec, prompt) {
  const key = spec[0], asset = spec[1];
  const r = await fetch('https://api.mistral.ai/v1/conversations', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify({ inputs: prompt, stream: false, agent_id: ag }) });
  if (r.status === 401) throw new Error('refused (401)');
  if (r.status === 429) { console.log(key + '/' + asset + ': rate-limited - pausing 30s'); await sleep(30000); return paintOne(ag, spec, prompt); }
  if (!r.ok) throw new Error('commission failed (' + r.status + ')');
  const j = await r.json();
  const imgSrc = readCanvas(j);
  if (!imgSrc) throw new Error('no canvas');
  const wantsAuth = imgSrc.indexOf('api.mistral.ai/') >= 0;   // plain check: no regex pitfalls
  const fr = await fetch(imgSrc, { headers: wantsAuth ? { Authorization: 'Bearer ' + KEY } : {} });
  const raw = fr.ok ? new Uint8Array(await fr.arrayBuffer()) : null;
  if (!raw || !raw.byteLength) throw new Error('could not fetch the texture');
  const mime = magicMime(raw);
  if (!mime || raw.byteLength < 1024) throw new Error('not a true canvas (' + raw.byteLength + ' bytes)');
  const ext = mime === 'image/jpeg' ? 'jpg' : (mime === 'image/png' ? 'png' : 'webp');
  fs.mkdirSync(path.join(THEMES_DIR, key), { recursive: true });
  const file = key + '/' + asset + '.' + ext;
  fs.writeFileSync(path.join(THEMES_DIR, file), Buffer.from(raw));
  const idx = readIndex();
  idx.themes = idx.themes || {};
  idx.themes[key] = idx.themes[key] || { name: key };
  idx.themes[key][asset] = { f: file, m: mime, bytes: raw.byteLength };
  fs.writeFileSync(INDEX, JSON.stringify(idx, null, 1));
  console.log(key + '/' + asset + ': painted ' + file + ' (' + raw.byteLength + ' bytes)');
}

// ---- the run: paint what is missing, one theme at a time ----
const ALL = ['ironhall', 'inkwash', 'starmaps', 'dunes', 'tamriel', 'teyvat', 'roshar', 'antiquity', 'regency', 'modern'];
const todo = [];
for (const k of ALL) {
  if (have(k)) continue;
  for (const a of ['bg', 'panel', 'btn']) {
    const idx = readIndex();
    const t = idx.themes && idx.themes[k];
    if (t && t[a] && t[a].f && fs.existsSync(path.join(THEMES_DIR, t[a].f))) continue;
    if (fs.existsSync(path.join(THEMES_DIR, k, a + '.jpg'))) continue;
    todo.push([k, a, BRIEFS[k + '/' + a]]);
  }
}
if (!todo.length) { console.log('THEME VAULT COMPLETE - every dress has its sheet, frame and face.'); process.exit(2); }
const ag = await agentId();
let painted = 0, failed = 0;
for (const spec of todo) {
  try { await paintOne(ag, spec, spec[2]); painted++; }
  catch (e) { console.log(spec[0] + '/' + spec[1] + ': FAILED - ' + e.message); failed++; }
  await sleep(2000);
}
console.log('painted ' + painted + ', failed ' + failed);
process.exit(failed && !painted ? 1 : 0);
