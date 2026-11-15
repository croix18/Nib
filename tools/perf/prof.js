// Where a read's time goes: one cold read of N school expressions, each its own Recognizer (as a reload reads them).
const REPO = require('path').join(__dirname, '..', '..');   // the repository
const fs = require('fs');
const Nib = require(process.env.NIB || REPO + '/dist/nib.js');
const I = Nib._internals;
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const N = +process.argv[2] || 40;
const M = I.model();
console.log('layers:', Object.keys(M.L).map(k => k + ':' + M.L[k].w.length + '/' + M.L[k].co).join(' '));
// count classifications by wrapping the internals the engine exposes? (they are closure functions: time them directly instead)
const t = f => { const a = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - a) / 1e6, r]; };
let total = 0, strokes = 0;
const sample = rows.filter((r, i) => i % Math.floor(rows.length / N) === 0).slice(0, N);
for (const r of sample) { const R = new Nib.Recognizer(); const [ms] = t(() => R.recognize(r.strokes)); total += ms; strokes += r.strokes.length; }
console.log(`${sample.length} expressions, ${strokes} strokes: ${total.toFixed(0)} ms cold = ${(total / strokes).toFixed(1)} ms a stroke, ${(total / sample.length).toFixed(0)} ms an expression`);
// the classifier alone, on single symbols cut from the same expressions
const groups = []; for (const r of sample) for (const y of r.symbols) groups.push(y.strokes.map(i => r.strokes[i]));
const ref = I.refSize(sample[0].strokes);
for (let rep = 0; rep < 2; rep++) {
  const [tc] = t(() => { for (const g of groups) I.classifyGroup(g, ref); });
  const [tr] = t(() => { for (const g of groups) I.rasterize(g, ref); });
  const imgs = groups.map(g => I.rasterize(g, ref));
  const [tv] = t(() => { for (const im of imgs) I.convFeatures(im.img); });
  const [to] = t(() => { for (const g of groups) I.onlineBranch(I.onlineFeatures(g, ref)); });
  const [tof] = t(() => { for (const g of groups) I.onlineFeatures(g, ref); });
  const feats = imgs.map(im => I.convFeatures(im.img)), onls = groups.map(g => I.onlineBranch(I.onlineFeatures(g, ref)));
  const [tf] = t(() => { for (let i = 0; i < groups.length; i++) I.fcProbs(feats[i], imgs[i].scal, onls[i]); });
  const n = groups.length;
  console.log(`pass ${rep}: classifyGroup ${(tc / n).toFixed(2)} ms each = rasterize ${(tr / n).toFixed(2)} + conv ${(tv / n).toFixed(2)} + online ${(to / n).toFixed(2)} (features ${(tof / n).toFixed(2)}) + fc ${(tf / n).toFixed(2)}  (${n} symbols)`);
}
