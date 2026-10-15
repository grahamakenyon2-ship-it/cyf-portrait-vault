# The Theme Vault (v242 THE COSTUMED COURT / v243 THE FULL WARDROBE)

UI dress textures for Choose Your Fate. The game fetches these over
GitHub Pages and caches them in localStorage (cyf-theme-v1:); the vault
web address is the same one configured in Settings for portraits
(themes/ is a sibling of vault/).

Layout - each dress carries three textures:
- themes/<key>/bg.jpg     - full-screen background sheet
- themes/<key>/panel.jpg  - 9-slice panel frame (ornament in the outer 12%, plain center)
- themes/<key>/btn.jpg    - 9-slice button face (flat plaque)
- themes/index.json        - {"v":2,"themes":{"<key>":{"bg":{f,m,bytes},"panel":{...},"btn":{...}}}}

The ten dresses:
- ironhall  - The Iron Hall (ASOIAF / Witcher / WoT / LOTR / WHF; also historical 476-1500)
- inkwash   - The Ink-Wash Court (Romance of the Three Kingdoms)
- starmaps  - The Star Charts (SW / ST / Halo / WH40K / CoDominium / Honorverse)
- dunes     - The Deep Desert (Dune)
- tamriel   - The Elder Council (The Elder Scrolls)
- teyvat    - The Seven Nations (Genshin Impact)
- roshar    - The Highstorm (The Stormlight Archive)
- antiquity - The Marble Court (historical, to 476 CE)
- regency   - The Gilded Age of Sail (historical, 1500-1815)
- modern    - The Iron Century (historical, 1815 onward)

To (re)paint: Actions -> paint-themes -> Run workflow. The keeper paints
only what is missing and disables itself when complete. Textures must
stay dark, muted, low-contrast - they sit behind readable game text.
