'use strict';
// ================================================================== paper: the Board's backgrounds
// A page's paper is {kind, tone}: the kind is the pattern, the tone its colors. drawPaper fills the visible world
// rectangle with the paper and tiles the pattern over it from the world origin, so the pattern moves exactly with the
// ink when the board pans. Everything is placed in device pixels: widths are whole pixels and positions snap to the
// pixel grid, so a 1 px line stays crisp at any zoom and devicePixelRatio. Marks are opaque colors (a faded family is
// its color mixed toward the paper), so where lines cross they stay one color.

const PAPER_KINDS = [{ kind: 'blank', label: 'Blank' }, { kind: 'dots', label: 'Dots' }, { kind: 'grid', label: 'Grid' },
  { kind: 'graph', label: 'Graph paper' }, { kind: 'lined', label: 'Lined' }, { kind: 'iso', label: 'Isometric' },
  { kind: 'plane', label: 'Coordinate plane' }, { kind: 'numberlines', label: 'Number lines' }];
const PAPER_TONES = [{ tone: 'theme', label: 'Board' }, { tone: 'white', label: 'White' }, { tone: 'cream', label: 'Cream' },
  { tone: 'green', label: 'Chalkboard' }, { tone: 'black', label: 'Black' }];

// [paper, ink]: the Board's own (light, dark), then the tones that are the same in either theme
const PAPER_THEME = [['#fbf8ef', '#1b2a4a'], ['#101a2e', '#f1eadb']];
const PAPER_BASE = { white: ['#ffffff', '#1b2a4a'], cream: ['#fbf8ef', '#1b2a4a'], green: ['#1f3d2f', '#f1eadb'], black: ['#121418', '#f1eadb'] };
// How much of the ink each mark mixes into the paper [on light paper, on dark paper]. Grid lines stay quiet so any pen
// reads clearly above them, yet not so faint that they vanish on the classroom panel; a lined page's rules and the
// dots, sparser, are a little stronger. Tuned by eye on the contact sheet test/paper_browser.js draws.
const PAPER_MIX = { line: [0.12, 0.12], rule: [0.16, 0.15], dot: [0.3, 0.3], major: [0.25, 0.24], axis: [0.6, 0.58], label: [0.65, 0.65] };
const PAPER_CORAL = ['#d9654f', '#ef8a73'];   // the lined paper's margin: the Board's coral, faded into the paper
const PAPER_FONT = '"DM Sans", system-ui, sans-serif';
const PAPER_LABEL = 12;                       // label size, screen px, at 100% and below (see drawPaper)
const PAPER_ISO = 20 * Math.sqrt(3);          // between the columns of an isometric lattice of side 40
const PAPER_TONE_MEMO = {};
const PAPER_SCRATCH = [];                     // the strips, kept from frame to frame

function paperOwn(o, k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k); }
function paperRGB(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function paperMix(a, b, t) {
  const p = paperRGB(a), q = paperRGB(b);
  return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// Colors for a tone (dark: the Board's theme is dark; only 'theme' follows it), a frozen object shared by all callers:
// { paper, ink, line, major, axis, label, margin, dark } and, for the dot lattices and lined paper, dot and rule.
function paperTone(tone, dark) {
  const fixed = paperOwn(PAPER_BASE, tone), key = fixed ? tone : dark ? 'theme dark' : 'theme';
  if (PAPER_TONE_MEMO[key]) return PAPER_TONE_MEMO[key];
  const [paper, ink] = fixed ? PAPER_BASE[tone] : PAPER_THEME[dark ? 1 : 0];
  const c = paperRGB(paper), d = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 < 0.5 ? 1 : 0;
  const mix = k => paperMix(paper, ink, PAPER_MIX[k][d]);
  return (PAPER_TONE_MEMO[key] = Object.freeze({ paper, ink, line: mix('line'), major: mix('major'), axis: mix('axis'),
    label: mix('label'), margin: paperMix(paper, PAPER_CORAL[d], 0.5), dark: !!d, dot: mix('dot'), rule: mix('rule') }));
}

// Draw the paper into a context that already has the world transform (a scale and a translation, as the pad sets it).
//   spec {kind, tone}; rect [x0, y0, x1, y1] the visible world rectangle; z the zoom; dark the Board's theme.
// Labels are PAPER_LABEL screen px at 100% and below; zoomed in they grow with the square root of the zoom (to 1.75
// times), so a plane zoomed in on to plot points for a class keeps numbers that read from the back of the room.
function drawPaper(ctx, spec, rect, z, dark) { paperDraw(ctx, spec, rect, z, dark, PAPER_LABEL * Math.min(1.75, Math.max(1, Math.sqrt(z > 0 ? z : 1)))); }

function paperDraw(ctx, spec, rect, z, dark, lab) {
  const T = paperTone(spec && spec.tone, dark), kind = spec && spec.kind;
  const x0 = Math.min(rect[0], rect[2]), x1 = Math.max(rect[0], rect[2]), y0 = Math.min(rect[1], rect[3]), y1 = Math.max(rect[1], rect[3]);
  if (!(x1 > x0 && y1 > y0) || !isFinite(x1 - x0 + y1 - y0)) return;
  ctx.save();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = T.paper; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  const draw = paperOwn(PAPER_DRAW, kind) ? PAPER_DRAW[kind] : null, m = draw && ctx.getTransform ? ctx.getTransform() : null;
  // the pattern is placed in device pixels; a rotated or skewed context (the pad never makes one) gets plain paper
  if (m && !m.b && !m.c && m.a > 0 && m.d > 0) {
    if (!(z > 0)) z = m.a / ((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // world (x, y) is device (x·sx + ox, y·sy + oy); P device px make one screen px
    draw({ ctx, T, z, lab, P: m.a / z, sx: m.a, sy: m.d, ox: m.e, oy: m.f, x0, y0, x1, y1,
      X0: x0 * m.a + m.e, X1: x1 * m.a + m.e, Y0: y0 * m.d + m.f, Y1: y1 * m.d + m.f });
  }
  ctx.restore();
}

// ------------------------------------------------------------------ marks
// a mark px screen px wide, in whole device pixels (1.5 px: 1 on a plain screen, 3 on a retina one)
function paperWidth(V, px) { return Math.max(1, Math.round(px * V.P - 0.01)); }
// How strongly a family of marks shows when they are px screen px apart: gone below lo, full from hi. Zooming out
// fades a fine pattern away instead of letting it turn into gray mush (and keeps the cost down): lines from 12 px apart
// down to 6, dots from 12 down to 8.
function paperFade(px, lo, hi) { return px <= lo ? 0 : px >= hi ? 1 : (px - lo) / (hi - lo); }
// a tone's color faded toward the paper by a (0 … 1), as an opaque color
function paperShade(T, key, a) { return a >= 1 ? T[key] : paperMix(T.paper, T[key], a); }

// The lines x = k·step (paperCols) or y = k·step (paperRows) across the view, w device px wide, in the fill color;
// every skip-th one is left to a coarser family drawn over them. One fillRect a line: a pixel-aligned rect is the
// cheapest mark a canvas draws, where one path of hundreds of rects (or a stroke over 1 px wide) rasterizes 3–5× slower.
function paperCols(V, step, skip, w) {
  const ctx = V.ctx, m = w / 2 / V.sx, h = V.Y1 - V.Y0, k1 = Math.floor((V.x1 + m) / step);
  for (let k = Math.ceil((V.x0 - m) / step); k <= k1; k++) if (!skip || k % skip) ctx.fillRect(Math.round(k * step * V.sx + V.ox - w / 2), V.Y0, w, h);
}
function paperRows(V, step, skip, w) {
  const ctx = V.ctx, m = w / 2 / V.sy, l = V.X1 - V.X0, k1 = Math.floor((V.y1 + m) / step);
  for (let k = Math.ceil((V.y0 - m) / step); k <= k1; k++) if (!skip || k % skip) ctx.fillRect(V.X0, Math.round(k * step * V.sy + V.oy - w / 2), l, w);
}

function paperCanvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}
// Scratch strip i: exactly w × h device px (the view's width), cleared. It is stamped whole, because drawing part of a
// canvas takes Chrome twice as long; the strip's own edges crop whatever reaches past the view's sides.
function paperStrip(i, w, h) {
  const c = PAPER_SCRATCH[i] || (PAPER_SCRATCH[i] = paperCanvas(w, h).getContext('2d'));
  if (c.canvas.width !== w || c.canvas.height !== h) { c.canvas.width = w; c.canvas.height = h; }
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.clearRect(0, 0, w, h);
  return c;
}
// One dot of radius R device px on the center pixel of a (2·pad + 1)² sprite, kept while R and the color stay. Every
// dot is a copy of it, so every dot is the same pixels: one path of many dots is shaded a level or two differently
// depending on where the path is clipped, which would make dots flicker by a shade as the board pans.
function paperSprite(R, pad, color) {
  const n = 2 * pad + 1, c = PAPER_SCRATCH[3] || (PAPER_SCRATCH[3] = paperCanvas(n, n).getContext('2d'));
  if (c.key === R + ' ' + color && c.canvas.width === n) return c.canvas;
  c.canvas.width = c.canvas.height = n;
  c.beginPath(); c.arc(pad + 0.5, pad + 0.5, R, 0, 2 * Math.PI); c.fillStyle = color; c.fill();
  c.key = R + ' ' + color;
  return c.canvas;
}
// stamp a strip with its left at device x xa and its top at row y; one crossing the top or bottom of the view is cropped
function paperStamp(V, c, xa, y) {
  const s = c.canvas, h = s.height, t = Math.floor(V.Y0), b = Math.ceil(V.Y1);
  if (y >= t && y + h <= b) V.ctx.drawImage(s, xa, y);
  else if (y < b && y + h > t) { const u = Math.max(y, t), v = Math.min(y + h, b); V.ctx.drawImage(s, 0, u - y, s.width, v - u, xa, u, s.width, v - u); }
}

// A lattice of dots of radius r screen px, in rows rowStep apart; in a row the dots are colStep apart, odd rows shifted
// by colOff. All rows are the same row of dots, so one row is stamped from the dot sprite into a strip (two strips for
// a shifted lattice) and the strip is stamped row by row: a screen of dense dots costs a few hundred blits, where one
// path of 30 000 arcs costs 20–50 ms. A dot's center is the center of the pixel its world point falls in.
function paperDots(V, rowStep, colStep, colOff, r, color) {
  const R = r * V.P, pad = Math.ceil(R) + 1, h = 2 * pad + 1, xa = Math.floor(V.X0), w = Math.ceil(V.X1) - xa;
  const dot = paperSprite(R, pad, color), mx = R / V.sx, my = pad / V.sy, strips = [];   // a dot just outside still shows a sliver
  for (const off of colOff ? [0, colOff] : [0]) {
    const c = paperStrip(strips.length, w, h), i1 = Math.floor((V.x1 + mx - off) / colStep);
    for (let i = Math.ceil((V.x0 - mx - off) / colStep); i <= i1; i++) c.drawImage(dot, Math.floor((off + i * colStep) * V.sx + V.ox) - xa - pad, 0);
    strips.push(c);
  }
  const k1 = Math.floor((V.y1 + my) / rowStep);
  for (let k = Math.ceil((V.y0 - my) / rowStep); k <= k1; k++) paperStamp(V, strips[colOff && k % 2 ? 1 : 0], xa, Math.floor(k * rowStep * V.sy + V.oy) - pad);
}

// ------------------------------------------------------------------ labels
// label widths without measuring every label: the digits and the minus sign, measured once per draw
function paperGlyphs(ctx) {
  const w = {};
  for (const ch of '0123456789−') w[ch] = ctx.measureText(ch).width;
  return s => { let t = 0; for (let i = 0; i < s.length; i++) t += w[s[i]] || 0; return t; };
}
function paperNum(n) { return n < 0 ? '−' + -n : String(n); }
// label every 1, 2, 5, 10, 20, 50 … units: the first step that leaves need device px between label centers
function paperStep(unit, need) {
  for (let s = 1; s < 1e12; s *= 10) for (const m of [1, 2, 5]) if (s * m * unit >= need) return s * m;
  return 1e12;
}

// ------------------------------------------------------------------ the kinds
function paperDrawDots(V) {
  const a = paperFade(28 * V.z, 8, 12);
  if (a > 0) paperDots(V, 28, 28, 0, 1.3, paperShade(V.T, 'dot', a));
}

// Equilateral triangles of side 40 with a vertical side: columns of dots 40 apart, every other column half a step down,
// so a cube drawn on it has vertical edges and 30° ones. Its dots are a little bigger: they are what the pen joins.
function paperDrawIso(V) {
  const a = paperFade(40 * V.z, 8, 12);
  if (a > 0) paperDots(V, 20, 2 * PAPER_ISO, PAPER_ISO, 1.6, paperShade(V.T, 'dot', a));
}

function paperDrawGrid(V) {
  const a = paperFade(40 * V.z, 6, 12), w = paperWidth(V, 1);
  if (a > 0) { V.ctx.fillStyle = paperShade(V.T, 'line', a); paperCols(V, 40, 0, w); paperRows(V, 40, 0, w); }
}

function paperDrawGraph(V) {
  const ctx = V.ctx, a = paperFade(20 * V.z, 6, 12), b = paperFade(100 * V.z, 6, 12), w = paperWidth(V, 1), wm = paperWidth(V, 1.5);
  if (a > 0) { ctx.fillStyle = paperShade(V.T, 'line', a); paperCols(V, 20, 5, w); paperRows(V, 20, 5, w); }
  if (b > 0) { ctx.fillStyle = paperShade(V.T, 'major', b); paperCols(V, 100, 0, wm); paperRows(V, 100, 0, wm); }
}

function paperDrawLined(V) {
  const ctx = V.ctx, a = paperFade(40 * V.z, 6, 12);
  if (a > 0) { ctx.fillStyle = paperShade(V.T, 'rule', a); paperRows(V, 40, 0, paperWidth(V, 1)); }
  if (V.x0 <= 0 && V.x1 >= 0) {   // the margin, at x = 0
    const w = paperWidth(V, 1.5);
    ctx.fillStyle = V.T.margin; ctx.fillRect(Math.round(V.ox - w / 2), V.Y0, w, V.Y1 - V.Y0);
  }
}

// One unit = 40. The grid every unit, the axes through the world origin heavier and darker, labels along both axes.
function paperDrawPlane(V) {
  const ctx = V.ctx, a = paperFade(40 * V.z, 6, 12), w = paperWidth(V, 1), wa = paperWidth(V, 2);
  if (a > 0) { ctx.fillStyle = paperShade(V.T, 'line', a); paperCols(V, 40, 0, w); paperRows(V, 40, 0, w); }
  const inX = V.y0 <= 0 && V.y1 >= 0, inY = V.x0 <= 0 && V.x1 >= 0;   // the x axis (y = 0) and the y axis are in view
  ctx.fillStyle = V.T.axis;
  if (inY) ctx.fillRect(Math.round(V.ox - wa / 2), V.Y0, wa, V.Y1 - V.Y0);
  if (inX) ctx.fillRect(V.X0, Math.round(V.oy - wa / 2), V.X1 - V.X0, wa);
  paperPlaneLabels(V, wa, inX && inY);
}

// The labels are the same size at every zoom and step 1, 2, 5, 10 … units so they never collide. An axis that is off
// screen keeps its labels, pinned to the nearest edge of the view the way a map keeps its grid labels; the one "0"
// sits below-left of the origin. Where a pinned row meets a pinned column (a corner) the x label gives way.
function paperPlaneLabels(V, wa, origin) {
  const { ctx, T, P } = V, U = 40, fs = V.lab * P, cap = 0.7 * fs, g = 5 * P + wa / 2, e = 4 * P, pl = Math.round(2 * P);
  ctx.font = '500 ' + fs + 'px ' + PAPER_FONT;
  const tw = paperGlyphs(ctx);
  // the units in view (math y points up: world y = −40 is y = 1)
  const i0 = Math.ceil(V.x0 / U), i1 = Math.floor(V.x1 / U), j0 = Math.ceil(-V.y1 / U), j1 = Math.floor(-V.y0 / U);
  const step = paperStep(U * V.sx, Math.max(tw(paperNum(i0)), tw(paperNum(i1))) + 0.9 * fs);
  // the x axis's labels: under it, over it when there is no room under it, or pinned to the top or bottom edge
  let ty = V.oy + g;
  if (ty + cap > V.Y1 - e) ty = Math.min(V.oy - g - cap, V.Y1 - e - cap);
  ty = Math.round(Math.max(ty, V.Y0 + e));
  // the y axis's labels: left of it (right-aligned), right of it when there is no room, or pinned to an edge
  const jl = Math.ceil(j0 / step) * step, jh = Math.floor(j1 / step) * step, wy = Math.max(tw(paperNum(jl)), tw(paperNum(jh)));
  let right = true, ax = V.ox - g;
  if (ax - wy < V.X0 + e) { right = false; ax = Math.max(V.ox + g, V.X0 + e); } else ax = Math.min(ax, V.X1 - e);
  ax = Math.round(ax);
  // a label is its text, anchor and the box of its digits; two collide when their digits come within 2 px
  const item = (s, x, top, w, align) => { const l = x - (align === 'right' ? w : align === 'center' ? w / 2 : 0); return { s, x, y: Math.round(top + cap), align, l, t: top, r: l + w, b: top + cap }; };
  const near = 2 * P, hit = (a, c) => a.l < c.r + near && c.l < a.r + near && a.t < c.b + near && c.t < a.b + near;
  const items = [], inRow = [], zero = origin ? item('0', ax, ty, tw('0'), right ? 'right' : 'left') : null;
  if (zero) items.push(zero);
  for (let j = jl; j <= j1; j += step) {
    const top = Math.round(-j * U * V.sy + V.oy - cap / 2);
    if (!j || top < V.Y0 + e || top + cap > V.Y1 - e) continue;   // whole labels only
    const s = paperNum(j), it = item(s, ax, top, tw(s), right ? 'right' : 'left');
    if (zero && hit(it, zero)) continue;
    items.push(it);
    if (it.t < ty + cap + near && it.b > ty - near) inRow.push(it);   // it shares the x labels' row
  }
  for (let i = Math.ceil(i0 / step) * step; i <= i1; i += step) {
    const s = paperNum(i), w = tw(s), x = Math.round(i * U * V.sx + V.ox);
    if (!i || x - w / 2 < V.X0 + e || x + w / 2 > V.X1 - e) continue;
    const it = item(s, x, ty, w, 'center');
    if ((zero && hit(it, zero)) || inRow.some(o => hit(it, o))) continue;
    items.push(it);
  }
  // a plate of paper under each label keeps the grid lines out of its digits
  ctx.fillStyle = T.paper;
  for (const it of items) ctx.fillRect(it.l - pl, it.t - pl, it.r - it.l + 2 * pl, cap + 2 * pl);
  ctx.fillStyle = T.label; ctx.textBaseline = 'alphabetic';
  for (const it of items) { ctx.textAlign = it.align; ctx.fillText(it.s, it.x, it.y); }
}

// Number lines at y = 100 + 200k with a tick every 40 and integer labels under the ticks (0 at x = 0). They are all
// alike, so one is drawn into a strip with its ticks and labels and stamped at each line in view. When the labels
// thin out, the labeled ticks stay long and the others are short; the labels fade as the lines crowd together.
function paperDrawNumberLines(V) {
  const { T, P } = V, U = 40, G = 200, Y = 100;
  const wl = paperWidth(V, 2), wt = paperWidth(V, 1.5), tl = Math.round(7 * P), ts = Math.round(4 * P);
  const fs = V.lab * P, cap = 0.7 * fs, la = paperFade(G * V.z, 34, 44), ta = paperFade(U * V.z, 6, 12);
  const xa = Math.floor(V.X0), w = Math.ceil(V.X1) - xa, top = tl + 1;   // the line's top row in the strip
  const base = top + wl + tl + Math.round(4 * P) + Math.round(cap), h = la > 0 ? base + Math.round(3 * P) + 1 : top + wl + tl + 1;
  const c = paperStrip(2, w, h);
  c.font = '500 ' + fs + 'px ' + PAPER_FONT;
  const tw = paperGlyphs(c), i0 = Math.ceil(V.x0 / U), i1 = Math.floor(V.x1 / U);
  const step = paperStep(U * V.sx, Math.max(tw(paperNum(i0)), tw(paperNum(i1))) + 0.9 * fs), il = Math.ceil(i0 / step) * step;
  const X = i => Math.round(i * U * V.sx + V.ox - xa - wt / 2);   // a tick's left edge in the strip
  if (ta > 0 && step > 1) {   // the unlabeled ticks, under the rest
    c.fillStyle = paperShade(T, 'axis', ta);
    for (let i = i0; i <= i1; i++) if (i % step) c.fillRect(X(i), top - ts, wt, wl + 2 * ts);
  }
  c.fillStyle = T.axis; c.fillRect(V.X0 - xa, top, V.X1 - V.X0, wl);
  for (let i = il; i <= i1; i += step) c.fillRect(X(i), top - tl, wt, wl + 2 * tl);
  if (la > 0) {
    c.fillStyle = paperShade(T, 'label', la); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (let i = il; i <= i1; i += step) c.fillText(paperNum(i), Math.round(i * U * V.sx + V.ox - xa), base);
  }
  const k0 = Math.floor(((V.Y0 - h - V.oy) / V.sy - Y) / G), k1 = Math.ceil(((V.Y1 + h - V.oy) / V.sy - Y) / G);
  for (let k = k0; k <= k1; k++) paperStamp(V, c, xa, Math.round((Y + G * k) * V.sy + V.oy - wl / 2) - top);
}

const PAPER_DRAW = { dots: paperDrawDots, grid: paperDrawGrid, graph: paperDrawGraph, lined: paperDrawLined, iso: paperDrawIso,
  plane: paperDrawPlane, numberlines: paperDrawNumberLines };

// ------------------------------------------------------------------ thumbnails
// A small picture of a paper for the Board's picker: a canvas of w × h CSS px at devicePixelRatio. It is zoomed out
// so a few cells show, with what tells the kinds apart in view: the origin, the margin, a number line.
function paperThumb(spec, dark, w, h) {
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const cv = paperCanvas(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
  if (cv.style) { cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
  const kind = spec && spec.kind;
  let z = 0.4, cx = 20, cy = 20;   // the zoom, and the world point at the middle of the picture
  if (kind === 'dots') { z = 0.5; cx = cy = 14; }
  else if (kind === 'graph') { z = 0.5; cx = 50; cy = 25; }
  else if (kind === 'lined') cx = 0.3 * w / z;
  else if (kind === 'iso') cx = cy = 0;
  else if (kind === 'plane') { z = 0.3; cx = cy = 0; }
  else if (kind === 'numberlines') { z = 0.35; cx = 0; cy = 100 + 0.12 * h / z; }
  const x0 = cx - w / 2 / z, y0 = cy - h / 2 / z, ctx = cv.getContext('2d');
  ctx.setTransform(dpr * z, 0, 0, dpr * z, -x0 * dpr * z, -y0 * dpr * z);
  paperDraw(ctx, spec, [x0, y0, x0 + w / z, y0 + h / z], z, dark, 8);
  return cv;
}
