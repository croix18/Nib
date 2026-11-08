"""Weight-space interpolation between the shipped network and a fine-tune of it (WiSE-FT):
    theta = (1 - a) * theta_base + a * theta_tuned
over every parameter and every batch-norm running statistic, then folded into a model npz as train_v4.py does.
The fine-tune starts from the base checkpoint, so the two sit in one basin and the straight line between them
keeps most of what the fine-tune learned (here: the owner's hand) while giving back little of what the base knew.

    python3 soup_v4.py scratch/work/model_v3.npz.ckpt scratch/work/model_v4.npz.ckpt 0.5 scratch/work/model_v4s50.npz
"""
import pickle, sys
import numpy as np

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
_argv, sys.argv = sys.argv, sys.argv[:1]          # train_v4 reads its own arguments when imported
from train_v4 import fold  # noqa: E402  (the same folding the shipped models get)
sys.argv = _argv


def lerp(a, b, t):
    if isinstance(a, dict):
        assert set(a) == set(b), (sorted(a), sorted(b))
        return {k: lerp(a[k], b[k], t) for k in a}
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    assert a.shape == b.shape
    return ((1 - t) * a + t * b).astype(np.float32)


def main():
    base, tuned, t, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
    A = pickle.load(open(base, 'rb')); B = pickle.load(open(tuned, 'rb'))
    p, s = lerp(A['p'], B['p'], t), lerp(A['s'], B['s'], t)
    np.savez(out, **fold(p, s))
    print(f'{base} (epoch {A.get("ep")}) x {1 - t:.2f} + {tuned} (epoch {B.get("ep")}) x {t:.2f} -> {out}')


if __name__ == '__main__':
    main()
