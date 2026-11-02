"""Train the two small geometry models and export them as JSON:
  join: are time-consecutive strokes k, k+1 part of the same symbol?
  rel:  relation of a unit to the current baseline unit: Right / Sup / Sub
Feature code here is mirrored exactly in the JS engine (joinFeatures / relFeatures).
"""
import json, math, os, sys
import numpy as np
from sklearn.neural_network import MLPClassifier
from raster import ref_size

S = os.environ.get('NIB_SCRATCH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scratch'))
W = os.path.join(S, 'work')

# ------------------------------------------------------------ typography classes
ASC = set('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZbdfhkilt!?') | {'\\delta', '\\theta', '\\lambda', '\\Delta', '$', '%'}
DESC = set('gjpqy') | {'\\beta', '\\gamma', '\\mu', '\\rho', '\\phi', '\\chi', '\\psi'}
XH = set('acemnorsuvwxz') | {'\\alpha', '\\pi', '\\sigma', '\\omega', '\\infty', '\\epsilon', '\\nu'}
OP = {'+', '-', '=', '\\times', '\\div', '\\pm', '\\ne', '<', '>', '\\le', '\\ge', '\\rightarrow', '\\in',
      '\\forall', '\\exists', '\\cdot'}
SMALL = {'.', ',', '\\prime', '\\ldots', "'"}
PAREN = {'(', ')', '[', ']', '\\{', '\\}', '|'}
BIG = {'\\sum', '\\int', '\\lim', '\\log', '\\sin', '\\cos', '\\tan'}
NT = 10  # 0 asc 1 xh 2 desc 3 op 4 small 5 paren 6 frac 7 root 8 big 9 slash


def sym_type(label):
    if label in ASC: return 0
    if label in XH: return 1
    if label in DESC: return 2
    if label in OP: return 3
    if label in SMALL: return 4
    if label in PAREN: return 5
    if label in BIG: return 8
    if label == '/': return 9
    if label == '\\sqrt': return 7
    return 0


# ------------------------------------------------------------ join model
def sbox(s):
    return np.array([s[:, 0].min(), s[:, 1].min(), s[:, 0].max(), s[:, 1].max()])


def seg_intersections(a, b, cap=3):
    # count proper intersections between polylines (subsampled), capped
    def sub(s):
        if len(s) <= 24: return s
        idx = np.linspace(0, len(s) - 1, 24).round().astype(int)
        return s[idx]
    a = sub(a); b = sub(b)
    n = 0
    for i in range(len(a) - 1):
        p, r = a[i], a[i + 1] - a[i]
        for j in range(len(b) - 1):
            q, sv = b[j], b[j + 1] - b[j]
            den = r[0] * sv[1] - r[1] * sv[0]
            if abs(den) < 1e-12: continue
            t = ((q[0] - p[0]) * sv[1] - (q[1] - p[1]) * sv[0]) / den
            u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den
            if 0 <= t <= 1 and 0 <= u <= 1:
                n += 1
                if n >= cap: return n
    return n


def min_dist(a, b):
    def sub(s):
        if len(s) <= 32: return s
        idx = np.linspace(0, len(s) - 1, 32).round().astype(int)
        return s[idx]
    a = sub(a); b = sub(b)
    d = a[:, None, :] - b[None, :, :]
    return float(np.sqrt((d * d).sum(-1)).min())


def plen(s):
    if len(s) < 2: return 0.0
    d = np.diff(s, axis=0)
    return float(np.sqrt((d * d).sum(1)).sum())


def lg(x):
    return math.log(max(x, 1e-4))


def join_features(a, b, ref):
    A, B = sbox(a), sbox(b)
    wa, ha = A[2] - A[0], A[3] - A[1]
    wb, hb = B[2] - B[0], B[3] - B[1]
    gap = max(0.0, B[0] - A[2], A[0] - B[2], B[1] - A[3], A[1] - B[3])
    ox = max(0.0, min(A[2], B[2]) - max(A[0], B[0]))
    oy = max(0.0, min(A[3], B[3]) - max(A[1], B[1]))
    e = 0.05 * ref
    ux = max(A[2], B[2]) - min(A[0], B[0])
    uy = max(A[3], B[3]) - min(A[1], B[1])
    return [
        gap / ref,
        min_dist(a, b) / ref,
        ox / (min(wa, wb) + e),
        oy / (min(ha, hb) + e),
        ((B[0] + B[2]) - (A[0] + A[2])) / 2 / ref,
        ((B[1] + B[3]) - (A[1] + A[3])) / 2 / ref,
        lg((ha + e) / ref), lg((wa + e) / ref), lg((hb + e) / ref), lg((wb + e) / ref),
        seg_intersections(a, b) / 3,
        float(np.hypot(*(b[0] - a[-1]))) / ref,
        lg((ux + e) / ref), lg((uy + e) / ref),
        lg(plen(a) / ref + 0.01), lg(plen(b) / ref + 0.01),
    ]


# ------------------------------------------------------------ relation model
def is_digit(l): return l is not None and len(l) == 1 and l.isdigit()
def is_letter(l): return l is not None and ((len(l) == 1 and l.isalpha()) or l in ('\\alpha', '\\beta', '\\theta', '\\pi', '\\lambda', '\\mu', '\\sigma', '\\phi', '\\gamma', '\\Delta'))


def rel_features(P, tP, Cb, tC, ref, lP=None, lC=None):
    """P, Cb: unit boxes [x0,y0,x1,y1]; tP, tC: type ids; lP, lC: symbol labels (None for compounds)."""
    hP = P[3] - P[1]; wP = P[2] - P[0]
    hC = Cb[3] - Cb[1]
    hs = max(hP, 0.5 * ref)
    cyP = (P[1] + P[3]) / 2; cyC = (Cb[1] + Cb[3]) / 2
    oy = max(0.0, min(P[3], Cb[3]) - max(P[1], Cb[1]))
    f = [0.0] * (2 * NT)
    f[tP] = 1.0
    f[NT + tC] = 1.0
    f += [
        (Cb[1] - P[1]) / ref, (Cb[3] - P[3]) / ref, (cyC - cyP) / ref,
        (Cb[1] - P[1]) / hs, (Cb[3] - P[3]) / hs, (cyC - cyP) / hs,
        lg((hC + 0.02 * ref) / hs), lg((hC + 0.02 * ref) / ref), lg((hP + 0.02 * ref) / ref),
        (Cb[0] - P[2]) / ref, (Cb[0] - P[0]) / max(wP, 0.5 * ref),
        oy / (min(hP, hC) + 0.02 * ref),
        float(is_digit(lP)), float(is_letter(lP)), float(is_digit(lC)), float(is_letter(lC)),
    ]
    return f


def unit_box(u, boxes):
    """Box of a unit without its scripts."""
    bs = [boxes[u['s']]]
    if u['k'] == 'f':
        bs += [row_box(u['num'], boxes), row_box(u['den'], boxes)]
    elif u['k'] == 'r':
        bs.append(row_box(u['body'], boxes))
        if 'idx' in u: bs.append(row_box(u['idx'], boxes))
    bs = [b for b in bs if b is not None]
    return np.array([min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)])


def full_box(u, boxes):
    bs = [unit_box(u, boxes)]
    for k in ('sup', 'sub', 'above', 'below'):
        if k in u:
            b = row_box(u[k], boxes)
            if b is not None: bs.append(b)
    return np.array([min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)])


def row_box(row, boxes):
    if not row: return None
    bs = [full_box(u, boxes) for u in row]
    return np.array([min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs)])


def unit_label(u, labels):
    return labels[u['s']] if u['k'] == 's' else None


def unit_type(u, labels):
    if u['k'] == 'f': return 6
    if u['k'] == 'r': return 7
    return sym_type(labels[u['s']])


def flatten_units(row):
    """All units in a script subtree, at unit granularity (fractions/roots atomic)."""
    out = []
    for u in row:
        out.append(u)
        for k in ('sup', 'sub'):
            if k in u: out += flatten_units(u[k])
    return out


def rel_pairs(row, boxes, labels, ref, X, Y):
    for i, u in enumerate(row):
        if 'above' in u or 'below' in u:
            continue
        P = unit_box(u, boxes); tP = unit_type(u, labels)
        if i + 1 < len(row):
            v = row[i + 1]
            X.append(rel_features(P, tP, unit_box(v, boxes), unit_type(v, labels), ref, unit_label(u, labels), unit_label(v, labels))); Y.append(0)
        for k, lab in (('sup', 1), ('sub', 2)):
            if k in u:
                for v in flatten_units(u[k]):
                    X.append(rel_features(P, tP, unit_box(v, boxes), unit_type(v, labels), ref, unit_label(u, labels), unit_label(v, labels))); Y.append(lab)
    for u in row:
        for k in ('sup', 'sub', 'num', 'den', 'body', 'idx', 'above', 'below'):
            if k in u: rel_pairs(u[k], boxes, labels, ref, X, Y)


def build(splits):
    JX, JY, RX, RY = [], [], [], []
    for line in (l for sp in splits for l in open(f'{S}/data/{sp}.jsonl')):
        r = json.loads(line)
        strokes = [np.asarray(s, np.float64) for s in r['strokes']]
        if not strokes: continue
        ref = ref_size(strokes)
        owner = {}
        for si, s in enumerate(r['symbols']):
            for k in s['strokes']: owner[k] = si
        for k in range(len(strokes) - 1):
            if k in owner and k + 1 in owner:
                JX.append(join_features(strokes[k], strokes[k + 1], ref)); JY.append(int(owner[k] == owner[k + 1]))
        if r['tree'] is not None:
            labels = [s['label'] for s in r['symbols']]
            boxes = []
            for s in r['symbols']:
                pts = np.concatenate([strokes[k] for k in s['strokes']])
                boxes.append(np.array([pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max()]))
            rel_pairs(r['tree'], boxes, labels, ref, RX, RY)
    return np.array(JX), np.array(JY), np.array(RX), np.array(RY)


def export(clf, mu, sd):
    return {'mu': mu.tolist(), 'sd': sd.tolist(),
            'W': [w.T.round(6).tolist() for w in clf.coefs_], 'b': [b.round(6).tolist() for b in clf.intercepts_]}


def main():
    tr = build(['train', 'valid', 't12']); va = build(['t13'])
    out = {}
    for name, (Xt, Yt, Xv, Yv), hid in (('join', (tr[0], tr[1], va[0], va[1]), (32, 16)),
                                         ('rel', (tr[2], tr[3], va[2], va[3]), (48, 24))):
        mu = Xt.mean(0); sd = Xt.std(0) + 1e-6
        if name == 'rel':
            mu[:2 * NT] = 0; sd[:2 * NT] = 1
        clf = MLPClassifier(hidden_layer_sizes=hid, max_iter=300, early_stopping=True, random_state=0, alpha=1e-4)
        clf.fit((Xt - mu) / sd, Yt)
        pv = clf.predict((Xv - mu) / sd)
        print(name, 'train n', len(Yt), 'valid n', len(Yv), 'valid acc', (pv == Yv).mean().round(4),
              'class balance', np.bincount(Yv) / len(Yv))
        if name == 'rel':
            from sklearn.metrics import confusion_matrix
            print(confusion_matrix(Yv, pv))
        out[name] = export(clf, mu, sd)
    json.dump(out, open(f'{W}/geo_models_v2.json', 'w'))
    # dump a few feature vectors for JS parity tests
    np.save(f'{W}/join_valid_X.npy', va[0][:200]); np.save(f'{W}/rel_valid_X.npy', va[2][:200])


if __name__ == '__main__':
    main()
