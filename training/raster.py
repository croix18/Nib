"""Symbol rasterizer shared (bit-for-bit in spirit) with the JS engine.

A group of strokes -> 4 orientation channels on a 32x32 grid + 5 scalar features.
Orientation is undirected (0, 45, 90, 135 degrees in y-down image space), so
stroke direction and stroke order do not matter.
"""
import math
import numpy as np

G = 32
MARGIN = 2.0
STEP = 0.5
NSCAL = 5


def ref_size(strokes):
    """Expression-level size reference: median over strokes of max(width, height)."""
    sizes = []
    for s in strokes:
        s = np.asarray(s, np.float64)
        d = s.max(0) - s.min(0)
        sizes.append(max(d[0], d[1]))
    if not sizes:
        return 1.0
    r = float(np.median(sizes))
    return r if r > 1e-6 else 1.0


def _splat(acc, xs, ys, ch, wt):
    # bilinear splat at continuous coords (pixel i spans [i, i+1), centre i+0.5)
    px = xs - 0.5
    py = ys - 0.5
    i0 = np.floor(px).astype(np.int64)
    j0 = np.floor(py).astype(np.int64)
    fx = px - i0
    fy = py - j0
    for di, dj, w in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)),
                      (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
        ii = i0 + di
        jj = j0 + dj
        m = (ii >= 0) & (ii < G) & (jj >= 0) & (jj < G)
        idx = ch[m] * G * G + jj[m] * G + ii[m]
        acc += np.bincount(idx, weights=(wt * w)[m], minlength=4 * G * G)


def rasterize(strokes, ref):
    """strokes: list of (n,2) arrays (any units, y down). Returns (img[4,G,G] float32, scal[5])."""
    strokes = [np.asarray(s, np.float64) for s in strokes]
    allp = np.concatenate(strokes, 0)
    mn = allp.min(0)
    mx = allp.max(0)
    w = mx[0] - mn[0]
    h = mx[1] - mn[1]
    size = max(w, h, 0.3 * ref, 1e-9)
    scale = (G - 2 * MARGIN) / size
    cx = (mn[0] + mx[0]) / 2
    cy = (mn[1] + mx[1]) / 2
    acc = np.zeros(4 * G * G, np.float64)
    total = 0.0
    for s in strokes:
        q = np.empty_like(s)
        q[:, 0] = (s[:, 0] - cx) * scale + G / 2
        q[:, 1] = (s[:, 1] - cy) * scale + G / 2
        d = np.diff(s, axis=0)
        total += float(np.sqrt((d * d).sum(1)).sum()) if len(s) > 1 else 0.0
        dq = np.diff(q, axis=0)
        L = np.sqrt((dq * dq).sum(1)) if len(q) > 1 else np.zeros(0)
        if len(q) == 1 or L.sum() < STEP:
            c = q.mean(0)
            xs = np.full(4, c[0])
            ys = np.full(4, c[1])
            _splat(acc, xs, ys, np.arange(4), np.full(4, 0.5))
            continue
        keep = L > 1e-9
        a = q[:-1][keep]
        dq = dq[keep]
        L = L[keep]
        th = np.arctan2(dq[:, 1], dq[:, 0])
        th = np.mod(th, math.pi)
        pos = th / (math.pi / 4)
        fl = np.floor(pos)
        k0 = fl.astype(np.int64) % 4
        f = pos - fl
        k1 = (k0 + 1) % 4
        n = np.ceil(L / STEP).astype(np.int64)
        seg = np.repeat(np.arange(len(L)), n)
        start = np.cumsum(n) - n
        j = np.arange(n.sum()) - np.repeat(start, n)
        t = (j + 0.5) / n[seg]
        xs = a[seg, 0] + t * dq[seg, 0]
        ys = a[seg, 1] + t * dq[seg, 1]
        wl = L[seg] / n[seg]
        _splat(acc, xs, ys, k0[seg], (1 - f[seg]) * wl)
        _splat(acc, xs, ys, k1[seg], f[seg] * wl)
    img = np.minimum(acc, 1.0).reshape(4, G, G).astype(np.float32)
    e = 0.02 * ref + 1e-9
    scal = np.array([
        np.clip(math.log((w + e) / (h + e)), -4, 4) / 2,
        np.clip(math.log((h + e) / ref), -4, 2) / 2,
        np.clip(math.log((w + e) / ref), -4, 2) / 2,
        min(len(strokes) - 1, 3) / 3,
        np.clip(math.log(total / ref + 0.01), -4, 3) / 2,
    ], np.float32)
    return img, scal


# ---------------------------------------------------------------- augmentation
def augment(strokes, rng, ref):
    """Random affine + per-stroke nudge + smooth jitter. strokes: list of (n,2) arrays."""
    allp = np.concatenate(strokes, 0)
    c = (allp.min(0) + allp.max(0)) / 2
    d = allp.max(0) - allp.min(0)
    size = max(d[0], d[1], 0.3 * ref, 1e-9)
    rot = np.clip(rng.normal(0, 0.10), -0.3, 0.3)
    shear = np.clip(rng.normal(0, 0.15), -0.4, 0.4)
    sx = math.exp(np.clip(rng.normal(0, 0.12), -0.3, 0.3))
    sy = math.exp(np.clip(rng.normal(0, 0.12), -0.3, 0.3))
    cr, sr = math.cos(rot), math.sin(rot)
    M = np.array([[cr, -sr], [sr, cr]]) @ np.array([[1, shear], [0, 1]]) @ np.diag([sx, sy])
    out = []
    multi = len(strokes) > 1
    for s in strokes:
        p = (s - c) @ M.T
        if multi:
            p = p + rng.normal(0, 0.035, 2) * size
        if len(p) > 3:
            # smooth low-frequency jitter along the stroke
            n = len(p)
            k = rng.normal(0, 0.02, (4, 2)) * size
            t = np.linspace(0, 1, n)[:, None]
            basis = np.stack([np.sin(math.pi * (i + 1) * t[:, 0] + rng.uniform(0, 6.28)) for i in range(4)], 1)
            p = p + basis @ k
        out.append(p + c)
    return out
