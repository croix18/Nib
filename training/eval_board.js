// The owner's drill rows read by the engine: expression exact-match (the Board's normTex) and symbol accuracy
// (a row symbol is right when the engine returns a symbol with the same stroke set and label), on the writer
// test set and on the training rows of scratch/work/board_split.json; then the raw read of the records he had
// to Fix.   NIB=dist/nib.js node training/eval_board.js [out.json]
'use strict';
const fs = require('fs'), path = require('path');
const Nib = require(process.env.NIB || path.join(__dirname, '..', 'dist', 'nib.js'));
const S = path.join(__dirname, 'scratch'), FX = path.join(__dirname, '..', 'test', 'fixtures');
const OPTS = { symbols: 'school', times: false };

// board/template.html normLine / normTex
function normLine(l) {
  return l.replace(/\\left(?![a-zA-Z])|\\right(?![a-zA-Z])/g, '').replace(/\\[,;:! ]/g, '').replace(/~/g, '').replace(/\s+/g, '')
    .replace(/[·⋅]/g, '\\cdot').replace(/\\[dt]frac(?![a-zA-Z])/g, '\\frac').replace(/\\(le|ge|ne)q(?![a-zA-Z])/g, '\\$1').replace(/\\%/g, '%')
    .replace(/\\frac([^{\\])/g, '\\frac{$1}').replace(/\\frac(\{[^{}]*\})([^{\\])/g, '\\frac$1{$2}').replace(/([\^_])([^{\\])/g, '$1{$2}');
}
function normTex(t) {
  const lines = String(t || '').replace(/\\begin\{gathered\}|\\end\{gathered\}/g, '').split('\\\\').map(normLine).filter(Boolean);
  if (lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/=$/, '');
  return lines.join('\\\\');
}
const MAP = { '\\cdot': '.', '\\circ': 'o' };
const lab = l => MAP[l] || l;
const key = st => st.slice().sort((a, b) => a - b).join(',');

const rows = new Map();
for (const l of fs.readFileSync(path.join(S, 'data', 'board.jsonl'), 'utf8').trim().split('\n')) { const r = JSON.parse(l); rows.set(r.id, r); }
const split = JSON.parse(fs.readFileSync(path.join(S, 'work', 'board_split.json'), 'utf8'));
const out = { sets: {}, fixes: [] };
for (const name of ['test', 'train']) {
  let ex = 0, sy = 0, syN = 0;
  const items = [];
  for (const id of split[name]) {
    const r = rows.get(id);
    const res = new Nib.Recognizer().recognize(r.strokes.map(s => s.map(p => [p[0], p[1]])), OPTS);
    const ok = normTex(res.latex) === normTex(r.expect);
    const got = new Map(res.symbols.map(s => [key(s.strokes), lab(s.label)]));
    let right = 0;
    const wrong = [];
    for (const s of r.symbols) { if (got.get(key(s.strokes)) === lab(s.label)) right++; else wrong.push(`${s.label}→${got.get(key(s.strokes)) || '(split)'}`); }
    ex += ok; sy += right; syN += r.symbols.length;
    items.push({ item: r.item, how: r.how, note: r.note || '', expect: r.expect, read: res.latex, ok, sym: `${right}/${r.symbols.length}`, wrong });
  }
  items.sort((a, b) => a.item - b.item);
  out.sets[name] = { exact: ex, n: items.length, sym: sy, symN: syN, items };
  console.log(`${name}: expressions ${ex}/${items.length} (${(100 * ex / items.length).toFixed(1)}%), symbols ${sy}/${syN} (${(100 * sy / syN).toFixed(1)}%)`);
  for (const it of items) console.log(`  ${String(it.item).padStart(2)} ${it.how.padEnd(6)} ${it.ok ? 'ok ' : 'BAD'} ${it.sym.padStart(5)}  ${it.expect}  read ${it.read}${it.wrong.length ? '  [' + it.wrong.join(' ') + ']' : ''}${it.note ? '  (' + it.note + ')' : ''}`);
}
// the records he had to Fix, read raw; and his two kinds of 4 (items 54, 55)
const FIXES = [['07b', 58, '17+71='], ['07b', 63, '46\\cdot 9='], ['07c', 76, '4x+4-x='], ['07c', 28, '3.14\\cdot 2='],
  ['07d', 126, '144\\cdot 69='], ['07c', 14, '69+96=']];
const files = {};
const file = f => files[f] || (files[f] = JSON.parse(fs.readFileSync(path.join(FX, `training_2026-11-${f}.json`), 'utf8')));
const raw = r => new Nib.Recognizer().recognize(r.strokes.map(s => s.map(p => [p[0], p[1]])), OPTS).latex;
console.log('records he had to Fix (raw read):');
for (const [f, i, want] of FIXES) {
  const r = file(f).records[i], got = raw(r);
  out.fixes.push({ rec: `${f} #${i}`, want, item: r.item, read: got, ok: normTex(got) === normTex(want) });
  console.log(`  ${f} #${i} (item ${r.item}): want ${want}  read ${got}  ${normTex(got) === normTex(want) ? 'ok' : 'BAD'}`);
}
for (const it of [54, 55]) for (const r of rows.values()) if (r.item === it && r.gold) {
  const got = raw(r);
  out.fixes.push({ rec: `item ${it} (${r.note})`, want: r.expect, item: it, read: got, ok: normTex(got) === normTex(r.expect) });
  console.log(`  item ${it} (${r.note}): want ${r.expect}  read ${got}  ${normTex(got) === normTex(r.expect) ? 'ok' : 'BAD'}`);
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
