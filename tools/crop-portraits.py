#!/usr/bin/env python3
"""crop-portraits.py — detect and trim dead border space around vault portrait art.

The problem: many minted portraits carry a uniform empty field around the subject
INSIDE the image. object-fit:cover in the game cannot remove margins that live in
the artwork itself, so they show as dead bands on the card plates.

This tool looks at each image individually:
  - "tight"  art (subject already fills the frame) is detected and LEFT UNTOUCHED
  - art with confident dead margins is trimmed to its content box
  - anything ambiguous (would need >30% trimmed from a side, or a textured
    background the detector can't cleanly separate) is flagged REVIEW and
    skipped — the script never guesses aggressively on paid art.

Idempotent by design: after a successful crop the margins are gone, so a re-run
reports the image as "tight" and never touches it again. A crop pass can be
safely re-run at any time.

Modes (argv): report [limit]  — analyze only, write crop-report.csv (dry run)
              crop   [limit]  — trim detected images, update manifest shas,
                                leave changes staged for one commit
limit = max images to process, 0 = all.
"""
import os, sys, json, csv, hashlib
import numpy as np
from PIL import Image

MODE = sys.argv[1] if len(sys.argv) > 1 else "report"
LIMIT = int(sys.argv[2]) if len(sys.argv) > 2 else 0
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
ART = os.path.join(ROOT, "fateblade", "art")
MANIFEST = os.path.join(ROOT, "fateblade", "manifest.json")

# --- detection knobs (conservative on purpose: this runs over PAID art) ---
BLANK_TOL = 14      # deviation from the border tone that still counts as "empty"
BLANK_FRAC = 0.97   # fraction of a scanline that must be blank to call it empty
EDGE_PX = 3         # border band used to estimate the background tone
MIN_TRIM = 4        # ignore trims smaller than this many px (JPEG noise)
MAX_CROP = 0.30     # never trim more than 30% from any one side -> REVIEW instead
TIGHT_PX = 4        # all four trims below this = already full art, untouched

def analyze(img):
    """Return (top, right, bottom, left) trim in px, or None if ambiguous."""
    g = np.asarray(img.convert("L"), dtype=np.int16)
    h, w = g.shape
    # background tone = median of the outer EDGE_PX frame
    band = np.concatenate([g[:EDGE_PX, :].ravel(), g[-EDGE_PX:, :].ravel(),
                           g[:, :EDGE_PX].ravel(), g[:, -EDGE_PX:].ravel()])
    tone = int(np.median(band))
    within = np.abs(g - tone) <= BLANK_TOL        # True = "empty field" pixel

    def blank_row(y): return within[y, :].mean() >= BLANK_FRAC
    def blank_col(x): return within[:, x].mean() >= BLANK_FRAC

    def scan(getter, n):
        i = 0
        while i < n and getter(i):
            i += 1
        return i

    top = scan(blank_row, h)
    bottom = h - 1 - scan(lambda y: blank_row(h - 1 - y), h) + 1
    left = scan(blank_col, w)
    right = w - 1 - scan(lambda x: blank_col(w - 1 - x), w) + 1
    # normalize: a fully-blank image (shouldn't exist) -> no trim
    if top >= h or left >= w:
        return (0, 0, 0, 0)
    t, b = min(top, h - 1), min(h - bottom, h)
    l, r = min(left, w - 1), min(w - right, w)
    if t > h * MAX_CROP or (h - b) > h * MAX_CROP or \
       l > w * MAX_CROP or (w - r) > w * MAX_CROP:
        return None                                    # ambiguous -> REVIEW
    return (t, r, b, l)                                 # top/right/bottom/left

def main():
    paths = []
    for dirpath, _, files in os.walk(ART):
        for f in sorted(files):
            if f.lower().endswith((".jpg", ".jpeg", ".png")):
                paths.append(os.path.join(dirpath, f))
    paths.sort()
    if LIMIT > 0:
        paths = paths[:LIMIT]

    manifest = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else None
    by_path = {e["path"]: e for e in (manifest["files"] if manifest else [])}

    tight = cropped = review = errors = 0
    rows, changed = [], []
    for p in paths:
        rel = os.path.relpath(p, os.path.join(ROOT, "fateblade")).replace(os.sep, "/")
        try:
            img = Image.open(p)
            img.load()
            trim = analyze(img)
        except Exception as e:
            errors += 1
            rows.append([rel, "ERROR", str(e)[:80], "", ""])
            print(f"ERROR  {rel}: {e}")
            continue
        if trim is None:
            review += 1
            rows.append([rel, "REVIEW", "content box exceeds 30% cap — needs eyes", "", ""])
            print(f"REVIEW {rel}")
            continue
        t, r, b, l = trim
        w, h = img.size
        if t < TIGHT_PX and r < TIGHT_PX and b < TIGHT_PX and l < TIGHT_PX:
            tight += 1
            rows.append([rel, "TIGHT", "already fills the frame", "0", "0"])
            continue
        box = (l, t, w - r, h - b)
        pct = round((1 - ((box[2]-box[0])*(box[3]-box[1])) / (w*h)) * 100, 1)
        rows.append([rel, "CROP", f"trim t{t} r{r} b{b} l{l}", f"{pct}%", f"{img.size}->{(box[2]-box[0], box[3]-box[1])}"])
        print(f"CROP   {rel}  trim t{t} r{r} b{b} l{l}  ({pct}% of area)")
        if MODE == "crop":
            out = img.crop(box)
            out.save(p, quality=90, optimize=True)
            changed.append(rel)
            cropped += 1

    if MODE == "crop" and changed and manifest:
        for rel in changed:
            with open(os.path.join(ROOT, "fateblade", rel), "rb") as fh:
                sha = hashlib.sha256(fh.read()).hexdigest()
            e = by_path.get(rel)
            if e:
                e["sha256"] = sha
        json.dump(manifest, open(MANIFEST, "w"), indent=2)
        open(MANIFEST, "a").write("\n")
        print(f"manifest: {len(changed)} sha256 entries updated")

    with open("crop-report.csv", "w", newline="") as fh:
        wcsv = csv.writer(fh)
        wcsv.writerow(["file", "verdict", "detail", "area_trimmed", "size"])
        wcsv.writerows(rows)
    print(f"\n=== {MODE.upper()} pass: {len(paths)} images | tight {tight} | cropped {cropped} | review {review} | errors {errors} ===")

if __name__ == "__main__":
    main()
