# The Theme Vault (v242: THE COSTUMED COURT)

UI dress textures for Choose Your Fate. The game fetches these over
GitHub Pages and caches them in localStorage (cyf-theme-v1:); the vault
web address is the same one configured in Settings for portraits
(themes/ is a sibling of vault/).

Layout:
- index.json - {"v":1,"themes":{"ironhall":{"bg":"ironhall/bg.jpg",...},...}}
- ironhall/bg.jpg  - The Iron Hall (ASOIAF / Witcher / WoT / LOTR / WHF)
- inkwash/bg.jpg   - The Ink-Wash Court (Romance of the Three Kingdoms)
- starmaps/bg.jpg  - The Star Charts (SW / ST / Halo / WH40K / CoDominium / Honorverse)
- dunes/bg.jpg     - The Deep Desert (Dune)

To (re)paint: Actions -> paint-themes -> Run workflow. The keeper paints
only what is missing and disables itself when complete. Textures must
stay dark, muted, low-contrast - they sit behind readable game text.
