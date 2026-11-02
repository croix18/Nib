"""Pre-render augmented training epochs (uint8 NHWC) + a clean validation set."""
import os, pickle, sys
import numpy as np
from multiprocessing import Pool
from raster import rasterize, augment, G

W = os.path.join(os.environ.get('NIB_SCRATCH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scratch')), 'work')
D = pickle.load(open(os.path.join(W, 'samples.pkl'), 'rb'))
CLASSES = sorted(set(s[0] for s in D['train']))
CIDX = {c: i for i, c in enumerate(CLASSES)}


def render(args):
    split, lo, hi, seed, aug = args
    rng = np.random.default_rng(seed)
    S = D[split]
    n = hi - lo
    X = np.zeros((n, G, G, 4), np.uint8)
    Z = np.zeros((n, 5), np.float32)
    for k in range(n):
        lab, st, ref, src = S[lo + k]
        if aug:
            st = augment(st, rng, ref)
        img, sc = rasterize(st, ref)
        X[k] = np.round(np.transpose(img, (1, 2, 0)) * 255).astype(np.uint8)
        Z[k] = sc
    return X, Z


def build(split, seed, aug, out):
    S = D[split]
    N = len(S)
    chunks = [(split, lo, min(N, lo + 4000), seed * 1000 + i, aug) for i, lo in enumerate(range(0, N, 4000))]
    with Pool(2) as p:
        res = p.map(render, chunks)
    X = np.concatenate([r[0] for r in res])
    Z = np.concatenate([r[1] for r in res])
    Y = np.array([CIDX[s[0]] for s in S], np.int16)
    np.savez(out, X=X, Z=Z, Y=Y)
    print('wrote', out, X.shape, flush=True)


if __name__ == '__main__':
    os.makedirs(os.path.join(W, 'ep'), exist_ok=True)
    with open(os.path.join(W, 'ep', 'classes.txt'), 'w') as f:
        f.write('\n'.join(CLASSES))
    build('valid', 0, False, os.path.join(W, 'ep', 'valid.npz'))
    build('train', 0, False, os.path.join(W, 'ep', 'train_clean.npz'))
    for e in range(1, int(sys.argv[1]) + 1):
        build('train', e, True, os.path.join(W, 'ep', f'train_aug{e}.npz'))
