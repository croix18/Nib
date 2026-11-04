// Stress versions of a composed school set: the same expressions written the way children actually write.
//   node test/stress.js [in=test/school_synth.jsonl] [outPrefix=training/scratch/data/stress_] [seed=7]
// Variants (one file each, ground truth unchanged):
//   reverse  - 35% of strokes drawn backwards (right-to-left minus, bottom-up 1, ...)
//   order    - the strokes inside each multi-stroke symbol in a different order (= bottom bar first, 4 cross first)
//   delayed  - one stroke of a multi-stroke symbol added at the very end (crossing the t, finishing the 4 later)
//   mouse    - sparse, straight-segment points snapped to whole pixels, as a mouse or trackpad gives
//   finger   - shaky dense points, as a fingertip on a touchscreen gives
//   slope    - the whole line written uphill or downhill (6-12 degrees), symbols turned with it
//   drift    - the line drifts uphill or downhill (6-12 degrees) while each symbol stays upright, as on a board
//   mixed    - each expression gets two or three of the above at random
'use strict';
const fs = require('fs'), path = require('path');
const IN = process.argv[2] || path.join(__dirname, 'school_synth.jsonl');
const OUTP = process.argv[3] || path.join(__dirname, '..', 'training', 'scratch', 'data', 'stress_');
const SEED = +(process.argv[4] || 7);

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(SEED);
const U = (a, b) => a + (b - a) * rnd();
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clone = r => JSON.parse(JSON.stringify(r));
const symH = r => { // a typical symbol height for this expression
  const hs = r.strokes.map(s => { let y0 = Infinity, y1 = -Infinity; for (const p of s) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } return y1 - y0; }).sort((a, b) => a - b);
  return Math.max(hs[hs.length >> 1] || 1, 1);
};

// reorder strokes by a permutation and keep the ground-truth segmentation in step
function permute(r, order) {
  const where = new Map(order.map((old, nw) => [old, nw]));
  r.strokes = order.map(i => r.strokes[i]);
  if (r.symbols) for (const s of r.symbols) s.strokes = s.strokes.map(i => where.get(i)).sort((a, b) => a - b);
  return r;
}

const V = {
  reverse(r, k = 0.35) { r.strokes = r.strokes.map(s => rnd() < k ? s.slice().reverse() : s); return r; },
  order(r) {
    if (!r.symbols) return r;
    const order = [];
    const syms = r.symbols.slice().sort((a, b) => a.strokes[0] - b.strokes[0]);
    for (const s of syms) {
      const st = s.strokes.slice();
      if (st.length > 1) for (let i = st.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [st[i], st[j]] = [st[j], st[i]]; }
      order.push(...st);
    }
    const seen = new Set(order);
    for (let i = 0; i < r.strokes.length; i++) if (!seen.has(i)) order.push(i);
    return permute(r, order);
  },
  delayed(r) {
    if (!r.symbols) return r;
    // letters and digits whose second stroke children often add later; not = or fraction bars (those are separate signs)
    const multi = r.symbols.filter(s => s.strokes.length > 1 && /^[0-9a-zA-Z]$|^\\(pi|times|div|pm|ne|le|ge)$|^[+$%]$/.test(s.label));
    if (!multi.length) return r;
    const s = multi[Math.floor(rnd() * multi.length)];
    const moved = s.strokes[s.strokes.length - 1];
    const order = [];
    for (let i = 0; i < r.strokes.length; i++) if (i !== moved) order.push(i);
    order.push(moved);
    return permute(r, order);
  },
  mouse(r) {
    const H = symH(r), step = H * U(0.08, 0.16), px = H / 40; // a 40-pixel-high symbol
    r.strokes = r.strokes.map(s => {
      const out = [s[0]];
      let acc = 0;
      for (let i = 1; i < s.length; i++) {
        acc += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
        if (acc >= step || i === s.length - 1) { out.push(s[i]); acc = 0; }
      }
      return out.map(p => [Math.round(p[0] / px) * px, Math.round(p[1] / px) * px]);
    });
    return r;
  },
  finger(r) {
    const H = symH(r), sd = H * U(0.012, 0.025);
    r.strokes = r.strokes.map(s => {
      // densify, then add jitter that is smooth over a few points (a fingertip wobbles, it does not sparkle)
      const d = [];
      for (let i = 0; i < s.length; i++) {
        if (i) for (let t = 1; t <= 2; t++) d.push([s[i - 1][0] + (s[i][0] - s[i - 1][0]) * t / 3, s[i - 1][1] + (s[i][1] - s[i - 1][1]) * t / 3]);
        d.push(s[i].slice());
      }
      let nx = 0, ny = 0;
      return d.map(p => { nx = 0.7 * nx + 0.3 * gauss() * sd * 2; ny = 0.7 * ny + 0.3 * gauss() * sd * 2; return [p[0] + nx, p[1] + ny]; });
    });
    return r;
  },
  slope(r) {
    const a = (rnd() < 0.5 ? -1 : 1) * U(6, 12) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    r.strokes = r.strokes.map(st => st.map(p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]));
    return r;
  },
  drift(r) {
    if (!r.symbols) return r;
    const t = Math.tan((rnd() < 0.5 ? -1 : 1) * U(6, 12) * Math.PI / 180);
    let sx = 0, n = 0;
    for (const s of r.strokes) for (const p of s) { sx += p[0]; n++; }
    const cx = sx / n;
    for (const sym of r.symbols) {
      let x0 = Infinity, x1 = -Infinity;
      for (const k of sym.strokes) for (const p of r.strokes[k]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
      const dy = t * ((x0 + x1) / 2 - cx);
      for (const k of sym.strokes) r.strokes[k] = r.strokes[k].map(p => [p[0], p[1] + dy]);
    }
    return r;
  },
};
V.mixed = r => {
  const names = ['reverse', 'order', 'delayed', 'mouse', 'finger', 'slope'];
  for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  const k = 2 + (rnd() < 0.5 ? 1 : 0);
  for (const n of names.slice(0, k)) r = V[n](r);
  return r;
};

const rows = fs.readFileSync(IN, 'utf8').trim().split('\n').map(JSON.parse);
for (const name of Object.keys(V)) {
  rnd = mulberry32(SEED * 7919 + name.length * 131 + name.charCodeAt(0));
  const out = rows.map(r => JSON.stringify(Object.assign(V[name](clone(r)), { stress: name })));
  fs.writeFileSync(OUTP + name + '.jsonl', out.join('\n') + '\n');
  console.log('wrote', OUTP + name + '.jsonl', out.length);
}
