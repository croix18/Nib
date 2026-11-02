// Score Nib on the synthetic middle-school set (test/school_synth.jsonl, written by test/compose.js from real
// CROHME 2019 test-split handwriting).
//   node test/eval_synth.js [optsJSON] [showErrors] [category]
// optsJSON is merged over {symbols: 'school'}; showErrors = how many mismatches to print; category limits the run.
// Env: NIB = engine path (default dist/nib.js), SYNTH = data file.
'use strict';
const fs = require('fs');
const path = require('path');
const Nib = require(process.env.NIB || require('path').join(__dirname, '..', 'dist', 'nib.js'));

const FILE = process.env.SYNTH || path.join(__dirname, 'school_synth.jsonl');
const [optsJ = '{}', show = '0', only = ''] = process.argv.slice(2);
const opts = JSON.parse(optsJ);
const rows = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => !only || r.cat === only);
if (!rows.length) { console.log('no rows' + (only ? ' for category ' + only : '')); process.exit(1); }

// token-level Levenshtein distance (a softer number to watch while exact match is low)
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const R = new Nib.Recognizer();
const cats = new Map();
let exact = 0, edits = 0, gtLen = 0, ms = 0, runs = 0, thrown = 0, firstThrow = null;
const errs = [];
const t0 = Date.now();
for (const r of rows) {
  let pred;
  try {
    const res = R.recognize(r.strokes, Object.assign({ symbols: 'school' }, opts));
    pred = [].concat(...res.lines.map((l, i) => (i ? ['\\\\'] : []).concat(l.tokens)));
    ms += res.ms || 0; runs++;
  } catch (e) {
    thrown++;
    if (!firstThrow) firstThrow = `${r.id}: ${(e && e.stack) || e}`;
    pred = ['<threw>'];
  }
  const ok = pred.length === r.gt.length && pred.every((t, i) => t === r.gt[i]);
  const c = cats.get(r.cat) || { n: 0, ok: 0, ed: 0, len: 0 };
  const d = ok ? 0 : lev(pred, r.gt);
  c.n++; c.ok += ok; c.ed += d; c.len += r.gt.length; cats.set(r.cat, c);
  exact += ok; edits += d; gtLen += r.gt.length;
  if (!ok && errs.length < +show) errs.push(`${r.id} ${r.cat}\n  GT  ${r.gt.join(' ')}\n  OUT ${pred.join(' ')}`);
}
const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
console.log(`school_synth n=${rows.length}  exact ${pct(exact, rows.length)}  token-err ${pct(edits, gtLen)}  ` +
  `avg ${(ms / Math.max(1, runs)).toFixed(1)}ms  wall ${((Date.now() - t0) / 1000).toFixed(0)}s` + (thrown ? `  THREW ${thrown}` : ''));
for (const [k, c] of cats) console.log(`  ${k.padEnd(8)} n=${String(c.n).padEnd(4)} exact ${pct(c.ok, c.n).padStart(6)}   token-err ${pct(c.ed, c.len).padStart(6)}`);
if (firstThrow) console.log('first exception: ' + firstThrow);
if (errs.length) console.log(errs.join('\n'));
