"""Pre-render v2 epochs: raster (uint8 NHWC) + trajectory features (float16) + scalars, from samples_v2.pkl."""
import os, pickle, sys
import numpy as np
from multiprocessing import Pool
from raster import rasterize, augment, G
from online import online_features, K, NF

W = os.path.join(os.environ.get('NIB_SCRATCH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scratch')), 'work')
D = pickle.load(open(os.path.join(W, 'samples_v2.pkl'), 'rb'))
if not os.path.exists(os.path.join(W, 'ep', 'classes.txt')):   # the class list: every label in the training samples, sorted
    os.makedirs(os.path.join(W, 'ep'), exist_ok=True)
    open(os.path.join(W, 'ep', 'classes.txt'), 'w').write('\n'.join(sorted(set(s[0] for s in D['train']))))
CLASSES = open(os.path.join(W, 'ep', 'classes.txt')).read().split('\n')
CIDX = {c: i for i, c in enumerate(CLASSES)}
OUT = os.path.join(W, 'ep2')


def render(args):
    split, lo, hi, seed, aug = args
    rng = np.random.default_rng(seed)
    S = D[split]
    n = hi - lo
    X = np.zeros((n, G, G, 4), np.uint8)
    O = np.zeros((n, K, NF), np.float16)
    Z = np.zeros((n, 5), np.float32)
    for k in range(n):
        lab, st, ref, src = S[lo + k]
        if aug:
            st = augment(st, rng, ref)
        img, sc = rasterize(st, ref)
        X[k] = np.round(np.transpose(img, (1, 2, 0)) * 255).astype(np.uint8)
        O[k] = online_features(st, ref)
        Z[k] = sc
    return X, O, Z


def build(split, seed, aug, out, procs):
    S = D[split]
    N = len(S)
    chunks = [(split, lo, min(N, lo + 4000), seed * 1000 + i, aug) for i, lo in enumerate(range(0, N, 4000))]
    with Pool(procs) as p:
        res = p.map(render, chunks)
    X = np.concatenate([r[0] for r in res]); O = np.concatenate([r[1] for r in res]); Z = np.concatenate([r[2] for r in res])
    Y = np.array([CIDX[s[0]] for s in S], np.int16)
    np.savez(out + '.tmp.npz', X=X, O=O, Z=Z, Y=Y)
    os.replace(out + '.tmp.npz', out)
    print('wrote', out, X.shape, flush=True)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    n_aug = int(sys.argv[1]); procs = int(sys.argv[2]) if len(sys.argv) > 2 else 2
    jobs = [('valid', 0, False, 'valid.npz'), ('train', 0, False, 'train_clean.npz')] + \
           [('train', e, True, f'train_aug{e}.npz') for e in range(1, n_aug + 1)]
    for split, seed, aug, name in jobs:
        if os.path.exists(os.path.join(OUT, name)):
            continue
        build(split, seed, aug, os.path.join(OUT, name), procs)
