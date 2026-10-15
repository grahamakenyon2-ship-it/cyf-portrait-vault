# The Theme Vault (v242-v245: THE COSTUMED COURT / THE FULL WARDROBE / THE CROWN'S OWN DRESS / THE HUNDRED BANNERS)

UI dress textures for Choose Your Fate. The game fetches these over
GitHub Pages and caches them in localStorage (cyf-theme-v1:); the vault
web address is the same one configured in Settings for portraits
(themes/ is a sibling of vault/).

Layout - EVERY dress carries three textures (since keeper v4):
- themes/<key>/bg.jpg     - full-screen background sheet
- themes/<key>/panel.jpg  - 9-slice panel frame (ornament in the outer 12%, plain center)
- themes/<key>/btn.jpg    - 9-slice button face (flat plaque)
- themes/index.json        - {"v":2,"themes":{"<key>":{"bg":{f,m,bytes},"panel":{...},"btn":{...}}}}

The ten WORLD/ERA dresses:
- ironhall  - The Iron Hall (ASOIAF / Witcher / WoT / LOTR / WHF; also historical 476-1500)
- inkwash   - The Ink-Wash Court (Rot3K; also Japan/Korea/Vietnam)
- starmaps  - The Star Charts (SW / ST / Halo / WH40K / CoDominium / Honorverse)
- dunes     - The Deep Desert (Dune)
- tamriel   - The Elder Council (The Elder Scrolls)
- teyvat    - The Seven Nations (Genshin Impact)
- roshar    - The Highstorm (The Stormlight Archive)
- antiquity - The Marble Court (historical, to 476 CE)
- regency   - The Gilded Age of Sail (historical, 1500-1815)
- modern    - The Iron Century (historical, 1815 onward)

The v244 realm dresses (chosen by the player's NATION, and overridden
by a great RULER when the GM names the crown):
- ASOIAF houses: stark, lannister, baratheon, targaryen, greyjoy,
  martell, tyrell, arryn, tully, nightswatch
- Historical crowns: rome (SPQR), egypt, byzantium, steppe, ottoman,
  chinaimperial, persia, aztec, norse, bourbon (France), britannia,
  prussia, muscovy (Russia), spain, mughal, mali, sparta
- Extended powers: mordor, gondor, galacticemp, federation, nilfgaard,
  atreides, harkonnen, imperium40k, klingon
- The sovereign's own dress: napoleonic (The Imperial Eagle)

The v245 nation dresses (keeper v5, THE HUNDRED BANNERS - every
playable nation in every world now wears its own arms):
- ASOIAF beyond the houses:
  braavos, dothraki, qarth, asshai
- LOTR realms:
  rohan, shire, isengard, elven, erebor, numenor, harad
- Witcher:
  temeria, toussaint
- Wheel of Time:
  andor, tarvalon, seanchan
- Star Wars:
  mandalorian, hutt, sithempire
- Star Trek:
  romulan, cardassian, borg, ferengi
- Dune:
  corrino, fremen
- Halo:
  unsc, covenant, forerunner
- Elder Scrolls provinces:
  skyrim, cyrodiil, morrowind, hammerfell, summerset, valenwood, blackmarsh
- Stormlight:
  alethkar
- Warhammer 40K:
  tau, necron, chaoswar, orkz, aeldari
- Warhammer Fantasy:
  empire, bretonnia, kislev, sylvania, nehekhara, lustria, skaven
- Genshin Impact nations:
  mondstadt, liyue, inazuma, sumeru, fontaine, natlan, snezhnaya
- More historical crowns:
  carthage, hellas, caliphate, bharat, inca, venice, papal, dutch, portugal, poland, austria, ethiopia, zulu, usa, indochina, granada

To (re)paint: Actions -> paint-themes -> Run workflow. The keeper paints
only what is missing and disables itself when complete. Textures must
stay dark, muted, low-contrast - they sit behind readable game text.
