// Show the segmentation DP's view of one expression: join probabilities and candidate group scores.
const fs = require('fs'); const Nib = require(require('path').join(__dirname, '..', 'dist', 'nib.js'));
const D = (process.env.NIB_DATA || require('path').join(__dirname, '..', 'training', 'scratch', 'data') + '/');
const [split, id, symbols = 'school'] = process.argv.slice(2);
const r = fs.readFileSync(D + split + '.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse).find(x => x.id === id);
const I = Nib._internals, ref = I.refSize(r.strokes), M = I.model(), mask = I.allowedMask(symbols);
const owner = {}; r.symbols.forEach((s, i) => s.strokes.forEach(k => owner[k] = i + ':' + s.label));
console.log('ref', ref.toFixed(1));
const R = new Nib.Recognizer();
for (let k = 0; k < r.strokes.length; k++) {
  const pj = k + 1 < r.strokes.length ? R.pjoin(r.strokes[k], r.strokes[k + 1], ref, 'x' + k) : NaN;
  const top = R.classify([r.strokes[k]], { symbols, ref, top: 3 }).map(([l, p]) => l + ':' + p.toFixed(2)).join(' ');
  const p = R.probs([r.strokes[k]], ref, 'y' + k);
  console.log(`stroke ${k} [${owner[k]}]  single: ${top}  junk ${p[M.junk].toFixed(2)}   pjoin->${k + 1}: ${pj.toFixed(2)}`);
}
for (let i = 0; i + 1 < r.strokes.length; i++) for (let j = i + 1; j < Math.min(r.strokes.length, i + 3); j++) {
  const g = r.strokes.slice(i, j + 1), p = R.probs(g, ref, 'g' + i + '-' + j);
  const top = R.classify(g, { symbols, ref, top: 2 }).map(([l, q]) => l + ':' + q.toFixed(2)).join(' ');
  console.log(`group ${i}..${j}: junk ${p[M.junk].toFixed(2)}  ${top}`);
}
