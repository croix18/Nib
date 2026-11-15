// Two recorded sessions (session.js), step by step: where they differ, and in what. The confidence is counted apart
// when it moves by 2.5e-6 at most (engines whose arithmetic differs in the last bit).
//   node tools/verify/cmpsess.js <reference.jsonl[.gz]> <other.jsonl[.gz]>
'use strict';
const fs = require('fs');
const read = f => { const raw = fs.readFileSync(f); return (f.endsWith('.gz') ? require('zlib').gunzipSync(raw) : raw).toString('utf8').trim().split('\n').map(JSON.parse); };
const [a, b] = process.argv.slice(2).map(read);
let diff = 0, confOnly = 0;
const n = Math.max(a.length, b.length);
for (let i = 0; i < n; i++) {
  const x = a[i], y = b[i];
  if (!x || !y) { diff++; console.log(`step ${i}: only in ${x ? 'the first' : 'the second'}`); continue; }
  let keys = Object.keys(x).filter(k => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
  // the confidence may move in its last digits between engines whose arithmetic differs in the last bit: counted apart
  if (keys.includes('conf') && Math.abs(x.conf - y.conf) <= 2.5e-6) { keys = keys.filter(k => k !== 'conf'); confOnly++; }
  if (!keys.length) continue;
  diff++;
  if (diff <= 12) {
    console.log(`step ${i} (${x.step} | ${y.step}): differs in ${keys.join(', ')}`);
    for (const k of keys.slice(0, 3)) { const p = JSON.stringify(x[k]), q = JSON.stringify(y[k]); let c = 0; while (c < p.length && p[c] === q[c]) c++; console.log(`   ${k}: …${p.slice(Math.max(0, c - 40), c + 80)}\n   ${' '.repeat(k.length)}  …${q.slice(Math.max(0, c - 40), c + 80)}`); }
  }
}
console.log(`${n} steps: ${diff} differ` + (confOnly ? ` (and ${confOnly} where only the confidence moved, by at most 2.5e-6)` : ''));
process.exit(diff ? 1 : 0);
