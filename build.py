"""Assemble dist/nib.js: sources + quantised model data in one dependency-free file."""
import base64, hashlib, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.environ.get('NIB_WORK', os.path.join(HERE, 'training', 'scratch', 'work'))
MODEL = sys.argv[1] if len(sys.argv) > 1 else os.path.join(WORK, 'model_v3.npz')
VERSION = '1.5.2'

classes = open(os.path.join(WORK, 'ep', 'classes.txt')).read().split('\n')
C = len(classes)
if os.path.exists(MODEL):
    m = np.load(MODEL)
    names = [n for n in ('c0', 'c1', 'c2', 'c3', 'c4', 'o0', 'o1', 'o2') if n + 'w' in m] + ['f1', 'f2']
    W = {n: (m[n] if n in ('f1', 'f2') else m[n + 'w']) for n in names}
    Bs = {n: m[n + 'b'] for n in names}
else:
    print('WARNING: no model, writing zero weights')
    shp = [('c0', (3, 3, 4, 16)), ('c1', (3, 3, 16, 32)), ('c2', (3, 3, 32, 32)), ('c3', (3, 3, 32, 64)),
           ('c4', (3, 3, 64, 64)), ('f1', (1029, 128)), ('f2', (128, C))]
    names = [n for n, _ in shp]
    W = {n: np.zeros(sh, np.float32) for n, sh in shp}
    Bs = {n: np.zeros(sh[-1], np.float32) for n, sh in shp}

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
def pick(*names):
    for n in names:
        if os.path.exists(os.path.join(WORK, n)):
            return os.path.join(WORK, n)
    raise FileNotFoundError(names)


geo = json.load(open(pick('geo_models_v2.json', 'geo_models.json')))
lm = json.load(open(pick('lm_v2.json', 'lm.json')))


def rnd(o):
    if isinstance(o, list): return [rnd(x) for x in o]
    if isinstance(o, float): return float('%.5g' % o)
    return o


data = {
    'classes': classes,
    'cnn': {'q': b64(np.concatenate(qs)), 's': b64(np.concatenate(ss)), 'b': b64(np.concatenate(bs)), 'layout': layout,
            'id': hashlib.sha1(np.concatenate(qs).tobytes() + np.concatenate(ss).tobytes()).hexdigest()[:12]},
    'join': {k: rnd(v) for k, v in geo['join'].items()},
    'rel': {k: rnd(v) for k, v in geo['rel'].items()},
    'lm': lm,
    'prior': json.load(open(pick('prior.json'))) if os.path.exists(os.path.join(WORK, 'prior.json')) else None,
}

# Typeset view: KaTeX's fonts (SIL Open Font License 1.1, embedded unchanged) and their metrics for the characters
# Nib can write. Metrics per code point: [depth, height, italic correction, width] in em.
KATEX = os.environ.get('NIB_KATEX', os.path.join(HERE, 'demo', 'node_modules', 'katex'))
TS_FONTS = {'m': 'Main-Regular', 'i': 'Math-Italic', 's': 'Size1-Regular'}
TS_CHARS = ('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+=<>()[]{}|/.,;:!?%$\u2212\u00d7\u00f7\u00b1'
            '\u2264\u2265\u22c5\u2192\u2208\u221e\u2032\u2218\u03c0\u03b8\u03b1\u03b2\u03b3\u03bb\u03bc\u03c3\u03d5\u0394'
            '\u2211\u222b\u2200\u2203\u2026\u221a')
fm_src = open(os.path.join(KATEX, 'src', 'fontMetricsData.js')).read()
fm_src = fm_src[fm_src.index('export default') + len('export default'):].strip().rstrip(';')
import re
fm = json.loads(re.sub(r',(\s*[}\]])', r'\1', fm_src))
tsfm = {}
for k, name in TS_FONTS.items():
    t = fm[name]
    tsfm[k] = {str(ord(c)): [round(v, 5) for v in (t[str(ord(c))][0], t[str(ord(c))][1], t[str(ord(c))][2], t[str(ord(c))][4])]
               for c in TS_CHARS if str(ord(c)) in t}
data['tsfm'] = tsfm
data['tsfont'] = {k: b64(np.frombuffer(open(os.path.join(KATEX, 'dist', 'fonts', f'KaTeX_{name}.woff2'), 'rb').read(), np.uint8))
                  for k, name in TS_FONTS.items()}
src = ''.join(open(os.path.join(HERE, 'src', f)).read() + '\n' for f in ('core.js', 'recognize.js', 'solve.js', 'neat.js', 'pad.js', 'api.js')
              if os.path.exists(os.path.join(HERE, 'src', f)))
src = src.replace("'use strict';\n", '')
src = src.replace('/*__DATA__*/ null', json.dumps(data, separators=(',', ':')))
src = src.replace('__VERSION__', VERSION)
head = open(os.path.join(HERE, 'src', 'header.txt')).read().replace('__VERSION__', VERSION) if os.path.exists(os.path.join(HERE, 'src', 'header.txt')) else ''
out = head + "(function (global) {\n'use strict';\n" + src + "})(typeof window !== 'undefined' ? window : globalThis);\n"
os.makedirs(os.path.join(HERE, 'dist'), exist_ok=True)
open(os.path.join(HERE, 'dist', 'nib.js'), 'w').write(out)
print('dist/nib.js', len(out) // 1024, 'KB')
