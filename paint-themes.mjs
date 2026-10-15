// ================================================================
// THE THEME KEEPER v4 - server-side texture painter for the
// Choose Your Fate THEME VAULT (v242 THE COSTUMED COURT, v243 THE
// FULL WARDROBE, v244 THE CROWN'S OWN DRESS). Same pattern as the
// portrait keeper: runs in GitHub Actions with the MISTRAL_KEY
// secret, paints each theme's textures ONCE into themes/<key>/,
// writes themes/index.json, commits, and exits 2 (self-disable)
// when every texture exists. The game fetches these over Pages
// (cached in localStorage as cyf-theme-v1:) and falls back to the
// token-only dress when the vault is empty or unreachable.
// v4: EVERY dress is a FULL dress - the 37 v244 realm/leader dresses
// gained their own 9-slice panel frame and button face over the bg
// sheets (47 keys x 3 assets). No regexes.
// ================================================================
import fs from 'fs';
import path from 'path';

const KEY = process.env.MISTRAL_KEY || '';
if (!KEY) { console.error('MISTRAL_KEY secret is not set.'); process.exit(1); }
const AGENT_FILE = 'agent-theme.txt';
const THEMES_DIR = 'themes';

// ---- the briefs: materials only - no franchises, no characters,
// nothing moderation can bite. Every texture must be DARK, MUTED and
// LOW-CONTRAST: it sits behind readable game text.
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

// ---- v244: THE CROWN'S OWN DRESS - 37 full dresses (bg + frame + face) ----
// ASOIAF Great Houses
briefs('stark',
  'The frozen North: dark granite stone and hard-packed snow, a single pale weirwood-white bark streak, cold blue-grey, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark grey granite frame with pale bone-white inlay corners.',
  'Cold grey stone plaque with a faint white-frost edge.');
briefs('lannister',
  'A crimson and gold medieval hall: dark red stone walls with faint gold-leaf arabesque, candle-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark red stone frame with gold-leaf corner mounts.',
  'Deep crimson lacquer plaque with a gold edge.');
briefs('baratheon',
  'A storm-dark great hall: black basalt walls with a single hammered gold stag-horn motif, storm light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Black basalt frame with hammered gold corner brackets.',
  'Black stone plaque with a hammered gold rim.');
briefs('targaryen',
  'Black dragonfire: dark obsidian and blackened steel with thin veins of ember-red, smoke haze, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Blackened steel frame with thin ember-red seams.',
  'Dark obsidian plaque with a faint ember-red edge.');
briefs('greyjoy',
  'The Iron Islands: dark salt-bleached driftwood and wet black rock over a cold green sea haze, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark salt-bleached driftwood frame with iron corner rivets.',
  'Wet dark wood plaque with rough iron trim.');
briefs('martell',
  'A desert palace at dusk: dark sandstone towers with a faint orange sun-disc motif and a warm wind, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark sandstone frame with copper sun-disc corner mounts.',
  'Warm sandstone plaque with a burnished copper rim.');
briefs('tyrell',
  'A garden castle by night: dark ivy and hedgerow stone with faint harvest-gold tracery, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark hedgerow-stone frame with brass vine-work corners.',
  'Dark ivy-green plaque with a brass edge.');
briefs('arryn',
  'A castle above the clouds: pale wind-scoured stone and blue-white cloudlight, airy but extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Pale moonstone frame with a thin sky-blue line.',
  'Wind-scoured pale stone plaque with a faint blue rim.');
briefs('tully',
  'A riverside castle: dark wet blue-grey stone with a faint red-trout heraldic line and river mist, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark wet blue-grey river-stone frame with a muted red heraldic line inlay.',
  'Blue-grey river stone plaque with a muted red edge.');
briefs('nightswatch',
  'The black keep on the ice Wall: pitch-black stone with faint white frost rime, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Pitch-black iron frame with faint white frost etching.',
  'Black iron plaque with a thin white-frost rim.');
// Historical crowns
briefs('rome',
  'The Roman Forum at dusk: dark travertine marble with faint laurel wreath etchings and a crimson awning glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark travertine frame with laurel-wreath border etching.',
  'Dark bronze plaque with a worn classical sheen.');
briefs('egypt',
  'A painted tomb hall: dark sandstone with faint hieroglyphic registers, a whisper of lapis blue and gold leaf, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark sandstone frame with hieroglyphic-register edging and gold leaf lines.',
  'Dark lapis-blue plaque with a gold rim.');
briefs('byzantium',
  'A Byzantine palace: dark Tyrian-purple porphyry with faint gold mosaic tesserae and incense haze, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark porphyry frame with gold mosaic-tessera edging.',
  'Deep purple lacquer plaque with a gold rim.');
briefs('steppe',
  'The yurt of a khan: dark horsehide and felt walls with faint gilt fittings and steppe-wind dust, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark felt-and-horsehide frame with gilt corner fittings.',
  'Dark saddle-leather plaque with a gilt edge.');
briefs('ottoman',
  'The Topkapi at dusk: dark Iznik-tiled panels with teal and gold arabesque, warm lantern light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Iznik tile frame with a teal arabesque border.',
  'Dark teal tile plaque with a thin gold edge.');
briefs('chinaimperial',
  'A Ming great hall: dark vermillion-lacquered pillars with faint gold cloud-dragon tracery, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark vermillion lacquer frame with a gold cloud-line border.',
  'Black lacquer plaque with a gold rim.');
briefs('persia',
  'A Persian palace hall: dark turquoise tilework with faint gold lion-and-sun ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark turquoise tile frame with gold lion-and-sun corner ornament.',
  'Dark turquoise tile plaque with a gold edge.');
briefs('aztec',
  'The Templo Mayor at night: dark obsidian and jade with faint turquoise feather-work ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark obsidian frame with jade corner inlay.',
  'Black obsidian plaque with a jade rim.');
briefs('norse',
  'A Viking mead hall: dark rune-carved oak and cold North-Sea grey with faint whale-oil lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark rune-carved oak frame with iron corner brackets.',
  'Dark carved oak plaque with an iron rim.');
briefs('bourbon',
  'A hall of mirrors at Versailles by candlelight: deep bleu-de-France silk walls with faint gilt ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark giltwood frame with a bleu-de-France silk border.',
  'Deep navy silk plaque with faint gilt edging.');
briefs('britannia',
  'An Admiralty boardroom: dark navy panelling and ship oak with faint signal-red rope lines and brass, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark navy-oak frame with brass corner rope lines.',
  'Dark gun-deck oak plaque with a brass rim.');
briefs('prussia',
  'A Prussian parade square at dusk: dark polished black-and-white stone with faint white discipline lines, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Polished black stone frame with white discipline lines.',
  'Black-and-white marble plaque with a steel edge.');
briefs('muscovy',
  'The Kremlin terem: dark icon-green and oxblood walls with faint gold icon haloes, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark icon-green frame with gold halo-pattern corner mounts.',
  'Dark oxblood lacquer plaque with a gold rim.');
briefs('spain',
  'The Escorial by candlelight: dark escorial stone with faint black-and-gold Burgundy-cross banners, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark escorial stone frame with black-and-gold Burgundy-cross edging.',
  'Dark leather plaque with black-and-gold trim.');
briefs('mughal',
  'A Mughal durbar hall: dark marble pietra-dura inlay with faint peacock-teal and gold floral ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark marble pietra-dura frame with peacock-teal and gold floral border.',
  'Dark marble plaque with a teal-and-gold edge.');
briefs('mali',
  'A Sahel palace: dark carved hardwood with faint gold-dust inlay and desert-haze warmth, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark carved hardwood frame with gold-dust inlay corners.',
  'Dark polished hardwood plaque with a gold rim.');
briefs('sparta',
  'A Spartan barracks hall: dark blackened bronze and stone with a single crimson cloak-cloth band, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Blackened bronze frame with a single crimson band border.',
  'Dark blackened bronze plaque with a crimson edge.');
// Extended powers
briefs('mordor',
  'A dark tower hall: black ash and riveted iron with faint ember-red furnace glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Riveted black iron frame with faint ember-red furnace seams.',
  'Black iron plaque with a faint ember rim.');
briefs('gondor',
  'A white-stone citadel at dusk: pale silvered walls with a faint white-tree motif on deep indigo, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Pale white-stone frame with a silver tree-line inlay.',
  'Pale silvered stone plaque with a deep indigo rim.');
briefs('galacticemp',
  'A star destroyer bridge: dark gunmetal panels with faint black uniform-cloth texture and a cold grey glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark gunmetal frame with black uniform-cloth trim.',
  'Grey steel plaque with a black edge.');
briefs('federation',
  'A starship ready room: dark clean blue panels with faint white starfield and a hopeful cold glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark clean blue frame with a thin white starline border.',
  'Blue composite plaque with a white rim.');
briefs('nilfgaard',
  'A black-marble imperial hall with a faint golden sun-disc motif, cold candle glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Black marble frame with a gold sun-disc corner ornament.',
  'Black marble plaque with a gold rim.');
briefs('atreides',
  'A sea-cliff castle hall: dark green silk banners with a faint black-hawk motif and cold ocean light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark green silk-draped frame with a black hawk-crest corner mount.',
  'Dark green plaque with a black edge.');
briefs('harkonnen',
  'A brutalist black hall: pitch-black industrial stone with faint pale bone-grey veins and a sickly cold glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Black industrial frame with pale bone-grey veining.',
  'Pitch-black plaque with a pale grey rim.');
briefs('imperium40k',
  'A gothic cathedral-forge: dark blackened stone with faint skull-gold ornament and censer smoke, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Gothic blackened-stone frame with gold ornament edging.',
  'Blackened iron plaque with a gold rim.');
briefs('klingon',
  'A Klingon great hall: dark ridged metal with faint deep-red blade-glow and battle-standard drapery, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark ridged metal frame with deep-red blade trim.',
  'Dark ridged metal plaque with a deep-red edge.');
// The sovereign's own dress
briefs('napoleonic',
  'The Emperor\'s field tent: dark imperial-green wool drapery with faint gold bee-and-eagle ornament and warm candle glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark imperial-green frame with gold bee-and-eagle corner ornaments.',
  'Dark imperial-green plaque with a gold rim.');

// ---- what the game pulls ----
const INDEX = 'themes/index.json';
function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch (e) { return { v: 2, themes: {} }; }
}
function have(key, assets) {
  const idx = readIndex();
  const t = idx.themes && idx.themes[key];
  return assets.every(a => t && t[a] && t[a].f && fs.existsSync(path.join(THEMES_DIR, t[a].f)));
}

// ---- the agent (cached across runs via the repo) ----
async function agentId() {
  try { const id = fs.readFileSync(AGENT_FILE, 'utf8').trim(); if (id) return id; } catch (e) {}
  const r = await fetch('https://api.mistral.ai/v1/agents', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify({ model: 'mistral-small-latest', name: 'CYF Theme Keeper v4', description: 'Paints UI background and frame textures for a strategy game.',
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
// every dress carries bg + 9-slice panel + 9-slice button.
const FULL = ["ironhall","inkwash","starmaps","dunes","tamriel","teyvat","roshar","antiquity","regency","modern","stark","lannister","baratheon","targaryen","greyjoy","martell","tyrell","arryn","tully","nightswatch","rome","egypt","byzantium","steppe","ottoman","chinaimperial","persia","aztec","norse","bourbon","britannia","prussia","muscovy","spain","mughal","mali","sparta","mordor","gondor","galacticemp","federation","nilfgaard","atreides","harkonnen","imperium40k","klingon","napoleonic"];
const todo = [];
for (const k of FULL) {
  if (have(k, ['bg', 'panel', 'btn'])) continue;
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
