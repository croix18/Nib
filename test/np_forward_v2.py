"""Numpy forward pass of a folded v2 model (raster CNN + trajectory branch), for JS parity checks.
python3 np_forward_v2.py model_v2.npz parity.json out.json"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'training'))
from online import online_features  # noqa: E402

m = np.load(sys.argv[1])
P = json.load(open(sys.argv[2]))


def conv(x, w, b):
    H, W, C = x.shape
    xp = np.pad(x, ((1, 1), (1, 1), (0, 0)))
    out = np.zeros((H, W, w.shape[3])) + b
    for ky in range(3):
        for kx in range(3):
            out += xp[ky:ky + H, kx:kx + W, :] @ w[ky, kx]
    return np.maximum(out, 0)


def conv1(x, w, b):
    T, C = x.shape
    k = w.shape[0]; pad = (k - 1) // 2
    xp = np.pad(x, ((pad, k - 1 - pad), (0, 0)))
    out = np.zeros((T, w.shape[2])) + b
    for j in range(k):
        out += xp[j:j + T, :] @ w[j]
    return np.maximum(out, 0)


def pool(x):
    H, W, C = x.shape
    return x.reshape(H // 2, 2, W // 2, 2, C).max((1, 3))


res = []
for p in P:
    x = np.array(p['img'], np.float64).reshape(32, 32, 4)
    x = np.round(np.minimum(x, 1) * 255) / 255
    h = pool(conv(x, m['c0w'], m['c0b']))
    h = conv(h, m['c1w'], m['c1b']); h = pool(conv(h, m['c2w'], m['c2b']))
    h = conv(h, m['c3w'], m['c3b']); h = pool(conv(h, m['c4w'], m['c4b']))
    o = online_features(p['st'], p['ref']).astype(np.float64)
    o = np.asarray(o, np.float16).astype(np.float64)  # training stored trajectories as float16
    g = conv1(o, m['o0w'], m['o0b']); g = conv1(g, m['o1w'], m['o1b'])
    g = g.reshape(g.shape[0] // 2, 2, -1).max(1)
    g = conv1(g, m['o2w'], m['o2b'])
    f = np.concatenate([h.reshape(-1), g.max(0), g.mean(0), np.array(p['sc'])])
    hh = np.maximum(f @ m['f1'] + m['f1b'], 0)
    z = hh @ m['f2'] + m['f2b']
    z = np.exp(z - z.max()); z /= z.sum()
    res.append(z.tolist())
json.dump(res, open(sys.argv[3], 'w'))
print('ok', len(res))
