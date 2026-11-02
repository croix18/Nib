"""Train the symbol CNN in JAX (CPU). Saves BN-folded float weights to model.npz."""
import os, sys, time, math, pickle
import numpy as np
import jax, jax.numpy as jnp
import optax

W = os.path.join(os.environ.get('NIB_SCRATCH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scratch')), 'work')
EP = os.path.join(W, 'ep')
CLASSES = open(os.path.join(EP, 'classes.txt')).read().split('\n')
C = len(CLASSES)
JUNK = CLASSES.index('junk')
EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 14
NAUG = int(sys.argv[2]) if len(sys.argv) > 2 else 6
OUT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(W, 'model.npz')
EXTRA = sys.argv[4].split(',') if len(sys.argv) > 4 else []   # extra npz files merged into each epoch
B = 256
CH = [(4, 16), (16, 32), (32, 32), (32, 64), (64, 64)]
FC1 = 128
NZ = 5


def he(key, shape, fan_in):
    return jax.random.normal(key, shape) * math.sqrt(2.0 / fan_in)


def init(key):
    ks = jax.random.split(key, 8)
    p, s = {}, {}
    for i, (ci, co) in enumerate(CH):
        p[f'c{i}'] = he(ks[i], (3, 3, ci, co), 9 * ci)
        p[f'g{i}'] = jnp.ones(co)
        p[f'b{i}'] = jnp.zeros(co)
        s[f'm{i}'] = jnp.zeros(co)
        s[f'v{i}'] = jnp.ones(co)
    p['f1'] = he(ks[5], (4 * 4 * 64 + NZ, FC1), 4 * 4 * 64 + NZ)
    p['f1b'] = jnp.zeros(FC1)
    p['f2'] = he(ks[6], (FC1, C), FC1) * 0.5
    p['f2b'] = jnp.zeros(C)
    return p, s


def conv(x, w):
    return jax.lax.conv_general_dilated(x, w, (1, 1), 'SAME', dimension_numbers=('NHWC', 'HWIO', 'NHWC'))


def pool(x):
    return jax.lax.reduce_window(x, -jnp.inf, jax.lax.max, (1, 2, 2, 1), (1, 2, 2, 1), 'VALID')


def forward(p, s, x, z, train, key=None):
    ns = {}
    h = x
    for i in range(5):
        h = conv(h, p[f'c{i}'])
        if train:
            m = h.mean((0, 1, 2))
            v = h.var((0, 1, 2))
            ns[f'm{i}'] = 0.9 * s[f'm{i}'] + 0.1 * m
            ns[f'v{i}'] = 0.9 * s[f'v{i}'] + 0.1 * v
        else:
            m, v = s[f'm{i}'], s[f'v{i}']
        h = (h - m) * jax.lax.rsqrt(v + 1e-5) * p[f'g{i}'] + p[f'b{i}']
        h = jax.nn.relu(h)
        if i in (0, 2, 4):
            h = pool(h)
    h = h.reshape(h.shape[0], -1)
    h = jnp.concatenate([h, z], 1)
    h = jax.nn.relu(h @ p['f1'] + p['f1b'])
    if train:
        keep = jax.random.bernoulli(key, 0.7, h.shape)
        h = jnp.where(keep, h / 0.7, 0)
    return h @ p['f2'] + p['f2b'], (ns if train else s)


def main():
    # class weights from the clean train set
    tr = np.load(os.path.join(EP, 'train_clean.npz'))
    counts = np.bincount(tr['Y'], minlength=C).astype(np.float64)
    big = np.sort(counts[np.arange(C) != JUNK])[-10:].mean()
    cw = np.clip((big / np.maximum(counts, 1)) ** 0.3, 1, 6)
    cw[JUNK] = 0.6
    cw = jnp.asarray(cw, jnp.float32)
    va = np.load(os.path.join(EP, 'valid.npz'))
    Xv, Zv, Yv = va['X'], va['Z'], va['Y'].astype(np.int32)

    files = [os.path.join(EP, f'train_aug{e}.npz') for e in range(1, NAUG + 1)] + [os.path.join(EP, 'train_clean.npz')]
    n_per = len(tr['Y']) + sum(len(np.load(f)['Y']) for f in EXTRA)
    steps_per = n_per // B
    total = steps_per * EPOCHS
    sched = optax.warmup_cosine_decay_schedule(0.0, 2e-3, 300, total, 1e-5)
    mask = lambda p: {k: (v.ndim > 1) for k, v in p.items()}
    opt = optax.adamw(sched, weight_decay=1e-4, mask=mask)
    p, s = init(jax.random.PRNGKey(0))
    o = opt.init(p)

    def loss_fn(p, s, x, z, y, key):
        logits, ns = forward(p, s, x, z, True, key)
        oh = jax.nn.one_hot(y, C) * 0.95 + 0.05 / C
        l = -(oh * jax.nn.log_softmax(logits)).sum(-1)
        w = cw[y]
        return (l * w).sum() / w.sum(), ns

    @jax.jit
    def step(p, s, o, x, z, y, key):
        x = x.astype(jnp.float32) / 255.0
        (l, ns), g = jax.value_and_grad(loss_fn, has_aux=True)(p, s, x, z, y, key)
        up, o = opt.update(g, o, p)
        return optax.apply_updates(p, up), ns, o, l

    @jax.jit
    def predict(p, s, x, z):
        return forward(p, s, x.astype(jnp.float32) / 255.0, z, False)[0]

    def evaluate(p, s):
        preds = []
        top3 = []
        for i in range(0, len(Yv), 1024):
            lg = np.asarray(predict(p, s, Xv[i:i + 1024], Zv[i:i + 1024]))
            preds.append(lg.argmax(1))
            top3.append(np.argsort(-lg, 1)[:, :3])
        pr = np.concatenate(preds)
        t3 = np.concatenate(top3)
        real = Yv != JUNK
        acc = (pr[real] == Yv[real]).mean()
        acc3 = (t3[real] == Yv[real][:, None]).any(1).mean()
        jrec = (pr[~real] == JUNK).mean()
        jfp = (pr[real] == JUNK).mean()
        return acc, acc3, jrec, jfp

    key = jax.random.PRNGKey(1)
    rng = np.random.default_rng(0)
    t0 = time.time()
    ck = OUT + '.ckpt'
    start = 0
    if os.path.exists(ck):
        c = pickle.load(open(ck, 'rb'))
        p = jax.tree.map(jnp.asarray, c['p']); s = jax.tree.map(jnp.asarray, c['s']); o = jax.tree.map(jnp.asarray, c['o'])
        key = jnp.asarray(c['key']); rng = c['rng']; start = c['ep']
        print(f'resumed after epoch {start}', flush=True)
    for ep in range(start, EPOCHS):
        d = np.load(files[ep % len(files)])
        X, Z, Y = d['X'], d['Z'], d['Y'].astype(np.int32)
        for f in EXTRA:
            e = np.load(f)
            X = np.concatenate([X, e['X']]); Z = np.concatenate([Z, e['Z']]); Y = np.concatenate([Y, e['Y'].astype(np.int32)])
        perm = rng.permutation(len(Y))
        ls = []
        for k in range(steps_per):
            idx = np.sort(perm[k * B:(k + 1) * B])
            key, sk = jax.random.split(key)
            p, s, o, l = step(p, s, o, X[idx], Z[idx], Y[idx], sk)
            if k % 50 == 0:
                ls.append(float(l))
        del X, Z, Y, d
        acc, acc3, jrec, jfp = evaluate(p, s)
        pickle.dump({'p': jax.device_get(p), 's': jax.device_get(s), 'o': jax.device_get(o), 'key': np.asarray(key), 'rng': rng, 'ep': ep + 1},
                    open(ck + '.tmp', 'wb'))
        os.replace(ck + '.tmp', ck)
        print(f'ep {ep+1}/{EPOCHS} {files[ep % len(files)].split("/")[-1]} loss {np.mean(ls):.3f} '
              f'val acc {acc:.4f} top3 {acc3:.4f} junk-recall {jrec:.3f} junk-fp {jfp:.4f}  {time.time()-t0:.0f}s', flush=True)
    # fold BN and save
    out = {}
    for i in range(5):
        sc = np.asarray(p[f'g{i}']) / np.sqrt(np.asarray(s[f'v{i}']) + 1e-5)
        out[f'c{i}w'] = np.asarray(p[f'c{i}']) * sc[None, None, None, :]
        out[f'c{i}b'] = np.asarray(p[f'b{i}']) - np.asarray(s[f'm{i}']) * sc
    for k in ('f1', 'f1b', 'f2', 'f2b'):
        out[k] = np.asarray(p[k])
    np.savez(OUT, **out)
    print('saved', OUT)


if __name__ == '__main__':
    main()
