"""v2 symbol classifier: wider raster CNN + a 1-D trajectory branch. JAX on CPU, checkpointed per epoch.
python3 train_v2.py EPOCHS NAUG OUT.npz"""
import os, sys, time, math, pickle
import numpy as np
import jax, jax.numpy as jnp
import optax

W = os.path.join(os.environ.get('NIB_SCRATCH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scratch')), 'work')
EP = os.path.join(W, 'ep2')
CLASSES = open(os.path.join(W, 'ep', 'classes.txt')).read().split('\n')
C = len(CLASSES)
JUNK = CLASSES.index('junk')
EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 14
NAUG = int(sys.argv[2]) if len(sys.argv) > 2 else 6
OUT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(W, 'model_v2.npz')
B = 256
CH = [(4, 24), (24, 48), (48, 48), (48, 96), (96, 96)]
OCH = [(5, 32, 5), (32, 64, 5), (64, 64, 3)]  # (in, out, kernel)
FC1 = 192
NZ = 5
FEAT = 4 * 4 * 96 + 2 * 64 + NZ


def he(key, shape, fan_in):
    return jax.random.normal(key, shape) * math.sqrt(2.0 / fan_in)


def init(key):
    ks = jax.random.split(key, 16)
    p, s = {}, {}
    for i, (ci, co) in enumerate(CH):
        p[f'c{i}'] = he(ks[i], (3, 3, ci, co), 9 * ci)
        p[f'g{i}'] = jnp.ones(co); p[f'b{i}'] = jnp.zeros(co)
        s[f'm{i}'] = jnp.zeros(co); s[f'v{i}'] = jnp.ones(co)
    for i, (ci, co, k) in enumerate(OCH):
        p[f'o{i}'] = he(ks[6 + i], (k, ci, co), k * ci)
        p[f'og{i}'] = jnp.ones(co); p[f'ob{i}'] = jnp.zeros(co)
        s[f'om{i}'] = jnp.zeros(co); s[f'ov{i}'] = jnp.ones(co)
    p['f1'] = he(ks[10], (FEAT, FC1), FEAT); p['f1b'] = jnp.zeros(FC1)
    p['f2'] = he(ks[11], (FC1, C), FC1) * 0.5; p['f2b'] = jnp.zeros(C)
    return p, s


def conv2(x, w):
    return jax.lax.conv_general_dilated(x, w, (1, 1), 'SAME', dimension_numbers=('NHWC', 'HWIO', 'NHWC'))


def conv1(x, w):
    return jax.lax.conv_general_dilated(x, w, (1,), 'SAME', dimension_numbers=('NWC', 'WIO', 'NWC'))


def pool2(x):
    return jax.lax.reduce_window(x, -jnp.inf, jax.lax.max, (1, 2, 2, 1), (1, 2, 2, 1), 'VALID')


def pool1(x):
    return jax.lax.reduce_window(x, -jnp.inf, jax.lax.max, (1, 2, 1), (1, 2, 1), 'VALID')


def bn(h, p, s, ns, g, b, m, v, train, axes):
    if train:
        mu = h.mean(axes); var = h.var(axes)
        ns[m] = 0.9 * s[m] + 0.1 * mu; ns[v] = 0.9 * s[v] + 0.1 * var
    else:
        mu, var = s[m], s[v]
    return jax.nn.relu((h - mu) * jax.lax.rsqrt(var + 1e-5) * p[g] + p[b])


def forward(p, s, x, o, z, train, key=None):
    ns = {}
    h = x
    for i in range(5):
        h = bn(conv2(h, p[f'c{i}']), p, s, ns, f'g{i}', f'b{i}', f'm{i}', f'v{i}', train, (0, 1, 2))
        if i in (0, 2, 4):
            h = pool2(h)
    h = h.reshape(h.shape[0], -1)
    g = o
    for i in range(3):
        g = bn(conv1(g, p[f'o{i}']), p, s, ns, f'og{i}', f'ob{i}', f'om{i}', f'ov{i}', train, (0, 1))
        if i == 1:
            g = pool1(g)
    g = jnp.concatenate([g.max(1), g.mean(1)], 1)
    f = jnp.concatenate([h, g, z], 1)
    f = jax.nn.relu(f @ p['f1'] + p['f1b'])
    if train:
        keep = jax.random.bernoulli(key, 0.7, f.shape)
        f = jnp.where(keep, f / 0.7, 0)
    return f @ p['f2'] + p['f2b'], (ns if train else s)


def fold(p, s):
    out = {}
    for i in range(5):
        sc = np.asarray(p[f'g{i}']) / np.sqrt(np.asarray(s[f'v{i}']) + 1e-5)
        out[f'c{i}w'] = np.asarray(p[f'c{i}']) * sc[None, None, None, :]
        out[f'c{i}b'] = np.asarray(p[f'b{i}']) - np.asarray(s[f'm{i}']) * sc
    for i in range(3):
        sc = np.asarray(p[f'og{i}']) / np.sqrt(np.asarray(s[f'ov{i}']) + 1e-5)
        out[f'o{i}w'] = np.asarray(p[f'o{i}']) * sc[None, None, :]
        out[f'o{i}b'] = np.asarray(p[f'ob{i}']) - np.asarray(s[f'om{i}']) * sc
    for k in ('f1', 'f1b', 'f2', 'f2b'):
        out[k] = np.asarray(p[k])
    return out


def main():
    tr = np.load(os.path.join(EP, 'train_clean.npz'))
    counts = np.bincount(tr['Y'], minlength=C).astype(np.float64)
    n_per = len(tr['Y'])
    del tr
    big = np.sort(counts[np.arange(C) != JUNK])[-10:].mean()
    cw = np.clip((big / np.maximum(counts, 1)) ** 0.3, 1, 6)
    cw[JUNK] = 0.6
    cw = jnp.asarray(cw, jnp.float32)
    va = np.load(os.path.join(EP, 'valid.npz'))
    Xv, Ov, Zv, Yv = va['X'], va['O'], va['Z'], va['Y'].astype(np.int32)

    files = [os.path.join(EP, f'train_aug{e}.npz') for e in range(1, NAUG + 1)] + [os.path.join(EP, 'train_clean.npz')]
    steps_per = n_per // B
    total = steps_per * EPOCHS
    sched = optax.warmup_cosine_decay_schedule(0.0, 2e-3, 300, total, 1e-5)
    mask = lambda p: {k: (v.ndim > 1) for k, v in p.items()}
    opt = optax.adamw(sched, weight_decay=1e-4, mask=mask)
    p, s = init(jax.random.PRNGKey(0))
    o = opt.init(p)

    def loss_fn(p, s, x, ol, z, y, key):
        logits, ns = forward(p, s, x, ol, z, True, key)
        oh = jax.nn.one_hot(y, C) * 0.95 + 0.05 / C
        l = -(oh * jax.nn.log_softmax(logits)).sum(-1)
        w = cw[y]
        return (l * w).sum() / w.sum(), ns

    @jax.jit
    def step(p, s, o, x, ol, z, y, key):
        x = x.astype(jnp.float32) / 255.0
        ol = ol.astype(jnp.float32)
        (l, ns), g = jax.value_and_grad(loss_fn, has_aux=True)(p, s, x, ol, z, y, key)
        up, o = opt.update(g, o, p)
        return optax.apply_updates(p, up), ns, o, l

    @jax.jit
    def predict(p, s, x, ol, z):
        return forward(p, s, x.astype(jnp.float32) / 255.0, ol.astype(jnp.float32), z, False)[0]

    def evaluate(p, s):
        preds, top3 = [], []
        for i in range(0, len(Yv), 1024):
            lg = np.asarray(predict(p, s, Xv[i:i + 1024], Ov[i:i + 1024], Zv[i:i + 1024]))
            preds.append(lg.argmax(1)); top3.append(np.argsort(-lg, 1)[:, :3])
        pr = np.concatenate(preds); t3 = np.concatenate(top3)
        real = Yv != JUNK
        return ((pr[real] == Yv[real]).mean(), (t3[real] == Yv[real][:, None]).any(1).mean(),
                (pr[~real] == JUNK).mean(), (pr[real] == JUNK).mean())

    key = jax.random.PRNGKey(1)
    rng = np.random.default_rng(0)
    ck = OUT + '.ckpt'
    start = 0
    if os.path.exists(ck):
        c = pickle.load(open(ck, 'rb'))
        p = jax.tree.map(jnp.asarray, c['p']); s = jax.tree.map(jnp.asarray, c['s']); o = jax.tree.map(jnp.asarray, c['o'])
        key = jnp.asarray(c['key']); rng = c['rng']; start = c['ep']
        print(f'resumed after epoch {start}', flush=True)
    t0 = time.time()
    for ep in range(start, EPOCHS):
        while not os.path.exists(files[ep % len(files)]):  # epochs may still be rendering
            time.sleep(10)
        d = np.load(files[ep % len(files)])
        X, Ol, Z, Y = d['X'], d['O'], d['Z'], d['Y'].astype(np.int32)
        perm = rng.permutation(len(Y))
        ls = []
        for k in range(steps_per):
            idx = np.sort(perm[k * B:(k + 1) * B])
            key, sk = jax.random.split(key)
            p, s, o, l = step(p, s, o, X[idx], Ol[idx], Z[idx], Y[idx], sk)
            if k % 50 == 0:
                ls.append(float(l))
                if ep == start and k in (0, 50):
                    print(f'  step {k} loss {float(l):.3f}  {time.time()-t0:.0f}s', flush=True)
        del X, Ol, Z, Y, d
        acc, acc3, jrec, jfp = evaluate(p, s)
        pickle.dump({'p': jax.device_get(p), 's': jax.device_get(s), 'o': jax.device_get(o), 'key': np.asarray(key), 'rng': rng, 'ep': ep + 1},
                    open(ck + '.tmp', 'wb'))
        os.replace(ck + '.tmp', ck)
        np.savez(OUT.replace('.npz', f'_ep{ep + 1}.npz'), **fold(jax.device_get(p), jax.device_get(s)))
        print(f'ep {ep+1}/{EPOCHS} {files[ep % len(files)].split("/")[-1]} loss {np.mean(ls):.3f} '
              f'val acc {acc:.4f} top3 {acc3:.4f} junk-recall {jrec:.3f} junk-fp {jfp:.4f}  {time.time()-t0:.0f}s', flush=True)
    np.savez(OUT, **fold(jax.device_get(p), jax.device_get(s)))
    print('saved', OUT, flush=True)


if __name__ == '__main__':
    main()
