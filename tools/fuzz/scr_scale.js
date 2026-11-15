const REPO = require('path').join(__dirname, '..', '..');   // the repository
const Nib = require(REPO + '/dist/nib.js');
const t = f => { const a = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - a) / 1e6, r]; };
// shapes a long stroke can really have: a long zig-zag shading, a spiral coloring-in, a long wandering line, a long straight line
const gens = {
  zigzag: n => Array.from({ length: n }, (_, i) => { const leg = Math.floor(i / 25), k = i % 25; return [leg % 2 ? 300 - k * 12 : k * 12, 50 + leg * 3 + k * 0.12]; }),
  spiral: n => Array.from({ length: n }, (_, i) => [300 + (20 + i / 60) * Math.cos(i / 9), 300 + (20 + i / 60) * Math.sin(i / 9)]),
  wander: n => { let x = 0, y = 0, a = 0; return Array.from({ length: n }, (_, i) => { a += Math.sin(i / 37) * 0.2; x += Math.cos(a) * 3; y += Math.sin(a) * 3; return [x, y]; }); },
  straight: n => Array.from({ length: n }, (_, i) => [i * 2, 100 + Math.sin(i / 50)]),
  coloring: n => Array.from({ length: n }, (_, i) => { const leg = Math.floor(i / 40), k = i % 40; return [leg % 2 ? 400 - k * 10 : k * 10, 100 + leg * 1.5]; }),
};
for (const g of Object.keys(gens)) {
  const out = [];
  for (const n of [500, 1000, 2000, 4000, 8000, 16000]) {
    const pts = gens[g](n);
    const [ms, s] = t(() => Nib.scribble.of(pts, 1));
    out.push(n + ':' + ms.toFixed(0) + 'ms' + (s ? '*' : ''));
    if (ms > 20000) break;
  }
  console.log(g.padEnd(9), out.join('  '));
}
