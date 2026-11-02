// Compose a synthetic middle-school test set from real handwriting.
//   node test/compose.js [count=700] [seed=20261101]   ->  test/school_synth.jsonl
// Symbols are cut from the CROHME 2019 *test* split (80 writers the models never saw), normalised, scaled into
// typographic zones and laid out (scripts, fractions, roots, %, $, :, multi-line work) with jitter.
// Each output line: {id, cat, latex, gt, strokes, symbols, writer}
//   gt      = the engine's token format (see docs/HANDOFF.md / eval_synth.js)
//   strokes = [[[x, y], ...], ...] in writing order, y down, symbol height H ~ 50 units
//   symbols = [{label, strokes: [indices]}] ground-truth segmentation (fraction bar '-', radical '\sqrt')
// Env: POOL = source JSONL (default: training/scratch/data/test.jsonl), OUT = output path.
'use strict';
const fs = require('fs');
const path = require('path');

const POOL = process.env.POOL || require('path').join(__dirname, '..', 'training', 'scratch', 'data', 'test.jsonl');
const OUT = process.env.OUT || path.join(__dirname, 'school_synth.jsonl');
const TOTAL = +(process.argv[2] || 700);
const SEED = +(process.argv[3] || 20261101);

// ------------------------------------------------------------------ seeded PRNG
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const U = (a, b) => a + (b - a) * rnd();
const I = (a, b) => a + Math.floor(rnd() * (b - a + 1));          // integer in [a, b]
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;
function wpick(pairs) {
  let t = 0; for (const p of pairs) t += p[1];
  let r = rnd() * t;
  for (const p of pairs) { r -= p[1]; if (r < 0) return p[0]; }
  return pairs[pairs.length - 1][0];
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ handwriting pool
const MAXK = 4;                       // the engine groups at most 4 strokes into a symbol
const pool = new Map();               // label -> [sample]
const byWriter = new Map();           // label -> Map(writer -> [sample])
let UID = 0;

// Light Gaussian smoothing along the stroke (sigma in native units). CROHME coordinates are integers, so a small
// sample scaled up 2-4x shows a pixel staircase that no 50-unit writing on a screen would have.
function smooth(st, sigma) {
  const n = st.length;
  if (n < 3) return st.map(p => [p[0], p[1]]);
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(st[i][0] - st[i - 1][0], st[i][1] - st[i - 1][1]));
  const R = 2.5 * sigma, k = 1 / (2 * sigma * sigma), out = [];
  for (let i = 0; i < n; i++) {
    let wx = 0, wy = 0, ws = 0;
    for (let j = 0; j < n; j++) {
      const d = Math.abs(s[j] - s[i]);
      if (d > R) { if (j > i) break; continue; }
      const w = Math.exp(-d * d * k); wx += w * st[j][0]; wy += w * st[j][1]; ws += w;
    }
    out.push([wx / ws, wy / ws]);
  }
  return out;
}

function makeSample(writer, strokes, src) {
  strokes = strokes.map(st => smooth(st, 1.0));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (const s of strokes) for (const p of s) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    n++;
  }
  return { uid: UID++, writer, src, st: strokes.map(s => s.map(p => [p[0] - x0, p[1] - y0])), w: x1 - x0, h: y1 - y0, n, k: strokes.length };
}
function addSample(label, smp) {
  if (!pool.has(label)) pool.set(label, []);
  pool.get(label).push(smp);
}
function mirror(smp) {   // left-right mirror (keeps time order): a '<' written this way is how people write '>'
  return Object.assign({}, smp, { uid: UID++, src: smp.src + ':mirror', st: smp.st.map(s => s.map(p => [smp.w - p[0], p[1]])) });
}

(function loadPool() {
  const text = fs.readFileSync(POOL, 'utf8');
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start); if (end < 0) end = text.length;
    const line = text.slice(start, end); start = end + 1;
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const bars = new Set();
    (function walk(row) {
      for (const u of row || []) {
        if (u.k === 'f') bars.add(u.s);
        for (const k of ['num', 'den', 'body', 'idx', 'sup', 'sub', 'above', 'below']) if (Array.isArray(u[k])) walk(u[k]);
      }
    })(r.tree);
    r.symbols.forEach((s, si) => {
      if (!s.strokes.length || s.strokes.length > MAXK) return;
      const idx = s.strokes.slice().sort((a, b) => a - b);          // original time order
      const strokes = idx.map(k => r.strokes[k]);
      if (strokes.some(st => !st || !st.length)) return;
      let label = s.label;
      if (label === '-') { if (!r.tree) return; label = bars.has(si) ? '-bar' : '-'; }   // fraction bars vs minus signs
      addSample(label, makeSample(r.writer, strokes, `${r.id}#${si}`));
      // extra dots: the dots of i, j and the division sign (the 31 '.' samples include some mislabelled scribbles)
      if (['i', 'j', '\\div'].includes(label) && strokes.length >= 2) {
        const sz = st => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of st) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); } return Math.max(c - a, d - b); };
        const big = Math.max(...strokes.map(sz));
        strokes.forEach((st, k) => { if (sz(st) <= Math.min(0.3 * big, 12)) addSample('dot+', makeSample(r.writer, [st], `${r.id}#${si}.${k}`)); });
      }
    });
  }
})();

const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
const ASPECT = new Map();             // label -> [p5, p95] of width/height, used to clamp
(function cleanPool() {
  for (const [label, arr] of pool) {
    // drop degenerate and very small samples (scaled up 3x+ they are blocky); dots and minus signs are small anyway
    let keep = arr.filter(s => label === '.' || label === 'dot+' ? true : (s.n >= 2 && Math.max(s.w, s.h) >= (label === '-' || label === '-bar' ? 8 : 15)));
    if (label !== '.' && label !== '-' && label !== '-bar') keep = keep.filter(s => s.h > 0 && s.w >= 0);
    const as = keep.filter(s => s.h > 0 && s.w > 0).map(s => s.w / s.h).sort((a, b) => a - b);
    if (as.length >= 8 && !['.', '-', '-bar', '\\sqrt'].includes(label)) {
      ASPECT.set(label, [q(as, 0.05), q(as, 0.95)]);
      if (as.length >= 20) { const lo = q(as, 0.01), hi = q(as, 0.99); keep = keep.filter(s => s.h > 0 && s.w / s.h >= lo && s.w / s.h <= hi); }
    }
    pool.set(label, keep);
  }
  // radical: find where the overline starts so the sign can be stretched piecewise (check mark kept, overline
  // lengthened). tx = the furthest right the upstroke gets on its way from the check's lowest point to the top, so
  // no part of the check is pushed into the body by the stretch.
  pool.set('\\sqrt', (pool.get('\\sqrt') || []).filter(s => {
    if (s.h < 15 || s.n < 12) return false;
    const pts = [].concat(...s.st);
    let vi = 0; for (let i = 0; i < pts.length; i++) if (pts[i][1] > pts[vi][1]) vi = i;   // lowest point = bottom of the check
    const thr = 0.2 * s.h;
    let ti = -1; for (let i = vi; i < pts.length; i++) if (pts[i][1] <= thr) { ti = i; break; }
    if (ti < 0) return false;
    let tx = -Infinity; for (let i = vi; i <= ti; i++) tx = Math.max(tx, pts[i][0]);
    let ex = -Infinity; for (let i = ti; i < pts.length; i++) ex = Math.max(ex, pts[i][0]);    // right end of the overline
    s.tx = tx;
    return tx >= 0.1 * s.w && tx <= 0.7 * s.w && ex - tx >= 0.25 * s.w && pts[vi][0] < tx;
  }));
  // derived pools
  const get = l => pool.get(l) || [];
  pool.set('1s', get('1').filter(s => s.k === 1 && s.w / s.h < 0.2));                       // plain-stroke ones
  pool.set('circ', get('0').concat(get('o')).filter(s => s.k === 1 && s.h > 0 && s.w / s.h > 0.5 && s.w / s.h < 1.7));
  pool.set('Ss', get('S').concat(get('s')).filter(s => s.k === 1));
  pool.set('vline', get('|').concat(get('1s')));
  pool.set('dot', get('.').filter(s => s.k === 1 && Math.max(s.w, s.h) <= 8).concat(get('dot+')));
  pool.set('/', get('/').filter(s => s.k === 1 && s.w / s.h > 0.15 && s.w / s.h < 1.2));
  for (const s of get('<').slice()) addSample('>', mirror(s));                                // '>' is rare in the pool (9)
  for (const [label, arr] of pool) {
    const m = new Map();
    for (const s of arr) { if (!m.has(s.writer)) m.set(s.writer, []); m.get(s.writer).push(s); }
    byWriter.set(label, m);
  }
})();
const WRITERS = [...new Set([].concat(...[...pool.values()].map(a => a.map(s => s.writer))))].sort();

function choose(label, ctx) {
  const P = pool.get(label);
  if (!P || !P.length) throw new Error('no handwriting samples for ' + label);
  const mine = ((byWriter.get(label) || new Map()).get(ctx.writer) || []).filter(s => !ctx.used.has(s.uid));
  let s;
  if (mine.length && chance(0.85)) s = pick(mine);
  else { for (let t = 0; t < 8; t++) { s = pick(P); if (!ctx.used.has(s.uid)) break; } }
  ctx.used.add(s.uid);
  return s;
}

// ------------------------------------------------------------------ geometry helpers
const xform = (s, sx, sy, ox, oy) => s.st.map(st => st.map(p => [ox + p[0] * sx, oy + p[1] * sy]));
function inkBox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const st of strokes) for (const p of st) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}
// a layout L = {g: [group], x0, x1, top, bot}; group = {label, strokes, box: [x0, y0, x1, y1]}; baseline at y = 0
function shift(L, dx, dy) {
  for (const gr of L.g) {
    for (const st of gr.strokes) for (const p of st) { p[0] += dx; p[1] += dy; }
    gr.box[0] += dx; gr.box[2] += dx; gr.box[1] += dy; gr.box[3] += dy;
  }
  L.x0 += dx; L.x1 += dx; L.top += dy; L.bot += dy;
  return L;
}
function fromGroups(g) {
  let x0 = Infinity, x1 = -Infinity, top = Infinity, bot = -Infinity;
  for (const gr of g) { x0 = Math.min(x0, gr.box[0]); x1 = Math.max(x1, gr.box[2]); top = Math.min(top, gr.box[1]); bot = Math.max(bot, gr.box[3]); }
  return { g, x0, x1, top, bot };
}

// ------------------------------------------------------------------ symbol placement
const DIGITS = '0123456789';
const OPSIZE = { '+': 0.55, '=': 0.55, '\\times': 0.45, '\\div': 0.55, '\\pm': 0.6, '<': 0.55, '>': 0.55, '\\le': 0.62, '\\ge': 0.62, '\\ne': 0.6 };
function zoneOf(label) {
  if (label.length === 1 && (DIGITS.includes(label) || /[A-Z]/.test(label) || 'bdfhklt'.includes(label))) return 'asc';
  if ((label.length === 1 && 'acemnorsuvwxz'.includes(label)) || label === '\\pi') return 'xh';
  if (label.length === 1 && 'gjpqy'.includes(label)) return 'desc';
  if (label.length === 1 && '()[]'.includes(label)) return 'paren';
  if (label === '|') return 'vbar';
  if (label === '-') return 'minus';
  if (label === '.') return 'dot';
  if (label in OPSIZE) return 'op';
  throw new Error('no zone for ' + label);
}
const POOLOF = { 'l': () => chance(0.7) ? 'l' : '1s', '.': () => 'dot' };

function placeSym(label, H, ctx) {
  const zone = zoneOf(label);
  const s = choose(POOLOF[label] ? POOLOF[label]() : label, ctx);
  const asp = ASPECT.get(label);
  const j = U(0.93, 1.07);                     // per-symbol size jitter
  const vj = U(-0.05, 0.05) * H;               // per-symbol vertical jitter
  const W = Math.max(s.w, 1e-6), Hh = Math.max(s.h, 1e-6);
  const keepAspect = (sx, sy) => {             // clamp extreme aspect ratios to the label's p5..p95
    if (!asp || s.w <= 0 || s.h <= 0) return sx;
    const a = (s.w * sx) / (s.h * sy);
    return a < asp[0] ? asp[0] * s.h * sy / s.w : a > asp[1] ? asp[1] * s.h * sy / s.w : sx;
  };
  let sx, sy, top;
  const fitH = (hh, t) => { sy = hh / Hh; sx = keepAspect(sy, sy); top = t; };
  switch (zone) {
    case 'asc': { const hh = H * j; fitH(hh, -hh + vj); break; }
    case 'xh': { const hh = 0.6 * H * j; fitH(hh, -hh + vj); break; }
    case 'desc': fitH(0.95 * H * j, -0.6 * H * j + vj); break;
    // brackets and bars: a bit taller than a digit, dipping below the baseline (CROHME parens: median 2x digit
    // height overall, ~1.3x at p10; plain middle-school rows sit at the low end)
    case 'paren': case 'vbar': { const hh = U(1.15, 1.4) * H, below = U(0.06, 0.18) * H; fitH(hh, below - hh + vj); break; }
    case 'op': {
      const size = OPSIZE[label] * H * j;
      if (label === '=') {                       // fit the width, keep the two bars a sensible distance apart
        sx = sy = size / W;
        const r = (s.h * sy) / (s.w * sx);
        if (r < 0.28) sy = 0.28 * s.w * sx / Hh; else if (r > 0.75) sy = 0.75 * s.w * sx / Hh;
      } else { sx = sy = size / Math.max(W, Hh); sx = keepAspect(sx, sy); }
      top = -0.45 * H - s.h * sy / 2 + vj;
      break;
    }
    case 'minus': {
      const ww = 0.5 * H * U(0.85, 1.15);
      sx = ww / W; sy = Math.min(sx, 0.12 * ww / Hh);
      top = -0.45 * H - s.h * sy / 2 + vj;
      break;
    }
    case 'dot': {
      const e = U(0.04, 0.1) * H, m = Math.max(s.w, s.h);
      sx = sy = m > 0 ? e / m : 1;
      top = -s.h * sy - U(0, 0.03) * H;
      break;
    }
  }
  const w = s.w * sx;
  const minW = zone === 'dot' || zone === 'minus' ? 0 : 0.2 * H;   // narrow glyphs (1, l, |) still take some room
  const pad = Math.max(0, (minW - w) / 2);
  const strokes = xform(s, sx, sy, pad, top);
  return { label, strokes, box: [0, top, w + 2 * pad, top + s.h * sy] };
}

function dotAt(H, cx, cy, ctx) {
  const s = choose('dot', ctx);
  const e = U(0.04, 0.1) * H, m = Math.max(s.w, s.h), sc = m > 0 ? e / m : 1;   // CROHME dots: median 0.045x digit height, many are taps
  return xform(s, sc, sc, cx - s.w * sc / 2, cy - s.h * sc / 2);
}
function group(label, strokes) { return { label, strokes, box: inkBox(strokes) }; }

function layPercent(H, ctx) {
  const sl = choose('/', ctx);
  const hh = H * U(0.92, 1.08);
  let sy = hh / sl.h, sx = sy;
  const a = sl.w * sx / hh;
  if (a < 0.3) sx = 0.3 * hh / sl.w; else if (a > 0.7) sx = 0.7 * hh / sl.w;
  const pts = [].concat(...sl.st);
  let ti = 0, bi = 0; for (let i = 0; i < pts.length; i++) { if (pts[i][1] < pts[ti][1]) ti = i; if (pts[i][1] > pts[bi][1]) bi = i; }
  const flip = pts[ti][0] < pts[bi][0];          // make it rise to the right
  const sw = sl.w * sx;
  const slash = sl.st.map(st => st.map(p => [(flip ? sl.w - p[0] : p[0]) * sx, -hh + p[1] * sy]));
  const slashX = y => sw * (-y / hh);            // x of the slash at height y
  const circle = (r, cx, cy) => { const c = choose('circ', ctx), sc = r / Math.max(c.w, c.h); return xform(c, sc, sc, cx - c.w * sc / 2, cy - c.h * sc / 2)[0]; };
  const r1 = U(0.26, 0.34) * H, r2 = r1 * U(0.85, 1.15);
  const c1y = -hh + r1 / 2 + U(0, 0.08) * H, c2y = -r2 / 2 - U(0, 0.08) * H;
  const c1 = circle(r1, slashX(c1y) - r1 / 2 - U(0.04, 0.12) * H, c1y);
  const c2 = circle(r2, slashX(c2y) + r2 / 2 + U(0.04, 0.12) * H, c2y);
  return group('%', [c1, ...slash, c2]);           // circle, slash, circle
}
function layDollar(H, ctx) {
  const S = choose('Ss', ctx);
  const hh = H * U(0.92, 1.05);
  const sy = hh / S.h; let sx = sy;
  const a = S.w * sx / hh; if (a < 0.4) sx = 0.4 * hh / S.w; else if (a > 0.85) sx = 0.85 * hh / S.w;
  const sStrokes = xform(S, sx, sy, 0, -hh);
  const L = choose('vline', ctx);
  const lh = hh * U(1.25, 1.36);
  const lsy = lh / L.h, lsx = Math.min(lsy, 0.06 * H / Math.max(L.w, 1e-6));   // keep it nearly straight
  const lx = S.w * sx / 2 - L.w * lsx / 2 + U(-0.06, 0.06) * H;
  const lStrokes = xform(L, lsx, lsy, lx, -hh - (lh - hh) / 2 + U(-0.03, 0.03) * H);
  return group('$', [...sStrokes, ...lStrokes]);   // S, then the line
}
function layColon(H, ctx) {
  const ax = -0.45 * H + U(-0.03, 0.03) * H, sep = U(0.3, 0.4) * H;
  return group(':', [...dotAt(H, U(-0.02, 0.02) * H, ax - sep / 2, ctx), ...dotAt(H, U(-0.03, 0.03) * H, ax + sep / 2, ctx)]);
}
function layCdot(H, ctx) { return group('\\cdot', dotAt(H, 0, -0.45 * H + U(-0.04, 0.04) * H, ctx)); }

// ------------------------------------------------------------------ layout
const BIN = new Set(['+', '-', '\\times', '\\div', '\\cdot', '\\pm']);
const REL = new Set(['=', '<', '>', '\\le', '\\ge', '\\ne', ':']);
const lab = u => u.k === 's' ? u.label : u.k;
function isUnary(row, j) {
  if (j < 0 || lab(row[j]) !== '-') return false;
  if (j === 0) return true;
  const p = lab(row[j - 1]);
  if (BIN.has(p) || REL.has(p) || p === '(') return true;
  if (p === '|') { let c = 0; for (let t = 0; t < j; t++) if (lab(row[t]) === '|') c++; return c % 2 === 1; }   // just inside |..|
  return false;
}
function gapBetween(row, i, H, ctx) {
  const pa = lab(row[i - 1]), pb = lab(row[i]);
  let g = ctx.gap * U(0.8, 1.25);
  if (pa === '.' || pb === '.') g *= 0.45;
  else if (pa === '(' || pb === ')' || (pa === ')' && pb === '(')) g *= 0.6;
  else if (pa === '|' || pb === '|') g *= 0.75;
  if (isUnary(row, i - 1)) g *= row[i].k === 'f' ? 1.1 : 0.6;     // keep a leading minus clear of a fraction bar
  else if (((BIN.has(pa) || REL.has(pa))) || ((BIN.has(pb) || REL.has(pb)) && !isUnary(row, i))) g += U(0.02, 0.12);
  return g * H;
}

function layRow(row, H, ctx) {
  const g = []; let x = 0, top = Infinity, bot = -Infinity;
  row.forEach((u, i) => {
    if (i > 0) x += gapBetween(row, i, H, ctx);
    const L = shift(layUnit(u, H, ctx), 0, 0);
    shift(L, x - L.x0, 0);
    g.push(...L.g); top = Math.min(top, L.top); bot = Math.max(bot, L.bot); x = L.x1;
    if (u.sup) {
      // scale 0.6, written right after the base. Baseline raised f * base height, f in 0.55..0.95: 0.55 is the
      // textbook value; CROHME writers go higher (median sup baseline ~1.1x an x-height base, ~0.9x a digit,
      // ~0.86x a paren), so 0.55 is the low end. Short bases count as 0.85H (an x's exponent clears the x).
      const S = layRow(u.sup, 0.6 * H * U(0.94, 1.06), ctx);
      shift(S, x + U(0.0, 0.14) * H - S.x0, -U(0.55, 0.95) * Math.max(L.bot - L.top, 0.85 * H));
      g.push(...S.g); top = Math.min(top, S.top); bot = Math.max(bot, S.bot); x = S.x1;
    }
  });
  return { g, x0: 0, x1: x, top, bot };
}

function layUnit(u, H, ctx) {
  if (u.k === 'f') return layFrac(u, H, ctx);
  if (u.k === 'r') return layRoot(u, H, ctx);
  if (u.label === '%') return fromGroups([layPercent(H, ctx)]);
  if (u.label === '$') return fromGroups([layDollar(H, ctx)]);
  if (u.label === ':') return fromGroups([layColon(H, ctx)]);
  if (u.label === '\\cdot') return fromGroups([layCdot(H, ctx)]);
  const gr = placeSym(u.label, H, ctx);
  return { g: [gr], x0: gr.box[0], x1: gr.box[2], top: gr.box[1], bot: gr.box[3] };
}

function layFrac(u, H, ctx) {
  const Hn = H * U(0.75, 0.85);
  const N = layRow(u.num, Hn, ctx), D = layRow(u.den, Hn, ctx);
  const nw = N.x1 - N.x0, dw = D.x1 - D.x0;
  const bw = Math.max(nw, dw) + U(0.22, 0.4) * H;
  const axis = -0.45 * H + U(-0.04, 0.04) * H;
  const s = choose(pool.get('-bar').length ? '-bar' : '-', ctx);
  const sx = bw / Math.max(s.w, 1e-6), sy = Math.min(sx, U(0.03, 0.09) * H / Math.max(s.h, 1e-6));
  const bar = group('-', xform(s, sx, sy, 0, axis - s.h * sy / 2));
  shift(N, (bw - nw) / 2 + U(-0.06, 0.06) * H - N.x0, bar.box[1] - U(0.2, 0.35) * H - N.bot);
  shift(D, (bw - dw) / 2 + U(-0.06, 0.06) * H - D.x0, bar.box[3] + U(0.2, 0.35) * H - D.top);
  const g = chance(0.82) ? [...N.g, bar, ...D.g] : [bar, ...N.g, ...D.g];      // numerator, bar, denominator (sometimes bar first)
  return fromGroups(g);
}

function layRoot(u, H, ctx) {
  const B = layRow(u.body, H * U(0.92, 1.0), ctx);
  const s = choose('\\sqrt', ctx);
  const top = B.top - U(0.12, 0.25) * H;
  const bot = Math.max(B.bot, 0) + U(0.0, 0.12) * H;
  const rh = bot - top;
  const cw = clamp(rh * U(0.3, 0.45), 0.3 * H, 0.75 * H);            // width of the check mark
  shift(B, cw + U(0.06, 0.16) * H - B.x0, 0);
  const right = B.x1 + U(0.08, 0.2) * H;
  const strokes = s.st.map(st => st.map(p => [
    p[0] <= s.tx ? p[0] / s.tx * cw : cw + (p[0] - s.tx) / Math.max(s.w - s.tx, 1e-6) * (right - cw),
    top + p[1] / s.h * rh]));
  const rad = group('\\sqrt', strokes);
  if (!u.idx) return fromGroups([rad, ...B.g]);
  // small index in the crook of the check. CROHME writers (n=21): index height ~0.29 rh, its bottom ~0.35 rh below
  // the radical's top, its right edge near (just left of) the check's lowest point
  const X = layRow(u.idx, rh * U(0.25, 0.33), ctx);
  let vx = 0, vy = -Infinity;
  for (const st of strokes) for (const p of st) if (p[1] > vy) { vy = p[1]; vx = p[0]; }
  shift(X, vx - U(0, 0.1) * rh - X.x1, top + rh * U(0.28, 0.42) - X.bot);
  const m = 0.04 * H, inBox = p => p[0] > X.x0 - m && p[0] < X.x1 + m && p[1] > X.top - m && p[1] < X.bot + m;
  for (let t = 0; t < 60 && strokes.some(st => st.some(inBox)); t++) shift(X, -0.04 * H, 0);   // clear of the radical's ink
  return fromGroups(chance(0.3) ? [...X.g, rad, ...B.g] : [rad, ...B.g, ...X.g]);
}

// ------------------------------------------------------------------ LaTeX-ish template -> tree -> tokens
const CMDS = ['\\frac', '\\sqrt', '\\times', '\\cdot', '\\div', '\\pm', '\\le', '\\ge', '\\ne', '\\pi'];
function lex(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if (c === '\\') {
      const n = s[i + 1];
      if (n === '\\') { out.push('\\\\'); i += 2; continue; }
      if (n === '%' || n === '$') { out.push(n); i += 2; continue; }
      const cmd = CMDS.find(c => s.startsWith(c, i));       // known names, so '\lex' reads as '\le' 'x'
      if (!cmd) throw new Error('unknown command at ' + s.slice(i));
      out.push(cmd); i += cmd.length; continue;
    }
    out.push(c); i++;
  }
  return out;
}
function parse(src) {
  const t = lex(src); let i = 0;
  const group = () => { if (t[i] === '{') { i++; const r = row('}'); i++; return r; } return [unit()]; };
  function unit() {
    const tok = t[i++];
    if (tok === '\\frac') { const num = group(); const den = group(); return { k: 'f', num, den }; }
    if (tok === '\\sqrt') { let idx = null; if (t[i] === '[') { i++; idx = row(']'); i++; } return { k: 'r', idx, body: group() }; }
    return { k: 's', label: tok };
  }
  function row(end) {
    const r = [];
    while (i < t.length && t[i] !== end && t[i] !== '\\\\') {
      if (t[i] === '^') { i++; r[r.length - 1].sup = group(); continue; }
      r.push(unit());
    }
    return r;
  }
  const rows = [];
  for (;;) { rows.push(row(undefined)); if (t[i] === '\\\\') { i++; continue; } break; }
  if (i < t.length) throw new Error('parse error in ' + src);
  return rows;
}
function toks(row) {
  const out = [];
  for (const u of row) {
    if (u.k === 's') out.push(u.label);
    else if (u.k === 'f') out.push('\\frac', '{', ...toks(u.num), '}', '{', ...toks(u.den), '}');
    else { out.push('\\sqrt'); if (u.idx) out.push('[', ...toks(u.idx), ']'); out.push('{', ...toks(u.body), '}'); }
    if (u.sup) out.push('^', '{', ...toks(u.sup), '}');
  }
  return out;
}

// ------------------------------------------------------------------ one expression
const r1 = v => Math.round(v * 10) / 10;
function compose(tex) {
  const rows = parse(tex);
  const H = 50 * U(0.85, 1.15);
  const ctx = { writer: pick(WRITERS), used: new Set(), gap: U(0.15, 0.3) };
  const lines = [];
  let baseY = 0, prevBot = 0;
  rows.forEach((row, li) => {
    const L = layRow(row, H, ctx);
    // baseline drift (<= 0.08H over the line): a slope plus a slight wave, applied per symbol
    const W = Math.max(L.x1 - L.x0, H), D = U(-0.06, 0.06) * H, amp = U(0, 0.01) * H, per = U(3, 6) * H, ph = U(0, 6.283);
    for (const gr of L.g) {
      const cx = (gr.box[0] + gr.box[2]) / 2;
      const dy = D * (cx / W - 0.5) + amp * Math.sin(6.283 * cx / per + ph);
      for (const st of gr.strokes) for (const p of st) p[1] += dy;
      gr.box[1] += dy; gr.box[3] += dy;
    }
    if (li > 0) baseY = Math.max(baseY + U(1.8, 2.2) * H, prevBot - L.top + 0.35 * H);   // line pitch, never touching
    shift(L, li > 0 ? U(-0.5, 0.5) * H : 0, baseY);
    prevBot = L.bot;
    lines.push(L);
  });
  const groups = [].concat(...lines.map(l => l.g));
  let x0 = Infinity, y0 = Infinity;
  for (const gr of groups) for (const st of gr.strokes) for (const p of st) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); }
  const dx = U(20, 60) - x0, dy = U(20, 60) - y0;
  const strokes = [], symbols = [];
  for (const gr of groups) {
    const idx = [];
    for (const st of gr.strokes) { idx.push(strokes.length); strokes.push(st.map(p => [r1(p[0] + dx), r1(p[1] + dy)])); }
    symbols.push({ label: gr.label, strokes: idx });
  }
  const gt = [];
  rows.forEach((row, i) => { if (i) gt.push('\\\\'); gt.push(...toks(row)); });
  return { gt, strokes, symbols, writer: ctx.writer };
}

// ------------------------------------------------------------------ templates
const VARS = [['x', 45], ['y', 10], ['n', 8], ['a', 6], ['b', 5], ['m', 4], ['k', 4], ['t', 4], ['p', 4], ['r', 3], ['h', 3], ['w', 4]];
const v = () => wpick(VARS);
const num = () => wpick([[() => I(1, 9), 50], [() => I(10, 99), 40], [() => I(100, 999), 10]])();
const small = () => wpick([[() => I(1, 9), 65], [() => I(10, 20), 35]])();
const sgn = () => chance(0.3) ? '-' : '';
const relI = () => pick(['<', '>', '\\le', '\\ge']);
function dec() {
  return wpick([
    [() => `${I(1, 9)}.${I(1, 9)}`, 30],
    [() => `${I(1, 9)}.${pick(['25', '75', '5', '05', '15', '35', '45', '65', '85', '95'])}`, 25],
    [() => `0.${I(1, 9)}`, 15],
    [() => `0.${I(1, 9)}${I(1, 9)}`, 10],
    [() => `${I(10, 40)}.${I(1, 9)}${pick(['0', '5'])}`, 20],
  ])();
}
const hund = c => {   // hundredths (integer) -> shortest decimal string
  const neg = c < 0; c = Math.abs(c);
  const ip = Math.floor(c / 100), fp = c % 100;
  const f = fp === 0 ? '' : '.' + String(fp).padStart(2, '0').replace(/0$/, '');
  return (neg ? '-' : '') + ip + f;
};
const fr = () => { const qq = I(2, 12); return `\\frac{${I(1, qq - 1)}}{${qq}}`; };
const money = () => `\\$${wpick([[() => I(1, 9), 40], [() => I(10, 99), 50], [() => I(100, 250), 10]])()}.${I(0, 9)}${pick(['0', '5', '9', I(0, 9)])}`;

const T = {
  arith: [
    () => `${num()}+${num()}`,
    () => `${num()}-${num()}`,
    () => `${I(2, 12)}\\times${I(2, 12)}`,
    () => { const b = I(2, 9); return `${b * I(2, 12)}\\div${b}`; },
    () => `-${small()}+${small()}`,
    () => `-${small()}-${small()}`,
    () => `(-${I(1, 9)})(${I(1, 9)})`,
    () => `(-${I(2, 9)})\\times(-${I(2, 9)})`,
    () => `${dec()}+${dec()}`,
    () => `${dec()}-${dec()}`,
    () => `${I(2, 9)}\\cdot${I(2, 12)}`,
    () => { const a = num(), b = num(); return `${a}+${b}=${a + b}`; },
    () => { const a = I(2, 12), b = I(2, 12); return `${a}\\times${b}=${a * b}`; },
    () => `${small()}-(-${small()})`,
  ],
  linear: [
    () => { const x = v(), a = I(2, 9), s = I(1, 12), b = I(1, 20); return `${a}${x}+${b}=${a * s + b}`; },
    () => { const x = v(), a = I(2, 9), s = I(1, 12), b = I(1, 20); return `${a}${x}-${b}=${a * s - b}`; },
    () => { const x = v(), a = I(2, 9), s = I(-6, 6), b = I(1, 20); return `-${a}${x}+${b}=${-a * s + b}`; },
    () => { const x = v(), a = I(2, 9), b = I(1, 9), s = I(b + 1, b + 9); return `${a}(${x}-${b})=${a * (s - b)}`; },
    () => { const x = v(), a = I(2, 9), b = I(1, 9); return `${a}(${x}+${b})=${a * (I(1, 9) + b)}`; },
    () => `\\frac{${v()}}{${I(2, 9)}}=${I(2, 12)}`,
    () => { const x = v(), c = pick([150, 250, 50, 350, 120, 25, 75, 450]), s = 2 * I(1, 6), b = I(1, 12); return `${hund(c)}${x}+${b}=${hund(c * s + 100 * b)}`; },
    () => { const x = v(), p = I(1, 4), qq = I(p + 1, 9), s = qq * I(1, 4), b = I(1, 9); return `\\frac{${p}}{${qq}}${x}+${b}=${p * s / qq + b}`; },
    () => { const x = v(), a = num(); return `${x}+${a}=${a + num()}`; },
    () => { const x = v(), a = I(1, 30); return `${x}-${a}=${I(1, 30) - a}`; },
    () => { const x = v(), a = I(2, 12); return `${a}${x}=${a * I(2, 12)}`; },
    () => { const x = v(), a = I(4, 9), c = I(1, a - 1), s = I(1, 9), b = I(1, 9); return `${a}${x}+${b}=${c}${x}+${(a - c) * s + b}`; },
  ],
  ineq: [
    () => `${v()}${relI()}${sgn()}${small()}`,
    () => `${v()}\\ge-${I(1, 9)}`,
    () => `${I(2, 9)}${v()}+${I(1, 12)}${relI()}${num()}`,
    () => `${I(2, 9)}${v()}-${I(1, 12)}${relI()}${num()}`,
    () => `-${I(2, 9)}${v()}${relI()}${small()}`,
    () => `${v()}\\ne${I(0, 9)}`,
    () => `${num()}${relI()}${v()}`,
    () => { const a = I(1, 9); return `-${a}${pick(['<', '\\le'])}${v()}${pick(['<', '\\le'])}${I(1, 12)}`; },
  ],
  frac: [
    () => fr(),
    () => { const qq = I(2, 9); return `\\frac{${I(qq + 1, 3 * qq)}}{${qq}}`; },
    () => { const qq = I(2, 9); return `${I(1, 9)}\\frac{${I(1, qq - 1)}}{${qq}}`; },
    () => `${fr()}${pick(['+', '+', '-', '\\times', '\\div'])}${fr()}`,
    () => `-${fr()}`,
    () => `\\frac{${v()}${pick(['+', '-'])}${I(1, 9)}}{${I(2, 9)}}`,
    () => { const qq = I(2, 9), p = I(1, qq - 1), k = I(2, 5); return `\\frac{${p}}{${qq}}=\\frac{${p * k}}{${qq * k}}`; },
    () => { const qq = I(2, 9), p = I(1, qq - 1), w = I(1, 5); return `${w}\\frac{${p}}{${qq}}=\\frac{${w * qq + p}}{${qq}}`; },
  ],
  power: [
    () => `${I(2, 12)}^{${I(2, 5)}}`,
    () => `${v()}^{${pick([2, 2, 3, 4])}}`,
    () => `(-${I(2, 9)})^{${pick([2, 3, 2, 4])}}`,
    () => `10^{${pick(['-', ''])}${I(1, 9)}}`,
    () => `${I(1, 9)}.${I(1, 9)}${chance(0.4) ? I(1, 9) : ''}\\times10^{${chance(0.35) ? '-' : ''}${I(2, 9)}}`,
    () => { const x = v(); return `${x}^{2}${pick(['+', '-'])}${I(2, 9)}${x}${pick(['+', '-'])}${I(1, 12)}`; },
    () => `${I(2, 12)}^{0}=1`,
    () => { const x = v(); return `${x}^{${I(2, 6)}}\\cdot${x}^{${I(2, 6)}}`; },
    () => { const b = I(2, 5), e = I(2, 4); return `${b}^{${e}}=${b ** e}`; },
    () => `${I(2, 9)}^{2}+${I(2, 9)}^{2}`,
  ],
  root: [
    () => `\\sqrt{${I(2, 12) ** 2}}`,
    () => `\\sqrt{${v()}}`,
    () => `${I(2, 9)}\\sqrt{${pick([2, 3, 5, 6, 7, 10, 11])}}`,
    () => { const k = I(2, 12); return `\\sqrt{${k * k}}=${k}`; },
    () => { const k = I(2, 12); return `${v()}=\\sqrt{${k * k}}`; },
    () => `\\sqrt{${pick([2, 3, 5, 8, 10, 12, 18, 20, 27, 32, 45, 50, 72, 75, 98])}}`,
    () => `-\\sqrt{${I(2, 10) ** 2}}`,
    () => `\\sqrt{${I(2, 9) ** 2}}+\\sqrt{${I(2, 9) ** 2}}`,
    () => `\\sqrt[3]{${I(2, 5) ** 3}}`,
    () => { const k = I(1, 5); return `\\sqrt[3]{${k ** 3}}=${k}`; },
  ],
  pct: [
    () => `${I(1, 99)}\\%`,
    () => { const d = I(1, 9); return `0.${d}=${d}0\\%`; },
    () => { const dd = I(11, 99); return `0.${dd}=${dd}\\%`; },
    () => money(),
    () => { const qq = pick([2, 4, 5, 10, 20, 25]), p = I(1, qq - 1); return `\\frac{${p}}{${qq}}=${p * 100 / qq}\\%`; },
    () => `\\$${I(1, 99)}`,
    () => { const pp = I(1, 99); return `${pp}\\%=${hund(pp)}`; },
  ],
  abs: [
    () => { const a = I(1, 20); return `|-${a}|=${a}`; },
    () => `|${v()}|${pick(['\\le', '<', '\\ge', '>', '='])}${I(1, 12)}`,
    () => `|-${I(1, 30)}|`,
    () => { const a = I(1, 9), b = I(a + 1, 20); return `|${a}-${b}|=${b - a}`; },
    () => { const a = I(1, 12); return `-|-${a}|=-${a}`; },
  ],
  formula: [
    'A=\\pi r^{2}', 'C=2\\pi r', 'y=mx+b', 'P=2l+2w', 'a^{2}+b^{2}=c^{2}', 'd=rt', 'C=\\pi d', 'A=\\frac{1}{2}bh', 'A=bh',
    () => `y=${I(2, 9)}x${pick(['+', '-'])}${I(1, 12)}`,
    () => `y=-${I(1, 9)}x+${I(1, 12)}`,
    () => { const qq = I(2, 5); return `y=\\frac{${I(1, qq - 1)}}{${qq}}x${pick(['+', '-'])}${I(1, 9)}`; },
  ],
  ratio: [
    () => `${small()}:${small()}`,
    () => `${small()}:${small()}`,
    () => { const a = I(1, 9), b = I(1, 9), k = I(2, 5); return `${a}:${b}=${a * k}:${b * k}`; },
  ],
  multi: [
    () => { const x = v(), a = I(2, 9), s = I(1, 12), b = I(1, 20), c = a * s + b; return `${a}${x}+${b}=${c}\\\\${a}${x}=${c - b}\\\\${x}=${s}`; },
    () => { const x = v(), a = I(2, 9), s = I(1, 12), b = I(1, 20), c = a * s - b; return `${a}${x}-${b}=${c}\\\\${a}${x}=${c + b}\\\\${x}=${s}`; },
    () => { const x = v(), a = I(2, 9), s = I(2, 12); return `\\frac{${x}}{${a}}=${s}\\\\${x}=${a * s}`; },
    () => { const x = v(), a = I(2, 6), b = I(1, 9), s = I(1, 9); return `${a}(${x}+${b})=${a * (s + b)}\\\\${x}+${b}=${s + b}\\\\${x}=${s}`; },
    () => { const x = v(), a = I(2, 6), b = I(1, 12), s = I(-9, 9), c = -a * s + b; return `-${a}${x}+${b}\\ge${c}\\\\-${a}${x}\\ge${c - b}\\\\${x}\\le${s}`; },
    () => { const a = I(1, 20), b = I(2, 9), c = I(2, 9); return `${a}+${b}\\times${c}\\\\${a}+${b * c}\\\\${a + b * c}`; },
    () => { const x = v(), a = I(1, 30), b = I(1, 40); return `${x}+${a}=${b}\\\\${x}=${b - a}`; },
    () => { const x = v(), a = I(2, 12), s = I(2, 12); return `${a}${x}=${a * s}\\\\${x}=${s}`; },
    () => { const x = v(), a = I(2, 9), b = I(1, 9); return `${a}(${x}+${b})\\\\${a}${x}+${a * b}`; },
    () => { const x = v(), k = I(2, 12); return `${x}^{2}=${k * k}\\\\${x}=\\pm${k}`; },
  ],
};
const QUOTA = { arith: 80, linear: 90, ineq: 60, frac: 80, power: 80, root: 55, pct: 55, abs: 35, formula: 60, ratio: 30, multi: 75 };

// ------------------------------------------------------------------ main
const sum = Object.values(QUOTA).reduce((a, b) => a + b, 0);
const out = [], counts = {};
for (const [cat, n0] of Object.entries(QUOTA)) {
  const n = Math.round(n0 * TOTAL / sum);
  for (let i = 0; i < n; i++) {
    const t = pick(T[cat]);
    const tex = typeof t === 'function' ? t() : t;
    const e = compose(tex);
    const latex = tex.replace(/(\\(?:times|cdot|div|pm|le|ge|ne|pi))(?=[A-Za-z0-9])/g, '$1 ').replace(/\\\\/g, ' \\\\ ');   // '21\ge w', not '21\gew'
    out.push(JSON.stringify({ id: `${cat}_${String(i).padStart(3, '0')}`, cat, latex, gt: e.gt, strokes: e.strokes, symbols: e.symbols, writer: e.writer }));
    counts[cat] = (counts[cat] || 0) + 1;
  }
}
fs.writeFileSync(OUT, out.join('\n') + '\n');
console.log(`wrote ${out.length} expressions to ${OUT} (seed ${SEED}, ${WRITERS.length} writers)`);
console.log(Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', '));
