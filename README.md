# cyf-portrait-vault

The online portrait vault for "Choose Your Fate". GitHub Actions paints
the roster of 1,335 documented rulers and canon leaders automatically, on
a schedule, and Pages serves the finished portraits to the game. You never
run anything, and you never import anything.

## One-time setup (~5 minutes)

1. Create a new GitHub repository named `cyf-portrait-vault` (public, so
   Pages can serve the images for free).
2. Upload these files to the repo root:
   - `paint.mjs` (the server-side painter)
   - `roster.json` (the 1,335 faces + their true-likeness prompts)
   - `.github/workflows/paint-vault.yml` (the schedule)
3. In the repo: Settings -> Pages -> Branch: `main`, folder: `/ (root)`,
   Save. Your vault URL will be
   `https://YOUR-USERNAME.github.io/cyf-portrait-vault/`
4. In the repo: Actions tab -> enable the `paint-vault` workflow. Run it
   once by hand ("Run workflow") to start the first batch.
5. (Optional) Settings -> Secrets -> add `MISTRAL_KEY` with your own key.
   Without a secret, the game's built-in key is used.

That is all. From now on, every 6 hours the Action paints up to 15 more
faces (with rate-limit patience), commits them, and Pages publishes them.
Nothing is ever painted twice - the vault only grows.

## The game side

In Choose Your Fate v186+: Settings -> The Portrait Vault -> paste the
Pages URL from step 3 -> Keep. The game confirms how many likenesses the
vault holds. From then on, any documented ruler the game assigns is hung
from the web vault instantly - automatic, no imports, works after the
first fetch even offline (portraits are cached in the browser forever).

## Files

- `paint.mjs` - paints missing faces via the Mistral image agent, writes
  `vault/<name>.<ext>` + `vault/index.json`, resumable, rate-limit aware.
- `roster.json` - [{k: face key, u: universe, p: prompt}] - generated from
  the game's own FAMOUS_FACES / UNIVERSE_CANON / AI_STYLE data, so every
  prompt is exactly as lore- and history-accurate as a live sitting.
- `.github/workflows/paint-vault.yml` - cron every 6h + manual dispatch.
- `vault/` - created by the painter; the paintings and the index the game
  fetches.

## Notes

- Full roster at 15 faces per run, 4 runs a day = ~60 portraits/day:
  the whole 1,335-face gallery completes in about 3 weeks. Raise BATCH
  in the workflow (e.g. 30) to go faster; the painter respects rate
  limits either way.
- Portraits bill per image to the Mistral key in use.
- To stop painting when done: disable the workflow in the Actions tab.
  The vault keeps serving.
