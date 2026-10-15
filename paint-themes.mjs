// ================================================================
// THE THEME KEEPER v5 - server-side texture painter for the
// Choose Your Fate THEME VAULT (v242 THE COSTUMED COURT, v243 THE
// FULL WARDROBE, v244 THE CROWN'S OWN DRESS, v245 THE HUNDRED
// BANNERS). Same pattern as the
// portrait keeper: runs in GitHub Actions with the MISTRAL_KEY
// secret, paints each theme's textures ONCE into themes/<key>/,
// writes themes/index.json, commits, and exits 2 (self-disable)
// when every texture exists. The game fetches these over Pages
// (cached in localStorage as cyf-theme-v1:) and falls back to the
// token-only dress when the vault is empty or unreachable.
// v5: 71 new nation dresses from v245 (118 keys x 3 assets).
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
const FULL = ["ironhall","inkwash","starmaps","dunes","tamriel","teyvat","roshar","antiquity","regency","modern","stark","lannister","baratheon","targaryen","greyjoy","martell","tyrell","arryn","tully","nightswatch","rome","egypt","byzantium","steppe","ottoman","chinaimperial","persia","aztec","norse","bourbon","britannia","prussia","muscovy","spain","mughal","mali","sparta","mordor","gondor","galacticemp","federation","nilfgaard","atreides","harkonnen","imperium40k","klingon","napoleonic","braavos","dothraki","qarth","asshai","rohan","shire","isengard","elven","erebor","numenor","harad","temeria","toussaint","andor","tarvalon","seanchan","mandalorian","hutt","sithempire","romulan","cardassian","borg","ferengi","corrino","fremen","unsc","covenant","forerunner","skyrim","cyrodiil","morrowind","hammerfell","summerset","valenwood","blackmarsh","alethkar","tau","necron","chaoswar","orkz","aeldari","empire","bretonnia","kislev","sylvania","nehekhara","lustria","skaven","mondstadt","liyue","inazuma","sumeru","fontaine","natlan","snezhnaya","carthage","hellas","caliphate","bharat","inca","venice","papal","dutch","portugal","poland","austria","ethiopia","zulu","usa","indochina","granada"];
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
