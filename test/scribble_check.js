// Scribbled out — the proof, in node (no browser). A pen or marker stroke scribbled back and forth over writing rubs it
// out (src/scribble.js); this checks it against what would make it fail a teacher at the board:
//   1. real writing, replayed stroke by stroke — every stroke of every expression checked as if it were a scribble
//      over everything written before it: none of it may rub anything out (Croix's own board writing, the school
//      problems, the CROHME test sets; FULL=1 adds the training sets);
//   2. scribbles of thirteen kinds over real writing — zig-zags across and up and down, tilted, slanted, back and forth,
//      quick (far-apart samples) and rounded, a finger on a touch frame (far apart and jittery, 1.6.5), coils, blots
//      and tangles — over one symbol, two or three, and a whole line: what is under them goes, and what they only reach
//      over at their edge stays; one symbol scribbled out is rubbed out, not left (the failure a teacher sees);
//   3. shading and drawings — a dot filled in on a number line, bubbles, fraction bars (one stroke or four, with
//      labels), fraction circles, Venn diagrams (with numbers in them), the area under a curve (ticks, a label), a
//      table's cell, a triangle, a resistor on a wire: the fill rubs out nothing;
//   4. marks over writing that are not scribble-outs — a cancel slash, an X, a strike-through, rings round an answer
//      (once, twice, three times), a box, underlines, a zig-zag underline, an arrow, a check, hatching, a star, a
//      spiral, writing over a symbol (digits, and letters that zig-zag: m, w, M, W, N, Σ…), a stroke gone over again:
//      nothing.
//   node test/scribble_check.js        (FULL=1 for every data set and every size: about 20 minutes)
'use strict';
const fs = require('fs'), path = require('path');
const Nib = require(path.join(__dirname, '..', 'dist', 'nib.js'));
const scribbleOf = Nib.scribble.of, scribbleErase = Nib.scribble.erase;
const DATA = process.env.NIB_DATA || path.join(__dirname, '..', 'training', 'scratch', 'data');
const SCHOOL = path.join(__dirname, 'school_synth.jsonl');
const QUICK = !process.env.FULL;
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
// inside a convex hull (counter-clockwise, as Nib makes it)?
function inHull(p, hull) {
  if (hull.length < 3) return false;
  for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) return false; }
  return true;
}

// ------------------------------------------------------------------ seeded randomness
let seed = 12345;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function rr(a, b) { return a + (b - a) * rnd(); }
function ri(a, b) { return Math.floor(rr(a, b + 1)); }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function gauss() { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return u - 3; }

// ------------------------------------------------------------------ data
function box(pts) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return [x0, y0, x1, y1]; }
function ubox(list) { return box([].concat(...list)); }
function unionBox(bs) { return bs.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])], [Infinity, Infinity, -Infinity, -Infinity]); }
function median(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; }
function load(name, limit) {
  const f = name.includes('/') ? name : path.join(DATA, name + '.jsonl');
  const out = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (!r.strokes || !r.strokes.length) continue;
    out.push(r);
    if (limit && out.length >= limit) break;
  }
  return out;
}
// an expression in screen px: the median symbol about `h` px tall
function toScreen(r, h) {
  const S = r.strokes.map(s => s.map(p => [+p[0], +p[1]])).filter(s => s.length);
  const syms = (r.symbols || []).filter(y => y.strokes && y.strokes.length);
  const hs = syms.length ? syms.map(y => { const b = ubox(y.strokes.map(i => S[i]).filter(Boolean)); return Math.max(b[3] - b[1], 0.5 * (b[2] - b[0])); }) : S.map(s => { const b = box(s); return Math.max(b[3] - b[1], b[2] - b[0]); });
  const k = h / Math.max(median(hs.filter(v => v > 0)), 1e-6);
  const b = ubox(S);
  const strokes = S.map(s => s.map(p => [(p[0] - b[0]) * k + 100, (p[1] - b[1]) * k + 100]));
  const group = new Array(strokes.length).fill(null);
  syms.forEach((y, gi) => y.strokes.forEach(i => { if (i < group.length) group[i] = gi; }));
  return { id: r.id, latex: r.latex || r.truth, strokes, group, syms };
}
const SETS = (QUICK ? ['board', 'test', 't13', 't12', 'stress_finger'] : ['board', 'test', 't13', 't12', 'valid', 'train', 'synth_t13', 'stress_finger', 'stress_mouse', 'stress_drift', 'stress_slope']).filter(n => fs.existsSync(path.join(DATA, n + '.jsonl')));

// ------------------------------------------------------------------ 1. real writing, replayed: nothing rubbed out
function realReplay() {
  console.log('\n== 1. real writing replayed (every stroke checked against everything written before it) ==');
  const add = [['school', SCHOOL]];
  let strokes = 0, shapes = 0, erasures = 0, exprs = 0;
  const flagged = [], bad = [];
  for (const h of QUICK ? [40] : [24, 40, 70]) {
    for (const name of SETS.concat(add.map(a => a[1]))) {
      const recs = load(name, QUICK ? 400 : 0);
      for (const r of recs) {
        const E = toScreen(r, h); exprs++;
        for (let i = 0; i < E.strokes.length; i++) {
          strokes++;
          const sc = scribbleOf(E.strokes[i], 1);
          if (!sc) continue;
          shapes++;
          if (flagged.length < 400) flagged.push({ set: path.basename(name), id: E.id, latex: E.latex, i, h, kind: sc.kind, legs: sc.legs });
          const items = E.strokes.slice(0, i).map((s, j) => ({ pts: s, group: E.group[j] }));
          const er = scribbleErase(sc, items, 1);
          if (er.erase.length) { erasures++; bad.push({ set: path.basename(name), id: E.id, latex: E.latex, i, h, erase: er.erase, why: er.why, s: E.strokes[i], under: er.erase.map(j => E.strokes[j]) }); }
        }
      }
    }
  }
  console.log(`expressions ${exprs}, strokes ${strokes}; shaped like a scribble ${shapes} (${(100 * shapes / strokes).toFixed(3)}%); would rub something out: ${erasures}`);
  const kinds = {};
  for (const f of flagged) kinds[f.latex] = (kinds[f.latex] || 0) + 1;
  console.log('  shaped like a scribble, e.g.:', flagged.slice(0, 12).map(f => `${f.set}:${f.id}#${f.i}@${f.h}px ${f.kind}${f.legs} "${String(f.latex).slice(0, 40)}"`).join('\n    '));
  for (const b of bad.slice(0, 10)) console.log('  RUBBED OUT:', b.set, b.id, '#' + b.i, '@' + b.h + 'px', JSON.stringify(b.latex), '->', b.erase, b.why);
  return { strokes, shapes, erasures };
}

// ------------------------------------------------------------------ scribble makers (screen px)
// sample a polyline at about `step` px with a little hand noise
function sample(verts, step, noise) {
  const out = [];
  for (let k = 0; k + 1 < verts.length; k++) {
    const a = verts[k], b = verts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / step));
    for (let i = 0; i < n; i++) { const t = i / n; out.push([a[0] + (b[0] - a[0]) * t + gauss() * noise, a[1] + (b[1] - a[1]) * t + gauss() * noise]); }
  }
  const e = verts[verts.length - 1]; out.push([e[0], e[1]]);
  return out;
}
// round the corners of a zig-zag (radius as a share of the legs)
function rounded(verts, rad) {
  if (!(rad > 0)) return verts;
  const out = [verts[0]];
  for (let k = 1; k + 1 < verts.length; k++) {
    const p = verts[k], a = verts[k - 1], b = verts[k + 1];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]), r = Math.min(rad, la / 3, lb / 3);
    const u = [(a[0] - p[0]) / la, (a[1] - p[1]) / la], v = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
    const s = [p[0] + u[0] * r, p[1] + u[1] * r], e = [p[0] + v[0] * r, p[1] + v[1] * r];
    for (let i = 0; i <= 4; i++) { const t = i / 4; const q0 = [s[0] + (p[0] - s[0]) * t, s[1] + (p[1] - s[1]) * t], q1 = [p[0] + (e[0] - p[0]) * t, p[1] + (e[1] - p[1]) * t]; out.push([q0[0] + (q1[0] - q0[0]) * t, q0[1] + (q1[1] - q0[1]) * t]); }
  }
  out.push(verts[verts.length - 1]);
  return out;
}
function rot(pts, c, th) { const C = Math.cos(th), S = Math.sin(th); return pts.map(p => [c[0] + (p[0] - c[0]) * C - (p[1] - c[1]) * S, c[1] + (p[0] - c[0]) * S + (p[1] - c[1]) * C]); }
// a zig-zag over box b: legs along `dir` ('h' legs left-right, 'v' legs up-down), n legs, overshoot ox / oy (px)
function zig(b, dir, n, o) {
  const [x0, y0, x1, y1] = b, W = x1 - x0, H = y1 - y0;
  const ox = o.ox, oy = o.oy, vs = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, side = k % 2;
    if (dir === 'h') vs.push([(side ? x1 + ox : x0 - ox) + gauss() * o.jt * W, y0 - oy + (H + 2 * oy) * t + gauss() * o.js * (H + 2 * oy) / n]);
    else vs.push([x0 - ox + (W + 2 * ox) * t + gauss() * o.js * (W + 2 * ox) / n, (side ? y1 + oy : y0 - oy) + gauss() * o.jt * H]);
  }
  if (o.back) {                                            // and back the way it came, between the first pass's legs
    const sp = (dir === 'h' ? H + 2 * oy : W + 2 * ox) / n;
    const r = vs.slice(0, -1).reverse().map(p => dir === 'h' ? [p[0] + gauss() * 2, p[1] - sp * rr(0.3, 0.7)] : [p[0] - sp * rr(0.3, 0.7), p[1] + gauss() * 2]);
    vs.push(...r);
  }
  if (o.shear) { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; for (const v of vs) { if (dir === 'v') v[0] += o.shear * (v[1] - cy); else v[1] += o.shear * (v[0] - cx); } }
  let pts = sample(rounded(vs, o.round * (dir === 'h' ? W : H)), o.step, o.noise);
  if (o.tilt) pts = rot(pts, [(x0 + x1) / 2, (y0 + y1) / 2], o.tilt);
  return pts;
}
// loops along the box's long side (a spring): radius about half the box's short side
function coil(b, o) {
  const [x0, y0, x1, y1] = b, W = x1 - x0, H = y1 - y0, horiz = W >= H || o.horiz;
  const r = (horiz ? H : W) / 2 + o.oy, Lx = horiz ? W : H, adv = o.adv * r;
  const n = Math.max(3, Math.ceil((Lx + 2 * o.ox) / adv));
  const pts = [];
  const steps = Math.max(10, Math.round(2 * Math.PI * r / o.step));
  for (let k = 0; k <= n * steps; k++) {
    const t = k / steps, a = 2 * Math.PI * t, c = -o.ox + adv * t;
    const ex = r * o.aspect;
    const px = horiz ? x0 + c + ex * Math.cos(a) : (x0 + x1) / 2 + r * Math.sin(a), py = horiz ? (y0 + y1) / 2 + r * Math.sin(a) : y0 + c + ex * Math.cos(a);
    if (horiz ? px > x1 + o.ox + ex : py > y1 + o.ox + ex) break;
    pts.push([px + gauss() * o.noise, py + gauss() * o.noise]);
  }
  return pts;
}
// a tangle: straight runs in random directions, turning back at the box (with overshoot)
function tangle(b, o) {
  const B = [b[0] - o.ox, b[1] - o.oy, b[2] + o.ox, b[3] + o.oy], BW = B[2] - B[0], BH = B[3] - B[1], wide = BW > 1.6 * BH, tall = BH > 1.6 * BW;
  const win = k => { if (!wide && !tall) return B; const t = k / Math.max(1, o.n - 1); if (wide) { const w = 1.4 * BH, c = B[0] + w / 2 + (BW - w) * t; return [c - w / 2, B[1], c + w / 2, B[3]]; } const h = 1.4 * BW, c = B[1] + h / 2 + (BH - h) * t; return [B[0], c - h / 2, B[2], c + h / 2]; };
  const n = wide || tall ? Math.round(o.n * Math.max(BW, BH) / (1.4 * Math.min(BW, BH))) : o.n;
  o = Object.assign({}, o, { n });
  let [x0, y0, x1, y1] = win(0);
  let p = [rr(x0, x1), rr(y0, y1)], th = rr(0, 2 * Math.PI);
  const vs = [p];
  for (let k = 0; k < o.n; k++) {
    [x0, y0, x1, y1] = win(k);
    p = [Math.min(Math.max(p[0], x0), x1), Math.min(Math.max(p[1], y0), y1)];
    // run to the far side of the box along th
    const dx = Math.cos(th), dy = Math.sin(th);
    let t = Infinity;
    if (dx > 1e-6) t = Math.min(t, (x1 - p[0]) / dx); if (dx < -1e-6) t = Math.min(t, (x0 - p[0]) / dx);
    if (dy > 1e-6) t = Math.min(t, (y1 - p[1]) / dy); if (dy < -1e-6) t = Math.min(t, (y0 - p[1]) / dy);
    t *= rr(0.75, 1);
    p = [p[0] + dx * t, p[1] + dy * t]; vs.push(p);
    th = th + Math.PI + rr(-0.6, 0.6);                    // back, roughly the way it came
  }
  return sample(rounded(vs, o.round * Math.min(BW, BH)), o.step, o.noise);
}
// messy circling over the box (a blot): loops of random size around random centers inside it
function blot(b, o) {
  const [x0, y0, x1, y1] = b, W = x1 - x0, H = y1 - y0, pts = [], wide = W > 1.5 * H, tall = H > 1.5 * W;
  const S = Math.min(W, H), loops = wide || tall ? Math.max(o.n, Math.round(o.n * Math.max(W, H) / (1.2 * S))) : o.n;
  let a = 0;
  for (let k = 0; k < loops * 24; k++) {
    a += 2 * Math.PI / 24;
    const t = k / (loops * 24);
    // the hand moves along the writing (or circles over one symbol), loops about its size, wobbling
    const cx = wide ? x0 + S * 0.4 + (W - 0.8 * S) * t + Math.sin(k * 0.05 + o.ph) * S * 0.15 : x0 + W / 2 + Math.sin(k * 0.031 + o.ph) * W * 0.18;
    const cy = tall ? y0 + S * 0.4 + (H - 0.8 * S) * t + Math.sin(k * 0.05 + o.ph) * S * 0.15 : y0 + H / 2 + Math.cos(k * 0.043 + o.ph) * H * 0.18;
    const rx = ((wide ? S : W) / 2 + o.ox) * (0.8 + 0.3 * Math.abs(Math.sin(k * 0.07))), ry = ((tall ? S : H) / 2 + o.oy) * (0.8 + 0.3 * Math.abs(Math.cos(k * 0.05)));
    pts.push([cx + rx * Math.cos(a) + gauss() * o.noise, cy + ry * Math.sin(a) + gauss() * o.noise]);
  }
  return sample(pts, o.step, 0);
}
const STYLES = ['zig-h', 'zig-v', 'zig-h-tilt', 'zig-v-tilt', 'zig-h-back', 'zig-diag', 'coil', 'tangle', 'blot', 'zig-v-round', 'zig-h-fast', 'zig-v-fast', 'zig-finger'];
// one scribble of a style over box b (H: the writing's size)
function scribble(style, b, H) {
  { const c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], w = Math.max(b[2] - b[0], 0.6 * H), h = Math.max(b[3] - b[1], 0.6 * H); b = [c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2]; }
  const W = b[2] - b[0], Hb = b[3] - b[1];
  const over = rr(-0.05, 0.35), ox = over * Math.max(H * 0.6, 0.15 * W), oy = over * Math.max(H * 0.6, 0.15 * Hb) ;
  const step = style.endsWith('fast') ? rr(10, 22) : rr(1.5, 6), noise = rr(0.2, 1.0);
  const base = { ox, oy, step, noise, jt: rr(0.02, 0.08), js: rr(0.05, 0.25), round: rr(0, 0.04), back: false, tilt: 0 };
  // legs: about one every 0.08–0.25 of the writing's size along the way it moves
  const along = (d) => Math.max(5, Math.round((d === 'h' ? Hb + 2 * oy : W + 2 * ox) / (H * rr(0.08, 0.25))));
  switch (style) {
    case 'zig-h': case 'zig-h-fast': return zig(b, 'h', along('h'), base);
    case 'zig-v': case 'zig-v-fast': return zig(b, 'v', along('v'), base);
    case 'zig-h-tilt': return zig(b, 'h', along('h'), Object.assign(base, { tilt: rr(-1, 1) * Math.min(0.35, Math.atan(0.35 * Math.min(W, Hb) / Math.max(W, Hb))) }));
    case 'zig-v-tilt': return zig(b, 'v', along('v'), Object.assign(base, { tilt: rr(-1, 1) * Math.min(0.35, Math.atan(0.35 * Math.min(W, Hb) / Math.max(W, Hb))) }));
    case 'zig-h-back': return zig(b, 'h', Math.max(4, Math.round(along('h') / 2)), Object.assign(base, { back: true }));
    case 'zig-diag': {
      if (W > 1.5 * Hb) return zig(b, 'v', along('v'), Object.assign(base, { shear: pick([1, -1]) * rr(0.5, 1.0) }));   // slanted legs along a line
      const c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], d = (W + Hb) / Math.SQRT2 / 2 * (1 + Math.max(0, over));
      const bb = [c[0] - d, c[1] - d, c[0] + d, c[1] + d];
      return zig(bb, 'h', Math.max(5, Math.round(2 * d / (H * rr(0.08, 0.25)))), Object.assign(base, { tilt: pick([1, -1]) * rr(0.6, 0.9), ox: 0, oy: 0 }));
    }
    case 'zig-v-round': return zig(b, 'v', along('v'), Object.assign(base, { round: rr(0.06, 0.12) }));
    // a finger on a touch frame (1.6.5): samples far apart (a fast hand, 100 a second), a jittery path, few legs, rounder turns
    case 'zig-finger': { const d = pick(['h', 'v']), n = Math.max(5, Math.round((d === 'h' ? Hb + 2 * oy : W + 2 * ox) / (H * rr(0.15, 0.3))));
      return zig(b, d, n, Object.assign(base, { step: rr(12, 30), noise: rr(1.5, 3.5), round: rr(0, 0.06) })); }
    case 'coil': return coil(b, { ox: ox * 0.6, oy: Math.max(oy * 0.6, 2), adv: rr(0.25, 0.7), step: Math.min(step, 5), noise, aspect: rr(0.6, 1.1) });
    case 'tangle': return tangle(b, { ox, oy, n: ri(14, 30), round: rr(0, 0.05), step, noise });
    case 'blot': return blot(b, { ox: ox * 0.5, oy: oy * 0.5, n: ri(4, 8), ph: rr(0, 6), step: Math.min(step, 5), noise });
  }
}
// symbols in reading order (left to right by their centers), with boxes
function symsOf(E) {
  const out = [];
  E.syms.forEach((y, gi) => { const ss = y.strokes.filter(i => i < E.strokes.length); if (!ss.length) return; out.push({ gi, label: y.label, strokes: ss, b: ubox(ss.map(i => E.strokes[i])) }); });
  return out.sort((a, b) => (a.b[0] + a.b[2]) - (b.b[0] + b.b[2]));
}
// ------------------------------------------------------------------ 2. scribbles over real writing
function scribblesOut() {
  console.log('\n== 2. scribbles over real writing (each style, over one symbol, a few, and a whole line) ==');
  const pools = [['board', 239], ['school', 700], ['test', 500], ['t13', 300]];
  const res = {}, bad = [];
  let trials = 0;
  for (const [name, n] of pools) {
    const recs = load(name === 'school' ? SCHOOL : name, QUICK ? 60 : n);
    for (const r of recs) {
      const H = pick([24, 40, 60]);
      const E = toScreen(r, H), Y = symsOf(E);
      if (Y.length < 2) continue;
      const EB = ubox(E.strokes);
      if (EB[2] - EB[0] > 60 * H || EB[3] - EB[1] > 30 * H) continue;      // a record whose sizes are off (dots only)
      for (const what of ['one', 'few', 'all']) {
        let T;
        if (what === 'one') { T = [pick(Y)]; }
        else if (what === 'few') { if (Y.length < 4) continue; const k = ri(2, 3), s = ri(0, Y.length - k); T = Y.slice(s, s + k); }
        else { if (Y.length > 10) continue; T = Y; }

        // a symbol too small to scribble over on its own (a dot) is not a fair target alone
        const tb = unionBox(T.map(t => t.b));
        if (Math.max(tb[2] - tb[0], tb[3] - tb[1]) < 0.35 * H) continue;
        // what the scribble is over: the target symbols, and any stroke mostly inside their box (the root sign of a
        // root whose inside is scribbled out spans it; a dot between two scribbled digits is under it too)
        const pad = 0.1 * H, inBox = st => st.filter(p => p[0] >= tb[0] - pad && p[0] <= tb[2] + pad && p[1] >= tb[1] - pad && p[1] <= tb[3] + pad).length >= 0.7 * st.length;
        const target = new Set([].concat(...T.map(t => t.strokes)));
        E.strokes.forEach((st, j) => { if (inBox(st)) target.add(j); });
        for (const style of STYLES) {
          trials++;
          if (process.env.TRACE && trials % 200 === 0) console.log('  ..', name, E.id, what, style, (process.memoryUsage().heapUsed / 1e6).toFixed(0) + 'MB');
          const s = scribble(style, tb, H);
          if (process.env.TRACE && s.length > 20000) console.log('  big scribble', style, s.length, tb.map(v => v.toFixed(0)).join(','), H);
          const sc = scribbleOf(s, 1);
          const key = style + '/' + what;
          const R = res[key] || (res[key] = { n: 0, shape: 0, good: 0, under: 0, missed: 0, none: 0, wrong: 0, covered: 0 });
          R.n++;
          if (!sc) { R.none++; R.missed++; if (bad.length < 400) bad.push({ why: 'not a scribble', style, what, id: E.id, latex: E.latex, s, H, strokes: E.strokes, target: [...target] }); continue; }
          R.shape++;
          const er = scribbleErase(sc, E.strokes.map((st, j) => ({ pts: st, group: E.group[j] })), 1);
          const got = new Set(er.erase);
          // how much of each stroke is inside the scribble: what is well inside it should go; what sticks out of it may stay
          const fin = i => { const st = E.strokes[i]; let k = 0; for (const p of st) if (inHull(p, sc.hull)) k++; return k / st.length; };
          const missed = [...target].filter(i => !got.has(i) && fin(i) >= 0.8);
          const under = [...target].filter(i => !got.has(i) && fin(i) < 0.8);
          const wrong = er.erase.filter(i => !target.has(i) && fin(i) < 0.7);
          const covered = er.erase.filter(i => !target.has(i) && fin(i) >= 0.7);
          if (!got.size) R.none++;
          if (missed.length) R.missed++;
          else if (under.length) R.under++;
          if (wrong.length) R.wrong++;
          if (covered.length) R.covered++;
          if (!missed.length && !wrong.length) R.good++;
          if ((missed.length || wrong.length) && bad.length < 400) bad.push({ why: (missed.length ? 'missed ' + missed.length + (got.size ? '' : ' (nothing: ' + er.why + ')') : '') + (wrong.length ? ' wrong ' + wrong.length : ''), style, what, id: E.id, latex: E.latex, H, s, strokes: E.strokes, target: [...target], erase: er.erase });
        }
      }
    }
  }
  const tot = { n: 0, shape: 0, good: 0, under: 0, missed: 0, none: 0, wrong: 0, covered: 0 };
  console.log('style/target            n   shape    good  missed    none   wrong  (under covered)');
  for (const k of Object.keys(res).sort()) { const R = res[k]; for (const f in tot) tot[f] += R[f]; console.log(k.padEnd(20), String(R.n).padStart(5), pc(R.shape, R.n), pc(R.good, R.n), pc(R.missed, R.n), pc(R.none, R.n), pc(R.wrong, R.n), ` (${R.under} ${R.covered})`); }
  console.log('ALL'.padEnd(20), String(tot.n).padStart(5), pc(tot.shape, tot.n), pc(tot.good, tot.n), pc(tot.missed, tot.n), pc(tot.none, tot.n), pc(tot.wrong, tot.n), ` (${tot.under} ${tot.covered})`);
  tot.oneN = 0; tot.oneGood = 0; tot.oneNone = 0;
  tot.fingerN = (res['zig-finger/one'] || { n: 0 }).n; tot.fingerNone = (res['zig-finger/one'] || { none: 0 }).none;
  for (const k of Object.keys(res)) if (/\/one$/.test(k) && !/^tangle/.test(k)) { tot.oneN += res[k].n; tot.oneGood += res[k].good; tot.oneNone += res[k].none; }
  return tot;
}
function pc(a, n) { return (n ? (100 * a / n).toFixed(1) + '%' : '-').padStart(7); }

// ------------------------------------------------------------------ drawings and shading
function line(a, b, step = 3, noise = 0.4) { return sample([a, b], step, noise); }
function circle(c, r, o = {}) { const pts = [], n = Math.max(16, Math.round(2 * Math.PI * r / (o.step || 3))), a0 = o.a0 || rr(0, 6.28), turns = o.turns || 1.04; for (let k = 0; k <= n * turns; k++) { const a = a0 + 2 * Math.PI * k / n; const rk = r * (1 + (o.wob || 0.03) * Math.sin(3 * a + a0)) + (o.drift || 0) * k / n; pts.push([c[0] + rk * Math.cos(a) + gauss() * 0.4, c[1] + rk * (o.aspect || 1) * Math.sin(a) + gauss() * 0.4]); } return pts; }
function rect(x0, y0, x1, y1, one) { if (one) return sample([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0 + 2]], 3, 0.4); return [line([x0, y0], [x1, y0]), line([x1, y0], [x1, y1]), line([x1, y1], [x0, y1]), line([x0, y1], [x0, y0])]; }
let DIGITS = null;
function digit(d, x, y, h) {
  if (!DIGITS) {
    DIGITS = {};
    for (const r of load(SCHOOL)) for (const y of r.symbols) if (/^[0-9]$/.test(y.label) && y.strokes.length === 1 && !(DIGITS[y.label] && DIGITS[y.label].length > 6)) (DIGITS[y.label] = DIGITS[y.label] || []).push(r.strokes[y.strokes[0]]);
  }
  const s = pick(DIGITS[d]), b = box(s), k = h / Math.max(b[3] - b[1], 1e-6);
  return [s.map(p => [x + (p[0] - b[0]) * k, y + (p[1] - b[1]) * k])];
}
// a fill of the inside of a polygon-ish region: zig-zag legs along `dir`, turning at the region's edge (+ slop px)
function fillRegion(inside, b, dir, spacing, slop, o = {}) {
  const [x0, y0, x1, y1] = b, vs = [];
  const n = Math.max(5, Math.round((dir === 'h' ? y1 - y0 : x1 - x0) / spacing));
  for (let k = 0; k <= n; k++) {
    const t = (k + 0.5) / (n + 1);
    // the run across the region at this level: from the first to the last point inside
    let lo = null, hi = null;
    for (let u = 0; u <= 200; u++) {
      const s = u / 200, p = dir === 'h' ? [x0 + (x1 - x0) * s, y0 + (y1 - y0) * t] : [x0 + (x1 - x0) * t, y0 + (y1 - y0) * s];
      if (inside(p)) { if (!lo) lo = p; hi = p; }
    }
    if (!lo) continue;
    const e = k % 2 ? lo : hi, d = k % 2 ? -1 : 1, sl = slop * rr(0.3, 1) * (rnd() < 0.5 ? 1 : 1);
    vs.push(dir === 'h' ? [e[0] + d * sl, e[1]] : [e[0], e[1] + d * sl]);
  }
  return sample(rounded(vs, o.round || 0), o.step || rr(2, 6), 0.4);
}
function shadeCases() {
  const cases = [];
  // a. closed dots on a number line, with ticks and labels
  for (const r of [7, 10, 14, 20]) for (const slop of [-1, 1.5, 3, 5]) for (const dir of ['h', 'v']) {
    const strokes = [line([60, 300], [700, 300])], c = [60 + 60 * ri(2, 8), 300];
    for (let k = 1; k <= 10; k++) { strokes.push(line([60 + 60 * k, 290], [60 + 60 * k, 310])); strokes.push(...digit(String(k % 10), 60 + 60 * k - 6, 318, 18)); }
    strokes.push(circle(c, r));
    const f = fillRegion(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < r - 1, [c[0] - r, c[1] - r, c[0] + r, c[1] + r], dir, rr(1.8, 3.2), slop);
    cases.push({ name: `closed dot r${r} slop${slop} ${dir}`, strokes, fill: f });
  }
  // b. bubbles (a circle alone), filled
  for (const r of [8, 12, 20, 30]) for (const slop of [-1, 2, 4]) for (const dir of ['h', 'v']) {
    const strokes = [], c = [300, 300];
    for (let k = -2; k <= 2; k++) strokes.push(circle([c[0] + 3 * r * k, c[1]], r));
    const f = fillRegion(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < r - 1, [c[0] - r, c[1] - r, c[0] + r, c[1] + r], dir, rr(2, 4), slop);
    cases.push({ name: `bubble r${r} slop${slop} ${dir}`, strokes, fill: f });
  }
  // c. fraction bars: one stroke or four, dividers, k of n shaded
  for (const n of [2, 3, 4, 6, 8]) for (const one of [true, false]) for (const dir of ['h', 'v']) for (const slop of [0, 3, 6]) {
    const X0 = 100, Y0 = 200, Wd = 480, Ht = rr(50, 90);
    const strokes = [].concat(one ? [rect(X0, Y0, X0 + Wd, Y0 + Ht, true)] : rect(X0, Y0, X0 + Wd, Y0 + Ht, false));
    for (let k = 1; k < n; k++) strokes.push(line([X0 + Wd * k / n, Y0], [X0 + Wd * k / n, Y0 + Ht]));
    const kk = ri(1, n - 1), xs = X0 + 1, xe = X0 + Wd * kk / n - 1;
    const f = fillRegion(p => p[0] > xs && p[0] < xe && p[1] > Y0 + 1 && p[1] < Y0 + Ht - 1, [xs, Y0, xe, Y0 + Ht], dir, rr(3, 7), slop);
    cases.push({ name: `fraction bar ${kk}/${n} ${one ? 'one stroke' : 'four'} ${dir} slop${slop}`, strokes, fill: f });
    // with the fractions written in the cells
    const s2 = strokes.slice();
    for (let k = 0; k < n; k++) s2.push(...digit('1', X0 + Wd * (k + 0.5) / n - 4, Y0 + Ht * 0.3, Ht * 0.35));
    cases.push({ name: `fraction bar ${kk}/${n} labelled ${one ? 'one stroke' : 'four'} ${dir} slop${slop}`, strokes: s2, fill: f, labels: true });
  }
  // d. a fraction circle: a circle and radii, a sector shaded
  for (const n of [3, 4, 6, 8]) for (const slop of [0, 3]) for (const dir of ['h', 'v']) {
    const c = [300, 300], R = 90, strokes = [circle(c, R)];
    for (let k = 0; k < n; k++) strokes.push(line(c, [c[0] + R * Math.cos(2 * Math.PI * k / n), c[1] + R * Math.sin(2 * Math.PI * k / n)]));
    const a1 = 2 * Math.PI / n;
    const inside = p => { const a = Math.atan2(p[1] - c[1], p[0] - c[0]); const aa = a < 0 ? a + 2 * Math.PI : a; return Math.hypot(p[0] - c[0], p[1] - c[1]) < R - 1 && aa > 0.03 && aa < a1 - 0.03; };
    const f = fillRegion(inside, [c[0] - R, c[1] - R, c[0] + R, c[1] + R], dir, rr(3, 7), slop);
    cases.push({ name: `fraction circle 1/${n} ${dir} slop${slop}`, strokes, fill: f });
  }
  // e. Venn diagrams: the lens shaded, a crescent shaded; numbers in the regions
  for (const labels of [false, true]) for (const slop of [0, 3, 6]) for (const dir of ['h', 'v']) for (const part of ['lens', 'left']) {
    const A = [250, 300], B = [370, 300], R = 100, strokes = [circle(A, R), circle(B, R)];
    if (labels) { strokes.push(...digit('3', 180, 290, 22)); strokes.push(...digit('5', 302, 290, 22)); strokes.push(...digit('7', 420, 290, 22)); }
    const inA = p => Math.hypot(p[0] - A[0], p[1] - A[1]) < R - 1, inB = p => Math.hypot(p[0] - B[0], p[1] - B[1]) < R - 1;
    const inside = part === 'lens' ? p => inA(p) && inB(p) : p => inA(p) && !inB(p) && Math.hypot(p[0] - B[0], p[1] - B[1]) > R + 1;
    const f = fillRegion(inside, [A[0] - R, A[1] - R, B[0] + R, B[1] + R], dir, rr(3, 7), slop);
    cases.push({ name: `Venn ${part}${labels ? ' with numbers' : ''} ${dir} slop${slop}`, strokes, fill: f, labels });
  }
  // f. the area under a curve: axes, ticks, the curve; shaded between them
  for (const slop of [0, 3, 6]) for (const ticks of [false, true]) {
    const O = [100, 500], strokes = [line([O[0], O[1]], [O[0] + 500, O[1]]), line([O[0], O[1]], [O[0], O[1] - 400])];
    const fx = x => O[1] - 40 - 300 * Math.pow((x - O[0]) / 500, 2);
    const curve = []; for (let x = O[0]; x <= O[0] + 480; x += 4) curve.push([x, fx(x) + gauss() * 0.4]); strokes.push(curve);
    if (ticks) for (let k = 1; k <= 9; k++) strokes.push(line([O[0] + 50 * k, O[1] - 8], [O[0] + 50 * k, O[1] + 8]));
    const xa = O[0] + 150, xb = O[0] + 350;
    const f = fillRegion(p => p[0] > xa && p[0] < xb && p[1] < O[1] - 1 && p[1] > fx(p[0]) + 1, [xa, O[1] - 400, xb, O[1]], 'v', rr(4, 8), slop);
    cases.push({ name: `area under a curve${ticks ? ' with ticks' : ''} slop${slop}`, strokes, fill: f });
  }
  // f2. the area under a curve with a label in it
  for (const slop of [0, 3]) {
    const O = [100, 500], strokes = [line([O[0], O[1]], [O[0] + 500, O[1]]), line([O[0], O[1]], [O[0], O[1] - 400])];
    const fx = x => O[1] - 60 - 300 * Math.pow((x - O[0]) / 500, 2);
    const curve = []; for (let x = O[0]; x <= O[0] + 480; x += 4) curve.push([x, fx(x) + gauss() * 0.4]); strokes.push(curve);
    strokes.push(...digit('5', O[0] + 240, O[1] - 45, 22));
    const xa = O[0] + 150, xb = O[0] + 350;
    cases.push({ name: `area under a curve, labelled, slop${slop}`, strokes, fill: fillRegion(p => p[0] > xa && p[0] < xb && p[1] < O[1] - 1 && p[1] > fx(p[0]) + 1, [xa, O[1] - 400, xb, O[1]], 'v', rr(4, 8), slop) });
  }
  // f3. a resistor (a zig-zag) drawn on a wire
  for (const k of [0, 1, 2]) {
    const strokes = [line([100, 300], [700, 300])];
    const zz = sample(Array.from({ length: 13 }, (_, i) => [350 + 100 * i / 12, 300 + (i === 0 || i === 12 ? 0 : (i % 2 ? -14 : 14))]), 2, 0.4);
    cases.push({ name: `a resistor on a wire ${k}`, strokes, fill: zz });
  }
  // g. a grid with numbers, a cell shaded
  for (const slop of [0, 3]) for (const dir of ['h', 'v']) {
    const strokes = [];
    for (let k = 0; k <= 3; k++) { strokes.push(line([100, 100 + 70 * k], [310, 100 + 70 * k])); strokes.push(line([100 + 70 * k, 100], [100 + 70 * k, 310])); }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2) strokes.push(...digit(String(i * 3 + j), 100 + 70 * i + 28, 100 + 70 * j + 22, 26));
    const f = fillRegion(p => p[0] > 171 && p[0] < 239 && p[1] > 101 && p[1] < 169, [170, 100, 240, 170], dir, rr(3, 6), slop);
    cases.push({ name: `grid cell ${dir} slop${slop}`, strokes, fill: f });
  }
  // h. a triangle (one stroke), filled
  for (const slop of [0, 3]) for (const dir of ['h', 'v']) {
    const T = [[200, 400], [400, 400], [300, 230]], strokes = [sample([T[0], T[1], T[2], [T[0][0] + 1, T[0][1] - 1]], 3, 0.4)];
    const inside = p => { const s = (a, b) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); const d1 = s(T[0], T[1]), d2 = s(T[1], T[2]), d3 = s(T[2], T[0]); return (d1 > 1 && d2 > 1 && d3 > 1) || (d1 < -1 && d2 < -1 && d3 < -1); };
    cases.push({ name: `triangle ${dir} slop${slop}`, strokes, fill: fillRegion(inside, [200, 230, 400, 400], dir, rr(3, 6), slop) });
  }
  return cases;
}
function shading() {
  console.log('\n== 3. shading and drawings (the fill must rub out nothing) ==');
  const cases = shadeCases();
  let n = 0, shape = 0, rubbed = 0;
  const bad = [];
  for (let rep = 0; rep < (QUICK ? 1 : 3); rep++) for (const c of cases) {
    n++;
    const sc = scribbleOf(c.fill, 1);
    if (!sc) continue;
    shape++;
    const er = scribbleErase(sc, c.strokes.map(s => ({ pts: s })), 1);
    if (er.erase.length) { rubbed++; if (bad.length < 60) bad.push({ name: c.name, why: er.why, erase: er.erase, strokes: c.strokes, fill: c.fill }); }
  }
  console.log(`fills ${n}; shaped like a scribble ${shape}; rubbed something out: ${rubbed}`);
  const by = {};
  for (const b of bad) { const k = b.name.replace(/ slop\S+| r\d+| [hv]$| [hv] /g, ' ').replace(/\s+/g, ' ').trim(); by[k] = (by[k] || 0) + 1; }
  for (const k in by) console.log('  RUBBED OUT:', k, '×' + by[k]);
  return { n, shape, rubbed };
}

// ------------------------------------------------------------------ 4. marks that are not scribbles, over writing
// real writers' single-stroke symbols that zig-zag or loop (m, w, M, W, N, Σ, ∞, 3, 8, ...), from the training set
let ZIGGY = null;
function ziggy() {
  if (ZIGGY) return ZIGGY;
  ZIGGY = {};
  const want = new Set(['m', 'w', 'n', 'u', 'v', 'z', 'M', 'W', 'N', 'k', '\\sum', '\\Sigma', '\\int', '3', '8', '\\infty', 'E', '\\xi', 'B', 'S', 'y', 'g', '\\alpha', '\\beta', '\\mu', '\\pi', '\\sigma', '\\gamma']);
  for (const r of load('valid', 0).concat(load('test', 0))) for (const y of r.symbols || []) {
    if (!want.has(y.label) || !y.strokes || y.strokes.length !== 1) continue;
    const st = r.strokes[y.strokes[0]];
    if (!st || st.length < 8) continue;
    (ZIGGY[y.label] = ZIGGY[y.label] || []).length < 40 && ZIGGY[y.label].push(st.map(p => [+p[0], +p[1]]));
  }
  return ZIGGY;
}
function placed(st, b) { const sb = box(st), k = (b[3] - b[1]) / Math.max(sb[3] - sb[1], 1e-6); return st.map(p => [b[0] + (p[0] - sb[0]) * k, b[1] + (p[1] - sb[1]) * k]); }
// a stroke gone over again: forward and back along it two or three times, a little off each time
function retrace(st, times) { const out = []; for (let k = 0; k < times; k++) { const seq = k % 2 ? st.slice().reverse() : st; for (const p of seq) out.push([p[0] + gauss() * 1.2, p[1] + gauss() * 1.2]); } return out; }
function nearMisses() {
  console.log('\n== 4. marks over writing that are not scribbles (cancel, X, ring, box, underline, arrow, check, overwrite) ==');
  const recs = load(SCHOOL, QUICK ? 100 : 700).concat(load('board', QUICK ? 60 : 239));
  let n = 0, rubbed = 0;
  const by = {}, bad = [];
  for (const r of recs) {
    const H = pick([24, 40, 60]), E = toScreen(r, H), Y = symsOf(E);
    if (Y.length < 2) continue;
    const T = Y.length > 3 ? Y.slice(1, 1 + ri(1, 2)) : [Y[0]];
    const b = unionBox(T.map(t => t.b)), W = b[2] - b[0], Hb = b[3] - b[1], c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    const marks = {
      'cancel /': [line([b[0] - 4, b[3] + 4], [b[2] + 4, b[1] - 4], 3, 0.5)],
      'X': [line([b[0] - 4, b[1] - 4], [b[2] + 4, b[3] + 4], 3, 0.5), line([b[2] + 4, b[1] - 4], [b[0] - 4, b[3] + 4], 3, 0.5)],
      'strike —': [line([b[0] - 6, c[1]], [b[2] + 6, c[1] + 2], 3, 0.6)],
      'double strike': [sample([[b[0] - 6, c[1] - 3], [b[2] + 6, c[1] - 2], [b[0] - 4, c[1] + 4]], 3, 0.6)],
      'ring ×1': [circle(c, Math.max(W, Hb) * 0.62 + 6, { aspect: Hb / Math.max(W, Hb) + 0.2 })],
      'ring ×2': [circle(c, Math.max(W, Hb) * 0.62 + 6, { turns: 2.1, drift: 3, aspect: Hb / Math.max(W, Hb) + 0.2 })],
      'ring ×3': [circle(c, Math.max(W, Hb) * 0.62 + 6, { turns: 3.1, drift: 2, wob: 0.06, aspect: Hb / Math.max(W, Hb) + 0.2 })],
      'box': [sample([[b[0] - 8, b[1] - 8], [b[2] + 8, b[1] - 8], [b[2] + 8, b[3] + 8], [b[0] - 8, b[3] + 8], [b[0] - 8, b[1] - 6]], 3, 0.5)],
      'underline ×2': [line([b[0] - 4, b[3] + 6], [b[2] + 4, b[3] + 6]), line([b[0] - 4, b[3] + 12], [b[2] + 4, b[3] + 12])],
      'zigzag underline': [sample(Array.from({ length: 12 }, (_, k) => [b[0] - 4 + (W + 8) * k / 11, b[3] + 6 + (k % 2) * 8]), 3, 0.4)],
      'wavy underline': [Array.from({ length: 80 }, (_, k) => [b[0] - 4 + (W + 8) * k / 79, b[3] + 8 + 4 * Math.sin(k / 79 * 6 * Math.PI)])],
      'arrow': [line([b[2] + 60, b[1] - 50], [b[2] + 4, b[1] - 4]), sample([[b[2] + 4, b[1] - 18], [b[2] + 4, b[1] - 4], [b[2] + 18, b[1] - 4]], 3, 0.4)],
      'check': [sample([[c[0] - W * 0.4, c[1]], [c[0] - W * 0.1, b[3]], [c[0] + W * 0.6, b[1] - Hb * 0.3]], 3, 0.5)],
      'overwrite': (() => { const d = digit(pick('0123456789'.split('')), b[0], b[1], Hb); return d; })(),
      'hatch ///': Array.from({ length: 5 }, (_, k) => line([b[0] + W * k / 4 - 6, b[3] + 4], [b[0] + W * k / 4 + 6, b[1] - 4])),
      // a star on it (one stroke, five points), a spiral (1.6.5)
      'star': (() => { const R = Math.max(W, Hb) * 0.62 + 6, th = rr(-0.3, 0.3); return [sample(Array.from({ length: 6 }, (_, k) => [c[0] + R * Math.cos(th - Math.PI / 2 + k * 4 * Math.PI / 5), c[1] + R * Math.sin(th - Math.PI / 2 + k * 4 * Math.PI / 5)]), 3, 0.5)]; })(),
      'spiral': (() => { const R = Math.max(W, Hb) * 0.62 + 6, out = []; for (let k = 0; k <= 160; k++) { const t = k / 160, a = t * 3 * 2 * Math.PI; out.push([c[0] + (2 + R * t) * Math.cos(a), c[1] + (2 + R * t) * Math.sin(a) * (0.6 + 0.4 * Hb / Math.max(W, Hb))]); } return [out]; })(),
      'overwrite with a letter': (() => { const Z = ziggy(), ks = Object.keys(Z); if (!ks.length) return []; const L = pick(ks); return [placed(pick(Z[L]), [b[0], b[1], b[2], b[1] + Math.max(Hb, 0.8 * H)])]; })(),
      'gone over again': (() => { const t = T[0].strokes.map(i => E.strokes[i]).sort((x, y) => y.length - x.length)[0]; return t && t.length > 3 ? [retrace(t, ri(2, 4))] : []; })(),
      'a letter written, then gone over again': (() => { const Z = ziggy(), ks = Object.keys(Z); if (!ks.length) return []; const L = pick(ks), st = placed(pick(Z[L]), [b[2] + 0.3 * H, b[1], b[2] + 1.3 * H, b[1] + Math.max(Hb, 0.8 * H)]); const m = retrace(st, ri(2, 4)); m.pre = [st]; m.label = L; return [m]; })(),
    };
    for (const [name, list] of Object.entries(marks)) {
      for (const m of list) {
        n++;
        const sc = scribbleOf(m, 1);
        if (!sc) continue;
        const under = E.strokes.concat(m.pre || []);
        const er = scribbleErase(sc, under.map((s, j) => ({ pts: s, group: j < E.group.length ? E.group[j] : null })), 1);
        if (er.erase.length) { rubbed++; by[name] = (by[name] || 0) + 1; if (bad.length < 60) bad.push({ name: name + (m.label ? ' ' + m.label : ''), id: E.id, latex: E.latex, erase: er.erase, why: er.why, mark: m, strokes: under }); }
      }
    }
  }
  console.log(`marks ${n}; rubbed something out: ${rubbed}`, JSON.stringify(by));
  return { n, rubbed };
}

(async () => {
  const t0 = Date.now();
  if (!fs.existsSync(path.join(DATA, 'test.jsonl'))) console.log('  (no data sets at ' + DATA + ': the school problems only; set NIB_DATA)');
  const real = realReplay();
  ok(real.erasures === 0, `real writing: no stroke of ${real.strokes} rubs anything out (${real.shapes} shaped like a scribble, ${(100 * real.shapes / real.strokes).toFixed(3)}%)`);
  const out = scribblesOut();
  // (93%: 1.6.5 adds a finger on a touch frame — far-apart, jittery samples — to the kinds; the rules of 1.6.4 make 93.5%
  // of this set, and 8.1% of one symbol scribbled out rubbed out nothing)
  ok(out.good / out.n >= 0.93, `scribbles over writing: ${(100 * out.good / out.n).toFixed(1)}% take what is under them and nothing beside it (at least 93%)`);
  ok(out.wrong / out.n <= 0.006, `scribbles over writing: ${(100 * out.wrong / out.n).toFixed(2)}% take something sticking out of them (at most 0.6%)`);
  ok(out.oneGood / out.oneN >= 0.95, `one symbol scribbled out: ${(100 * out.oneGood / out.oneN).toFixed(1)}% right (at least 95%; tangles aside)`);
  // (the failure a teacher sees: a scribble over a symbol that does nothing — 1.6.5 takes what a scribble falls short of)
  ok(out.oneNone / out.oneN <= 0.06, `one symbol scribbled out: ${(100 * out.oneNone / out.oneN).toFixed(1)}% rub out nothing (at most 6%; tangles aside)`);
  ok(out.fingerNone / out.fingerN <= 0.12, `one symbol scribbled out with a finger on a touch frame: ${(100 * out.fingerNone / out.fingerN).toFixed(1)}% rub out nothing (at most 12%)`);
  const sh = shading();
  ok(sh.rubbed === 0, `shading and drawings: ${sh.n} fills rub out nothing`);
  const nm = nearMisses();
  ok(nm.rubbed === 0, `marks over writing that are not scribbles: ${nm.n} rub out nothing`);
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
