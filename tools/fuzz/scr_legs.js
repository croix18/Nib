const REPO = require('path').join(__dirname, '..', '..');   // the repository
const Nib = require(REPO + '/dist/nib.js');
const t = f => { const a = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - a) / 1e6, r]; };
for (const per of [10, 3, 1]) { const out = [];
  for (const legs of [200, 500, 1000, 2000, 4000, 8000]) {
    const pts = []; for (let l = 0; l < legs; l++) for (let k = 0; k < per; k++) pts.push([l % 2 ? 200 - (k + 1) * 200 / per : (k + 1) * 200 / per, 50 + l * 0.6 + (l % 7) * 0.3]);
    const [ms, s] = t(() => Nib.scribble.of(pts, 1)); out.push(legs + ' legs/' + pts.length + 'pts:' + ms.toFixed(0) + 'ms' + (s ? '*' : '')); if (ms > 15000) break; }
  console.log('points per leg ' + per + ':', out.join('  ')); }
