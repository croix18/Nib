"""Online (trajectory) features for a stroke group, mirrored in the JS engine (onlineFeatures).

The pen-down path of the group (strokes in writing order) is resampled at K points evenly spaced
by arc length. Each point: x, y (normalised like the raster: centred on the box, scaled by its
larger side, floor 0.3*ref), the unit direction of travel (cos, sin) and a flag marking the first
sample on a new stroke.
"""
import math
import numpy as np

K = 48
NF = 5


def online_features(strokes, ref):
    strokes = [np.asarray(s, np.float64) for s in strokes]
    allp = np.concatenate(strokes, 0)
    mn = allp.min(0); mx = allp.max(0)
    size = max(mx[0] - mn[0], mx[1] - mn[1], 0.3 * ref, 1e-9)
    c = (mn + mx) / 2
    out = np.zeros((K, NF), np.float32)
    segs = []  # (stroke index, ax, ay, bx, by, length)
    for si, s in enumerate(strokes):
        q = (s - c) / size
        for i in range(len(q) - 1):
            L = math.hypot(q[i + 1, 0] - q[i, 0], q[i + 1, 1] - q[i, 1])
            if L > 1e-12:
                segs.append((si, q[i, 0], q[i, 1], q[i + 1, 0], q[i + 1, 1], L))
    if not segs:
        q = (allp - c) / size
        out[:, 0] = q[:, 0].mean(); out[:, 1] = q[:, 1].mean()
        return out
    total = sum(sg[5] for sg in segs)
    k = 0; acc = 0.0; prev_stroke = -1
    for (si, ax, ay, bx, by, L) in segs:
        # samples whose arc position falls inside this segment
        while k < K and (k + 0.5) * total / K <= acc + L + 1e-12:
            t = ((k + 0.5) * total / K - acc) / L
            t = min(max(t, 0.0), 1.0)
            out[k, 0] = ax + t * (bx - ax)
            out[k, 1] = ay + t * (by - ay)
            out[k, 2] = (bx - ax) / L
            out[k, 3] = (by - ay) / L
            out[k, 4] = 1.0 if (prev_stroke != -1 and si != prev_stroke) else 0.0
            prev_stroke = si
            k += 1
        acc += L
    while k < K:  # numerical leftovers: repeat the last sample
        out[k] = out[k - 1]; out[k, 4] = 0.0
        k += 1
    return out
