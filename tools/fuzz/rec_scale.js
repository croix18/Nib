const REPO = require('path').join(__dirname, '..', '..');   // the repository
const Nib = require(REPO + '/dist/nib.js');
const t = f => { const a = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - a) / 1e6, r]; };
const line = (x0, y0, x1, y1, n = 8) => Array.from({ length: n }, (_, i) => [x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * i / (n - 1)]);
const gens = {
  'dashes in a row': n => Array.from({ length: n }, (_, i) => line(i * 14, 50, i * 14 + 9, 50, 5)),
  'stacked dashes': n => Array.from({ length: n }, (_, i) => line(0, i * 12, 200, i * 12, 8)),
  'tall bars': n => Array.from({ length: n }, (_, i) => line(i * 9, 0, i * 9, 60, 6)),
  'dots grid': n => Array.from({ length: n }, (_, i) => [[i % 30 * 20, Math.floor(i / 30) * 20], [i % 30 * 20 + 1, Math.floor(i / 30) * 20 + 1]]),
};
for (const g of Object.keys(gens)) { const out = [];
  for (const n of [25, 50, 100, 200]) { const R = new Nib.Recognizer(); const [ms] = t(() => R.recognize(gens[g](n))); out.push(n + ':' + ms.toFixed(0) + 'ms (' + (ms / n).toFixed(0) + '/stroke)'); }
  console.log(g.padEnd(16), out.join('  ')); }
// scribble at scale
const zig = Array.from({ length: 9 }, (_, i) => [i % 2 ? 100 : 0, i * 6]).reduce((acc, p, i, a) => (i ? acc.concat(line(a[i - 1][0], a[i - 1][1], p[0], p[1], 8)) : [p]), []);
for (const [label, zf] of [['z=1', () => 1], ['z=1/scale', k => 1 / k], ['z undefined', () => undefined]]) { const out = [];
  for (const k of [1, 10, 100, 1000, 1e4, 1e5, 1e6]) { const [ms, s] = t(() => Nib.scribble.of(zig.map(p => [p[0] * k, p[1] * k]), zf(k))); out.push('x' + k + ':' + ms.toFixed(0) + 'ms' + (s ? '*' : '')); if (ms > 8000) break; }
  console.log('scribble scale, ' + label.padEnd(12), out.join('  ')); }
