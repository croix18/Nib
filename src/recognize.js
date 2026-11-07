// ================================================================== recognition
const MAXK = 4, GAPMAX = 1.2;
const RELATIONS = new Set(['=', '<', '>', '\\le', '\\ge', '\\ne', '\\rightarrow']);
const NO_SCRIPT = new Set(['+', '-', '=', '<', '>', '\\le', '\\ge', '\\ne', '\\times', '\\div', '\\pm', '\\cdot', '(', '[', '\\{',
  '/', ',', '.', '\\rightarrow', ':', '\\in']);
const CIRCLES = new Set(['o', '0', 'O']);
const DOTTED = new Set(['i', 'j', '\\div', '!', '\\ldots', ':', ';', '?']);
const DEFAULTS = { symbols: 'school', lines: true, degrees: true, wJunk: 2.0, wClass: 1.0, wJoin: 0.2, beta: 0.5, lm: 0.35, size: 0, maxGap: 1.6, prune: 0.03, barH: 1.1, barW: 0.15, prior: 0.5, dotPen: 3, parenPen: 3, parenH: 1.0, lmSeg: 0, delayed: true, delayGain: 0.3, lateTol: 0.08, deskew: 3, skewW: 2.5, skewAgree: 0.5, smooth: 0 };

function normStrokes(input) {
  const out = [], src = [];
  (input || []).forEach((s, i) => {
    const pts = Array.isArray(s) ? s : (s && (s.points || s.pts)) || [];
    const q = [];
    for (const p of pts) {
      const x = Array.isArray(p) ? +p[0] : +p.x, y = Array.isArray(p) ? +p[1] : +p.y;
      if (!isFinite(x) || !isFinite(y)) continue;
      if (q.length && q[q.length - 1][0] === x && q[q.length - 1][1] === y) continue;
      q.push([x, y]);
    }
    if (q.length) { out.push(q); src.push(i); }
  });
  return { strokes: out, src };
}

// Gaussian smoothing along the pen path (sigma in ink units); the ends stay put, and sparse points (a mouse)
// are barely touched because the window only spans points within ~2.5 sigma of path length.
function smoothPath(s, sigma) {
  const n = s.length;
  if (n < 3 || !(sigma > 0)) return s;
  const L = [0];
  for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]));
  const out = [s[0]], r = 2.5 * sigma, inv = 1 / (2 * sigma * sigma);
  let lo = 0, hi = 0;
  for (let i = 1; i < n - 1; i++) {
    const rr = Math.min(r, L[i], L[n - 1] - L[i]);          // a symmetric window near the ends
    while (L[i] - L[lo] > r) lo++;
    if (hi < i) hi = i;
    while (hi + 1 < n && L[hi + 1] - L[i] <= r) hi++;
    let sw = 0, sx = 0, sy = 0;
    for (let k = lo; k <= hi; k++) {
      const d = L[k] - L[i]; if (d > rr || d < -rr) continue;
      const w = Math.exp(-d * d * inv); sw += w; sx += w * s[k][0]; sy += w * s[k][1];
    }
    out.push([sx / sw, sy / sw]);
  }
  out.push(s[n - 1]);
  return out;
}

// Late strokes: the segmentation reads strokes in the order they were written, so a stroke added to an earlier
// symbol much later would be read on its own. A stroke that touches or crosses ink written two or more strokes
// before it, but not the stroke just before it nor the one after it, is moved to just after the latest stroke it
// touches. Returns the new order, or null when nothing moves.
function lateOrder(strokes, ref, k) {
  const n = strokes.length, boxes = strokes.map(sbox), tol = (k > 0 ? k : 0.08) * ref;
  const size = b => Math.max(b[2] - b[0], b[3] - b[1]);
  const touch = (i, j) => {
    const a = boxes[i], b = boxes[j];
    if (a[0] - tol > b[2] || b[0] - tol > a[2] || a[1] - tol > b[3] || b[1] - tol > a[3]) return false;
    return inkDist(strokes[i], strokes[j], tol) <= tol;
  };
  const after = new Int32Array(n).fill(-1);
  let moved = false;
  for (let j = 2; j < n; j++) {
    if (size(boxes[j]) < 0.15 * ref) continue;                     // dots are left to mergeDelayed
    if (touch(j - 1, j)) continue;                                   // part of what was just written
    if (j + 1 < n && boxGap(boxes[j], boxes[j + 1]) < 0.2 * ref) continue;   // the start of the next symbol
    let target = -1;
    for (let i = j - 2; i >= Math.max(0, j - 40) && target < 0; i--) if (touch(i, j)) target = i;
    if (target < 0) continue;
    while (after[target] >= 0) target = after[target];
    after[j] = target; moved = true;
  }
  if (!moved) return null;
  const late = new Map();
  for (let j = 0; j < n; j++) if (after[j] >= 0) { if (!late.has(after[j])) late.set(after[j], []); late.get(after[j]).push(j); }
  const order = [];
  for (let i = 0; i < n; i++) if (after[i] < 0) { order.push(i); for (const j of late.get(i) || []) order.push(j); }
  return order;
}
// the shortest distance between two strokes' ink, stopping early once it is under `stop`
function inkDist(a, b, stop) {
  let best = Infinity;
  const segD = (p, q, r) => {
    const dx = r[0] - q[0], dy = r[1] - q[1], L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dy);
  };
  const one = (P, Q) => {
    for (const p of P) {
      if (Q.length === 1) best = Math.min(best, Math.hypot(p[0] - Q[0][0], p[1] - Q[0][1]));
      for (let k = 0; k + 1 < Q.length; k++) { const d = segD(p, Q[k], Q[k + 1]); if (d < best) { best = d; if (best <= stop) return; } }
    }
  };
  one(a, b); if (best > stop) one(b, a);
  // two segments that cross without any point near the other stroke
  if (best > stop) for (let i = 0; i + 1 < a.length; i++) for (let k = 0; k + 1 < b.length; k++) if (crosses(a[i], a[i + 1], b[k], b[k + 1])) return 0;
  return best;
}
function crosses(p1, p2, q1, q2) {
  const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(q1, q2, p1), d2 = o(q1, q2, p2), d3 = o(p1, p2, q1), d4 = o(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// user corrections: [{strokes: [input indices], label}] -> contiguous ranges of the strokes as read (src maps back)
function fixesOf(list, src, n) {
  const fixOf = new Int32Array(n).fill(-1), fixes = [];
  for (const f of list || []) {
    const ix = f.strokes.map(i => src.indexOf(i)).filter(i => i >= 0).sort((a, b) => a - b);
    if (!ix.length || ix[ix.length - 1] - ix[0] !== ix.length - 1 || ix.some(i => fixOf[i] >= 0)) continue;
    for (const i of ix) fixOf[i] = fixes.length;
    fixes.push({ i: ix[0], j: ix[ix.length - 1], label: f.label });
  }
  return { fixOf, fixes };
}

class Recognizer {
  constructor(o) { this.cache = new Map(); this.jcache = new Map(); this.ids = new WeakMap(); this.next = 1; this.max = (o && o.cacheSize) || 6000; this.cref = 0; this.lastIds = new Set(); }
  // The size reference the classifier sees. While the same ink keeps growing (a pad being written on) it is held
  // steady unless the writing's scale really changes, so earlier symbols are not re-classified after every stroke.
  classRef(ref, ids) {
    const same = ids.some(id => this.lastIds.has(id));
    this.lastIds = new Set(ids);
    if (!(same && this.cref > 0 && Math.abs(Math.log(ref / this.cref)) < 0.15)) this.cref = ref;
    return this.cref;
  }
  idOf(o, pts) {
    if (o && typeof o === 'object') { let id = this.ids.get(o); if (!id) { id = 'k' + this.next++; this.ids.set(o, id); } return id; }
    return 'p' + pts.length + ':' + pts[0] + ':' + pts[pts.length - 1];
  }
  probs(group, ref, key, useMemory) {
    const k = key + '|' + Math.round(Math.log(ref) * 40);
    let e = this.cache.get(k);
    if (!e) {
      // a rehearsal (warmup) only notes what it would classify, and reads it as junk for now
      if (this.misses) {
        this.misses.push({ group, key });
        const d = new Float32Array(model().cls.length); d[model().junk] = 1;
        return d;
      }
      this.classified = (this.classified || 0) + 1;
      e = classifyGroup(group, ref);
      if (this.cache.size > this.max) this.cache.clear();
      this.cache.set(k, e);
    }
    if (useMemory === false) return e;
    if (e.memv !== MEM.version) { e.mem = memApply(e); e.memv = MEM.version; }
    return e.mem;
  }
  pjoin(a, b, ref, key) {
    const k = key + '|' + Math.round(Math.log(ref) * 40);
    let p = this.jcache.get(k);
    if (p === undefined) {
      p = mlp(DATA.join, joinFeatures(a, b, ref))[0];
      if (this.jcache.size > this.max) this.jcache.clear();
      this.jcache.set(k, p);
    }
    return clip(p, 1e-4, 1 - 1e-4);
  }

  // clean points, stable stroke ids for the caches, and (opts.smooth > 0) the wobble of a fingertip taken out
  prepare(input, opts) {
    const n = normStrokes(input);
    let ids = n.strokes.map((s, i) => this.idOf(input[n.src[i]], s));
    if (opts.smooth > 0 && n.strokes.length) {
      const sigma = opts.smooth * refSize(n.strokes);
      n.strokes = n.strokes.map(s => smoothPath(s, sigma));
      ids = ids.map(id => id + '~' + opts.smooth);
    }
    // a stroke that goes back to touch ink written earlier (crossing the t at the end) is read where it belongs
    const order = opts.delayed && n.strokes.length > 2 ? lateOrder(n.strokes, refSize(n.strokes), opts.lateTol) : null;
    if (order) return { strokes: order.map(i => n.strokes[i]), src: order.map(i => n.src[i]), ids: order.map(i => ids[i]) };
    return { strokes: n.strokes, src: n.src, ids };
  }

  recognize(input, options) {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const opts = Object.assign({}, DEFAULTS, options || {});
    const { strokes, src, ids } = this.prepare(input, opts);
    const empty = { latex: '', text: '', lines: [], symbols: [], tree: [], confidence: 0 };
    if (!strokes.length) return Object.assign(empty, { skew: 0, ms: 0 });
    const ref = refSize(strokes);
    const mask = allowedMask(opts.symbols, opts.times);
    const { fixOf, fixes } = fixesOf(opts.fix, src, strokes.length);
    this.prior = priorVector(opts); this.foldX = opts.times === false;
    this.misses = null;
    const cref = this.classRef(ref, ids);
    let syms = opts.oracle ? opts.oracle(strokes, ref) : this.segment(strokes, ids, ref, mask, opts, fixOf, fixes, cref);
    if (!opts.oracle && opts.delayed) syms = this.mergeDelayed(syms, strokes, ids, ref, cref, mask, opts);
    for (const s of syms) s.strokes = s.strokes.map(i => src[i]);
    const first = syms.map(s => Object.assign({}, s));               // the layout below relabels symbols in place
    let res = finish(syms, ref, opts), skew = 0;
    // Writing that runs uphill or downhill: measure the slope from the symbols just read and, when it is clear,
    // lay the same symbols out again with the slope taken out (the symbols themselves are not re-read).
    if (opts.deskew > 0) {
      const t = skewOf(first, ref, opts);
      if (Math.abs(t) >= Math.tan(opts.deskew * Math.PI / 180)) {
        let sx = 0, n = 0;
        for (const s of strokes) for (const p of s) { sx += p[0]; n++; }
        const c0 = sx / n;
        const level = first.map(s => {
          const pts = s.pts.map(st => st.map(p => [p[0], p[1] - t * (p[0] - c0)]));
          return Object.assign({}, s, { pts, box: pts.map(sbox).reduce(ubox) });
        });
        res = finish(level, ref, opts);
        skew = Math.round(Math.atan(t) * 1800 / Math.PI) / 10;
        // report every box around the ink as written
        const at = new Map(src.map((v, i) => [v, i]));
        for (const s of res.symbols) {
          const b = s.strokes.map(k => sbox(strokes[at.get(k)])).reduce(ubox);
          s.box = { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] };
        }
      }
    }
    res.skew = skew;
    res.ms = Math.round((typeof performance !== 'undefined' ? performance : Date).now() - t0);
    return res;
  }

  // Classifies, one group per step, every stroke group the reading will score, so a caller can spread the work
  // over several frames and keep the page responsive; recognize() with the same options then only hits the cache.
  // First the segmentation's groups (newest ink first), then the reading is rehearsed against the cache to find the
  // rest — a stroke added later to an earlier symbol is scored together with it — until a rehearsal needs nothing new.
  *warmup(input, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const { strokes, src, ids } = this.prepare(input, opts);
    if (!strokes.length) return;
    const ref = refSize(strokes), cref = this.classRef(ref, ids), n = strokes.length, boxes = strokes.map(sbox);
    const pj = [];
    for (let k = 0; k + 1 < n; k++) pj.push(this.pjoin(strokes[k], strokes[k + 1], cref, ids[k] + '~' + ids[k + 1]));
    const bucket = '|' + Math.round(Math.log(cref) * 40);
    for (let i = n - 1; i >= 0; i--) {
      let u = boxes[i], gmax = 0;
      for (let j = i; j < Math.min(n, i + MAXK); j++) {
        if (j > i) {
          gmax = Math.max(gmax, boxGap(u, boxes[j])); if (gmax > GAPMAX * ref || pj[j - 1] < opts.prune) break;
          u = ubox(u, boxes[j]);
        }
        const key = ids.slice(i, j + 1).join(',');
        if (!this.cache.has(key + bucket)) { this.probs(strokes.slice(i, j + 1), cref, key, false); yield; }
      }
    }
    if (opts.oracle) return;
    const mask = allowedMask(opts.symbols, opts.times), { fixOf, fixes } = fixesOf(opts.fix, src, n);
    this.prior = priorVector(opts); this.foldX = opts.times === false;
    for (let pass = 0; pass < 12; pass++) {
      const miss = this.misses = [];
      try {
        const syms = this.segment(strokes, ids, ref, mask, opts, fixOf, fixes, cref);
        if (!miss.length && opts.delayed) this.mergeDelayed(syms, strokes, ids, ref, cref, mask, opts);
      } finally { this.misses = null; }
      if (!miss.length) return;
      const done = new Set();
      for (const m of miss) {
        if (done.has(m.key) || this.cache.has(m.key + bucket)) continue;
        done.add(m.key); this.probs(m.group, cref, m.key, false); yield;
      }
    }
  }

  // A stroke added later to a symbol written earlier (crossing the t at the end, finishing a 4 after the next
  // number, the second stroke of an x): the segmentation keeps time order, so it reads two symbols. Merge two
  // symbols that are not neighbours in time when their ink overlaps and the network reads the union as one
  // confident symbol that scores better than the two apart.
  mergeDelayed(syms, strokes, ids, ref, cref, mask, opts) {
    const M = model();
    const score = group => {
      const key = group.map(i => ids[i]).join(',');
      const p = foldTimes(withPrior(this.probs(group.map(i => strokes[i]), cref, key, opts.memory), this.prior), this.foldX);
      let tot = 0; for (let c = 0; c < p.length; c++) if (mask[c]) tot += p[c];
      const pjunk = p[M.junk] / tot, norm = tot * Math.max(1 - pjunk, 1e-6);
      const list = [];
      for (let c = 0; c < p.length; c++) if (mask[c] && c !== M.junk) list.push([M.cls[c], p[c] / norm]);
      list.sort((x, y) => y[1] - x[1]);
      return { s: opts.wJunk * Math.log(Math.max(1 - pjunk, 1e-4)) + opts.wClass * Math.log(Math.max(list[0][1], 1e-6)) - opts.beta, list, pjunk };
    };
    const grow = (b, k) => [b[0] - k, b[1] - k, b[2] + k, b[3] + k];
    const area = b => Math.max(b[2] - b[0], 0.05 * ref) * Math.max(b[3] - b[1], 0.05 * ref);
    for (let round = 0; round < 4; round++) {
      let best = null;
      for (let a = 0; a < syms.length; a++) for (let b = a + 1; b < syms.length; b++) {
        const A = syms[a], B = syms[b];
        if (A.fixed || B.fixed || A.strokes.length + B.strokes.length > MAXK) continue;
        const lastA = Math.max(...A.strokes), firstB = Math.min(...B.strokes);
        if (firstB === lastA + 1) continue;                               // neighbours in time: the DP already decided
        const sb = Math.max(B.box[2] - B.box[0], B.box[3] - B.box[1]), sa = Math.max(A.box[2] - A.box[0], A.box[3] - A.box[1]);
        const dot = Math.min(sa, sb) < 0.12 * ref;
        if (dot) {
          // a dot joins only the symbol it sits just above or below (the dot of an i or j, a dot of ÷), never one
          // it sits beside (a decimal point stays a decimal point)
          const D = sa < sb ? A : B, S = D === A ? B : A, c = cxy(D.box);
          const gapY = Math.max(S.box[1] - D.box[3], D.box[1] - S.box[3]);
          if (c[0] < S.box[0] - 0.25 * ref || c[0] > S.box[2] + 0.25 * ref || gapY > 0.6 * ref || (c[1] > S.box[1] && c[1] < S.box[3])) continue;
        } else {
          const ea = grow(A.box, 0.08 * ref), eb = grow(B.box, 0.08 * ref);
          const ix = Math.min(ea[2], eb[2]) - Math.max(ea[0], eb[0]), iy = Math.min(ea[3], eb[3]) - Math.max(ea[1], eb[1]);
          if (ix <= 0 || iy <= 0 || ix * iy < 0.3 * Math.min(area(ea), area(eb))) continue;
        }
        const group = A.strokes.concat(B.strokes).sort((x, y) => x - y);
        const m = score(group), sepA = score(A.strokes), sepB = score(B.strokes);
        const gain = m.s - (sepA.s + sepB.s);
        if (dot && !DOTTED.has(m.list[0][0])) continue;
        if (gain > opts.delayGain && m.list[0][1] > 0.5 && m.pjunk < 0.5 && (!best || gain > best.gain)) best = { a, b, group, m, gain };
      }
      // a rehearsal stops at the first round that needs the network: what follows depends on its answers
      if (!best || (this.misses && this.misses.length)) break;
      const A = syms[best.a], B = syms[best.b];
      const merged = { label: best.m.list[0][0], cands: best.m.list.slice(0, 6), strokes: best.group, box: ubox(A.box, B.box),
        pts: best.group.map(i => strokes[i]), junk: best.m.pjunk };
      syms = syms.filter((_, i) => i !== best.a && i !== best.b);
      syms.push(merged);
      syms.sort((x, y) => Math.min(...x.strokes) - Math.min(...y.strokes));
    }
    return syms;
  }

  // time-ordered dynamic programme over stroke groups of size <= MAXK
  segment(strokes, ids, ref, mask, opts, fixOf, fixes, cref) {
    cref = cref || ref;
    const n = strokes.length, M = model();
    const boxes = strokes.map(sbox);
    const pj = [];
    for (let k = 0; k + 1 < n; k++) pj.push(this.pjoin(strokes[k], strokes[k + 1], cref, ids[k] + '~' + ids[k + 1]));
    // Dynamic programme over (strokes used, label of the last symbol). With opts.lmSeg > 0 the context model
    // scores the labels in writing order while segmenting, so "4" drawn in two strokes beats "1 +" and "="
    // beats "- -"; opts.beta (a per-symbol cost) balances the extra factor each additional symbol brings.
    const K = opts.lmSeg > 0 ? 4 : 1, BEAM = 8;
    const states = Array.from({ length: n + 1 }, () => new Map());
    states[0].set('<s>', { s: 0, pos: -1, lab: null, c: null });
    for (let i = 0; i < n; i++) {
      if (!states[i].size) continue;
      if (states[i].size > BEAM) {
        const keep = [...states[i].entries()].sort((x, y) => y[1].s - x[1].s).slice(0, BEAM);
        states[i] = new Map(keep);
      }
      let u = boxes[i], gmax = 0, inner = 0;
      for (let j = i; j < Math.min(n, i + MAXK); j++) {
        if (j > i) {
          gmax = Math.max(gmax, boxGap(u, boxes[j])); if (gmax > GAPMAX * ref && !(fixOf && fixOf[i] >= 0)) break;
          if (pj[j - 1] < opts.prune && !(fixOf && fixOf[i] >= 0)) break; // the join model is sure these are two symbols
          u = ubox(u, boxes[j]); inner += opts.wJoin * Math.log(pj[j - 1]);
        }
        let forced = null;
        if (fixOf) {
          let bad = false;
          for (let k = i; k <= j; k++) if (fixOf[k] !== fixOf[i]) bad = true;
          if (fixOf[i] >= 0) { const f = fixes[fixOf[i]]; if (bad || f.i !== i || f.j < j) continue; if (f.j !== j) continue; forced = f.label; }
          else if (bad) break;
        }
        const group = strokes.slice(i, j + 1);
        const p = foldTimes(withPrior(this.probs(group, cref, ids.slice(i, j + 1).join(','), opts.memory), this.prior), this.foldX);
        let tot = 0; for (let c = 0; c < p.length; c++) if (mask[c]) tot += p[c];
        const pjunk = p[M.junk] / tot, norm = tot * Math.max(1 - pjunk, 1e-6);
        const list = [];
        for (let c = 0; c < p.length; c++) if (mask[c] && c !== M.junk) list.push([M.cls[c], p[c] / norm]);
        list.sort((x, y) => y[1] - x[1]);
        let base = forced ? 0 : opts.wJunk * Math.log(Math.max(1 - pjunk, 1e-4)) - opts.beta +
          inner + (j + 1 < n ? opts.wJoin * Math.log(1 - pj[j]) : 0);
        if (!forced && j > i) {
          const tl = list[0][0];
          // a decimal point or a times dot does not hide inside a digit or letter (4.7 is not 47, 121·21 is not
          // 12121, 2·x is not 2x); a stray tap at the end of a bar or other sign is part of that sign
          if (!DOTTED.has(tl) && /^[0-9A-Za-z]$/.test(tl)) {
            const gs = Math.max(u[2] - u[0], u[3] - u[1]);
            // a tiny mark off to one side of the group: on the baseline, or in the middle of the line and clear of the
            // rest (a tap where two strokes of a 4 meet is part of the 4)
            for (let k = i; k <= j; k++) {
              const b = boxes[k], d = Math.max(b[2] - b[0], b[3] - b[1]), at = ((b[1] + b[3]) / 2 - u[1]) / Math.max(u[3] - u[1], 1e-9);
              if (!(d < 0.12 * ref && d < 0.2 * gs && at > 0.25 &&
                ((b[0] + b[2]) / 2 > u[0] + 0.75 * (u[2] - u[0]) || (b[0] + b[2]) / 2 < u[0] + 0.25 * (u[2] - u[0])))) continue;
              let apart = Infinity;
              for (let m = i; m <= j; m++) if (m !== k) apart = Math.min(apart, boxGap(b, boxes[m]));
              if (at > 0.7 || apart > 0.05 * ref) { base -= opts.dotPen; break; }
            }
          }
          // two tall arcs back to back are brackets, not an x: (-3)(7)
          if (j === i + 1 && (tl === 'x' || tl === 'X' || tl === '\\times') && (u[3] - u[1]) > opts.parenH * localHeight(boxes, i, j, ref)) {
            const pa = this.probs([strokes[i]], cref, ids[i], opts.memory), pb = this.probs([strokes[j]], cref, ids[j], opts.memory);
            // ...and only when a bracket was opened before them (some writers draw every x as ")(")
            let opened = false;
            for (let k = Math.max(0, i - 10); k < i && !opened; k++) if (this.probs([strokes[k]], cref, ids[k], opts.memory)[M.idx['(']] > 0.5) opened = true;
            if (opened && pa[M.idx[')']] > 0.4 && pb[M.idx['(']] > 0.4) base -= opts.parenPen;
          }
        }
        const c = { p, tot, pjunk, box: u, forced, list, i };
        const labels = forced ? [[forced, 1]] : list.slice(0, K);
        for (const [L, q] of labels) {
          const ls = forced ? 0 : opts.wClass * Math.log(Math.max(q, 1e-6));
          for (const [pl, st] of states[i]) {
            const v = st.s + base + ls + (opts.lmSeg > 0 ? opts.lmSeg * lmLogp(lmTok(pl), lmTok(L)) : 0);
            const cur = states[j + 1].get(L);
            if (!cur || v > cur.s) states[j + 1].set(L, { s: v, pos: i, lab: pl, c });
          }
        }
      }
    }
    if (!states[n].size) return fixes && fixes.length ? this.segment(strokes, ids, ref, mask, opts, null, null, cref) : [];
    let endLab = null, endS = -Infinity;
    for (const [L, st] of states[n]) {
      const v = st.s + (opts.lmSeg > 0 ? opts.lmSeg * lmLogp(lmTok(L), '</s>') : 0);
      if (v > endS) { endS = v; endLab = L; }
    }
    const syms = [];
    for (let j = n, L = endLab; j > 0;) {
      const st = states[j].get(L), c = st.c, i = st.pos;
      const strokesIdx = []; for (let k = i; k < j; k++) strokesIdx.push(k);
      if (c.forced) syms.push({ label: c.forced, cands: [[c.forced, 1]].concat(c.list.filter(x => x[0] !== c.forced).slice(0, 5)), strokes: strokesIdx, box: c.box, pts: strokes.slice(i, j), junk: 0, fixed: true });
      else syms.push({ label: L, cands: c.list.slice(0, 6), strokes: strokesIdx, box: c.box, pts: strokes.slice(i, j), junk: c.pjunk });
      j = i; L = st.lab;
    }
    return syms.reverse();
  }
}

// The slope of the writing (dy/dx, y down) from symbols in writing order: neighbouring digits and letters of a
// similar size for their kind (a lowercase x is shorter than a 7) sit on one line, at their bottoms; signs sit on
// its middle. Pairs that disagree wildly (an exponent, the next line, a numerator over a denominator) are dropped;
// the rest vote, the farther apart the more weight, and several must agree.
const SKEW_SYM = /^[0-9A-Za-z]$|^\\(alpha|theta|pi|lambda|sigma|Delta)$/;
const SKEW_AXIS = new Set(['+', '-', '=', '\\times', '\\div', '\\pm', '<', '>', '\\le', '\\ge', '\\ne']);
function skewOf(syms, ref, opts) {
  const pts = syms.map(s => {
    const b = s.box, h = b[3] - b[1], t = symType(s.label);
    if ((t === T_ASC || t === T_XH) && SKEW_SYM.test(s.label) && h > 0.3 * ref) return { x: (b[0] + b[2]) / 2, y: b[3], h: t === T_XH ? h / 0.62 : h, k: 0 };
    if (SKEW_AXIS.has(s.label)) return { x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, h: 0, k: 1 };
    return null;
  });
  const vals = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]; if (!a) continue;
    for (let j = i + 1; j < Math.min(pts.length, i + 4); j++) {
      const b = pts[j]; if (!b || b.k !== a.k) continue;
      if (a.k === 0 && Math.max(a.h, b.h) > 1.35 * Math.min(a.h, b.h)) continue;
      const dx = b.x - a.x; if (Math.abs(dx) < 0.6 * ref) continue;
      const sl = (b.y - a.y) / dx; if (Math.abs(sl) > 0.3) continue;
      vals.push([sl, Math.min(Math.abs(dx) / ref, 3)]);
    }
  }
  if (vals.length < 2) return 0;
  let W = 0; for (const v of vals) W += v[1];
  vals.sort((a, b) => a[0] - b[0]);
  let acc = 0, m = 0;
  for (const v of vals) { acc += v[1]; if (acc >= W / 2) { m = v[0]; break; } }
  let sw = 0, st = 0, n = 0;
  for (const [v, w] of vals) if (Math.abs(v - m) < 0.05) { sw += w; st += w * v; n++; }
  return n >= 2 && sw >= Math.max(opts.skewW, opts.skewAgree * W) ? st / sw : 0;
}

// median height of the ordinary strokes written around strokes i..j (dots and long bars left out)
function localHeight(boxes, i, j, ref) {
  const hs = [];
  for (let k = Math.max(0, i - 5); k < Math.min(boxes.length, j + 6); k++) {
    if (k >= i && k <= j) continue;
    const b = boxes[k], w = b[2] - b[0], h = b[3] - b[1];
    if (h > 0.3 * ref && w < 3 * h) hs.push(h);
  }
  return hs.length >= 2 ? median(hs) : ref;
}

// prior shift: the classifier learned CROHME's symbol frequencies (university maths); a school set
// re-weights each class by (school frequency / CROHME frequency) ^ opts.prior
function priorVector(opts) {
  const set = opts.symbols === undefined ? 'school' : opts.symbols;
  if (!opts.prior || typeof set !== 'string' || !DATA.prior || !DATA.prior[set]) return null;
  return Float64Array.from(DATA.prior[set], r => Math.pow(r, opts.prior));
}
// x as a letter only (times: false): what the network gives a times sign belongs to the letter x — a cross is an x,
// never a plus
function foldTimes(p, on) {
  if (!on) return p;
  const { idx } = model(), x = idx.x, t = idx['\\times'];
  if (x === undefined || t === undefined || !p[t]) return p;
  const q = Float64Array.from(p);
  q[x] += q[t]; q[t] = 0;
  return q;
}
function withPrior(p, f) {
  if (!f) return p;
  const { junk } = model();
  let before = 0, after = 0;
  const q = new Float64Array(p.length);
  for (let c = 0; c < p.length; c++) { if (c === junk) { q[c] = p[c]; continue; } q[c] = p[c] * f[c]; before += p[c]; after += q[c]; }
  const k = after > 0 ? before / after : 1;
  for (let c = 0; c < p.length; c++) if (c !== junk) q[c] *= k;
  q.hidden = p.hidden;
  return q;
}

// ------------------------------------------------------------------ symbol-level fix-ups
function mergeColons(syms, ref) {
  // a dot: small and roughly as wide as it is tall (a short dash of a small = is not a dot)
  const tiny = b => { const w = b[2] - b[0], h = b[3] - b[1], d = Math.max(w, h); return d < 0.25 * ref && d < 2.5 * Math.min(w, h) + 0.06 * ref; };
  // one symbol made of two stacked dots
  for (const s of syms) if (s.pts.length === 2 && !s.fixed) {
    const a = sbox(s.pts[0]), b = sbox(s.pts[1]);
    if (tiny(a) && tiny(b) && Math.abs((a[0] + a[2]) - (b[0] + b[2])) / 2 < 0.3 * ref &&
      Math.max(a[1], b[1]) - Math.min(a[3], b[3]) > 0.05 * ref) { s.label = ':'; s.cands = [[':', 1]]; }
  }
  // two dot symbols stacked
  const out = [], used = new Set();
  for (let i = 0; i < syms.length; i++) {
    if (used.has(i)) continue;
    const a = syms[i];
    if (tiny(a.box) && !a.fixed) {
      for (let j = i + 1; j < Math.min(syms.length, i + 3); j++) {
        const b = syms[j];
        if (used.has(j) || !tiny(b.box) || b.fixed) continue;
        const dx = Math.abs((a.box[0] + a.box[2]) - (b.box[0] + b.box[2])) / 2;
        const gy = Math.max(a.box[1], b.box[1]) - Math.min(a.box[3], b.box[3]);
        if (dx < 0.3 * ref && gy > 0.05 * ref && gy < 0.8 * ref) {
          used.add(j);
          out.push({ label: ':', cands: [[':', 1]], strokes: a.strokes.concat(b.strokes), box: ubox(a.box, b.box), pts: a.pts.concat(b.pts), junk: 0 });
          a.merged = true; break;
        }
      }
    }
    if (!a.merged) out.push(a);
  }
  return mergeStacked(out, ref);
}

// two strokes the segmentation kept apart that are really one sign: "-" over "-" is "=", "+" over "-" is "±".
// Not when something sits directly above or below the pair (a fraction bar has a numerator and denominator).
function mergeStacked(syms, ref) {
  const flat = b => (b[3] - b[1]) < 0.35 * (b[2] - b[0]) && (b[3] - b[1]) < 0.3 * ref;
  const clearAround = (pair, top, bot) => !syms.some(o => {
    if (pair.includes(o)) return false;
    const b = o.box, cx = (b[0] + b[2]) / 2;
    if (cx < Math.min(top[0], bot[0]) - 0.1 * ref || cx > Math.max(top[2], bot[2]) + 0.1 * ref) return false;
    return (b[3] <= top[1] + 0.05 * ref && b[3] > top[1] - 0.9 * ref) || (b[1] >= bot[3] - 0.05 * ref && b[1] < bot[3] + 0.9 * ref) ||
      (b[1] >= top[3] && b[3] <= bot[1]);
  });
  const out = [], used = new Set();
  for (let i = 0; i < syms.length; i++) {
    if (used.has(i)) continue;
    const a = syms[i];
    let done = false;
    for (let j = i + 1; j < Math.min(syms.length, i + 3) && !done; j++) {
      const b = syms[j];
      if (used.has(j) || a.fixed || b.fixed) continue;
      const [up, lo] = a.box[1] <= b.box[1] ? [a, b] : [b, a];
      const U = up.box, L = lo.box, wu = U[2] - U[0], wl = L[2] - L[0];
      const gap = L[1] - U[3], dcx = Math.abs((U[0] + U[2]) - (L[0] + L[2])) / 2;
      let label = null;
      if (up.label === '-' && lo.label === '-' && flat(U) && flat(L) && Math.max(wu, wl) < 1.8 * Math.min(wu, wl) &&
        dcx < 0.35 * Math.max(wu, wl) && gap > 0.04 * ref && gap < 0.7 * ref) label = '=';
      else if (up.label === '+' && lo.label === '-' && flat(L) && wl > 0.5 * wu && wl < 2 * wu && dcx < 0.4 * wu &&
        gap > -0.1 * ref && gap < 0.5 * ref) label = '\\pm';
      if (label && clearAround([a, b], U, L)) {
        used.add(j); done = true;
        out.push({ label, cands: [[label, 1]], strokes: a.strokes.concat(b.strokes), box: ubox(a.box, b.box), pts: a.pts.concat(b.pts), junk: 0 });
      }
    }
    if (!done) out.push(a);
  }
  return out;
}

// absolute value: tall thin strokes read as 1 or a bracket that enclose something on the same row
function fixBars(row, ref, opts) {
  // CROHME statistics: a bar is near-straight (width/height ~0.05) and hangs below the line of characters
  // (median 0.32 of their height) and rises above it (0.86); a 1 sits on the line (median -0.03 / 0.10).
  const base = row.filter(u => u.k === 's' && /^[02-9ace-z]$/.test(u.sym.label)).map(u => u.box);
  const h0 = base.length ? median(base.map(b => b[3] - b[1])) : 0.8 * ref;
  const bot = base.length ? median(base.map(b => b[3])) : null;
  const ONE = new Set(['1', '|', 'l', 'I']);
  const lab = u => (u && u.k === 's' ? u.sym.label : null);
  const H = u => u.box[3] - u.box[1];
  const shape = (u, wmax) => {                            // tall and thin: the geometry a bar needs
    if (u.k !== 's' || u.sym.fixed || !(ONE.has(u.sym.label) || ['(', ')', '/'].includes(u.sym.label))) return false;
    return u.box[2] - u.box[0] <= wmax * H(u) && H(u) >= opts.barH * h0;
  };
  const strong = u => {                                   // ...and the classifier and the baseline agree
    if (!(u.sym.cands || []).some(([l, q]) => l === '|' && q >= 0.05)) return false;
    const below = bot === null ? 0 : (u.box[3] - bot) / h0;
    return below > 0.1 || H(u) > 1.35 * h0;
  };
  // an operand starts after an operator, a relation or an open bracket, and ends before one (or a close bracket)
  const opLike = u => u && u.k === 's' && (u.type === T_OP || RELATIONS.has(u.sym.label) || ['(', '[', ',', ':', '\\cdot'].includes(u.sym.label));
  const startsOperand = i => i === 0 || opLike(row[i - 1]);
  const endsOperand = j => j === row.length - 1 || opLike(row[j + 1]) || [')', ']', ','].includes(lab(row[j + 1]));
  let changed = false;
  // a slanted bar is up to ~0.3 as wide as it is tall; a 1 with a flag is wider (CROHME median 0.44)
  const cand = row.map((u, i) => shape(u, Math.max(opts.barW, 0.3)) ? i : -1).filter(i => i >= 0);
  const used = new Set();
  for (const i of cand) {
    if (used.has(i)) continue;
    for (const j of cand) {
      if (j <= i + 1 || used.has(j)) continue;
      const a = row[i], b = row[j];
      if (Math.abs(H(a) - H(b)) > 0.35 * Math.max(H(a), H(b))) continue;
      const inner = row.slice(i + 1, j);
      const plainInside = inner.some(u => u.k !== 's' || /^[0-9A-Za-z]$|^\\(pi|theta)$/.test(u.sym.label)) &&
        !inner.some(u => u.k === 's' && RELATIONS.has(u.sym.label));
      // two strong bars; or two "1"s standing exactly where an absolute value's bars would (|6 - 12| read as 16 - 121)
      const thin = u => shape(u, opts.barW);
      const ok = (thin(a) && thin(b) && strong(a) && strong(b)) || (ONE.has(lab(a)) && ONE.has(lab(b)) && plainInside && startsOperand(i) && endsOperand(j));
      if (!ok) continue;
      for (const u of [a, b]) if (u.sym.label !== '|') { u.sym.label = '|'; u.type = symType('|'); changed = true; }
      a.sym.fixed = b.sym.fixed = true;
      used.add(i); used.add(j);
      break;
    }
  }
  for (const u of row) for (const k of ['sup', 'sub', 'num', 'den', 'body', 'idx']) if (u[k]) changed = fixBars(u[k], ref, opts) || changed;
  return changed;
}

// ------------------------------------------------------------------ layout
function unitOf(s) { return { k: 's', sym: s, box: s.box, type: symType(s.label) }; }
function cxy(b) { return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
function area(b) { return (b[2] - b[0]) * (b[3] - b[1]); }
function isBar(u) { return u.k === 's' && u.sym.label === '-'; }

function ptsOf(sym) { const out = []; for (const s of sym.pts) for (const p of s) out.push(p); return out; }

function takeRoots(units, ref, opts) {
  const used = new Set(), made = [];
  const rads = units.filter(u => u.k === 's' && u.sym.label === '\\sqrt').sort((a, b) => area(b.box) - area(a.box));
  for (const R of rads) {
    if (used.has(R)) continue;
    const b = R.box, w = b[2] - b[0], h = b[3] - b[1];
    // the bottom of the check mark: lowest point in the left part of the radical
    let vx = b[0] + 0.3 * Math.min(w, h), vy = -Infinity;
    for (const p of ptsOf(R.sym)) if (p[0] < b[0] + 0.6 * w && p[1] > vy) { vy = p[1]; vx = p[0]; }
    const body = [], idx = [];
    for (const u of units) { // index: small, up and to the left, above the overline's start
      if (u === R || used.has(u)) continue;
      const bb = u.full || u.box, [cx, cy] = cxy(bb), uw = bb[2] - bb[0], uh = bb[3] - bb[1];
      // (it may stand a little clear of the tick: up to 0.3 of the root's height to its left)
      if (cx < vx + 0.2 * h && cx > b[0] - 0.45 * h && bb[2] > b[0] - 0.3 * h && cy < b[1] + 0.3 * h && bb[3] < b[1] + 0.55 * h &&
        cy > b[1] - 0.8 * h && uh < 0.6 * h && uw < 0.6 * h + 0.2 * w && !(u.k === 's' && (u.type === T_OP || u.type === T_PAREN))) idx.push(u);
    }
    let xr = b[2], yr = b[3], changed = true;
    while (changed) {
      changed = false;
      for (const u of units) {
        if (u === R || used.has(u) || body.includes(u) || idx.includes(u)) continue;
        const bb = u.full || u.box, [cx, cy] = cxy(bb), uw = bb[2] - bb[0];
        const lab = u.k === 's' ? u.sym.label : null;
        if (lab !== null && RELATIONS.has(lab) && bb[2] > xr - 0.1 * ref) continue;
        if (u.type === T_SMALL && cx > xr - 0.15 * ref) continue;
        if ((u.type === T_OP || u.type === T_PAREN && lab !== '(') && cx > xr - 0.1 * ref) continue;
        const flat = (bb[3] - bb[1]) < 0.25 * ref;
        if (lab === '-' && uw > 0.5 * w && cy > b[1] + 0.7 * h) continue;    // a fraction bar under the root
        if (bb[1] > yr - 0.1 * h) continue;                                     // starts below the root
        if (cx > vx && bb[0] < xr + 0.2 * ref && cx < xr + 0.55 * ref && cy > b[1] && cy < yr + (flat ? 0.0 : 0.2) * h && uw < 1.5 * w) {
          body.push(u); changed = true;
          if (u.k === 's' && u.sym.label === '\\sqrt') { xr = Math.max(xr, bb[2]); yr = Math.max(yr, bb[3]); }
        }
      }
    }
    if (!body.length) continue;
    for (const u of body.concat(idx)) used.add(u);
    used.add(R);
    let box = b; for (const u of body.concat(idx)) box = ubox(box, u.full || u.box);
    made.push({ k: 'r', rad: R.sym, body: region(body, ref, opts), idx: idx.length ? region(idx, ref, opts) : null, box, full: box, type: T_ROOT });
  }
  return units.filter(u => !used.has(u)).concat(made);
}

function barLine(sym) {
  const P = ptsOf(sym); let n = P.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of P) { sx += p[0]; sy += p[1]; sxx += p[0] * p[0]; sxy += p[0] * p[1]; }
  const den = n * sxx - sx * sx; let m = den > 1e-9 ? (n * sxy - sx * sy) / den : 0;
  m = clip(m, -0.3, 0.3);
  const c = (sy - m * sx) / n;
  return x => m * x + c;
}

function takeFractions(units, ref, opts) {
  const used = new Set(), made = [];
  const bars = units.filter(u => isBar(u)).sort((a, b) => (b.box[2] - b.box[0]) - (a.box[2] - a.box[0]));
  for (const B of bars) {
    if (used.has(B)) continue;
    const b = B.box, w = b[2] - b[0], tol = 0.15 * w + 0.25 * Math.min(ref, w), yb = barLine(B.sym);
    // over the bar: centred on it and not much wider; loosely (one side of a lopsided fraction), overlapping a good
    // part of it
    let loose = false;
    const inRange = u => {
      const bb = u.full || u.box, c = (bb[0] + bb[2]) / 2;
      if (loose) return Math.min(bb[2], b[2]) - Math.max(bb[0], b[0]) >= 0.3 * w && (bb[2] - bb[0]) <= 2.4 * w + 0.5 * ref;
      return c >= b[0] - tol && c <= b[2] + tol && (bb[2] - bb[0]) <= 1.35 * w + 0.3 * ref;
    };
    const okUnit = (u, dir, y) => {
      const bb = u.full || u.box, cy = (bb[1] + bb[3]) / 2, lab = u.k === 's' ? u.sym.label : null;
      const side = dir < 0 ? y - cy : cy - y;
      if (side <= 0.12 * ref) return false;
      const hh = Math.max(bb[3] - bb[1], 1e-9);
      if ((dir < 0 ? (y - bb[1]) / hh : (bb[3] - y) / hh) < 0.75) return false;               // straddles the bar
      if (lab === '-' && (side < 0.3 * ref || bb[0] < b[0] - 0.1 * ref)) return false;          // a minus beside the bar
      if (lab !== null && RELATIONS.has(lab) && !(bb[0] > b[0] + 0.1 * w && bb[2] < b[2] - 0.1 * w)) return false;
      if (u.type === T_OP && lab !== '-' && ((bb[0] + bb[2]) / 2 < b[0] + 0.02 * w || (bb[0] + bb[2]) / 2 > b[2] - 0.02 * w)) return false;
      return true;
    };
    const grow = (dir) => {
      const set = [];
      // first ring: close to the bar line, clearly on one side of it
      for (const u of units) {
        if (u === B || used.has(u) || !inRange(u)) continue;
        const bb = u.full || u.box, cx = (bb[0] + bb[2]) / 2, y = yb(cx);
        const gap = dir < 0 ? y - bb[3] : bb[1] - y;
        if (okUnit(u, dir, y) && gap <= opts.maxGap * ref) set.push(u);
      }
      if (!set.length) return set;
      // stack further units above/below the ring (nested fractions, tall numerators)
      let frontier = dir < 0 ? Math.min(...set.map(u => (u.full || u.box)[1])) : Math.max(...set.map(u => (u.full || u.box)[3]));
      let changed = true;
      while (changed) {
        changed = false;
        for (const u of units) {
          if (u === B || used.has(u) || set.includes(u) || !inRange(u)) continue;
          const bb = u.full || u.box, cx = (bb[0] + bb[2]) / 2, y = yb(cx);
          if (!okUnit(u, dir, y)) continue;
          const gap = dir < 0 ? frontier - bb[3] : bb[1] - frontier;
          if (gap <= 0.6 * ref) { set.push(u); frontier = dir < 0 ? Math.min(frontier, bb[1]) : Math.max(frontier, bb[3]); changed = true; }
        }
      }
      // units running past the ends of the bar (long numerators, scripts)
      const others = units.filter(v => v !== B && !used.has(v) && isBar(v) && (v.box[2] - v.box[0]) > 0.5 * ref);
      const nearOther = u => { const bb = u.full || u.box, cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
        return others.some(v => cx > v.box[0] - 0.3 * ref && cx < v.box[2] + 0.3 * ref && Math.abs((v.box[1] + v.box[3]) / 2 - cy) < 1.6 * ref); };
      changed = true;
      while (changed) {
        changed = false;
        const x0 = Math.min(...set.map(u => (u.full || u.box)[0])), x1 = Math.max(...set.map(u => (u.full || u.box)[2]));
        const y0 = Math.min(...set.map(u => (u.full || u.box)[1])), y1 = Math.max(...set.map(u => (u.full || u.box)[3]));
        for (const u of units) {
          if (u === B || used.has(u) || set.includes(u)) continue;
          const bb = u.full || u.box, cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2, y = yb(cx);
          if (!okUnit(u, dir, y) || (dir < 0 ? bb[3] > y + 0.05 * ref : bb[1] < y - 0.05 * ref)) continue;
          if (cy < y0 - 0.3 * ref || cy > y1 + 0.3 * ref || u.type === T_OP) continue;
          if ((bb[3] - bb[1]) > 1.3 * Math.max(...set.map(v => (v.full || v.box)[3] - (v.full || v.box)[1])) + 0.1 * ref) continue;
          const right = bb[0] < x1 + 0.4 * ref && bb[0] > x1 - 0.5 * ref && cx < b[2] + 1.5 * ref;
          const left = bb[2] > x0 - 0.4 * ref && bb[2] < x0 + 0.5 * ref && cx > b[0] - 1.5 * ref;
          if ((right && x1 > b[2] - 0.3 * ref || left && x0 < b[0] + 0.3 * ref) && !nearOther(u)) { set.push(u); changed = true; }
        }
      }
      return set;
    };
    loose = false;
    let up = grow(-1), dn = grow(1);
    const span = s => { let x0 = Infinity, x1 = -Infinity; for (const u of s) { const bb = u.full || u.box; x0 = Math.min(x0, bb[0]); x1 = Math.max(x1, bb[2]); } return x1 - x0; };
    const centred = (st, k) => { let x0 = Infinity, x1 = -Infinity; for (const u of st) { const bb = u.full || u.box; x0 = Math.min(x0, bb[0]); x1 = Math.max(x1, bb[2]); }
      const ov = Math.min(x1, b[2]) - Math.max(x0, b[0]);
      return k ? ov >= 0.3 * Math.min(w, x1 - x0) && Math.abs((x0 + x1) / 2 - (b[0] + b[2]) / 2) < 0.6 * w + 0.45 * ref
        : ov >= 0.5 * Math.min(w, x1 - x0) && Math.abs((x0 + x1) / 2 - (b[0] + b[2]) / 2) < 0.35 * w + 0.3 * ref; };
    const fits = (u, d) => u.length && d.length && w >= 0.45 * Math.max(span(u), span(d));
    let ok = fits(up, dn) && centred(up) && centred(dn);
    // A lopsided fraction: one side squarely on the bar, the other written off to one side of it (a ½ whose 2 runs
    // out past the end of a short bar, or whose 1 sits over its left end). Only the side that is off is taken loosely.
    if (!ok && up.length && centred(up) && !(dn.length && centred(dn))) {
      loose = true; const d2 = grow(1); loose = false;
      if (fits(up, d2) && centred(d2, true)) { dn = d2; ok = true; }
    } else if (!ok && dn.length && centred(dn) && !(up.length && centred(up))) {
      loose = true; const u2 = grow(-1); loose = false;
      if (fits(u2, dn) && centred(u2, true)) { up = u2; ok = true; }
    }
    if (!ok) continue;
    for (const u of up.concat(dn)) used.add(u);
    used.add(B);
    let box = b; for (const u of up.concat(dn)) box = ubox(box, u.full || u.box);
    made.push({ k: 'f', bar: B.sym, num: region(up, ref, opts), den: region(dn, ref, opts), box, full: box, type: T_FRAC });
  }
  return units.filter(u => !used.has(u)).concat(made);
}

function region(units, ref, opts) {
  let us = takeRoots(units.slice(), ref, opts);
  us = takeFractions(us, ref, opts);
  return baseline(us, ref);
}

function relProbs(cur, u, ref) {
  return mlp(DATA.rel, relFeatures(cur.box, cur.type, u.full || u.box, u.type, ref, cur.k === 's' ? cur.sym.label : null, u.k === 's' ? u.sym.label : null));
}
function relOf(cur, u, ref) {
  const cl = cur.k === 's' ? cur.sym.label : null, ul = u.k === 's' ? u.sym.label : null;
  if (cl !== null && NO_SCRIPT.has(cl)) return 0;
  if (ul !== null && RELATIONS.has(ul)) return 0;
  const p = relProbs(cur, u, ref);
  // an x that might be a times sign does not take a numeric subscript (4 x 4, not 4x_4)
  if (p[2] > p[1] && cl !== null && (cl === 'x' || cl === 'X') && ul !== null && (/^[0-9]$/.test(ul) || ul === '(') &&
    (cur.sym.cands || []).some(([l, q]) => l === '\\times' && q >= 0.08)) return 0;
  // digit after digit: an exponent sits clearly higher (CROHME: centre at least ~0.35 of the base's height above);
  // digit subscripts on digits do not occur in school maths
  if (cl !== null && ul !== null && /^[0-9]$/.test(cl) && /^[0-9]$/.test(ul)) {
    const cb = cur.box, ub = u.full || u.box, h = Math.max(cb[3] - cb[1], 0.3 * ref);
    const dy = ((ub[1] + ub[3]) - (cb[1] + cb[3])) / 2 / h;
    if (p[1] > SUP_MIN && p[1] >= p[2] && dy < -0.3) return 1;
    return 0;
  }
  if (p[2] > SUB_MIN && p[2] > p[1]) return 2;
  if (p[1] > SUP_MIN && p[1] >= p[2]) return 1;
  return 0;
}
let SUB_MIN = 0.7, SUP_MIN = 0.5;
const cxOf = u => { const b = u.full || u.box; return (b[0] + b[2]) / 2; };

function timesLike(u) {
  return u.k === 's' && (u.sym.label === '\\times' || ((u.sym.label === 'x' || u.sym.label === 'X') &&
    (u.sym.cands || []).some(([l, q]) => l === '\\times' && q >= 0.02)));
}

function baseline(units, ref) {
  if (!units.length) return [];
  units.sort((a, b) => (cxOf(a) - cxOf(b)) || (a.box[1] - b.box[1]));
  let cur = units[0]; cur.supU = []; cur.subU = [];
  let last = null, lastKind = 0;
  const row = [cur];
  for (let i = 1; i < units.length; i++) {
    const u = units[i];
    let r = relOf(cur, u, ref);
    const ul = u.k === 's' ? u.sym.label : null;
    // a cross between two numbers is a times sign, and the number after it is not its subscript: 8 × 7
    if (r === 2 && timesLike(cur) && ul !== null && /^[0-9]$/.test(ul) && row.length > 1) {
      const pv = row[row.length - 2];
      if ((pv.k === 's' && /^[0-9)]$/.test(pv.sym.label)) || pv.k === 'f' || pv.k === 'r') r = 0;
    }
    if (r === 0 && last && last.k === 's' && (last.sym.label === '-' || last.sym.label === '+' || last.sym.label === '\\pm') &&
      (lastKind === 1 ? cur.supU : cur.subU).length === 1 && !(ul !== null && (RELATIONS.has(ul) || NO_SCRIPT.has(ul)))) {
      // a script that starts with a sign continues with its number: d^{-7}
      const lb = last.box, ub = u.full || u.box, cb = cur.box;
      const cyu = (ub[1] + ub[3]) / 2, cyl = (lb[1] + lb[3]) / 2, cyc = (cb[1] + cb[3]) / 2;
      if (ub[0] < lb[2] + 0.6 * ref && Math.abs(cyu - cyl) < Math.abs(cyu - cyc)) r = lastKind;
    }
    if (r === 0 && ul !== null && (ul === '-' || ul === '+' || ul === '\\pm') && i + 1 < units.length && !(cur.k === 's' && NO_SCRIPT.has(cur.sym.label))) {
      // an operator leading a superscript: x^{-2}
      const v = units[i + 1], pu = relProbs(cur, u, ref);
      if (pu[1] > 0.25 || pu[2] > 0.25) {
        const pv = relProbs(cur, v, ref), k = pu[1] >= pu[2] ? 1 : 2;
        if (pv[k] > 0.6 && v.box[0] < u.box[2] + 0.6 * ref) r = k;
      } else if (ul === '-' && v.k === 's' && /^[0-9a-z]$/.test(v.sym.label)) {
        const pv = relProbs(cur, v, ref), cb = cur.box, vb = v.box, ub2 = u.box;
        const cyu = (ub2[1] + ub2[3]) / 2, cyv = (vb[1] + vb[3]) / 2;
        if (pv[1] > 0.75 && v.box[0] < u.box[2] + 0.5 * ref && cyu < cb[1] + 0.25 * (cb[3] - cb[1]) && Math.abs(cyu - cyv) < 0.35 * (vb[3] - vb[1] + 1e-9)) r = 1;
      }
    }
    if (r === 0) { cur = u; cur.supU = []; cur.subU = []; row.push(u); last = null; }
    else { (r === 1 ? cur.supU : cur.subU).push(u); last = u; lastKind = r; }
  }
  for (const u of row) {
    if (u.supU.length) u.sup = baseline(u.supU, ref);
    if (u.subU.length) u.sub = baseline(u.subU, ref);
    delete u.supU; delete u.subU;
  }
  return row;
}

function splitLines(units, ref) {
  const bands = [];
  const sorted = units.slice().sort((a, b) => (a.full || a.box)[1] - (b.full || b.box)[1]);
  for (const u of sorted) {
    const b = u.full || u.box, tol = 0.2 * ref;
    let hit = null;
    for (const band of bands) if (b[1] < band.y1 + tol && b[3] > band.y0 - tol) { hit = band; break; }
    if (hit) { hit.units.push(u); hit.y0 = Math.min(hit.y0, b[1]); hit.y1 = Math.max(hit.y1, b[3]); }
    else bands.push({ y0: b[1], y1: b[3], units: [u] });
  }
  bands.sort((a, b) => a.y0 - b.y0);
  let out = [];
  for (const band of bands) {
    const last = out[out.length - 1];
    if (last && band.y0 < last.y1 - 0.1 * ref) { last.units.push(...band.units); last.y1 = Math.max(last.y1, band.y1); }
    else out.push(band);
  }
  // a band of a few small symbols, each sitting like an exponent just above and to the right of a symbol in the
  // line below, is that line's exponents written high (x² · y³), not a line of its own
  const hOf = u => { const b = u.full || u.box; return b[3] - b[1]; };
  let merged = true;
  while (merged && out.length > 1) {
    merged = false;
    for (let i = 0; i + 1 < out.length; i++) {
      const band = out[i], tgt = out[i + 1];
      if (band.units.length > 4 || tgt.y0 - band.y1 > 0.8 * ref) continue;
      const th = median(tgt.units.map(hOf)), top = median(tgt.units.map(t => (t.full || t.box)[1]));
      // each unit starts just right of a symbol in the line below, or right after the previous unit of the band
      const us = band.units.slice().sort((a, b) => (a.full || a.box)[0] - (b.full || b.box)[0]);
      let prevX1 = null;
      const scriptLike = us.every(u => {
        const b = u.full || u.box;
        if (hOf(u) > th + 0.15 * ref || b[3] > top + 0.5 * th) return false;
        const ok = (prevX1 !== null && b[0] < prevX1 + 0.8 * ref) || tgt.units.some(t => {
          const tb = t.full || t.box;
          return b[0] > tb[0] + 0.3 * (tb[2] - tb[0]) && b[0] < tb[2] + 0.8 * ref && b[3] < tb[1] + 0.5 * (tb[3] - tb[1]);
        });
        prevX1 = Math.max(prevX1 === null ? -Infinity : prevX1, b[2]);
        return ok;
      });
      if (!scriptLike) continue;
      tgt.units.push(...band.units); tgt.y0 = Math.min(tgt.y0, band.y0); tgt.y1 = Math.max(tgt.y1, band.y1);
      out.splice(i, 1); merged = true; break;
    }
  }
  return out.map(b => b.units);
}

function layout(syms, ref, opts) {
  let units = syms.map(unitOf);
  units = takeRoots(units, ref, opts);
  units = takeFractions(units, ref, opts);
  const lines = opts.lines ? splitLines(units, ref) : [units];
  return lines.map(l => baseline(l, ref));
}

// ------------------------------------------------------------------ post-layout fix-ups
// A ")" with no "(" before it takes one from the most bracket-like 1 before it, and a "(" never closed takes a ")"
// from the most bracket-like 1 after it (the classifier's own second guess, when it is a real one).
function balanceBrackets(row, script) {
  const lab = u => (u.k === 's' ? u.sym.label : null);
  const pOf = (u, l) => { const c = (u.sym.cands || []).find(x => x[0] === l); return c ? c[1] : 0; };
  const loose = u => u.k === 's' && !u.sym.fixed && (u.sym.label === '1' || u.sym.label === 'l' || u.sym.label === 'I');
  const turn = (u, l) => { u.sym.label = l; u.type = symType(l); };
  let depth = 0;
  for (let i = 0; i < row.length; i++) {
    const l = lab(row[i]);
    if (l === '(') depth++;
    else if (l === ')') {
      if (depth > 0) { depth--; continue; }
      let best = -1, bp = 0.08;
      for (let k = i - 1; k >= 0; k--) if (loose(row[k]) && pOf(row[k], '(') > bp) { bp = pOf(row[k], '('); best = k; }
      if (best >= 0) turn(row[best], '(');
    }
  }
  depth = 0;
  for (let i = row.length - 1; i >= 0; i--) {
    const l = lab(row[i]);
    if (l === ')') depth++;
    else if (l === '(') {
      if (depth > 0) { depth--; continue; }
      let best = -1, bp = 0.08;
      for (let k = i + 1; k < row.length; k++) if (loose(row[k]) && pOf(row[k], ')') > bp) { bp = pOf(row[k], ')'); best = k; }
      if (best >= 0) turn(row[best], ')');
    }
  }
  // a bracket still without a partner that may well be a 1 (the 1 of 13 + 4 written with a curve) is the 1 (not in
  // a power or index, where a stray bracket is more likely a piece of something misread)
  if (!script) {
    const open = [], lone = [];
    for (const u of row) {
      const l = lab(u);
      if (l === '(') open.push(u);
      else if (l === ')') { if (open.length) open.pop(); else lone.push(u); }
    }
    // and stands like the digits beside it, in a number: a digit on its inside, nothing, a sign or a digit outside
    // (a small one low down would become part of an index once it is a 1; one after a letter is no part of a number)
    const digit = v => v && v.k === 's' && /^[0-9]$/.test(v.sym.label) && !v.sup && !v.sub;
    const edge = v => !v || digit(v) || v.type === T_OP;
    const tall = row.filter(digit).map(v => v.box);
    if (tall.length) {
      const h = median(tall.map(b => b[3] - b[1])), mid = median(tall.map(b => (b[1] + b[3]) / 2));
      for (const u of lone.concat(open)) {
        const b = u.box, i = row.indexOf(u), opening = lab(u) === '(';
        if (u.sym.fixed || pOf(u, '1') < 0.15 || b[3] - b[1] < 0.8 * h || Math.abs((b[1] + b[3]) / 2 - mid) > 0.3 * h) continue;
        if (opening ? digit(row[i + 1]) && edge(row[i - 1]) : digit(row[i - 1]) && edge(row[i + 1])) turn(u, '1');
      }
    }
  }
  for (const u of row) for (const k of ['sup', 'sub', 'num', 'den', 'body', 'idx']) if (u[k]) balanceBrackets(u[k], script || k === 'sup' || k === 'sub' || k === 'idx');
}
// how high a dot sits against the digits and letters beside it: 0 on their baseline, 0.5 halfway up (null: none beside it)
function dotLift(row, i, ref) {
  const u = row[i], nb = [row[i - 1], row[i + 1]].filter(v => v && v.k === 's' && (v.type === T_ASC || v.type === T_XH));
  if (!nb.length) {
    // between fractions: a dot level with a fraction bar is a times dot (2/3 · 3/4, not 2/3 − 3/4)
    const fr = [row[i - 1], row[i + 1]].find(v => v && v.k === 'f' && v.bar && v.bar.box);
    if (!fr) return null;
    const cy = (u.box[1] + u.box[3]) / 2, by = (fr.bar.box[1] + fr.bar.box[3]) / 2;
    return Math.abs(cy - by) < 0.25 * (fr.box[3] - fr.box[1]) ? 0.5 : 0;
  }
  let lift = 0;
  for (const v of nb) { const vb = v.box; lift += (vb[3] - (u.box[1] + u.box[3]) / 2) / Math.max(vb[3] - vb[1], 0.3 * ref); }
  return lift / nb.length;
}
function fixRow(row, ref, opts) {
  for (let i = 0; i < row.length; i++) {
    const u = row[i];
    // 8 x 7 between numbers is multiplication (a variable would not sit between two numbers in school maths)
    if (u.k === 's' && (u.sym.label === 'x' || u.sym.label === 'X') && !u.sym.fixed && !u.sup && !u.sub && i > 0 && i + 1 < row.length) {
      const a = row[i - 1], b = row[i + 1];
      const numL = (a.k === 's' && /^[0-9)]$/.test(a.sym.label) && !a.sup) || a.k === 'f';
      const numR = (b.k === 's' && /^[0-9]$/.test(b.sym.label)) || b.k === 'f';
      if (numL && numR && (u.sym.cands || []).some(([l, q]) => l === '\\times' && q >= 0.02)) { u.sym.label = '\\times'; u.type = symType('\\times'); }
    }
    if (u.k === 's' && (u.sym.label === '.' || u.sym.label === '\\cdot') && !(u.sym.fixed && u.sym.label === '\\cdot')) {
      // decimal point sits on the baseline; a centred dot is multiplication (one the writer fixed as a times dot stays)
      const lift = dotLift(row, i, ref);
      if (lift !== null) u.sym.label = lift > 0.3 ? '\\cdot' : '.';
    }
    if (opts.degrees && u.sup && u.sup.length === 1 && u.sup[0].k === 's' && CIRCLES.has(u.sup[0].sym.label) && !u.sup[0].sup && !u.sup[0].sub) {
      const c = u.sup[0], cb = c.box, ub = u.box, h = cb[3] - cb[1], w = cb[2] - cb[0];
      const baseOk = u.k === 's' && (/^[0-9]$/.test(u.sym.label) || u.sym.label === ')');
      if (baseOk && h < 0.55 * (ub[3] - ub[1]) && w / Math.max(h, 1e-9) > 0.6) c.sym.label = '\\circ';
    }
    for (const k of ['sup', 'sub', 'num', 'den', 'body', 'idx']) if (u[k]) fixRow(u[k], ref, opts);
  }
}

// ------------------------------------------------------------------ bigram context model
let LMD = null;
function lmData() {
  if (LMD) return LMD;
  const d = DATA.lm, V = d.vocab.length, ix = Object.fromEntries(d.vocab.map((v, i) => [v, i]));
  const uni = d.uni, N = uni.reduce((a, b) => a + b, 0);
  const puni = uni.map(c => (c + 0.5) / (N + 0.5 * V));
  const big = new Map(), cnt = new Float64Array(V), types = new Float64Array(V);
  for (const [a, b, c] of d.bi) { big.set(a * V + b, c); cnt[a] += c; types[a] += 1; }
  LMD = { V, ix, puni, big, cnt, types };
  return LMD;
}
function lmLogp(a, b) {
  const L = lmData();
  const ia = L.ix[a] !== undefined ? L.ix[a] : L.ix['<unk>'], ib = L.ix[b] !== undefined ? L.ix[b] : L.ix['<unk>'];
  const c = L.cnt[ia], lam = c > 0 ? c / (c + L.types[ia]) : 0;
  const ml = c > 0 ? (L.big.get(ia * L.V + ib) || 0) / c : 0;
  return Math.log(lam * ml + (1 - lam) * L.puni[ib]);
}
function tokOf(u) { return u.k === 's' ? u.sym.label : u.k === 'f' ? 'FRAC' : 'ROOT'; }
function lmTok(l) { return l === '\\sqrt' ? 'ROOT' : l; }

// how well a symbol's height fits a class, against the digits and capitals on the same row
const SIZE_MU = { [T_ASC]: 1.0, [T_XH]: 0.62 };
function sizeFit(row, u, label, g) {
  if (!g) return 0;
  const t = symType(label); if (!(t in SIZE_MU)) return 0;
  const hs = [];
  for (const v of row) if (v !== u && v.k === 's' && /^[0-9A-Z]$/.test(v.sym.label)) hs.push(v.box[3] - v.box[1]);
  if (!hs.length) return 0;
  const r = (u.box[3] - u.box[1]) / median(hs), d = r - SIZE_MU[t];
  return -g * d * d / (2 * 0.18 * 0.18);
}

function rescore(row, start, w, g, ref) {
  if (!row.length) return;
  const opts = row.map((u, i) => {
    if (!(u.k === 's' && u.sym.cands && u.sym.cands.length > 1 && !u.sym.fixed)) return [[tokOf(u), 0]];
    // a dot in the middle of the line is a times dot, and the context model hears it as one (x · x, not x . x,
    // which it would rather read as x - x)
    const lift = ref && u.sym.cands.slice(0, 5).some(([l]) => l === '.') ? dotLift(row, i, ref) : null;
    return u.sym.cands.slice(0, 5).map(([l, p]) => [l === '.' && lift !== null && lift > 0.3 ? '\\cdot' : l, Math.log(Math.max(p, 1e-6)) + sizeFit(row, u, l, g)]);
  });
  // Viterbi
  let prev = opts[0].map(([l, s]) => ({ l, s: s + w * lmLogp(start, l), b: -1 }));
  const hist = [prev];
  for (let i = 1; i < opts.length; i++) {
    const cur = opts[i].map(([l, s]) => {
      let bs = -Infinity, bi = 0;
      prev.forEach((p, k) => { const v = p.s + w * lmLogp(p.l, l); if (v > bs) { bs = v; bi = k; } });
      return { l, s: bs + s, b: bi };
    });
    hist.push(cur); prev = cur;
  }
  let bi = 0, bs = -Infinity;
  prev.forEach((p, k) => { const v = p.s + w * lmLogp(p.l, '</s>'); if (v > bs) { bs = v; bi = k; } });
  for (let i = opts.length - 1; i >= 0; i--) {
    const node = hist[i][bi];
    const u = row[i];
    if (u.k === 's' && opts[i].length > 1 && node.l !== u.sym.label) { u.sym.label = node.l; u.type = symType(node.l); }
    bi = node.b;
  }
  for (const u of row) {
    if (u.sup) rescore(u.sup, '<sup>', w, g, ref);
    if (u.sub) rescore(u.sub, '<sub>', w, g, ref);
    if (u.num) rescore(u.num, '<num>', w, g, ref);
    if (u.den) rescore(u.den, '<den>', w, g, ref);
    if (u.body) rescore(u.body, '<body>', w, g, ref);
    if (u.idx) rescore(u.idx, '<idx>', w, g, ref);
  }
}

// ------------------------------------------------------------------ output
const TEX = { '%': '\\%', '$': '\\$', '\\circ': '\\circ', '\\prime': '\\prime' };
const PLAIN = { '\\times': '*', '\\div': '/', '\\cdot': '*', '\\pi': 'pi', '\\le': '<=', '\\ge': '>=', '\\ne': '!=', '\\pm': '+-',
  '\\theta': 'theta', '\\alpha': 'alpha', '\\beta': 'beta', '\\Delta': 'Delta', '\\circ': 'deg', '\\prime': "'", '\\infty': 'inf',
  '\\rightarrow': '->', '\\ldots': '...', '\\{': '{', '\\}': '}', '\\sqrt': 'sqrt', '\\gamma': 'gamma', '\\lambda': 'lambda',
  '\\mu': 'mu', '\\sigma': 'sigma', '\\phi': 'phi', '\\sum': 'sum', '\\int': 'int', '\\lim': 'lim', '\\log': 'log', '\\sin': 'sin',
  '\\cos': 'cos', '\\tan': 'tan', '\\in': ' in ', '\\exists': 'exists', '\\forall': 'forall' };

function rowTokens(row) {
  const out = [];
  for (const u of row) {
    if (u.k === 's') out.push(u.sym.label);
    else if (u.k === 'f') out.push('\\frac', '{', ...rowTokens(u.num), '}', '{', ...rowTokens(u.den), '}');
    else { out.push('\\sqrt'); if (u.idx) out.push('[', ...rowTokens(u.idx), ']'); out.push('{', ...rowTokens(u.body), '}'); }
    if (u.sub) out.push('_', '{', ...rowTokens(u.sub), '}');
    if (u.sup) out.push('^', '{', ...rowTokens(u.sup), '}');
  }
  return out;
}
function joinTex(tokens) {
  let s = '';
  for (const t0 of tokens) {
    const t = TEX[t0] || t0;
    if (/\\[A-Za-z]+$/.test(s) && /^[A-Za-z0-9]/.test(t)) s += ' ';
    s += t;
  }
  return s;
}
function plain(row) {
  let s = '';
  const wrap = (r) => { const t = plain(r); return /^[A-Za-z0-9.]+$/.test(t) || /^\(.*\)$/.test(t) && balanced(t.slice(1, -1)) ? t : '(' + t + ')'; };
  row.forEach((u, i) => {
    let t;
    const nx = row[i + 1];
    if (u.k === 's') t = PLAIN[u.sym.label] || u.sym.label;
    else if (u.k === 'f') {
      t = wrap(u.num) + '/' + wrap(u.den);
      // (3/4)x, not 3/4x
      if (nx && (nx.k !== 's' || /^[A-Za-z(]$|^\\(pi|theta|alpha|beta|sqrt)$/.test(nx.sym.label)) || u.sup) t = '(' + t + ')';
    }
    else t = (u.idx ? 'root(' + plain(u.idx) + ', ' + plain(u.body) + ')' : 'sqrt(' + plain(u.body) + ')');
    if (u.k === 'f' && /[0-9.]$/.test(s)) s += ' ';
    s += t;
    if (u.sub) s += '_' + wrap(u.sub);
    if (u.sup) s += (u.sup.length === 1 && u.sup[0].k === 's' && u.sup[0].sym.label === '\\circ') ? '°' : '^' + wrap(u.sup);
  });
  return s;
}
function balanced(t) { let d = 0; for (const c of t) { if (c === '(') d++; else if (c === ')') { d--; if (d < 0) return false; } } return d === 0; }

// Two symbols one above the other, read as neighbours on a line (a fraction whose bar was missed: ½ read as −12),
// are marked doubtful, and no answer is worked out from a reading with them.
function markStacked(row) {
  for (let i = 0; i + 1 < row.length; i++) {
    const a = row[i], b = row[i + 1];
    if (a.k !== 's' || b.k !== 's') continue;
    const A = a.box, B = b.box, across = Math.min(A[2], B[2]) - Math.max(A[0], B[0]);
    if (Math.max(B[1] - A[3], A[1] - B[3]) > 0 && across > 0.5 * Math.max(Math.min(A[2] - A[0], B[2] - B[0]), 1e-9)) a.doubt = b.doubt = true;
    // a minus wholly above what follows it is no minus of it: a fraction bar whose numerator went to the line above
    // (½ read as 1 over "7 + −2", which would be answered 5)
    if (a.sym.label === '-' && b.type !== T_SMALL && (A[1] + A[3]) / 2 < B[1] - 0.1 * (B[3] - B[1])) a.doubt = b.doubt = true;
  }
  // a power or index straight above or below its base, not beside it (the 1 of a ½ with no bar read as 2¹)
  for (const u of row) {
    if (u.k === 's' && u.box) for (const key of ['sup', 'sub']) {
      if (!u[key] || !u[key].length) continue;
      const S = u[key].map(v => v.box).filter(Boolean).reduce((p, q) => [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[2], q[2]), Math.max(p[3], q[3])]);
      if ((S[0] + S[2]) / 2 < u.box[0] + 0.75 * (u.box[2] - u.box[0])) u.doubt = true;
    }
    for (const k of ['sup', 'sub', 'num', 'den', 'body', 'idx']) if (u[k]) markStacked(u[k]);
  }
}
function strip(row) {
  return row.map(u => {
    const o = u.k === 's' ? Object.assign({ k: 's', label: u.sym.label, strokes: u.sym.strokes }, u.doubt ? { doubt: true } : {}) : u.k === 'f'
      ? { k: 'frac', strokes: u.bar.strokes, num: strip(u.num), den: strip(u.den) }
      : { k: 'root', strokes: u.rad.strokes, body: strip(u.body), idx: u.idx ? strip(u.idx) : undefined };
    if (u.sup) o.sup = strip(u.sup); if (u.sub) o.sub = strip(u.sub);
    return o;
  });
}

function finish(syms, ref, opts) {
  syms = mergeColons(syms, ref);
  let lines = layout(syms, ref, opts);
  let barsChanged = false;
  for (const row of lines) barsChanged = fixBars(row, ref, opts) || barsChanged;
  if (barsChanged) lines = layout(syms, ref, opts);
  if (opts.lm > 0 && DATA.lm) {
    const before = syms.map(s => s.label).join('\u0001');
    for (const row of lines) rescore(row, '<s>', opts.lm, opts.size, ref);
    // the context model changed a symbol (x -> \times, 2 -> z): lay out again with the new labels
    if (syms.map(s => s.label).join('\u0001') !== before) lines = layout(syms, ref, opts);
  }
  // brackets that do not pair up: a "(" or ")" was read as a 1 (12(3) is not 1213))
  const unbalanced = syms.map(s => s.label).join('\u0001');
  for (const row of lines) balanceBrackets(row);
  if (syms.map(s => s.label).join('\u0001') !== unbalanced) lines = layout(syms, ref, opts);
  for (const row of lines) { fixRow(row, ref, opts); markStacked(row); }
  const lineOut = lines.map(row => { const tokens = rowTokens(row); return { latex: joinTex(tokens), text: plain(row), tokens }; });
  let conf = 1;
  for (const s of syms) conf *= (s.cands && s.cands[0] ? s.cands[0][1] : 1) * (1 - (s.junk || 0));
  return {
    latex: lineOut.length > 1 ? '\\begin{gathered}' + lineOut.map(l => l.latex).join(' \\\\ ') + '\\end{gathered}' : (lineOut[0] ? lineOut[0].latex : ''),
    text: lineOut.map(l => l.text).join('\n'),
    lines: lineOut,
    tree: lines.map(strip),
    symbols: syms.map(s => ({ label: s.label, latex: TEX[s.label] || s.label, strokes: s.strokes, box: { x: s.box[0], y: s.box[1], w: s.box[2] - s.box[0], h: s.box[3] - s.box[1] }, candidates: (s.cands || []).slice(0, 6), fixed: !!s.fixed })),
    confidence: Math.pow(conf, 1 / Math.max(1, syms.length)),
  };
}
