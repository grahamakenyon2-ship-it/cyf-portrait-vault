# The Theme Vault (v242-v244: THE COSTUMED COURT / THE FULL WARDROBE / THE CROWN'S OWN DRESS)

UI dress textures for Choose Your Fate. The game fetches these over
GitHub Pages and caches them in localStorage (cyf-theme-v1:); the vault
web address is the same one configured in Settings for portraits
(themes/ is a sibling of vault/).

Layout - a FULL dress carries three textures; a REALM dress (v244)
carries only the sheet (the game's parchment furniture stands):
- themes/<key>/bg.jpg     - full-screen background sheet (every dress)
- themes/<key>/panel.jpg  - 9-slice panel frame (FULL dresses only)
- themes/<key>/btn.jpg    - 9-slice button face (FULL dresses only)
- themes/index.json        - {"v":2,"themes":{"<key>":{"bg":{f,m,bytes},"panel":{...},"btn":{...}}}}

The ten FULL dresses (world + historical era):
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

The v244 realm dresses (bg-only; chosen by the player's NATION, and
overridden by a great RULER when the GM names the crown):
- ASOIAF houses: stark, lannister, baratheon, targaryen, greyjoy,
  martell, tyrell, arryn, tully, nightswatch
- Historical crowns: rome (SPQR), egypt, byzantium, steppe, ottoman,
  chinaimperial, persia, aztec, norse, bourbon (France), britannia,
  prussia, muscovy (Russia), spain, mughal, mali, sparta
- Extended powers: mordor, gondor, galacticemp, federation, nilfgaard,
  atreides, harkonnen, imperium40k, klingon
- The sovereign's own dress: napoleonic (The Imperial Eagle)

To (re)paint: Actions -> paint-themes -> Run workflow. The keeper paints
only what is missing and disables itself when complete. Textures must
stay dark, muted, low-contrast - they sit behind readable game text.
