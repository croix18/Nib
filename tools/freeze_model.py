"""Freeze the trained models into model/nib-data.json, the data build.py puts into dist/nib.js.

  python3 tools/freeze_model.py [model.npz] [--out model/nib-data.json]

Inputs, from NIB_WORK (default $NIB_SCRATCH/work, training/scratch/work; see training/README.md):
  model.npz              the symbol classifier (default model_v4s50.npz, training/README.md §2c), quantized here to int8
  ep/classes.txt         its classes
  geo_models_v2.json     the stroke-join and layout-relation MLPs (geo_models.json if there is no v2, and it says so)
  lm_v2.json             the context model (lm.json if there is no v2, and it says so)
  prior.json             the school-vs-CROHME symbol prior
and KaTeX's fonts and metrics for the typeset view (NIB_KATEX, default node_modules/katex, then demo/node_modules/katex).
Needs numpy. Stops with an error if any input is missing: it never writes a model with zero weights."""
import argparse, base64, hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.environ.get('NIB_WORK') or os.path.join(os.environ.get('NIB_SCRATCH', os.path.join(ROOT, 'training', 'scratch')), 'work')
OUT = os.path.join(ROOT, 'model', 'nib-data.json')

# Typeset view: KaTeX's fonts (SIL Open Font License 1.1, embedded unchanged) and their metrics for the characters
# Nib can write. Metrics per code point: [depth, height, italic correction, width] in em.
TS_FONTS = {'m': 'Main-Regular', 'i': 'Math-Italic', 's': 'Size1-Regular'}
TS_CHARS = ('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+=<>()[]{}|/.,;:!?%$−×÷±'
            '≤≥⋅→∈∞′∘πθαβγλμσϕΔ'
            '∑∫∀∃…√')


def fail(msg):
    sys.exit('freeze_model.py: ' + msg)


def need(path, what):
    if not os.path.exists(path):
        fail(f'no {what} at {path}')
    return path


def pick(what, *names):
    """The first of names in WORK; says which it used when it is not the first."""
    for i, n in enumerate(names):
        p = os.path.join(WORK, n)
        if os.path.exists(p):
            if i:
                print(f'NOTE: no {names[0]} in {WORK}; using the older {n} for the {what}')
            return p
    fail(f'no {what} in {WORK} (looked for {", ".join(names)})')


def katex_dir():
    if os.environ.get('NIB_KATEX'):
        return need(os.environ['NIB_KATEX'], 'KaTeX (NIB_KATEX)')
    for p in (os.path.join(ROOT, 'node_modules', 'katex'), os.path.join(ROOT, 'demo', 'node_modules', 'katex')):
        if os.path.exists(p):
            return p
    fail('no KaTeX in node_modules or demo/node_modules: run npm ci (or set NIB_KATEX)')


def rnd(o):
    if isinstance(o, list): return [rnd(x) for x in o]
    if isinstance(o, float): return float('%.5g' % o)
    return o


def cnn_data(model, C):
    import numpy as np
    m = np.load(model)
    names = [n for n in ('c0', 'c1', 'c2', 'c3', 'c4', 'o0', 'o1', 'o2') if n + 'w' in m] + ['f1', 'f2']
    W = {n: (m[n] if n in ('f1', 'f2') else m[n + 'w']) for n in names}
    Bs = {n: m[n + 'b'] for n in names}
    if W['f2'].shape[-1] != C:
        fail(f'{model} has {W["f2"].shape[-1]} outputs but ep/classes.txt has {C} classes')
    qs, ss, bs, layout = [], [], [], []
    for n in names:
        w = np.asarray(W[n], np.float32)
        co = w.shape[-1]
        flat = w.reshape(-1, co)
        scale = np.abs(flat).max(0) / 127.0
        scale[scale == 0] = 1e-8
        q = np.clip(np.round(flat / scale), -127, 127).astype(np.int8)
        qs.append(q.reshape(-1)); ss.append(scale.astype(np.float32)); bs.append(np.asarray(Bs[n], np.float32))
        layout.append([n, int(q.size), co, int(w.shape[0]) if n.startswith('o') else 3])
    b64 = lambda a: base64.b64encode(a.tobytes()).decode()
    return {'q': b64(np.concatenate(qs)), 's': b64(np.concatenate(ss)), 'b': b64(np.concatenate(bs)), 'layout': layout,
            'id': hashlib.sha1(np.concatenate(qs).tobytes() + np.concatenate(ss).tobytes()).hexdigest()[:12]}


def typeset_data(katex):
    fm_src = open(need(os.path.join(katex, 'src', 'fontMetricsData.js'), 'KaTeX font metrics')).read()
    fm_src = fm_src[fm_src.index('export default') + len('export default'):].strip().rstrip(';')
    fm = json.loads(re.sub(r',(\s*[}\]])', r'\1', fm_src))
    tsfm = {}
    for k, name in TS_FONTS.items():
        t = fm[name]
        tsfm[k] = {str(ord(c)): [round(v, 5) for v in (t[str(ord(c))][0], t[str(ord(c))][1], t[str(ord(c))][2], t[str(ord(c))][4])]
                   for c in TS_CHARS if str(ord(c)) in t}
    tsfont = {k: base64.b64encode(open(need(os.path.join(katex, 'dist', 'fonts', f'KaTeX_{name}.woff2'), 'KaTeX font'), 'rb').read()).decode()
              for k, name in TS_FONTS.items()}
    return tsfm, tsfont


def main():
    ap = argparse.ArgumentParser(description='trained models + KaTeX -> model/nib-data.json')
    ap.add_argument('model', nargs='?', default=os.path.join(WORK, 'model_v4s50.npz'))
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    try:
        import numpy  # noqa: F401
    except ImportError:
        fail('needs numpy (pip install numpy)')
    model = need(a.model, 'model')
    classes = open(need(os.path.join(WORK, 'ep', 'classes.txt'), 'class list')).read().split('\n')
    geo_p = pick('geometry models', 'geo_models_v2.json', 'geo_models.json')
    lm_p = pick('context model', 'lm_v2.json', 'lm.json')
    prior_p = pick('symbol prior', 'prior.json')
    katex = katex_dir()
    kver = json.load(open(os.path.join(katex, 'package.json'))).get('version', '?') if os.path.exists(os.path.join(katex, 'package.json')) else '?'
    geo, lm, prior = json.load(open(geo_p)), json.load(open(lm_p)), json.load(open(prior_p))
    data = {
        'classes': classes,
        'cnn': cnn_data(model, len(classes)),
        'join': {k: rnd(v) for k, v in geo['join'].items()},
        'rel': {k: rnd(v) for k, v in geo['rel'].items()},
        'lm': lm,
        'prior': prior,
    }
    data['tsfm'], data['tsfont'] = typeset_data(katex)
    for what, p in (('model', model), ('classes', os.path.join(WORK, 'ep', 'classes.txt')), ('geometry', geo_p),
                    ('context', lm_p), ('prior', prior_p), (f'KaTeX {kver}', katex)):
        print(f'  {what:<14} {p}')
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    out = json.dumps(data, separators=(',', ':'))
    open(a.out, 'w').write(out)
    print(f'{os.path.relpath(os.path.abspath(a.out), ROOT)}: {len(classes)} classes, cnn.id {data["cnn"]["id"]}, {len(out) // 1024} KB')


if __name__ == '__main__':
    main()
