// Two directories of readings (readall.js), compared file by file: what differs in the LaTeX, the symbols, the
// answers, the top three candidates, and the largest difference in a confidence.
//   node tools/verify/cmp.js <reference dir> <other dir>      (.jsonl or .jsonl.gz in either)
const fs = require('fs');
const [a, b] = process.argv.slice(2);
let tot = 0, dl = 0, ds = 0, da = 0, dc = 0, maxc = 0; const ex = [];
const zlib = require('zlib');
const open = (dir, name) => { for (const f of [name + '.jsonl', name + '.jsonl.gz']) if (fs.existsSync(dir + '/' + f)) { const raw = fs.readFileSync(dir + '/' + f); return (f.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } return null; };
const names = [...new Set(fs.readdirSync(a).filter(f => /\.jsonl(\.gz)?$/.test(f)).map(f => f.replace(/\.jsonl(\.gz)?$/, '')))].sort();
let files = 0;
for (const f of names) {
  const A = open(a, f), B = open(b, f);
  if (!A || !B) continue;
  files++;
  // matched by each expression's place in its corpus (i), so a part of a set compares with the whole of it
  const at = new Map(A.map(x => [x.i, x])), pairs = B.filter(y => at.has(y.i)).map(y => [at.get(y.i), y]);
  const n = pairs.length; let l = 0, s = 0, an = 0, c = 0;
  for (const [x, y] of pairs) {
    tot++;
    if (x.latex !== y.latex) { l++; if (ex.length < 12) ex.push(f + ' #' + x.i + ': ' + x.latex + '  →  ' + y.latex); }
    else if (x.syms !== y.syms) s++;
    if (JSON.stringify(x.ans) !== JSON.stringify(y.ans)) an++;
    if (x.cands !== y.cands) c++;
    if (typeof x.conf === 'number' && typeof y.conf === 'number') maxc = Math.max(maxc, Math.abs(x.conf - y.conf));
  }
  dl += l; ds += s; da += an; dc += c;
  console.log(f.padEnd(26), String(n).padStart(5), 'compared' + (A.length !== n || B.length !== n ? ' (of ' + A.length + ' and ' + B.length + ')' : ''), '| latex differs', l, '| same latex, other symbols', s, '| answers differ', an, '| top-3 candidates differ', c);
}
console.log(`TOTAL ${tot}: latex ${dl}, symbols ${ds}, answers ${da}, candidate lists ${dc}; largest confidence difference ${maxc.toExponential(2)}`);
for (const e of ex) console.log('   ' + e.slice(0, 200));
if (!files) { console.log('nothing to compare: no file of ' + a + ' is in ' + b); process.exit(2); }
process.exit(dl || ds || da || dc ? 1 : 0);
