/* Replicator core — turns handwritten strokes into a TrueType font. No DOM and no dependencies, so it runs in
 * the page and in Node tests alike.
 *
 * Coordinates: every glyph is written in a box. Box space is 0..1 across and 0..1 down. The guide lines sit at
 * fixed heights in that box, and box space maps to font units (1000 per em, y up, baseline 0) as below. */
'use strict';

const UPM = 1000;
const BOX = { w: 1100, h: 1250, top: 950 };          // box size in font units; box top edge is at y = +950
const GUIDE = { cap: 700, x: 480, base: 0, desc: -230 };
// where each guide line falls inside the box, as a fraction of its height from the top
const GUIDE_FRAC = { cap: (BOX.top - GUIDE.cap) / BOX.h, x: (BOX.top - GUIDE.x) / BOX.h, base: BOX.top / BOX.h, desc: (BOX.top - GUIDE.desc) / BOX.h };

// The characters, in the order the sheet shows them. `alts` are extra code points that use the same drawing.
const SECTIONS = [
  { id: 'upper', name: 'Capitals', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') },
  { id: 'lower', name: 'Lowercase', chars: 'abcdefghijklmnopqrstuvwxyz'.split('') },
  { id: 'digits', name: 'Numbers', chars: '0123456789'.split('') },
  { id: 'punct', name: 'Punctuation', chars: ['.', ',', ':', ';', '!', '?', "'", '"', '(', ')', '[', ']', '{', '}', '-', '_', '/', '\\', '&', '@', '#', '$', '%', '*', '+', '=', '<', '>', '^', '~', '|'] },
  { id: 'math', name: 'Maths', chars: ['×', '÷', '±', '≠', '≤', '≥', '≈', 'π', 'θ', '°', '√', '∞', '½'] },
];
const ALTS = { "'": [0x2018, 0x2019], '"': [0x201C, 0x201D], '-': [0x2212, 0x2010, 0x2011], '×': [], '·': [] };
const DESCENDERS = new Set(['g', 'j', 'p', 'q', 'y', ',', ';']);
const FLOATING = new Set(["'", '"', '-', '_', '*', '^', '~', '°', '=', '+', '×', '÷', '±', '≠', '≈', '<', '>', '≤', '≥', '∞', ':']);

// ------------------------------------------------------------------ strokes
// Whatever was stored or opened: keep only finite [x, y] points, drop empty strokes, never throw.
function cleanStrokes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    if (!Array.isArray(s)) continue;
    const q = [];
    for (const p of s) if (Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]) && p[0] !== null && p[1] !== null && p[0] !== '' && p[1] !== '') q.push([+p[0], +p[1]]);
    if (q.length) out.push(q);
  }
  return out;
}
// box strokes ([[x, y], ...] in 0..1) -> font units
function toUnits(stroke) { return stroke.map(p => [p[0] * BOX.w, BOX.top - p[1] * BOX.h]); }

// even out the pen's sampling: a point every `spacing` font units along the stroke
function resample(stroke, spacing) {
  if (stroke.length < 3) return stroke.map(p => p.slice());
  const out = [stroke[0].slice()];
  let acc = 0;
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1], b = stroke[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t0 = 0;
    while (acc + d * (1 - t0) >= spacing) {
      const t = t0 + (spacing - acc) / d;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      t0 = t; acc = 0;
    }
    acc += d * (1 - t0);
  }
  const last = stroke[stroke.length - 1];
  if (Math.hypot(last[0] - out[out.length - 1][0], last[1] - out[out.length - 1][1]) > spacing * 0.25) out.push(last.slice());
  return out;
}
// Smoothing 0..10 is a Gaussian along the stroke with this sigma, in font units (the cap height is 700): the shake of
// the hand goes, corners (a turn of more than about 70°) stay sharp, and every stroke still starts and ends where it did.
const SMOOTH_SIGMA = [0, 5, 9, 14, 20, 27, 35, 44, 54, 65, 78];
function smooth(stroke, spacing, level) {
  const pts = resample(stroke, spacing);
  const sigma = SMOOTH_SIGMA[Math.max(0, Math.min(10, Math.round(+level || 0)))];
  if (!sigma || pts.length < 4) return pts;
  const m = Math.max(2, Math.round(Math.max(15, 0.6 * sigma) / spacing));
  const out = [];
  let from = 0;
  for (const c of cornersOf(pts, m).concat([pts.length - 1])) {
    const piece = gaussPath(pts.slice(from, c + 1), sigma / spacing);
    if (out.length) piece.shift();
    for (const p of piece) out.push(p);
    from = c;
  }
  return out;
}
// where a stroke turns sharply: the turn between the m points before and the m after, at its sharpest
function cornersOf(pts, m) {
  const n = pts.length, ang = new Float64Array(n), out = [];
  for (let i = m; i + m < n; i++) {
    const ax = pts[i][0] - pts[i - m][0], ay = pts[i][1] - pts[i - m][1], bx = pts[i + m][0] - pts[i][0], by = pts[i + m][1] - pts[i][1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la > 0 && lb > 0) ang[i] = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
  }
  for (let i = m; i + m < n; i++) {
    if (ang[i] < 1.2) continue;
    let peak = true;
    for (let j = i - m; j <= i + m && peak; j++) if (ang[j] > ang[i] || (ang[j] === ang[i] && j < i)) peak = false;
    if (peak) out.push(i);
  }
  return out;
}
// Gaussian smoothing (sigma in points) with both ends held: the path is mirrored through each end, so a straight run
// stays straight up to its end and the end point does not move
function gaussPath(pts, s) {
  const n = pts.length;
  if (n < 3 || !(s > 0)) return pts.map(p => p.slice());
  const r = Math.ceil(3 * s), w = [];
  let tot = 0;
  for (let k = -r; k <= r; k++) { const v = Math.exp(-k * k / (2 * s * s)); w.push(v); tot += v; }
  const at = i => {
    if (i < 0) { const q = pts[Math.min(n - 1, -i)]; return [2 * pts[0][0] - q[0], 2 * pts[0][1] - q[1]]; }
    if (i >= n) { const q = pts[Math.max(0, 2 * (n - 1) - i)]; return [2 * pts[n - 1][0] - q[0], 2 * pts[n - 1][1] - q[1]]; }
    return pts[i];
  };
  const out = [pts[0].slice()];
  for (let i = 1; i < n - 1; i++) {
    let x = 0, y = 0;
    for (let k = -r; k <= r; k++) { const q = at(i + k); x += w[k + r] * q[0]; y += w[k + r] * q[1]; }
    out.push([x / tot, y / tot]);
  }
  out.push(pts[n - 1].slice());
  return out;
}

// ------------------------------------------------------------------ ink: strokes -> coverage raster
// Each pixel's coverage is how far it lies inside the pen's reach of the nearest stroke segment
// (1 inside, 0 outside, a one-pixel ramp at the edge), so the 0.5 contour is exactly the pen outline.
function rasterize(strokes, weight, unit) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const r = weight / 2, pad = r + 3 * unit;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const W = Math.ceil((x1 - x0) / unit) + 2, H = Math.ceil((y1 - y0) / unit) + 2;
  const a = new Float32Array(W * H);
  const rp = r / unit, lim = rp + 0.5, lim2 = lim * lim;
  for (const s of strokes) {
    const P = s.map(p => [(p[0] - x0) / unit, (p[1] - y0) / unit]);
    if (P.length === 1) P.push(P[0].slice());
    for (let i = 0; i + 1 < P.length; i++) {
      const ax = P[i][0], ay = P[i][1], dx = P[i + 1][0] - ax, dy = P[i + 1][1] - ay, L2 = dx * dx + dy * dy;
      const gx0 = Math.max(0, Math.floor(Math.min(ax, ax + dx) - lim - 1)), gx1 = Math.min(W - 1, Math.ceil(Math.max(ax, ax + dx) + lim + 1));
      const gy0 = Math.max(0, Math.floor(Math.min(ay, ay + dy) - lim - 1)), gy1 = Math.min(H - 1, Math.ceil(Math.max(ay, ay + dy) + lim + 1));
      for (let y = gy0; y <= gy1; y++) {
        const py = y + 0.5 - ay, row = y * W;
        for (let x = gx0; x <= gx1; x++) {
          const k = row + x;
          if (a[k] >= 1) continue;                                   // already solid ink
          const px = x + 0.5 - ax;
          let t = L2 > 0 ? (px * dx + py * dy) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = px - t * dx, ey = py - t * dy, d2 = ex * ex + ey * ey;
          if (d2 >= lim2) continue;
          const c = lim - Math.sqrt(d2);                             // distance inside the pen's edge, in pixels
          if (c > a[k]) a[k] = c > 1 ? 1 : c;
        }
      }
    }
  }
  return { a, W, H, x0, y0, unit };
}

// ------------------------------------------------------------------ outline: raster -> closed loops
// Marching squares on pixel centres with linear interpolation; segments are oriented so the ink is always on
// the same side, which makes outer edges and holes come out in opposite directions (needed for the fill rule).
function trace(R) {
  const { a, W, H } = R;
  const v = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : a[y * W + x];
  const T = 0.5;
  // edge ids: horizontal edge (x, y)-(x+1, y) = 2*(y*(W+1)+x), vertical (x, y)-(x, y+1) = that + 1
  const hid = (x, y) => 2 * ((y + 1) * (W + 2) + (x + 1)), vid = (x, y) => hid(x, y) + 1;
  const pt = new Map(), next = new Map();
  const at = (id, x, y, xb, yb) => { // crossing point on the edge between (x,y) and (xb,yb)
    if (!pt.has(id)) { const va = v(x, y), vb = v(xb, yb), t = (T - va) / ((vb - va) || 1e-9); pt.set(id, [x + 0.5 + (xb - x) * t, y + 0.5 + (yb - y) * t]); }
    return id;
  };
  for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
    const tl = v(x, y) >= T, tr = v(x + 1, y) >= T, br = v(x + 1, y + 1) >= T, bl = v(x, y + 1) >= T;
    const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (c === 0 || c === 15) continue;
    const top = () => at(hid(x, y), x, y, x + 1, y), right = () => at(vid(x + 1, y), x + 1, y, x + 1, y + 1);
    const bottom = () => at(hid(x, y + 1), x, y + 1, x + 1, y + 1), left = () => at(vid(x, y), x, y, x, y + 1);
    // ink kept on the right of each segment (image coordinates, y down)
    const seg = (p, q) => next.set(p, q);
    const centre = (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4 >= T;
    switch (c) {
      case 1: seg(left(), bottom()); break;
      case 2: seg(bottom(), right()); break;
      case 3: seg(left(), right()); break;
      case 4: seg(right(), top()); break;
      case 5: if (centre) { seg(left(), top()); seg(right(), bottom()); } else { seg(left(), bottom()); seg(right(), top()); } break;
      case 6: seg(bottom(), top()); break;
      case 7: seg(left(), top()); break;
      case 8: seg(top(), left()); break;
      case 9: seg(top(), bottom()); break;
      case 10: if (centre) { seg(top(), right()); seg(bottom(), left()); } else { seg(top(), left()); seg(bottom(), right()); } break;
      case 11: seg(top(), right()); break;
      case 12: seg(right(), left()); break;
      case 13: seg(right(), bottom()); break;
      case 14: seg(bottom(), left()); break;
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let k = start;
    while (k !== undefined && !seen.has(k)) { seen.add(k); loop.push(pt.get(k)); k = next.get(k); }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// closed-polygon Douglas-Peucker
function simplify(loop, tol) {
  const n = loop.length;
  if (n < 6) return loop;
  // split at the two most distant points, simplify each half
  let i0 = 0, i1 = 0, best = -1;
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 64))) for (let j = i + 1; j < n; j += Math.max(1, Math.floor(n / 64))) {
    const d = (loop[i][0] - loop[j][0]) ** 2 + (loop[i][1] - loop[j][1]) ** 2; if (d > best) { best = d; i0 = i; i1 = j; }
  }
  const rdp = pts => {
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let md = -1, mi = -1;
      const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } }
      if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  const h1 = loop.slice(i0, i1 + 1), h2 = loop.slice(i1).concat(loop.slice(0, i0 + 1));
  return rdp(h1).slice(0, -1).concat(rdp(h2).slice(0, -1));
}

function area(loop) { let s = 0; for (let i = 0; i < loop.length; i++) { const p = loop[i], q = loop[(i + 1) % loop.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; }

// ------------------------------------------------------------------ even sizes
// A letter's drawing scaled (across and down alike, before the pen is applied, so the pen keeps its weight) and moved
// so it spans its guides: the x-height for a, c, e, …; the cap height for capitals, digits and b, d, h, k, l; x-height
// to descender for g, p, q, y. Scaling stays within 0.7–1.4. Letters whose height varies by design (i, j, t, f, J, Q)
// and the rest only move, as "Line up with the guides" does.
const FIT = {};
for (const c of 'acemnorsuvwxz') FIT[c] = [GUIDE.base, GUIDE.x];
for (const c of 'bdhkl') FIT[c] = [GUIDE.base, GUIDE.cap];
for (const c of 'gpqy') FIT[c] = [GUIDE.desc, GUIDE.x];
for (const c of 'ABCDEFGHIKLMNOPRSTUVWXYZ0123456789') FIT[c] = [GUIDE.base, GUIDE.cap];
function fitToGuides(S, ch) {
  const f = FIT[ch];
  if (!f) return null;
  let x0 = Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of S) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  if (!(y1 - y0 > 1)) return null;
  const k = Math.max(0.7, Math.min(1.4, (f[1] - f[0]) / (y1 - y0))), down = DESCENDERS.has(ch);
  // descending letters keep their tops on the x-height, the rest their feet on the baseline
  return S.map(s => s.map(p => [x0 + (p[0] - x0) * k, down ? f[1] - (y1 - p[1]) * k : f[0] + (p[1] - y0) * k]));
}

// ------------------------------------------------------------------ one glyph
// strokes: box-space strokes. Returns {contours: [[x, y]...] in font units (y up), bbox} or null when empty.
// opts.even with opts.ch: fitted to the guides (above).
function outline(strokes, o) {
  const opts = Object.assign({ weight: 80, smoothing: 2 }, o || {});
  const unit = opts.unit || Math.max(3, opts.weight / 27);           // finer raster for thin pens
  let S = cleanStrokes(strokes).map(s => smooth(toUnits(s), 6, opts.smoothing));
  if (!S.length) return null;
  if (opts.even && opts.ch) S = fitToGuides(S, opts.ch) || S;
  const R = rasterize(S, opts.weight, unit);
  const loops = trace(R)
    .map(l => simplify(l, 0.35))
    .filter(l => l.length >= 3 && Math.abs(area(l)) > 2)
    .map(l => l.map(p => [R.x0 + p[0] * R.unit, R.y0 + p[1] * R.unit]));   // back to font units (y up already)
  if (!loops.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of loops) for (const p of l) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { contours: loops, bbox: [x0, y0, x1, y1] };
}

// Line glyphs up with the guides they were written against: a letter that sits a little above or below the
// baseline is moved onto it; descending letters line up their tops with the x-height instead.
function tidyShift(ch, bbox, o) {
  if (!o || !o.tidy) return 0;
  const tol = 0.14 * GUIDE.cap;
  if (FLOATING.has(ch)) return 0;
  if (DESCENDERS.has(ch)) {
    if (!/[a-z]/.test(ch) || ch === 'j') return 0;
    const top = bbox[3];
    return Math.abs(top - GUIDE.x) < tol ? GUIDE.x - top : 0;
  }
  const bottom = bbox[1];
  return Math.abs(bottom - GUIDE.base) < tol ? GUIDE.base - bottom : 0;
}

// A traced polygon as a TrueType contour: the polygon's corners become off-curve controls of a smooth quadratic
// B-spline whose on-curve points sit at the middle of each edge. Integer font units; TrueType draws outer edges
// clockwise, so the tracer's counter-clockwise loops are reversed. Returns [[x, y, onCurve], ...] or null.
function toContour(loop, dx, dy) {
  const P = [];
  for (let i = loop.length - 1; i >= 0; i--) {
    const p = [Math.round(loop[i][0] + dx), Math.round(loop[i][1] + dy)], q = P[P.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) P.push(p);
  }
  while (P.length > 1 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1]) P.pop();
  if (P.length < 3) return null;
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[(i + P.length - 1) % P.length], b = P[i];
    out.push([Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2), 1], [b[0], b[1], 0]);
  }
  return out;
}

// ------------------------------------------------------------------ TrueType file
// A complete, unhinted TrueType font (glyf outlines): head hhea maxp OS/2 hmtx cmap loca glyf name post gasp.
// font: {family, glyphs: [{codes: [code points], adv, contours: [[[x, y, on], ...], ...]}], asc, desc, capH, xH}
// Glyph 0 must be .notdef. Returns a Uint8Array.
class Bytes {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); return this; }
  u16(v) { v &= 0xFFFF; this.a.push(v >> 8, v & 255); return this; }
  i16(v) { return this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v) { v >>>= 0; this.a.push(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return this; }
  tag(s) { for (let i = 0; i < 4; i++) this.a.push(s.charCodeAt(i)); return this; }
  add(b) { for (const v of (b.a || b)) this.a.push(v); return this; }
  pad(k) { while (this.a.length % k) this.a.push(0); return this; }
}
function writeTTF(font) {
  const G = font.glyphs, n = G.length;
  // ---- glyf + loca
  const glyf = new Bytes(), loca = [], boxes = [];
  let maxPts = 0, maxCtr = 0;
  for (const g of G) {
    loca.push(glyf.a.length);
    const cs = (g.contours || []).filter(c => c && c.length >= 3);
    if (!cs.length) { boxes.push(null); continue; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, npts = 0;
    for (const c of cs) for (const [x, y] of c) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); npts++; }
    boxes.push([x0, y0, x1, y1]);
    maxPts = Math.max(maxPts, npts); maxCtr = Math.max(maxCtr, cs.length);
    glyf.i16(cs.length).i16(x0).i16(y0).i16(x1).i16(y1);
    let end = -1;
    for (const c of cs) { end += c.length; glyf.u16(end); }
    glyf.u16(0);                                                           // no instructions
    const flags = [], xs = new Bytes(), ys = new Bytes();
    let px = 0, py = 0;
    for (const c of cs) for (const [x, y, on] of c) {
      let f = on ? 1 : 0;
      const dx = x - px, dy = y - py;
      if (dx === 0) f |= 0x10; else if (dx > -256 && dx < 256) { f |= 0x02 | (dx > 0 ? 0x10 : 0); xs.u8(Math.abs(dx)); } else xs.i16(dx);
      if (dy === 0) f |= 0x20; else if (dy > -256 && dy < 256) { f |= 0x04 | (dy > 0 ? 0x20 : 0); ys.u8(Math.abs(dy)); } else ys.i16(dy);
      flags.push(f); px = x; py = y;
    }
    for (const f of flags) glyf.u8(f);
    glyf.add(xs).add(ys).pad(4);
  }
  loca.push(glyf.a.length);
  const locaT = new Bytes(); for (const o of loca) locaT.u32(o);
  // ---- metrics
  let xMin = 0, yMin = 0, xMax = 0, yMax = 0, first = true, advMax = 0, minL = 0x7FFF, minR = 0x7FFF, ext = -0x8000, wsum = 0, wn = 0;
  G.forEach((g, i) => {
    advMax = Math.max(advMax, g.adv);
    if (g.adv > 0) { wsum += g.adv; wn++; }
    const b = boxes[i]; if (!b) return;
    if (first) { [xMin, yMin, xMax, yMax] = b; first = false; }
    else { xMin = Math.min(xMin, b[0]); yMin = Math.min(yMin, b[1]); xMax = Math.max(xMax, b[2]); yMax = Math.max(yMax, b[3]); }
    minL = Math.min(minL, b[0]); minR = Math.min(minR, g.adv - b[2]); ext = Math.max(ext, b[2]);
  });
  if (first) { minL = minR = 0; ext = 0; }
  const asc = font.asc, desc = font.desc;                                   // desc is negative
  const hmtx = new Bytes(); G.forEach((g, i) => { hmtx.u16(g.adv).i16(boxes[i] ? boxes[i][0] : 0); });
  // ---- cmap (format 4, BMP)
  const map = new Map();
  G.forEach((g, i) => { for (const c of g.codes || []) if (c > 0 && c < 0xFFFF && !map.has(c)) map.set(c, i); });
  const codes = [...map.keys()].sort((a, b) => a - b);
  const segs = [];
  for (const c of codes) {
    const s = segs[segs.length - 1], gi = map.get(c);
    if (s && c === s.end + 1 && gi === map.get(s.end) + 1) s.end = c; else segs.push({ start: c, end: c, delta: (gi - c) & 0xFFFF });
  }
  segs.push({ start: 0xFFFF, end: 0xFFFF, delta: 1 });
  const sc = segs.length, sr = 2 * Math.pow(2, Math.floor(Math.log2(sc)));
  const sub = new Bytes();
  sub.u16(4).u16(16 + 8 * sc).u16(0).u16(2 * sc).u16(sr).u16(Math.log2(sr / 2)).u16(2 * sc - sr);
  for (const s of segs) sub.u16(s.end);
  sub.u16(0);
  for (const s of segs) sub.u16(s.start);
  for (const s of segs) sub.u16(s.delta);
  for (let i = 0; i < sc; i++) sub.u16(0);
  const cmap = new Bytes().u16(0).u16(2).u16(0).u16(3).u32(20).u16(3).u16(1).u32(20).add(sub);
  // ---- names
  const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  const family = Array.from(clean(font.family)).slice(0, 31).join('').trim() || 'My Handwriting';
  const ps = (family.replace(/[^A-Za-z0-9-]/g, '') || 'Handwriting').slice(0, 54) + '-Regular';
  const now = new Date(typeof font.date === 'number' && isFinite(font.date) ? font.date : Date.now());
  const recs = [[0, font.copyright || ('Made with Replicator, ' + now.getUTCFullYear())], [1, family], [2, 'Regular'],
    [3, 'Replicator: ' + family + ': ' + now.toISOString().slice(0, 10)], [4, family], [5, 'Version 1.000'], [6, ps], [8, 'Replicator']];
  const utf16 = s => { const b = []; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b.push(c >> 8, c & 255); } return b; };
  const ascii = s => /^[\x20-\x7e]*$/.test(s);
  const entries = [];
  for (const [id, s] of recs) if (ascii(s)) entries.push({ p: 1, e: 0, l: 0, id, b: [...s].map(c => c.charCodeAt(0)) });   // Mac Roman
  for (const [id, s] of recs) entries.push({ p: 3, e: 1, l: 0x409, id, b: utf16(s) });                                       // Windows Unicode
  const name = new Bytes().u16(0).u16(entries.length).u16(6 + 12 * entries.length), strs = new Bytes();
  for (const r of entries) { name.u16(r.p).u16(r.e).u16(r.l).u16(r.id).u16(r.b.length).u16(strs.a.length); strs.add(r.b); }
  name.add(strs);
  // ---- fixed tables
  const secs = Math.floor(now.getTime() / 1000) + 2082844800;             // LONGDATETIME: seconds since 1904
  const head = new Bytes().u16(1).u16(0).u32(0x10000).u32(0).u32(0x5F0F3CF5).u16(0x000B).u16(UPM)
    .u32(Math.floor(secs / 4294967296)).u32(secs >>> 0).u32(Math.floor(secs / 4294967296)).u32(secs >>> 0)
    .i16(xMin).i16(yMin).i16(xMax).i16(yMax).u16(0).u16(8).i16(2).i16(1).i16(0);
  const hhea = new Bytes().u32(0x10000).i16(asc).i16(desc).i16(0).u16(advMax).i16(minL).i16(minR).i16(ext)
    .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(n);
  const maxp = new Bytes().u32(0x10000).u16(n).u16(maxPts).u16(maxCtr).u16(0).u16(0).u16(2);
  for (let i = 0; i < 8; i++) maxp.u16(0);
  const has = test => codes.some(test);
  const ur1 = (has(c => c >= 0x20 && c < 0x7F) ? 1 : 0) | (has(c => c >= 0xA0 && c < 0x100) ? 2 : 0) | (has(c => c >= 0x370 && c < 0x400) ? 1 << 7 : 0) |
    (has(c => c >= 0x2000 && c < 0x2070) ? 1 << 31 : 0);
  const ur2 = has(c => c >= 0x2200 && c < 0x2300) ? 1 << 6 : 0;            // bit 38: mathematical operators
  const os2 = new Bytes().u16(4).i16(Math.round(wn ? wsum / wn : 500)).u16(400).u16(5).u16(0)
    .i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350).i16(50).i16(Math.round((font.xH || 480) / 2))
    .i16(0x0A00);                                                            // family class: scripts
  for (const v of [3, 0, 0, 0, 0, 0, 0, 0, 0, 0]) os2.u8(v);               // PANOSE: Latin hand written
  os2.u32(ur1).u32(ur2).u32(0).u32(0).tag('NONE').u16(0x40 | 0x80)
    .u16(codes.length ? Math.min(codes[0], 0xFFFF) : 0x20).u16(codes.length ? Math.min(codes[codes.length - 1], 0xFFFF) : 0x20)
    .i16(asc).i16(desc).i16(0).u16(Math.max(asc, yMax)).u16(Math.max(-desc, -yMin))
    .u32(1).u32(0).i16(font.xH || 480).i16(font.capH || 700).u16(0).u16(32).u16(1);
  const post = new Bytes().u32(0x30000).u32(0).i16(-120).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0);
  const gasp = new Bytes().u16(1).u16(1).u16(0xFFFF).u16(0x000F);
  // ---- assemble: table directory, tables 4-byte aligned, checksums, head.checkSumAdjustment
  const tables = [['OS/2', os2], ['cmap', cmap], ['gasp', gasp], ['glyf', glyf], ['head', head], ['hhea', hhea], ['hmtx', hmtx],
    ['loca', locaT], ['maxp', maxp], ['name', name], ['post', post]];
  const sum = a => { let s = 0; for (let i = 0; i < a.length; i += 4) s = (s + ((a[i] << 24) | ((a[i + 1] || 0) << 16) | ((a[i + 2] || 0) << 8) | (a[i + 3] || 0))) >>> 0; return s; };
  const nt = tables.length, srt = 16 * Math.pow(2, Math.floor(Math.log2(nt)));
  const out = new Bytes().u32(0x10000).u16(nt).u16(srt).u16(Math.floor(Math.log2(nt))).u16(nt * 16 - srt);
  let off = 12 + 16 * nt, headAt = 0;
  for (const [tag, t] of tables) {
    const len = t.a.length;
    out.tag(tag).u32(sum(t.a)).u32(off).u32(len);
    if (tag === 'head') headAt = off;
    off += (len + 3) & ~3;
  }
  for (const [, t] of tables) out.add(t.a).pad(4);
  const bytes = Uint8Array.from(out.a);
  const adj = (0xB1B0AFBA - sum(bytes)) >>> 0;
  bytes[headAt + 8] = adj >>> 24; bytes[headAt + 9] = (adj >>> 16) & 255; bytes[headAt + 10] = (adj >>> 8) & 255; bytes[headAt + 11] = adj & 255;
  return bytes;
}

// ------------------------------------------------------------------ the font
const FONT_DEFAULTS = { name: 'My Handwriting', weight: 80, spacing: 50, smoothing: 2, tidy: true, even: false, cache: null };
const fits = (ch, opts) => !!(opts.even && FIT[ch]);
// one glyph's outline, kept in opts.cache (a Map) while its strokes and the pen settings stay the same
function cachedOutline(ch, st, opts) {
  const key = JSON.stringify([st, opts.weight, opts.smoothing, fits(ch, opts)]);
  let ol = opts.cache && opts.cache.get(ch);
  if (!ol || ol.key !== key) { ol = { key, g: outline(st, Object.assign({}, opts, { ch })) }; if (opts.cache) opts.cache.set(ch, ol); }
  return ol.g;
}
// Traces the outlines buildFont will need into opts.cache, one glyph per step, so a page can spread the work
// over many frames and stay responsive; buildFont afterwards only assembles the file.
function* warm(glyphs, o) {
  const opts = Object.assign({}, FONT_DEFAULTS, o || {});
  for (const sec of SECTIONS) for (const ch of sec.chars) {
    const st = cleanStrokes(glyphs && glyphs[ch]);
    if (!st.length) continue;
    const key = JSON.stringify([st, opts.weight, opts.smoothing, fits(ch, opts)]), ol = opts.cache && opts.cache.get(ch);
    if (ol && ol.key === key) continue;
    cachedOutline(ch, st, opts);
    yield ch;
  }
}
// glyphs: {char: [strokes in box space]}. Returns {bytes (a TrueType font), built, missing, metrics}.
function buildFont(glyphs, o) {
  const opts = Object.assign({}, FONT_DEFAULTS, o || {});
  const box = (x0, y0, x1, y1) => [[x0, y0, 1], [x0, y1, 1], [x1, y1, 1], [x1, y0, 1]];   // clockwise
  const list = [
    { codes: [], adv: 500, contours: [box(60, 0, 440, 700), box(110, 50, 390, 650).reverse()] },   // .notdef: a hollow box
    { codes: [32, 0xA0], adv: Math.round(0.4 * GUIDE.cap + 2 * opts.spacing), contours: [] },      // space, no-break space
  ];
  const built = [], missing = [];
  let yMax = GUIDE.cap, yMin = GUIDE.desc;
  for (const sec of SECTIONS) for (const ch of sec.chars) {
    const st = cleanStrokes(glyphs && glyphs[ch]);
    const g = st.length ? cachedOutline(ch, st, opts) : null;
    if (!g) { missing.push(ch); continue; }
    const dy = fits(ch, opts) ? 0 : tidyShift(ch, g.bbox, opts), dx = opts.spacing - g.bbox[0];
    const contours = g.contours.map(l => toContour(l, dx, dy)).filter(Boolean);
    if (!contours.length) { missing.push(ch); continue; }
    list.push({ codes: [ch.codePointAt(0)].concat(ALTS[ch] || []), adv: Math.max(1, Math.round(g.bbox[2] - g.bbox[0] + 2 * opts.spacing)), contours });
    built.push(ch);
    yMax = Math.max(yMax, g.bbox[3] + dy); yMin = Math.min(yMin, g.bbox[1] + dy);
  }
  const asc = Math.ceil(Math.max(900, yMax + 30)), desc = Math.floor(Math.min(-300, yMin - 30));
  const bytes = writeTTF({ family: opts.name, glyphs: list, asc, desc, capH: GUIDE.cap, xH: GUIDE.x, date: opts.date });
  return { bytes, built, missing, metrics: { asc, desc, upm: UPM } };
}

// ------------------------------------------------------------------ sentences: the letters written in context
// A sentence is written on ruled lines whose guides sit where a box's do. Its strokes are given in line units: one
// unit is the height of a box, y = 0 at the top of the line's box and 1 at its bottom (so the guides are at
// GUIDE_FRAC), x growing to the right. A box drawing's x (0..1 of the box's width) is x · LU in line units.
const LU = BOX.w / BOX.h;
const toLine = st => st.map(s => s.map(p => [p[0] * LU, p[1]]));
const toBox = st => st.map(s => s.map(p => [p[0] / LU, p[1]]));
function plength(s) { let L = 0; for (let i = 1; i < s.length; i++) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); return L; }
// m points spread evenly along a stroke (one point: its middle)
function along(s, m) {
  if (m <= 1 || s.length === 1) { const c = s.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]); return [[c[0] / s.length, c[1] / s.length]]; }
  const L = plength(s), out = [];
  if (!(L > 0)) return Array.from({ length: m }, () => s[0].slice());
  let k = 0, acc = 0;
  for (let j = 0; j < m; j++) {
    const want = (L * j) / (m - 1);
    while (k + 1 < s.length - 1 && acc + Math.hypot(s[k + 1][0] - s[k][0], s[k + 1][1] - s[k][1]) < want) { acc += Math.hypot(s[k + 1][0] - s[k][0], s[k + 1][1] - s[k][1]); k++; }
    const d = Math.hypot(s[k + 1][0] - s[k][0], s[k + 1][1] - s[k][1]) || 1e-9, t = Math.max(0, Math.min(1, (want - acc) / d));
    out.push([s[k][0] + (s[k + 1][0] - s[k][0]) * t, s[k][1] + (s[k + 1][1] - s[k][1]) * t]);
  }
  return out;
}
// exactly n points spread over the strokes by their lengths (every stroke at least one), centred across but kept at
// their height against the guides
function cloud(st, n) {
  const L = st.map(plength), tot = L.reduce((a, b) => a + b, 0);
  const share = st.map((s, i) => (tot > 0 ? (n - st.length) * L[i] / tot : 0));
  const m = share.map(v => 1 + Math.floor(v));
  let left = n - m.reduce((a, b) => a + b, 0);
  share.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { m[i]++; left--; } });
  const pts = [];
  st.forEach((s, i) => { if (m[i] > 0) pts.push(...along(s, m[i])); });
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  return pts.map(p => [p[0] - cx, p[1]]);
}
// how far apart two clouds of the same size are: each point matched greedily to the nearest unmatched one, early
// matches counting more (the $P recogniser's measure), the better of both directions; in line units
function cloudDist(a, b) {
  const one = (A, B) => {
    const n = A.length, used = new Uint8Array(B.length), step = Math.max(1, Math.floor(Math.sqrt(n)));
    let best = Infinity;
    for (let start = 0; start < n; start += step) {
      used.fill(0);
      let sum = 0, ws = 0;
      for (let k = 0; k < n; k++) {
        const p = A[(start + k) % n];
        let md = Infinity, mj = -1;
        for (let j = 0; j < B.length; j++) if (!used[j]) { const dx = p[0] - B[j][0], dy = p[1] - B[j][1], d = dx * dx + dy * dy; if (d < md) { md = d; mj = j; } }
        if (mj < 0) break;
        used[mj] = 1;
        const w = 1 - k / n;
        sum += w * Math.sqrt(md); ws += w;
        if (sum / ws > best) break;
      }
      best = Math.min(best, sum / ws);
    }
    return best;
  };
  return Math.min(one(a, b), one(b, a));
}
const sbox = st => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return [x0, y0, x1, y1]; };
const SENT = { n: 24, accept: 0.085, skip: 0.4, wordGap: 0.08, letterGap: 0.33, maxGroup: 4 };
// A written sentence, matched letter by letter to its text.
// lines: [[stroke, ...], ...] — the strokes on each ruled line in line units, in the order written.
// text: what was written; templates: {char: [drawings in line units]} (the box drawing first).
// Returns {letters: [{ch, strokes (line units, on its own line), line, cost, ok}], cost} where ok marks a letter close
// enough to its own drawings to learn from; characters without a drawing are matched loosely and never ok.
// Dots and crossings added after the rest of a word (the dot of an i, the bar of a t) are given to the letter under
// them; a stray stroke or a letter left out is passed over.
function alignSentence(lines, text, templates, o) {
  const P = Object.assign({}, SENT, o || {});
  const chars = [], spaceBefore = [];
  let sp = false;
  for (const ch of String(text || '')) { if (/\s/.test(ch)) { sp = chars.length > 0; continue; } chars.push(ch); spaceBefore.push(sp); sp = false; }
  // all the lines as one long line (each next one further right), keeping writing order
  const all = [];
  (Array.isArray(lines) ? lines : []).forEach((ln, li) => { for (const s of cleanStrokes(ln)) all.push({ s: s.map(p => [p[0] + li * 1000, p[1]]), li, b: null }); });
  for (const t of all) t.b = sbox([t.s]);
  // late strokes: small marks written to the left of the stroke before them (going back to dot or cross)
  const main = [], late = [];
  for (const t of all) {
    const prev = main[main.length - 1], h = t.b[3] - t.b[1], w = t.b[2] - t.b[0];
    if (prev && t.b[2] < prev.b[0] - 0.02 && Math.max(h, w) < 0.45) late.push(t); else main.push(t);
  }
  const N = main.length, M = chars.length;
  if (!M || !N) return { letters: [], cost: Infinity };
  const tc = {}, T0 = templates && typeof templates === 'object' ? templates : {};
  const tmpl = ch => (Array.isArray(T0[ch]) ? T0[ch] : []).map(cleanStrokes).filter(d => d.length).slice(0, 5).map(d => ({ c: cloud(d, P.n), k: d.length }));
  for (const ch of new Set(chars)) tc[ch] = tmpl(ch);
  // every other character's first drawing, to make sure a letter learned looks like itself more than like another
  const others = Object.keys(T0).filter(ch => [...ch].length === 1).map(ch => [ch, tmpl(ch)[0]]).filter(([, t]) => t);
  const reach = new Float64Array(N + 1).fill(-Infinity);                // furthest right reached by the first i strokes
  for (let i = 0; i < N; i++) reach[i + 1] = Math.max(reach[i], main[i].b[2]);
  const memo = new Map();
  const groupCost = (i, k, j) => {
    const ch = chars[j], key = i + ',' + k + ',' + ch;
    let c = memo.get(key);
    if (c === undefined) {
      const st = main.slice(i, i + k).map(t => t.s), T = tc[ch];
      if (T.length) {
        const g = cloud(st, P.n);
        c = Math.min(...T.map(t => cloudDist(g, t.c) + 0.015 * Math.abs(k - t.k)));
      } else c = 0.11 + 0.02 * Math.max(0, k - 2);                     // no drawing of it to compare with
      memo.set(key, c);
    }
    // the space between words, and none inside one (a new line starts fresh)
    const b = sbox(main.slice(i, i + k).map(t => t.s)), gap = b[0] - reach[i];
    let g = 0;
    if (i > 0 && main[i].li === main[i - 1].li) {
      if (spaceBefore[j] && gap < P.wordGap) g = 0.6 * (P.wordGap - gap);
      if (!spaceBefore[j] && gap > P.letterGap) g = 0.3 * (gap - P.letterGap);
    }
    return c + g;
  };
  // best[i][j]: strokes 0..i-1 written as characters 0..j-1
  const W = M + 1, best = new Float64Array((N + 1) * W).fill(Infinity), from = new Int32Array((N + 1) * W).fill(-1);
  best[0] = 0;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= M; j++) {
    const here = best[i * W + j];
    if (here === Infinity) continue;
    if (j < M && best[i * W + j + 1] > here + P.skip) { best[i * W + j + 1] = here + P.skip; from[i * W + j + 1] = 0; }          // a letter left out
    if (i < N && best[(i + 1) * W + j] > here + P.skip) { best[(i + 1) * W + j] = here + P.skip; from[(i + 1) * W + j] = 1; }      // a stray stroke
    if (j < M) for (let k = 1; k <= P.maxGroup && i + k <= N; k++) {
      if (k > 1 && main[i + k - 1].li !== main[i].li) break;
      const v = here + groupCost(i, k, j), at = (i + k) * W + j + 1;
      if (v < best[at]) { best[at] = v; from[at] = 1 + k; }
    }
  }
  const letters = chars.map((ch, j) => ({ ch, strokes: [], line: -1, cost: Infinity, ok: false, idx: [] }));
  for (let i = N, j = M; i > 0 || j > 0;) {
    const f = from[i * W + j];
    if (f === 0) j--;
    else if (f === 1) i--;
    else if (f >= 2) {
      const k = f - 1, L = letters[j - 1];
      L.idx = Array.from({ length: k }, (_, q) => i - k + q);
      L.cost = groupCost(i - k, k, j - 1);
      i -= k; j--;
    } else break;
  }
  // late strokes to the letter whose ink they sit over (or nearest across)
  for (const t of late) {
    let bestL = null, bd = Infinity;
    for (const L of letters) {
      if (!L.idx.length) continue;
      const b = sbox(L.idx.map(q => main[q].s));
      const d = Math.max(0, b[0] - t.b[2], t.b[0] - b[2]) + 0.3 * Math.max(0, b[1] - t.b[3], t.b[1] - b[3]);
      if (d < bd) { bd = d; bestL = L; }
    }
    if (bestL && bd < 0.25) bestL.late = (bestL.late || []).concat([t]);
  }
  let total = 0, n = 0;
  for (const L of letters) {
    if (!L.idx.length) { delete L.idx; continue; }
    const parts = L.idx.map(q => main[q]).concat(L.late || []);
    L.line = parts[0].li;
    L.strokes = parts.map(t => t.s.map(p => [p[0] - L.line * 1000, p[1]]));
    const g = cloud(L.strokes, P.n);
    if (tc[L.ch].length) L.cost = Math.min(...tc[L.ch].map(t => cloudDist(g, t.c) + 0.015 * Math.abs(L.strokes.length - t.k)));
    // learned only when close to its own drawings and clearly closer to them than to any other character's
    let rival = Infinity;
    if (tc[L.ch].length && L.cost < P.accept) for (const [ch, t] of others) if (ch !== L.ch) rival = Math.min(rival, cloudDist(g, t.c));
    L.ok = tc[L.ch].length > 0 && L.cost < P.accept && L.cost < 0.8 * rival;
    total += L.cost; n++;
    delete L.idx; delete L.late;
  }
  // a sentence that does not match its text as a whole (the wrong sentence, words left out) teaches nothing
  const cost = n ? total / n : Infinity;
  if (n < 0.75 * M || cost > 1.3 * P.accept) for (const L of letters) L.ok = false;
  return { letters, cost };
}
// The average drawing of one character from its samples (box space; the box drawing usually first): the samples
// with the usual number of strokes, each stroke matched to the most typical sample's (order and direction), resampled
// and averaged point by point, the outliers left out; null when fewer than two agree.
function averageGlyph(samples, o) {
  const P = Object.assign({ points: 40 }, o || {});
  const S = (samples || []).map(cleanStrokes).filter(st => st.length);
  if (S.length < 2) return null;
  const counts = new Map();
  for (const st of S) counts.set(st.length, (counts.get(st.length) || 0) + 1);
  let K = S[0].length, bestN = counts.get(K) || 0;
  for (const [k, c] of counts) if (c > bestN) { K = k; bestN = c; }
  let G = S.filter(st => st.length === K);
  if (G.length < 2) return null;
  const L = G.map(toLine), C = L.map(st => cloud(st, 32));
  const dsum = C.map(a => C.reduce((t, b) => t + cloudDist(a, b), 0));
  const ref = dsum.indexOf(Math.min(...dsum));
  const dref = C.map(c => cloudDist(c, C[ref])), med = dref.slice().sort((a, b) => a - b)[Math.floor(dref.length / 2)];
  const keep = L.map((st, i) => i).filter(i => dref[i] <= Math.max(2.2 * med, 0.05));
  if (keep.length < 2) return null;
  const R = L[ref].map(s => along(s, P.points));
  const acc = R.map(s => s.map(() => [0, 0]));
  const refC = sbox(L[ref]);
  for (const i of keep) {
    // centred across on the reference, kept at its height
    const b = sbox(L[i]), dx = (refC[0] + refC[2]) / 2 - (b[0] + b[2]) / 2;
    const strokes = L[i].map(s => along(s.map(p => [p[0] + dx, p[1]]), P.points));
    const used = new Set();
    R.forEach((rs, a) => {
      let bj = -1, bd = Infinity, brev = false;
      strokes.forEach((s, j) => {
        if (used.has(j)) return;
        for (const rev of [false, true]) {
          const q = rev ? s.slice().reverse() : s;
          let d = 0; for (let t = 0; t < q.length; t++) d += Math.hypot(q[t][0] - rs[t][0], q[t][1] - rs[t][1]);
          if (d < bd) { bd = d; bj = j; brev = rev; }
        }
      });
      used.add(bj);
      const q = brev ? strokes[bj].slice().reverse() : strokes[bj];
      q.forEach((p, t) => { acc[a][t][0] += p[0]; acc[a][t][1] += p[1]; });
    });
  }
  return toBox(acc.map(s => s.map(p => [p[0] / keep.length, p[1] / keep.length])));
}

const Replicator = { UPM, BOX, GUIDE, GUIDE_FRAC, SECTIONS, ALTS, DESCENDERS, FIT, LU, cleanStrokes, smooth, rasterize, trace, simplify, outline, toContour, writeTTF, warm, buildFont, tidyShift, fitToGuides, toLine, toBox, cloud, cloudDist, alignSentence, averageGlyph };
if (typeof module !== 'undefined' && module.exports) module.exports = Replicator;
if (typeof window !== 'undefined') window.Replicator = Replicator;
