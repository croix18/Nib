// node eval.js <split> <mode: full|oracle|seg> <subset: all|school> [limit] [optsJSON] [showErrors]
const fs = require('fs');
const Nib = require(process.env.NIB || require('path').join(__dirname, '..', 'dist', 'nib.js'));
const D = (process.env.NIB_DATA || require('path').join(__dirname, '..', 'training', 'scratch', 'data') + '/');
const [split = 'valid', mode = 'full', subset = 'school', limit = '100000', optsJ = '{}', show = '0'] = process.argv.slice(2);
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
function schoolOk(r) {
  if (!r.tree) return false;
  if (!r.symbols.every(s => SCHOOL.has(s.label))) return false;
  const chk = row => row.every(u => !u.sub && !u.below && !u.above && ['sup', 'num', 'den', 'body', 'idx'].every(k => !u[k] || chk(u[k])));
  return chk(r.tree);
}
const canon = t => t.map(x => x === '\\cdot' ? '.' : x);
const rows = fs.readFileSync(D + split + '.jsonl', 'utf8').trim().split('\n').map(JSON.parse)
  .filter(r => r.tree && (subset === 'all' || schoolOk(r))).slice(0, +limit);
const opts = Object.assign({ symbols: subset === 'school' ? 'school' : 'all', degrees: false }, JSON.parse(optsJ));
const R = new Nib.Recognizer({ cacheSize: 1e7 });
let exact = 0, structOk = 0, gtSyms = 0, segOk = 0, clsOk = 0, ms = 0, lines1 = 0;
const errs = [];
const t0 = Date.now();
for (const r of rows) {
  const L = r.symbols.map(s => s.label);
  const o = Object.assign({}, opts);
  const gtSym = (strokes) => r.symbols.map(s => {
    let b = null; for (const k of s.strokes) { const bb = Nib._internals.sbox(strokes[k]); b = b ? [Math.min(b[0], bb[0]), Math.min(b[1], bb[1]), Math.max(b[2], bb[2]), Math.max(b[3], bb[3])] : bb; }
    return { label: s.label, cands: [[s.label, 1]], strokes: s.strokes.slice(), box: b, pts: s.strokes.map(k => strokes[k]), junk: 0 };
  }).sort((a, b) => a.strokes[0] - b.strokes[0]);
  if (mode === 'oracle') o.oracle = (strokes) => gtSym(strokes);
  if (mode === 'seg') o.oracle = (strokes, ref) => gtSym(strokes).map(s => { const c = R.classify(s.pts, { symbols: opts.symbols, ref, top: 6 }); return Object.assign(s, { label: c[0][0], cands: c }); });
  const res = R.recognize(r.strokes, o);
  ms += res.ms;
  if (res.lines.length === 1) lines1++;
  const pred = canon([].concat(...res.lines.map((l, i) => (i ? ['\\\\'] : []).concat(l.tokens))));
  const gt = canon(gtTokens(r.tree, L));
  const ok = pred.length === gt.length && pred.every((t, i) => t === gt[i]);
  if (ok) exact++;
  const shape = t => t.map(x => /^[{}^_\[\]]$|^\\frac$|^\\sqrt$/.test(x) ? x : '#');
  const sp = shape(pred), sg = shape(gt);
  if (sp.length === sg.length && sp.every((t, i) => t === sg[i])) structOk++;
  // segmentation / symbol accuracy
  const key = s => s.strokes.slice().sort((a, b) => a - b).join(',');
  const predMap = new Map(res.symbols.map(s => [key(s), s.label]));
  for (const s of r.symbols) { gtSyms++; const k = key(s); if (predMap.has(k)) { segOk++; if (canon([predMap.get(k)])[0] === s.label) clsOk++; } }
  if (!ok && errs.length < +show) errs.push(`${r.id}\n   GT  ${gt.join(' ')}\n   OUT ${pred.join(' ')}`);
}
const n = rows.length;
console.log(`${split}/${mode}/${subset} n=${n}  exact ${(100 * exact / n).toFixed(1)}%  structure ${(100 * structOk / n).toFixed(1)}%  ` +
  `seg ${(100 * segOk / gtSyms).toFixed(1)}%  sym ${(100 * clsOk / gtSyms).toFixed(1)}%  1-line ${(100 * lines1 / n).toFixed(1)}%  avg ${(ms / n).toFixed(1)}ms  wall ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (errs.length) console.log(errs.join('\n'));
