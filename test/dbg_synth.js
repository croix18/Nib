// Show how one composed expression was read: each symbol with its strokes, box and candidates.
// node test/dbg_synth.js <id> [file] [optsJSON]
const fs = require('fs'), path = require('path');
const Nib = require(process.env.NIB || path.join(__dirname, '..', 'dist', 'nib.js'));
const [id, file = path.join(__dirname, '..', 'training', 'scratch', 'data', 'synth_t13.jsonl'), oj = '{}'] = process.argv.slice(2);
const r = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse).find(x => x.id === id);
const res = Nib.recognize(r.strokes, JSON.parse(oj));
const ref = Nib._internals.refSize(r.strokes);
console.log(r.latex, '->', res.latex, ' ref', ref.toFixed(1));
for (const s of res.symbols) console.log(s.label.padEnd(8), 'strokes', s.strokes.join(','), ' box', [s.box.x, s.box.y, s.box.w, s.box.h].map(v => (v / ref).toFixed(2)).join(' '),
  ' cands', s.candidates.slice(0, 3).map(([l, p]) => l + ':' + p.toFixed(2)).join(' '));
if (r.symbols) console.log('truth:', r.symbols.map(s => s.label + '[' + s.strokes.join(',') + ']').join(' '));
