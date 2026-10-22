#!/usr/bin/env python3
# portrait-crop.py — FATEBLADE portrait dead-space QA + auto-crop (vault tool)
#
# Two modes (workflow_dispatch from the Actions tab, or run locally):
#   report (default)  scan a vault art folder, measure the uniform dead
#                     space (plain margins) around each portrait's subject,
#                     write fateblade/art/crop-report.json + print the worst
#                     offenders. NO image is modified.
#   crop              crop every file the detector flagged (report is run
#                     first inside crop mode), trimming the measured dead
#                     bands plus a small safety pad, re-encoding the JPEG
#                     (pillow required), and updating fateblade/manifest.json
#                     (sha256 + size) for every file it touches so the
#                     Patcher's sha checks stay green.
#
# Detection is deterministic and pixel-based (vision models are unreliable
# for this — pixels are ground truth): the image is reduced to a 64x48 grid
# of cells; each cell's luma standard deviation measures "content"; a
# border band is DEAD while every strip of cells along it is near-uniform.
# A portrait NEEDS CROP when total dead space >= MIN_DEAD or any single
# side >= 0.10. Crop trims ONLY measured-uniform bands — the subject (and
# its face) is inside the kept window by construction; each side's loss is
# capped at MAX_SIDE so a false-positive strip can never gut a portrait,
# and outputs smaller than 512px on the short side are skipped.
#
# Fail-soft: a file that cannot be parsed (e.g. progressive JPEG without
# pillow) is logged and skipped, never killing the run.
#
# Usage:
#   python3 fateblade/portrait-crop.py report [folder] [min_dead] [max_side]
#   python3 fateblade/portrait-crop.py crop   [folder] [min_dead] [max_side]
# folder is relative to the vault's fateblade/ dir, default art/stockpile.
# Local dev without pillow: report mode still works via the embedded
# pure-stdlib baseline JPEG decoder (crop mode needs pillow).

import sys, os, json, math, hashlib, statistics

MODE = sys.argv[1] if len(sys.argv) > 1 else 'report'
FOLDER = sys.argv[2] if len(sys.argv) > 2 else 'art/stockpile'
MIN_DEAD = float(sys.argv[3]) if len(sys.argv) > 3 else 0.12
MAX_SIDE = float(sys.argv[4]) if len(sys.argv) > 4 else 0.35
ROOT = os.path.dirname(os.path.abspath(__file__))  # .../fateblade
GC, GR = 64, 48          # analysis grid (cells)
CELL_STD_DEAD = 6.0      # a cell is "contentless" below this luma std
SIDE_FLAG = 0.10         # any single dead side >= this flags a crop
PAD = 0.03               # safety pad kept around the subject (fraction)
MIN_SHORT = 512          # never produce an output smaller than this
JPEG_QUALITY = 92

assert MODE in ('report', 'crop'), 'mode must be report or crop'

# ---------- image access: pillow if present, else pure-stdlib luma plane ----------
try:
    from PIL import Image
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False
    import struct
    # embedded fallback decoder (same math as CYF jpegstat.py, baseline JPEG)
    class BitReader:
        def __init__(self, d):
            self.d = d; self.p = 0; self.b = 0; self.n = 0
        def bit(self):
            if self.n == 0:
                if self.p >= len(self.d): return 0
                c = self.d[self.p]; self.p += 1
                if c == 0xFF:
                    nxt = self.d[self.p] if self.p < len(self.d) else 0
                    if nxt == 0x00: self.p += 1
                    else: self.p -= 1; return 0
                self.b = c; self.n = 8
            self.n -= 1
            return (self.b >> self.n) & 1
        def bits(self, k):
            v = 0
            for _ in range(k): v = (v << 1) | self.bit()
            return v
    class Huff:
        def __init__(self, counts, symbols):
            self.code = {}; code = 0; k = 0
            for l in range(1, 17):
                for _ in range(counts[l-1]): self.code[(code, l)] = symbols[k]; k += 1; code += 1
                code <<= 1
        def decode(self, br):
            code = 0
            for l in range(1, 17):
                code = (code << 1) | br.bit()
                if (code, l) in self.code: return self.code[(code, l)]
            return 0
    ZZ = [0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63]
    def _idct(blk):
        tmp = [[0.0]*8 for _ in range(8)]
        for y in range(8):
            for x in range(8):
                s = 0.0
                for u in range(8):
                    cu = 0.70710678118 if u == 0 else 1.0
                    s += cu * blk[y*8+u] * math.cos((2*x+1)*u*math.pi/16)
                tmp[y][x] = s / 2
        out = [[0.0]*8 for _ in range(8)]
        for y in range(8):
            for x in range(8):
                s = 0.0
                for v in range(8):
                    cv = 0.70710678118 if v == 0 else 1.0
                    s += cv * tmp[v][x] * math.cos((2*y+1)*v*math.pi/16)
                out[y][x] = s / 2
        return out
    def _jparse(path):
        d = open(path, 'rb').read()
        pos = 2; qt = {}; huf = {}; dri = 0; comps = None; W = H = None
        while pos < len(d) - 1:
            if d[pos] != 0xFF: pos += 1; continue
            m = d[pos+1]
            if m == 0xD8 or m == 0x01 or 0xD0 <= m <= 0xD7: pos += 2; continue
            ln = struct.unpack('>H', d[pos+2:pos+4])[0]
            seg = d[pos+4:pos+2+ln]; pos += 2 + ln
            if m == 0xDB:
                p = 0
                while p < len(seg):
                    tq = seg[p] & 15; qt[tq] = list(seg[p+1:p+65]); p += 65
            elif m in (0xC0, 0xC1, 0xC2):
                if m == 0xC2: raise ValueError('progressive JPEG needs pillow')
                H = (seg[1]<<8)|seg[2]; W = (seg[3]<<8)|seg[4]; nc = seg[5]
                comps = []
                for i in range(nc):
                    hv, Tq = seg[7+i*3], seg[8+i*3]
                    comps.append({'h': hv >> 4, 'v': hv & 15, 'q': Tq})
            elif m == 0xC4:
                p = 0
                while p < len(seg):
                    tc = seg[p] >> 4; th = seg[p] & 15; p += 1
                    counts = list(seg[p:p+16]); p += 16
                    total = sum(counts); huf[(tc, th)] = Huff(counts, list(seg[p:p+total])); p += total
            elif m == 0xDD:
                dri = struct.unpack('>H', seg[0:2])[0]
            elif m == 0xDA:
                ns = seg[0]; scan = []
                for i in range(ns):
                    td = seg[2+i*2]
                    scan.append({'tdc': td >> 4, 'tac': td & 15})
                start = pos
                while pos < len(d) - 1:
                    if d[pos] == 0xFF and d[pos+1] != 0x00 and not (0xD0 <= d[pos+1] <= 0xD7): break
                    pos += 1
                return d[start:pos], scan, comps, qt, huf, W, H, dri
            elif m == 0xD9:
                break
        raise ValueError('no scan found')
    def _luma(path):
        data, scan, comps, qt, huf, W, H, dri = _jparse(path)
        br = BitReader(data); nc = len(comps)
        hmax = max(c['h'] for c in comps); vmax = max(c['v'] for c in comps)
        mcux = (W + 8*hmax - 1)//(8*hmax); mcuy = (H + 8*vmax - 1)//(8*vmax)
        for ci in range(nc):
            comps[ci]['tdc'] = scan[ci]['tdc']; comps[ci]['tac'] = scan[ci]['tac']
        blocks = [dict() for _ in comps]  # per-component: chroma must NOT clobber luma
        pred = [0]*nc; mc = 0
        for my in range(mcuy):
            for mx in range(mcux):
                if dri and mc > 0 and mc % dri == 0: pred = [0]*nc
                for ci in range(nc):
                    c = comps[ci]
                    for iv in range(c['v']):
                        for ih in range(c['h']):
                            blk = [0]*64
                            hf = huf.get((0, c['tdc'])) or huf[(0, 0)]
                            s = hf.decode(br)
                            diff = br.bits(s) if s else 0
                            if s and diff < (1 << (s-1)): diff -= (1 << s) - 1
                            pred[ci] += diff
                            blk[0] = pred[ci] * qt[c['q']][0]
                            hf = huf.get((1, c['tac'])) or huf[(1, 0)]
                            k = 1
                            while k < 64:
                                rs = hf.decode(br)
                                r, s = rs >> 4, rs & 15
                                if s == 0:
                                    if r == 15: k += 16; continue
                                    break
                                k += r
                                if k > 63: break
                                v = br.bits(s)
                                if v < (1 << (s-1)): v -= (1 << s) - 1
                                blk[ZZ[k]] = v * qt[c['q']][k]
                                k += 1
                            blocks[ci][(my*c['v']+iv, mx*c['h']+ih)] = _idct(blk)
                mc += 1
        P = [[0.0]*W for _ in range(H)]
        for (by, bx), px in blocks[0].items():
            for y in range(8):
                yy = by*8+y
                if yy >= H: continue
                row = P[yy]
                for x in range(8):
                    xx = bx*8+x
                    if xx < W: row[xx] = px[y][x] + 128
        return W, H, P

def grid_of(path):
    """64x48 grid of (mean, std) luma cells — identical math for both backends."""
    if HAVE_PIL:
        im = Image.open(path).convert('L')
        W, H = im.size
        px = list(im.getdata())
        get = lambda x, y: px[y*W + x]
    else:
        W, H, P = _luma(path)
        get = lambda x, y: max(0.0, min(255.0, P[y][x]))
    cw, ch = W / GC, H / GR
    cells = []
    step = max(1, int(min(cw, ch) / 4))  # ~4x4 samples per cell keeps it fast
    for gy in range(GR):
        y0, y1 = int(gy*ch), int((gy+1)*ch)
        row = []
        for gx in range(GC):
            x0, x1 = int(gx*cw), int((gx+1)*cw)
            vals = [get(x, y) for y in range(y0, y1, step) for x in range(x0, x1, step)]
            row.append((sum(vals)/len(vals), statistics.pstdev(vals) if len(vals) > 1 else 0.0))
        cells.append(row)
    return W, H, cells

def dead_sides(cells):
    def strip(side):
        n = 0
        if side in ('top', 'bot'):
            it = range(GR) if side == 'top' else range(GR-1, -1, -1)
            for gy in it:
                if max(cells[gy][x][1] for x in range(GC)) < CELL_STD_DEAD: n += 1
                else: break
            return n / GR
        it = range(GC) if side == 'left' else range(GC-1, -1, -1)
        for gx in it:
            if max(cells[y][gx][1] for y in range(GR)) < CELL_STD_DEAD: n += 1
            else: break
        return n / GC
    return {s: strip(s) for s in ('top', 'bot', 'left', 'right')}

def crop_window(W, H, d):
    x0 = min(int(d['left']*W), int(MAX_SIDE*W))
    x1 = W - min(int(d['right']*W), int(MAX_SIDE*W))
    y0 = min(int(d['top']*H), int(MAX_SIDE*H))
    y1 = H - min(int(d['bot']*H), int(MAX_SIDE*H))
    # safety pad back toward the dead sides (keep ~3% of the kept span)
    pw = int((x1-x0) * PAD); ph = int((y1-y0) * PAD)
    x0 = max(0, x0 - pw); y0 = max(0, y0 - ph)
    x1 = min(W, x1 + pw); y1 = min(H, y1 + ph)
    return x0, y0, x1, y1

# ---------- scan ----------
target_dir = os.path.join(ROOT, FOLDER)
files = sorted(f for f in os.listdir(target_dir) if f.lower().endswith(('.jpg', '.jpeg')))
print(f'portrait-crop [{MODE}]: {len(files)} files in fateblade/{FOLDER} '
      f'(min_dead={MIN_DEAD}, max_side={MAX_SIDE}, backend={"pillow" if HAVE_PIL else "stdlib"})')
if MODE == 'crop' and not HAVE_PIL:
    print('CROP ABORTED: crop mode requires pillow (pip install pillow)')
    sys.exit(3)

report, cropped, errors = [], 0, []
for i, f in enumerate(files):
    path = os.path.join(target_dir, f)
    try:
        W, H, cells = grid_of(path)
        d = dead_sides(cells)
        total = d['top'] + d['bot'] + d['left'] + d['right']
        need = total >= MIN_DEAD or max(d.values()) >= SIDE_FLAG
        entry = {'file': f, 'w': W, 'h': H, 'dead': {k: round(v, 3) for k, v in d.items()},
                 'dead_total': round(total, 3), 'needs_crop': need}
        if need:
            x0, y0, x1, y1 = crop_window(W, H, d)
            entry['window'] = [x0, y0, x1, y1]
            if MODE == 'crop':
                if min(x1-x0, y1-y0) < MIN_SHORT:
                    entry['action'] = 'skipped-too-small'
                else:
                    im = Image.open(path).convert('RGB').crop((x0, y0, x1, y1))
                    im.save(path, 'JPEG', quality=JPEG_QUALITY)
                    entry['action'] = 'cropped'
                    entry['new_size'] = [x1-x0, y1-y0]
                    cropped += 1
        report.append(entry)
    except Exception as e:
        errors.append({'file': f, 'error': str(e)[:200]})
    if (i+1) % 100 == 0:
        print(f'  {i+1}/{len(files)} scanned...')

flagged = [e for e in report if e['needs_crop']]
print(f'\nDONE: {len(report)} analyzed, {len(flagged)} flagged for crop, {cropped} cropped, {len(errors)} errors')
for e in sorted(flagged, key=lambda x: -x['dead_total'])[:20]:
    print('  %-45s dead_total=%.2f  %s' % (e['file'], e['dead_total'], e.get('action', 'flag')))

out = {'mode': MODE, 'folder': FOLDER, 'thresholds': {'min_dead': MIN_DEAD, 'side_flag': SIDE_FLAG,
       'max_side': MAX_SIDE, 'cell_std_dead': CELL_STD_DEAD, 'pad': PAD},
       'backend': 'pillow' if HAVE_PIL else 'stdlib',
       'scanned': len(report), 'flagged': len(flagged), 'cropped': cropped, 'errors': errors,
       'files': report}
rpath = os.path.join(ROOT, 'art', 'crop-report.json')
with open(rpath, 'w') as fh:
    json.dump(out, fh, indent=1)
print('report: fateblade/art/crop-report.json')

# crop mode: sync manifest shas for every file we rewrote
if MODE == 'crop' and cropped:
    mpath = os.path.join(ROOT, 'manifest.json')
    man = json.load(open(mpath))
    bypath = {}
    for ent in man.get('files', []):
        p = ent.get('path', '')
        bypath[p] = ent
        alt = p.replace('fateblade/', '', 1) if p.startswith('fateblade/') else 'fateblade/' + p
        bypath.setdefault(alt, ent)
    upd = 0
    for e in report:
        if e.get('action') != 'cropped': continue
        rel = FOLDER + '/' + e['file']
        ent = bypath.get(rel) or bypath.get('fateblade/' + rel)
        if not ent:
            print(f'  WARN: no manifest entry for {rel} (skipped)'); continue
        data = open(os.path.join(target_dir, e['file']), 'rb').read()
        ent['sha256'] = hashlib.sha256(data).hexdigest()
        ent['size'] = len(data)
        if 'bytes' in ent: ent['bytes'] = len(data)
        upd += 1
    with open(mpath, 'w') as fh:
        json.dump(man, fh, indent=1)
        fh.write('\n')
    print(f'manifest: {upd} sha/size entries updated')
