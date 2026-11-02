// Grid-search the recognizer's scoring weights on the validation split (classifier outputs are cached
// across configs, so only the first pass is slow).  node test/tune.js <subset> <gridJSON>
const fs = require('fs');
const Nib = require(require('path').join(__dirname, '..', 'dist', 'nib.js'));
const D = (process.env.NIB_DATA || require('path').join(__dirname, '..', 'training', 'scratch', 'data') + '/');
const [subset = 'school', gridJ = '{}', split = 'valid'] = process.argv.slice(2);
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
const rows = fs.readFileSync(D + split + '.jsonl', 'utf8').trim().split('\n').map(JSON.parse).filter(r => r.tree && (subset === 'all' || schoolOk(r)));
const gts = rows.map(r => gtTokens(r.tree, r.symbols.map(s => s.label)).map(x => x === '\\cdot' ? '.' : x));
const grid = JSON.parse(gridJ);
const R = new Nib.Recognizer({ cacheSize: 1e7 });
const keys = Object.keys(grid);
const combos = keys.reduce((acc, k) => acc.flatMap(c => grid[k].map(v => Object.assign({}, c, { [k]: v }))), [{}]);
// count the classifier calls each config needs (pruning) with a throwaway recognizer per config
const countCalls = c => { const Rc = new Nib.Recognizer({ cacheSize: 1e7 }); rows.slice(0, 60).forEach(r => Rc.recognize(r.strokes, Object.assign({ symbols: subset === 'school' ? 'school' : 'all', degrees: false }, c))); return Rc.classified; };
for (const c of combos) {
  const t0 = Date.now(); let ok = 0, seg = 0, sym = 0, n = 0;
  rows.forEach((r, i) => {
    const res = R.recognize(r.strokes, Object.assign({ symbols: subset === 'school' ? 'school' : 'all', degrees: false }, c));
    const pred = [].concat(...res.lines.map((l, j) => (j ? ['\\\\'] : []).concat(l.tokens))).map(x => x === '\\cdot' ? '.' : x);
    if (pred.length === gts[i].length && pred.every((t, k) => t === gts[i][k])) ok++;
    const key = s => s.strokes.slice().sort((a, b) => a - b).join(',');
    const pm = new Map(res.symbols.map(s => [key(s), s.label === '\\cdot' ? '.' : s.label]));
    for (const s of r.symbols) { n++; const k = key(s); if (pm.has(k)) { seg++; if (pm.get(k) === s.label) sym++; } }
  });
  const calls = process.env.COUNT ? '  calls/60 ' + countCalls(c) : '';
  console.log(JSON.stringify(c), `exact ${(100 * ok / rows.length).toFixed(1)}%  seg ${(100 * seg / n).toFixed(1)}%  sym ${(100 * sym / n).toFixed(1)}%  ${((Date.now() - t0) / 1000).toFixed(0)}s${calls}`);
}
