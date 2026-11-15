// a cold read split: the time in Recognizer.probs (the classifier, plus its cache) and the rest
const REPO = require('path').join(__dirname, '..', '..');   // the repository
const fs = require('fs');
const Nib = require(process.env.NIB || REPO + '/dist/nib.js');
if (process.env.KERN) Nib._internals.kernelUse(process.env.KERN);
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const N = +process.argv[2] || 40, sample = rows.filter((r, i) => i % Math.floor(rows.length / N) === 0).slice(0, N);
const P = Nib.Recognizer.prototype, probs = P.probs; let tp = 0, depth = 0;
P.probs = function () { if (depth++) { try { return probs.apply(this, arguments); } finally { depth--; } } const t = process.hrtime.bigint(); try { return probs.apply(this, arguments); } finally { tp += Number(process.hrtime.bigint() - t) / 1e6; depth--; } };
for (let rep = 0; rep < (+process.env.REP || 3); rep++) {
  let total = 0, strokes = 0; tp = 0;
  for (const r of sample) { const R = new Nib.Recognizer(); const t = process.hrtime.bigint(); R.recognize(r.strokes); total += Number(process.hrtime.bigint() - t) / 1e6; strokes += r.strokes.length; }
  console.log(`${strokes} strokes: ${(total / strokes).toFixed(2)} ms a stroke = classifier ${(tp / strokes).toFixed(2)} + the rest ${((total - tp) / strokes).toFixed(2)}; ${(total / sample.length).toFixed(1)} ms an expression`);
}
