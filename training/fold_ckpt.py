"""Fold BN of a training checkpoint into a model npz (for provisional builds while training runs)."""
import pickle, sys
import numpy as np
c = pickle.load(open(sys.argv[1], 'rb'))
p, s = c['p'], c['s']
out = {}
for i in range(5):
    sc = np.asarray(p[f'g{i}']) / np.sqrt(np.asarray(s[f'v{i}']) + 1e-5)
    out[f'c{i}w'] = np.asarray(p[f'c{i}']) * sc[None, None, None, :]
    out[f'c{i}b'] = np.asarray(p[f'b{i}']) - np.asarray(s[f'm{i}']) * sc
for k in ('f1', 'f1b', 'f2', 'f2b'):
    out[k] = np.asarray(p[k])
np.savez(sys.argv[2], **out)
print('epoch', c['ep'], '->', sys.argv[2])
