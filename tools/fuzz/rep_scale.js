const REPO = require('path').join(__dirname, '..', '..');   // the repository
const R = require(REPO + '/replicator/core.js');
const t = f => { const a = process.hrtime.bigint(); let r, e = null; try { r = f(); } catch (x) { e = x.constructor.name + ': ' + String(x.message).slice(0, 60); } return [Number(process.hrtime.bigint() - a) / 1e6, r, e]; };
for (const k of [1, 3, 10, 30, 100, 300, 1000]) {
  const g = [[[-0.5 * k, -0.5 * k], [0.9, k], [k, 0.03]]];
  const [ms, o, e] = t(() => R.outline(g, { weight: 80, smoothing: 5 }));
  const [ms2, f, e2] = t(() => R.buildFont({ A: g, B: [[[0.2, 0.2], [0.5, 0.8], [0.8, 0.2]]] }, { name: 'T', weight: 80, spacing: 50, smoothing: 5, tidy: true, even: true }));
  console.log('coords up to ' + String(k).padStart(5) + ' boxes: outline ' + ms.toFixed(0).padStart(7) + ' ms ' + (e || (o ? o.contours.length + ' contours' : 'null')) + ';  buildFont ' + ms2.toFixed(0).padStart(7) + ' ms ' + (e2 || (f ? f.bytes.length + ' bytes, built ' + f.built.length : 'null')));
  if (ms > 20000) break;
}
