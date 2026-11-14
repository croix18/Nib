// JS ↔ Python parity for the symbol network: the int8 engine in dist/nib.js against the float model it was built
// from, on real symbols from the 2019 test writers.
//   node test/parity.js training/scratch/work/model_v3.npz [n=300]
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const Nib = require(process.env.NIB || path.join(__dirname, '..', 'dist', 'nib.js'));
const { need } = require('./data');
const [modelPath, nArg = '300'] = process.argv.slice(2);
if (!modelPath) { console.log('usage: node test/parity.js <model.npz> [n]'); process.exit(2); }
const I = Nib._internals;
const rows = fs.readFileSync(need('test.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const groups = [];
for (const r of rows) {
  const ref = I.refSize(r.strokes);
  for (const s of r.symbols) groups.push({ st: s.strokes.map(k => r.strokes[k]), ref });
}
const step = Math.max(1, Math.floor(groups.length / +nArg));
const pick = groups.filter((_, i) => i % step === 0).slice(0, +nArg);
const P = [], js = [];
for (const g of pick) {
  const { img, scal } = I.rasterize(g.st, g.ref);
  P.push({ img: Array.from(img), st: g.st, ref: g.ref, sc: Array.from(scal) });
  js.push(Array.from(I.classifyGroup(g.st, g.ref)));
}
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'nib-parity-'));
fs.writeFileSync(path.join(tmp, 'p.json'), JSON.stringify(P));
execFileSync('python3', [path.join(__dirname, 'np_forward_v2.py'), modelPath, path.join(tmp, 'p.json'), path.join(tmp, 'o.json')], { stdio: 'inherit' });
const py = JSON.parse(fs.readFileSync(path.join(tmp, 'o.json'), 'utf8'));
fs.rmSync(tmp, { recursive: true, force: true });
let maxd = 0, agree = 0;
const arg = a => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);
for (let i = 0; i < js.length; i++) {
  for (let c = 0; c < js[i].length; c++) maxd = Math.max(maxd, Math.abs(js[i][c] - py[i][c]));
  if (arg(js[i]) === arg(py[i])) agree++;
}
console.log(`parity on ${js.length} symbols: top-1 agreement ${agree}/${js.length}, largest probability difference ${maxd.toFixed(4)}`);
process.exit(agree >= 0.98 * js.length && maxd < 0.05 ? 0 : 1);
