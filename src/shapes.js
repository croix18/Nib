// ================================================================== shapes on the Board
// Lines, arrows, rectangles, ellipses, triangles, polygons, number lines and coordinate planes: what a drag with the
// shape tool makes, their outlines, bounds and hit tests, how they are drawn, and draw-and-hold recognition (a
// freehand stroke held still at its end that is clearly a shape becomes one). World units (CSS px at zoom 1), y down.
// Points per kind (docs: DESIGN.md "Elements"): line / arrow / arrow2 / numberline: start and end; rect / ellipse /
// plane: opposite corners, any order; triangle: drag start and end (apex at (mid x, start y), base along end y);
// rtriangle: the right angle at (start x, end y); poly: the vertices of a closed polygon. Arrowheads, dashes, ticks
// and labels are worked out at draw time from the points and E.size, so a moved or scaled shape draws right.
'use strict';

const SHAPE_KINDS = [
  { kind: 'line', label: 'Line' }, { kind: 'arrow', label: 'Arrow' }, { kind: 'arrow2', label: 'Double arrow' },
  { kind: 'rect', label: 'Rectangle' }, { kind: 'square', label: 'Square' }, { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'circle', label: 'Circle' }, { kind: 'triangle', label: 'Triangle' }, { kind: 'rtriangle', label: 'Right triangle' },
  { kind: 'numberline', label: 'Number line' }, { kind: 'plane', label: 'Coordinate plane' }];
const SHAPE_NL = { min: -10, max: 10, step: 1, labels: true, frac: false };
const SHAPE_PLANE = { xmin: -10, xmax: 10, ymin: -10, ymax: 10, step: 1, labels: true, grid: true };
// a drag shorter than SHAPE_TAP (world units at zoom 1) is a tap: it makes the kind's default size, centered on it
const SHAPE_TAP = 4;
const SHAPE_DEFAULT = { line: [200, 0], arrow: [200, 0], arrow2: [200, 0], rect: [200, 140], square: [160, 160],
  ellipse: [200, 140], circle: [160, 160], triangle: [180, 156], rtriangle: [180, 150], numberline: [480, 0], plane: [320, 320] };
const SHAPE_MINUS = '−';
const SHAPE_FONT = '"DM Sans", system-ui, sans-serif';
// arrowhead: wing half-width, and the notch in its back, as fractions of its length
const SHAPE_HEAD_W = 0.4, SHAPE_HEAD_NOTCH = 0.14;
// DM Sans 500 advances (em). Labels are measured without a canvas so layout, bounds and hits agree everywhere.
const SHAPE_ADV = { 0: 0.69, 1: 0.328, 2: 0.577, 3: 0.594, 4: 0.621, 5: 0.614, 6: 0.63, 7: 0.535, 8: 0.616, 9: 0.63,
  '−': 0.559, '.': 0.215, '/': 0.403, ' ': 0.256, x: 0.52, y: 0.571 };

// ------------------------------------------------------------------ small helpers
function shapeSize(E) { const s = E ? +E.size : 0; return s > 0 ? s : 3; }
function shapeLen(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
function shapeNum(x) { return (Math.round(x * 1e9) / 1e9) || 0; }   // tick values and snapped points without float noise
function shapeFilled(E) { return !!(E && E.fill && E.fill !== 'none' && E.fill !== 'transparent'); }
function shapeClamp(x, a, b) { return x < a ? a : x > b ? b : x; }
// a CSS color as [r, g, b, a] when it is #rgb, #rrggbb, rgb() or rgba(), else null
function shapeRGB(c) {
  if (typeof c !== 'string') return null;
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (m) { const h = m[1].length === 3 ? m[1].replace(/./g, d => d + d) : m[1], n = parseInt(h, 16); return [n >> 16, (n >> 8) & 255, n & 255, 1]; }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/i.exec(c.trim());
  if (!m) return null;
  const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
  return [+m[1], +m[2], +m[3], shapeClamp(a, 0, 1)];
}
// color b laid over color a at opacity t (b's own alpha included), as an opaque rgb()
function shapeOver(a, b, t) {
  const k = t * b[3];
  return [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * k).concat([1]);
}

// a point snapped to the grid of a spacing (0 = unchanged); extra fields (time, pressure) are kept
function shapeSnap(p, spacing) {
  const q = p.slice();
  if (spacing > 0) { q[0] = shapeNum(Math.round(p[0] / spacing) * spacing); q[1] = shapeNum(Math.round(p[1] / spacing) * spacing); }
  return q;
}

// ------------------------------------------------------------------ a drag with the shape tool
// A shape dragged out from a to b; o = { snap: grid spacing or 0, angle: snap a line's angle to 15° steps when within
// 4°, z: zoom (optional: scales the tap threshold and default sizes to the screen), opt: numberline / plane options
// over the defaults }. Returns { shape, pts, opt } (opt only for numberline and plane).
function shapeFromDrag(kind, a, b, o) {
  o = o || {};
  const g = o.snap > 0 ? +o.snap : 0, z = o.z > 0 ? +o.z : 1;
  const shape = kind === 'square' ? 'rect' : kind === 'circle' ? 'ellipse' : kind;
  const opt = shape === 'numberline' ? Object.assign({}, SHAPE_NL, o.opt) : shape === 'plane' ? Object.assign({}, SHAPE_PLANE, o.opt) : undefined;
  const flat = shape === 'line' || shape === 'arrow' || shape === 'arrow2' || shape === 'numberline';
  const equal = kind === 'square' || kind === 'circle' || shape === 'plane';
  const asp = shape === 'plane' ? shapeClamp(((+opt.xmax - +opt.xmin) / (+opt.ymax - +opt.ymin)) || 1, 0.1, 10) : 1;
  let A = [+a[0] || 0, +a[1] || 0], B = [+b[0] || 0, +b[1] || 0];
  const dx = B[0] - A[0], dy = B[1] - A[1], tap = SHAPE_TAP / z;
  if (shape === 'numberline' ? Math.abs(dx) < tap && Math.abs(dy) < tap : Math.hypot(dx, dy) < tap) {
    // a tap: the default size, centered under it (on the grid when snapping)
    const d = SHAPE_DEFAULT[kind] || SHAPE_DEFAULT.rect;
    let w = d[0] / z, h = flat ? 0 : d[1] / z;
    if (shape === 'plane') w = h * asp;
    if (g) { w = Math.max(g, Math.round(w / g) * g); if (!flat) h = Math.max(g, Math.round(h / g) * g); }
    const c = g ? shapeSnap(A, g) : A;
    A = [c[0] - w / 2, c[1] - h / 2];
    if (g) A = shapeSnap(A, g);
    if (flat) A[1] = c[1];
    return { shape, pts: [A, [shapeNum(A[0] + w), shapeNum(A[1] + h)]], opt };
  }
  if (g) A = shapeSnap(A, g);
  if (flat) {
    if (shape === 'numberline') {
      // always level, its end under the finger; a straight-down drag still gives one as long as the drag
      const ex = Math.abs(dx) >= tap ? B[0] : A[0] + (dx < 0 ? -1 : 1) * Math.hypot(dx, dy);
      B = [g ? shapeNum(Math.round(ex / g) * g) : ex, A[1]];
      if (B[0] === A[0]) B[0] = A[0] + (dx < 0 ? -1 : 1) * (g || tap);
      return { shape, pts: [A, B], opt };
    }
    const ex = B[0] - A[0], ey = B[1] - A[1], L = Math.hypot(ex, ey);
    let done = false;
    if (o.angle && L > 0) {
      const th = Math.atan2(ey, ex), q = Math.PI / 12, ts = Math.round(th / q) * q;
      if (Math.abs(th - ts) <= 4 * Math.PI / 180) {
        let ux = Math.cos(ts), uy = Math.sin(ts);
        if (Math.abs(ux) < 1e-12) ux = 0; if (Math.abs(uy) < 1e-12) uy = 0;
        let len = L;
        // on a grid, the end's main coordinate lands on a grid line (exactly on a grid point at 0°, 45°, 90°)
        if (g) { const m = Math.max(Math.abs(ux), Math.abs(uy)); len = Math.max(1, Math.round(L * m / g)) * g / m; }
        B = [shapeNum(A[0] + ux * len), shapeNum(A[1] + uy * len)];
        done = true;
      }
    }
    if (!done && g) {
      B = shapeSnap(B, g);
      if (B[0] === A[0] && B[1] === A[1]) { if (Math.abs(dx) >= Math.abs(dy)) B[0] += dx < 0 ? -g : g; else B[1] += dy < 0 ? -g : g; }
    }
    return { shape, pts: [A, B], opt };
  }
  if (equal) {
    // equal sides (or the ranges' aspect for a plane): the far corner goes the way of the drag, out to the finger
    let h = Math.max(Math.abs(dx) / asp, Math.abs(dy));
    if (g) h = Math.max(g, Math.round(h / g) * g);
    const w = h * asp;
    return { shape, pts: [A, [shapeNum(A[0] + (dx < 0 ? -w : w)), shapeNum(A[1] + (dy < 0 ? -h : h))]], opt };
  }
  if (g) {
    B = shapeSnap(B, g);
    if (B[0] === A[0]) B[0] += dx < 0 ? -g : g;
    if (B[1] === A[1]) B[1] += dy < 0 ? -g : g;
  }
  return { shape, pts: [A, B], opt };
}

// ------------------------------------------------------------------ geometry
// the corners of a closed polygonal shape in drawing order (null for the others)
function shapeVerts(E, pts) {
  const a = pts[0], b = pts[1] || pts[0];
  switch (E.shape) {
    case 'rect': case 'plane': {
      const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }
    case 'triangle': return [[(a[0] + b[0]) / 2, a[1]], [b[0], b[1]], [a[0], b[1]]];
    case 'rtriangle': return [[a[0], a[1]], [a[0], b[1]], [b[0], b[1]]];
    case 'poly': return pts.map(p => [p[0], p[1]]);
  }
  return null;
}
function shapeEllipseOf(pts) {
  const a = pts[0], b = pts[1] || pts[0];
  return { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, rx: Math.abs(b[0] - a[0]) / 2, ry: Math.abs(b[1] - a[1]) / 2 };
}
function shapeEllipsePts(el, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const t = i / n * 2 * Math.PI; out.push([el.cx + el.rx * Math.cos(t), el.cy + el.ry * Math.sin(t)]); }
  out.push(out[0].slice());
  return out;
}
function shapePerimeter(rx, ry) { // Ramanujan
  return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
}
// the filled head of an arrow with its tip at T, coming from F: [tip, wing, notch, wing], L its length
function shapeHead(T, F, size, len) {
  const d = shapeLen(F, T) || 1, ux = (T[0] - F[0]) / d, uy = (T[1] - F[1]) / d;
  // never longer than a third of the line, and never so short that it is no wider than the line
  const L = Math.min(Math.max(10, 4 * size), len / 3), W = Math.max(L * SHAPE_HEAD_W, 0.9 * size), bx = T[0] - ux * L, by = T[1] - uy * L;
  const nb = 1 - SHAPE_HEAD_NOTCH;
  return { L, ux, uy, poly: [[T[0], T[1]], [bx - uy * W, by + ux * W], [T[0] - ux * L * nb, T[1] - uy * L * nb], [bx + uy * W, by - ux * W]] };
}
function shapeInPoly(p, V) {
  let inside = false;
  for (let i = 0, j = V.length - 1; i < V.length; j = i++) {
    const a = V[i], b = V[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function shapeNearPath(p, P, r, closed) {
  if (P.length === 1) return shapeLen(P[0], p) <= r;
  for (let i = 0; i + 1 < P.length; i++) if (segDist(p, P[i], P[i + 1]) <= r) return true;
  return !!closed && P.length > 2 && segDist(p, P[P.length - 1], P[0]) <= r;
}
function shapeBoxPoly(b) { return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]; }

// ------------------------------------------------------------------ number labels
// the format of a set of tick values: fractions (denominator den) for steps under 1 when asked, else decimals (dp)
function shapeFmt(min, step, frac) {
  if (frac && step < 1) {
    for (let d = 2; d <= 64; d++) {
      if (Math.abs(step * d - Math.round(step * d)) < 1e-6 * d && Math.abs(min * d - Math.round(min * d)) < 1e-6 * d) return { den: d, dp: 0 };
    }
  }
  let dp = 0;
  for (const x of [step, min]) { let k = 0; while (k < 4 && Math.abs(x * 10 ** k - Math.round(x * 10 ** k)) > 1e-7 * 10 ** k) k++; dp = Math.max(dp, k); }
  return { den: 0, dp };
}
// a value's label: { s } (text, with a real minus sign) or a stacked fraction { neg, whole, num, den }
function shapeLabelOf(v, fmt) {
  if (Math.abs(v) < 1e-9) return { s: '0' };
  const neg = v < 0;
  if (fmt.den) {
    const N = Math.round(Math.abs(v) * fmt.den);
    if (!N) return { s: '0' };
    let g = N, h = fmt.den; while (h) { const t = g % h; g = h; h = t; }
    const num = N / g, den = fmt.den / g;
    if (den === 1) return { s: (neg ? SHAPE_MINUS : '') + num };
    const whole = Math.floor(num / den);
    return { neg, whole, num: num - whole * den, den };
  }
  let s = Math.abs(v).toFixed(fmt.dp);
  if (fmt.dp) s = s.replace(/\.?0+$/, '');
  return { s: (neg && +s !== 0 ? SHAPE_MINUS : '') + s };
}
function shapeTextW(s, fs) { let w = 0; for (const c of String(s)) w += SHAPE_ADV[c] || 0.62; return w * fs; }
// width of a label; fs the size of whole numbers, ff of a fraction's digits
function shapeLabelW(L, fs, ff) {
  if (L.s != null) return shapeTextW(L.s, fs);
  let w = Math.max(shapeTextW(L.num, ff), shapeTextW(L.den, ff)) + 0.3 * ff;
  if (L.whole) w += shapeTextW(L.whole, fs) + 0.08 * fs;
  if (L.neg) w += shapeTextW(SHAPE_MINUS, fs) + 0.06 * fs;
  return w;
}
// the number of steps between labels to try, smallest first: 1, then those that land on round values (1, 2, 5 x 10^n)
function shapeThinSteps(step, count) {
  const ks = [1];
  for (let e = -4; e <= 7; e++) for (const m of [1, 2, 5]) {
    const k = m * 10 ** e / step;
    if (k > 1.5 && Math.abs(k - Math.round(k)) < 1e-6 * k && k <= 2 * count + 2) ks.push(Math.round(k));
  }
  if (ks.length < 4) for (const k of [2, 3, 4, 5, 10, 20, 50, 100, 200, 500, 1000]) if (k <= 2 * count + 2) ks.push(k);
  return [...new Set(ks)].sort((x, y) => x - y);
}
// the ticks labeled when labeling every k steps: those on multiples of k steps (so 0 stays labeled), or every kth
function shapeEvery(items, k, step) {
  if (k === 1) return items;
  const q = k * step, on = items.filter(it => Math.abs(it.v / q - Math.round(it.v / q)) < 1e-6);
  return on.length ? on : items.filter((it, i) => i % k === 0);
}
function shapeFont(fs, o, italic) { return (italic ? 'italic ' : '') + '500 ' + fs.toFixed(2) + 'px ' + ((o && o.font) || SHAPE_FONT); }

// ------------------------------------------------------------------ number line layout
function shapeNlOpt(opt) {
  const o = Object.assign({}, SHAPE_NL, opt);
  let min = +o.min, max = +o.max, step = +o.step;
  if (!isFinite(min)) min = SHAPE_NL.min;
  if (!isFinite(max)) max = SHAPE_NL.max;
  if (max < min) { const t = min; min = max; max = t; }
  if (max === min) max = min + 1;
  if (!(step > 0) || !isFinite(step)) step = 1;
  while ((max - min) / step > 400) step *= 2;
  return { min, max, step, labels: o.labels !== false, frac: !!o.frac };
}
// everything a number line draws, in world units: shared by drawing, bounds and hit tests
function shapeNlLayout(E, pts, z) {
  const opt = shapeNlOpt(E.opt), size = shapeSize(E);
  let A = pts[0], B = pts[1] || pts[0];
  if (B[0] < A[0] || (B[0] === A[0] && B[1] < A[1])) { const t = A; A = B; B = t; }
  const len = shapeLen(A, B), ux = len > 1e-9 ? (B[0] - A[0]) / len : 1, uy = len > 1e-9 ? (B[1] - A[1]) / len : 0;
  const nx = -uy, ny = ux;                                        // the side the labels go: below a left-to-right line
  const hA = shapeHead(A, B, size, len), hB = shapeHead(B, A, size, len), head = hA.L;
  const inset = Math.min(1.6 * head + size, 0.45 * len), span = opt.max - opt.min;
  const per = Math.max(len - 2 * inset, 0) / span, gap = opt.step * per;
  const cnt = Math.floor(span / opt.step + 1e-6), majors = opt.step < 1 - 1e-9;
  const ticks = [];
  for (let i = 0; i <= cnt; i++) {
    const v = shapeNum(opt.min + i * opt.step);
    ticks.push({ v, t: inset + (v - opt.min) * per, major: majors && Math.abs(v - Math.round(v)) < 1e-9 });
  }
  // labels sized from the tick spacing: never under 12 screen px, never oversized on a sparse line
  const lo = Math.max(12 / z, 8 + size), fs = shapeClamp(0.44 * gap, lo, Math.max(lo, 16 + 1.4 * size));
  const fmt = shapeFmt(opt.min, opt.step, opt.frac), ff = fmt.den ? Math.max(0.78 * fs, 12 / z) : fs;
  const th = Math.max(1.6 * size + 3, 0.36 * fs), thM = majors ? 1.4 * th : th;
  const out = { A, B, len, ux, uy, nx, ny, heads: [hA, hB], ticks, th, thM, tw: Math.max(0.8 * size, 1), fs, ff, fmt, labels: [] };
  if (!opt.labels || len < 1e-6) return out;
  const hh = fmt.den ? 0.92 * ff : 0.35 * fs;                      // labels' half height about their center line
  const off = thM + 0.38 * fs + size / 2 + hh;                    // the center line, below the line
  const items = ticks.map(tk => { const L = shapeLabelOf(tk.v, fmt); return { v: tk.v, t: tk.t, L, w: shapeLabelW(L, fs, ff) }; });
  const room = 0.4 * fs;                                          // clear space between neighboring labels
  for (const k of shapeThinSteps(opt.step, items.length)) {
    const sel = shapeEvery(items, k, opt.step);
    let fits = true;
    for (let i = 0; i + 1 < sel.length && fits; i++) if (sel[i + 1].t - sel[i].t < (sel[i].w + sel[i + 1].w) / 2 + room) fits = false;
    if (fits) {
      out.labels = sel.map(it => ({ L: it.L, w: it.w, hh, x: A[0] + ux * it.t + nx * off, y: A[1] + uy * it.t + ny * off }));
      break;
    }
  }
  return out;
}

// ------------------------------------------------------------------ coordinate plane layout
function shapePlaneOpt(opt) {
  const o = Object.assign({}, SHAPE_PLANE, opt), r = {};
  for (const k of ['xmin', 'xmax', 'ymin', 'ymax']) r[k] = isFinite(+o[k]) ? +o[k] : SHAPE_PLANE[k];
  for (const [a, b] of [['xmin', 'xmax'], ['ymin', 'ymax']]) {
    if (r[b] < r[a]) { const t = r[a]; r[a] = r[b]; r[b] = t; }
    if (r[b] === r[a]) r[b] = r[a] + 1;
  }
  let step = +o.step;
  if (!(step > 0) || !isFinite(step)) step = 1;
  while (Math.max(r.xmax - r.xmin, r.ymax - r.ymin) / step > 200) step *= 2;
  return Object.assign(r, { step, labels: o.labels !== false, grid: o.grid !== false, frac: !!o.frac, names: o.names !== false });
}
function shapeRectsMeet(a, b, m) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + m && Math.abs(a.y - b.y) < a.hh + b.hh + m;
}
function shapePlaneLayout(E, pts, z) {
  const opt = shapePlaneOpt(E.opt), size = shapeSize(E);
  const a = pts[0], b = pts[1] || pts[0];
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const W = x1 - x0, H = y1 - y0, sx = W / (opt.xmax - opt.xmin), sy = H / (opt.ymax - opt.ymin);
  const X = v => x0 + (v - opt.xmin) * sx, Y = v => y1 - (v - opt.ymin) * sy;
  const vals = (lo, hi) => {
    const r = [], j0 = Math.ceil(lo / opt.step - 1e-7), j1 = Math.floor(hi / opt.step + 1e-7);
    for (let j = j0; j <= j1; j++) r.push(shapeNum(j * opt.step));
    return r;
  };
  const xs = vals(opt.xmin, opt.xmax), ys = vals(opt.ymin, opt.ymax);
  const ax = shapeClamp(0, opt.xmin, opt.xmax), ay = shapeClamp(0, opt.ymin, opt.ymax), AX = X(ax), AY = Y(ay);
  const gw = Math.max(Math.min(0.42 * size, 1.6), 0.5 / z), cell = Math.min(opt.step * sx, opt.step * sy);
  // the axes run on past the grid at their arrow ends (both ends when the range is on both sides of 0)
  const L = Math.min(Math.max(10, 4 * size), Math.max(W, H) / 3), oh = 1.15 * L + gw;
  const xa = [[opt.xmin < 0 ? x0 - oh : x0, AY], [x1 + oh, AY]], ya = [[AX, opt.ymin < 0 ? y1 + oh : y1], [AX, y0 - oh]];
  const head = (T, F, axis) => Object.assign(shapeHead(T, F, size, 3 * L), { axis });
  const heads = [head(xa[1], xa[0], 'x'), head(ya[1], ya[0], 'y')];
  if (opt.xmin < 0) heads.push(head(xa[0], xa[1], 'x'));
  if (opt.ymin < 0) heads.push(head(ya[0], ya[1], 'y'));
  const tick = opt.grid ? 0 : Math.max(3, 1.6 * size);
  const out = { x0, y0, x1, y1, X, Y, xs, ys, ax, ay, AX, AY, xa, ya, heads, gw, aw: size, tick, opt, labels: [], names: [], fs: 0 };
  if (!opt.labels || W < 1 || H < 1) return out;
  const lo = Math.max(12 / z, 8 + size), fs = shapeClamp(0.42 * cell, lo, Math.max(lo, 14 + 1.4 * size));
  const fmt = shapeFmt(Math.min(opt.xmin, opt.ymin), opt.step, opt.frac), ff = fmt.den ? Math.max(0.78 * fs, 12 / z) : fs;
  const hh = fmt.den ? 0.92 * ff : 0.35 * fs, gap = 0.32 * fs + size / 2 + tick;
  const origin = ax === 0 && ay === 0;
  const lab = (v, x, y, right) => { const Lb = shapeLabelOf(v, fmt), w = shapeLabelW(Lb, fs, ff); return { L: Lb, w, hh, x: right ? x - w / 2 : x, y }; };
  const xi = xs.filter(v => !(origin && v === 0)).map(v => Object.assign(lab(v, X(v), AY + gap + hh), { v }));
  const yi = ys.filter(v => v !== ay).map(v => Object.assign(lab(v, AX - gap, Y(v), true), { v }));
  const o0 = origin ? [lab(0, AX - 0.75 * gap, AY + 0.75 * gap + hh, true)] : [];
  // clear space between neighboring labels, and more round the origin's 0 (so "-1 0" never reads as -10)
  const m = 0.4 * fs, m0 = 0.6 * fs;
  for (const k of shapeThinSteps(opt.step, Math.max(xs.length, ys.length))) {
    const sx_ = shapeEvery(xi, k, opt.step), sy_ = shapeEvery(yi, k, opt.step);
    let ok = true;
    for (let i = 0; i + 1 < sx_.length && ok; i++) if (shapeRectsMeet(sx_[i], sx_[i + 1], m)) ok = false;
    for (let i = 0; i + 1 < sy_.length && ok; i++) if (shapeRectsMeet(sy_[i], sy_[i + 1], m)) ok = false;
    for (const p of sx_) { if (!ok) break; for (const q of sy_) if (shapeRectsMeet(p, q, m)) { ok = false; break; } }
    for (const p of o0) for (const q of sx_.concat(sy_)) if (ok && shapeRectsMeet(p, q, m0)) ok = false;
    if (ok) { out.labels = sx_.concat(sy_, o0); break; }
  }
  if (opt.names) {
    const fn = Math.max(1.05 * fs, 12 / z);
    // italic (slanted by the browser when the font has no italic): a little wider than upright
    const wx = shapeTextW('x', fn) + 0.25 * fn, wy = shapeTextW('y', fn) + 0.25 * fn;
    out.names = [{ s: 'x', fs: fn, w: wx, hh: 0.26 * fn, x: xa[1][0] + 0.3 * fn + wx / 2, y: AY },
      { s: 'y', fs: fn, w: wy, hh: 0.37 * fn, x: AX, y: ya[1][1] - 0.58 * fn }];
  }
  out.fs = fs; out.ff = ff; out.fmt = fmt;
  return out;
}

// ------------------------------------------------------------------ outline, bounds, hit
// polylines that make up the shape's outline, for hit tests and the selection's lasso (closed ones end where they start)
function shapeOutline(E, pts) {
  if (!E || !pts || !pts.length) return [];
  const k = E.shape;
  if (k === 'line' || k === 'arrow' || k === 'arrow2') {
    const A = pts[0], B = pts[1] || pts[0], len = shapeLen(A, B), out = [[[A[0], A[1]], [B[0], B[1]]]];
    if (len > 1e-6 && k !== 'line') out.push(shapeHead(B, A, shapeSize(E), len).poly.concat([[B[0], B[1]]]));
    if (len > 1e-6 && k === 'arrow2') out.push(shapeHead(A, B, shapeSize(E), len).poly.concat([[A[0], A[1]]]));
    return out;
  }
  if (k === 'ellipse') return [shapeEllipsePts(shapeEllipseOf(pts), 48)];
  // a number line: its line, and the box of everything it draws (ticks, labels); a plane: its grid, and that box
  if (k === 'numberline') {
    const Ly = shapeNlLayout(E, pts, 1);
    return [[[Ly.A[0], Ly.A[1]], [Ly.B[0], Ly.B[1]]], shapeBoxPoly(shapeBounds(E, pts))];
  }
  if (k === 'plane') return [shapeBoxPoly(sbox([pts[0], pts[1] || pts[0]])), shapeBoxPoly(shapeBounds(E, pts))];
  const V = shapeVerts(E, pts);
  if (!V) return [];
  return [V.length > 2 ? V.concat([V[0].slice()]) : V];
}

// [x0, y0, x1, y1] of everything drawn: stroke width, arrowheads, ticks and labels (labels at zoom o.z, default 1)
function shapeBounds(E, pts, o) {
  if (!E || !pts || !pts.length) return [0, 0, 0, 0];
  const z = o && o.z > 0 ? o.z : 1, size = shapeSize(E), hw = Math.max(size, 0.6 / z) / 2, k = E.shape;
  const grow = (b, m) => [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
  if (k === 'line' || k === 'arrow' || k === 'arrow2') {
    const A = pts[0], B = pts[1] || pts[0], len = shapeLen(A, B);
    let bx = grow(sbox([A, B]), hw);
    if (len > 1e-6 && k !== 'line') bx = ubox(bx, sbox(shapeHead(B, A, size, len).poly));
    if (len > 1e-6 && k === 'arrow2') bx = ubox(bx, sbox(shapeHead(A, B, size, len).poly));
    return bx;
  }
  if (k === 'numberline') {
    const Ly = shapeNlLayout(E, pts, z);
    let bx = grow(sbox([Ly.A, Ly.B]), hw);
    for (const h of Ly.heads) bx = ubox(bx, sbox(h.poly));
    const tx = Ly.nx * Ly.thM, ty = Ly.ny * Ly.thM, hw2 = Ly.tw / 2;
    for (const tk of [Ly.ticks[0], Ly.ticks[Ly.ticks.length - 1]]) {
      if (!tk) continue;
      const px = Ly.A[0] + Ly.ux * tk.t, py = Ly.A[1] + Ly.uy * tk.t;
      bx = ubox(bx, grow(sbox([[px - tx, py - ty], [px + tx, py + ty]]), hw2));
    }
    for (const it of Ly.labels) bx = ubox(bx, [it.x - it.w / 2, it.y - it.hh, it.x + it.w / 2, it.y + it.hh]);
    return bx;
  }
  if (k === 'plane') {
    const Ly = shapePlaneLayout(E, pts, z);
    let bx = grow([Ly.x0, Ly.y0, Ly.x1, Ly.y1], Ly.gw);
    bx = ubox(bx, grow(sbox(Ly.xa.concat(Ly.ya)), Ly.aw / 2));
    for (const h of Ly.heads) bx = ubox(bx, sbox(h.poly));
    for (const it of Ly.labels.concat(Ly.names)) bx = ubox(bx, [it.x - it.w / 2, it.y - it.hh, it.x + it.w / 2, it.y + it.hh]);
    return bx;
  }
  if (k === 'ellipse') return grow(sbox([pts[0], pts[1] || pts[0]]), hw);
  const V = shapeVerts(E, pts);
  return V && V.length ? grow(sbox(V), hw) : [0, 0, 0, 0];
}

// is world point p within r of the shape? (its outline widened by half its width; anywhere inside when it is filled;
// a number line or plane anywhere in its box). o.z as for shapeBounds.
function shapeHit(E, pts, p, r, o) {
  if (!E || !pts || !pts.length || !p) return false;
  r = r > 0 ? r : 0;
  const k = E.shape, size = shapeSize(E), rr = r + size / 2;
  if (k === 'numberline' || k === 'plane') {
    const b = shapeBounds(E, pts, o);
    return p[0] >= b[0] - r && p[0] <= b[2] + r && p[1] >= b[1] - r && p[1] <= b[3] + r;
  }
  if (k === 'line' || k === 'arrow' || k === 'arrow2') {
    const A = pts[0], B = pts[1] || pts[0], len = shapeLen(A, B);
    if (segDist(p, A, B) <= rr) return true;
    if (len < 1e-6 || k === 'line') return false;
    const heads = k === 'arrow2' ? [shapeHead(B, A, size, len), shapeHead(A, B, size, len)] : [shapeHead(B, A, size, len)];
    return heads.some(h => shapeInPoly(p, h.poly) || shapeNearPath(p, h.poly, r, true));
  }
  if (k === 'ellipse') {
    const el = shapeEllipseOf(pts);
    if (shapeFilled(E) && el.rx > 0 && el.ry > 0 && ((p[0] - el.cx) / el.rx) ** 2 + ((p[1] - el.cy) / el.ry) ** 2 <= 1) return true;
    const n = Math.round(shapeClamp(shapePerimeter(el.rx, el.ry) / 6, 48, 480));
    return shapeNearPath(p, shapeEllipsePts(el, n), rr, false);
  }
  const V = shapeVerts(E, pts);
  if (!V || !V.length) return false;
  if (V.length > 2 && shapeFilled(E) && shapeInPoly(p, V)) return true;
  return shapeNearPath(p, V, rr, V.length > 2);
}

// ------------------------------------------------------------------ drawing
// visible dash and gap lengths for a line of width w: 3 and 2.5 widths, a little longer for thin lines
function shapeDashLen(w) { const u = Math.max(w, 2.6); return [3 * u, 2.5 * u]; }
// a dashed segment with a whole dash at each end (round caps included), the pattern stretched to fit
function shapeDashSeg(ctx, P, Q, w) {
  const len = shapeLen(P, Q), [D, G] = shapeDashLen(w);
  ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(Q[0], Q[1]);
  if (len + w >= 0.65 * (2 * D + G)) {                              // room for two dashes, if a little short
    const n = Math.max(1, Math.round((len + w - D) / (D + G))), k = (len + w) / ((n + 1) * D + n * G);
    ctx.setLineDash([Math.max(k * D - w, 0.01), k * G + w]); ctx.lineDashOffset = 0;
  }
  ctx.stroke(); ctx.setLineDash([]);
}
// a dashed polygon: every side ends in half a dash, so each corner gets one dash bent round it
function shapeDashPoly(ctx, V, closed, w) {
  const [D, G] = shapeDashLen(w), n = V.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const P = V[i], Q = V[(i + 1) % n], len = shapeLen(P, Q);
    if (!closed) { shapeDashSeg(ctx, P, Q, w); continue; }
    ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(Q[0], Q[1]);
    if (len >= 0.8 * (D + G)) {
      const m = Math.max(1, Math.round(len / (D + G))), k = len / (m * (D + G)), d = Math.max(k * D - w, 0.01);
      ctx.setLineDash([d, k * G + w]); ctx.lineDashOffset = d / 2;
    } else ctx.setLineDash([]);
    ctx.stroke();
  }
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
}
function shapePath(ctx, V, closed) {
  ctx.moveTo(V[0][0], V[0][1]);
  for (let i = 1; i < V.length; i++) ctx.lineTo(V[i][0], V[i][1]);
  if (closed) ctx.closePath();
}
function shapeFillHeads(ctx, heads) {
  ctx.beginPath();
  for (const h of heads) shapePath(ctx, h.poly, true);
  ctx.fill();
}

function shapeDrawLine(ctx, E, pts, w, size) {
  const A = pts[0], B = pts[1] || pts[0], len = shapeLen(A, B);
  if (len < 1e-6) { ctx.beginPath(); ctx.arc(A[0], A[1], w / 2, 0, 2 * Math.PI); ctx.fill(); return; }
  const ux = (B[0] - A[0]) / len, uy = (B[1] - A[1]) / len, at = t => [A[0] + ux * t, A[1] + uy * t];
  const hb = E.shape !== 'line' ? shapeHead(B, A, size, len) : null, ha = E.shape === 'arrow2' ? shapeHead(A, B, size, len) : null;
  // the shaft runs into each head, its end hidden under it; dashes are fitted to the part that shows
  const in0 = ha ? 0.55 * ha.L : 0, in1 = hb ? len - 0.55 * hb.L : len;
  if (E.dash) {
    const s0 = ha ? ha.L : 0, s1 = hb ? len - hb.L : len;
    shapeDashSeg(ctx, at(s0), at(s1), w);
    if (ha || hb) {
      ctx.beginPath();
      if (ha) { ctx.moveTo(...at(in0)); ctx.lineTo(...at(s0 + w / 2)); }
      if (hb) { ctx.moveTo(...at(s1 - w / 2)); ctx.lineTo(...at(in1)); }
      ctx.stroke();
    }
  } else { ctx.beginPath(); ctx.moveTo(...at(in0)); ctx.lineTo(...at(in1)); ctx.stroke(); }
  const heads = [ha, hb].filter(Boolean);
  if (heads.length) shapeFillHeads(ctx, heads);
}
function shapeDrawEllipse(ctx, E, pts, w) {
  const el = shapeEllipseOf(pts);
  ctx.beginPath(); ctx.ellipse(el.cx, el.cy, el.rx, el.ry, 0, 0, 2 * Math.PI);
  if (shapeFilled(E)) { const f = ctx.fillStyle; ctx.fillStyle = E.fill; ctx.fill(); ctx.fillStyle = f; }
  if (E.dash) {
    const per = shapePerimeter(el.rx, el.ry), [D, G] = shapeDashLen(w);
    if (per > 2.5 * (D + G)) {
      const n = Math.max(4, 2 * Math.round(per / (2 * (D + G)))), k = per / (n * (D + G)), d = Math.max(k * D - w, 0.01);
      ctx.setLineDash([d, k * G + w]); ctx.lineDashOffset = d / 2;
    }
  }
  ctx.stroke();
}
function shapeDrawPoly(ctx, E, pts, w) {
  const V = shapeVerts(E, pts);
  if (!V || !V.length) return;
  if (V.length === 1) { ctx.beginPath(); ctx.arc(V[0][0], V[0][1], w / 2, 0, 2 * Math.PI); ctx.fill(); return; }
  const closed = V.length > 2;
  if (closed && shapeFilled(E)) { const f = ctx.fillStyle; ctx.beginPath(); shapePath(ctx, V, true); ctx.fillStyle = E.fill; ctx.fill(); ctx.fillStyle = f; }
  if (E.dash) shapeDashPoly(ctx, V, closed, w);
  else { ctx.beginPath(); shapePath(ctx, V, closed); ctx.stroke(); }
}

// Labels as the pieces they draw: text runs { s, x, y (baseline), size, align }, largest first so the font changes
// least, and fraction bars [x, y, w, h]. Whole numbers at fs; a fraction's digits at ff, stacked over a bar on the
// labels' center line, with a mixed number's whole part and a minus sign beside it at fs.
function shapeLabelParts(items, fs, ff, z) {
  const bar = Math.max(0.075 * ff, 0.6 / z), text = [], bars = [];
  for (const it of items) {
    const L = it.L;
    if (L.s != null) { text.push({ s: L.s, x: it.x, y: it.y + 0.35 * fs, size: fs, align: 'center' }); continue; }
    let x = it.x - it.w / 2;
    if (L.neg) { text.push({ s: SHAPE_MINUS, x, y: it.y + 0.295 * fs, size: fs, align: 'left' }); x += shapeTextW(SHAPE_MINUS, fs) + 0.06 * fs; }
    if (L.whole) { text.push({ s: String(L.whole), x, y: it.y + 0.35 * fs, size: fs, align: 'left' }); x += shapeTextW(L.whole, fs) + 0.08 * fs; }
    const fw = it.x + it.w / 2 - x;
    bars.push([x, it.y - bar / 2, fw, bar]);
    text.push({ s: String(L.num), x: x + fw / 2, y: it.y - 0.2 * ff, size: ff, align: 'center' }, { s: String(L.den), x: x + fw / 2, y: it.y + 0.9 * ff, size: ff, align: 'center' });
  }
  text.sort((a, b) => b.size - a.size);
  return { text, bars };
}
// draw label pieces filled, or as a halo (stroked halo wide, in the current stroke / fill style)
function shapeDrawParts(ctx, P, o, halo) {
  let size = -1;
  ctx.textBaseline = 'alphabetic';
  for (const t of P.text) {
    if (t.size !== size) { size = t.size; ctx.font = shapeFont(size, o); }
    ctx.textAlign = t.align;
    if (halo) ctx.strokeText(t.s, t.x, t.y); else ctx.fillText(t.s, t.x, t.y);
  }
  for (const b of P.bars) ctx.fillRect(b[0] - halo / 2, b[1] - halo / 2, b[2] + halo, b[3] + halo);
}
// Lines that are level or upright put on whole device pixels, so thin ones stay crisp on a 4K panel: { w(width),
// x(x, width), y(y, width) } in world units, or null when the context's transform is not a plain scale and shift.
function shapeSnapper(ctx) {
  if (typeof ctx.getTransform !== 'function') return null;
  const t = ctx.getTransform(), k = t.a;
  if (!(k > 0) || Math.abs(t.b) > 1e-9 || Math.abs(t.c) > 1e-9 || Math.abs(t.d - k) > 1e-9 * k) return null;
  const px = w => Math.max(1, Math.round(w * k)), at = (v, w, off) => { const W = px(w), d = v * k + off; return ((W % 2 ? Math.floor(d) + 0.5 : Math.round(d)) - off) / k; };
  return { w: w => px(w) / k, x: (x, w) => at(x, w, t.e), y: (y, w) => at(y, w, t.f) };
}
const shapeNoSnap = { w: w => w, x: x => x, y: y => y };
function shapeDrawNl(ctx, E, pts, o, z, w) {
  const Ly = shapeNlLayout(E, pts, z), { A, ux, uy, nx, ny, len } = Ly;
  if (len < 1e-6) { ctx.beginPath(); ctx.arc(A[0], A[1], w / 2, 0, 2 * Math.PI); ctx.fill(); return; }
  // a level line (the usual case) on whole pixels: its line, ticks and heads moved together
  const sn = uy === 0 ? shapeSnapper(ctx) || shapeNoSnap : shapeNoSnap, tw = Math.max(Ly.tw, 0.6 / z);
  const dy = sn.y(A[1], w) - A[1], at = t => [A[0] + ux * t, A[1] + dy + uy * t];
  ctx.beginPath(); ctx.moveTo(...at(0.55 * Ly.heads[0].L)); ctx.lineTo(...at(len - 0.55 * Ly.heads[1].L));
  ctx.lineWidth = sn.w(w); ctx.stroke();
  shapeFillHeads(ctx, Ly.heads.map(h => ({ poly: h.poly.map(p => [p[0], p[1] + dy]) })));
  ctx.beginPath();
  for (const tk of Ly.ticks) {
    const P = at(tk.t), h = tk.major ? Ly.thM : Ly.th, x = uy === 0 ? sn.x(P[0], tw) : P[0];
    ctx.moveTo(x - nx * h, P[1] - ny * h); ctx.lineTo(x + nx * h, P[1] + ny * h);
  }
  ctx.lineWidth = sn.w(tw); ctx.stroke();
  if (Ly.labels.length) shapeDrawParts(ctx, shapeLabelParts(Ly.labels, Ly.fs, Ly.ff, z), o, 0);
}
function shapeDrawPlane(ctx, E, pts, o, z, col) {
  const Ly = shapePlaneLayout(E, pts, z), { x0, y0, x1, y1, X, Y, opt } = Ly, ga = ctx.globalAlpha;
  const fill = shapeFilled(E) ? E.fill : null, sn = shapeSnapper(ctx) || shapeNoSnap;
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.fillStyle = col; }
  if (opt.grid && x1 - x0 > 0 && y1 - y0 > 0) {
    // the grid: the ink at 30 % over the paper, on whole pixels, the axes' own lines left to them
    const gw = Ly.gw, vx = Ly.xs.filter(v => v !== Ly.ax).map(X), vy = Ly.ys.filter(v => v !== Ly.ay).map(Y);
    if (Math.abs(X(Ly.xs[0]) - x0) > 1e-6 && Ly.AX !== x0) vx.push(x0);
    if (Math.abs(X(Ly.xs[Ly.xs.length - 1]) - x1) > 1e-6 && Ly.AX !== x1) vx.push(x1);
    if (Math.abs(Y(Ly.ys[0]) - y1) > 1e-6 && Ly.AY !== y1) vy.push(y1);
    if (Math.abs(Y(Ly.ys[Ly.ys.length - 1]) - y0) > 1e-6 && Ly.AY !== y0) vy.push(y0);
    const t = sn.y(y0, gw), b = sn.y(y1, gw), l = sn.x(x0, gw), r = sn.x(x1, gw), w = sn.w(gw);
    const pc = shapeRGB(o.paper), ic = shapeRGB(col), fc = fill ? shapeRGB(fill) : null;
    if (pc && ic && ic[3] === 1 && (!fill || fc) && ga === 1) {
      // known colors: opaque rectangles in the mixed color (crossings stay one color; far cheaper to draw than
      // wide strokes, which matters for big planes on a 4K panel)
      const g = shapeOver(fc ? shapeOver(pc, fc, 1) : pc, ic, 0.3);
      ctx.fillStyle = 'rgb(' + g.slice(0, 3).map(Math.round).join(',') + ')';
      for (const x of vx) ctx.fillRect(sn.x(x, gw) - w / 2, t - w / 2, w, b - t + w);
      for (const y of vy) ctx.fillRect(l - w / 2, sn.y(y, gw) - w / 2, r - l + w, w);
      ctx.fillStyle = col;
    } else {
      // otherwise one stroke, see-through (one path, so crossings are no darker than the lines)
      ctx.beginPath();
      for (const x of vx) { const xs = sn.x(x, gw); ctx.moveTo(xs, t); ctx.lineTo(xs, b); }
      for (const y of vy) { const ys = sn.y(y, gw); ctx.moveTo(l, ys); ctx.lineTo(r, ys); }
      ctx.lineWidth = w; ctx.lineCap = 'square'; ctx.globalAlpha = ga * 0.3; ctx.stroke();
      ctx.globalAlpha = ga; ctx.lineCap = 'round';
    }
  }
  const parts = Ly.labels.length ? shapeLabelParts(Ly.labels, Ly.fs, Ly.ff, z) : null;
  if (parts && opt.grid && o.paper) {
    // halos round the labels in the paper's color (and the plane's fill over it), so grid lines stop short of
    // the digits; kept to the grid, and drawn before the axes so they never bite an axis or an arrowhead
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    ctx.lineJoin = 'round'; ctx.lineWidth = 0.32 * Ly.fs;
    for (const f of [o.paper, fill]) if (f) { ctx.strokeStyle = f; ctx.fillStyle = f; shapeDrawParts(ctx, parts, o, 0.32 * Ly.fs); }
    ctx.restore();
  }
  // the axes, heavier, on whole pixels, with their arrowheads (the line ends hidden under the heads)
  const aw = Math.max(Ly.aw, 0.6 / z), AX = sn.x(Ly.AX, aw), AY = sn.y(Ly.AY, aw), L = Ly.heads[0].L;
  ctx.beginPath();
  for (const [P, Q, hp] of [[[Ly.xa[0][0], AY], [Ly.xa[1][0], AY], opt.xmin < 0], [[AX, Ly.ya[0][1]], [AX, Ly.ya[1][1]], opt.ymin < 0]]) {
    const d = shapeLen(P, Q) || 1, ux = (Q[0] - P[0]) / d, uy = (Q[1] - P[1]) / d, s = hp ? 0.55 * L : 0, e = d - 0.55 * L;
    ctx.moveTo(P[0] + ux * s, P[1] + uy * s); ctx.lineTo(P[0] + ux * e, P[1] + uy * e);
  }
  ctx.lineWidth = sn.w(aw); ctx.stroke();
  if (Ly.tick) {
    const tw = Math.max(0.8 * Ly.aw, 0.6 / z);
    ctx.beginPath();
    for (const v of Ly.xs) if (v !== Ly.ax) { const x = sn.x(X(v), tw); ctx.moveTo(x, AY - Ly.tick); ctx.lineTo(x, AY + Ly.tick); }
    for (const v of Ly.ys) if (v !== Ly.ay) { const y = sn.y(Y(v), tw); ctx.moveTo(AX - Ly.tick, y); ctx.lineTo(AX + Ly.tick, y); }
    ctx.lineWidth = sn.w(tw); ctx.stroke();
  }
  shapeFillHeads(ctx, Ly.heads.map(h => ({ poly: h.poly.map(p => h.axis === 'x' ? [p[0], p[1] + AY - Ly.AY] : [p[0] + AX - Ly.AX, p[1]]) })));
  if (parts) { ctx.fillStyle = col; shapeDrawParts(ctx, parts, o, 0); }
  for (const it of Ly.names) {
    ctx.font = shapeFont(it.fs, o, true); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(it.s, it.x, it.y + (it.s === 'x' ? 0.25 : 0.12) * it.fs);
  }
}

// draw it; ctx has the world transform; o = { ink: color when E.color is null, paper: the paper color, z: zoom,
// font: the labels' font family list }
function shapeDraw(ctx, E, pts, o) {
  if (!ctx || !E || !pts || !pts.length) return;
  o = o || {};
  const z = o.z > 0 ? o.z : 1, size = shapeSize(E), col = E.color || o.ink || '#1b2a4a', w = Math.max(size, 0.6 / z);
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = w; ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  const k = E.shape;
  if (k === 'line' || k === 'arrow' || k === 'arrow2') shapeDrawLine(ctx, E, pts, w, size);
  else if (k === 'ellipse') shapeDrawEllipse(ctx, E, pts, w);
  else if (k === 'numberline') shapeDrawNl(ctx, E, pts, o, z, w);
  else if (k === 'plane') shapeDrawPlane(ctx, E, pts, o, z, col);
  else shapeDrawPoly(ctx, E, pts, w);
  ctx.restore();
}

// ------------------------------------------------------------------ draw-and-hold recognition
// Thresholds, relative to the stroke's size unless noted. Tuned on synthetic hand-drawn shapes against single-stroke
// symbols from real handwriting (test/shapes_check.js): be conservative, a wrong "yes" turns a symbol into a shape.
const SHAPE_REC = {
  n: 96,            // the stroke resampled to this many points
  minSize: 16,      // screen pixels: nothing smaller is drawn as a shape on purpose (dots, commas, primes)
  lineDev: 0.035,   // a line: no point further than this from the fitted line (of its length)
  lineRms: 0.013,
  lineBack: 0.02,   // ... and never doubling back by more than this
  hookIn: 5,        // resampled points that may be dropped where the pen landed (a hook) ...
  hookOut: 3,       // ... and where it stopped
  gap: 0.22,        // a closed shape: start and end within this (of the size) ...
  lead: 0.1,        // ... with at most this much of a run-in before the loop and ...
  tail: 0.35,       // ... this much of an overshoot after it (of the loop's length), staying on the loop ...
  stray: 0.07,
  past: 0.12,       // ... beyond the first bit past the closing point
  turnNet: 0.15,    // one turn: net turning within this of 360° (as a fraction of a turn) ...
  turnAbs: 1.6,     // ... no more than this many turns' worth of turning in all ...
  sharp: 168,       // ... and no switchback (degrees over two neighboring points of 32)
  dp: 0.035,        // polygon corners: Douglas-Peucker tolerance (of the size) ...
  merge: 20,        // ... corners turning less than this (degrees) dropped ...
  chamfer: 0.08,    // ... and two corners closer than this (of the size) that turn as one corner (at most
  chamferTurn: 150, //     this many degrees together) made one
  sideDev: 0.07,    // polygon sides: no point of a side's middle further than this from it (of its length) ...
  sideEnd: 0.12,    // ... nor of its ends (the corners)
  sideRms: 0.028,
  sideMin: 0.05,    // ... each side at least this long (of the size)
  cornerMin: 22,    // degrees a corner must turn
  rectAngle: 13,    // a rectangle: corners within this of 90° ...
  rectTilt: 12,     // ... sides within this of upright
  square: 0.08,     // sides within this of each other make it a square
  ellRms: 0.04,     // an ellipse: radial error (of the radius) ...
  ellMax: 0.11,
  ellOpen: 45,      // ... and no opening wider than this (degrees about its center)
  round: 1.12,      // axes within this ratio make it a circle
  ellTilt: 12,      // a longer ellipse must be upright within this (the Board's ellipses are axis-aligned)
  snap: 4,          // lines within this many degrees of a 15° step are put on it
};

function shapeRecClean(points, px) {
  if (!Array.isArray(points)) return null;
  let P = [];
  for (const q of points) {
    if (!q) continue;
    const x = +q[0], y = +q[1];
    if (!isFinite(x) || !isFinite(y)) continue;
    const l = P[P.length - 1];
    if (!l || Math.abs(x - l[0]) > 1e-9 || Math.abs(y - l[1]) > 1e-9) P.push([x, y]);
  }
  if (P.length < 2) return null;
  // a held pen jitters about where it stopped (and may have dwelt where it landed): one point for each, at the
  // middle of the jitter
  const b = sbox(P), S = Math.max(b[2] - b[0], b[3] - b[1]), rho = Math.max(3 * px, 0.025 * S);
  // Q runs from the stroke's end inwards: how many of its points the pen jittered over, and where it rested
  const rest = Q => {
    let k = 1;
    while (k < Q.length - 1 && shapeLen(Q[k], Q[0]) <= 2 * rho) k++;
    const xs = Q.slice(0, k).map(p => p[0]).sort((u, v) => u - v), ys = Q.slice(0, k).map(p => p[1]).sort((u, v) => u - v), c = [xs[k >> 1], ys[k >> 1]];
    let j = 0;
    while (j < Q.length - 2 && shapeLen(Q[j], c) <= 1.5 * rho) j++;
    return [j, c];
  };
  const [je, e] = rest(P.slice().reverse());
  if (je) P = P.slice(0, P.length - je).concat([e]);
  const [js, s] = rest(P);
  if (js) P = [s].concat(P.slice(js));
  // where the hand moved slowly the points crowd and jitter: keep one every so often
  const gap = Math.max(1.2 * px, 0.012 * S), Q = [P[0]];
  for (let i = 1; i < P.length - 1; i++) if (shapeLen(P[i], Q[Q.length - 1]) >= gap) Q.push(P[i]);
  if (P.length > 1) Q.push(P[P.length - 1]);
  return Q.length >= 2 ? Q : null;
}
function shapePathLen(P, i0, i1) { let t = 0; for (let i = i0 + 1; i <= i1; i++) t += shapeLen(P[i - 1], P[i]); return t; }
// n points evenly spaced along a polyline (closed: around it and back, the last point not repeated)
function shapeResample(P, n, closed) {
  const Q = closed ? P.concat([P[0]]) : P, L = shapePathLen(Q, 0, Q.length - 1), m = closed ? n : n - 1;
  if (!(L > 0)) return null;
  const step = L / m, out = [[Q[0][0], Q[0][1]]];
  let need = step, i = 1, prev = Q[0];
  while (out.length < n && i < Q.length) {
    const d = shapeLen(prev, Q[i]);
    if (d >= need && d > 0) {
      const t = need / d, p = [prev[0] + (Q[i][0] - prev[0]) * t, prev[1] + (Q[i][1] - prev[1]) * t];
      out.push(p); prev = p; need = step;
    } else { need -= d; prev = Q[i]; i++; }
  }
  while (out.length < n) out.push(closed ? Q[Q.length - 2].slice() : Q[Q.length - 1].slice());
  if (!closed) out[n - 1] = [Q[Q.length - 1][0], Q[Q.length - 1][1]];
  return out;
}
// total least squares line through P[i0..i1]: direction from the first point to the last, deviations along it
function shapeFitLine(P, i0, i1) {
  const n = i1 - i0 + 1;
  let cx = 0, cy = 0;
  for (let i = i0; i <= i1; i++) { cx += P[i][0]; cy += P[i][1]; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = i0; i <= i1; i++) { const dx = P[i][0] - cx, dy = P[i][1] - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ux = Math.cos(phi), uy = Math.sin(phi);
  if ((P[i1][0] - P[i0][0]) * ux + (P[i1][1] - P[i0][1]) * uy < 0) { ux = -ux; uy = -uy; }
  let dmax = 0, ss = 0, t0 = Infinity, t1 = -Infinity, back = 0, run = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const dx = P[i][0] - cx, dy = P[i][1] - cy, t = dx * ux + dy * uy, d = Math.abs(dy * ux - dx * uy);
    if (d > dmax) dmax = d;
    ss += d * d;
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
    if (t > run) run = t;
    if (run - t > back) back = run - t;
  }
  return { cx, cy, ux, uy, dmax, rms: Math.sqrt(ss / n), t0, t1, back };
}
// a line's ends turned onto the nearest 15° step when within SHAPE_REC.snap degrees, about its middle
function shapeRecSnapLine(A, B) {
  const th = Math.atan2(B[1] - A[1], B[0] - A[0]), q = Math.PI / 12, ts = Math.round(th / q) * q;
  if (Math.abs(th - ts) > SHAPE_REC.snap * Math.PI / 180) return [A, B];
  const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, h = shapeLen(A, B) / 2;
  let ux = Math.cos(ts), uy = Math.sin(ts);
  if (Math.abs(ux) < 1e-12) ux = 0;
  if (Math.abs(uy) < 1e-12) uy = 0;
  return [[mx - ux * h, my - uy * h], [mx + ux * h, my + uy * h]];
}
function shapeRecLine(R, px) {
  const n = R.length, C = SHAPE_REC;
  const tries = [];
  for (let a = 0; a <= C.hookIn; a++) for (let b = 0; b <= C.hookOut; b++) tries.push([a, b]);
  tries.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
  for (const [a, b] of tries) {
    const f = shapeFitLine(R, a, n - 1 - b), c = f.t1 - f.t0;
    if (!(c > 0) || f.dmax > Math.max(C.lineDev * c, 0.8 * px) || f.rms > C.lineRms * c + 0.25 * px || f.back > C.lineBack * c + 1.5 * px) continue;
    const proj = p => { const t = (p[0] - f.cx) * f.ux + (p[1] - f.cy) * f.uy; return [f.cx + f.ux * t, f.cy + f.uy * t]; };
    return { shape: 'line', pts: shapeRecSnapLine(proj(R[a]), proj(R[n - 1 - b])) };
  }
  return null;
}
function shapeSegX(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c[0] - a[0], qy = c[1] - a[1], s = (qx * sy - qy * sx) / den, t = (qx * ry - qy * rx) / den;
  return s >= 0 && s <= 1 && t >= 0 && t <= 1 ? { s, t, p: [a[0] + rx * s, a[1] + ry * s] } : null;
}
function shapeDistPath(p, P, i0, i1) {
  let d = Infinity;
  for (let i = Math.max(i0, 0); i < Math.min(i1, P.length - 1); i++) d = Math.min(d, segDist(p, P[i], P[i + 1]));
  return d;
}
// the closed loop a stroke draws: cut where it crosses itself near its ends, or closed across a small gap; the
// run-in before it and the overshoot after it must be short and stay on it. null when the stroke is not closed.
function shapeLoop(R, S) {
  const n = R.length, C = SHAPE_REC, step = shapePathLen(R, 0, n - 1) / (n - 1);
  let best = null;
  for (let i = 0; i < Math.floor(0.2 * n); i++) {
    for (let j = n - 2; j >= Math.floor(0.55 * n); j--) {
      if (j <= i + 2) continue;
      const X = shapeSegX(R[i], R[i + 1], R[j], R[j + 1]);
      if (!X) continue;
      const lead = i + X.s, tail = n - 1 - (j + X.t);
      if (!best || lead + tail < best.lead + best.tail) best = { i, j, X, lead, tail };
    }
  }
  let loop, lead = 0, tail = 0, i0 = 0, i1 = n - 1, X = R[0];
  if (best) {
    X = best.X.p;
    loop = [X].concat(R.slice(best.i + 1, best.j + 1));
    lead = best.lead; tail = best.tail; i0 = best.i + 1; i1 = best.j;
  } else {
    let jc = -1, gap = Infinity;
    for (let j = Math.floor(0.6 * n); j < n; j++) { const d = shapeLen(R[j], R[0]); if (d < gap) { gap = d; jc = j; } }
    if (gap > C.gap * S) return null;
    loop = R.slice(0, jc + 1); tail = n - 1 - jc; i1 = jc;
  }
  const len = (i1 - i0) * step;
  if (!(len > 0) || lead * step > C.lead * len || tail * step > C.tail * len) return null;
  // a short run past the closing corner may go its own way; anything longer must run along the loop
  const strays = j => shapeLen(R[j], X) > C.past * S && shapeDistPath(R[j], R, i0, i1) > C.stray * S;
  for (let j = i1 + 1; j < n; j++) if (strays(j)) return null;
  for (let j = 0; j < i0; j++) if (strays(j)) return null;
  return loop;
}
// net turning (in turns) round a closed loop, its total, and the sharpest turn over two neighboring points (degrees)
function shapeTurning(R) {
  const n = R.length, ts = [];
  let net = 0, abs = 0, sharp = 0;
  for (let i = 0; i < n; i++) {
    const a = R[(i + n - 1) % n], b = R[i], c = R[(i + 1) % n];
    const t = Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]));
    net += t; abs += Math.abs(t); ts.push(t);
  }
  for (let i = 0; i < n; i++) sharp = Math.max(sharp, Math.abs(ts[i] + ts[(i + 1) % n]));
  return { net: net / (2 * Math.PI), abs: abs / (2 * Math.PI), sharp: sharp * 180 / Math.PI };
}
function shapeSolve(M, v) { // Gaussian elimination with partial pivoting; null when singular
  const n = v.length, A = M.map((r, i) => r.concat([v[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    const t = A[c]; A[c] = A[p]; A[p] = t;
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = A[r][n]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
// an ellipse through a closed loop's points: center, semi-axes along its principal axes, tilt, radial errors
function shapeFitEllipse(Q, S) {
  const n = Q.length;
  let cx = 0, cy = 0;
  for (const p of Q) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of Q) { const dx = p[0] - cx, dy = p[1] - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(phi), s = Math.sin(phi);
  // A u² + B v² + C u + D v = 1 in the principal frame (scaled to the stroke's size for a well-conditioned solve)
  const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], r = [0, 0, 0, 0], U = [], V = [];
  for (const p of Q) {
    const dx = (p[0] - cx) / S, dy = (p[1] - cy) / S, u = dx * c + dy * s, v = dy * c - dx * s, f = [u * u, v * v, u, v];
    U.push(u); V.push(v);
    for (let i = 0; i < 4; i++) { r[i] += f[i]; for (let j = 0; j < 4; j++) M[i][j] += f[i] * f[j]; }
  }
  const x = shapeSolve(M, r);
  if (!x || !(x[0] > 0) || !(x[1] > 0)) return null;
  const u0 = -x[2] / (2 * x[0]), v0 = -x[3] / (2 * x[1]), K = 1 + x[0] * u0 * u0 + x[1] * v0 * v0;
  if (!(K > 0)) return null;
  const a = Math.sqrt(K / x[0]), b = Math.sqrt(K / x[1]);
  let ss = 0, mx = 0, ang = [];
  for (let i = 0; i < n; i++) {
    const du = (U[i] - u0) / a, dv = (V[i] - v0) / b, e = Math.hypot(du, dv) - 1;
    ss += e * e; mx = Math.max(mx, Math.abs(e)); ang.push(Math.atan2(dv, du));
  }
  ang.sort((p, q) => p - q);
  let open = 2 * Math.PI - (ang[n - 1] - ang[0]);
  for (let i = 1; i < n; i++) open = Math.max(open, ang[i] - ang[i - 1]);
  return { cx: cx + (u0 * c - v0 * s) * S, cy: cy + (u0 * s + v0 * c) * S, a: a * S, b: b * S, phi, rms: Math.sqrt(ss / n), max: mx, open };
}
function shapeRecEllipse(loop, S) {
  const C = SHAPE_REC, f = shapeFitEllipse(loop, S);
  if (!f || f.rms > C.ellRms || f.max > C.ellMax || f.open > C.ellOpen * Math.PI / 180) return null;
  const big = Math.max(f.a, f.b), small = Math.min(f.a, f.b);
  if (big / small <= C.round) {
    const r = (f.a + f.b) / 2;
    return { shape: 'ellipse', pts: [[f.cx - r, f.cy - r], [f.cx + r, f.cy + r]] };
  }
  // the major axis's angle from the nearest of x and y
  let t = Math.abs(f.phi) % (Math.PI / 2);
  if (t > Math.PI / 4) t = Math.PI / 2 - t;
  if (t > C.ellTilt * Math.PI / 180) return null;
  const alongX = Math.abs(Math.cos(f.phi)) >= Math.abs(Math.sin(f.phi)), rx = alongX ? f.a : f.b, ry = alongX ? f.b : f.a;
  return { shape: 'ellipse', pts: [[f.cx - rx, f.cy - ry], [f.cx + rx, f.cy + ry]] };
}
// corners of a closed loop resampled evenly: Douglas-Peucker from its two points furthest apart (tolerance
// SHAPE_REC.dp of the size S), then corners that hardly turn dropped, and a corner cut short (two corners close
// together that turn as one) made one. Indices into R, in order round the loop.
function shapeCorners(R, S) {
  const m = R.length, C = SHAPE_REC, eps = C.dp * S;
  let a = 0, b = 0, d = -1;
  for (let i = 0; i < m; i++) { const q = shapeLen(R[0], R[i]); if (q > d) { d = q; b = i; } }
  d = -1;
  for (let i = 0; i < m; i++) { const q = shapeLen(R[b], R[i]); if (q > d) { d = q; a = i; } }
  const i0 = Math.min(a, b), i1 = Math.max(a, b), out = [i0];
  const split = (s, e) => {
    let best = -1, dm = eps;
    for (let i = s + 1; i < e; i++) { const q = segDist(R[i % m], R[s % m], R[e % m]); if (q > dm) { dm = q; best = i; } }
    if (best < 0) return;
    split(s, best); out.push(best % m); split(best, e);
  };
  if (i1 > i0) { split(i0, i1); out.push(i1); split(i1, i0 + m); }
  const turn = i => { // signed, degrees
    const p = R[out[(i + out.length - 1) % out.length]], q = R[out[i]], r = R[out[(i + 1) % out.length]];
    return Math.atan2((q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]), (q[0] - p[0]) * (r[0] - q[0]) + (q[1] - p[1]) * (r[1] - q[1])) * 180 / Math.PI;
  };
  while (out.length > 3) {
    let w = -1, wt = C.merge;
    for (let i = 0; i < out.length; i++) { const t = Math.abs(turn(i)); if (t < wt) { wt = t; w = i; } }
    if (w >= 0) { out.splice(w, 1); continue; }
    let c = -1, cd = C.chamfer * S;
    for (let i = 0; i < out.length; i++) {
      const j = (i + 1) % out.length, dd = shapeLen(R[out[i]], R[out[j]]), ti = turn(i), tj = turn(j);
      if (dd < cd && Math.sign(ti) === Math.sign(tj) && Math.abs(ti + tj) <= C.chamferTurn) { cd = dd; c = i; }
    }
    if (c < 0) break;
    const j = (c + 1) % out.length;
    let a0 = out[c], a1 = out[j];
    if (a1 < a0) a1 += m;
    const mid = Math.round((a0 + a1) / 2) % m;
    if (j === 0) { out[c] = mid; out.shift(); } else out.splice(c, 2, mid);
  }
  return out;
}
function shapeRecPoly(loop, S) {
  const C = SHAPE_REC, m = 128, R = shapeResample(loop, m, true);
  if (!R) return null;
  const cs = shapeCorners(R, S), K = cs.length;
  if (K < 3 || K > 4) return null;
  const lines = [];
  for (let s = 0; s < K; s++) {
    const i0 = cs[s], i1 = cs[(s + 1) % K] + (cs[(s + 1) % K] <= i0 ? m : 0), side = [];
    for (let i = i0; i <= i1; i++) side.push(R[i % m]);
    const chord = shapeLen(side[0], side[side.length - 1]);
    if (chord < C.sideMin * S) return null;
    // fit the side's middle; its middle must be straight, its ends (the corners: rounded or cut) a little less so
    const n = side.length, cut = Math.floor((n - 1) * 0.15), f = n - 2 * cut >= 3 ? shapeFitLine(side, cut, n - 1 - cut) : shapeFitLine(side, 0, n - 1);
    const e = Math.floor((n - 1) * 0.1);
    let dmid = 0, dall = 0, ss = 0;
    for (let i = 0; i < n; i++) {
      const p = side[i], dv = Math.abs((p[1] - f.cy) * f.ux - (p[0] - f.cx) * f.uy);
      dall = Math.max(dall, dv); ss += dv * dv;
      if (i >= e && i <= n - 1 - e) dmid = Math.max(dmid, dv);
    }
    if (dmid > C.sideDev * chord + 0.012 * S || dall > C.sideEnd * chord + 0.03 * S || Math.sqrt(ss / n) > C.sideRms * chord + 0.004 * S) return null;
    lines.push(f);
  }
  // vertices where neighboring sides' lines meet
  const V = [];
  for (let s = 0; s < K; s++) {
    const f = lines[(s + K - 1) % K], g = lines[s], den = f.ux * g.uy - f.uy * g.ux, P = R[cs[s]];
    let p = P;
    if (Math.abs(den) > 1e-9) {
      const t = ((g.cx - f.cx) * g.uy - (g.cy - f.cy) * g.ux) / den, q = [f.cx + f.ux * t, f.cy + f.uy * t];
      if (shapeLen(q, P) < 0.2 * S) p = q;
    }
    V.push(p);
  }
  // convex, with real corners
  let sign = 0;
  for (let s = 0; s < K; s++) {
    const a = V[(s + K - 1) % K], b = V[s], c = V[(s + 1) % K];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), dt = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    const turn = Math.abs(Math.atan2(cr, dt)) * 180 / Math.PI;
    if (turn < C.cornerMin) return null;
    if (sign && Math.sign(cr) !== sign) return null;
    sign = Math.sign(cr);
  }
  if (K === 4) {
    // an upright rectangle: corners near 90°, sides near upright
    let rect = true, tilt = 0;
    for (let s = 0; s < 4 && rect; s++) {
      const a = V[(s + 3) % 4], b = V[s], c = V[(s + 1) % 4];
      const ang = Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]))) * 180 / Math.PI;
      if (Math.abs(ang - 90) > C.rectAngle) rect = false;
      let t = Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0])) % (Math.PI / 2);
      if (t > Math.PI / 4) t = Math.PI / 2 - t;
      tilt = Math.max(tilt, t * 180 / Math.PI);
    }
    if (rect && tilt <= C.rectTilt) {
      const xs = V.map(p => p[0]).sort((p, q) => p - q), ys = V.map(p => p[1]).sort((p, q) => p - q);
      let x0 = (xs[0] + xs[1]) / 2, x1 = (xs[2] + xs[3]) / 2, y0 = (ys[0] + ys[1]) / 2, y1 = (ys[2] + ys[3]) / 2;
      const w = x1 - x0, h = y1 - y0;
      if (Math.abs(w - h) <= C.square * Math.max(w, h)) {
        const s = (w + h) / 2, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        x0 = cx - s / 2; x1 = cx + s / 2; y0 = cy - s / 2; y1 = cy + s / 2;
      }
      return { shape: 'rect', pts: [[x0, y0], [x1, y1]] };
    }
  }
  // sides close to level or upright are made exactly so
  for (let s = 0; s < K; s++) {
    const a = V[s], b = V[(s + 1) % K], t = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, f = Math.abs(t) % 90;
    if (Math.min(f, 90 - f) > 4) continue;
    if (Math.abs(Math.abs(t) - 90) <= 4) { const x = (a[0] + b[0]) / 2; a[0] = b[0] = x; } else { const y = (a[1] + b[1]) / 2; a[1] = b[1] = y; }
  }
  return { shape: 'poly', pts: V };
}
function shapeRecClosed(R, S) {
  const C = SHAPE_REC, loop = shapeLoop(R, S);
  if (!loop || loop.length < 12) return null;
  const T = shapeTurning(shapeResample(loop, 32, true));
  if (Math.abs(Math.abs(T.net) - 1) > C.turnNet || T.abs > C.turnAbs || T.sharp > C.sharp) return null;
  return shapeRecPoly(loop, S) || shapeRecEllipse(loop, S);
}
// a line ending in an arrowhead drawn in the same stroke: a long straight run, then barbs on both sides of its end
function shapeRecArrow(R, px) {
  const n = R.length;
  let m = -1, f = null;
  for (let j = n - 4; j >= Math.floor(0.45 * n); j--) {
    const g = shapeFitLine(R, 0, j), c = g.t1 - g.t0;
    if (c > 0 && g.dmax <= Math.max(0.03 * c, 0.8 * px) && g.back <= 0.02 * c + 0.5 * px) { m = j; f = g; break; }
  }
  if (!f) return null;
  const c = f.t1 - f.t0;
  let tip = -Infinity;
  for (const p of R) tip = Math.max(tip, (p[0] - f.cx) * f.ux + (p[1] - f.cy) * f.uy);
  if (tip - f.t1 > 0.06 * c) return null;
  const T = [f.cx + f.ux * tip, f.cy + f.uy * tip];
  let size = 0, left = null, right = null;
  for (let i = m; i < n; i++) {
    const dx = R[i][0] - T[0], dy = R[i][1] - T[1], a = dx * f.ux + dy * f.uy, p = dy * f.ux - dx * f.uy;
    size = Math.max(size, Math.hypot(dx, dy));
    if (a < 0 && (!left || p > left[1])) left = [a, p];
    if (a < 0 && (!right || p < right[1])) right = [a, p];
  }
  if (size < Math.max(0.12 * c, 4 * px) || size > 0.4 * c || !left || !right || shapePathLen(R, m, n - 1) > 4.5 * size) return null;
  // a barb each side, each a real part of the head, sweeping back at a sensible angle
  for (const [a, p] of [left, [right[0], -right[1]]]) {
    const ang = Math.atan2(p, -a) * 180 / Math.PI;
    if (p < 0.3 * size || Math.hypot(a, p) < 0.6 * size || ang < 12 || ang > 70) return null;
  }
  const S0 = [f.cx + f.ux * f.t0, f.cy + f.uy * f.t0];
  return { shape: 'arrow', pts: shapeRecSnapLine(S0, T) };
}

// Draw-and-hold: is this freehand stroke ([[x, y, ...], ...] in world units) clearly a shape? { shape, pts } for a
// line, an ellipse (a circle when nearly round), an upright rectangle (a square when nearly square), a triangle or
// other convex quadrilateral (poly: its vertices), or an arrow drawn in one stroke; null when it is not clearly one.
// o (optional): z, the zoom it was drawn at (the pen's jitter is in screen pixels, so tolerances for it scale by 1/z);
// min, the smallest size in world units that may become a shape (e.g. 24 / z keeps small handwriting out).
function shapeRecognize(points, o) {
  const px = o && o.z > 0 ? 1 / o.z : 1, P = shapeRecClean(points, px);
  if (!P) return null;
  const b = sbox(P), S = Math.max(b[2] - b[0], b[3] - b[1]);
  if (!(S >= Math.max(SHAPE_REC.minSize * px, (o && +o.min) || 0))) return null;
  const R = shapeResample(P, SHAPE_REC.n, false);
  if (!R) return null;
  return shapeRecLine(R, px) || shapeRecClosed(R, S) || shapeRecArrow(R, px) || null;
}
