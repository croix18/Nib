// Board shapes (src/shapes.js) without a browser: what a drag makes in every direction, grid and angle snapping, taps,
// outline / bounds / hit tests for every kind (also moved and scaled), number line and plane label layout, draw-and-hold
// recognition of synthetic hand-drawn shapes, real handwriting symbols that must not turn into shapes, odd input.
//   node test/shapes_check.js [--verbose]
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const VERBOSE = process.argv.includes('--verbose');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  FAIL', m); } };
const section = n => console.log(n);
const near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-9 : e);

// core.js, neat.js and shapes.js in one strict function scope (as build.py concatenates src/), every top-level name of
// shapes.js handed out
const SRC = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');
const topNames = s => [...new Set((s.match(/^(?:function|const|let|class) +[A-Za-z_$][\w$]*/gm) || []).map(x => x.split(/\s+/)[1]))];
const shapeNames = topNames(SRC('shapes.js'));
const S = vm.runInContext('(function(){"use strict";\n' + ['core.js', 'neat.js', 'shapes.js'].map(SRC).join('\n').replace(/'use strict';\n/g, '') +
  '\nreturn {' + shapeNames.concat(['sbox']).join(',') + '};})()', vm.createContext({}));

// a seeded random source so every run sees the same shapes
function rng(seed) {
  return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
let rand = rng(20261108);
const U = (a, b) => a + (b - a) * rand();
const G = () => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
const pick = a => a[Math.floor(rand() * a.length)];

// ------------------------------------------------------------------ 1. API and names
section('1. API and names');
for (const f of ['shapeFromDrag', 'shapeOutline', 'shapeBounds', 'shapeHit', 'shapeDraw', 'shapeRecognize', 'shapeSnap']) ok(typeof S[f] === 'function', f);
const KINDS = [['line', 'Line'], ['arrow', 'Arrow'], ['arrow2', 'Double arrow'], ['rect', 'Rectangle'], ['square', 'Square'], ['ellipse', 'Ellipse'],
  ['circle', 'Circle'], ['triangle', 'Triangle'], ['rtriangle', 'Right triangle'], ['numberline', 'Number line'], ['plane', 'Coordinate plane']];
ok(JSON.stringify(S.SHAPE_KINDS.map(k => [k.kind, k.label])) === JSON.stringify(KINDS), 'SHAPE_KINDS lists the kinds and labels of the brief');
ok(shapeNames.every(n => /^(shape|SHAPE_)/.test(n)), 'every top-level name is prefixed shape / SHAPE_: ' + shapeNames.filter(n => !/^(shape|SHAPE_)/.test(n)));
const others = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js') && f !== 'shapes.js');
const clash = shapeNames.filter(n => others.some(f => new RegExp('^(?:function|const|let|var|class)\\s+' + n.replace('$', '\\$') + '\\b', 'm').test(SRC(f))));
ok(!clash.length, 'no top-level name clashes with another src/ file: ' + clash);
ok(!/^\s*(import|export)\b/m.test(SRC('shapes.js')), 'no import / export');

// ------------------------------------------------------------------ 2. a drag with the shape tool
section('2. shapeFromDrag');
const outKind = k => k === 'square' ? 'rect' : k === 'circle' ? 'ellipse' : k;
const NLDEF = { min: -10, max: 10, step: 1, labels: true, frac: false }, PLDEF = { xmin: -10, xmax: 10, ymin: -10, ymax: 10, step: 1, labels: true, grid: true };
for (const [kind] of KINDS) {
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const a = [400.5, 300.25], b = [a[0] + sx * 150, a[1] + sy * 90], r = S.shapeFromDrag(kind, a, b, {}), tag = kind + ' ' + (sx > 0 ? 'right' : 'left') + (sy > 0 ? '-down' : '-up');
    ok(r && r.shape === outKind(kind) && r.pts.length === 2, tag + ': shape and 2 points');
    ok(r.pts[0][0] === a[0] && r.pts[0][1] === a[1], tag + ': starts where the drag started');
    const [p, q] = r.pts, w = q[0] - p[0], h = q[1] - p[1];
    if (kind === 'numberline') ok(q[0] === b[0] && q[1] === a[1], tag + ': horizontal, to the finger');
    else if (kind === 'square' || kind === 'circle' || kind === 'plane') ok(near(Math.abs(w), 150) && near(Math.abs(h), 150) && Math.sign(w) === sx && Math.sign(h) === sy, tag + ': equal sides out to the finger, the drag\'s way');
    else ok(q[0] === b[0] && q[1] === b[1], tag + ': ends where the drag ended');
    if (kind === 'numberline') ok(JSON.stringify(r.opt) === JSON.stringify(NLDEF), tag + ': number line options');
    else if (kind === 'plane') ok(JSON.stringify(r.opt) === JSON.stringify(PLDEF), tag + ': plane options');
    else ok(r.opt === undefined, tag + ': no options');
  }
}
{ // grid snapping
  const g = 20, a = [13, 27], b = [151, 98], onGrid = p => near(p[0] / g, Math.round(p[0] / g), 1e-9) && near(p[1] / g, Math.round(p[1] / g), 1e-9);
  for (const [kind] of KINDS) {
    const r = S.shapeFromDrag(kind, a, b, { snap: g });
    ok(onGrid(r.pts[0]) && (kind === 'plane' || onGrid(r.pts[1])), kind + ' snapped to the grid: ' + JSON.stringify(r.pts));
    const w = Math.abs(r.pts[1][0] - r.pts[0][0]), h = Math.abs(r.pts[1][1] - r.pts[0][1]);
    if (kind === 'square' || kind === 'circle' || kind === 'plane') ok(w === h && w === 140, kind + ' snapped: equal sides on the grid');
    if (kind === 'rect') ok(w === 140 && h === 80, 'rect snapped size');
  }
  const flat = S.shapeFromDrag('rect', [0, 0], [65, 4], { snap: 20 });
  ok(flat.pts[1][1] - flat.pts[0][1] === 20, 'a snapped rect keeps at least one cell of height');
  const r = S.shapeFromDrag('plane', [0, 0], [100, 30], { opt: { xmin: 0, xmax: 20, ymin: 0, ymax: 10 } });
  ok(near(r.pts[1][0] - r.pts[0][0], 2 * (r.pts[1][1] - r.pts[0][1])) && r.opt.xmax === 20 && r.opt.step === 1, 'a plane keeps the aspect of its ranges, options over the defaults');
}
{ // angle snapping
  const deg = d => d * Math.PI / 180, end = (d, L) => [100 + L * Math.cos(deg(d)), 100 + L * Math.sin(deg(d))];
  const ang = r => Math.atan2(r.pts[1][1] - r.pts[0][1], r.pts[1][0] - r.pts[0][0]) * 180 / Math.PI, lenOf = r => Math.hypot(r.pts[1][0] - r.pts[0][0], r.pts[1][1] - r.pts[0][1]);
  for (const [d, want] of [[13.7, 15], [2, 0], [-3.5, 0], [88, 90], [133, 135], [-176.5, 180], [20, 20], [52.5, 52.5], [-61, -60]]) {
    const r = S.shapeFromDrag('line', [100, 100], end(d, 200), { angle: true });
    ok(near(((ang(r) - want + 540) % 360) - 180, 0, 1e-6) && near(lenOf(r), 200, 1e-6), 'angle ' + d + '° -> ' + want + '°');
  }
  const h = S.shapeFromDrag('arrow', [100, 100], end(2.5, 300), { angle: true });
  ok(h.pts[1][1] === 100, 'a snapped level arrow is exactly level');
  const v = S.shapeFromDrag('arrow2', [100, 100], end(-91, 300), { angle: true });
  ok(v.pts[1][0] === 100, 'a snapped upright double arrow is exactly upright');
  const g45 = S.shapeFromDrag('line', [100, 100], end(46, 150), { angle: true, snap: 20 });
  ok(g45.pts[1][0] % 20 === 0 && g45.pts[1][1] % 20 === 0 && near(g45.pts[1][0] - 100, g45.pts[1][1] - 100), 'angle and grid: 45° lands on a grid point ' + JSON.stringify(g45.pts));
  const off = S.shapeFromDrag('line', [100, 100], end(13.7, 200), {});
  ok(near(ang(off), 13.7, 1e-9), 'no angle snap unless asked');
}
{ // taps
  for (const [kind] of KINDS) {
    const r = S.shapeFromDrag(kind, [500, 400], [501.5, 401], {}), b = S.sbox(r.pts), w = b[2] - b[0], h = b[3] - b[1];
    const flat = ['line', 'arrow', 'arrow2', 'numberline'].includes(kind);
    ok(w >= 100 && (flat ? h === 0 : h >= 100), kind + ' tap: a sensible default size ' + w + 'x' + h);
    ok(near((b[0] + b[2]) / 2, 500, 1e-9) && near((b[1] + b[3]) / 2, 400, 1e-9), kind + ' tap: centred on it');
    if (kind === 'square' || kind === 'circle' || kind === 'plane') ok(w === h, kind + ' tap: equal sides');
    const z2 = S.shapeFromDrag(kind, [500, 400], [500.5, 400], { z: 2 }), b2 = S.sbox(z2.pts);
    ok(near(b2[2] - b2[0], w / 2, 1e-9), kind + ' tap at zoom 2: half the world size');
    const gs = S.shapeFromDrag(kind, [503, 397], [504, 398], { snap: 20 }), bg = S.sbox(gs.pts);
    ok(bg.every(x => x % 20 === 0), kind + ' tap on a grid: on grid points ' + JSON.stringify(gs.pts));
  }
  const nl = S.shapeFromDrag('numberline', [100, 100], [102, 420], {});
  ok(nl.pts[1][1] === 100 && near(nl.pts[1][0] - 100, Math.hypot(2, 320)), 'number line from an upright drag: level, as long as the drag');
  const nd = S.shapeFromDrag('numberline', [100, 100], [250, 400], {});
  ok(nd.pts[1][1] === 100 && nd.pts[1][0] === 250, 'number line from a steep drag: level, its end under the finger');
}
{ // shapeSnap
  ok(JSON.stringify(S.shapeSnap([13, 27], 20)) === '[20,20]' && JSON.stringify(S.shapeSnap([-9, -11], 20)) === '[0,-20]', 'shapeSnap rounds to the grid');
  const p = [13.25, -7.5, 1234, 0.5], q = S.shapeSnap(p, 0);
  ok(q !== p && JSON.stringify(q) === JSON.stringify(p), 'shapeSnap with 0: unchanged (a copy, extra fields kept)');
  ok(JSON.stringify(S.shapeSnap(p, 10)) === '[10,-10,1234,0.5]', 'shapeSnap keeps extra fields');
  ok(!Object.is(S.shapeSnap([-2, -3], 20)[0], -0), 'no negative zero');
  ok(near(S.shapeSnap([0.31, 0.29], 0.1)[0], 0.3, 0) && near(S.shapeSnap([0.31, 0.29], 0.1)[1], 0.3, 0), 'no float noise');
}

// ------------------------------------------------------------------ 3. outline, bounds, hit for every kind
section('3. outline, bounds, hit');
const base = {
  line: [[100, 100], [420, 260]], arrow: [[100, 100], [420, 260]], arrow2: [[420, 100], [100, 260]],
  rect: [[100, 100], [420, 300]], ellipse: [[420, 300], [100, 100]], triangle: [[100, 100], [420, 300]], rtriangle: [[100, 100], [420, 300]],
  poly: [[100, 120], [380, 90], [430, 300], [160, 280], [120, 210]], numberline: [[100, 200], [580, 200]], plane: [[100, 100], [420, 420]]
};
const optOf = { numberline: Object.assign({}, NLDEF), plane: Object.assign({}, PLDEF) };
const elOf = (shape, extra) => Object.assign({ tool: 'shape', shape, size: 4, color: null, fill: null, dash: false, opt: optOf[shape] }, extra);
const inBox = (p, b, e) => p[0] >= b[0] - (e || 1e-9) && p[0] <= b[2] + (e || 1e-9) && p[1] >= b[1] - (e || 1e-9) && p[1] <= b[3] + (e || 1e-9);
const closedKinds = ['rect', 'ellipse', 'triangle', 'rtriangle', 'poly'];
// the point a distance d out from the middle of an outline segment (outward from the shape's centre)
function outFrom(P, i, d, c) {
  const a = P[i], b = P[i + 1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
  if ((m[0] - c[0]) * nx + (m[1] - c[1]) * ny < 0) { nx = -nx; ny = -ny; }
  return [m[0] + nx * d, m[1] + ny * d];
}
const transforms = [['as drawn', 1, 1], ['x2', 2, 2], ['x0.5', 0.5, 0.5], ['2 by 0.5', 2, 0.5], ['0.7 by 1.6', 0.7, 1.6]];
for (const kind of Object.keys(base)) {
  for (const [tname, kx, ky] of transforms) {
    // moving / scaling maps every point (x, y) -> (ax + (x - ox) kx, ay + (y - oy) ky)
    const pts = base[kind].map(p => [37 + (p[0] - 100) * kx, -55 + (p[1] - 100) * ky]), tag = kind + ' ' + tname;
    const E = elOf(kind), b = S.shapeBounds(E, pts), lines = S.shapeOutline(E, pts);
    ok(b.every(Number.isFinite) && b[2] > b[0] && b[3] >= b[1], tag + ': bounds ' + b.map(x => x.toFixed(1)));
    ok(lines.length >= 1 && lines.every(l => l.length >= 2 && l.every(p => p.every(Number.isFinite))), tag + ': outline polylines');
    ok(lines.every(l => l.every(p => inBox(p, b, 1e-6))), tag + ': outline inside bounds');
    ok(pts.every(p => inBox(p, b, 1e-6)), tag + ': points inside bounds');
    if (kind === 'numberline') ok(pts[0][1] === pts[1][1], tag + ': stays level');
    const c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    ok(!S.shapeHit(E, pts, [b[2] + 40, b[3] + 40], 6) && !S.shapeHit(E, pts, [b[0] - 30, c[1]], 6), tag + ': far points miss');
    if (kind === 'numberline' || kind === 'plane') {
      ok(S.shapeHit(E, pts, c, 0) && S.shapeHit(E, pts, [b[0] + 1, b[1] + 1], 0) && S.shapeHit(E, pts, [b[2] + 3, c[1]], 4), tag + ': anywhere in its box hits');
      ok(!S.shapeHit(E, pts, [b[2] + 6, c[1]], 4), tag + ': just outside its box misses');
      continue;
    }
    const P = lines[0], ctr = kind.startsWith('line') || kind.startsWith('arrow') ? [c[0] + 1000, c[1] - 1000] : S.sbox(P).reduce((s, v, i) => (s[i % 2] += v / 2, s), [0, 0]);
    for (const i of [0, Math.floor((P.length - 2) / 2), P.length - 2]) {
      ok(S.shapeHit(E, pts, outFrom(P, i, 0, ctr), 0), tag + ': on the outline hits (segment ' + i + ')');
      ok(S.shapeHit(E, pts, outFrom(P, i, 2 + 5 - 0.3, ctr), 5), tag + ': within r + half the width hits (segment ' + i + ')');
      ok(!S.shapeHit(E, pts, outFrom(P, i, 2 + 5 + 1.5, ctr), 5), tag + ': beyond r + half the width misses (segment ' + i + ')');
    }
    if (closedKinds.includes(kind)) {
      const inside = kind === 'triangle' || kind === 'rtriangle' ? [(pts[0][0] * 2 + pts[1][0] * 3) / 5 + (kind === 'rtriangle' ? -(pts[1][0] - pts[0][0]) * 0.2 : 0), (pts[0][1] + pts[1][1] * 3) / 4]
        : kind === 'poly' ? [pts[0][0] + (pts[2][0] - pts[0][0]) * 0.45, pts[0][1] + (pts[2][1] - pts[0][1]) * 0.5] : c;
      ok(!S.shapeHit(E, pts, inside, 3), tag + ': inside an unfilled outline misses');
      ok(S.shapeHit(elOf(kind, { fill: 'rgba(201,162,39,.25)' }), pts, inside, 3), tag + ': inside a filled one hits');
      ok(!S.shapeHit(elOf(kind, { fill: 'none' }), pts, inside, 3), tag + ': fill "none" is not filled');
    }
    if (kind === 'arrow' || kind === 'arrow2') { // a point inside the head, off the shaft, hits
      const A = pts[0], B = pts[1], L = Math.hypot(B[0] - A[0], B[1] - A[1]), u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], n = [-u[1], u[0]];
      const hl = Math.min(Math.max(10, 16), L / 3), q = [B[0] - u[0] * hl * 0.8 + n[0] * hl * 0.25, B[1] - u[1] * hl * 0.8 + n[1] * hl * 0.25];
      ok(S.shapeHit(E, pts, q, 0), tag + ': inside the arrowhead hits');
    }
  }
  // bounds follow a uniform scale (less the parts sized from E.size)
  if (kind !== 'numberline' && kind !== 'plane') {
    const m = 2 + (kind.startsWith('arrow') ? 20 : 0), b1 = S.shapeBounds(elOf(kind), base[kind]), b2 = S.shapeBounds(elOf(kind), base[kind].map(p => [p[0] * 2, p[1] * 2]));
    ok(near(b2[2] - b2[0], 2 * (b1[2] - b1[0]) - 2 * 2, m * 2) && near(b2[3] - b2[1], 2 * (b1[3] - b1[1]) - 2 * 2, m * 2), kind + ': scaled x2, bounds twice as big');
  }
}
{ // the stroke width and dashes / fill do not change the geometry tests' answers unexpectedly
  const E = elOf('rect', { size: 12 }), pts = base.rect, b = S.shapeBounds(E, pts);
  ok(near(b[0], 94) && near(b[3], 306), 'bounds grow by half the width');
  ok(S.shapeHit(E, pts, [100, 200 + 0], 0) && S.shapeHit(E, pts, [94.5, 200], 0) && !S.shapeHit(E, pts, [93, 200], 0), 'hits follow the width');
  const ell = S.shapeOutline(elOf('ellipse'), base.ellipse)[0];
  ok(ell.length === 49 && near(ell[0][0], ell[48][0]) && near(ell[0][1], ell[48][1]), 'an ellipse outline: 48 segments, closed');
  ok(closedKinds.filter(k => k !== 'ellipse').every(k => { const o = S.shapeOutline(elOf(k), base[k])[0]; return near(o[0][0], o[o.length - 1][0]) && near(o[0][1], o[o.length - 1][1]); }), 'closed outlines end where they start');
  const tri = S.shapeOutline(elOf('triangle'), [[100, 100], [300, 300]])[0];
  ok(near(tri[0][0], 200) && tri[0][1] === 100 && tri.slice(1, 3).every(p => p[1] === 300), 'triangle: apex at (mid x, start y), base along end y');
  const up = S.shapeOutline(elOf('triangle'), [[100, 300], [300, 100]])[0];
  ok(up[0][1] === 300 && up.slice(1, 3).every(p => p[1] === 100), 'triangle dragged up: apex down');
  const rt = S.shapeOutline(elOf('rtriangle'), [[100, 100], [300, 300]])[0];
  ok(JSON.stringify(rt.slice(0, 3)) === '[[100,100],[100,300],[300,300]]', 'right triangle: the right angle at (start x, end y)');
  const ar = S.shapeBounds(elOf('arrow', { size: 2 }), [[0, 0], [300, 0]]);
  ok(ar[2] === 301 && ar[1] < -3.5 && ar[3] > 3.5, 'arrow bounds include the head, which ends at the tip');
  const sh = S.shapeHead([30, 0], [0, 0], 8, 30);
  ok(near(sh.L, 10) && near(S.shapeHead([300, 0], [0, 0], 8, 300).L, 32) && near(S.shapeHead([300, 0], [0, 0], 1, 300).L, 10), 'arrowheads: max(10, 4 size) long, never over a third of the line');
  const tiny = S.shapeHead([12, 0], [0, 0], 3, 12);
  ok(near(tiny.L, 4) && Math.abs(tiny.poly[1][1]) >= 0.9 * 3 - 1e-9, 'a very short arrow still has a head wider than its line');
}

// ------------------------------------------------------------------ 4. number line and plane layout
section('4. number line and plane labels');
// two labels' boxes overlap, or come closer than m
const rectsOverlap = (a, b, m) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + (m || 0) && Math.abs(a.y - b.y) < a.hh + b.hh + (m || 0);
const textOf = L => L.s != null ? L.s : (L.neg ? '−' : '') + (L.whole ? L.whole + ' ' : '') + L.num + '/' + L.den;
{
  const Ly = S.shapeNlLayout(elOf('numberline', { size: 3 }), [[100, 300], [900, 300]], 1);
  ok(Ly.ticks.length === 21 && Ly.labels.length === 21, 'default number line, 800 long: 21 ticks, every one labelled');
  ok(Ly.labels[0].L.s === '−10' && Ly.labels[10].L.s === '0' && Ly.labels[20].L.s === '10', 'labels -10 .. 10 with a real minus sign');
  ok(Ly.labels.every((l, i) => near(l.x, 100 + Ly.ticks[i].t, 1e-9)), 'labels centred under their ticks');
  ok(Ly.ticks[0].t > Ly.heads[0].L && Ly.ticks[20].t < 800 - Ly.heads[1].L, 'ticks clear of the arrowheads');
  const sp = Ly.ticks.map((t, i) => i ? t.t - Ly.ticks[i - 1].t : 0).slice(1);
  ok(sp.every(d => near(d, sp[0], 1e-6)), 'ticks evenly spread');
  const short = S.shapeNlLayout(elOf('numberline', { size: 3 }), [[0, 0], [300, 0]], 1);
  ok(short.labels.length < 21 && short.labels.length >= 5 && short.labels.some(l => l.L.s === '0'), 'a short number line labels fewer ticks, 0 kept: ' + short.labels.map(l => textOf(l.L)).join(' '));
  const zoomOut = S.shapeNlLayout(elOf('numberline', { size: 3 }), [[100, 300], [900, 300]], 0.3);
  ok(zoomOut.fs * 0.3 >= 12 - 1e-9 && zoomOut.labels.length < 21, 'zoomed out, labels stay 12 screen px and thin out: ' + zoomOut.labels.length);
  const fr = S.shapeNlLayout(elOf('numberline', { size: 3, opt: { min: 0, max: 1, step: 0.25, labels: true, frac: true } }), [[0, 0], [600, 0]], 1);
  ok(fr.labels.map(l => textOf(l.L)).join(' ') === '0 1/4 1/2 3/4 1', 'fractions: 0 1/4 1/2 3/4 1 (got ' + fr.labels.map(l => textOf(l.L)).join(' ') + ')');
  const mx = S.shapeNlLayout(elOf('numberline', { size: 3, opt: { min: -2, max: 2, step: 0.5, frac: true } }), [[0, 0], [900, 0]], 1);
  ok(mx.labels.map(l => textOf(l.L)).join(' ') === '−2 −1 1/2 −1 −1/2 0 1/2 1 1 1/2 2', 'mixed numbers: ' + mx.labels.map(l => textOf(l.L)).join(' '));
  ok(mx.ticks.filter(t => t.major).length === 5, 'whole numbers get the longer ticks when the step is under 1');
  const dec = S.shapeNlLayout(elOf('numberline', { size: 3, opt: { min: 0, max: 1, step: 0.25 } }), [[0, 0], [600, 0]], 1);
  ok(dec.labels.map(l => l.L.s).join(' ') === '0 0.25 0.5 0.75 1', 'decimals without frac: ' + dec.labels.map(l => l.L.s).join(' '));
  const thirds = S.shapeNlLayout(elOf('numberline', { size: 3, opt: { min: 0, max: 2, step: 1 / 3, frac: true } }), [[0, 0], [900, 0]], 1);
  ok(thirds.labels.map(l => textOf(l.L)).join(' ') === '0 1/3 2/3 1 1 1/3 1 2/3 2', 'thirds: ' + thirds.labels.map(l => textOf(l.L)).join(' '));
  let clean = true, small12 = true;
  for (const len of [120, 200, 300, 480, 800, 1600]) for (const z of [0.25, 0.5, 1, 3]) for (const o of [NLDEF, { min: 0, max: 1, step: 0.25, frac: true }, { min: -3, max: 3, step: 0.5, frac: true }, { min: 0, max: 100, step: 5 }, { min: -1, max: 1, step: 0.1 }]) for (const size of [2, 3, 8]) {
    const L = S.shapeNlLayout(elOf('numberline', { size, opt: o }), [[0, 0], [len, 0]], z);
    for (let i = 0; i + 1 < L.labels.length; i++) if (rectsOverlap(L.labels[i], L.labels[i + 1], 0.4 * L.fs - 1e-9)) clean = false;
    if (L.labels.some(l => l.y - l.hh < L.thM)) clean = false;
    if (L.labels.length && (L.fs * z < 12 - 1e-9 || L.ff * z < 12 - 1e-9)) small12 = false;
  }
  ok(clean, 'number line labels keep 0.4 em clear of each other and clear of the ticks (6 lengths x 4 zooms x 5 ranges x 3 widths)');
  ok(small12, 'number line labels (and fraction digits) are never under 12 screen px');
  const pl = S.shapePlaneLayout(elOf('plane', { size: 3 }), [[0, 0], [640, 640]], 1);
  ok(pl.labels.length >= 40 && pl.labels.some(l => l.L.s === '0'), 'a 640 plane -10..10 labels every step, one 0 at the origin: ' + pl.labels.length);
  const small = S.shapePlaneLayout(elOf('plane', { size: 3 }), [[0, 0], [320, 320]], 1);
  ok(small.labels.length < pl.labels.length && small.labels.every(l => +l.L.s.replace('−', '-') % 2 === 0), 'a 320 plane -10..10 labels every 2: ' + small.labels.map(l => l.L.s).join(' '));
  const q1 = S.shapePlaneLayout(elOf('plane', { size: 3, opt: { xmin: 0, xmax: 10, ymin: 0, ymax: 10 } }), [[0, 0], [400, 400]], 1);
  ok(q1.AX === 0 && q1.AY === 400 && q1.heads.length === 2, 'first quadrant: axes on the left and bottom edges, arrows at the positive ends only');
  let pclean = true, worst = '', oclean = true, n12 = true;
  for (const sz of [160, 240, 320, 480, 800]) for (const z of [0.5, 1, 3]) for (const o of [PLDEF, { xmin: 0, xmax: 10, ymin: 0, ymax: 10 }, { xmin: -5, xmax: 5, ymin: -5, ymax: 5 }, { xmin: 0, xmax: 1, ymin: 0, ymax: 1, step: 0.25 }, { xmin: -3, xmax: 7, ymin: -2, ymax: 4 }]) {
    const L = S.shapePlaneLayout(elOf('plane', { size: 3, opt: o }), [[0, 0], [sz, sz * (o.ymax - o.ymin) / (o.xmax - o.xmin)]], z);
    const zero = L.labels.find(l => l.L.s === '0' && !('v' in l));
    for (let i = 0; i < L.labels.length; i++) for (let j = i + 1; j < L.labels.length; j++) {
      if (rectsOverlap(L.labels[i], L.labels[j], 0.4 * L.fs - 1e-9)) { pclean = false; worst = sz + ' ' + z + ' ' + JSON.stringify(o); }
    }
    if (zero && L.labels.some(l => l !== zero && rectsOverlap(l, zero, 0.6 * L.fs - 1e-9))) oclean = false;
    if (L.labels.length && L.fs * z < 12 - 1e-9) n12 = false;
  }
  ok(pclean, 'plane labels keep 0.4 em clear of each other (5 sizes x 3 zooms x 5 ranges) ' + worst);
  ok(oclean, 'the origin\'s 0 keeps 0.6 em clear of every other label (so "-1 0" never reads as -10)');
  ok(n12, 'plane labels are never under 12 screen px');
  const pd = S.shapeOutline(elOf('plane'), base.plane), pbb = S.shapeBounds(elOf('plane'), base.plane);
  ok(pd.length === 2 && JSON.stringify(S.sbox(pd[1])) === JSON.stringify(pbb), 'a plane\'s outline: its grid box and the box of everything it draws');
  const nb = S.shapeBounds(elOf('numberline', { size: 3 }), [[100, 300], [900, 300]]);
  ok(nb[3] > 300 + Ly.thM + 10 && nb[1] < 300 - Ly.thM + 1e-9 && nb[0] < 100 && nb[2] > 900, 'number line bounds include ticks and labels ' + nb.map(x => x.toFixed(1)));
  const pb = S.shapeBounds(elOf('plane', { size: 3, opt: { xmin: 0, xmax: 10, ymin: 0, ymax: 10 } }), [[0, 0], [400, 400]]);
  ok(pb[3] > 410 && pb[0] < -10 && pb[1] < -12 && pb[2] > 420, 'first-quadrant plane bounds include the labels below and left, axis arrows and names ' + pb.map(x => x.toFixed(1)));
}

// ------------------------------------------------------------------ 5. drawing never throws or feeds the canvas NaN
section('5. drawing (a recording context)');
function recorder() {
  const calls = [], bad = [];
  const rec = name => (...args) => { calls.push(name); if (args.some(a => typeof a === 'number' && !Number.isFinite(a))) bad.push(name + JSON.stringify(args)); };
  const ctx = { canvas: { width: 1000, height: 1000 }, globalAlpha: 1, setLineDash: a => { if (a.some(x => !(x >= 0) || !Number.isFinite(x))) bad.push('dash ' + a); calls.push('setLineDash'); } };
  for (const m of ['save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'ellipse', 'rect', 'clip', 'fillRect', 'fillText', 'strokeText']) ctx[m] = rec(m);
  return { ctx, calls, bad };
}
{
  let threw = 0, nan = 0, n = 0;
  const shapes = Object.keys(base);
  const odd = [[[0, 0], [0, 0]], [[5, 5], [5.0001, 5]], [[1e6, 1e6], [1e6 + 3, 1e6 + 900]], [[0, 0]], [[-50, 20], [300, -400]]];
  const opts = { numberline: [NLDEF, { min: 5, max: 5 }, { min: 10, max: -10, step: -1 }, { step: 0 }, { min: 0, max: 1e6, step: 1 }, { min: NaN, max: 'x', step: 0.37, frac: true }, { min: -1, max: 1, step: 1 / 7, frac: true }],
    plane: [PLDEF, { xmin: 0, xmax: 0 }, { step: 0 }, { xmin: -1e6, xmax: 1e6, step: 1 }, { grid: false }, { labels: false }, { xmin: 0, xmax: 1, ymin: 0, ymax: 1, step: 0.25, frac: true }] };
  for (const kind of shapes) for (const pts of [base[kind]].concat(odd)) for (const opt of opts[kind] || [undefined]) for (const extra of [{}, { dash: true }, { fill: 'rgba(201,162,39,.25)' }, { size: 0.5 }, { size: 40, dash: true }, { size: null, color: 'red' }]) {
    const r = recorder(), E = elOf(kind, Object.assign({ opt }, extra));
    n++;
    try { for (const z of [0.1, 1, 8]) S.shapeDraw(r.ctx, E, pts, { ink: '#1b2a4a', paper: '#fbf8ef', z, font: '"DM Sans", system-ui, sans-serif' }); S.shapeBounds(E, pts); S.shapeOutline(E, pts); S.shapeHit(E, pts, [10, 10], 4); } catch (e) { threw++; if (threw < 4) console.log('   ', kind, JSON.stringify(pts), JSON.stringify(opt), e.message); }
    if (r.bad.length) { nan++; if (nan < 4) console.log('   ', kind, JSON.stringify(pts), JSON.stringify(opt), r.bad.slice(0, 2)); }
    if (r.calls.filter(c => c === 'save').length !== r.calls.filter(c => c === 'restore').length) nan++;
  }
  ok(!threw, 'shapeDraw / bounds / outline / hit never throw (' + n + ' cases, 3 zooms each): ' + threw);
  ok(!nan, 'never a NaN or infinity handed to the canvas, save and restore paired: ' + nan);
  const r = recorder();
  S.shapeDraw(r.ctx, elOf('plane'), base.plane, { ink: '#1b2a4a', paper: '#fbf8ef', z: 1 });
  ok(r.calls.filter(c => c === 'stroke').length <= 4, 'a plane strokes its grid, axes and ticks in a few paths: ' + r.calls.filter(c => c === 'stroke').length);
}

// ------------------------------------------------------------------ 6. recognition: synthetic hand-drawn shapes
section('6. draw-and-hold recognition: synthetic hand-drawn shapes');
// A hand moving along an ideal path (a dense polyline): slow at the start and end and into corners, uneven, a
// low-frequency wobble across the path, sampling jitter, and the pen held still at the end.
function hand(ideal, o) {
  const cum = [0];
  for (let i = 1; i < ideal.length; i++) cum.push(cum[i - 1] + Math.hypot(ideal[i][0] - ideal[i - 1][0], ideal[i][1] - ideal[i - 1][1]));
  const L = cum[cum.length - 1], waves = [1, 2, 3].map(f => [U(0.4, 1.6) * f * (o.closed ? 1.3 : 0.6), U(0, 2 * Math.PI), G() / f]);
  const ampl = o.wob * L / (waves.reduce((s, w) => s + Math.abs(w[2]), 0) || 1);
  let j = 0;
  const at = s => {
    while (j > 0 && cum[j] > s) j--;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const a = ideal[j], b = ideal[j + 1], d = cum[j + 1] - cum[j] || 1, t = Math.min(1, Math.max(0, (s - cum[j]) / d));
    const nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d, w = ampl * waves.reduce((acc, [f, ph, A]) => acc + A * Math.sin(2 * Math.PI * f * s / L + ph), 0);
    return [a[0] + (b[0] - a[0]) * t + nx * w, a[1] + (b[1] - a[1]) * t + ny * w];
  };
  // top speed in world units a sample: 300-1500 px/s at 60-240 Hz, and never fewer than ~30 samples for the stroke
  const out = [], vmax = Math.min(U(2, 24), L / U(30, 90)), jit = o.jit;
  for (let s = 0; s < L;) {
    const p = at(s);
    out.push([p[0] + G() * jit, p[1] + G() * jit, out.length * 8]);
    const f = s / L;
    let v = 0.2 + 0.8 * Math.pow(Math.sin(Math.PI * f), 0.5);
    for (const c of o.corners || []) { const d = Math.abs(f - c); if (d < 0.05) v *= 0.3 + 0.7 * d / 0.05; }
    s += Math.max(0.25, vmax * v * U(0.6, 1.4));
  }
  const e = at(L);
  out.push([e[0], e[1], out.length * 8]);
  for (let k = 0, n = Math.floor(U(6, 40)); k < n; k++) out.push([e[0] + G() * 0.7, e[1] + G() * 0.7, out.length * 8]);
  return out;
}
const densify = (P, step) => {
  const out = [P[0]];
  for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  return out;
};
const rot = (p, c, a) => [c[0] + (p[0] - c[0]) * Math.cos(a) - (p[1] - c[1]) * Math.sin(a), c[1] + (p[0] - c[0]) * Math.sin(a) + (p[1] - c[1]) * Math.cos(a)];
function synthLine() {
  const L = U(40, 700), th = U(-Math.PI, Math.PI), c = [U(0, 1500), U(0, 1000)];
  const A = [c[0] - L / 2 * Math.cos(th), c[1] - L / 2 * Math.sin(th)], B = [c[0] + L / 2 * Math.cos(th), c[1] + L / 2 * Math.sin(th)];
  const bow = U(-0.015, 0.015) * L, P = [];
  for (let i = 0; i <= 60; i++) { const t = i / 60, s = 4 * t * (1 - t) * bow; P.push([A[0] + (B[0] - A[0]) * t - Math.sin(th) * s, A[1] + (B[1] - A[1]) * t + Math.cos(th) * s]); }
  if (rand() < 0.35) { const h = U(0.015, 0.035) * L, a = th + pick([1, -1]) * U(0.6, 1.8); P.unshift([A[0] - h * Math.cos(a), A[1] - h * Math.sin(a)]); }
  return { want: 'line', A, B, L, stroke: hand(densify(P, 2), { wob: U(0.001, 0.005), jit: U(0.15, 0.6) }) };
}
function synthEllipse(round) {
  const rx = U(25, 300), ry = round ? rx * U(0.95, 1.05) : rx / U(1.3, 2.4) * (rand() < 0.5 ? 1 : 1), tilt = U(-0.08, 0.08), c = [U(300, 1200), U(300, 800)];
  const [ax, ay] = rand() < 0.5 || round ? [rx, ry] : [ry, rx];
  const th0 = U(0, 2 * Math.PI), dir = pick([1, -1]), mode = rand(), turns = mode < 0.45 ? U(1.02, 1.18) : mode < 0.8 ? U(0.93, 0.99) : U(0.99, 1.02);
  const e1 = U(0, 0.025), e2 = U(0, 0.02), p1 = U(0, 6.3), p2 = U(0, 6.3), drift = U(-0.04, 0.04), P = [];
  const n = 240;
  for (let i = 0; i <= n * turns; i++) {
    const t = th0 + dir * 2 * Math.PI * i / n, k = 1 + e1 * Math.sin(t + p1) + e2 * Math.sin(2 * t + p2) + drift * i / n;
    P.push(rot([c[0] + ax * k * Math.cos(t), c[1] + ay * k * Math.sin(t)], c, tilt));
  }
  return { want: 'ellipse', round, c, ax, ay, stroke: hand(P, { wob: U(0, 0.002), jit: U(0.15, 0.5), closed: true }) };
}
// a hand-drawn polygon: starting at a corner (or along the first side), slightly rounded corners and bowed sides,
// closing with an overshoot along the first side, past the corner, or a small gap
function synthPoly(V, want) {
  const K = V.length, sides = V.map((p, i) => Math.hypot(V[(i + 1) % K][0] - p[0], V[(i + 1) % K][1] - p[1])), per = sides.reduce((a, b) => a + b, 0);
  const S0 = Math.max(...V.map(p => p[0])) - Math.min(...V.map(p => p[0])), S1 = Math.max(...V.map(p => p[1])) - Math.min(...V.map(p => p[1])), size = Math.max(S0, S1);
  const startAt = rand() < 0.8 ? 0 : U(0.1, 0.5), rr = U(0, 0.05) * Math.min(...sides), P = [], corners = [];
  const along = (i, t) => { const a = V[i % K], b = V[(i + 1) % K]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
  let acc = 0;
  for (let i = 0; i < K; i++) {
    const L = sides[i], bow = U(-0.012, 0.012) * L, t0 = i === 0 ? startAt : 0, a = V[i], b = V[(i + 1) % K], nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    const cut = Math.min(rr / L, 0.3);
    for (let s = 0; s <= 30; s++) {
      const t = t0 + (1 - cut - t0) * s / 30, q = along(i, t), w = 4 * t * (1 - t) * bow;
      if (i === 0 || s > 0 || cut === 0) P.push([q[0] + nx * w, q[1] + ny * w]);
    }
    // a rounded corner into the next side
    const c = V[(i + 1) % K], d = V[(i + 2) % K], L2 = sides[(i + 1) % K], c2 = Math.min(rr / L2, 0.3);
    const p0 = along(i, 1 - cut), p1 = [c[0] + (d[0] - c[0]) * c2, c[1] + (d[1] - c[1]) * c2];
    for (let s = 1; s < 8; s++) { const t = s / 8; P.push([(1 - t) * (1 - t) * p0[0] + 2 * t * (1 - t) * c[0] + t * t * p1[0], (1 - t) * (1 - t) * p0[1] + 2 * t * (1 - t) * c[1] + t * t * p1[1]]); }
    acc += L; corners.push(acc / per);
  }
  const end = rand();
  if (startAt > 0) { for (let s = 1; s <= 10; s++) P.push(along(0, startAt * s / 10)); }
  if (end < 0.4) { const f = U(0.02, 0.18); for (let s = 1; s <= 10; s++) P.push(along(0, startAt + f * s / 10)); }        // runs on along the first side
  else if (end < 0.7 && startAt === 0) { const a = V[K - 1], b = V[0], L = sides[K - 1], e = U(0.02, 0.08) * size; P.push([b[0] + (b[0] - a[0]) / L * e, b[1] + (b[1] - a[1]) / L * e]); } // past the corner
  else if (end < 0.9) { const g = U(0, 0.06) * size, a = V[K - 1], b = V[0], L = sides[K - 1]; P.push([b[0] - (b[0] - a[0]) / L * g, b[1] - (b[1] - a[1]) / L * g]); P.splice(P.length - 2, 1); } // a small gap
  return { want, V, size, stroke: hand(densify(P, 2), { wob: U(0, 0.0015), jit: U(0.15, 0.5), corners: corners.slice(0, -1), closed: true }) };
}
function synthRect() {
  const w = U(40, 500), h = rand() < 0.15 ? w * U(0.97, 1.03) : U(40, 500), c = [U(300, 1200), U(300, 800)], t = U(-0.13, 0.13);
  let V = [[c[0] - w / 2, c[1] - h / 2], [c[0] + w / 2, c[1] - h / 2], [c[0] + w / 2, c[1] + h / 2], [c[0] - w / 2, c[1] + h / 2]].map(p => rot(p, c, t));
  if (rand() < 0.5) V = V.reverse();
  const k = Math.floor(U(0, 4)); V = V.slice(k).concat(V.slice(0, k));
  return Object.assign(synthPoly(V, 'rect'), { box: [c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2], w, h });
}
function synthTriangle() {
  let V;
  for (;;) {
    V = [0, 1, 2].map(() => [U(0, 400), U(0, 400)]);
    const ang = V.map((p, i) => { const a = V[(i + 2) % 3], b = V[(i + 1) % 3], u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]]; return Math.acos((u[0] * v[0] + u[1] * v[1]) / Math.hypot(...u) / Math.hypot(...v)) * 180 / Math.PI; });
    const s = Math.max(...V.map(p => p[0])) - Math.min(...V.map(p => p[0])), t = Math.max(...V.map(p => p[1])) - Math.min(...V.map(p => p[1]));
    if (Math.min(...ang) > 28 && Math.max(s, t) > 60) break;
  }
  const k = U(0.3, 1.4), o = [U(200, 900), U(200, 600)];
  return synthPoly(V.map(p => [o[0] + p[0] * k, o[1] + p[1] * k]), 'poly');
}
function synthQuad() {
  const c = [U(300, 1200), U(300, 800)], w = U(80, 450), h = U(80, 400), type = pick(['trapezoid', 'parallelogram', 'kite', 'tilted']);
  let V;
  if (type === 'trapezoid') { // slanted sides at 18° or more from upright (one of them upright: a right trapezoid)
    const a = U(0.33, 0.7) * h, b = rand() < 0.3 ? 0 : U(0.33, 0.7) * h, W = Math.max(w, 1.6 * (a + b));
    V = [[-W / 2 + a, -h / 2], [W / 2 - b, -h / 2], [W / 2, h / 2], [-W / 2, h / 2]];
  }
  else if (type === 'parallelogram') { const s = pick([1, -1]) * U(0.3, 0.6) * h; V = [[-w / 2 + s, -h / 2], [w / 2 + s, -h / 2], [w / 2 - s, h / 2], [-w / 2 - s, h / 2]]; }
  else if (type === 'kite') { const t = U(0.25, 0.42) * h; V = [[0, -h / 2], [w / 2, -h / 2 + t], [0, h / 2], [-w / 2, -h / 2 + t]]; }
  else { V = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]; }
  const ang = type === 'tilted' ? pick([1, -1]) * U(0.36, 0.78) : U(-0.25, 0.25);
  V = V.map(p => rot([c[0] + p[0], c[1] + p[1]], c, ang));
  if (rand() < 0.5) V = V.reverse();
  return Object.assign(synthPoly(V, 'poly'), { type });
}
function synthArrow() {
  const L = U(120, 600), th = U(-Math.PI, Math.PI), c = [U(300, 1200), U(300, 800)], u = [Math.cos(th), Math.sin(th)];
  const A = [c[0] - u[0] * L / 2, c[1] - u[1] * L / 2], B = [c[0] + u[0] * L / 2, c[1] + u[1] * L / 2], b = U(0.12, 0.28) * L, a = U(0.4, 0.7);
  const back = [-u[0], -u[1]], w1 = rot([B[0] + back[0] * b, B[1] + back[1] * b], B, a), w2 = rot([B[0] + back[0] * b * U(0.85, 1.15), B[1] + back[1] * b * U(0.85, 1.15)], B, -a * U(0.85, 1.15));
  const [p, q] = rand() < 0.5 ? [w1, w2] : [w2, w1];
  const P = rand() < 0.6 ? [A, B, p, B, q] : [A, B, p, q, B];
  return { want: 'arrow', A, B, L, stroke: hand(densify(P, 2), { wob: U(0, 0.002), jit: U(0.15, 0.5), corners: [0.7, 0.8, 0.9] }) };
}
function judge(s, r) {
  if (!r) return 'none';
  const k = r.shape;
  if (s.want === 'line' || s.want === 'arrow') {
    if (k !== s.want) return k;
    const e = Math.max(0.05 * s.L, 4), d = Math.min(Math.hypot(r.pts[0][0] - s.A[0], r.pts[0][1] - s.A[1]) + Math.hypot(r.pts[1][0] - s.B[0], r.pts[1][1] - s.B[1]), 1e9);
    return d <= 2 * e ? 'ok' : 'off';
  }
  if (s.want === 'ellipse') {
    if (k !== 'ellipse') return k;
    const b = r.pts, cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2, rx = Math.abs(b[1][0] - b[0][0]) / 2, ry = Math.abs(b[1][1] - b[0][1]) / 2, R = Math.max(s.ax, s.ay);
    if (Math.hypot(cx - s.c[0], cy - s.c[1]) > 0.08 * R || Math.abs(rx - s.ax) > 0.1 * R || Math.abs(ry - s.ay) > 0.1 * R) return 'off';
    if (s.round && !near(rx, ry, 1e-9 * R)) return 'not round';
    return 'ok';
  }
  if (s.want === 'rect') {
    if (k !== 'rect') return k + (k === 'poly' ? r.pts.length : '');
    const b = S.sbox(r.pts), e = 0.08 * Math.max(s.w, s.h);
    return b.every((v, i) => Math.abs(v - s.box[i]) <= e) ? 'ok' : 'off';
  }
  if (k !== 'poly') return k;
  if (r.pts.length !== s.V.length) return 'poly' + r.pts.length;
  // every true vertex has a found one near it
  return s.V.every(v => r.pts.some(p => Math.hypot(p[0] - v[0], p[1] - v[1]) <= 0.1 * s.size)) ? 'ok' : 'off';
}
const synth = [];
rand = rng(7);
for (let i = 0; i < 60; i++) synth.push(['line', synthLine()]);
for (let i = 0; i < 30; i++) synth.push(['circle', synthEllipse(true)]);
for (let i = 0; i < 30; i++) synth.push(['ellipse', synthEllipse(false)]);
for (let i = 0; i < 40; i++) synth.push(['rectangle', synthRect()]);
for (let i = 0; i < 40; i++) synth.push(['triangle', synthTriangle()]);
for (let i = 0; i < 40; i++) synth.push(['quadrilateral', synthQuad()]);
for (let i = 0; i < 30; i++) synth.push(['arrow', synthArrow()]);
{
  const by = {}, wrong = {};
  for (const [cls, s] of synth) {
    const v = judge(s, S.shapeRecognize(s.stroke));
    by[cls] = by[cls] || [0, 0]; by[cls][1]++;
    if (v === 'ok') by[cls][0]++; else { wrong[cls + ' -> ' + v] = (wrong[cls + ' -> ' + v] || 0) + 1; }
  }
  let a = 0, n = 0;
  for (const [cls, [g, t]] of Object.entries(by)) { console.log('   ', cls.padEnd(14), g + '/' + t, (100 * g / t).toFixed(0) + '%'); a += g; n += t; if (cls !== 'arrow') ok(g / t >= 0.9, cls + ' recognised (90 % or better): ' + g + '/' + t); }
  console.log('    overall', a + '/' + n, (100 * a / n).toFixed(1) + '%', Object.keys(wrong).length ? 'misses: ' + JSON.stringify(wrong) : '');
  ok(a / n >= 0.93, 'synthetic shapes recognised overall: ' + (100 * a / n).toFixed(1) + '%');
  // scale and resampling do not change the answer
  let same = 0, tot = 0;
  for (const [, s] of synth.slice(0, 120)) {
    const r0 = S.shapeRecognize(s.stroke), r1 = S.shapeRecognize(s.stroke.map(p => [p[0] * 0.2 + 7, p[1] * 0.2 - 3]), { z: 5 }), r2 = S.shapeRecognize(s.stroke.filter((p, i) => i % 2 === 0 || i === s.stroke.length - 1));
    tot++; if ((r0 && r0.shape) === (r1 && r1.shape) && (r0 && r0.shape) === (r2 && r2.shape)) same++;
  }
  ok(same / tot >= 0.95, 'the same answer drawn at zoom 5 (a fifth of the size in world units) and with half the points: ' + same + '/' + tot);
  const h = S.shapeRecognize(hand(densify([[100, 300], [700, 302.5]], 2), { wob: 0.001, jit: 0.3 }));
  ok(h && h.shape === 'line' && h.pts[0][1] === h.pts[1][1], 'a nearly level line is made level');
  const sq = synthPoly([[100, 100], [400, 100], [400, 395], [100, 395]], 'rect'), rs = S.shapeRecognize(sq.stroke);
  ok(rs && rs.shape === 'rect' && near(rs.pts[1][0] - rs.pts[0][0], rs.pts[1][1] - rs.pts[0][1], 1e-6), 'a nearly square rectangle is made square');
}

// ------------------------------------------------------------------ 7. recognition: real handwriting must not become shapes
section('7. draw-and-hold recognition: real handwriting symbols');
// "really that shape": a straight 1, minus, bar, slash or prime is a line, a round 0 or o an ellipse, a drawn arrow an
// arrow, a delta a triangle. Anything else counts against the false-positive rate.
const FINE = { line: ['-', '1', '|', '/', 'l', 'I', '\\prime', '\\backslash'], ellipse: ['0', 'o', 'O'], arrow: ['\\rightarrow'], poly: ['\\Delta'] };
const sources = [['test/school_synth.jsonl', path.join(ROOT, 'test', 'school_synth.jsonl')],
  ['owner\'s Board writing (training/scratch/data/board.jsonl)', path.join(ROOT, 'training', 'scratch', 'data', 'board.jsonl')],
  ['CROHME 2019 test writers (training/scratch/data/test.jsonl)', path.join(ROOT, 'training', 'scratch', 'data', 'test.jsonl')]];
rand = rng(99);
const fp = {}, fine = {}, total = {};
for (const [name, file] of sources) {
  if (!fs.existsSync(file)) { console.log('    (no ' + name + ')'); continue; }
  let n = 0, bad = 0;
  for (const line of fs.readFileSync(file, 'utf8').trim().split('\n')) {
    const r = JSON.parse(line);
    for (const sym of r.symbols || []) {
      if (sym.strokes.length !== 1) continue;
      const st = r.strokes[sym.strokes[0]], lab = sym.label;
      if (!st || st.length < 2) continue;
      // the pen held still at the end, as it would be for draw-and-hold
      const e = st[st.length - 1], held = st.concat(Array.from({ length: 20 }, () => [e[0] + G() * 0.5, e[1] + G() * 0.5]));
      const res = S.shapeRecognize(held);
      n++; total[lab] = (total[lab] || 0) + 1;
      if (!res) continue;
      if ((FINE[res.shape] || []).includes(lab)) { const k = lab + ' -> ' + res.shape; fine[k] = (fine[k] || 0) + 1; continue; }
      bad++; const k = lab + ' -> ' + res.shape; fp[k] = (fp[k] || 0) + 1;
    }
  }
  console.log('    ' + name + ': ' + n + ' single-stroke symbols, ' + bad + ' false positives (' + (100 * bad / n).toFixed(2) + '%)');
}
{
  const N = Object.values(total).reduce((a, b) => a + b, 0), B = Object.values(fp).reduce((a, b) => a + b, 0);
  const perLabel = {};
  for (const [k, v] of Object.entries(fp)) { const l = k.split(' -> ')[0]; perLabel[l] = (perLabel[l] || 0) + v; }
  console.log('    false positives by label: ' + (Object.keys(perLabel).length ? Object.entries(perLabel).sort((a, b) => b[1] - a[1]).map(([l, v]) => l + ' ' + v + '/' + total[l] + ' (' + (100 * v / total[l]).toFixed(1) + '%)').join(', ') : 'none'));
  console.log('    as what: ' + JSON.stringify(fp));
  console.log('    really that shape (not counted): ' + Object.entries(fine).map(([k, v]) => k + ' ' + v + '/' + total[k.split(' -> ')[0]] + ' (' + (100 * v / total[k.split(' -> ')[0]]).toFixed(1) + '%)').join(', '));
  // every label: how many, and how many became a shape (false positives first, then "really that shape" in brackets)
  const fineBy = {};
  for (const [k, v] of Object.entries(fine)) { const l = k.split(' -> ')[0]; fineBy[l] = (fineBy[l] || 0) + v; }
  const row = l => l + ' ' + (perLabel[l] || 0) + '/' + total[l] + (fineBy[l] ? ' [' + fineBy[l] + ']' : '');
  console.log('    per label, false positives / seen [really that shape]:');
  console.log('      digits: ' + '0123456789'.split('').filter(l => total[l]).map(row).join(', '));
  const rest = Object.keys(total).filter(l => !/^[0-9]$/.test(l)).sort((a, b) => total[b] - total[a]);
  for (let i = 0; i < rest.length; i += 12) console.log('      ' + rest.slice(i, i + 12).map(row).join(', '));
  ok(N > 2000 && B / N < 0.02, 'false positives under 2 % overall: ' + B + '/' + N + ' = ' + (100 * B / N).toFixed(2) + '%');
  const digitFp = Object.entries(perLabel).filter(([l]) => /^[2-9]$/.test(l)).reduce((a, [, v]) => a + v, 0), digitN = Object.entries(total).filter(([l]) => /^[2-9]$/.test(l)).reduce((a, [, v]) => a + v, 0);
  ok(digitFp / digitN <= 0.002, 'digits 2-9 essentially never become shapes: ' + digitFp + '/' + digitN);
  const letters = Object.entries(perLabel).filter(([l]) => /^[A-Za-z]$/.test(l) && l !== 'l' && l !== 'o' && l !== 'O' && l !== 'I').reduce((a, [, v]) => a + v, 0);
  ok(letters <= 2, 'letters (besides l, I, o, O) essentially never become shapes: ' + letters);
}

// ------------------------------------------------------------------ 8. odd input to the recogniser
section('8. odd input');
{
  let threw = 0;
  const cases = [null, undefined, [], [[0, 0]], [[0, 0], [0, 0]], [[NaN, 1], [2, NaN]], [[0, 0], [100, 0]], [[0, 0, 5], [1, 1, 6], [2, 2, 7]], 'x', [[1e9, 1e9], [1e9 + 1, 1e9 + 400], [1e9 + 300, 1e9 + 2]],
    Array.from({ length: 5000 }, (_, i) => [Math.cos(i / 800 * 2 * Math.PI) * 200, Math.sin(i / 800 * 2 * Math.PI) * 200]), [[0, 0], null, [5, 5], [10, 10], [15, 15]]];
  for (const c of cases) { try { S.shapeRecognize(c); } catch (e) { threw++; console.log('   ', JSON.stringify(c).slice(0, 60), e.message); } }
  ok(!threw, 'shapeRecognize never throws on odd input');
  const dots = S.shapeRecognize([[10, 10], [11, 10.5], [12, 11], [12.5, 11]]);
  ok(dots === null, 'a dot is not a shape');
  const two = S.shapeRecognize([[0, 0], [300, 3]]);
  ok(two && two.shape === 'line', 'two points far apart: a line');
  ok(S.shapeRecognize([[0, 0], [100, 0], [200, 0]], { min: 300 }) === null, 'o.min: smaller strokes are left alone');
  const t0 = Date.now();
  for (const [, s] of synth) S.shapeRecognize(s.stroke);
  const ms = (Date.now() - t0) / synth.length;
  console.log('    recognition: ' + ms.toFixed(2) + ' ms a stroke');
  ok(ms < 8, 'recognition is quick: ' + ms.toFixed(2) + ' ms');
}

console.log((fails ? 'FAILED ' + fails : 'all ' + passes + ' checks passed') + (fails ? ' (' + passes + ' passed)' : ''));
process.exit(fails ? 1 : 0);
