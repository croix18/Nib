const fs = require('fs'); const Nib = require(require('path').join(__dirname, '..', 'dist', 'nib.js'));
const D = (process.env.NIB_DATA || require('path').join(__dirname, '..', 'training', 'scratch', 'data') + '/');
const [split, id] = process.argv.slice(2);
const r = fs.readFileSync(D + split + '.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse).find(x => x.id === id);
const ref = Nib._internals.refSize(r.strokes);
console.log('ref', ref.toFixed(1));
for (const s of r.symbols) { let b = null; for (const k of s.strokes) { const bb = Nib._internals.sbox(r.strokes[k]); b = b ? [Math.min(b[0], bb[0]), Math.min(b[1], bb[1]), Math.max(b[2], bb[2]), Math.max(b[3], bb[3])] : bb; }
  console.log(s.label.padEnd(8), 'x', ((b[0])/ref).toFixed(2), '-', (b[2]/ref).toFixed(2), ' y', (b[1]/ref).toFixed(2), '-', (b[3]/ref).toFixed(2), ' w', ((b[2]-b[0])/ref).toFixed(2), 'h', ((b[3]-b[1])/ref).toFixed(2)); }
