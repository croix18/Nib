"""v3 augmentation: v2's affine and jitter, plus the ways children's writing differs from CROHME's adults on
tablets: strokes drawn backwards, the strokes of a symbol in another order, mouse-like sparse points and
finger-like wobble. Used by make_epochs_v3.py."""
import math
import numpy as np
from raster import augment


def augment_v3(strokes, rng, ref):
    st = augment(strokes, rng, ref)                      # v2: rotation, shear, aspect, per-stroke nudge, smooth jitter
    # strokes drawn backwards
    st = [s[::-1].copy() if (len(s) > 1 and rng.random() < 0.3) else s for s in st]
    # the strokes of a multi-stroke symbol in a different order
    if len(st) > 1 and rng.random() < 0.35:
        perm = rng.permutation(len(st))
        st = [st[i] for i in perm]
    allp = np.concatenate(st, 0)
    size = max(float((allp.max(0) - allp.min(0)).max()), 0.3 * ref, 1e-9)
    u = rng.random()
    if u < 0.2:                                           # mouse / trackpad: sparse points on a pixel grid
        step = size * rng.uniform(0.06, 0.16)
        px = size / rng.uniform(25, 60)
        out = []
        for s in st:
            keep = [s[0]]
            acc = 0.0
            for i in range(1, len(s)):
                acc += float(np.hypot(*(s[i] - s[i - 1])))
                if acc >= step or i == len(s) - 1:
                    keep.append(s[i]); acc = 0.0
            out.append(np.round(np.asarray(keep) / px) * px)
        st = out
    elif u < 0.4:                                         # fingertip: dense points with a correlated wobble
        sd = size * rng.uniform(0.008, 0.022)
        out = []
        for s in st:
            if len(s) > 1:
                t = np.linspace(0, len(s) - 1, 3 * (len(s) - 1) + 1)
                s = np.stack([np.interp(t, np.arange(len(s)), s[:, 0]), np.interp(t, np.arange(len(s)), s[:, 1])], 1)
            n = np.zeros(2)
            noise = np.empty_like(s)
            for i in range(len(s)):
                n = 0.7 * n + 0.3 * rng.normal(0, 2 * sd, 2)
                noise[i] = n
            out.append(s + noise)
        st = out
    return [np.asarray(s, np.float64) for s in st]
