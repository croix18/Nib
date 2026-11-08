"""v4: fine-tune data from the owner's own writing (the Board's training drill), mixed with an anchor of the
CROHME epochs so the network keeps the 2013/2019 writers.

    python3 make_epochs_v4.py split              # hold-out split -> scratch/work/board_split.json
    python3 make_epochs_v4.py samples            # board samples -> scratch/work/samples_board_v4.pkl
    python3 make_epochs_v4.py epochs 5 2 [copies] [anchor]
                                                 # 5 mixed epochs, 2 processes -> scratch/work/ep4/train_mix1..5.npz

Rows: scratch/data/board.jsonl (tools/training_to_jsonl.py). Only rows whose labels the writer checked are used:
gold rows (verified, and read as the prompt) and verified rows with a Fix. The writer test set is every such row
whose drill item is a multiple of 5; nothing of those items (any record, any key) is used in training.
Each epoch = `copies` augmented renderings of every board sample (alternately v2's augment and aug3's
augment_v3, a new seed per copy) + a random `anchor` samples of one existing CROHME epoch (ep2/ep3)."""
import json, os, pickle, random, sys
import numpy as np
from multiprocessing import Pool
from raster import rasterize, augment, G
from aug3 import augment_v3
from online import online_features, K, NF
from build_samples_v2 import row_samples

S = os.environ.get('NIB_SCRATCH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scratch'))
W = os.path.join(S, 'work')
CLASSES = open(os.path.join(W, 'ep', 'classes.txt')).read().split('\n')
CIDX = {c: i for i, c in enumerate(CLASSES)}
MAP = {'\\cdot': '.', '\\circ': 'o'}          # as tools/training_to_jsonl.py
SPLIT = os.path.join(W, 'board_split.json')
SAMPLES = os.path.join(W, 'samples_board_v4.pkl')
OUT = os.environ.get('NIB_EP4', os.path.join(W, 'ep4'))
HOLD = 5                                       # items 5, 10, ..., 60 are the writer test set
ANCHORS = [('ep3', 'train_aug1'), ('ep2', 'train_aug3'), ('ep3', 'train_aug2'), ('ep2', 'train_clean'),
           ('ep3', 'train_aug3'), ('ep2', 'train_aug5')]


def board_rows():
    u = {}
    for l in open(os.path.join(S, 'data', 'board.jsonl')):
        r = json.loads(l)
        u[r['id']] = r                           # fixed rows are written 3x; one copy each
    return list(u.values())


def checked(r):
    return r.get('gold') is True or (r.get('verified') is True and r.get('fixed') is True)


def held(r):
    return isinstance(r.get('item'), int) and r['item'] % HOLD == 0


def split():
    rows = board_rows()
    test = sorted(r['id'] for r in rows if checked(r) and held(r))
    train = sorted(r['id'] for r in rows if checked(r) and not held(r))
    json.dump({'rule': f'checked rows (gold, or verified and fixed); test = drill item % {HOLD} == 0, '
                       'and no record of a test item is used in training',
               'test_items': sorted(set(r['item'] for r in rows if checked(r) and held(r))),
               'test': test, 'train': train}, open(SPLIT, 'w'), indent=1)
    print(f'{len(test)} test rows, {len(train)} train rows -> {SPLIT}')


def map_row(r):
    syms = []
    for s in r['symbols']:
        lab = MAP.get(s['label'], s['label'])
        if lab in CIDX and lab != 'junk':
            syms.append({'label': lab, 'strokes': s['strokes']})
    return dict(r, symbols=syms)


def samples():
    sp = json.load(open(SPLIT))
    rows = {r['id']: r for r in board_rows()}
    items_test = set(sp['test_items'])
    rng = random.Random(7)
    out = {}
    for name in ('train', 'test'):
        sm = []
        for i in sp[name]:
            r = rows[i]
            assert (r.get('item') in items_test) == (name == 'test')
            sm += row_samples(map_row(r), rng, src='board', junk=(name == 'train'))
        out[name] = sm
        pos = sum(s[0] != 'junk' for s in sm)
        print(f'{name}: {pos} symbols, {len(sm) - pos} junk')
    pickle.dump(out, open(SAMPLES, 'wb'))


def render(args):
    lo, hi, seed, mode = args
    D = pickle.load(open(SAMPLES, 'rb'))['train']
    rng = np.random.default_rng(seed)
    n = hi - lo
    X = np.zeros((n, G, G, 4), np.uint8); O = np.zeros((n, K, NF), np.float16); Z = np.zeros((n, 5), np.float32)
    Y = np.zeros(n, np.int16)
    for k in range(n):
        lab, st, ref, src = D[(lo + k) % len(D)]
        st = augment(st, rng, ref) if mode == 2 else augment_v3(st, rng, ref)
        img, sc = rasterize(st, ref)
        X[k] = np.round(np.transpose(img, (1, 2, 0)) * 255).astype(np.uint8)
        O[k] = online_features(st, ref); Z[k] = sc; Y[k] = CIDX[lab]
    return X, O, Z, Y


def epochs(n_ep, procs, copies, anchor):
    os.makedirs(OUT, exist_ok=True)
    nb = len(pickle.load(open(SAMPLES, 'rb'))['train'])
    for e in range(1, n_ep + 1):
        out = os.path.join(OUT, f'train_mix{e}.npz')
        if os.path.exists(out):
            continue
        jobs = [(c * nb, (c + 1) * nb, 4000 + 100 * e + c, 2 if c % 2 == 0 else 3) for c in range(copies)]
        with Pool(procs) as p:
            res = p.map(render, jobs)
        d, f = ANCHORS[(e - 1) % len(ANCHORS)]
        a = np.load(os.path.join(W, d, f + '.npz'))
        Ya = a['Y']
        idx = np.sort(np.random.default_rng(e).choice(len(Ya), anchor, replace=False))
        X = np.concatenate([a['X'][idx]] + [r[0] for r in res])
        O = np.concatenate([a['O'][idx]] + [r[1] for r in res])
        Z = np.concatenate([a['Z'][idx]] + [r[2] for r in res])
        Y = np.concatenate([Ya[idx]] + [r[3] for r in res])
        B = np.zeros(len(Y), bool); B[anchor:] = True        # which samples are the writer's
        del a
        np.savez(out + '.tmp.npz', X=X, O=O, Z=Z, Y=Y, B=B)
        os.replace(out + '.tmp.npz', out)
        print(f'wrote {out} {X.shape}: anchor {anchor} from {d}/{f}, board {B.sum()} ({100 * B.mean():.1f}%)', flush=True)
        del X, O, Z, Y


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'split':
        split()
    elif cmd == 'samples':
        samples()
    elif cmd == 'epochs':
        epochs(int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 2,
               int(sys.argv[4]) if len(sys.argv) > 4 else 24, int(sys.argv[5]) if len(sys.argv) > 5 else 135000)
