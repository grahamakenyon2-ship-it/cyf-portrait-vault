// ================================================================
// THE THEME KEEPER v7 - server-side texture painter for the
// Choose Your Fate THEME VAULT (v242 THE COSTUMED COURT, v243 THE
// FULL WARDROBE, v244 THE CROWN'S OWN DRESS, v245 THE HUNDRED
// BANNERS, v247 THE LAST COURTS). Same pattern as the
// portrait keeper: runs in GitHub Actions with the MISTRAL_KEY
// secret, paints each theme's textures ONCE into themes/<key>/,
// writes themes/index.json, commits, and exits 2 (self-disable)
// when every texture exists. The game fetches these over Pages
// (cached in localStorage as cyf-theme-v1:) and falls back to the
// token-only dress when the vault is empty or unreachable.
// v5: 71 new nation dresses from v245 (118 keys x 3 assets).
// v6: 116 new nation dresses from v247 THE LAST COURTS (234 keys x 3 assets).
// v7: moderation recovery + hardened agent (image prompts free of proper nouns,
// fresh agent-theme-v2.txt cache), bounded rate-limit retries, 2.5h run budget
// (re-run to continue), failure diagnostics committed to themes/failures.txt.
// Fixes run #2 (61 min, 0/287 painted, every commission image-less) while the
// hardened portrait keeper kept painting through the same window.
// v4: EVERY dress is a FULL dress - the 37 v244 realm/leader dresses
// gained their own 9-slice panel frame and button face over the bg
// sheets (47 keys x 3 assets). No regexes.
// ================================================================
import fs from 'fs';
import path from 'path';

const KEY = process.env.MISTRAL_KEY || '';
if (!KEY) { console.error('MISTRAL_KEY secret is not set.'); process.exit(1); }
const AGENT_FILE = 'agent-theme-v2.txt';
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
// ---- v245: THE HUNDRED BANNERS - 71 new nation dresses ----
briefs('braavos',
  'The canals of Braavos at night: dark sea-green water-stone and bronze fittings with faint titan-bronze gleam and fog, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark water-stone frame with bronze corner mounts.',
  'Weathered bronze plaque with a sea-green patina.');
briefs('dothraki',
  'The endless grass sea: dark wind-bent grass and horsehide with faint red-dyed leather ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark horsehide frame with red-dyed leather corners.',
  'Dark leather plaque with a red-painted rim.');
briefs('qarth',
  'A Qartheen palace: dark jade-stone and silk-draped halls with faint gold-and-ivory tracery, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark jade-stone frame with gold silk corners.',
  'Jade lacquer plaque with a gold rim.');
briefs('asshai',
  'Asshai by the Shadow: pitch-black oily stone with faint ember-red and violet shadow-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Black basalt frame with faint violet-veined corners.',
  'Black lacquer plaque with a violet rim.');
briefs('rohan',
  'A golden thatched hall on the plains: dark ash-wood and horse-hide banners with faint gold horse-head ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark ash-wood frame with gold horse-head corner mounts.',
  'Carved ash plaque with a gold rim.');
briefs('shire',
  'A green hillside country at dusk: dark rolling hills and round oak doors with faint warm lamplight and garden gold, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark oak frame with green copper corner mounts.',
  'Round-edged oak plaque with a copper rim.');
briefs('isengard',
  'A ring of dark iron: dark fused iron and blasted stone with faint smoking-pit ember glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark riveted iron frame with scorched-stone corners.',
  'Iron plaque with a scorched rim.');
briefs('elven',
  'A haven of the elves at dusk: pale silvered mallorn-bark and white stone with faint gold-leaf starlight, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Pale silvered frame with a thin gold mallorn line.',
  'White-stone plaque with a silver rim.');
briefs('erebor',
  'Halls under the mountain: dark carved granite and dwarf-gold with faint forge-fire glow and runic lines, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark carved granite frame with gold corner mounts.',
  'Dwarf-forged plaque with a gold rim.');
briefs('numenor',
  'A white tower over the western sea: pale sea-stone and white-gold with a faint silver star emblem and ocean haze, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Pale sea-stone frame with white-gold corner mounts.',
  'White-gold plaque with a sea-blue rim.');
briefs('harad',
  'A southern war-camp palace: dark desert sandstone and crimson banners with faint serpent-gold ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark sandstone frame with crimson-dyed leather corners.',
  'Crimson leather plaque with a brass rim.');
briefs('temeria',
  'A northern keep: dark storm-blue stone and weathered oak with faint silver lily-and-sash ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark storm-stone frame with silver corner mounts.',
  'Weathered oak plaque with a silver rim.');
briefs('toussaint',
  'A vineyard palace terrace: dark vineyard oak and wine-red silk with faint gold grapevine ornament and sunset warmth, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark giltwood frame with wine-red silk corners.',
  'Wine-dark lacquer plaque with a gold rim.');
briefs('andor',
  'A royal palace of rose-red stone: dark carved halls with faint gold rose-and-lion ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark red-stone frame with gold rose corner mounts.',
  'Rose lacquer plaque with a gold rim.');
briefs('tarvalon',
  'The halls of a white tower: pale moonstone-arched halls with faint seven-band gold ornament and a hint of flame, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Pale moonstone frame with a thin seven-band gold line.',
  'White-stone plaque with a gold rim.');
briefs('seanchan',
  'A court of lacquered ebony: dark lacquered halls and crimson silk with faint ivory-and-gold serpent ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark lacquered ebony frame with crimson silk corners.',
  'Ebony lacquer plaque with a crimson rim.');
briefs('mandalorian',
  'A beskar forge-hall: dark gunmetal and hammered silver-steel plates with faint forge-ember glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark gunmetal frame with hammered silver corner plates.',
  'Hammered beskar plaque with a steel rim.');
briefs('hutt',
  'A den of a palace: dark smoke-stained bronze and crumbling sandstone with faint gilded filigree and oil-lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark bronze frame with gilded filigree corners.',
  'Grime-dark bronze plaque with a gold rim.');
briefs('sithempire',
  'A dark citadel: pitch-black obsidian and crimson-lit corridors with faint red blade-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Black obsidian frame with faint red seam lines.',
  'Obsidian plaque with a crimson rim.');
briefs('romulan',
  'A warbird command deck: dark bird-of-prey green panels and bronze rails with a faint green computer glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark green panel frame with bronze corner rails.',
  'Green-grey console plaque with a bronze rim.');
briefs('cardassian',
  'A government hall of scaled panels: dark grey-blue scaled walls with faint purple archival light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark scaled-panel frame with purple-lit edges.',
  'Grey scaled plaque with a purple rim.');
briefs('borg',
  'The interior of a machine cube: pitch-black machine conduits and pale necrotic green light-web, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Black conduit frame with faint green data lines.',
  'Dark machine plaque with a green rim.');
briefs('ferengi',
  'A commerce hall of gilt arches: dark gilt archways and trade-ledger bronze with faint gold latinum glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark gilt frame with trade-ornament corners.',
  'Gold lacquer plaque with a bronze rim.');
briefs('corrino',
  'An imperial throne hall: dark porphyry columns and gilt lion ornament with faint golden salusan-sun light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark porphyry frame with gilt lion corner mounts.',
  'Gilt bronze plaque with a lion-rim trim.');
briefs('fremen',
  'A sietch cavern: dark rock-cut passages and stillsuit leather with faint water-jar ceramic ornament and torchlight, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark rock-cut frame with ceramic corner inlay.',
  'Rock-hewn plaque with a ceramic rim.');
briefs('unsc',
  'A command deck: dark gunmetal and olive-drab panels with faint tactical-blue screen glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark gunmetal frame with olive corner plates.',
  'Olive-drab plaque with a steel rim.');
briefs('covenant',
  'A holy city interior: dark violet alloy and gold inlaid glyphs with faint plasma glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark violet-alloy frame with gold glyph corners.',
  'Violet alloy plaque with a gold rim.');
briefs('forerunner',
  'An ancient installation: pale geometric metal and soft cyan light-bridges, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Pale geometric metal frame with hairline cyan seams.',
  'Pale metal plaque with a cyan rim.');
briefs('skyrim',
  'A nordic mead-hall: dark granite and wolf-pelt drapes with faint carved-steel dragon ornament and snowlight, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark granite frame with carved steel corner mounts.',
  'Carved stone plaque with a steel rim.');
briefs('cyrodiil',
  'An imperial city palace: dark white marble and gold dragon-claw ornament with faint candlelight, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark marble frame with gold dragon-claw corners.',
  'White marble plaque with a gold rim.');
briefs('morrowind',
  'A velothi canton: dark volcanic ash-stone and bonemold resin with faint red mountain glow and spore-haze, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark ash-stone frame with bonemold corner mounts.',
  'Bonemold plaque with an ash-stone rim.');
briefs('hammerfell',
  'A desert redoubt keep: dark red sandstone and curved scimitar-steel with faint desert dusk warmth, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark red sandstone frame with steel corner mounts.',
  'Red sandstone plaque with a steel rim.');
briefs('summerset',
  'High elf marble spires: pale crystal-and-white-stone halls with faint gold constellation ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Pale crystal frame with gold constellation corners.',
  'White crystal plaque with a gold rim.');
briefs('valenwood',
  'A tree-home of woven halls: dark mossy bark and woven green vaults with faint migratory firefly light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark woven-bark frame with moss-green corners.',
  'Woven bark plaque with a green rim.');
briefs('blackmarsh',
  'A root-woven xanmeer: dark swamp-worn stone and root-woven vaults with faint luminous marsh-green glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark root-woven stone frame with luminous corners.',
  'Swamp-stone plaque with a green rim.');
briefs('alethkar',
  'A warcamp pavilion hall: dark blackwood and gold glyph banners with faint stormlight lantern glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark blackwood frame with gold glyph corner mounts.',
  'Blackwood plaque with a gold rim.');
briefs('tau',
  'A fleet corridor of clean panels: pale taupe-white panels with faint ochre caste-mark lines and soft blue tech glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Clean pale panel frame with ochre caste-line edges.',
  'Pale composite plaque with an ochre rim.');
briefs('necron',
  'A tomb world: pitch-black living metal with faint green gauss-script glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Black living-metal frame with green glyph seams.',
  'Black metal plaque with a green rim.');
briefs('chaoswar',
  'A traitor warbarge: dark warped iron and crimson banner-cloth with faint warp-red glow and smoke, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Warped dark iron frame with crimson rune corners.',
  'Warped iron plaque with a crimson rim.');
briefs('orkz',
  'An ork warcamp: rusted scrap-iron and crudely yellow-painted metal with faint red glyph-lamps, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Rusted scrap-iron frame with yellow-painted corners.',
  'Rusted plaque with a yellow-painted rim.');
briefs('aeldari',
  'Wraithbone halls: pale bone-white living-plastic and faint spirit-stone pink glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Pale wraithbone frame with spirit-stone corner gems.',
  'Wraithbone plaque with a pale pink rim.');
briefs('empire',
  'A palace hall of the empire: dark oak and imperial purple banners with faint gold twin-tailed griffon ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark oak frame with purple-gold corner banners.',
  'Purple lacquer plaque with a gold rim.');
briefs('bretonnia',
  'A knightly castle hall: dark heraldic blue stone and red-heraldry banners with faint gold fleur ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark heraldic frame with gold fleur corners.',
  'Heraldic blue plaque with a gold rim.');
briefs('kislev',
  'An ice palace court: dark frost-hewn stone and gold icon corners with faint ice-blue light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark frost-hewn frame with gold icon corners.',
  'Frost-stone plaque with a gold rim.');
briefs('sylvania',
  'A gothic castle hall: pitch-black gothic stone and blood-crimson drapes with faint candle-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Black gothic frame with crimson corner drapes.',
  'Black lacquer plaque with a crimson rim.');
briefs('nehekhara',
  'A necropolis throne hall: dark sandstone columns and hieroglyph gold with faint spectral blue-green glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark sandstone frame with gold hieroglyph corners.',
  'Sandstone plaque with a gold rim.');
briefs('lustria',
  'A temple city in the jungle: dark mossy stone steps and jade glyphs with faint jungle-green glow and mist, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark mossy stone frame with jade glyph corners.',
  'Moss-stone plaque with a jade rim.');
briefs('skaven',
  'A skaven warren: dark gnawed timber and rusted iron with faint warpstone-green lantern glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark gnawed timber frame with warpstone corner gems.',
  'Gnawed timber plaque with a green rim.');
briefs('mondstadt',
  'A windworn cathedral city: dark blue-grey stone and dandelion-gold banners with faint anemo-green breeze glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark blue-grey frame with dandelion-gold corner mounts.',
  'Windworn stone plaque with a gold rim.');
briefs('liyue',
  'A jade-and-gold harbor city: dark amber stone and silk-red lanterns with faint gold amber glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark amber-stone frame with gold corner mounts.',
  'Amber stone plaque with a gold rim.');
briefs('inazuma',
  'A storm-veiled shogunate city: dark violet lacquer and sakura-pink silk with faint electro-violet glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark violet lacquer frame with sakura-silk corners.',
  'Violet lacquer plaque with a pink rim.');
briefs('sumeru',
  'A rainforest academy city: dark carved teak and copper-green domes with faint green glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark carved teak frame with copper corner mounts.',
  'Carved teak plaque with a copper rim.');
briefs('fontaine',
  'A water-clockwork court hall: dark aquamarine glass and brass gears with faint hydro-blue glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark brass frame with aquamarine glass corners.',
  'Brass plaque with an aqua rim.');
briefs('natlan',
  'A volcanic tribal hall: dark obsidian and ember-red lacquer with faint pyro-glow and feather ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark obsidian frame with ember-red corner mounts.',
  'Obsidian plaque with an ember rim.');
briefs('snezhnaya',
  'A frostbound palace: dark ice-blue stone and grey furs with faint cryo-white glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark ice-stone frame with silver corner mounts.',
  'Ice-stone plaque with a silver rim.');
briefs('carthage',
  'A punic harbor city: dark phoenician-purple dye halls and bronze fittings with faint cedar and sea haze, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark purple-dyed frame with bronze corner mounts.',
  'Purple-stained cedar plaque with a bronze rim.');
briefs('hellas',
  'The agora at dusk: dark veined marble columns and bronze armor with faint olive-oil lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark marble frame with bronze corner mounts.',
  'Marble plaque with a bronze rim.');
briefs('caliphate',
  'A caliphal palace hall: dark carved sandstone with green-and-gold geometric arabesque ornament and hanging lamps, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark carved sandstone frame with green-gold arabesque corners.',
  'Carved sandstone plaque with a gold rim.');
briefs('bharat',
  'A carved temple hall: dark red sandstone pillars and gold ornament with faint oil-lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark red sandstone frame with gold temple corner mounts.',
  'Red sandstone plaque with a gold rim.');
briefs('inca',
  'A high-mountain citadel: dark andesite ashlar and gold sun-disc ornament with faint mist and cold glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark andesite frame with gold sun corner mounts.',
  'Ashlar stone plaque with a gold rim.');
briefs('venice',
  'A palazzo on the grand canal: dark venetian-red walls and gilt-framed mirrors with faint canal reflection and lantern glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark giltwood frame with venetian-red corners.',
  'Venetian-red lacquer plaque with a gold rim.');
briefs('papal',
  'A vatican hall: pale white marble and gold ornament with crimson cardinal drapes and candle glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Pale marble frame with gold corner mounts.',
  'White marble plaque with a gold rim.');
briefs('dutch',
  'A merchant hall of the golden age: dark ink-blue panelling and orange-and-brass ornament with faint map-and-ledger candle glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark ink-blue frame with brass corner mounts.',
  'Ink-blue lacquer plaque with a brass rim.');
briefs('portugal',
  'A voyager hall: dark azulejo blue-tile walls and brass nautical instruments with faint gold ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark azulejo tile frame with gold corner mounts.',
  'Blue tile plaque with a gold rim.');
briefs('poland',
  'A commonwealth manor hall: dark crimson banners and silver winged-hussar plating with faint candle glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark crimson banner frame with silver corner mounts.',
  'Crimson lacquer plaque with a silver rim.');
briefs('austria',
  'A habsburg palace hall: pale white-gold stucco and dark marble floors with faint crimson damask and chandelier glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Pale stucco frame with gold corner mounts.',
  'White marble plaque with a gold rim.');
briefs('ethiopia',
  'A rock-hewn church hall: dark carved rose-stone and gold icon ornament with faint candle glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark carved stone frame with gold icon corners.',
  'Carved stone plaque with a gold rim.');
briefs('zulu',
  'A royal kraal hall: dark cattle-hide shields and ochre-earth walls with faint firelight, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark hide-and-wood frame with ochre-painted corners.',
  'Hide plaque with an ochre rim.');
briefs('usa',
  'A federal hall: dark navy wainscot and ivory marble with faint gold eagle ornament and gaslight glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark navy frame with gold eagle corner mounts.',
  'Navy lacquer plaque with an ivory rim.');
briefs('indochina',
  'A teak palace hall: dark carved teak and teal-tile naga ornament with faint lotus-gold inlay and lantern glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark carved teak frame with gold-inlay corners.',
  'Carved teak plaque with a gold rim.');
briefs('granada',
  'A nasrid courtyard palace: dark carved stucco and red-gold arabesque with faint fountain-haze and lantern glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark carved stucco frame with red-gold corner ornament.',
  'Carved stucco plaque with a red-gold rim.');

// ---- v247: THE LAST COURTS - 116 new nation dresses ----
briefs('azir',
  'A ministry hall: dark ivory silk panels and maroon-ink ledger ornament with faint gold seal-work, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Ivory silk panel frame with faint ember-red corner mounts.',
  'Ivory silk panel plaque with a muted ember-red rim.');
briefs('thaylenah',
  'A merchant-city night: dark weathered teal stone and stacked trade-crates with faint coin-gold glint, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Weathered trade-teal frame with faint ember-red corner mounts.',
  'Weathered trade-teal plaque with a muted ember-red rim.');
briefs('shinovar',
  'A stone garden: dark mossy garden-stone and rice-paper screens with faint rain-grey light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Mossy garden-stone frame with faint ember-red corner mounts.',
  'Mossy garden-stone plaque with a muted ember-red rim.');
briefs('herdaz',
  'A hill-country keep: dark hearthstone and iron pot-metal with faint spark-glow and lichen-green, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Dark hearthstone frame with faint ember-red corner mounts.',
  'Dark hearthstone plaque with a muted ember-red rim.');
briefs('kharbranth',
  'A terrace-city night: pale sea-wall stone and white linen awnings with faint coral lantern-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Pale sea-wall stone frame with faint ember-red corner mounts.',
  'Pale sea-wall stone plaque with a muted ember-red rim.');
briefs('listeners',
  'A shell-armored war-camp in the chasms: marbled red-black shell and chasm-shadow with faint ember-red rhythm-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Marbled red-black shell frame with faint ember-red corner mounts.',
  'Marbled red-black shell plaque with a muted ember-red rim.');
briefs('urithiru',
  'The lost tower city: silver-ash stone halls with faint sapphire light and drifting cloud-shadow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Silver-ash stone and sapphire light floating over the clouds frame with faint ember-red corner mounts.',
  'Silver-ash stone and sapphire light floating over the clouds plaque with a muted ember-red rim.');
briefs('iri',
  'A wandering-court: dark traveller-gold weave and sun-copper ornament with faint painted-skin glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Traveller gold frame with faint ember-red corner mounts.',
  'Traveller gold plaque with a muted ember-red rim.');
briefs('rira',
  'A Riran gallery court: plum-violet lacquer and collected art-frames with faint candle-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Plum-violet courts frame with faint ember-red corner mounts.',
  'Plum-violet courts plaque with a muted ember-red rim.');
briefs('bavland',
  'A pit-town night: dark red pit-clay and shoring timber with faint lamp-dust haze, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Red pit-clay frame with faint ember-red corner mounts.',
  'Red pit-clay plaque with a muted ember-red rim.');
briefs('horneaterpeaks',
  'A lakemount: frozen black basalt and hot-spring steam with faint lava-ember glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Frozen basalt peaks frame with faint ember-red corner mounts.',
  'Frozen basalt peaks plaque with a muted ember-red rim.');
briefs('unclaimedhills',
  'The unclaimed hills at dusk: cracked hill-bronze and worn road-leather with faint rusted-iron glint, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Cracked hill-bronze frame with faint ember-red corner mounts.',
  'Cracked hill-bronze plaque with a muted ember-red rim.');
briefs('aimia',
  'Aimian ruins at night: ash-grey rubble and dead-glass shards with faint cold teal glint, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Ash-grey rubble frame with faint ember-red corner mounts.',
  'Ash-grey rubble plaque with a muted ember-red rim.');
briefs('emul',
  'A desert palace night: sandy court-plaster and date-palm shadow with faint royal-blue cloth, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Sandy court-plaster frame with faint ember-red corner mounts.',
  'Sandy court-plaster plaque with a muted ember-red rim.');
briefs('tukar',
  'An old quarter: dark red sandstone walls and carved lintels with faint torch-dust, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Dark red sandstone frame with faint ember-red corner mounts.',
  'Dark red sandstone plaque with a muted ember-red rim.');
briefs('marat',
  'A nomad camp: pale rangefield grass and hide tents with faint bone-ornament white, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Pale rangefield grass frame with faint ember-red corner mounts.',
  'Pale rangefield grass plaque with a muted ember-red rim.');
briefs('yezeir',
  'A lacquer court hall: black lacquer panels and dark red court cushions with faint gold thread, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Black lacquer panels and the quiet red of the court cushions frame with faint ember-red corner mounts.',
  'Black lacquer panels and the quiet red of the court cushions plaque with a muted ember-red rim.');
briefs('liafor',
  'A Liafor ministry: deep court-blue plaster and silver leaf-work with faint lamp-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Deep court-blue frame with faint ember-red corner mounts.',
  'Deep court-blue plaque with a muted ember-red rim.');
briefs('tashikk',
  'A Tashikki weaver court: loom-linen panels and madder-red dye vats with faint work-lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Loom-linen frame with faint ember-red corner mounts.',
  'Loom-linen plaque with a muted ember-red rim.');
briefs('desh',
  'A Deshi court hall: dark tile-work and cedar screens with faint amber varnish glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Court tile-work frame with faint ember-red corner mounts.',
  'Court tile-work plaque with a muted ember-red rim.');
briefs('purelake',
  'The Purelake at dusk: quiet water-teal shallows and reed-shadow with faint silver fish-glint, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Quiet water-teal frame with faint ember-red corner mounts.',
  'Quiet water-teal plaque with a muted ember-red rim.');
briefs('reshiisles',
  'A Reshi isle night: shell-white sand and palm shadow with faint trade-red cloth glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Shell-white sand frame with faint ember-red corner mounts.',
  'Shell-white sand plaque with a muted ember-red rim.');
briefs('frostlands',
  'The frostlands night: blue ice-shadow and frozen hide-tents with faint pale sky-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Blue ice-shadow frame with faint ember-red corner mounts.',
  'Blue ice-shadow plaque with a muted ember-red rim.');
briefs('shatteredplains',
  'The shattered plains: chasm-dust and plateau rock with faint bridge-timber and distant ember glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Chasm-dust frame with faint ember-red corner mounts.',
  'Chasm-dust plaque with a muted ember-red rim.');
briefs('ix',
  'An Ixian development court: chrome-grey panels and machine-green indicator glow with faint banned-circuit tracery, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Chrome-grey frame with faint ember-red corner mounts.',
  'Chrome-grey plaque with a muted ember-red rim.');
briefs('motesystem',
  'A Motie artifact chamber: tan artifact-gold and asymmetric bronze with faint brown-watchful glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Tan artifact-gold frame with faint ember-red corner mounts.',
  'Tan artifact-gold plaque with a muted ember-red rim.');
briefs('mexico',
  'A Mexican palace hall: eagle-stone and agave-green banner with faint silver republic ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Eagle-stone frame with faint ember-red corner mounts.',
  'Eagle-stone plaque with a muted ember-red rim.');
briefs('brazil',
  'A Brazilian imperial court: deep green and gold coffee-leaf ornament with faint tropical lamp-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Deep imperial green frame with faint ember-red corner mounts.',
  'Deep imperial green plaque with a muted ember-red rim.');
briefs('grancolombia',
  'A Gran Colombian hall: bolivar-blue banners and andean stone with faint gold liberty ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Bolivar blue frame with faint ember-red corner mounts.',
  'Bolivar blue plaque with a muted ember-red rim.');
briefs('argentina',
  'An Argentine hall: pampa-silver haze and sky-blue cloth with faint gaucho-leather ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Pampa-silver frame with faint ember-red corner mounts.',
  'Pampa-silver plaque with a muted ember-red rim.');
briefs('haiti',
  'King Christophe\'s citadelle: royal blue and creole red banners over dark mason-stone, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Royal blue frame with faint ember-red corner mounts.',
  'Royal blue plaque with a muted ember-red rim.');
briefs('switzerland',
  'A Swiss canton hall: dark alpine fir and white cross-linen with faint iron-stove glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Alpine fir frame with faint ember-red corner mounts.',
  'Alpine fir plaque with a muted ember-red rim.');
briefs('merina',
  'A Merina highland palace: red-earth terrace walls and raffia silk with faint royal lamba white, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Red-earth terrace frame with faint ember-red corner mounts.',
  'Red-earth terrace plaque with a muted ember-red rim.');
briefs('congo',
  'A Congo river station: jungle-teal shadow and rain-stained wood with faint brass lantern-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Jungle-teal shadow frame with faint ember-red corner mounts.',
  'Jungle-teal shadow plaque with a muted ember-red rim.');
briefs('mirkwood',
  'Spider-dark Mirkwood at night: black fir trunks and hanging cobwebs with one faint grey-green patch of light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Spider-dark fir frame with faint ember-red corner mounts.',
  'Spider-dark fir plaque with a muted ember-red rim.');
briefs('woodmenmirkwood',
  'A woodmen clearing: axe-hewn palisade timber and log halls with faint watch-fire smoke, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Axe-hewn palisade timber frame with faint ember-red corner mounts.',
  'Axe-hewn palisade timber plaque with a muted ember-red rim.');
briefs('beornsland',
  'A honey-lit great hall: black timber and bear-pelt benches with faint mead-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Honey-lit timber frame with faint ember-red corner mounts.',
  'Honey-lit timber plaque with a muted ember-red rim.');
briefs('fangorn',
  'Fangorn at night: ancient furrowed bark and deep moss with faint green thought-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Ancient bark frame with faint ember-red corner mounts.',
  'Ancient bark plaque with a muted ember-red rim.');
briefs('mistymountains',
  'The goblin tunnels: cold granite and chasm wind with a thin ember-green goblin-fire glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Cold granite frame with faint ember-red corner mounts.',
  'Cold granite plaque with a muted ember-red rim.');
briefs('forodwaith',
  'The northern waste: grey ice-scree and old snow under a black sky, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Ice-scree frame with faint ember-red corner mounts.',
  'Ice-scree plaque with a muted ember-red rim.');
briefs('aielwaste',
  'The threefold land: sun-baked ochre rock spires and wind-carved canyons with faint dust haze, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Sun-baked ochre rock frame with faint ember-red corner mounts.',
  'Sun-baked ochre rock plaque with a muted ember-red rim.');
briefs('shienar',
  'A shienaran border keep: black volcanic stone and iron fittings with faint watch-lantern glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Black volcanic stone frame with faint ember-red corner mounts.',
  'Black volcanic stone plaque with a muted ember-red rim.');
briefs('arafel',
  'An arafel court: pale birch panels and tiny silver bell ornaments with faint snow-light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Pale birch frame with faint ember-red corner mounts.',
  'Pale birch plaque with a muted ember-red rim.');
briefs('kandor',
  'A kandori merchant house: bronze chain-work and ledger-ink dark wood with faint lamplight, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Merchant bronze frame with faint ember-red corner mounts.',
  'Merchant bronze plaque with a muted ember-red rim.');
briefs('saldaea',
  'A saldaean camp: dark furs and ice-blue steel with faint steppe-wind dust, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Horse-lord furs frame with faint ember-red corner mounts.',
  'Horse-lord furs plaque with a muted ember-red rim.');
briefs('malkier',
  'A malkieri hall: deep blue silk with faint golden crane-thread embroidery, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Crane-gold thread on deep blue and the last king\'s banner frame with faint ember-red corner mounts.',
  'Crane-gold thread on deep blue and the last king\'s banner plaque with a muted ember-red rim.');
briefs('borderlands',
  'A borderlands march hall: black leather and border-steel with faint brazier glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Black leather frame with faint ember-red corner mounts.',
  'Black leather plaque with a muted ember-red rim.');
briefs('cairhien',
  'A cairhienin court: striped dark cloth and low candle-shadow with faint gilded intrigue, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Striped court cloth frame with faint ember-red corner mounts.',
  'Striped court cloth plaque with a muted ember-red rim.');
briefs('tear',
  'The stone of tear: massive dark granite and dusty gold banner with faint torchlight, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Massive granite frame with faint ember-red corner mounts.',
  'Massive granite plaque with a muted ember-red rim.');
briefs('illian',
  'An illianer hall: honey-gold wood and olive-leaf ornament with faint sea-breeze white, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Honey-gold frame with faint ember-red corner mounts.',
  'Honey-gold plaque with a muted ember-red rim.');
briefs('murandy',
  'A murandian hill hall: worn tartan cloth and iron clasps with faint hearth-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Worn hill-tartan frame with faint ember-red corner mounts.',
  'Worn hill-tartan plaque with a muted ember-red rim.');
briefs('altara',
  'An ebou dar courtyard: rose-red shutters and sea-teal tiles with faint silver glint, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Rose-red shutters frame with faint ember-red corner mounts.',
  'Rose-red shutters plaque with a muted ember-red rim.');
briefs('araddoman',
  'A domani court: dark silk with faint silver-embroidered patterns and candle polish, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Silver-embroidered silk frame with faint ember-red corner mounts.',
  'Silver-embroidered silk plaque with a muted ember-red rim.');
briefs('tarabon',
  'A taraboner court: fig-ivory lace and veil-cloth with faint bronze snake-ornament, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Fig-ivory lace frame with faint ember-red corner mounts.',
  'Fig-ivory lace plaque with a muted ember-red rim.');
briefs('amadicia',
  'An amadician keep: snowy white cloak-cloth and hard ash-grey stone with faint questioner-fire glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Snowy white cloaks frame with faint ember-red corner mounts.',
  'Snowy white cloaks plaque with a muted ember-red rim.');
briefs('ghealdan',
  'A ghealdanin hall: weathered throne-gold gone grey with faint ember-glow and wolf-pelt shadow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Weathered throne-gold gone grey frame with faint ember-red corner mounts.',
  'Weathered throne-gold gone grey plaque with a muted ember-red rim.');
briefs('mayene',
  'Mayene at night: pearl-white port walls and teal water with faint lamp-oil glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Pearl-white port frame with faint ember-red corner mounts.',
  'Pearl-white port plaque with a muted ember-red rim.');
briefs('kashyyyk',
  'A wroshyr city: canopy-deep bark architecture and shadow-leaf with faint green bioluminescence, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Canopy-deep bark cities frame with faint ember-red corner mounts.',
  'Canopy-deep bark cities plaque with a muted ember-red rim.');
briefs('ryloth',
  'The ryloth tunnels: desert-rose rock and dust with faint spice-lantern glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Desert-rose rock frame with faint ember-red corner mounts.',
  'Desert-rose rock plaque with a muted ember-red rim.');
briefs('corellia',
  'A corellian drydock: dark dock-steel and brandy-green stripe-work with faint arc-weld glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Dock-steel frame with faint ember-red corner mounts.',
  'Dock-steel plaque with a muted ember-red rim.');
briefs('kuat',
  'The kuat drive yards: orbital ring-steel and gold hull-plate with faint planetary glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Orbital ring-steel and hull-plate gold over the planet glow frame with faint ember-red corner mounts.',
  'Orbital ring-steel and hull-plate gold over the planet glow plaque with a muted ember-red rim.');
briefs('bespin',
  'A bespin terrace: sunset-cloud orange and floating gold light with faint gas-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Sunset-cloud orange frame with faint ember-red corner mounts.',
  'Sunset-cloud orange plaque with a muted ember-red rim.');
briefs('geonosis',
  'A geonosian hive: red-rock spires and dust with faint geometric carving, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Red-rock spires frame with faint ember-red corner mounts.',
  'Red-rock spires plaque with a muted ember-red rim.');
briefs('utapau',
  'An utapaun sinkhole city: bone-grey pau stone and sinkhole shadow with faint pen-light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Bone-grey pau city frame with faint ember-red corner mounts.',
  'Bone-grey pau city plaque with a muted ember-red rim.');
briefs('onderon',
  'An onderonian citadel: jungle-stone walls and beast-rider green banners with faint torch-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Jungle-stone citadel frame with faint ember-red corner mounts.',
  'Jungle-stone citadel plaque with a muted ember-red rim.');
briefs('dathomir',
  'A dathomiri night: blood-mist lavender fog and rancor-bone totems with faint green witchfire, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Blood-mist lavender frame with faint ember-red corner mounts.',
  'Blood-mist lavender plaque with a muted ember-red rim.');
briefs('kamino',
  'A kaminoan platform: storm-grey rain and pale steel with faint vat-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Storm-grey rain frame with faint ember-red corner mounts.',
  'Storm-grey rain plaque with a muted ember-red rim.');
briefs('bothawui',
  'A bothawui bazaar: trade-tan stalls and clan tapestries with faint spy-blue lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Trade-tan stalls frame with faint ember-red corner mounts.',
  'Trade-tan stalls plaque with a muted ember-red rim.');
briefs('vulcan',
  'The vulcan forge: copper-red desert sands and logic-stone with faint bronze glint, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Copper-red forge sands frame with faint ember-red corner mounts.',
  'Copper-red forge sands plaque with a muted ember-red rim.');
briefs('tholian',
  'A tholian lattice: crystalline amber geometry and heat-haze with faint lattice glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Crystalline amber geometry frame with faint ember-red corner mounts.',
  'Crystalline amber geometry plaque with a muted ember-red rim.');
briefs('gorn',
  'A gorn elder hall: humid jungle-stone and scale-hide banners with faint green bask-light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Jungle-reptile green frame with faint ember-red corner mounts.',
  'Jungle-reptile green plaque with a muted ember-red rim.');
briefs('talarians',
  'A talarian war-hall: ridged bronze and war-leather with faint salt-lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Ridged bronze frame with faint ember-red corner mounts.',
  'Ridged bronze plaque with a muted ember-red rim.');
briefs('sheliak',
  'A sheliak vault: hyperbaride grey lattice and exo-ribs with faint cold treaty-light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Hyperbaride grey frame with faint ember-red corner mounts.',
  'Hyperbaride grey plaque with a muted ember-red rim.');
briefs('insurrectionists',
  'An insurrectionist cell: rusted colonial tin and frontier dust with faint resistance-red daub, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Rusted colonial tin frame with faint ember-red corner mounts.',
  'Rusted colonial tin plaque with a muted ember-red rim.');
briefs('unitedrebelfront',
  'A URF war-room: battered bunker-steel and map-lamplight with faint red alarm glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Battered bunker-steel frame with faint ember-red corner mounts.',
  'Battered bunker-steel plaque with a muted ember-red rim.');
briefs('dongzhuo',
  'The warlord\'s camp: rust-black iron and crimson war-banners with faint brazier glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Rust-black iron frame with faint ember-red corner mounts.',
  'Rust-black iron plaque with a muted ember-red rim.');
briefs('yuanshao',
  'A great family\'s host: gold-grey silk banners and old-family crest-work with faint lamp-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Old-family gold-grey frame with faint ember-red corner mounts.',
  'Old-family gold-grey plaque with a muted ember-red rim.');
briefs('lubu',
  'The halberd-lord\'s camp: lacquer-red banners and black-maned crimson with faint weapon-glint, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Halberd-crimson frame with faint ember-red corner mounts.',
  'Halberd-crimson plaque with a muted ember-red rim.');
briefs('gongsunzan',
  'A white-rider frontier fortress: grey stone and white-horse banners with faint dawn light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark White-horse banners frame with faint ember-red corner mounts.',
  'White-horse banners plaque with a muted ember-red rim.');
briefs('mateng',
  'A western horse-lord\'s keep: horse-brown leather and steppe dust with faint iron-glint, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Horse-brown leather frame with faint ember-red corner mounts.',
  'Horse-brown leather plaque with a muted ember-red rim.');
briefs('hanzhong',
  'A mountain fastness: grey-green taoist stone and terrace mist with faint rice-lantern glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Taist grey-green frame with faint ember-red corner mounts.',
  'Taist grey-green plaque with a muted ember-red rim.');
briefs('jingprovince',
  'A river province: river-teal hulls and reed marsh with faint fleet-lantern glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark River-teal hulls frame with faint ember-red corner mounts.',
  'River-teal hulls plaque with a muted ember-red rim.');
briefs('yiprovince',
  'A jade province: jade-green court-stone and cypress with faint plum-blossom lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Shu jade-green frame with faint ember-red corner mounts.',
  'Shu jade-green plaque with a muted ember-red rim.');
briefs('xuprovince',
  'A wheat province court: granary brick and wheat-cloth banners with faint millet-gold light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Wheat-yellow cloth frame with faint ember-red corner mounts.',
  'Wheat-yellow cloth plaque with a muted ember-red rim.');
briefs('yellowturbans',
  'A yellow-turban camp: yellow-ochre cloth and ash with faint bonfire fervor glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Yellow-ochre turbans frame with faint ember-red corner mounts.',
  'Yellow-ochre turbans plaque with a muted ember-red rim.');
briefs('turbanremnants',
  'A faded remnant camp: washed-out ochre cloth and worn ash-grey with faint ember remnants, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Washed-out ochre frame with faint ember-red corner mounts.',
  'Washed-out ochre plaque with a muted ember-red rim.');
briefs('bailong',
  'A white-banner keep: white-dragon cloth and river mist with faint lantern glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark White-dragon banners frame with faint ember-red corner mounts.',
  'White-dragon banners plaque with a muted ember-red rim.');
briefs('goguryeo',
  'A goguryeo mountain fortress: dark fortress stone and falcon-black banners with faint iron-glint, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Mountain-fortress stone frame with faint ember-red corner mounts.',
  'Mountain-fortress stone plaque with a muted ember-red rim.');
briefs('yamatai',
  'A yamatai shrine-court: bronze-mirror polish and shrine-wood with faint silk-lantern glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Bronze-mirror polish frame with faint ember-red corner mounts.',
  'Bronze-mirror polish plaque with a muted ember-red rim.');
briefs('codominium',
  'A joint bureaucracy hall: cold filing-steel and two-flag brass with faint fluorescent glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Cold-war files frame with faint ember-red corner mounts.',
  'Cold-war files plaque with a muted ember-red rim.');
briefs('tanith',
  'A legion barracks: forest-camo cloth and wet-jungle dark with faint field-lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Forest-camo frame with faint ember-red corner mounts.',
  'Forest-camo plaque with a muted ember-red rim.');
briefs('newchicago',
  'A decaying megacity office: urban rust and boardroom brass with faint neon spill, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Urban rust frame with faint ember-red corner mounts.',
  'Urban rust plaque with a muted ember-red rim.');
briefs('frystaat',
  'A high plateau farmstead: ochre earth and veld-grass with faint stoic lamplight, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Boer-farm ochre frame with faint ember-red corner mounts.',
  'Boer-farm ochre plaque with a muted ember-red rim.');
briefs('dayan',
  'A coastal desert citadel: desert-stone and star-blue cloth with faint olive-drab discipline, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Desert-stone frame with faint ember-red corner mounts.',
  'Desert-stone plaque with a muted ember-red rim.');
briefs('xanadu',
  'A syndic boardroom: black lacquer and bought-silk gold with faint hologram glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Black lacquer frame with faint ember-red corner mounts.',
  'Black lacquer plaque with a muted ember-red rim.');
briefs('makassar',
  'An outie settlement: island rust and hull-iron with faint settler bonfire glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Island rust frame with faint ember-red corner mounts.',
  'Island rust plaque with a muted ember-red rim.');
briefs('lunaorbital',
  'A lunar free city: grey regolith and orbital steel with faint blue earthlight, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Grey regolith frame with faint ember-red corner mounts.',
  'Grey regolith plaque with a muted ember-red rim.');
briefs('marsbelt',
  'A mars colony: red dust and pressure-iron with faint mining-lamp flare, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Red dust frame with faint ember-red corner mounts.',
  'Red dust plaque with a muted ember-red rim.');
briefs('newcaledonia',
  'A south-seas capital: french-teal shutters and island mahogany with faint accord-lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark French-teal frame with faint ember-red corner mounts.',
  'French-teal plaque with a muted ember-red rim.');
briefs('solarianleague',
  'A solarian sky-lobby: beige-blue marble and endless files with faint lobby light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Infinite beige-blue files frame with faint ember-red corner mounts.',
  'Infinite beige-blue files plaque with a muted ember-red rim.');
briefs('grayson',
  'A steadholder\'s hall: charcoal stone and cream cloth with faint testament-lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Charcoal stone frame with faint ember-red corner mounts.',
  'Charcoal stone plaque with a muted ember-red rim.');
briefs('masada',
  'A masadan meeting-hall: plain black wool and ash-stone with faint hard elder light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Plain black wool frame with faint ember-red corner mounts.',
  'Plain black wool plaque with a muted ember-red rim.');
briefs('mesa',
  'A mesan corridor: lab-white walls and shadow-glass with faint cold plan-glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Lab-white corridors frame with faint ember-red corner mounts.',
  'Lab-white corridors plaque with a muted ember-red rim.');
briefs('talbott',
  'A talbott cluster hall: frontier brass and worn navy cloth with faint annex-lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Frontier brass frame with faint ember-red corner mounts.',
  'Frontier brass plaque with a muted ember-red rim.');
briefs('erewhonrim',
  'A rim magnate\'s hall: worn trade-gold and dark velvet with faint deal-lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Worn trade-gold frame with faint ember-red corner mounts.',
  'Worn trade-gold plaque with a muted ember-red rim.');
briefs('beowulf',
  'A beowulf atrium: green-silver biotech and glass with faint genome-tree glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Biotech green-silver frame with faint ember-red corner mounts.',
  'Biotech green-silver plaque with a muted ember-red rim.');
briefs('chisholm',
  'A chisholm court: royal rose banners and harbor-teal with faint crown-lamp glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Royal rose frame with faint ember-red corner mounts.',
  'Royal rose plaque with a muted ember-red rim.');
briefs('monaco',
  'A principality hall: riviera azure and casino gilt with faint harbor glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Riviera azure frame with faint ember-red corner mounts.',
  'Riviera azure plaque with a muted ember-red rim.');
briefs('nippon',
  'A nipponese castle hall: lacquer-black panels and daimyo gold with faint cherry-lac red, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Lacquer-black frame with faint ember-red corner mounts.',
  'Lacquer-black plaque with a muted ember-red rim.');
briefs('badlandswhf',
  'The badlands wastes: sun-cracked ochre rock and bone-sand with faint dust haze, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Sun-cracked ochre frame with faint ember-red corner mounts.',
  'Sun-cracked ochre plaque with a muted ember-red rim.');
briefs('darksea',
  'The dark sea at night: abyss-teal water and drowned violet isle-shadow with faint phosphor glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Abyss-teal frame with faint ember-red corner mounts.',
  'Abyss-teal plaque with a muted ember-red rim.');
briefs('japan',
  'An imperial japanese court: dark silk and faint gold chrysanthemum ornament with hollyhock purple, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Imperial gold frame with faint ember-red corner mounts.',
  'Imperial gold plaque with a muted ember-red rim.');
briefs('korea',
  'A joseon palace hall: dancheong red-blue beamwork and jade screens with faint paper-lantern glow, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Palace dancheong red-blue frame with faint ember-red corner mounts.',
  'Palace dancheong red-blue plaque with a muted ember-red rim.');
briefs('tibet',
  'A himalayan temple court: snow-lion white cloth and temple-red beams with faint high-altitude haze, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Snow-lion white frame with faint ember-red corner mounts.',
  'Snow-lion white plaque with a muted ember-red rim.');
briefs('carolingian',
  'A carolingian chapel: dark stone and gospel-gold scriptorium glow with faint candle light, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Chapel stone frame with faint ember-red corner mounts.',
  'Chapel stone plaque with a muted ember-red rim.');
briefs('frankish',
  'A merovingian hall: long-hair gold ornament and dark timber with faint grave-bee gold, extremely dark and muted. Flat even lighting, no objects, no text, no vignette, no bright highlights.',
  'Dark Merovingian gold frame with faint ember-red corner mounts.',
  'Merovingian gold plaque with a muted ember-red rim.');

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
    body: JSON.stringify({ model: 'mistral-small-latest', name: 'CYF Theme Keeper v7', description: 'Paints UI background and frame textures for a strategy game.',
      instructions: 'You are a court decorator. When given a texture commission, use the image generation tool to paint exactly what is described. Reply with the image only. Keep every texture seamless, dark, muted and low-contrast - it sits behind readable text in a game interface. Never paint letters, words or icons. When you write the image prompt, describe the materials and appearance only - use no proper nouns, no place names, no real people, and no franchise, book, film or game titles in the image prompt.',
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
  let imgSrc = null, fileId = null, moderated = false;
  for (const o of (j.outputs || [])) {
    if (o && o.type === 'tool.execution' && o.name === 'image_generation' && o.info && o.info.result) {
      if (String(o.info.result).indexOf('Moderation occurred') >= 0) moderated = true;
      try { const res = (typeof o.info.result === 'string') ? JSON.parse(o.info.result) : o.info.result; if (res && res.url) imgSrc = res.url; } catch (e) {}
    }
    if (o && o.content) for (const c of (o.content || [])) if (c.type === 'tool_file' && c.file_id) fileId = c.file_id;
  }
  if (!imgSrc && fileId) imgSrc = 'https://api.mistral.ai/v1/files/' + fileId + '/content';
  return { imgSrc: imgSrc, moderated: moderated };
}

async function paintOne(ag, spec, prompt, attempt) {
  const key = spec[0], asset = spec[1];
  const r = await fetch('https://api.mistral.ai/v1/conversations', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + KEY },
    body: JSON.stringify({ inputs: prompt, stream: false, agent_id: ag }) });
  if (r.status === 401) throw new Error('refused (401)');
  if (r.status === 429) {
    if ((attempt || 0) >= 4) throw new Error('rate-limited too long');
    console.log(key + '/' + asset + ': rate-limited - pausing 60s');
    await sleep(60000);
    return paintOne(ag, spec, prompt, (attempt || 0) + 1);
  }
  if (!r.ok) throw new Error('commission failed (' + r.status + ')');
  const j = await r.json();
  let cv = readCanvas(j);
  // moderation recovery: re-commission the SAME texture in the same
  // conversation, described only by plain materials (no proper nouns).
  if (!cv.imgSrc && cv.moderated) {
    console.log(key + '/' + asset + ': moderated - re-commissioning as plain materials');
    const fr2 = await fetch('https://api.mistral.ai/v1/conversations/' + j.conversation_id, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + KEY },
      body: JSON.stringify({ stream: false,
        inputs: 'That commission was blocked by image moderation. Repaint the SAME texture, but write the image prompt using ONLY plain physical description: materials, colors, textures, shapes and lighting described earlier. Absolutely no proper nouns, no place names, no real people, no franchise, book, show, film or game titles in the image prompt.' }) });
    if (fr2.status === 401) throw new Error('refused (401)');
    if (fr2.status === 429) throw new Error('rate-limited on re-commission');
    if (!fr2.ok) throw new Error('re-commission failed (' + fr2.status + ')');
    cv = readCanvas(await fr2.json());
  }
  const imgSrc = cv.imgSrc;
  if (!imgSrc) throw new Error(cv.moderated ? 'no canvas (moderated twice)' : 'no canvas');
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
const FULL = ["azir","thaylenah","shinovar","herdaz","kharbranth","listeners","urithiru","iri","rira","bavland","horneaterpeaks","unclaimedhills","aimia","emul","tukar","marat","yezeir","liafor","tashikk","desh","purelake","reshiisles","frostlands","shatteredplains","ix","motesystem","mexico","brazil","grancolombia","argentina","haiti","switzerland","merina","congo","mirkwood","woodmenmirkwood","beornsland","fangorn","mistymountains","forodwaith","aielwaste","shienar","arafel","kandor","saldaea","malkier","borderlands","cairhien","tear","illian","murandy","altara","araddoman","tarabon","amadicia","ghealdan","mayene","kashyyyk","ryloth","corellia","kuat","bespin","geonosis","utapau","onderon","dathomir","kamino","bothawui","vulcan","tholian","gorn","talarians","sheliak","insurrectionists","unitedrebelfront","dongzhuo","yuanshao","lubu","gongsunzan","mateng","hanzhong","jingprovince","yiprovince","xuprovince","yellowturbans","turbanremnants","bailong","goguryeo","yamatai","codominium","tanith","newchicago","frystaat","dayan","xanadu","makassar","lunaorbital","marsbelt","newcaledonia","solarianleague","grayson","masada","mesa","talbott","erewhonrim","beowulf","chisholm","monaco","nippon","badlandswhf","darksea","japan","korea","tibet","carolingian","frankish","ironhall","inkwash","starmaps","dunes","tamriel","teyvat","roshar","antiquity","regency","modern","stark","lannister","baratheon","targaryen","greyjoy","martell","tyrell","arryn","tully","nightswatch","rome","egypt","byzantium","steppe","ottoman","chinaimperial","persia","aztec","norse","bourbon","britannia","prussia","muscovy","spain","mughal","mali","sparta","mordor","gondor","galacticemp","federation","nilfgaard","atreides","harkonnen","imperium40k","klingon","napoleonic","braavos","dothraki","qarth","asshai","rohan","shire","isengard","elven","erebor","numenor","harad","temeria","toussaint","andor","tarvalon","seanchan","mandalorian","hutt","sithempire","romulan","cardassian","borg","ferengi","corrino","fremen","unsc","covenant","forerunner","skyrim","cyrodiil","morrowind","hammerfell","summerset","valenwood","blackmarsh","alethkar","tau","necron","chaoswar","orkz","aeldari","empire","bretonnia","kislev","sylvania","nehekhara","lustria","skaven","mondstadt","liyue","inazuma","sumeru","fontaine","natlan","snezhnaya","carthage","hellas","caliphate","bharat","inca","venice","papal","dutch","portugal","poland","austria","ethiopia","zulu","usa","indochina","granada"];
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
let painted = 0, failed = 0, budgetHit = false;
const T0 = Date.now();
const BUDGET_MS = (Number(process.env.BUDGET_S || 9000)) * 1000;   // graceful partial exit; re-run to continue
try { fs.unlinkSync('themes/failures.txt'); } catch (e) {}
for (const spec of todo) {
  if (Date.now() - T0 > BUDGET_MS) { console.log('run budget reached - exiting cleanly (re-run to continue)'); budgetHit = true; break; }
  try { await paintOne(ag, spec, spec[2], 0); painted++; }
  catch (e) {
    console.log(spec[0] + '/' + spec[1] + ': FAILED - ' + e.message); failed++;
    try { fs.appendFileSync('themes/failures.txt', spec[0] + '/' + spec[1] + ': ' + e.message + '\n'); } catch (e2) {}
  }
  await sleep(2000);
}
console.log('painted ' + painted + ', failed ' + failed + (budgetHit ? ' (budget - re-run to continue)' : ''));
process.exit(failed && !painted ? 1 : 0);
