# VAULT AUTOMATION - Audio Keeper + Portrait Forge + Scene Forge + Portrait Crop QA

Two self-service pipelines live in this repo, both driven from the
Actions tab. Both are FAIL-SOFT: a dead source or a refused
commission is logged and skipped, never killing a run. Both share the
vault-painter concurrency group, so only one runs at a time. Both
self-disable when their work is complete (re-enable them by hand after
adding new work).

## 1. fateblade-audio (Audio Keeper)

Mirrors CC0 sound effects (Kenney packs) and public-domain music
(Wikimedia Commons) into fateblade/audio/, updating
fateblade/manifest.json so the Patcher ships every file with its
license + source recorded.

- **Run it**: Actions tab -> fateblade-audio -> Run workflow.
  Re-run until the log reports FATEBLADE AUDIO VAULT COMPLETE (then it
  disables itself).
- **Add more sounds**: append lines to fateblade/audio/audio-sources.txt
  and re-run. Format (see the file header):
  `slug | license | source` where source is
  `kenney:<pack>:<member>` or a direct https URL. Music tip: use
  https://commons.wikimedia.org/wiki/Special:FilePath/<File name>.oga
  so the URL resolves by NAME and never rots.
- **Failures**: listed in fateblade/audio/audio-failures.txt after each
  run - curate the bad lines and re-run.

## 2. fateblade-portraits (Portrait Forge)

Mints AI-generated NON-HUMAN character portraits (undead, elf, dwarf,
orc, goblin, construct, ogre, treant, dragonkin, vampire, troll,
voidborn...) into fateblade/art/stockpile/, updating the manifest
(license "AI-generated", src "Mistral image generation") so the Patcher
ships them and the card pipeline can pick them up.

- **Requires**: the MISTRAL_KEY secret (Settings -> Secrets and
  variables -> Actions) - the same secret paint-vault/paint-themes use.
  No other setup.
- **Run it**: Actions tab -> fateblade-portraits -> Run workflow
  (limit defaults to 5 portraits per run; each is a paid image
  commission). Re-run until the queue is empty; it then disables itself.
- **Add commissions**: append entries to fateblade/portrait-queue.json:
  { "name": "...", "category": "...", "prompt": "<visual description,
  no franchise/actor names>", "status": "queued" }. The shared "style"
  field sets the house painting style for every entry.
- **Retry a failure**: set the entry status back to "queued" (its
  "error" field says why it failed) and re-run.
- **Minted portraits** land in fateblade/art/stockpile/ and
  fateblade/manifest.json with their queue entry flipped to "minted"
  (with "file" recorded).

## 3. fateblade-edict-scenes (Edict/Relic Scene Forge)

Mints AI-generated EVENT-SCENE artwork for the canon realms' edicts
and relics into fateblade/art/scenes/, updating the manifest like the
other keepers. Every commission paints the moment the card names - the
volley released, the seal burned, the ward lit - matched to the card's
effect and its realm's lore (Elderkin glades, Alien star-fleets, the
Bestial Horde, the Star Empire's crusade, Gilded Court intrigue, the
Warring Kingdoms, the Nine Towers).

- **Requires**: the same MISTRAL_KEY secret as fateblade-portraits.
- **Run it**: Actions tab -> fateblade-edict-scenes -> Run workflow
  (limit defaults to 5 scenes per run). Re-run until the queue is empty
  (~26 runs at 5, or raise the limit); it then disables itself.
- **Add commissions**: append entries to fateblade/edict-scene-queue.json:
  { "name": "<card name>", "realm": "...", "kind": "edict|relic",
    "cardId": "<id@realm>", "prompt": "<the event, visually>", 
    "status": "queued" }. cardId records which card the scene belongs
  to so the game can mint it to that card later.
- **Retry a failure**: set the status back to "queued" and re-run.
- **Minted scenes** land in fateblade/art/scenes/ + the manifest with
  "file" recorded per queue entry.
- Shares the vault-painter concurrency group - it queues politely
  behind fateblade-portraits rather than racing it.

## 4. fateblade-portrait-crop (Portrait Crop QA)

Measures the uniform dead space (plain margins) around each portrait's
subject and reports - or trims - it. Deterministic and pixel-based
(vision models are unreliable for this; pixels are ground truth): the
image is reduced to a 64x48 grid of luma cells, and a border band is
DEAD while every strip of cells along it is near-uniform. A portrait is
flagged when total dead space >= min_dead (default 0.12) or any single
side >= 0.10. NEVER re-mints art - report mode touches nothing, and crop
mode only trims measured-uniform bands (subject-safe by construction,
per-side cap 0.35, outputs below 512px on the short side are skipped).

- **Run it**: Actions tab -> fateblade-portrait-crop -> Run workflow.
- **mode=report**: scans the folder (default art/stockpile), writes
  fateblade/art/crop-report.json (uploaded as a run artifact) and
  prints the worst 20 offenders in the log. Nothing is modified.
  Eyeball the report before cropping.
- **mode=crop**: re-runs the report, then crops every flagged file and
  re-encodes the JPEG (pillow, q92). MULTI-PASS (passes input, default 2,
  max 3): after each trim the tool re-measures its own crop and trims
  again in the same run, so portraits whose dead band was deeper than
  one capped trim can still come out tight — always from the untouched
  original, only the final version is written.
  NON-DESTRUCTIVE: cropped versions
  are written as NEW files in fateblade/<folder>-cropped/ and registered
  in fateblade/manifest.json as NEW entries - the originals and their
  manifest entries are never touched, so a bad crop can never destroy
  paid-for art (delete the -cropped folder and re-run to start over).
  Results are committed automatically; the run artifact carries the
  cropped versions too. Promoting a cropped version over its original
  (flipping the card's img reference) is a separate, deliberate,
  eyes-on step.
- **Fail-soft**: unparseable files are logged and skipped, never
  killing the run. Crop mode refuses to run without pillow.
- After a crop pass lands, the game re-ships game.html with the art
  zoom back to 1.0 in the usual release cycle (the current 1.16 zoom
  masks dead space that this tool removes).
- Shares the vault-painter concurrency group.

## Patcher + game pickup

Every file both keepers write is manifest-shipped automatically - the
Patcher pulls them on Check for Updates. Wiring new music into the
game's per-realm playlists and assigning stockpile portraits to cards
is game-side work (game.html), done in the usual release cycle.
