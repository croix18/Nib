// Every reading of a corpus with one engine, one JSON line per expression: what a user would see (the LaTeX, each
// symbol with its strokes, the answers after "="), and the confidence apart (it may move in its last digits).
//   node tools/verify/readall.js <engine.js> <corpus.jsonl> <out.jsonl> [mod=1] [rem=0] [optionsJSON]
//   (every mod-th expression, starting at rem; KERNEL=js in the environment reads on the JavaScript path)
'use strict';
const fs = require('fs');
const [engine, corpus, out, mod = '1', rem = '0', oj = '{}'] = process.argv.slice(2);
const Nib = require(require('path').resolve(engine));
if (process.env.KERNEL && Nib._internals.kernelUse) Nib._internals.kernelUse(process.env.KERNEL);   // KERNEL=js: the JavaScript path
const opts = JSON.parse(oj);
const rows = fs.readFileSync(corpus, 'utf8').trim().split('\n');
const fd = fs.openSync(out, 'w');
let n = 0; const t0 = Date.now();
for (let i = 0; i < rows.length; i++) {
  if (i % +mod !== +rem) continue;
  const r = JSON.parse(rows[i]);
  let line;
  try {
    const res = new Nib.Recognizer().recognize(r.strokes, opts);
    let ans = null; try { ans = Nib.solve(res, opts).map(a => a && a.latex); } catch (e) { ans = 'THREW ' + e.message; }
    line = { i, latex: res.latex, syms: res.symbols.map(s => s.label + ':' + s.strokes.join('.')).join(' '), cands: res.symbols.map(s => (s.candidates || []).slice(0, 3).map(c => c[0]).join('/')).join(' '), ans, conf: res.confidence };
  } catch (e) { line = { i, error: String(e.message) }; }
  fs.writeSync(fd, JSON.stringify(line) + '\n'); n++;
}
fs.closeSync(fd);
console.log(`${corpus.split('/').pop()} [${mod}/${rem}] ${n} read in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
