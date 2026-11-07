// ================================================================== in place: tidy, my handwriting, typeset
// Lays a reading out again where it was written. Every symbol becomes a glyph — the writer's own strokes cleaned
// up ('tidy'), the writer's Replicator handwriting ('hand'), or typeset maths ('typeset') — placed by TeX-like rules
// (spacing by kind, raised exponents, centred fractions, roots that cover their body, brackets as tall as what
// they hold) at the writer's size, on a level line through the writer's own baseline, starting where they began.
//
// Units: layout happens in em of the writer's size (em = the height of a digit / 0.7), y up from the baseline;
// the result is mapped back to ink coordinates (y down) at the end.
const NEAT = { cap: 0.7, xh: 0.48, desc: 0.23, axis: 0.25, inkGap: 0.07, frac: 0.85, script: 0.65, minScale: 0.4, wide: 1.6 };
const NEAT_OPS = new Set(['+', '-', '=', '\\times', '\\div', '\\pm', '<', '>', '\\le', '\\ge', '\\ne', '\\rightarrow', '\\cdot', ':', '\\in']);
const OPEN = new Set(['(', '[', '\\{']), CLOSE = new Set([')', ']', '\\}']);
const PAIR = { '(': ')', '[': ']', '\\{': '\\}' };

function atomOf(l) {
  if (RELATIONS.has(l) || l === ':' || l === '\\in') return 'rel';
  if (l === '+' || l === '-' || l === '\\times' || l === '\\div' || l === '\\pm' || l === '\\cdot') return 'bin';
  if (OPEN.has(l)) return 'open';
  if (CLOSE.has(l)) return 'close';
  if (l === ',' || l === ';') return 'punct';
  if (l === '\\sum' || l === '\\int' || l === '\\lim' || l === '\\log' || l === '\\sin' || l === '\\cos' || l === '\\tan') return 'op';
  return 'ord';
}
// TeX's spacing between atoms (em): thin 1/6, medium 2/9, thick 5/18
function spaceBetween(a, b) {
  if (a === 'rel' || b === 'rel') return a === 'open' || b === 'close' ? 0 : 0.278;
  if (a === 'bin' || b === 'bin') return 0.222;
  if (a === 'punct') return 0.167;
  if (a === 'op' && (b === 'ord' || b === 'open')) return 0.167;
  return 0;
}

// ------------------------------------------------------------------ geometry
function bboxOf(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of paths) for (const p of s) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return x0 <= x1 ? [x0, y0, x1, y1] : [0, 0, 0, 0];
}
function median2(a) { const b = a.slice().sort((x, y) => x - y); const n = b.length; return n ? (n % 2 ? b[n >> 1] : (b[n / 2 - 1] + b[n / 2]) / 2) : NaN; }
function pathLen(s) { let t = 0; for (let i = 1; i < s.length; i++) t += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); return t; }

// the strokes exactly as recognize() saw them, index for index ([] where a stroke had no usable point)
function inkOf(input) {
  return (input || []).map(s => {
    const pts = Array.isArray(s) ? s : (s && (s.points || s.pts)) || [];
    const q = [];
    for (const p of pts) {
      const x = Array.isArray(p) ? +p[0] : p ? +p.x : NaN, y = Array.isArray(p) ? +p[1] : p ? +p.y : NaN;
      if (isFinite(x) && isFinite(y)) q.push([x, y]);
    }
    return q;
  });
}

// ------------------------------------------------------------------ the reading as units with their ink
// res.tree rows -> units {k, label, src, pts (level coordinates), box, full, sup, sub, num, den, body, idx}
function unitsOf(row, ink, lev) {
  return row.map(n => {
    const u = { k: n.k === 's' ? 's' : n.k, label: n.k === 's' ? n.label : n.k === 'frac' || n.k === 'over' ? '-' : '\\sqrt', src: (n.strokes || []).slice() };
    u.pts = u.src.map(i => (ink[i] || []).map(lev)).filter(s => s.length);
    u.box = bboxOf(u.pts);
    for (const key of ['num', 'den', 'body', 'idx', 'sup', 'sub']) if (n[key]) u[key] = unitsOf(n[key], ink, lev);
    let f = u.box.slice();
    for (const key of ['num', 'den', 'body', 'idx', 'sup', 'sub']) if (u[key]) for (const v of u[key]) f = [Math.min(f[0], v.full[0]), Math.min(f[1], v.full[1]), Math.max(f[2], v.full[2]), Math.max(f[3], v.full[3])];
    u.full = f;
    return u;
  });
}
const SIZED = /^[0-9A-Za-z]$|^\\(alpha|theta|pi|lambda|sigma|Delta|beta|mu|gamma|phi)$/;
// the writer's em in ink units: digits and capitals are 0.7 em tall, small letters 0.48, g/p/q/y 0.71
function emOf(lines) {
  const top = [], all = [];
  const visit = (row, f, main) => {
    for (const u of row) {
      if (u.k === 's' && SIZED.test(u.label)) {
        const t = symType(u.label), h = u.box[3] - u.box[1];
        const k = t === T_XH ? NEAT.xh : t === T_DESC ? (/^[gpqy]$/.test(u.label) ? NEAT.xh + NEAT.desc : 0) : /^[tij]$/.test(u.label) ? 0 : NEAT.cap;
        if (k && h > 0) { const v = h / (k * f); all.push(v); if (main) top.push(v); }
      }
      if (u.num) { visit(u.num, f * NEAT.frac, main); visit(u.den, f * NEAT.frac, main); }
      if (u.body) visit(u.body, f, main);
      if (u.sup) visit(u.sup, f * NEAT.script, false);
      if (u.sub) visit(u.sub, f * NEAT.script, false);
    }
  };
  for (const row of lines) visit(row, 1, true);
  const m = median2(top.length ? top : all);
  return m > 0 ? m : 0;
}
// how far apart the writer puts the digits of a number, and other neighbouring symbols (em)
function gapsOf(lines, em) {
  const dd = [], oo = [];
  const visit = row => {
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1], b = row[i];
      if (a.k !== 's' || b.k !== 's' || a.sup || a.sub) continue;
      const g = (b.box[0] - a.box[2]) / em;
      if (g < -0.1 || g > 1.2) continue;
      if (/^[0-9]$/.test(a.label) && /^[0-9]$/.test(b.label)) dd.push(g);
      else if (atomOf(a.label) === 'ord' && atomOf(b.label) === 'ord' && a.label !== '.' && b.label !== '.') oo.push(g);
    }
    for (const u of row) for (const k of ['num', 'den', 'body', 'idx', 'sup', 'sub']) if (u[k]) visit(u[k]);
  };
  for (const row of lines) visit(row);
  const clamp = (v, lo, hi, def) => (isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  return { dd: clamp(median2(dd), 0.07, 0.25, 0.1), oo: clamp(median2(oo), 0.09, 0.3, 0.13) };
}
// where the line's baseline is (level coordinates, y down)
function baselineOf(row, em) {
  const ys = [];
  for (const u of row) {
    if (u.k === 's') {
      const t = symType(u.label);
      if ((t === T_ASC || t === T_XH) && SIZED.test(u.label)) ys.push(u.box[3]);
      else if (t === T_DESC && /^[gpqy]$/.test(u.label)) ys.push(u.box[3] - NEAT.desc * em);
      else if (NEAT_OPS.has(u.label) && u.label !== ':') ys.push((u.box[1] + u.box[3]) / 2 + NEAT.axis * em);
    } else if (u.k === 'frac') ys.push((u.box[1] + u.box[3]) / 2 + NEAT.axis * em);
    else if (u.k === 'root' && u.body) { const b = baselineOf(u.body, em); if (isFinite(b)) ys.push(b); }
  }
  if (ys.length) return median2(ys);
  let y0 = Infinity, y1 = -Infinity;
  for (const u of row) { y0 = Math.min(y0, u.full[1]); y1 = Math.max(y1, u.full[3]); }
  return (y0 + y1) / 2 + NEAT.axis * em;
}

// ------------------------------------------------------------------ layout (em, y up, origin at the left of the baseline)
// A box: {w, h, d, items: [{u, g, x, y}]}; g is a glyph {w, h, d, draw: [...]} from the provider.
function shiftItems(items, dx, dy) { return items.map(it => Object.assign({}, it, { x: it.x + dx, y: it.y + dy })); }
function glyphBox(u, g) { return { w: g.w, h: g.h, d: g.d, items: [{ u, g, x: 0, y: 0 }], atom: atomOf(u.label) }; }

function rowBox(units, s, P, ctx) {
  // fences: brackets and absolute-value bars grow to the height of what they hold
  const boxes = units.map(u => (u.k === 's' && (OPEN.has(u.label) || CLOSE.has(u.label) || u.label === '|')) ? null : unitBox(u, s, P, ctx));
  const fenceH = (i, j) => {
    let h = NEAT.cap * s * 0.95, d = 0.12 * s;
    for (let k = i + 1; k < j; k++) if (boxes[k]) { h = Math.max(h, boxes[k].h); d = Math.max(d, boxes[k].d); }
    return [h + 0.08 * s, d + 0.08 * s];
  };
  const stack = [], bars = [];
  const span = new Array(units.length).fill(null);
  units.forEach((u, i) => {
    if (u.k !== 's') return;
    if (OPEN.has(u.label)) stack.push(i);
    else if (CLOSE.has(u.label)) {
      let k = stack.length - 1; while (k >= 0 && PAIR[units[stack[k]].label] !== u.label) k--;
      if (k >= 0) { const o = stack[k]; stack.length = k; span[o] = span[i] = fenceH(o, i); }
    } else if (u.label === '|') bars.push(i);
  });
  for (let k = 0; k + 1 < bars.length; k += 2) span[bars[k]] = span[bars[k + 1]] = fenceH(bars[k], bars[k + 1]);
  units.forEach((u, i) => {
    if (boxes[i]) return;
    const [h, d] = span[i] || [NEAT.cap * s * 1.07, 0.2 * s];
    boxes[i] = withScripts(u, glyphBox(u, P.fence(u, h, d, s)), s, P, ctx);
  });
  // left to right with TeX spacing (plus a little air between ink-tight handwritten glyphs)
  const items = [], gaps = [];
  let x = 0, h = 0, d = 0, prev = null;
  units.forEach((u, i) => {
    const B = boxes[i];
    let a = B.atom;
    if (a === 'bin' && (prev === null || prev === 'bin' || prev === 'rel' || prev === 'open' || prev === 'punct' || prev === 'op')) a = 'ord';   // a sign, not an operation
    if (prev !== null) {
      let g = spaceBetween(prev, a) * s;
      if (P.ink) {
        // the writer's own spacing: between the digits of a number, and between other symbols
        const l = units[i - 1].k === 's' ? units[i - 1].label : '', r = u.k === 's' ? u.label : '', sp = ctx.gaps || { dd: 0.1, oo: 0.13 };
        g += (l === '.' || r === '.' ? 0.6 * sp.dd : /^[0-9]$/.test(l) && /^[0-9]$/.test(r) ? sp.dd : sp.oo) * s;
      }
      x += g; gaps.push(g);
    }
    for (const it of shiftItems(B.items, x, 0)) { it.ti = i; items.push(it); }
    x += B.w; h = Math.max(h, B.h); d = Math.max(d, B.d);
    prev = a;
  });
  return { w: x, h, d, items, gaps, atom: 'ord' };
}

// The writer's line keeps its length: the gaps between top-level symbols stretch or shrink together (from half to
// two and a half times their typeset size) so the tidied line spans about what was written; typeset maths, whose
// glyphs are wider than handwriting, may also come down in size by up to a fifth. Returns the factor for the size.
function fitRow(box, rawW, P) {
  const G = box.gaps || [];
  let k = 1;
  if (G.length && rawW > 0) {
    const fixed = box.w - G.reduce((a, b) => a + b, 0), room = rawW - fixed;
    const at = f => G.reduce((t, g) => t + g * f, 0);
    const f = Math.min(2.5, Math.max(0.5, at(1) > 0 ? room / at(1) : 1));
    if (Math.abs(f - 1) > 1e-6) {
      const shift = [0];
      for (let i = 0; i < G.length; i++) shift.push(shift[i] + G[i] * (f - 1));
      for (const it of box.items) it.x += shift[it.ti] || 0;
      box.w += shift[G.length];
    }
  }
  if (!P.ink && rawW > 0 && box.w > rawW) k = Math.max(0.8, rawW / box.w);
  return k;
}

function unitBox(u, s, P, ctx) {
  let B;
  if (u.k === 'frac') {
    const fs = Math.max(s * NEAT.frac, NEAT.minScale);
    const N = rowBox(u.num || [], fs, P, ctx), D = rowBox(u.den || [], fs, P, ctx);
    const pad = 0.12 * s, gap = 0.13 * s, axis = NEAT.axis * s;
    const W = Math.max(N.w, D.w) + 2 * pad;
    const nb = axis + gap + N.d, db = axis - gap - D.h;
    const bar = P.bar(u, W, s);
    const items = [{ u, g: bar, x: 0, y: axis }]
      .concat(shiftItems(N.items, (W - N.w) / 2, nb), shiftItems(D.items, (W - D.w) / 2, db));
    B = { w: W, h: nb + N.h, d: Math.max(0, -(db - D.d)), items, atom: 'ord' };
  } else if (u.k === 'root') {
    const body = rowBox(u.body || [], s, P, ctx);
    const clear = 0.12 * s, top = Math.max(body.h, NEAT.xh * s) + clear, low = -Math.max(body.d, 0.02 * s) - 0.04 * s;
    const cw = Math.min(Math.max(0.42 * s, 0.3 * (top - low)), 0.9 * s), gap = 0.06 * s;
    const total = cw + gap + body.w + 0.08 * s;
    let shift = 0, idxItems = [];
    if (u.idx && u.idx.length) {
      const I = rowBox(u.idx, Math.max(s * 0.6, NEAT.minScale), P, ctx);
      const ix = 0.55 * cw - I.w, iy = low + 0.62 * (top - low) + I.d;
      if (ix < 0) shift = -ix;
      idxItems = shiftItems(I.items, ix + shift, iy);
    }
    const items = [{ u, g: P.radical(u, cw, top, low, total, s), x: shift, y: 0 }].concat(shiftItems(body.items, shift + cw + gap, 0), idxItems);
    B = { w: total + shift, h: top + 0.03 * s, d: -low, items, atom: 'ord' };
  } else if (u.k === 'over') {
    // a bar over digits (a repeating decimal), as long as they are
    const body = rowBox(u.body || [], s, P, ctx), y = Math.max(body.h, NEAT.cap * s) + 0.11 * s;
    B = { w: body.w, h: y + 0.03 * s, d: body.d, items: [{ u, g: P.bar(u, body.w, s), x: 0, y }].concat(body.items), atom: 'ord' };
  } else {
    B = glyphBox(u, P.glyph(u, s));
  }
  return withScripts(u, B, s, P, ctx);
}

function withScripts(u, B, s, P, ctx) {
  if (!u.sup && !u.sub) return B;
  const ss = Math.max(s * NEAT.script, NEAT.minScale);
  const SUP = u.sup ? rowBox(u.sup, ss, P, ctx) : null, SUB = u.sub ? rowBox(u.sub, ss, P, ctx) : null;
  let up = SUP ? Math.max(0.36 * s, B.h - 0.25 * s, SUP.d + 0.12 * s) : 0;
  const dn = SUB ? Math.max(0.16 * s, SUB.h - 0.42 * s) : 0;
  if (SUP && SUB) { const room = (up - SUP.d) - (SUB.h - dn); if (room < 0.12 * s) up += 0.12 * s - room; }
  const x0 = B.w + (P.ink ? 0.05 : 0.02) * s + (B.items.length === 1 && B.items[0].g.italic ? B.items[0].g.italic : 0);
  const items = B.items.slice();
  if (SUP) items.push(...shiftItems(SUP.items, x0, up));
  const xs = B.w + (P.ink ? 0.05 : 0.02) * s;
  if (SUB) items.push(...shiftItems(SUB.items, xs, -dn));
  return {
    w: Math.max(SUP ? x0 + SUP.w : 0, SUB ? xs + SUB.w : 0, B.w),
    h: Math.max(B.h, SUP ? up + SUP.h : 0), d: Math.max(B.d, SUB ? dn + SUB.d : 0), items, atom: B.atom,
  };
}

// ------------------------------------------------------------------ the whole plan
// Lays a recognition result out with provider P. Returns {em, skew, lines: [{baseline, segments: [{x, box}]}], items}
// where every item is {key, src, label, x, y, scale (ink units per em), g} in level ink coordinates.
function planOf(res, input, P, opts) {
  opts = opts || {};
  const ink = inkOf(input);
  const out = { em: 0, skew: res ? res.skew || 0 : 0, lines: [], items: [] };
  if (!res || !res.tree || !res.tree.length) return out;
  // level coordinates: the slope the recogniser removed, removed again here the same way
  let sx = 0, n = 0;
  for (const s of ink) for (const p of s) { sx += p[0]; n++; }
  const c0 = n ? sx / n : 0, t = Math.tan((out.skew || 0) * Math.PI / 180);
  const lev = p => [p[0], p[1] - t * (p[0] - c0)];
  const lines = res.tree.map(row => unitsOf(row, ink, lev));
  out.c0 = c0; out.t = t;
  let em = opts.em > 0 ? opts.em : emOf(lines);
  if (!(em > 0)) {
    const sz = []; for (const s of ink) if (s.length) { const b = bboxOf([s]); sz.push(Math.max(b[2] - b[0], b[3] - b[1])); }
    em = (median2(sz) || 1) / NEAT.cap;
  }
  out.em = em;
  const ctx = { gaps: gapsOf(lines, em) };
  lines.forEach((row, li) => {
    if (!row.length) return;
    const base = baselineOf(row, em);
    if (opts.answersOnly) { out.lines.push({ li, baseline: base, segments: [] }); return; }
    // a wide gap splits the line: each part starts where it was written
    const parts = [[row[0]]];
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].full[0] - row[i - 1].full[2];
      if (gap > NEAT.wide * em) parts.push([row[i]]); else parts[parts.length - 1].push(row[i]);
    }
    const line = { li, baseline: base, segments: [] };
    for (const part of parts) {
      const box = rowBox(part, 1, P, ctx);
      const k = opts.fit === false ? 1 : fitRow(box, (part[part.length - 1].full[2] - part[0].full[0]) / em, P);
      line.segments.push({ x: part[0].full[0], box, units: part, k });
    }
    out.lines.push(line);
  });
  // equals signs written one under another stay one under another
  if (opts.align !== false && !opts.answersOnly) {
    const rel = [];
    for (const line of out.lines) {
      const hits = [];
      line.segments.forEach((seg, si) => seg.box.items.forEach(it => { if (it.u.k === 's' && RELATIONS.has(it.u.label) && seg.units.includes(it.u)) hits.push({ si, it }); }));
      if (hits.length === 1) {
        const { si, it } = hits[0], seg = line.segments[si];
        rel.push({ seg, raw: (it.u.box[0] + it.u.box[2]) / 2, placed: seg.x + (it.x + it.g.w / 2) * em * seg.k });
      }
    }
    if (rel.length >= 2) {
      const mid = median2(rel.map(r => r.raw));
      const close = rel.filter(r => Math.abs(r.raw - mid) < 1.0 * em);
      if (close.length >= 2) for (const r of close) r.seg.x += mid - r.placed;
    }
  }
  for (const line of out.lines) for (const seg of line.segments) for (const it of seg.box.items) {
    const e = em * seg.k;
    out.items.push({ key: it.u.src.join(',') + '|' + it.u.label, src: it.u.src, label: it.u.label, k: it.u.k,
      x: seg.x + it.x * e, y: line.baseline - it.y * e, scale: e, g: it.g });
  }
  if (opts.answers) placeAnswers(out, lines, em, ctx, P, opts);
  return out;
}
// Answers (reading-tree nodes for each line that ends with "=") go just after that "=", on the line's baseline at the
// writer's size: after the "=" as the view shows it, or after the "=" as written (answersOnly, for ink as written).
const ANSWER_AFTER = new Set(['=', '<', '>', '\\le', '\\ge']);   // x = 4, and x < 4 under an inequality
function placeAnswers(out, lines, em, ctx, P, opts) {
  const sample = opts.sample || (l => DEFAULT_GLYPHS[l] || null);
  for (const line of out.lines) {
    const nodes = opts.answers[line.li], row = lines[line.li], eq = row[row.length - 1];
    if (!nodes || !nodes.length || !eq || eq.k !== 's' || !ANSWER_AFTER.has(eq.label) || eq.sup || eq.sub) continue;
    const units = answerUnitsOf(nodes, sample, P.ink);
    if (!units) continue;
    const box = rowBox(units, 1, P, ctx), gap = spaceBetween('rel', 'ord') + (P.ink ? (ctx.gaps || { oo: 0.13 }).oo : 0);
    let x0, e;
    if (opts.answersOnly) { e = em; x0 = eq.box[2] + gap * e; }
    else {
      const seg = line.segments.find(sg => sg.units.includes(eq)), it = seg && seg.box.items.find(q => q.u === eq);
      if (!it) continue;
      e = em * seg.k; x0 = seg.x + (it.x + it.g.w) * e + gap * e;
    }
    box.items.forEach((it, n) => out.items.push({ key: 'ans' + line.li + '|' + n + '|' + it.u.label, src: [], label: it.u.label, k: it.u.k,
      x: x0 + it.x * e, y: line.baseline - it.y * e, scale: e, g: it.g, answer: true, eq: eq.src }));
  }
}
// answer nodes as units: no strokes of their own, a glyph's worth of ink from the sample book for the tidy and hand views
function answerUnitsOf(row, sample, needInk) {
  const out = [];
  for (const n of row) {
    const u = { k: n.k === 's' ? 's' : n.k, label: n.k === 's' ? n.label : n.k === 'frac' || n.k === 'over' ? '-' : '\\sqrt', src: [], answer: true };
    u.pts = u.k === 's' ? sample(u.label) || [] : [];
    if (u.k === 's' && needInk && !u.pts.length) return null;
    u.box = bboxOf(u.pts); u.full = u.box.slice();
    for (const key of ['num', 'den', 'body', 'idx', 'sup', 'sub']) if (n[key]) { u[key] = answerUnitsOf(n[key], sample, needInk); if (!u[key]) return null; }
    out.push(u);
  }
  return out;
}

// ------------------------------------------------------------------ glyphs: the writer's own strokes, tidied
// how big each kind of symbol is (em) and where it sits: by height, width or its larger side; bottom, top or middle
function sizeSpec(l) {
  switch (l) {
    case '-': return { by: 'w', size: 0.5, mid: NEAT.axis };
    case '+': return { by: 'max', size: 0.52, mid: NEAT.axis };
    case '\\pm': return { by: 'max', size: 0.6, mid: NEAT.axis };
    case '=': case '\\ne': return { by: 'w', size: 0.5, mid: NEAT.axis };
    case '\\times': return { by: 'max', size: 0.42, mid: NEAT.axis };
    case '\\div': return { by: 'max', size: 0.5, mid: NEAT.axis };
    case '<': case '>': return { by: 'h', size: 0.48, mid: NEAT.axis };
    case '\\le': case '\\ge': return { by: 'h', size: 0.6, mid: 0.24 };
    case '\\rightarrow': return { by: 'w', size: 0.75, mid: NEAT.axis };
    case '\\cdot': return { by: 'max', size: 0.09, mid: NEAT.axis };
    case ':': return { by: 'h', size: 0.42, mid: NEAT.axis };
    case '.': return { by: 'max', size: 0.1, bottom: 0 };
    case ',': return { by: 'h', size: 0.22, top: 0.07 };
    case ';': return { by: 'h', size: 0.52, top: 0.45 };
    case "'": case '\\prime': return { by: 'h', size: 0.26, top: 0.74 };
    case '\\circ': return { by: 'max', size: 0.22, top: 0.72 };
    case '/': return { by: 'h', size: 0.92, bottom: -0.18 };
    case '\\infty': return { by: 'w', size: 0.78, mid: 0.24 };
    case '$': return { by: 'h', size: 0.86, bottom: -0.09 };
    case 't': return { by: 'h', size: 0.62, bottom: 0 };
    case 'i': return { by: 'h', size: 0.66, bottom: 0 };
    case 'j': return { by: 'h', size: 0.89, bottom: -NEAT.desc };
    case '\\beta': return { by: 'h', size: 0.93, bottom: -NEAT.desc };
    case '\\sum': return { by: 'h', size: 1.0, bottom: -0.25 };
    case '\\int': return { by: 'h', size: 1.3, bottom: -0.4 };
    case '\\sqrt': return { by: 'h', size: 0.9, bottom: -0.1 };
  }
  if (l === '\\lim' || l === '\\log' || l === '\\sin' || l === '\\cos' || l === '\\tan') return { by: 'h', size: 0.72, bottom: 0 };
  const t = symType(l);
  if (t === T_XH) return { by: 'h', size: NEAT.xh, bottom: 0 };
  if (t === T_DESC) return { by: 'h', size: NEAT.xh + NEAT.desc, bottom: -NEAT.desc };
  return { by: 'h', size: NEAT.cap, bottom: 0 };
}
// fit ink (y down, any units) into a spec at scale s: returns paths in em, y up, the ink starting at x = 0
function fitInk(paths, spec, s) {
  const b = bboxOf(paths), w = b[2] - b[0], h = b[3] - b[1], big = Math.max(w, h, 1e-9);
  let dim = spec.by === 'w' ? w : spec.by === 'h' ? h : big;
  if (dim < 0.05 * big) dim = big;                                    // a "1" read as "-": do not blow a hair up
  let k = spec.size * s / dim;
  if (w * k > 3 * s) k = 3 * s / w;                                    // never wider than three em
  const out = paths.map(p => p.map(q => [(q[0] - b[0]) * k, (b[3] - q[1]) * k]));
  const hh = h * k;
  const y0 = spec.mid !== undefined ? spec.mid * s - hh / 2 : spec.top !== undefined ? spec.top * s - hh : spec.bottom * s;
  for (const p of out) for (const q of p) q[1] += y0;
  return { paths: out, w: w * k, h: Math.max(0, y0 + hh), d: Math.max(0, -y0) };
}
// Cleaner strokes: the pen's wobble smoothed away, nearly straight strokes made straight, and those within a few
// degrees of level or upright set exactly level or upright. Point counts are kept, so ink can morph into it.
function tidyPaths(paths, s, square) {
  const gb = bboxOf(paths), big = Math.max(gb[2] - gb[0], gb[3] - gb[1], 0.2 * s);
  return paths.map(p => {
    if (p.length < 2) return p.map(q => q.slice());
    let q = p.length > 2 ? smoothPath(p, 0.014 * s) : p.map(r => r.slice());
    const a = q[0], b = q[q.length - 1], L = pathLen(q), chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > 0.08 * s && chord > 0.965 * L) {
      let dx = (b[0] - a[0]) / chord, dy = (b[1] - a[1]) / chord;
      const ang = Math.abs(Math.atan2(dy, dx)) * 180 / Math.PI;
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      // signs are squared up (a level minus, an upright plus); letters and digits keep the angles they were written at
      if (square && Math.min(ang, 180 - ang) < 7 && chord > 0.5 * big) { dx = Math.sign(dx) || 1; dy = 0; }
      else if (square && Math.abs(ang - 90) < 7 && chord > 0.5 * big) { dx = 0; dy = Math.sign(dy) || 1; }
      q = q.map(r => { const tt = (r[0] - cx) * dx + (r[1] - cy) * dy; return [cx + tt * dx, cy + tt * dy]; });
    }
    return q;
  });
}
// Signs drawn the way they are meant: the two bars of = level, the same length and one above the other; a + with its
// upright through the middle of its bar; the dots of ÷ over the middle of the bar. Point counts are kept.
function squareSign(l, paths) {
  const flat = p => { const b = bboxOf([p]); return (b[2] - b[0]) > 2.5 * (b[3] - b[1]); };
  const upright = p => { const b = bboxOf([p]); return (b[3] - b[1]) > 2.5 * (b[2] - b[0]); };
  const spread = (p, x0, x1) => { const b = bboxOf([p]), w = b[2] - b[0] || 1, y = (b[1] + b[3]) / 2; return p.map(q => [x0 + (q[0] - b[0]) / w * (x1 - x0), y]); };
  if ((l === '=' || l === '\\ne') && paths.length >= 2) {
    const bars = paths.filter(p => p.length >= 2 && flat(p));
    if (bars.length === 2) {
      const b = bboxOf(bars), x0 = b[0], x1 = b[2];
      return paths.map(p => (bars.includes(p) ? spread(p, x0, x1) : p));
    }
  }
  if ((l === '+' || l === '\\pm') && paths.length >= 2) {
    const h = paths.filter(p => p.length >= 2 && flat(p)), v = paths.filter(p => p.length >= 2 && upright(p));
    if (h.length >= 1 && v.length === 1) {
      const hb = bboxOf([h[0]]), vb = bboxOf(v), cx = (hb[0] + hb[2]) / 2, dx = cx - (vb[0] + vb[2]) / 2;
      let out = paths.map(p => (p === v[0] ? p.map(q => [q[0] + dx, q[1]]) : p));
      if (l === '+') { const cy = (vb[1] + vb[3]) / 2, dy = cy - (hb[1] + hb[3]) / 2; out = out.map(p => (p === h[0] ? p.map(q => [q[0], q[1] + dy]) : p)); }
      else if (h.length === 2) { const lower = h[0][0][1] < h[1][0][1] ? h[0] : h[1]; out = out.map(p => (p === lower ? spread(p, hb[0], hb[2]) : p)); }
      return out;
    }
  }
  if (l === '\\div' && paths.length === 3) {
    const bar = paths.find(p => p.length >= 2 && flat(p));
    if (bar) { const bb = bboxOf([bar]), cx = (bb[0] + bb[2]) / 2; return paths.map(p => { if (p === bar) return p; const b = bboxOf([p]), dx = cx - (b[0] + b[2]) / 2; return p.map(q => [q[0] + dx, q[1]]); }); }
  }
  return paths;
}
// the radical's own strokes, split at the corner where the overline starts: the tick is kept, the line redrawn
function radicalParts(paths) {
  const b = bboxOf(paths), h = b[3] - b[1] || 1e-9, w = b[2] - b[0];
  // y up in em: the corner is the leftmost point near the top
  let corner = null;
  for (const p of paths) for (const q of p) if (q[1] > b[3] - 0.12 * h && (!corner || q[0] < corner[0])) corner = q;
  const tick = [];
  const topShare = q => q.filter(r => r[1] > b[3] - 0.2 * h).length / q.length;
  for (const p of paths) {
    const k = p.indexOf(corner);
    // the tick is the side of the corner that is not the overline (radicals are drawn either way round)
    if (k >= 0) { const a = p.slice(0, k + 1), c = p.slice(k); tick.push(topShare(a) <= topShare(c) ? a : c); continue; }
    const pb = bboxOf([p]);
    if (pb[1] > b[3] - 0.2 * h && pb[2] - pb[0] > 0.3 * w) continue;  // a separate overline stroke
    tick.push(p);
  }
  return { tick: tick.filter(p => p.length), corner };
}
// a radical's strokes (ink, y down): the tick fitted into [0, cw] x [low, top], then a straight overline to `total`
function tidyRadical(paths, cw, top, low, total, s) {
  if (!paths.length) return synthRadical(cw, top, low, total);
  const fitted = fitInk(paths, { by: 'h', size: 1, bottom: 0 }, 1).paths;      // y up, normalised
  const { tick, corner } = radicalParts(fitted);
  const tb = bboxOf(tick.length ? tick : fitted);
  const kx = cw / Math.max(tb[2] - tb[0], 1e-9), ky = (top - low) / Math.max(tb[3] - tb[1], 1e-9);
  const map = q => [(q[0] - tb[0]) * kx, low + (q[1] - tb[1]) * ky];
  const out = tick.map(p => p.map(map));
  const c = corner ? map(corner) : [cw, top];
  // the overline continues the stroke that reaches the corner, so the radical stays one stroke
  const joined = out.find(p => p.length && Math.hypot(p[p.length - 1][0] - c[0], p[p.length - 1][1] - c[1]) < 1e-9) ||
    (out.find(p => p.length && Math.hypot(p[0][0] - c[0], p[0][1] - c[1]) < 1e-9) || null);
  if (joined && joined[0] !== joined[joined.length - 1] && Math.hypot(joined[0][0] - c[0], joined[0][1] - c[1]) < 1e-9) joined.reverse();
  if (joined) { joined[joined.length - 1] = [c[0], top]; joined.push([total, top]); }
  else out.push([[c[0], top], [total, top]]);
  return out;
}
function synthRadical(cw, top, low, total) {
  return [[[0, low + 0.45 * (top - low)], [0.18 * cw, low + 0.55 * (top - low)], [0.45 * cw, low], [cw, top], [total, top]]];
}

function tidyProvider(ink) {
  // the unit's strokes in em-space are built once per unit and scale
  const P = {
    ink: true,
    glyph(u, s) {
      const f = fitInk(u.pts, sizeSpec(u.label), s);
      // a dot is a dot: one point, drawn as round as the pen
      if (u.label === '.' || u.label === '\\cdot') {
        const b = bboxOf(f.paths), c = [(b[0] + b[2]) / 2 - b[0], u.label === '.' ? 0.035 * s : NEAT.axis * s];
        return { w: 0.07 * s, h: c[1] + 0.035 * s, d: 0, draw: [{ t: 'ink', paths: [[[0.035 * s, c[1]]]], dot: 0.042 * s }] };
      }
      const paths = squareSign(u.label, tidyPaths(f.paths, s, NEAT_OPS.has(u.label) || u.label === '/'));
      return { w: f.w, h: f.h, d: f.d, draw: [{ t: 'ink', paths }] };
    },
    bar(u, W, s) {
      // the bar as drawn, made straight and level and as long as the fraction needs
      const y = 0;
      return { w: W, h: 0, d: 0, draw: [{ t: 'ink', paths: [[[0, y], [W, y]]] }], bar: true };
    },
    fence(u, h, d, s) {
      const f = fitInk(u.pts, { by: 'h', size: (h + d) / s, bottom: -d / s }, s);
      // tall brackets: grow upright, widen only a little
      const b = bboxOf(u.pts), aspect = (b[2] - b[0]) / Math.max(b[3] - b[1], 1e-9);
      const wNat = Math.min(aspect * NEAT.cap * 1.07 * s, 0.45 * s), kx = f.w > 0 ? Math.max(wNat, Math.min(f.w, 0.6 * s)) / f.w : 1;
      const paths = tidyPaths(f.paths.map(p => p.map(q => [q[0] * kx, q[1]])), s, true);
      return { w: f.w * kx, h, d, draw: [{ t: 'ink', paths }] };
    },
    radical(u, cw, top, low, total, s) {
      return { w: total, h: top, d: -low, draw: [{ t: 'ink', paths: tidyRadical(u.pts, cw, top, low, total, s) }] };
    },
  };
  return P;
}

// ------------------------------------------------------------------ glyphs for answers: whose handwriting to borrow
// An answer has no strokes of its own. Its symbols are drawn with the writer's own: the clearest of each symbol
// already on the board, else the same character from their Replicator handwriting, else a plain built-in hand.
// Built-in hand: control points in a box one unit tall (y down, baseline at 1), joined smoothly; '|' starts a
// sharp corner, ';' a new stroke.
const DEFAULT_HAND = {
  '0': 'o', '1': '0.1 0.2 0.22 0.1 0.34 0|0.34 0 0.34 0.5 0.34 1',
  '2': '0.04 0.24 0.14 0.06 0.32 0 0.5 0.08 0.55 0.26 0.45 0.48 0.24 0.72 0.02 0.99|0.02 0.99 0.3 0.99 0.58 0.99',
  '3': '0.06 0.1 0.26 0 0.46 0.06 0.52 0.22 0.42 0.38 0.24 0.46|0.24 0.46 0.46 0.54 0.56 0.72 0.5 0.9 0.3 1 0.08 0.94 0.02 0.86',
  '4': '0.4 0 0.21 0.33 0.02 0.66|0.02 0.66 0.31 0.66 0.6 0.66;0.46 0.28 0.46 0.64 0.46 1',
  '5': '0.52 0.02 0.32 0.02 0.12 0.02|0.12 0.02 0.1 0.23 0.08 0.44|0.08 0.44 0.3 0.36 0.5 0.44 0.56 0.66 0.48 0.88 0.28 1 0.04 0.92',
  '6': '0.48 0.02 0.28 0.16 0.1 0.42 0.04 0.7 0.12 0.92 0.3 1 0.5 0.9 0.54 0.7 0.44 0.54 0.26 0.52 0.08 0.64',
  '7': '0.02 0.02 0.3 0.02 0.58 0.02|0.58 0.02 0.46 0.3 0.34 0.62 0.24 1',
  '8': '0.48 0.14 0.3 0 0.1 0.1 0.1 0.3 0.3 0.46 0.5 0.6 0.54 0.82 0.32 1 0.08 0.88 0.08 0.66 0.28 0.48 0.46 0.32 0.48 0.14',
  '9': '0.52 0.12 0.36 0 0.14 0.06 0.06 0.24 0.18 0.42 0.4 0.42 0.54 0.26|0.54 0.26 0.54 0.62 0.54 1',
  '.': '0.05 0.98', '-': '0 0.5 0.25 0.5 0.5 0.5', '+': '0 0.5 0.25 0.5 0.5 0.5;0.25 0.25 0.25 0.5 0.25 0.75',
  '\\pm': '0 0.4 0.25 0.4 0.5 0.4;0.25 0.15 0.25 0.4 0.25 0.65;0 0.84 0.25 0.84 0.5 0.84',
  ',': '0.1 0.86 0.11 0.96 0.04 1.12',
  // letters, for an answer with a letter the board has no clear one of (y = −2/3 x + 4 under an equation written
  // further up): small letters from 0.35 (x-height) to 1, tall ones from 0, tails to 1.3
  a: '0.5 0.5 0.36 0.37 0.16 0.42 0.06 0.66 0.14 0.92 0.34 0.99 0.5 0.86;0.5 0.38 0.5 0.7 0.52 1',
  b: '0.08 0 0.08 0.5 0.08 1;0.08 0.6 0.26 0.38 0.46 0.44 0.54 0.68 0.46 0.92 0.26 1 0.08 0.9',
  c: '0.5 0.45 0.34 0.36 0.14 0.42 0.04 0.66 0.12 0.9 0.32 1 0.52 0.92',
  d: '0.48 0.5 0.34 0.37 0.14 0.42 0.04 0.66 0.12 0.92 0.32 0.99 0.48 0.86;0.5 0 0.5 0.5 0.5 1',
  e: '0.06 0.68 0.3 0.68 0.52 0.66|0.52 0.66 0.48 0.44 0.3 0.36 0.1 0.44 0.04 0.68 0.12 0.92 0.32 1 0.52 0.92',
  f: '0.5 0.06 0.38 0 0.24 0.06 0.2 0.3 0.2 1;0.04 0.4 0.22 0.4 0.42 0.4',
  g: '0.48 0.5 0.34 0.37 0.14 0.42 0.04 0.62 0.14 0.82 0.34 0.86 0.48 0.72;0.5 0.38 0.5 0.9 0.48 1.16 0.3 1.3 0.08 1.22',
  h: '0.08 0 0.08 0.5 0.08 1;0.08 0.62 0.24 0.38 0.44 0.4 0.5 0.6|0.5 0.6 0.5 0.8 0.5 1',
  i: '0.1 0.38 0.1 0.7 0.1 1;0.1 0.12 0.1 0.17',
  j: '0.3 0.38 0.3 0.9 0.28 1.16 0.14 1.3 0 1.22;0.3 0.12 0.3 0.17',
  k: '0.08 0 0.08 0.5 0.08 1;0.46 0.38 0.27 0.56 0.08 0.72;0.2 0.62 0.34 0.8 0.5 1',
  l: '0.1 0 0.1 0.6 0.12 0.9 0.22 1 0.3 0.96',
  m: '0.06 0.38 0.06 0.7 0.06 1;0.06 0.55 0.16 0.38 0.3 0.4 0.34 0.6|0.34 0.6 0.34 0.8 0.34 1;0.34 0.55 0.44 0.38 0.58 0.4 0.62 0.6|0.62 0.6 0.62 0.8 0.62 1',
  n: '0.08 0.38 0.08 0.7 0.08 1;0.08 0.58 0.22 0.38 0.42 0.4 0.48 0.6|0.48 0.6 0.48 0.8 0.48 1',
  o: '0.28 0.36 0.08 0.44 0.03 0.68 0.12 0.92 0.28 1 0.46 0.92 0.54 0.68 0.48 0.44 0.28 0.36',
  p: '0.08 0.38 0.08 0.85 0.08 1.3;0.08 0.55 0.26 0.37 0.46 0.42 0.54 0.66 0.46 0.9 0.26 0.98 0.08 0.88',
  q: '0.48 0.5 0.34 0.37 0.14 0.42 0.04 0.66 0.12 0.92 0.32 0.99 0.48 0.86;0.5 0.38 0.5 0.85 0.5 1.3',
  r: '0.08 0.38 0.08 0.7 0.08 1;0.08 0.6 0.2 0.4 0.36 0.36 0.46 0.4',
  s: '0.46 0.42 0.3 0.36 0.1 0.42 0.1 0.56 0.28 0.66 0.46 0.76 0.46 0.92 0.28 1 0.06 0.94',
  t: '0.22 0.1 0.22 0.6 0.22 0.88 0.3 1 0.44 0.96;0.04 0.38 0.22 0.38 0.42 0.38',
  u: '0.06 0.38 0.06 0.7 0.12 0.92 0.28 1 0.44 0.92 0.5 0.7;0.5 0.38 0.5 0.7 0.5 1',
  v: '0.02 0.38 0.14 0.69 0.26 1|0.26 1 0.38 0.69 0.5 0.38',
  w: '0.02 0.38 0.1 0.69 0.18 1|0.18 1 0.26 0.69 0.34 0.5|0.34 0.5 0.42 0.75 0.5 1|0.5 1 0.58 0.69 0.66 0.38',
  x: '0.04 0.38 0.27 0.69 0.5 1;0.5 0.38 0.27 0.69 0.04 1',
  y: '0.04 0.38 0.16 0.62 0.28 0.86;0.52 0.38 0.32 0.84 0.16 1.3',
  z: '0.04 0.38 0.27 0.38 0.5 0.38|0.5 0.38 0.27 0.69 0.04 1|0.04 1 0.27 1 0.5 1',
  A: '0.02 1 0.17 0.5 0.32 0|0.32 0 0.47 0.5 0.62 1;0.13 0.66 0.32 0.66 0.51 0.66',
  B: '0.08 0 0.08 0.5 0.08 1;0.08 0 0.36 0 0.5 0.1 0.5 0.26 0.36 0.46 0.08 0.48|0.08 0.48 0.4 0.5 0.56 0.62 0.56 0.84 0.4 1 0.08 1',
  C: '0.6 0.14 0.42 0 0.2 0.06 0.06 0.3 0.06 0.7 0.2 0.94 0.42 1 0.6 0.88',
  D: '0.08 0 0.08 0.5 0.08 1;0.08 0 0.34 0.02 0.54 0.2 0.6 0.5 0.54 0.8 0.34 0.98 0.08 1',
  E: '0.54 0 0.31 0 0.08 0|0.08 0 0.08 0.5 0.08 1|0.08 1 0.31 1 0.54 1;0.08 0.5 0.27 0.5 0.46 0.5',
  F: '0.54 0 0.31 0 0.08 0|0.08 0 0.08 0.5 0.08 1;0.08 0.5 0.27 0.5 0.46 0.5',
  G: '0.6 0.14 0.42 0 0.2 0.06 0.06 0.3 0.06 0.7 0.2 0.94 0.42 1 0.6 0.88|0.6 0.88 0.6 0.72 0.6 0.56|0.6 0.56 0.49 0.56 0.38 0.56',
  H: '0.08 0 0.08 0.5 0.08 1;0.56 0 0.56 0.5 0.56 1;0.08 0.5 0.32 0.5 0.56 0.5',
  I: '0.2 0 0.2 0.5 0.2 1;0.04 0 0.2 0 0.36 0;0.04 1 0.2 1 0.36 1',
  J: '0.5 0 0.5 0.5 0.5 0.78 0.4 0.96 0.24 1 0.08 0.9',
  K: '0.08 0 0.08 0.5 0.08 1;0.56 0 0.32 0.3 0.08 0.62;0.24 0.44 0.4 0.72 0.58 1',
  L: '0.08 0 0.08 0.5 0.08 1|0.08 1 0.3 1 0.52 1',
  M: '0.06 1 0.06 0.5 0.06 0|0.06 0 0.2 0.35 0.35 0.7|0.35 0.7 0.5 0.35 0.64 0|0.64 0 0.64 0.5 0.64 1',
  N: '0.08 1 0.08 0.5 0.08 0|0.08 0 0.32 0.5 0.56 1|0.56 1 0.56 0.5 0.56 0',
  O: '0.34 0 0.12 0.1 0.04 0.5 0.12 0.9 0.34 1 0.56 0.9 0.64 0.5 0.56 0.1 0.34 0',
  P: '0.08 1 0.08 0.5 0.08 0|0.08 0 0.36 0 0.52 0.1 0.54 0.28 0.4 0.48 0.08 0.5',
  Q: '0.34 0 0.12 0.1 0.04 0.5 0.12 0.9 0.34 1 0.56 0.9 0.64 0.5 0.56 0.1 0.34 0;0.36 0.7 0.5 0.86 0.66 1',
  R: '0.08 1 0.08 0.5 0.08 0|0.08 0 0.36 0 0.52 0.1 0.54 0.28 0.4 0.48 0.08 0.5;0.26 0.5 0.42 0.75 0.58 1',
  S: '0.54 0.12 0.36 0 0.14 0.04 0.08 0.22 0.2 0.4 0.4 0.52 0.56 0.68 0.52 0.9 0.32 1 0.06 0.9',
  T: '0.02 0 0.3 0 0.58 0;0.3 0 0.3 0.5 0.3 1',
  U: '0.06 0 0.06 0.5 0.08 0.8 0.2 0.97 0.32 1 0.46 0.96 0.56 0.8 0.58 0.5 0.58 0',
  V: '0.02 0 0.17 0.5 0.32 1|0.32 1 0.47 0.5 0.62 0',
  W: '0.02 0 0.12 0.5 0.22 1|0.22 1 0.32 0.6 0.42 0.2|0.42 0.2 0.52 0.6 0.62 1|0.62 1 0.72 0.5 0.82 0',
  X: '0.04 0 0.31 0.5 0.58 1;0.58 0 0.31 0.5 0.04 1',
  Y: '0.02 0 0.16 0.25 0.3 0.5|0.3 0.5 0.44 0.25 0.58 0;0.3 0.5 0.3 0.75 0.3 1',
  Z: '0.04 0 0.3 0 0.56 0|0.56 0 0.3 0.5 0.04 1|0.04 1 0.3 1 0.56 1',
};
// Catmull-Rom through the points, 7 samples per span
function crPath(pts) {
  if (pts.length < 3) return pts.map(p => p.slice());
  const out = [pts[0].slice()];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 1; k <= 7; k++) {
      const t = k / 7, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  return out;
}
const DEFAULT_GLYPHS = {};
for (const ch of Object.keys(DEFAULT_HAND)) {
  if (DEFAULT_HAND[ch] === 'o') {                           // an oval from the top, round to the left and back
    const p = []; for (let i = 0; i <= 26; i++) { const a = i / 26 * (2 * Math.PI + 0.2); p.push([0.3 - 0.27 * Math.sin(a), 0.5 - 0.5 * Math.cos(a)]); }
    DEFAULT_GLYPHS[ch] = [p]; continue;
  }
  DEFAULT_GLYPHS[ch] = DEFAULT_HAND[ch].split(';').map(stroke => {
    const out = [];
    for (const piece of stroke.split('|')) {
      const v = piece.trim().split(/\s+/).map(Number), pts = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
      const q = crPath(pts);
      if (out.length) q.shift();                              // the corner point is already there
      out.push(...q);
    }
    return out;
  });
}
// label -> strokes (y down, any units) to draw an answer's symbol with
function sampleBook(res, input, hand) {
  const ink = inkOf(input), best = new Map();
  for (const sy of (res && res.symbols) || []) {
    const c = sy.candidates && sy.candidates[0], p = sy.fixed ? 1 : c && c[0] === sy.label ? c[1] : 0;
    const pts = sy.strokes.map(i => ink[i] || []).filter(q => q.length);
    if (!pts.length) continue;
    const b = best.get(sy.label);
    if (!b || p > b.p) best.set(sy.label, { p, pts });
  }
  return label => {
    const b = best.get(label);
    if (b && b.p >= 0.6) return b.pts;
    const ch = HAND_CHAR[label] || label;
    if (hand && hand[ch] && hand[ch].length) return hand[ch];
    if (b && /^[A-Za-z]$/.test(label)) return b.pts;   // a letter of the question, however it was written, before the built-in one
    if (DEFAULT_GLYPHS[label]) return DEFAULT_GLYPHS[label];
    return b ? b.pts : null;                      // a letter of the question, however it was written
  };
}

// ------------------------------------------------------------------ glyphs: the writer's Replicator handwriting
// A hand is the Replicator's saved file: {glyphs: {char: [strokes in box space 0..1]}}. Box space maps to em as the
// font does: 1.1 em wide, 1.25 em tall with the baseline 0.95 em below the top; cap height 0.7 em.
const HAND_CHAR = { '\\times': '×', '\\div': '÷', '\\pm': '±', '\\ne': '≠', '\\le': '≤', '\\ge': '≥', '\\pi': 'π', '\\theta': 'θ',
  '\\infty': '∞', '\\sqrt': '√', '\\circ': '°', '\\{': '{', '\\}': '}', '\\prime': "'", '\\cdot': '.', '\\rightarrow': '→' };
const HAND_KEY = 'nib-hand-v1';
const HAND = { glyphs: null, name: '', loaded: false };
function handClean(g) {
  const out = {};
  if (!g || typeof g !== 'object' || Array.isArray(g)) return out;
  for (const ch of Object.keys(g)) {
    if (typeof ch !== 'string' || [...ch].length !== 1) continue;
    const st = [];
    for (const s of Array.isArray(g[ch]) ? g[ch] : []) {
      if (!Array.isArray(s)) continue;
      const q = s.filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && p[0] !== null && p[1] !== null).map(p => [+p[0], +p[1]]);
      if (q.length) st.push(q);
    }
    if (st.length) out[ch] = st;
  }
  return out;
}
// a Replicator file's letters as its font draws them: the box drawings, with the letters also written in sentences
// replaced by their average (kept beside them as avg); a plain {char: strokes} map is taken as it is
function handOf(d) {
  if (!d || typeof d !== 'object') return d;
  if (!d.glyphs || typeof d.glyphs !== 'object') return d;
  const avg = d.avg && typeof d.avg === 'object' && !Array.isArray(d.avg) && d.useSamples !== false ? handClean(d.avg) : null;
  return avg && Object.keys(avg).length ? Object.assign({}, d.glyphs, avg) : d.glyphs;
}
// The handwriting in this browser: a file opened in Nib (kept under HAND_KEY) or the Replicator's own work, when it
// was opened in this browser too — whichever was saved last, so letters redone in the Replicator are never hidden
// by an older file.
function handLoad() {
  if (HAND.loaded) return HAND.glyphs;
  HAND.loaded = true; HAND.glyphs = null; HAND.name = '';
  if (typeof localStorage === 'undefined') return null;
  const read = k => { try { const d = JSON.parse(localStorage.getItem(k) || 'null'); return d && typeof d === 'object' && d.glyphs ? d : null; } catch (e) { return null; } };
  const when = d => (typeof d.saved === 'number' && isFinite(d.saved) ? d.saved : 0);
  const found = [read(HAND_KEY), read('replicator-v1')].filter(Boolean).sort((x, y) => when(y) - when(x));
  for (const d of found) {
    const g = handClean(handOf(d));
    if (Object.keys(g).length) { HAND.glyphs = g; HAND.name = typeof d.name === 'string' ? d.name : ''; break; }
  }
  return HAND.glyphs;
}
function handSet(data) {
  const g = handClean(handOf(data));
  if (!Object.keys(g).length) throw new Error('no handwriting in that data');
  HAND.glyphs = g; HAND.name = data && typeof data.name === 'string' ? data.name : ''; HAND.loaded = true;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(HAND_KEY, JSON.stringify({ name: HAND.name, saved: Date.now(), glyphs: g })); } catch (e) { /* full or blocked: kept for this page */ }
  HAND.version = (HAND.version || 0) + 1;
  return Object.keys(g).length;
}
// pads showing handwriting redraw when it changes: here, or in another page of the same site (the Replicator)
function handNotify() { try { if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') window.dispatchEvent(new CustomEvent('nib:hand')); } catch (e) { /* ok */ } }
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', e => { if (e.key === HAND_KEY || e.key === 'replicator-v1' || e.key === null) { HAND.loaded = false; HAND.glyphs = null; HAND.name = ''; handNotify(); } });
}
// a glyph from the hand: em, y up, the ink starting at x = 0; lined up with the guides as the Replicator does
function handGlyph(st, ch) {
  const paths = st.map(s => s.map(p => [p[0] * 1.1, 0.95 - 1.25 * p[1]]));
  const b = bboxOf(paths);
  let dy = 0;
  const floating = "'\"-_*^~°=+×÷±≠≈<>≤≥∞:".includes(ch);
  if (!floating) {
    if (/^[gjpqy]$/.test(ch)) { if (ch !== 'j' && Math.abs(b[3] - NEAT.xh) < 0.1) dy = NEAT.xh - b[3]; }
    else if (Math.abs(b[1]) < 0.1) dy = -b[1];
  }
  const out = paths.map(p => p.map(q => [q[0] - b[0], q[1] + dy]));
  return { paths: out, w: b[2] - b[0], h: Math.max(0, b[3] + dy), d: Math.max(0, -(b[1] + dy)) };
}
function handProvider(glyphs) {
  const T = tidyProvider();
  const has = ch => glyphs && glyphs[ch] && glyphs[ch].length;
  const smoothAll = (paths, s) => paths.map(p => (p.length > 2 ? smoothPath(p, 0.01 * s) : p));
  return {
    ink: true,
    glyph(u, s) {
      const ch = HAND_CHAR[u.label] || u.label;
      if (!has(ch) || u.k !== 's') return T.glyph(u, s);
      const g = handGlyph(glyphs[ch], ch);
      let paths = g.paths.map(p => p.map(q => [q[0] * s, q[1] * s])), w = g.w * s, h = g.h * s, d = g.d * s;
      if (u.label === '\\cdot') {                                     // the full stop, lifted to the middle
        const b = bboxOf(paths), lift = NEAT.axis * s - (b[1] + b[3]) / 2;
        paths = paths.map(p => p.map(q => [q[0], q[1] + lift])); h = Math.max(0, b[3] + lift); d = Math.max(0, -(b[1] + lift));
      }
      return { w, h, d, draw: [{ t: 'ink', paths: smoothAll(paths, s) }], hand: true };
    },
    bar(u, W, s) {
      if (!has('-')) return T.bar(u, W, s);
      const g = handGlyph(glyphs['-'], '-'), b = bboxOf(g.paths), my = (b[1] + b[3]) / 2, kx = W / Math.max(g.w, 1e-9);
      return { w: W, h: 0, d: 0, draw: [{ t: 'ink', paths: g.paths.map(p => p.map(q => [q[0] * kx, (q[1] - my) * s * 0.6])) }], bar: true };
    },
    fence(u, h, d, s) {
      const ch = HAND_CHAR[u.label] || u.label;
      if (!has(ch)) return T.fence(u, h, d, s);
      const g = handGlyph(glyphs[ch], ch), gh = Math.max(g.h + g.d, 1e-9), ky = (h + d) / gh, kx = Math.min(ky, s * 1.25);
      const paths = g.paths.map(p => p.map(q => [q[0] * kx, (q[1] + g.d) * ky - d]));
      return { w: g.w * kx, h, d, draw: [{ t: 'ink', paths: smoothAll(paths, s) }], hand: true };
    },
    radical(u, cw, top, low, total, s) {
      if (!has('√')) return T.radical(u, cw, top, low, total, s);
      const g = handGlyph(glyphs['√'], '√');
      return { w: total, h: top, d: -low, draw: [{ t: 'ink', paths: smoothAll(tidyRadical(g.paths.map(p => p.map(q => [q[0], -q[1]])), cw, top, low, total, s), s) }], hand: true };
    },
  };
}

// ------------------------------------------------------------------ glyphs: typeset (KaTeX's fonts and metrics)
// fonts: 'm' KaTeX_Main (upright), 'i' KaTeX_Math (italic letters), 's' KaTeX_Size1 (big operators)
const TYPE_CHAR = { '-': '−', '\\times': '×', '\\div': '÷', '\\pm': '±', '\\le': '≤', '\\ge': '≥', '\\ne': '=',
  '\\cdot': '⋅', '\\rightarrow': '→', '\\in': '∈', '\\infty': '∞', '\\prime': '′', "'": '′', '\\circ': '∘',
  '\\pi': 'π', '\\theta': 'θ', '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\lambda': 'λ', '\\mu': 'μ',
  '\\sigma': 'σ', '\\phi': 'ϕ', '\\Delta': 'Δ', '\\sum': '∑', '\\int': '∫', '\\{': '{', '\\}': '}', '\\forall': '∀',
  '\\exists': '∃', '\\ldots': '…', '\\lim': 'lim', '\\log': 'log', '\\sin': 'sin', '\\cos': 'cos', '\\tan': 'tan', '\\sqrt': '√' };
function typeFont(l) {
  if (l === '\\sum' || l === '\\int') return 's';
  if (/^[A-Za-z]$/.test(l) || /^\\(pi|theta|alpha|beta|gamma|lambda|mu|sigma|phi)$/.test(l)) return 'i';
  return 'm';
}
// metrics of one string: [depth, height, italic, width] in em from the embedded KaTeX tables (rough fallback if absent)
function typeMetrics(text, font) {
  const T = DATA && DATA.tsfm ? DATA.tsfm[font] : null;
  let w = 0, h = 0, d = 0, it = 0;
  for (const ch of text) {
    const m = T && T[ch.codePointAt(0)];
    if (m) { d = Math.max(d, m[0]); h = Math.max(h, m[1]); it = m[2]; w += m[3]; }
    else { h = Math.max(h, 0.68); w += 0.55; it = 0; }
  }
  return { w, h, d, italic: it };
}
function typeProvider() {
  return {
    ink: false,
    glyph(u, s) {
      const l = u.label, text = TYPE_CHAR[l] || l, font = typeFont(l);
      const m = typeMetrics(text, font);
      const draw = [{ t: 'text', text, font, size: s, x: 0, y: 0 }];
      if (l === '\\ne') draw.push({ t: 'line', width: 0.04 * s, paths: [[[m.w * 0.62 * s, -0.12 * s], [m.w * 0.38 * s, 0.62 * s]]] });   // = with a stroke through it
      return { w: m.w * s, h: m.h * s, d: m.d * s, italic: m.italic * s, draw };
    },
    bar(u, W, s) { return { w: W, h: 0.02 * s, d: 0.02 * s, draw: [{ t: 'rule', x: 0, y: -0.02 * s, w: W, h: 0.04 * s }], bar: true }; },
    fence(u, h, d, s) {
      const text = TYPE_CHAR[u.label] || u.label, m = typeMetrics(text, 'm');
      const nat = (m.h + m.d) * s, k = Math.max(1, (h + d) / Math.max(nat, 1e-9));
      // a taller bracket is the same glyph drawn taller; its middle stays on the line of maths
      const mid = (h - d) / 2, nmid = (m.h - m.d) * s / 2;
      return { w: m.w * s * Math.min(k, 1.4) ** 0.35, h: Math.max(h, m.h * s), d: Math.max(d, m.d * s),
        draw: [{ t: 'text', text, font: 'm', size: s, x: 0, y: mid - nmid * k, sx: Math.min(k, 1.4) ** 0.35, sy: k }] };
    },
    radical(u, cw, top, low, total, s) {
      const H = top - low, lw = 0.04 * s;
      return { w: total, h: top + lw, d: -low, draw: [
        { t: 'line', width: lw * 0.9, paths: [[[0.04 * cw, low + 0.4 * H], [0.2 * cw, low + 0.48 * H]]] },
        { t: 'line', width: lw * 2.1, paths: [[[0.2 * cw, low + 0.48 * H], [0.47 * cw, low + 0.02 * H]]] },
        { t: 'line', width: lw, paths: [[[0.47 * cw, low], [cw, top], [total, top]]] },
      ] };
    },
  };
}

// ------------------------------------------------------------------ from a plan to drawable ink (y down)
// Each item becomes {key, src, label, box: [x0, y0, x1, y1], parts: [...]} with parts in ink coordinates:
//   {t: 'ink', paths}  {t: 'text', text, font, x, y, size, sx, sy}  {t: 'rule', x, y, w, h}  {t: 'line', paths, width}
function drawablesOf(plan) {
  return plan.items.map(it => {
    const e = it.scale, X = v => it.x + v * e, Y = v => it.y - v * e;
    const parts = it.g.draw.map(p => {
      if (p.t === 'ink' || p.t === 'line') return Object.assign({ t: p.t, paths: p.paths.map(s => s.map(q => [X(q[0]), Y(q[1])])) }, p.width ? { width: p.width * e } : {}, p.dot ? { dot: p.dot * e } : {});
      if (p.t === 'text') return { t: 'text', text: p.text, font: p.font, x: X(p.x), y: Y(p.y), size: p.size * e, sx: p.sx || 1, sy: p.sy || 1 };
      return { t: 'rule', x: X(p.x), y: Y(p.y + p.h), w: p.w * e, h: p.h * e };
    });
    const g = it.g;
    const d = { key: it.key, src: it.src, label: it.label, parts, box: [X(0), Y(g.h), X(g.w), Y(-g.d)] };
    if (it.answer) { d.answer = true; d.eq = it.eq; }
    return d;
  });
}
// all the ink paths of a plan in one list (tidy and hand plans), for a page or a test to use as strokes
function pathsOf(items) {
  const out = [];
  for (const it of items) for (const p of it.parts) if (p.t === 'ink') for (const s of p.paths) out.push(s);
  return out;
}

// Nib.neaten / Nib.typeset: recognise (or take options.result), then lay out in place
function inPlace(strokes, style, options) {
  const o = Object.assign({}, options || {});
  const res = o.result || defaultRecognizer().recognize(strokes, o);
  const g = style === 'hand' || o.solve || o.answers ? (o.hand ? handClean(handOf(o.hand)) : handLoad()) : null;
  let P;
  if (style === 'typeset') P = typeProvider();
  else if (style === 'hand') P = handProvider(g && Object.keys(g).length ? g : null);
  else P = tidyProvider();
  let answers = null;
  if (o.solve && !o.answers && res && res.tree) answers = solveRows(res.tree, o);
  if (answers) o.answers = answers.map(a => a && a.nodes);
  if (o.answers && !o.sample) o.sample = sampleBook(res, strokes, g);
  if (style === 'ink') o.answersOnly = true;
  const plan = planOf(res, strokes, P, o);
  let items = drawablesOf(plan);
  if (o.answersOnly) items = items.map(it => unlevel(it, plan.t || 0, plan.c0 || 0));
  const out = { style, latex: res ? res.latex : '', result: res, em: plan.em, skew: plan.skew, items, strokes: style === 'typeset' ? [] : pathsOf(items.filter(it => !it.answer)) };
  if (answers) out.answers = answers;
  return out;
}
// an item laid out on the levelled line, put back on the line as written (the slope sheared back in)
function unlevel(it, t, c0) {
  if (!t) return it;
  const Y = (x, y) => y + t * (x - c0);
  const parts = it.parts.map(p => {
    if (p.t === 'ink' || p.t === 'line') return Object.assign({}, p, { paths: p.paths.map(s => s.map(q => [q[0], Y(q[0], q[1])])) });
    if (p.t === 'text') return Object.assign({}, p, { y: Y(p.x, p.y) });
    return Object.assign({}, p, { y: Y(p.x + p.w / 2, p.y) });
  });
  const b = it.box, y0 = Math.min(Y(b[0], b[1]), Y(b[2], b[1])), y1 = Math.max(Y(b[0], b[3]), Y(b[2], b[3]));
  return Object.assign({}, it, { parts, box: [b[0], y0, b[2], y1] });
}

// ------------------------------------------------------------------ drawing (browser)
const TYPE_FAMILY = { m: 'Nib KaTeX Main', i: 'Nib KaTeX Math', s: 'Nib KaTeX Size1' };
let TYPE_FONTS = null;
// registers the embedded KaTeX fonts once; resolves when they can be drawn with
function typeFontsReady() {
  if (TYPE_FONTS) return TYPE_FONTS;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts || !DATA || !DATA.tsfont) return (TYPE_FONTS = Promise.resolve(false));
  TYPE_FONTS = Promise.all(Object.keys(TYPE_FAMILY).map(k => {
    const face = new FontFace(TYPE_FAMILY[k], b64bytes(DATA.tsfont[k]));
    return face.load().then(f => { document.fonts.add(f); return true; });
  })).then(() => true, () => false);
  return TYPE_FONTS;
}
// Draws drawable items on a 2D context (ink coordinates). o: {ink: colour, width: pen width, alpha}
function drawItems(ctx, items, o) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = o.ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  for (const it of items) for (const p of it.parts) {
    if (p.t === 'ink') {
      ctx.lineWidth = o.width;
      for (const s of p.paths) strokePath(ctx, s, s.length === 1 && p.dot ? Math.max(ctx.lineWidth, 2 * p.dot) : ctx.lineWidth);
    } else if (p.t === 'line') {                  // typeset rules: straight, crisp corners
      ctx.save(); ctx.lineWidth = p.width; ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
      for (const s of p.paths) { ctx.beginPath(); s.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke(); }
      ctx.restore();
    } else if (p.t === 'text') {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.sx !== 1 || p.sy !== 1) ctx.scale(p.sx, p.sy);
      ctx.font = `${p.size}px "${TYPE_FAMILY[p.font] || TYPE_FAMILY.m}", "Cambria Math", "Times New Roman", serif`;
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    } else if (p.t === 'rule') ctx.fillRect(p.x, p.y, p.w, Math.max(p.h, 1));
  }
  ctx.restore();
}
function strokePath(ctx, s, w) {
  if (!s.length) return;
  if (s.length === 1) { ctx.beginPath(); ctx.arc(s[0][0], s[0][1], w / 2, 0, Math.PI * 2); ctx.fill(); return; }
  ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]);
  for (let i = 1; i < s.length - 1; i++) ctx.quadraticCurveTo(s[i][0], s[i][1], (s[i][0] + s[i + 1][0]) / 2, (s[i][1] + s[i + 1][1]) / 2);
  ctx.lineTo(s[s.length - 1][0], s[s.length - 1][1]);
  ctx.stroke();
}

// ------------------------------------------------------------------ animation and hit testing (the pad's views)
function rawVisual(strokes) {
  const paths = strokes.map(s => s.map(q => [q[0], q[1]]));
  return { parts: [{ t: 'ink', paths }], box: bboxOf(paths), from: strokes };
}
function inkOnly(V) {
  const out = [];
  for (const p of V.parts) { if (p.t !== 'ink') return null; out.push(...p.paths); }
  return out;
}
// a visual moved from box a to box b (each axis scaled on its own; a dot just moves)
function mapVisual(V, a, b) {
  const wa = a[2] - a[0], ha = a[3] - a[1];
  let sx = wa > 1e-6 ? (b[2] - b[0]) / wa : NaN, sy = ha > 1e-6 ? (b[3] - b[1]) / ha : NaN;
  if (!isFinite(sx)) sx = isFinite(sy) ? sy : 1;
  if (!isFinite(sy)) sy = sx;
  const X = x => b[0] + (x - a[0]) * sx, Y = y => b[1] + (y - a[1]) * sy;
  return {
    parts: V.parts.map(p => {
      if (p.t === 'ink' || p.t === 'line') return Object.assign({}, p, { paths: p.paths.map(s => s.map(q => [X(q[0]), Y(q[1])])), width: p.width ? p.width * Math.sqrt(Math.abs(sx * sy)) : p.width });
      if (p.t === 'text') return Object.assign({}, p, { x: X(p.x), y: Y(p.y), size: p.size * sy, sx: (p.sx || 1) * sx / sy });
      return Object.assign({}, p, { x: X(p.x), y: Y(p.y), w: p.w * sx, h: p.h * sy });
    }),
  };
}
// one frame of the change from A to B (e from 0 to 1): the same strokes move point by point; anything else glides
// to a box between the two while one fades out and the other fades in
function morphDraw(ctx, A, B, e, ink, width) {
  const pa = inkOnly(A), pb = inkOnly(B);
  if (pa && pb && pa.length === pb.length && pa.every((s, i) => s.length === pb[i].length)) {
    const paths = pa.map((s, i) => s.map((q, j) => [q[0] + (pb[i][j][0] - q[0]) * e, q[1] + (pb[i][j][1] - q[1]) * e]));
    drawItems(ctx, [{ parts: [{ t: 'ink', paths }] }], { ink, width });
    return;
  }
  const ba = A.box, bb = B.box, box = ba.map((v, i) => v + (bb[i] - v) * e);
  drawItems(ctx, [mapVisual(A, ba, box)], { ink, width, alpha: 1 - e });
  drawItems(ctx, [mapVisual(B, bb, box)], { ink, width, alpha: e });
}
// distance from point q to the segment a-b
function segDist(q, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
}
// is point p within r of a stroke (its segments, or the point itself for a dot)?
function strokeNear(s, p, r) {
  if (!s.length) return false;
  if (s.length === 1) return Math.hypot(s[0][0] - p[0], s[0][1] - p[1]) < r;
  for (let i = 0; i + 1 < s.length; i++) if (segDist(p, s[i], s[i + 1]) < r) return true;
  return false;
}
// is point p within r of what an item shows?
function itemNear(it, p, r) {
  for (const part of it.parts) {
    if (part.t === 'ink' || part.t === 'line') {
      for (const s of part.paths) if (strokeNear(s, p, r)) return true;
    } else {
      const b = it.box, m = r / 2;
      if (p[0] > b[0] - m && p[0] < b[2] + m && p[1] > b[1] - m && p[1] < b[3] + m) return true;
    }
  }
  return false;
}
// drawable parts moved by X, Y (point maps) and scaled by k (pen widths, dots, text sizes, rule sizes)
function mapParts(parts, X, Y, k) {
  return parts.map(p => {
    if (p.t === 'ink' || p.t === 'line') return Object.assign({}, p, { paths: p.paths.map(st => st.map(q => [X(q[0]), Y(q[1])])) }, p.width ? { width: p.width * k } : {}, p.dot ? { dot: p.dot * k } : {});
    if (p.t === 'text') return Object.assign({}, p, { x: X(p.x), y: Y(p.y), size: p.size * k });
    return Object.assign({}, p, { x: X(p.x), y: Y(p.y), w: p.w * k, h: p.h * k });
  });
}
