"""School prior: per-class ratio (frequency in a synthetic middle-school corpus) / (frequency the classifier
was trained with), clipped below at 0.2. The engine raises it to opts.prior and re-weights class probabilities
when symbols: 'school'. Writes work/prior.json."""
import json, os, pickle, sys
from collections import Counter
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SCR = os.environ.get('NIB_SCRATCH', os.path.join(HERE, 'scratch'))
W = os.path.join(SCR, 'work')
sys.path.insert(0, HERE)
sys.argv = sys.argv[:1]
import lm_v2 as L  # noqa: E402  (the synthetic corpus generator)

classes = open(os.path.join(W, 'ep', 'classes.txt')).read().split('\n')
C = len(classes); junk = classes.index('junk')
d = pickle.load(open(os.path.join(W, 'samples_v2.pkl'), 'rb'))['train']
cnt = Counter(s[0] for s in d)
counts = np.array([cnt.get(c, 0) for c in classes], float)
big = np.sort(counts[np.arange(C) != junk])[-10:].mean()
cw = np.clip((big / np.maximum(counts, 1)) ** 0.3, 1, 6)          # the class weights train_v2.py used
src = counts * cw; src[junk] = 0; src /= src.sum()
L.rng.seed(5)
rows = []
for _ in range(30000):
    s = L.rng.choice(L.T)().replace('\\approx', '=')
    L.rows_of(L.parse(L.tokenize(s)), '<s>', rows)
tc = Counter(t for row in rows for t in row[1:-1] if t in classes)
tgt = np.array([tc.get(c, 0) for c in classes], float) + 0.5
tgt[junk] = 0; tgt /= tgt.sum()
ratio = np.where(src > 0, tgt / np.maximum(src, 1e-9), 1.0); ratio[junk] = 1.0
ratio = np.clip(ratio, 0.2, 20)
json.dump({'school': [round(float(x), 4) for x in ratio]}, open(os.path.join(W, 'prior.json'), 'w'))
print('wrote', os.path.join(W, 'prior.json'))
