// The readings of 1.6.7, kept (1.7.0: the classifier's arithmetic and its kernel changed no reading). The 700 school
// problems read with the kernel give exactly 1.6.7's readings: the LaTeX, each symbol's label and strokes, each
// symbol's top three candidates and the answers after "=", fingerprinted as 1.6.7 gave them; every 7th of them read
// with the JS path gives the same lines as the kernel.
//   node test/readings_check.js
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const Nib = require(path.join(__dirname, '..', 'dist', 'nib.js'));
const I = Nib._internals;
// SHA-256 of 1.6.7's lines for test/school_synth.jsonl (made as line() makes them, one '\n' after each)
const GOLD = '5ec58a6d2ec7227d06bafe5f82ad1b6c443ff55d79737188735966851bc46b31';
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (c) passes++; else fails++; };
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

// what a writer sees of a reading, as one line (a fresh Recognizer for each problem, as a page opened again reads it)
function line(i) {
  const res = new Nib.Recognizer().recognize(rows[i].strokes);
  let ans = null;
  try { ans = Nib.solve(res).map(a => a && a.latex); } catch (e) { ans = 'THREW ' + e.message; }
  const syms = res.symbols.map(s => s.label + ':' + s.strokes.join('.')).join(' ');
  const cands = res.symbols.map(s => (s.candidates || []).slice(0, 3).map(c => c[0]).join('/')).join(' ');
  return JSON.stringify([i, res.latex, syms, cands, ans]) + '\n';
}

const t0 = Date.now();
ok(I.kernelUse('simd') === 'simd', 'the kernel');
const lines = rows.map((r, i) => line(i));
const sum = crypto.createHash('sha256').update(lines.join('')).digest('hex');
ok(sum === GOLD, `the ${rows.length} school problems read with the kernel: ${sum === GOLD ? "1.6.7's readings" : 'fingerprint ' + sum + ", not 1.6.7's " + GOLD} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
if (sum !== GOLD) {
  console.log('      their first lines (to compare with 1.6.7 by hand):');
  for (const l of lines.slice(0, 3)) console.log('      ' + l.trim().slice(0, 200));
}

const t1 = Date.now();
I.kernelUse('js');
const diff = [];
let n = 0;
for (let i = 0; i < rows.length; i += 7) { n++; const l = line(i); if (l !== lines[i]) diff.push([lines[i], l]); }
I.kernelUse('auto');
ok(!diff.length, `every 7th read with the JS path (${n}): ${diff.length} lines differ from the kernel's (${((Date.now() - t1) / 1000).toFixed(0)} s)`);
for (const [a, b] of diff.slice(0, 4)) console.log('      kernel: ' + a.trim().slice(0, 200) + '\n      js:     ' + b.trim().slice(0, 200));

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
