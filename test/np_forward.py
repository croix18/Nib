"""Numpy forward pass of the folded float model (no quantisation) for JS parity checks.
python3 np_forward.py model.npz parity.json out.json"""
import json, sys
import numpy as np

m = np.load(sys.argv[1])
P = json.load(open(sys.argv[2]))


def conv(x, w, b):  # x HWC, w HWIO, SAME
    H, W, C = x.shape
    xp = np.pad(x, ((1, 1), (1, 1), (0, 0)))
    out = np.zeros((H, W, w.shape[3]), np.float64) + b
    for ky in range(3):
        for kx in range(3):
            out += xp[ky:ky + H, kx:kx + W, :] @ w[ky, kx]
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
    f = np.concatenate([h.reshape(-1), np.array(p['sc'])])
    h = np.maximum(f @ m['f1'] + m['f1b'], 0)
    z = h @ m['f2'] + m['f2b']
    z = np.exp(z - z.max()); z /= z.sum()
    res.append(z.tolist())
json.dump(res, open(sys.argv[3], 'w'))
print('ok', len(res))
