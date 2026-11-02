// Calibrate the personal memory: how similar are embeddings of the same symbol by the same writer,
// versus different symbols? Simulates a writer correcting each mistake once and measures how many
// later mistakes the memory fixes and how many correct reads it breaks.
// node test/memcal.js [split] [maxWriters]
const fs = require('fs'), path = require('path');
const Nib = require(path.join(__dirname, '..', 'dist', 'nib.js'));
const D = process.env.NIB_DATA || path.join(__dirname, '..', 'training', 'scratch', 'data') + '/';
const [split = 't13', maxW = '60'] = process.argv.slice(2);
const I = Nib._internals;
const rows = fs.readFileSync(D + split + '.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const byWriter = {};
for (const r of rows) { const w = r.writer || r.id.replace(/_[^_]*$/, ''); (byWriter[w] = byWriter[w] || []).push(r); }
const writers = Object.keys(byWriter).filter(w => byWriter[w].length >= 5).slice(0, +maxW);
const mask = I.allowedMask('all'), M = I.model();
const unit = h => { let n = 0; for (const x of h) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(h, x => x / n); };
const dot = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };
const top = p => { let a = -1; for (let c = 0; c < p.length; c++) if (mask[c] && c !== M.junk && (a < 0 || p[c] > p[a])) a = c; return M.cls[a]; };
const same = [], diff = [];
const grid = [[0.85, 0.95], [0.88, 0.96], [0.9, 0.97], [0.92, 0.98]];
const res = grid.map(() => ({ fixed: 0, broke: 0 }));
let base = 0, n = 0;
for (const w of writers) {
  const syms = [];
  for (const r of byWriter[w]) {
    const ref = I.refSize(r.strokes);
    for (const s of r.symbols) {
      if (s.strokes.length > 4) continue;
      const p = I.classifyGroup(s.strokes.map(k => r.strokes[k]), ref);
      syms.push({ label: s.label, p, v: unit(p.hidden), pred: top(p) });
    }
  }
  // stream: before each symbol, the memory holds the corrections made so far for this writer
  grid.forEach(([s0, s1], gi) => {
    const mem = [];
    for (const s of syms) {
      let best = 0, score = {};
      for (const m of mem) { const d = dot(s.v, m.v); if (d > s0) { score[m.l] = (score[m.l] || 0) + Math.pow(d, 8); best = Math.max(best, d); } }
      let pred = s.pred;
      if (best > s0) {
        const lam = Math.min(1, (best - s0) / (s1 - s0)) * 0.8, tot = Object.values(score).reduce((a, b) => a + b, 0);
        const q = Float64Array.from(s.p, (x, c) => c === M.junk ? x : x * (1 - lam));
        for (const l in score) q[M.idx[l]] += lam * (1 - s.p[M.junk]) * score[l] / tot;
        pred = top(q);
      }
      if (s.pred !== s.label && pred === s.label) res[gi].fixed++;
      if (s.pred === s.label && pred !== s.label) res[gi].broke++;
      if (pred !== s.label) mem.push({ l: s.label, v: s.v }); // the writer corrects it
    }
  });
  for (const s of syms) { n++; if (s.pred === s.label) base++; }
  for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < Math.min(syms.length, i + 40); j++) (syms[i].label === syms[j].label ? same : diff).push(dot(syms[i].v, syms[j].v));
}
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))].toFixed(3); };
console.log(`writers ${writers.length}, symbols ${n}, base accuracy ${(100 * base / n).toFixed(2)}%`);
console.log('same-label sim  p10/p50/p90', pct(same, 0.1), pct(same, 0.5), pct(same, 0.9));
console.log('diff-label sim  p90/p99/p99.9', pct(diff, 0.9), pct(diff, 0.99), pct(diff, 0.999));
grid.forEach((g, i) => console.log(`thresholds ${g}: fixed ${res[i].fixed}, broke ${res[i].broke}`));
