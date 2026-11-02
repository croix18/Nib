import os
"""Build symbol-classifier samples (real symbols, junk stroke groups, synthetic % and $)."""
import json, math, pickle, random, sys
import numpy as np
from raster import ref_size

S = os.environ.get('NIB_SCRATCH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scratch'))
MAXK = 4


def load(split):
    return [json.loads(l) for l in open(f'{S}/data/{split}.jsonl')]


def bbox(pts):
    a = np.asarray(pts, np.float64)
    return np.array([a[:, 0].min(), a[:, 1].min(), a[:, 0].max(), a[:, 1].max()])


def gap(b1, b2):
    return max(0.0, b2[0] - b1[2], b1[0] - b2[2], b2[1] - b1[3], b1[1] - b2[3])


def group_gap(boxes):
    """max over strokes k>0 of gap(stroke k, union of strokes < k) -- the engine's pruning measure."""
    u = boxes[0].copy()
    g = 0.0
    for b in boxes[1:]:
        g = max(g, gap(u, b))
        u = np.array([min(u[0], b[0]), min(u[1], b[1]), max(u[2], b[2]), max(u[3], b[3])])
    return g


def main():
    rng = random.Random(7)
    out = {}
    gaps = []
    for split in ('train', 'valid'):
        rows = load(split)
        samples = []
        for r in rows:
            strokes = [np.asarray(s, np.float32) for s in r['strokes']]
            if not strokes:
                continue
            ref = ref_size(strokes)
            boxes = [bbox(s) for s in strokes]
            owner = {}
            sym_ranges = set()
            for si, s in enumerate(r['symbols']):
                for k in s['strokes']:
                    owner[k] = si
                st = s['strokes']
                if 1 <= len(st) <= MAXK:
                    samples.append((s['label'], [strokes[k] for k in st], ref, 'real'))
                    if len(st) > 1:
                        gaps.append(group_gap([boxes[k] for k in st]) / ref)
                if st == list(range(st[0], st[0] + len(st))):
                    sym_ranges.add((st[0], st[-1]))
            # junk: contiguous ranges spanning >1 symbol, spatially plausible
            n = len(strokes)
            cands = []
            for i in range(n):
                for j in range(i + 1, min(n, i + MAXK)):
                    if (i, j) in sym_ranges:
                        continue
                    owners = set(owner.get(k, -1) for k in range(i, j + 1))
                    if len(owners) < 2:
                        continue
                    if group_gap(boxes[i:j + 1]) / ref > 1.2:
                        continue
                    cands.append((i, j))
            rng.shuffle(cands)
            for (i, j) in cands[:max(1, int(0.5 * len(r['symbols'])))]:
                samples.append(('junk', strokes[i:j + 1], ref, 'junk'))
        out[split] = samples
        print(split, len(samples))
    g = np.array(gaps)
    print('multi-stroke symbol group gap / ref percentiles 50,90,99,99.5,99.9:',
          np.percentile(g, [50, 90, 99, 99.5, 99.9]).round(3))

    # ---------------- mirrored rare classes and chevrons harvested from <= / >=
    FLIP = {'<': '>', '>': '<', '\\le': '\\ge', '\\ge': '\\le', '(': ')', ')': '(', '[': ']', ']': '[',
            '\\{': '\\}', '\\}': '\\{'}
    for split in ('train', 'valid'):
        extra = []
        for (lab, st, ref, src) in out[split]:
            if src != 'real':
                continue
            if lab in FLIP and (lab not in '()' or rng.random() < 0.15):
                extra.append((FLIP[lab], [np.stack([-a[:, 0], a[:, 1]], 1) for a in st], ref, 'flip'))
            if lab in ('\\le', '\\ge') and len(st) == 2:
                hs = [a[:, 1].max() - a[:, 1].min() for a in st]
                chev = st[int(np.argmax(hs))]
                extra.append(('<' if lab == '\\le' else '>', [chev], ref, 'harvest'))
        out[split] += extra
        print(split, 'extra', len(extra))

    # ---------------- synthetic % and $ from real strokes
    for split in ('train', 'valid'):
        pool = {}
        for (lab, st, ref, src) in out[split]:
            if src == 'real' and len(st) == 1 and lab in ('/', 'o', '0', 'O', 'S', 's', '|', '1'):
                pool.setdefault(lab, []).append(st[0])
        syn = []
        nsyn = 1600 if split == 'train' else 150
        for _ in range(nsyn):
            syn.append(('%',) + make_percent(pool, rng))
            syn.append(('$',) + make_dollar(pool, rng))
        out[split] += [(lab, st, ref, 'syn') for (lab, st, ref) in syn]
    with open(f'{S}/work/samples.pkl', 'wb') as f:
        pickle.dump(out, f)
    from collections import Counter
    c = Counter(s[0] for s in out['train'])
    print(len(c), 'classes'); print(sorted(c.items(), key=lambda x: -x[1]))


def norm(stroke):
    s = np.asarray(stroke, np.float64)
    mn = s.min(0); mx = s.max(0)
    sz = max(mx[0] - mn[0], mx[1] - mn[1], 1e-6)
    return (s - (mn + mx) / 2) / sz, (mx - mn) / sz


def place(stroke, cx, cy, h, rng):
    s, ext = norm(stroke)
    sc = h / max(ext[1], 0.3)
    return s * sc + np.array([cx, cy])


def make_percent(pool, rng):
    slash = rng.choice(pool['/'])
    circ = pool['o'] + pool['0'] + pool.get('O', [])
    H = 100.0
    sl = place(slash, 0, 0, H, rng)
    if rng.random() < 0.5:  # normalise slant direction
        if (sl[0, 0] - sl[-1, 0]) * (sl[0, 1] - sl[-1, 1]) > 0:
            pass
    r1 = H * rng.uniform(0.25, 0.42)
    r2 = r1 * rng.uniform(0.8, 1.2)
    c1 = place(rng.choice(circ), -H * rng.uniform(0.18, 0.32), -H * rng.uniform(0.18, 0.32), r1, rng)
    c2 = place(rng.choice(circ), H * rng.uniform(0.18, 0.32), H * rng.uniform(0.18, 0.32), r2, rng)
    # make the slash go lower-left to upper-right
    xs = sl[:, 0]
    if np.polyfit(sl[:, 1], sl[:, 0], 1)[0] > 0:
        sl[:, 0] = -sl[:, 0]
    order = rng.random()
    if order < 0.6:
        st = [c1, sl, c2]
    elif order < 0.85:
        st = [sl, c1, c2]
    else:
        st = [c1, c2, sl]
    allst = st
    return [a.astype(np.float32) for a in allst], ref_size(allst)


def make_dollar(pool, rng):
    S_ = rng.choice(pool['S'] + pool['s'])
    line = rng.choice(pool['|'] + pool['1'][:400])
    H = 100.0
    s = place(S_, 0, 0, H, rng)
    ext = H * rng.uniform(1.15, 1.45)
    ln = place(line, rng.uniform(-0.08, 0.08) * H, rng.uniform(-0.05, 0.05) * H, ext, rng)
    ln[:, 0] = ln[:, 0] * rng.uniform(0.2, 0.6) + rng.uniform(-0.05, 0.05) * H  # straighten
    st = [s, ln] if rng.random() < 0.75 else [ln, s]
    return [a.astype(np.float32) for a in st], ref_size(st)


if __name__ == '__main__':
    main()
