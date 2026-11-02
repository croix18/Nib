/* Nib — handwritten math to LaTeX. Recognition core. No dependencies.
 * Pipeline: strokes -> symbol groups (time-ordered DP: CNN + stroke-join model)
 *           -> layout (roots, fraction bars, lines, baselines via a relation model)
 *           -> context rescoring (bigram model) -> LaTeX / plain text.
 */
'use strict';

const DATA = /*__DATA__*/ null;

// ------------------------------------------------------------------ helpers
const LOG0 = -1e9;
function clip(x, a, b) { return x < a ? a : x > b ? b : x; }
function lg(x) { return Math.log(Math.max(x, 1e-4)); }

function b64bytes(s) {
  if (typeof atob === 'function') {
    const bin = atob(s); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64'));
}

function median(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function rint(x) { // numpy-style round half to even (x >= 0)
  const f = Math.floor(x); const d = x - f;
  if (d > 0.5) return f + 1; if (d < 0.5) return f; return f % 2 === 0 ? f : f + 1;
}

// strokes are arrays of [x, y]
function sbox(s) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of s) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}
function ubox(a, b) { return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; }
function boxGap(a, b) { return Math.max(0, b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[3]); }
function plen(s) { let t = 0; for (let i = 1; i < s.length; i++) t += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); return t; }

function refSize(strokes) {
  const sz = strokes.map(s => { const b = sbox(s); return Math.max(b[2] - b[0], b[3] - b[1]); });
  const r = median(sz);
  return r > 1e-6 ? r : 1;
}

// ------------------------------------------------------------------ model data
let M = null;
function model() {
  if (M) return M;
  if (!DATA) throw new Error('Nib: model data missing');
  const C = DATA.classes.length;
  const q = new Int8Array(b64bytes(DATA.cnn.q).buffer);
  const sc = new Float32Array(b64bytes(DATA.cnn.s).buffer);
  const bias = new Float32Array(b64bytes(DATA.cnn.b).buffer);
  let qo = 0, so = 0, bo = 0;
  const L = {};
  for (const [name, n, co, k] of DATA.cnn.layout) { // name, weight count, out channels, 1-D kernel width
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = q[qo + i] * sc[so + (i % co)];
    L[name] = { w, b: bias.subarray(bo, bo + co), co, k: k || 3 };
    qo += n; so += co; bo += co;
  }
  const cls = DATA.classes;
  M = { C, L, cls, idx: Object.fromEntries(cls.map((c, i) => [c, i])), junk: cls.indexOf('junk') };
  return M;
}

// ------------------------------------------------------------------ rasterizer (mirror of raster.py)
const G = 32, MARGIN = 2, STEP = 0.5;

function rasterize(strokes, ref) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) { const b = sbox(s); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
  const w = x1 - x0, h = y1 - y0;
  const size = Math.max(w, h, 0.3 * ref, 1e-9);
  const scale = (G - 2 * MARGIN) / size;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const acc = new Float64Array(G * G * 4); // HWC
  const splat = (x, y, ch, wt) => {
    const px = x - 0.5, py = y - 0.5;
    const i0 = Math.floor(px), j0 = Math.floor(py);
    const fx = px - i0, fy = py - j0;
    if (j0 >= 0 && j0 < G) {
      if (i0 >= 0 && i0 < G) acc[(j0 * G + i0) * 4 + ch] += wt * (1 - fx) * (1 - fy);
      if (i0 + 1 >= 0 && i0 + 1 < G) acc[(j0 * G + i0 + 1) * 4 + ch] += wt * fx * (1 - fy);
    }
    if (j0 + 1 >= 0 && j0 + 1 < G) {
      if (i0 >= 0 && i0 < G) acc[((j0 + 1) * G + i0) * 4 + ch] += wt * (1 - fx) * fy;
      if (i0 + 1 >= 0 && i0 + 1 < G) acc[((j0 + 1) * G + i0 + 1) * 4 + ch] += wt * fx * fy;
    }
  };
  let total = 0;
  for (const s of strokes) {
    const n = s.length;
    const qx = new Float64Array(n), qy = new Float64Array(n);
    for (let i = 0; i < n; i++) { qx[i] = (s[i][0] - cx) * scale + G / 2; qy[i] = (s[i][1] - cy) * scale + G / 2; }
    let Lsum = 0;
    for (let i = 1; i < n; i++) { total += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); Lsum += Math.hypot(qx[i] - qx[i - 1], qy[i] - qy[i - 1]); }
    if (n === 1 || Lsum < STEP) {
      let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += qx[i]; my += qy[i]; } mx /= n; my /= n;
      for (let ch = 0; ch < 4; ch++) splat(mx, my, ch, 0.5);
      continue;
    }
    for (let i = 0; i + 1 < n; i++) {
      const dx = qx[i + 1] - qx[i], dy = qy[i + 1] - qy[i];
      const L = Math.hypot(dx, dy);
      if (!(L > 1e-9)) continue;
      let th = Math.atan2(dy, dx);
      if (th < 0) th += Math.PI;
      if (th >= Math.PI) th -= Math.PI;
      const pos = th / (Math.PI / 4);
      const fl = Math.floor(pos);
      const k0 = ((fl % 4) + 4) % 4, f = pos - fl, k1 = (k0 + 1) % 4;
      const m = Math.ceil(L / STEP), wl = L / m;
      for (let j = 0; j < m; j++) {
        const t = (j + 0.5) / m;
        const x = qx[i] + t * dx, y = qy[i] + t * dy;
        splat(x, y, k0, (1 - f) * wl);
        splat(x, y, k1, f * wl);
      }
    }
  }
  const img = new Float32Array(G * G * 4);
  for (let i = 0; i < img.length; i++) { const v = acc[i] > 1 ? 1 : acc[i]; img[i] = Math.round(v * 255) / 255; }
  const e = 0.02 * ref + 1e-9;
  const scal = new Float32Array([
    clip(Math.log((w + e) / (h + e)), -4, 4) / 2,
    clip(Math.log((h + e) / ref), -4, 2) / 2,
    clip(Math.log((w + e) / ref), -4, 2) / 2,
    Math.min(strokes.length - 1, 3) / 3,
    clip(Math.log(total / ref + 0.01), -4, 3) / 2,
  ]);
  return { img, scal };
}

// ------------------------------------------------------------------ CNN
function conv3(inp, H, Wd, ci, lay, out) {
  // 3x3 SAME convolution (HWC), bias + ReLU; each tap's weight row is streamed once
  const { w, b, co } = lay, HW = H * Wd;
  for (let p = 0; p < HW; p++) out.set(b, p * co);
  for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
    const y0 = Math.max(0, 1 - ky), y1 = Math.min(H, H + 1 - ky), x0 = Math.max(0, 1 - kx), x1 = Math.min(Wd, Wd + 1 - kx);
    for (let c = 0; c < ci; c++) {
      const wr = ((ky * 3 + kx) * ci + c) * co;
      for (let y = y0; y < y1; y++) {
        const iy = (y + ky - 1) * Wd;
        for (let x = x0; x < x1; x++) {
          const v = inp[(iy + x + kx - 1) * ci + c]; if (v === 0) continue;
          const o = (y * Wd + x) * co;
          for (let d = 0; d < co; d++) out[o + d] += v * w[wr + d];
        }
      }
    }
  }
  for (let i = 0; i < HW * co; i++) if (out[i] < 0) out[i] = 0;
}
function pool2(inp, H, Wd, c) {
  const H2 = H >> 1, W2 = Wd >> 1, out = new Float32Array(H2 * W2 * c);
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) for (let k = 0; k < c; k++) {
    const a = inp[((2 * y) * Wd + 2 * x) * c + k], b = inp[((2 * y) * Wd + 2 * x + 1) * c + k];
    const d = inp[((2 * y + 1) * Wd + 2 * x) * c + k], e = inp[((2 * y + 1) * Wd + 2 * x + 1) * c + k];
    out[(y * W2 + x) * c + k] = Math.max(a, b, d, e);
  }
  return out;
}
function convFeatures(img) {
  const { L } = model();
  // five 3x3 conv layers, 2x2 max-pool after the 1st, 3rd and 5th: 32 -> 16 -> 8 -> 4
  let h = img, H = 32, ci = 4;
  for (let i = 0; i < 5; i++) {
    const lay = L['c' + i], out = new Float32Array(H * H * lay.co);
    conv3(h, H, H, ci, lay, out);
    h = out; ci = lay.co;
    if (i === 0 || i === 2 || i === 4) { h = pool2(h, H, H, ci); H >>= 1; }
  }
  return h; // 4*4*C
}

// ------------------------------------------------------------------ trajectory branch (mirror of online.py)
const OK_ = 48, ONF = 5;
function onlineFeatures(strokes, ref) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const p of s) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  const size = Math.max(x1 - x0, y1 - y0, 0.3 * ref, 1e-9), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const out = new Float32Array(OK_ * ONF);
  const segs = [];
  strokes.forEach((s, si) => {
    for (let i = 0; i + 1 < s.length; i++) {
      const ax = (s[i][0] - cx) / size, ay = (s[i][1] - cy) / size, bx = (s[i + 1][0] - cx) / size, by = (s[i + 1][1] - cy) / size;
      const L = Math.hypot(bx - ax, by - ay);
      if (L > 1e-12) segs.push([si, ax, ay, bx, by, L]);
    }
  });
  if (!segs.length) {
    let mx = 0, my = 0, n = 0;
    for (const s of strokes) for (const p of s) { mx += (p[0] - cx) / size; my += (p[1] - cy) / size; n++; }
    for (let k = 0; k < OK_; k++) { out[k * ONF] = mx / n; out[k * ONF + 1] = my / n; }
    return out;
  }
  let total = 0; for (const g of segs) total += g[5];
  let k = 0, acc = 0, prev = -1;
  for (const [si, ax, ay, bx, by, L] of segs) {
    while (k < OK_ && (k + 0.5) * total / OK_ <= acc + L + 1e-12) {
      let t = ((k + 0.5) * total / OK_ - acc) / L; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const o = k * ONF;
      out[o] = ax + t * (bx - ax); out[o + 1] = ay + t * (by - ay);
      out[o + 2] = (bx - ax) / L; out[o + 3] = (by - ay) / L;
      out[o + 4] = (prev !== -1 && si !== prev) ? 1 : 0;
      prev = si; k++;
    }
    acc += L;
  }
  for (; k < OK_; k++) { for (let j = 0; j < ONF; j++) out[k * ONF + j] = out[(k - 1) * ONF + j]; out[k * ONF + 4] = 0; }
  return out;
}
function conv1(inp, T, ci, lay, out) {
  const { w, b, co, k } = lay, pad = (k - 1) >> 1;
  for (let t = 0; t < T; t++) {
    const o = t * co;
    for (let c = 0; c < co; c++) out[o + c] = b[c];
    for (let j = 0; j < k; j++) {
      const tt = t + j - pad; if (tt < 0 || tt >= T) continue;
      const ii = tt * ci, wo = j * ci * co;
      for (let c = 0; c < ci; c++) { const v = inp[ii + c]; if (v === 0) continue; const wr = wo + c * co; for (let d = 0; d < co; d++) out[o + d] += v * w[wr + d]; }
    }
    for (let c = 0; c < co; c++) if (out[o + c] < 0) out[o + c] = 0;
  }
}
function onlineBranch(f) {
  const { L } = model();
  if (!L.o0) return null;
  let h = f, T = OK_, ci = ONF;
  for (let i = 0; i < 3; i++) {
    const lay = L['o' + i], out = new Float32Array(T * lay.co);
    conv1(h, T, ci, lay, out); h = out; ci = lay.co;
    if (i === 1) { const T2 = T >> 1, q = new Float32Array(T2 * ci); for (let t = 0; t < T2; t++) for (let c = 0; c < ci; c++) q[t * ci + c] = Math.max(h[2 * t * ci + c], h[(2 * t + 1) * ci + c]); h = q; T = T2; }
  }
  const g = new Float32Array(2 * ci);
  for (let c = 0; c < ci; c++) { let mx = -Infinity, sm = 0; for (let t = 0; t < T; t++) { const v = h[t * ci + c]; if (v > mx) mx = v; sm += v; } g[c] = mx; g[ci + c] = sm / T; }
  return g;
}

function fcProbs(feat, scal, onl) {
  const { L, C } = model();
  const f1 = L.f1, n1 = f1.co, x = new Float32Array(feat.length + (onl ? onl.length : 0) + scal.length);
  x.set(feat); if (onl) x.set(onl, feat.length); x.set(scal, feat.length + (onl ? onl.length : 0));
  const h = new Float32Array(n1);
  for (let j = 0; j < n1; j++) h[j] = f1.b[j];
  for (let i = 0; i < x.length; i++) { const v = x[i]; if (v === 0) continue; const r = i * n1; for (let j = 0; j < n1; j++) h[j] += v * f1.w[r + j]; }
  for (let j = 0; j < n1; j++) if (h[j] < 0) h[j] = 0;
  const f2 = L.f2, z = new Float64Array(C);
  for (let j = 0; j < C; j++) z[j] = f2.b[j];
  for (let i = 0; i < n1; i++) { const v = h[i]; if (v === 0) continue; const r = i * C; for (let j = 0; j < C; j++) z[j] += v * f2.w[r + j]; }
  let mx = -Infinity; for (let j = 0; j < C; j++) if (z[j] > mx) mx = z[j];
  let s = 0; for (let j = 0; j < C; j++) { z[j] = Math.exp(z[j] - mx); s += z[j]; }
  for (let j = 0; j < C; j++) z[j] /= s;
  z.hidden = h; // the symbol's embedding, used by the personal memory
  return z;
}
// class probabilities for a group of strokes (with .hidden = embedding)
function classifyGroup(group, ref) {
  const { img, scal } = rasterize(group, ref);
  const onl = model().L.o0 ? onlineBranch(onlineFeatures(group, ref)) : null;
  return fcProbs(convFeatures(img), scal, onl);
}

// ------------------------------------------------------------------ personal memory
// Corrections teach Nib a writer's own shapes: each one keeps the symbol's embedding and label.
// A new symbol that is nearly identical to a remembered one leans toward that label.
// Kept in this browser only (localStorage), never sent anywhere.
const MEM_KEY = 'nib-memory-v1', MEM_MAX = 400;
const MEM = { items: null, version: 0 };
function memLoad() {
  if (MEM.items) return MEM.items;
  MEM.items = [];
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(MEM_KEY);
    if (raw) { const d = JSON.parse(raw); if (d && d.model === modelId()) MEM.items = d.items.map(it => ({ l: it.l, v: Float32Array.from(it.v) })); }
  } catch (e) { /* storage unavailable */ }
  return MEM.items;
}
function memSave() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MEM_KEY, JSON.stringify({ model: modelId(), items: MEM.items.map(it => ({ l: it.l, v: Array.from(it.v, x => Math.round(x * 1000) / 1000) })) }));
  } catch (e) { /* full or blocked: memory still works for this page */ }
}
function modelId() { return DATA && DATA.cnn ? DATA.cnn.id || 'm' : 'm'; }
function unit(h) { let n = 0; for (const x of h) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(h, x => x / n); }
function memLearn(hidden, label) {
  const items = memLoad(), v = unit(hidden);
  // replace a near-identical sample instead of piling up copies
  for (let i = 0; i < items.length; i++) { let d = 0; for (let j = 0; j < v.length; j++) d += v[j] * items[i].v[j]; if (d > 0.985) { items.splice(i, 1); break; } }
  items.push({ l: label, v });
  if (items.length > MEM_MAX) items.splice(0, items.length - MEM_MAX);
  MEM.version++; memSave();
}
function memApply(p, mask) {
  const items = memLoad();
  if (!items.length || !p.hidden) return p;
  const v = unit(p.hidden), { idx, junk } = model();
  let best = 0; const score = {};
  for (const it of items) {
    let d = 0; for (let j = 0; j < v.length; j++) d += v[j] * it.v[j];
    if (d > MEM_SIM0) { const w = Math.pow(d, 8); score[it.l] = (score[it.l] || 0) + w; if (d > best) best = d; }
  }
  if (best <= MEM_SIM0) return p;
  const lam = Math.min(1, (best - MEM_SIM0) / (MEM_SIM1 - MEM_SIM0)) * MEM_LAMBDA;
  let tot = 0; for (const l in score) if (idx[l] !== undefined && (!mask || mask[idx[l]])) tot += score[l];
  if (!tot) return p;
  const q = Float64Array.from(p, (x, c) => c === junk ? x : x * (1 - lam));
  for (const l in score) if (idx[l] !== undefined && (!mask || mask[idx[l]])) q[idx[l]] += lam * (1 - p[junk]) * score[l] / tot;
  q.hidden = p.hidden;
  return q;
}
let MEM_SIM0 = 0.88, MEM_SIM1 = 0.96, MEM_LAMBDA = 0.8;

// ------------------------------------------------------------------ small MLPs (sklearn export)
function mlp(m, f) {
  let x = f.map((v, i) => (v - m.mu[i]) / m.sd[i]);
  for (let l = 0; l < m.W.length; l++) {
    const W = m.W[l], b = m.b[l], y = new Array(W.length);
    for (let j = 0; j < W.length; j++) { let s = b[j]; const r = W[j]; for (let i = 0; i < r.length; i++) s += r[i] * x[i]; y[j] = s; }
    if (l < m.W.length - 1) for (let j = 0; j < y.length; j++) y[j] = y[j] > 0 ? y[j] : 0;
    x = y;
  }
  if (x.length === 1) return [1 / (1 + Math.exp(-x[0]))];
  const mx = Math.max(...x); const e = x.map(v => Math.exp(v - mx)); const s = e.reduce((a, b) => a + b, 0);
  return e.map(v => v / s);
}

function subsample(s, k) {
  if (s.length <= k) return s;
  const out = []; const step = (s.length - 1) / (k - 1);
  for (let i = 0; i < k; i++) out.push(s[i === k - 1 ? s.length - 1 : rint(i * step)]);
  return out;
}
function segIntersections(a, b, cap) {
  a = subsample(a, 24); b = subsample(b, 24);
  let n = 0;
  for (let i = 0; i + 1 < a.length; i++) {
    const p = a[i], r0 = a[i + 1][0] - p[0], r1 = a[i + 1][1] - p[1];
    for (let j = 0; j + 1 < b.length; j++) {
      const q = b[j], s0 = b[j + 1][0] - q[0], s1 = b[j + 1][1] - q[1];
      const den = r0 * s1 - r1 * s0; if (Math.abs(den) < 1e-12) continue;
      const t = ((q[0] - p[0]) * s1 - (q[1] - p[1]) * s0) / den;
      const u = ((q[0] - p[0]) * r1 - (q[1] - p[1]) * r0) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) { n++; if (n >= cap) return n; }
    }
  }
  return n;
}
function minDist(a, b) {
  a = subsample(a, 32); b = subsample(b, 32);
  let m = Infinity;
  for (const p of a) for (const q of b) { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < m) m = d; }
  return Math.sqrt(m);
}
function joinFeatures(a, b, ref) {
  const A = sbox(a), B = sbox(b);
  const wa = A[2] - A[0], ha = A[3] - A[1], wb = B[2] - B[0], hb = B[3] - B[1];
  const gap = boxGap(A, B);
  const ox = Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0]));
  const oy = Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1]));
  const e = 0.05 * ref;
  const ux = Math.max(A[2], B[2]) - Math.min(A[0], B[0]), uy = Math.max(A[3], B[3]) - Math.min(A[1], B[1]);
  return [gap / ref, minDist(a, b) / ref, ox / (Math.min(wa, wb) + e), oy / (Math.min(ha, hb) + e),
    ((B[0] + B[2]) - (A[0] + A[2])) / 2 / ref, ((B[1] + B[3]) - (A[1] + A[3])) / 2 / ref,
    lg((ha + e) / ref), lg((wa + e) / ref), lg((hb + e) / ref), lg((wb + e) / ref),
    segIntersections(a, b, 3) / 3, Math.hypot(b[0][0] - a[a.length - 1][0], b[0][1] - a[a.length - 1][1]) / ref,
    lg((ux + e) / ref), lg((uy + e) / ref), lg(plen(a) / ref + 0.01), lg(plen(b) / ref + 0.01)];
}

// typography classes (mirror of geo_models.py)
const T_ASC = 0, T_XH = 1, T_DESC = 2, T_OP = 3, T_SMALL = 4, T_PAREN = 5, T_FRAC = 6, T_ROOT = 7, T_BIG = 8, T_SLASH = 9, NT = 10;
const ASC = new Set('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZbdfhkilt!?'.split('').concat(['\\delta', '\\theta', '\\lambda', '\\Delta', '$', '%']));
const DESC = new Set('gjpqy'.split('').concat(['\\beta', '\\gamma', '\\mu', '\\rho', '\\phi', '\\chi', '\\psi']));
const XH = new Set('acemnorsuvwxz'.split('').concat(['\\alpha', '\\pi', '\\sigma', '\\omega', '\\infty', '\\epsilon', '\\nu']));
const OP = new Set(['+', '-', '=', '\\times', '\\div', '\\pm', '\\ne', '<', '>', '\\le', '\\ge', '\\rightarrow', '\\in', '\\forall', '\\exists', '\\cdot', ':']);
const SMALL = new Set(['.', ',', '\\prime', '\\ldots', "'"]);
const PAREN = new Set(['(', ')', '[', ']', '\\{', '\\}', '|']);
const BIG = new Set(['\\sum', '\\int', '\\lim', '\\log', '\\sin', '\\cos', '\\tan']);
function symType(l) {
  if (ASC.has(l)) return T_ASC; if (XH.has(l)) return T_XH; if (DESC.has(l)) return T_DESC; if (OP.has(l)) return T_OP;
  if (SMALL.has(l)) return T_SMALL; if (PAREN.has(l)) return T_PAREN; if (BIG.has(l)) return T_BIG; if (l === '/') return T_SLASH;
  if (l === '\\sqrt') return T_ROOT; return T_ASC;
}
const LETTERS = new Set(['\\alpha', '\\beta', '\\theta', '\\pi', '\\lambda', '\\mu', '\\sigma', '\\phi', '\\gamma', '\\Delta']);
const isDigit = l => l != null && l.length === 1 && l >= '0' && l <= '9';
const isLetter = l => l != null && ((l.length === 1 && /[A-Za-z]/.test(l)) || LETTERS.has(l));
function relFeatures(P, tP, Cb, tC, ref, lP, lC) {
  const hP = P[3] - P[1], wP = P[2] - P[0], hC = Cb[3] - Cb[1];
  const hs = Math.max(hP, 0.5 * ref);
  const cyP = (P[1] + P[3]) / 2, cyC = (Cb[1] + Cb[3]) / 2;
  const oy = Math.max(0, Math.min(P[3], Cb[3]) - Math.max(P[1], Cb[1]));
  const f = new Array(2 * NT).fill(0); f[tP] = 1; f[NT + tC] = 1;
  f.push((Cb[1] - P[1]) / ref, (Cb[3] - P[3]) / ref, (cyC - cyP) / ref,
    (Cb[1] - P[1]) / hs, (Cb[3] - P[3]) / hs, (cyC - cyP) / hs,
    lg((hC + 0.02 * ref) / hs), lg((hC + 0.02 * ref) / ref), lg((hP + 0.02 * ref) / ref),
    (Cb[0] - P[2]) / ref, (Cb[0] - P[0]) / Math.max(wP, 0.5 * ref),
    oy / (Math.min(hP, hC) + 0.02 * ref),
    +isDigit(lP), +isLetter(lP), +isDigit(lC), +isLetter(lC));
  return f;
}

// ------------------------------------------------------------------ symbol sets
const PRESETS = {
  all: null,
  school: { exclude: ['\\sin', '\\cos', '\\tan', '\\log', '\\lim', '\\sum', '\\int', '\\exists', '\\forall', '\\in', '\\rightarrow',
    '\\infty', '\\ldots', '\\gamma', '\\lambda', '\\mu', '\\sigma', '\\phi', '\\{', '\\}', '!', 'l', 'I', 'o', 'O', 'X'] },
  numbers: { include: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', ',', '-', '+', '/', '%', '$', '(', ')', '\\times', '\\div', '='] },
};
function allowedMask(symbols) {
  const { cls, junk } = model();
  const mask = new Uint8Array(cls.length);
  let spec = symbols === undefined ? PRESETS.school : (typeof symbols === 'string' ? PRESETS[symbols] : symbols);
  if (spec === undefined) throw new Error('Nib: unknown symbol set ' + symbols);
  if (spec === null) mask.fill(1);
  else if (Array.isArray(spec)) { for (const s of spec) if (s in model().idx) mask[model().idx[s]] = 1; }
  else if (spec.include) { for (const s of spec.include) if (s in model().idx) mask[model().idx[s]] = 1; }
  else { mask.fill(1); for (const s of spec.exclude) if (s in model().idx) mask[model().idx[s]] = 0; }
  mask[junk] = 1; mask[model().idx['-']] = 1;
  return mask;
}
