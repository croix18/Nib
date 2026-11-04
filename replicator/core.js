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

// even out the pen's sampling, then soften the wobble (endpoints stay where they were)
function smooth(stroke, spacing, passes) {
  if (stroke.length < 3) return stroke.map(p => p.slice());
  const out = [stroke[0].slice()];
  let acc = 0;
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1], b = stroke[i];
    let d = Math.hypot(b[0] - a[0], b[1] - a[1]);
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
  let pts = out;
  for (let k = 0; k < passes; k++) {
    const nx = pts.map(p => p.slice());
    for (let i = 1; i + 1 < pts.length; i++) {
      nx[i][0] = 0.25 * pts[i - 1][0] + 0.5 * pts[i][0] + 0.25 * pts[i + 1][0];
      nx[i][1] = 0.25 * pts[i - 1][1] + 0.5 * pts[i][1] + 0.25 * pts[i + 1][1];
    }
    pts = nx;
  }
  return pts;
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

// ------------------------------------------------------------------ one glyph
// strokes: box-space strokes. Returns {contours: [[x, y]...] in font units (y up), bbox} or null when empty.
function outline(strokes, o) {
  const opts = Object.assign({ weight: 80, smoothing: 2 }, o || {});
  const unit = opts.unit || Math.max(3, opts.weight / 27);           // finer raster for thin pens
  const S = cleanStrokes(strokes).map(s => smooth(toUnits(s), 6, opts.smoothing));
  if (!S.length) return null;
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
const FONT_DEFAULTS = { name: 'My Handwriting', weight: 80, spacing: 50, smoothing: 2, tidy: true, cache: null };
// one glyph's outline, kept in opts.cache (a Map) while its strokes and the pen settings stay the same
function cachedOutline(ch, st, opts) {
  const key = JSON.stringify([st, opts.weight, opts.smoothing]);
  let ol = opts.cache && opts.cache.get(ch);
  if (!ol || ol.key !== key) { ol = { key, g: outline(st, opts) }; if (opts.cache) opts.cache.set(ch, ol); }
  return ol.g;
}
// Traces the outlines buildFont will need into opts.cache, one glyph per step, so a page can spread the work
// over many frames and stay responsive; buildFont afterwards only assembles the file.
function* warm(glyphs, o) {
  const opts = Object.assign({}, FONT_DEFAULTS, o || {});
  for (const sec of SECTIONS) for (const ch of sec.chars) {
    const st = cleanStrokes(glyphs && glyphs[ch]);
    if (!st.length) continue;
    const key = JSON.stringify([st, opts.weight, opts.smoothing]), ol = opts.cache && opts.cache.get(ch);
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
    const dy = tidyShift(ch, g.bbox, opts), dx = opts.spacing - g.bbox[0];
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

const Replicator = { UPM, BOX, GUIDE, GUIDE_FRAC, SECTIONS, ALTS, DESCENDERS, cleanStrokes, smooth, rasterize, trace, simplify, outline, toContour, writeTTF, warm, buildFont, tidyShift };
if (typeof module !== 'undefined' && module.exports) module.exports = Replicator;
if (typeof window !== 'undefined') window.Replicator = Replicator;
