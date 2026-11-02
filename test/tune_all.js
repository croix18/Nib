// Tune on the two tuning sets together: real CROHME 2013 school-style expressions and the composed school set
// built from the same 2013 writers. The 2019 test set (and the school set composed from it) stays untouched
// for reporting.   node test/tune_all.js '<gridJSON>' [limit]
const fs = require('fs'), path = require('path');
const Nib = require(process.env.NIB || path.join(__dirname, '..', 'dist', 'nib.js'));
const D = process.env.NIB_DATA || path.join(__dirname, '..', 'training', 'scratch', 'data') + '/';
const [gridJ = '{}', limit = '100000'] = process.argv.slice(2);
const SCHOOL = new Set('0123456789abcdefghijkmnpqrstuvwxyz+-=().,<>/|!'.split('').concat(['\\times', '\\div', '\\pi', '\\le', '\\ge', '\\ne', '\\pm', '[', ']', '\\sqrt', 'A', 'B', 'C', 'P', 'V', '\\theta']));
function gtTokens(row, L) {
  const out = [];
  for (const u of row) {
    if (u.k === 's') out.push(L[u.s]);
    else if (u.k === 'f') out.push('\\frac', '{', ...gtTokens(u.num, L), '}', '{', ...gtTokens(u.den, L), '}');
    else { out.push('\\sqrt'); if (u.idx) out.push('[', ...gtTokens(u.idx, L), ']'); out.push('{', ...gtTokens(u.body, L), '}'); }
    const sub = u.sub || u.below, sup = u.sup || u.above;
    if (sub) out.push('_', '{', ...gtTokens(sub, L), '}');
    if (sup) out.push('^', '{', ...gtTokens(sup, L), '}');
  }
  return out;
}
const schoolOk = r => r.tree && r.symbols.every(s => SCHOOL.has(s.label)) &&
  (function chk(row) { return row.every(u => !u.sub && !u.below && !u.above && ['sup', 'num', 'den', 'body', 'idx'].every(k => !u[k] || chk(u[k]))); })(r.tree);
const canon = t => t.map(x => x === '\\cdot' ? '.' : x);
const load = f => fs.readFileSync(D + f, 'utf8').trim().split('\n').map(JSON.parse);
const real = load('t13.jsonl').filter(schoolOk).slice(0, +limit).map(r => ({ strokes: r.strokes, gt: canon(gtTokens(r.tree, r.symbols.map(s => s.label))) }));
const synth = load('synth_t13.jsonl').slice(0, +limit).map(r => ({ strokes: r.strokes, gt: canon(r.gt), cat: r.cat }));
const grid = JSON.parse(gridJ);
const keys = Object.keys(grid);
const combos = keys.reduce((acc, k) => acc.flatMap(c => grid[k].map(v => Object.assign({}, c, { [k]: v }))), [{}]);
const R = new Nib.Recognizer({ cacheSize: 1e7 });
const score = (set, c) => {
  let ok = 0;
  for (const r of set) {
    const res = R.recognize(r.strokes, Object.assign({ symbols: 'school', degrees: false }, c));
    const pred = canon([].concat(...res.lines.map((l, j) => (j ? ['\\\\'] : []).concat(l.tokens))));
    if (pred.length === r.gt.length && pred.every((t, k) => t === r.gt[k])) ok++;
  }
  return 100 * ok / set.length;
};
for (const c of combos) {
  const t0 = Date.now();
  const a = score(real, c), b = score(synth, c);
  console.log(`${JSON.stringify(c).padEnd(70)} real ${a.toFixed(1)}%  composed ${b.toFixed(1)}%  mean ${((a + b) / 2).toFixed(2)}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
