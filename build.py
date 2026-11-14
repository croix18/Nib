"""Assemble dist/nib.js: the sources in src/ and the frozen model data in one dependency-free file.

  python3 build.py                    src/*.js + model/nib-data.json -> dist/nib.js (standard library only)
  python3 build.py path/to/model.npz  first freeze that model into model/nib-data.json (tools/freeze_model.py:
                                      needs numpy, the other trained files and KaTeX), then build

VERSION here is the one version of Nib; package.json must carry the same (this stops if it does not)."""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'model', 'nib-data.json')
VERSION = '1.6.6'

pkg = os.path.join(HERE, 'package.json')
if os.path.exists(pkg) and json.load(open(pkg)).get('version') != VERSION:
    sys.exit(f'build.py: package.json says version {json.load(open(pkg)).get("version")}, build.py says {VERSION}: make them the same')

if len(sys.argv) > 1:
    model = os.path.abspath(sys.argv[1])
    if not os.path.exists(model):
        # a model asked for by name must exist: never build an engine with zero weights by a mistyped path
        sys.exit(f'build.py: no model at {model} (paths are relative to {os.getcwd()})')
    r = subprocess.run([sys.executable, os.path.join(HERE, 'tools', 'freeze_model.py'), model, '--out', DATA])
    if r.returncode:
        sys.exit('build.py: freezing the model failed; dist/nib.js not written')

if not os.path.exists(DATA):
    sys.exit(f'build.py: no model data at {DATA} (it is committed: check out model/, or freeze one with tools/freeze_model.py)')
data = json.load(open(DATA))
src = ''.join(open(os.path.join(HERE, 'src', f)).read() + '\n' for f in ('core.js', 'recognize.js', 'solve.js', 'neat.js', 'paper.js', 'shapes.js', 'pdf.js', 'store.js', 'scribble.js', 'pad.js', 'api.js')
              if os.path.exists(os.path.join(HERE, 'src', f)))
src = src.replace("'use strict';\n", '')
src = src.replace('/*__DATA__*/ null', json.dumps(data, separators=(',', ':')))
src = src.replace('__VERSION__', VERSION)
head = open(os.path.join(HERE, 'src', 'header.txt')).read().replace('__VERSION__', VERSION) if os.path.exists(os.path.join(HERE, 'src', 'header.txt')) else ''
out = head + "(function (global) {\n'use strict';\n" + src + "})(typeof window !== 'undefined' ? window : globalThis);\n"
os.makedirs(os.path.join(HERE, 'dist'), exist_ok=True)
open(os.path.join(HERE, 'dist', 'nib.js'), 'w').write(out)
print('dist/nib.js', len(out) // 1024, 'KB, cnn.id', data['cnn']['id'])
