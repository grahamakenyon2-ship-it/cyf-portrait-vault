# cyf-portrait-vault

The online portrait vault for "Choose Your Fate". GitHub Actions paints the
roster of documented rulers and canon leaders when YOU trigger it, and Pages
serves the finished portraits to the game. You never run anything, and you
never import anything.

## How it works (v4)

- `paint.mjs` (the Portrait Keeper v4) paints only the faces not yet in
  `vault/`, then commits them. Nothing is ever painted twice.
- The workflow runs ONLY on manual dispatch (Actions tab -> Run workflow).
  There is no schedule - painting happens only when you ask for it, so the
  spend is always deliberate. The `batch` input sets how many sittings the
  run may paint (default 40).
- The API key comes ONLY from the `MISTRAL_KEY` repo secret. Nothing is
  hardcoded (an old key was accidentally committed once; rotate any key
  that ever touches a public repo).

## Adding a new batch of faces

Drop a compact seed file `roster-add/batchN.json` (array of
`{k, u, g, d, n}` = key, universe, gender, appearance description, display
name). The keeper expands each seed into a full prompt by cloning the
  template face of the same universe from `roster.json`, then paints it.
See `roster-add/batch1.json` for the format.

## One-time setup

1. Settings -> Pages -> Branch: `main`, folder: `/ (root)`, Save.
   Vault URL: `https://YOUR-USERNAME.github.io/cyf-portrait-vault/`
2. Settings -> Secrets and variables -> Actions -> New repository secret:
   name `MISTRAL_KEY`, value = your Mistral API key.
3. Actions tab -> enable the `paint-vault` workflow -> "Run workflow" to
   paint the current batch.

## The game side

In Choose Your Fate v186+: Settings -> The Portrait Vault -> paste the
Pages URL -> Keep. The game fetches `vault/index.json` and hangs any
matching portrait instantly; fetched portraits are cached in the browser
forever.

## Files

- `paint.mjs` - the Portrait Keeper v4 (secret-only key, seed expansion,
  concurrency, rate-limit patience, moderation recovery).
- `roster.json` - the 1,335 painted faces with their full prompts.
- `roster-add/batch1.json` - 57 new faces (batch 1) in compact seed form.
- `.github/workflows/paint-vault.yml` - manual-dispatch workflow.
- `vault/` - the paintings and `index.json` the game fetches.
- `agent-v3.txt` - the cached Mistral painter agent id.
