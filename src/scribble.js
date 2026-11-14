// ================================================================== scribble out
// A pen or marker stroke that goes back and forth over writing — scribbled out — rubs out what it lies over (Croix,
// 8 Nov 2026: "Scribble out to erase", then "I've experienced other apps that claim scribble to erase works and it
// sucks. I want nib and by extension deckhand to work super well.").
//
// Two questions, asked of every stroke as it is lifted, and both have to say yes:
//
// scribbleOf(pts, z) — is it a scribble, by its shape alone? (z: screen px per unit)
//   - a zig-zag: five legs or more back and forth along one line, each at least half the longest, nearly all of its
//     turns sharp (it goes back the way it came: the round turns of an 8, an m, a ∞ or a cursive word are not), the
//     path long and close-packed for its size (L² / hull area ≥ 20, and ≥ 25 with only five legs: a W or an M written
//     over a symbol is not), the legs at least 12 px;
//   - a coil: loops that cross each other five times or more, packed as tight (L² / area ≥ 45) and filling what they
//     span (a circle gone round three times to ring an answer is not: its middle is empty), at least 20 px across.
//
// scribbleErase(sc, items, z) — what does it rub out? Only what it lies over: a stroke (walked in small even steps) at
// least 60% inside the scribble and within its band (a little more than half the gap between its passes) goes; one it
// only clips stays; a symbol most of which is under it goes whole (its dot or its small parts with it). A clear scribble
// that falls short of a symbol's edges, or covers most of it and not the rest, takes the symbols it is on when nothing
// else is under it (1.6.5: a hand at the board is not that careful). A scribble over clear paper rubs out nothing and
// stays, as ink. Shading is not scribbling out: a scribble that fills a space bounded by lines (its turns on the lines
// on both sides — or at a drawn straight line, one side of a region — or inside a closed shape) and has only a little
// writing inside it is shading, and the lines of a drawing (a number line's ticks, a fraction bar's dividers, the dot on
// a number line) are not taken with it: a straight mark joined to a long line it does not cover, or a mark a long line
// runs through, stays.
//
// A scribble the board hears in pieces (a pen off the glass for a moment at a turn) is put together by the pad
// (Pad._scribbleJoin) and asked these questions whole.

// the bars (measured: see test/scribble_check.js)
const SCR = { share: 0.6, group: 0.5, fin: 0.75, deep: 0.125 };
function scrLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
function scrBox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}
function scrHull(pts) {
  const P = pts.map(p => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function scrArea(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }
// is p inside the hull (a convex polygon with a positive signed area, as scrHull makes it) by at least `m` (m < 0: or
// that close outside it)?
function scrInHull(p, hull, m) {
  const n = hull.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1;
    if ((ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / L < m) return false;   // signed distance from the edge's line
  }
  return true;
}
// is p inside any polygon (even-odd)?
function scrInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) inside = !inside;
  }
  return inside;
}
// the stroke's two main axes (along its longest spread, and across it), and the four plain ones
function scrAxes(pts) {
  const n = pts.length; let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let a = 0, b = 0, c = 0;
  for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; a += dx * dx; b += dx * dy; c += dy * dy; }
  const th = 0.5 * Math.atan2(2 * b, a - c), r = Math.SQRT1_2;
  return [[Math.cos(th), Math.sin(th)], [-Math.sin(th), Math.cos(th)], [1, 0], [0, 1], [r, r], [r, -r]];
}
// legs back and forth along an axis: a turn is where the stroke comes back 35% of its reach from the furthest it went;
// a leg counts when it spans at least half the reach. Also where each turn is.
function scrLegs(pts, ax) {
  const s = pts.map(p => p[0] * ax[0] + p[1] * ax[1]);
  let lo = Infinity, hi = -Infinity;
  for (const v of s) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const R = hi - lo;
  if (!(R > 0)) return { n: 0, R: 0, turns: [] };
  const h = 0.35 * R;
  let dir = 0, ext = s[0], ei = 0, start = s[0];
  const legs = [], turns = [];
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (dir >= 0 && v > ext) { ext = v; ei = i; } else if (dir <= 0 && v < ext) { ext = v; ei = i; }
    if (dir >= 0 && ext - v >= h && (dir === 1 || ext - start >= h)) { legs.push(Math.abs(ext - start)); turns.push(ei); start = ext; dir = -1; ext = v; ei = i; }
    else if (dir <= 0 && v - ext >= h && (dir === -1 || start - ext >= h)) { legs.push(Math.abs(ext - start)); turns.push(ei); start = ext; dir = 1; ext = v; ei = i; }
    else if (dir === 0) { if (v - start >= h) dir = 1; else if (start - v >= h) dir = -1; }
  }
  legs.push(Math.abs(ext - start));
  return { n: legs.filter(L => L >= 0.5 * R).length, R, turns };
}
// the share of the turns that are sharp: the way in and the way out, 15% of the reach either side, at least 110° apart
function scrSharp(pts, turns, R) {
  if (!turns.length) return 0;
  const w = 0.15 * R;
  let sharp = 0;
  for (const t of turns) {
    let a = t, b = t, d = 0;
    while (a > 0 && d < w) { d += Math.hypot(pts[a][0] - pts[a - 1][0], pts[a][1] - pts[a - 1][1]); a--; }
    d = 0;
    while (b < pts.length - 1 && d < w) { d += Math.hypot(pts[b + 1][0] - pts[b][0], pts[b + 1][1] - pts[b][1]); b++; }
    const ux = pts[t][0] - pts[a][0], uy = pts[t][1] - pts[a][1], vx = pts[b][0] - pts[t][0], vy = pts[b][1] - pts[t][1];
    const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (n > 0 && Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n))) >= 110 * Math.PI / 180) sharp++;
  }
  return sharp / turns.length;
}
// how many of its legs lie on top of an earlier leg (not the one just before): a scribble's legs move on, a stroke
// gone over again and again comes back over itself — a Z written back and forth three times turns like a zig-zag,
// but each pass lies on the last. A leg lies on an earlier one when it runs along it the whole way (its points, on
// average, within a tenth of its length and at most d) from end to end (both ends near that leg's ends).
function scrRepeats(pts, turns, d) {
  const cut = [0].concat(turns, [pts.length - 1]), legs = [];
  for (let k = 0; k + 1 < cut.length; k++) if (cut[k + 1] > cut[k]) { const L = pts.slice(cut[k], cut[k + 1] + 1); legs.push({ pts: L, len: scrLen(L) }); }
  let n = 0, of = 0;
  for (let k = 2; k < legs.length; k++) {
    const leg = legs[k], m = Math.max(1, Math.floor(leg.pts.length / 8)), probe = [];
    if (!(leg.len > 0)) continue;
    for (let i = 0; i < leg.pts.length; i += m) probe.push(leg.pts[i]);
    const near = Math.min(d, Math.max(0.4 * d, 0.1 * leg.len)), ends = Math.max(1.2 * d, 0.15 * leg.len);
    const a0 = leg.pts[0], a1 = leg.pts[leg.pts.length - 1];
    let hit = false;
    for (let j = 0; j <= k - 2 && !hit; j++) {
      const o = legs[j].pts, b0 = o[0], b1 = o[o.length - 1], dd = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (!((dd(a0, b0) <= ends && dd(a1, b1) <= ends) || (dd(a0, b1) <= ends && dd(a1, b0) <= ends))) continue;
      let t = 0;
      for (const p of probe) t += scrDist(p, o);
      if (t / probe.length <= near) hit = true;
    }
    of++;
    if (hit) n++;
  }
  return of ? n / of : 0;
}
// how bent its legs are (between its turns): the middle one's path length over the distance it covers. A scribble's
// legs are straight lines; a curved stroke gone over again and again (a 3, an S written over twice to darken it) turns
// back at its ends like a scribble, but each pass is the curve
function scrBent(pts, turns) {
  const cut = [0].concat(turns, [pts.length - 1]), r = [];
  for (let k = 0; k + 1 < cut.length; k++) {
    const a = cut[k], b = cut[k + 1];
    if (b - a < 2) continue;
    const ch = Math.hypot(pts[b][0] - pts[a][0], pts[b][1] - pts[a][1]);
    // (the leg a little smoothed: a finger's jitter on a touch frame is not a curve)
    const leg = pts.slice(a, b + 1), sm = leg.map((p, i) => i === 0 || i === leg.length - 1 ? p : [0.25 * leg[i - 1][0] + 0.5 * p[0] + 0.25 * leg[i + 1][0], 0.25 * leg[i - 1][1] + 0.5 * p[1] + 0.25 * leg[i + 1][1]]);
    if (ch > 0) r.push(scrLen(sm) / ch);
  }
  r.sort((x, y) => x - y);
  return r.length ? r[r.length >> 1] : 1;
}
// the stroke walked in steps of about `step` (a fast stroke's far-apart samples and a slow one's crowded ones count alike)
function scrWalk(pts, step) {
  if (pts.length < 2 || !(step > 0)) return pts.map(p => [p[0], p[1]]);
  const out = [[pts[0][0], pts[0][1]]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!L) continue;
    let t = step - carry;
    while (t <= L) { out.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]); t += step; }
    carry = L - (t - step);
  }
  const e = pts[pts.length - 1], f = out[out.length - 1];
  if (Math.hypot(e[0] - f[0], e[1] - f[1]) > step * 0.3) out.push([e[0], e[1]]);
  return out;
}
function scrCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
// how it turns: going round and round one way (a ring, a coil: the turning adds up) or back and forth (a zig-zag: it
// cancels out). The path walked in about 160 steps (none under 3 px: a hand's jitter is not turning); true when it
// turns one way through two whole turns or more, and most of its turning is that way
function scrLoopy(pts, len, z) {
  const q = scrWalk(pts, Math.max(len / 160, 3 / (z > 0 ? z : 1), 1e-6));
  let sum = 0, abs = 0;
  for (let i = 2; i < q.length; i++) {
    const ax = q[i - 1][0] - q[i - 2][0], ay = q[i - 1][1] - q[i - 2][1], bx = q[i][0] - q[i - 1][0], by = q[i][1] - q[i - 1][1];
    const a = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    sum += a; abs += Math.abs(a);
  }
  return Math.abs(sum) >= 4 * Math.PI && Math.abs(sum) >= 0.5 * abs;
}
// how much of the path runs along another part of itself, within d: a stroke gone over again (to darken it, or to
// mend it) runs along itself nearly all the way; a scribble only where it turns. The path walked in steps of d/2;
// what is within d of a point farther along it than 3 d (not its own neighbours), as a share of the points.
function scrOverlap(pts, d) {
  const q = scrWalk(pts, d / 2), cell = new Map(), key = (x, y) => x + ',' + y;
  q.forEach((p, i) => { const k = key(Math.floor(p[0] / d), Math.floor(p[1] / d)); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(i); });
  let n = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i], cx = Math.floor(p[0] / d), cy = Math.floor(p[1] / d);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) {
      for (const j of cell.get(key(cx + dx, cy + dy)) || []) if (Math.abs(i - j) > 6 && Math.hypot(q[j][0] - p[0], q[j][1] - p[1]) <= d) { hit = true; break; }
    }
    if (hit) n++;
  }
  return q.length ? n / q.length : 0;
}
// times the path crosses itself (segments that are not neighbors), on the path walked in about 80 steps
function scrCrossings(pts, len) {
  const q = scrWalk(pts, Math.max(len / 80, 1e-6));
  let n = 0;
  for (let i = 0; i + 1 < q.length; i++) for (let j = i + 2; j + 1 < q.length; j++) if (scrCross(q[i], q[i + 1], q[j], q[j + 1])) n++;
  return n;
}
// the distance from a point to a path
function scrDist(q, path) {
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[i + 1] || a, dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L)) : 0;
    const d = Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]);
    if (d < best) { best = d; if (d === 0) break; }
  }
  return best;
}
// the path cut into pieces of about `n` points each, with their boxes (to measure distances to it quickly)
function scrChunks(path, n) {
  const out = [];
  for (let i = 0; i < path.length - 1; i += n) {
    const part = path.slice(i, Math.min(path.length, i + n + 1));
    out.push({ part, box: scrBox(part) });
  }
  if (!out.length && path.length) out.push({ part: path, box: scrBox(path) });
  return out;
}
function scrNear(q, chunks, r) {
  for (const c of chunks) {
    const b = c.box;
    if (q[0] < b[0] - r || q[0] > b[2] + r || q[1] < b[1] - r || q[1] > b[3] + r) continue;
    if (scrDist(q, c.part) <= r) return true;
  }
  return false;
}
// the distance from p to the path, with its pieces' boxes to skip the far ones
function scrDistC(p, chunks) {
  let best = Infinity;
  for (const c of chunks) {
    const b = c.box, dx = Math.max(b[0] - p[0], 0, p[0] - b[2]), dy = Math.max(b[1] - p[1], 0, p[1] - b[3]);
    if (dx * dx + dy * dy >= best * best) continue;
    const d = scrDist(p, c.part);
    if (d < best) best = d;
  }
  return best;
}
// how the path covers its hull: the distances from a grid over the hull to the path, sorted
function scrReach(hull, chunks, box) {
  const W = box[2] - box[0], H = box[3] - box[1], step = Math.max(Math.max(W, H) / 32, Math.min(W, H) / 12, 1e-6);
  const out = [];
  for (let y = box[1] + step / 2; y < box[3]; y += step) for (let x = box[0] + step / 2; x < box[2]; x += step) {
    const p = [x, y];
    if (scrInHull(p, hull, 0)) out.push(scrDistC(p, chunks));
  }
  return out.sort((a, b) => a - b);
}
function scrFill(dists, r) { let n = 0; for (const d of dists) if (d <= r) n++; return dists.length ? n / dists.length : 0; }
function scrQuant(dists, q) { return dists.length ? dists[Math.min(dists.length - 1, Math.floor(q * dists.length))] : 0; }
function scribbleOf(pts, z) {
  z = z > 0 ? z : 1;
  if (!Array.isArray(pts) || pts.length < 8) return null;
  for (const p of pts) if (!(p && isFinite(p[0]) && isFinite(p[1]))) return null;
  const box = scrBox(pts), big = Math.max(box[2] - box[0], box[3] - box[1]);
  if (big * z < 12) return null;                                   // a jot, not a scribble
  const len = scrLen(pts), hull = scrHull(pts), A = Math.max(scrArea(hull), 1e-9), dense = len * len / A;
  if (dense < 20) return null;
  const axes = scrAxes(pts), span = ax => { let lo = Infinity, hi = -Infinity; for (const p of pts) { const v = p[0] * ax[0] + p[1] * ax[1]; if (v < lo) lo = v; if (v > hi) hi = v; } return hi - lo; };
  // it spans something across its length: a line gone over again and again (a 1 or a bar retraced) is not a scribble
  if (span(axes[1]) * z < 8) return null;
  let sc = null;
  for (const ax of axes) {
    const L = scrLegs(pts, ax);
    // legs at least 12 px, five or more, each at least half the longest; across most of the stroke — or, many and
    // close-packed, moving along a line of writing (up and down over a whole equation)
    if (!(L.R * z >= 12 && (L.R >= 0.25 * big || (L.n >= 8 && dense >= 40)) && L.n >= 5 && len >= 4 * L.R)) continue;
    if (L.n < 6 && dense < 25) continue;                              // five legs, loosely: an M or a W written over a 5
    if (span([-ax[1], ax[0]]) < Math.max(8 / z, 0.12 * L.R)) continue;   // its legs move on as they go back and forth
    if (sc && L.n <= sc.legs) continue;
    if (scrSharp(pts, L.turns, L.R) < 0.7) continue;
    if (scrBent(pts, L.turns) > 1.3) continue;                        // its legs run straight: not a curve gone over again
    // and they move on: not a Z, an N or a W gone over again and again (its legs come back on each other)
    if (scrRepeats(pts, L.turns, 2.5 / z) >= 0.4) continue;
    sc = { kind: 'zigzag', legs: L.n, reach: L.R, axis: ax, turns: L.turns.map(i => [pts[i][0], pts[i][1]]) };
  }
  const gap = A / len;                                             // its passes are about this far apart
  const chunks = scrChunks(pts, 12);
  let dists = null;
  const reach = () => dists || (dists = scrReach(hull, chunks, box));
  // it fills what it spans: a stroke gone over again and again along the same lines (a V retraced, a ring) does not
  if (sc && scrFill(reach(), gap) < 0.6) sc = null;
  // and it is not a stroke gone over again: a letter or a digit written over to darken it runs along itself nearly all
  // the way and fills little of what it spans (a scribble runs along itself only where it turns; a tangle that crosses
  // itself everywhere still fills what it spans)
  if (sc && scrOverlap(pts, 1.5 / z) >= 0.9 && scrFill(reach(), gap) < 0.67) sc = null;
  // a coil goes round and round one way, crossing itself (a stroke gone over again crosses itself too, back and forth)
  if (!sc && dense >= 45 && big * z >= 20 && scrLoopy(pts, len, z)) {
    const x = scrCrossings(pts, len);
    if (x >= 5 && scrFill(reach(), gap) >= 0.7) sc = { kind: 'coil', legs: x, reach: big, axis: null, turns: [] };
  }
  if (!sc) return null;
  dists = reach();
  sc.gap = gap;
  // round and round: it covers only what it passes over (a ring around an answer passes over nothing)
  sc.loopy = scrLoopy(pts, len, z);
  // what it covers: what is inside it and no farther from its path than nearly all of the inside is (its passes need
  // not be even)
  // (never far from its path: a ring gone round three times has nothing in its middle)
  sc.band = Math.min(Math.max(1.25 * scrQuant(dists, 0.9), 0.75 * gap, 3 / z), 2 * gap, 0.35 * sc.reach);
  sc.box = box; sc.hull = hull; sc.area = A; sc.len = len;
  sc.path = pts.map(p => [p[0], p[1]]);
  sc.chunks = chunks;
  return sc;
}
// how deep inside the hull p is (its distance to the nearest edge; below 0 outside)
function scrDepth(p, hull) {
  let best = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1;
    const d = (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / L;
    if (d < best) best = d;
  }
  return hull.length >= 3 ? best : -Infinity;
}
// what a scribble lies over: of a stroke's points (walked in small steps), how many are inside the scribble and
// within its band (share), how many are inside it at all (fin), and how deep inside it the stroke is (the median of
// its points' depths; 0 for those outside). {got, of, share, fin, depth}
function scribbleCovers(sc, pts, z) {
  z = z > 0 ? z : 1;
  if (!sc || !Array.isArray(pts) || !pts.length) return { got: 0, of: 0, share: 0, fin: 0, depth: 0 };
  const m = sc.band, B = sc.box, b = scrBox(pts);
  const size = Math.max(b[2] - b[0], b[3] - b[1]), step = Math.max(0.5 / z, Math.min(m / 2, size / 12 || m / 2));
  // nowhere near it: none of it (counted as the points it would be walked in, for a symbol's share)
  if (b[2] < B[0] - m || b[0] > B[2] + m || b[3] < B[1] - m || b[1] > B[3] + m) return { got: 0, of: Math.max(1, Math.round(scrLen(pts) / step) + 1), share: 0, fin: 0, depth: 0 };
  const q = scrWalk(pts, step);
  let got = 0, inside = 0;
  const deep = [];
  for (const p of q) {
    const d = scrDepth(p, sc.hull);
    if (d >= 0) inside++;
    if (d >= -0.75 / z && scrNear(p, sc.chunks, m)) { got++; deep.push(Math.max(d, 0)); } else deep.push(0);
  }
  deep.sort((x, y) => x - y);
  const n = q.length;
  return { got, of: n, share: n ? got / n : 0, fin: n ? inside / n : 0, depth: deep.length ? deep[deep.length >> 1] : 0 };
}
// does the scribble's path pass over a stroke: cross it, or come within a pen's width of it?
function scrPasses(sc, pts, z) {
  const q = scrWalk(pts, Math.max(1 / z, scrLen(pts) / 40));
  const b = scrBox(q), r = 1.5 / z;
  for (const c of sc.chunks) {
    if (c.box[2] < b[0] - r || c.box[0] > b[2] + r || c.box[3] < b[1] - r || c.box[1] > b[3] + r) continue;
    const P = c.part;
    for (let i = 0; i + 1 < P.length; i++) for (let j = 0; j + 1 < q.length; j++) if (scrCross(P[i], P[i + 1], q[j], q[j + 1])) return true;
  }
  for (const p of q) if (scrDistC(p, sc.chunks) <= r) return true;
  return false;
}
// how many times the scribble's path crosses a stroke
function scrCrossings2(sc, pts, z) {
  const q = scrWalk(pts, Math.max(1 / z, scrLen(pts) / 40)), b = scrBox(q);
  let n = 0;
  for (const c of sc.chunks) {
    if (c.box[2] < b[0] || c.box[0] > b[2] || c.box[3] < b[1] || c.box[1] > b[3]) continue;
    const P = c.part;
    for (let i = 0; i + 1 < P.length; i++) for (let j = 0; j + 1 < q.length; j++) if (scrCross(P[i], P[i + 1], q[j], q[j + 1])) n++;
  }
  return n;
}
// does the scribble's path go into a box (any piece of it inside, or across it)?
function scrEnters(sc, b) {
  if (b[2] < b[0] || b[3] < b[1]) return false;
  const inB = p => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
  const P = sc.path;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], c = P[i + 1];
    if (inB(a)) return true;
    if (!c) break;
    // the segment against the box's edges
    const E = [[[b[0], b[1]], [b[2], b[1]]], [[b[2], b[1]], [b[2], b[3]]], [[b[2], b[3]], [b[0], b[3]]], [[b[0], b[3]], [b[0], b[1]]]];
    if (Math.max(a[0], c[0]) < b[0] || Math.min(a[0], c[0]) > b[2] || Math.max(a[1], c[1]) < b[1] || Math.min(a[1], c[1]) > b[3]) continue;
    for (const [e0, e1] of E) if (scrCross(a, c, e0, e1)) return true;
  }
  return false;
}
// the closest two strokes come, and how many times they cross
function scrMeet(a, b) {
  let best = Infinity, cross = 0;
  const A = a.length > 1 ? a : [a[0], a[0]], B = b.length > 1 ? b : [b[0], b[0]];
  for (let i = 0; i + 1 < A.length; i++) {
    for (let j = 0; j + 1 < B.length; j++) {
      if (scrCross(A[i], A[i + 1], B[j], B[j + 1])) { cross++; best = 0; }
    }
  }
  if (best > 0) for (const p of A) { const d = scrDist(p, B); if (d < best) best = d; }
  if (best > 0) for (const p of B) { const d = scrDist(p, A); if (d < best) best = d; }
  return { d: best, cross };
}
// What a scribble rubs out, of `items` ([{pts, group?, closed?, fixed?}] in world units: the strokes it may take — pen
// and marker writing and shapes — and those it may not (fixed: a number line under a dot is a line all the same); not
// highlighters, text or pictures). Strokes with the same group are one symbol. {erase: [indexes], why, shares}
function scribbleErase(sc, items, z) {
  z = z > 0 ? z : 1;
  const out = { erase: [], why: '', shares: [] };
  if (!sc || !Array.isArray(items) || !items.length) { out.why = 'nothing under it'; return out; }
  const S = items.map((it, i) => {
    const pts = it && Array.isArray(it.pts) ? it.pts : [];
    if (!pts.length) return null;
    const b = scrBox(pts), len = scrLen(pts), size = Math.max(b[2] - b[0], b[3] - b[1]);
    const c = scribbleCovers(sc, pts, z);
    return { i, pts, b, len, size, share: c.share, got: c.got, of: c.of, fin: c.fin, depth: c.depth, group: it.group == null ? null : it.group, closed: !!it.closed, fixed: !!it.fixed, scr: null };
  });
  out.shares = S.map(s => (s ? s.share : 0));
  const near = S.filter(s => s && s.share > 0);
  if (!near.length) { out.why = 'nothing under it'; return out; }
  // an earlier scribble under this one (shading gone over again, or a scribble that fell short and stayed as ink) is
  // never what a scribble is for: it goes only with writing this one takes
  for (const s of near) s.scr = s.share >= 0.3 && s.pts.length >= 8 && !!scribbleOf(s.pts, z);
  // a stroke mostly under it — inside it all but a little (the writing beside what was scribbled out, which its edge
  // reaches over, sticks out of it), or deep inside it; a symbol mostly under it, whole (its parts partly under it,
  // and its small parts)
  const hb = sc.box, deep = SCR.deep * Math.min(hb[2] - hb[0], hb[3] - hb[1]);
  const inside = s => (s.fin >= SCR.fin && s.depth >= 0.25 * deep) || s.depth >= deep;   // (a line it only lies along: neither)
  // going round and round, it passes over writing (a blot, a coil along a line) — or round it, over nothing (a ring
  // round an answer, however flat): that takes nothing
  if (sc.loopy && !near.some(s => !s.fixed && !s.scr && scrPasses(sc, s.pts, z))) { out.why = 'round it'; return out; }
  // (round and round over writing, what it takes it goes over: a stroke its loops cross, or pass along away from its
  // ends — a ring around a minus touches it at an end — or whose box they go into; not a stroke inside a ring that
  // clipped its neighbour)
  const mid = pts => { const L = scrLen(pts), out = []; let d = 0; for (let i = 0; i < pts.length; i++) { if (i) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (d >= 0.15 * L && d <= 0.85 * L) out.push(pts[i]); } return out.length ? out : pts; };
  const into = s => { if (!sc.loopy || scrCrossings2(sc, s.pts, z) >= 1 || scrPasses(sc, mid(s.pts), z)) return true; const w = s.b[2] - s.b[0], h = s.b[3] - s.b[1]; return scrEnters(sc, [s.b[0] + 0.15 * w, s.b[1] + 0.15 * h - 1 / z, s.b[2] - 0.15 * w, s.b[3] - 0.15 * h + 1 / z]); };
  // the lines it is bounded by are never what it takes: a long straight line its turns line up along (the top and the
  // bottom of a fraction bar shaded with its turns a little past them; a table's rule) — not one whose end its turns
  // only come to (a fraction bar scribbled out along its length turns at its ends)
  const edges = new Set();
  if (sc.turns.length >= 4) {
    const tt = Math.max(4 / z, sc.band, 0.1 * sc.reach);
    for (const s of near) {
      const a = s.pts[0], b = s.pts[s.pts.length - 1], ends = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!(ends > 0 && s.len <= 1.15 * ends && ends >= 0.9 * sc.reach)) continue;
      const ux = (b[0] - a[0]) / ends, uy = (b[1] - a[1]) / ends, on = [];
      for (const q of sc.turns) if (q[0] >= s.b[0] - tt && q[0] <= s.b[2] + tt && q[1] >= s.b[1] - tt && q[1] <= s.b[3] + tt && scrDist(q, s.pts) <= tt) on.push(q[0] * ux + q[1] * uy);
      if (on.length < Math.max(3, 0.3 * sc.turns.length)) continue;
      let lo = Infinity, hi = -Infinity;
      for (const p of sc.path) { const v = p[0] * ux + p[1] * uy; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (Math.max(...on) - Math.min(...on) >= 0.5 * (hi - lo)) edges.add(s.i);
    }
  }
  const take = new Set(near.filter(s => !s.fixed && !s.scr && !edges.has(s.i) && s.share >= SCR.share && inside(s) && into(s)).map(s => s.i));
  const groups = new Map();
  for (const s of S) if (s && s.group != null) { if (!groups.has(s.group)) groups.set(s.group, []); groups.get(s.group).push(s); }
  for (const g of groups.values()) {
    let got = 0, of = 0, fin = 0;
    const ds = [];
    for (const s of g) { got += s.got; of += s.of; fin += s.fin * s.of; for (let k = 0; k < Math.max(1, Math.round(s.of / 4)); k++) ds.push(s.depth); }
    ds.sort((x, y) => x - y);
    const gd = ds[ds.length >> 1];
    if (sc.loopy && !g.some(s => s.share > 0 && into(s))) continue;
    if (!of || got / of < SCR.group || !((fin / of >= SCR.fin && gd >= 0.25 * deep) || gd >= deep)) continue;
    const b = g.reduce((u, s) => [Math.min(u[0], s.b[0]), Math.min(u[1], s.b[1]), Math.max(u[2], s.b[2]), Math.max(u[3], s.b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const gs = Math.max(b[2] - b[0], b[3] - b[1]);
    for (const s of g) if (!s.fixed && !s.scr && !edges.has(s.i) && (s.share >= 0.25 || s.size <= 0.35 * gs)) take.add(s.i);
  }
  // aimed at writing, short of all of it (a hand at the board stops short of a symbol's edges, or goes over most of it
  // and not the rest): when nothing is under it as the rules above have it, the symbols it is on go — each a good part
  // under it (a third of it within its band, two fifths inside it), most of the scribble over them, and nothing else
  // under it to speak of
  // (a clear scribble only — six legs or more, or a coil: a ring gone round twice is five)
  if (!take.size && (sc.kind !== 'zigzag' || sc.legs >= 6)) {
    const units = new Map();
    for (const s of near) { const k = s.group != null ? 'g' + s.group : 's' + s.i; if (!units.has(k)) units.set(k, []); units.get(k).push(s); }
    for (const s of S) if (s && s.group != null && units.has('g' + s.group) && !units.get('g' + s.group).includes(s)) units.get('g' + s.group).push(s);
    const cand = [], others = [];
    for (const g of units.values()) {
      let got = 0, of = 0, fin = 0;
      for (const s of g) { got += s.got; of += s.of; fin += s.fin * s.of; }
      const sh = of ? got / of : 0, fi = of ? fin / of : 0;
      // (a loop it lies inside — a bubble filled in, a cell, a triangle — is what it fills, and a line its turns stop at —
      // a fraction bar's side, a table's rule — is what it is bounded by: never what it is aimed at)
      const holds = g.some(s => { if (s.pts.length < 6) return false; const ends = Math.hypot(s.pts[0][0] - s.pts[s.pts.length - 1][0], s.pts[0][1] - s.pts[s.pts.length - 1][1]); if (!(s.closed || ends <= 0.25 * s.size)) return false; let k = 0; for (const p of sc.path) if (scrInPoly(p, s.pts)) k++; return k >= 0.6 * sc.path.length; });
      const stops = g.some(s => { if (sc.turns.length < 4) return false; const ends = Math.hypot(s.pts[0][0] - s.pts[s.pts.length - 1][0], s.pts[0][1] - s.pts[s.pts.length - 1][1]); if (!(s.len <= 1.15 * ends && ends >= 0.9 * sc.reach)) return false; const tt = Math.max(4 / z, sc.band, 0.1 * sc.reach); let k = 0; for (const q of sc.turns) if (scrDist(q, s.pts) <= tt) k++; return k >= 0.3 * sc.turns.length; });
      if (holds || stops || g.some(s => edges.has(s.i))) { others.push(g); continue; }
      // (and it goes over it — across its ink and into its middle — not round it)
      const over = g.some(s => scrPasses(sc, s.pts, z)) && g.some(s => { const w = s.b[2] - s.b[0], h = s.b[3] - s.b[1]; return scrEnters(sc, [s.b[0] + 0.15 * w, s.b[1] + 0.15 * h - 1 / z, s.b[2] - 0.15 * w, s.b[3] - 0.15 * h + 1 / z]); });
      if (!over || g.some(s => s.fixed || s.scr) || !(sh >= 0.35 && fi >= 0.4) || (sc.loopy && !g.some(s => s.share > 0 && into(s)))) { if (sh >= 0.15) others.push(g); continue; }
      cand.push(g);
    }
    if (cand.length && !others.length) {
      const boxes = cand.map(g => { const b = g.reduce((u, s) => [Math.min(u[0], s.b[0]), Math.min(u[1], s.b[1]), Math.max(u[2], s.b[2]), Math.max(u[3], s.b[3])], [Infinity, Infinity, -Infinity, -Infinity]); const m = Math.max(0.15 * Math.max(b[2] - b[0], b[3] - b[1]), sc.band); return [b[0] - m, b[1] - m, b[2] + m, b[3] + m]; });
      const walk = scrWalk(sc.path, Math.max(sc.len / 200, 1e-6));
      let on = 0;
      for (const p of walk) if (boxes.some(b => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3])) on++;
      if (walk.length && on / walk.length >= 0.6) for (const g of cand) { const gs = Math.max(...g.map(s => s.size)); for (const s of g) if (s.share >= 0.25 || s.size <= 0.35 * gs || g.length === 1) take.add(s.i); }
    }
  }
  if (!take.size) { out.why = near.some(s => s.scr) ? 'over shading' : 'only clipped'; return out; }
  // the lines of a drawing stay: a straight mark joined to a long line the scribble does not cover (a tick on a number
  // line, a divider in a fraction bar), or a mark a long line runs through (the dot on a number line)
  const tol = Math.max(3 / z, 0.25 * sc.band);
  const longs = S.filter(s => s && !take.has(s.i) && !s.scr && s.len >= 0.5 * sc.reach);
  const kept = new Set();
  for (const i of [...take]) {
    const s = S[i];
    const chord = Math.hypot(s.pts[0][0] - s.pts[s.pts.length - 1][0], s.pts[0][1] - s.pts[s.pts.length - 1][1]);
    const straight = s.len > 0 && s.len <= 1.25 * chord;
    const cx = (s.b[0] + s.b[2]) / 2, cy = (s.b[1] + s.b[3]) / 2;
    for (const u of longs) {
      if (u.len < 4 * s.len) continue;                         // a line of a drawing is long beside the mark on it
      if (u.b[2] < s.b[0] - tol || u.b[0] > s.b[2] + tol || u.b[3] < s.b[1] - tol || u.b[1] > s.b[3] + tol) continue;
      const m = scrMeet(s.pts, u.pts);
      if (straight ? m.d <= tol : m.cross >= 1 && scrDist([cx, cy], u.pts) <= 0.2 * s.size + tol) { take.delete(i); kept.add(i); break; }
    }
  }
  if (!take.size) { out.why = 'part of a drawing'; return out; }
  // shading: it fills a space bounded by lines (its turns on lines it does not cover, or it lies inside a closed shape
  // and fills a good part of it), and the writing inside it is small beside it (a label in a shaded part)
  let bounded = false;
  const lines = S.filter(s => s && !take.has(s.i) && !s.scr && s.len >= 0.15 * sc.reach), edge = new Set();
  if (sc.turns.length >= 4 && lines.length) {
    const tt = Math.max(4 / z, sc.band, 0.1 * sc.reach);
    // (its turns go one side and the other: a space between lines has its turns on both; a scribble that only bumps
    // into a neighbour at one end — a minus scribbled out before a 2 — is not shading, unless what it stops at is a
    // drawn line, straight and as long as the scribble: one side of a region)
    const on = [0, 0], of = [0, 0], hit = new Set();
    sc.turns.forEach((t, k) => {
      of[k % 2]++;
      const u = lines.find(u => t[0] >= u.b[0] - tt && t[0] <= u.b[2] + tt && t[1] >= u.b[1] - tt && t[1] <= u.b[3] + tt && scrDist(t, u.pts) <= tt);
      if (u) { on[k % 2]++; hit.add(u); }
    });
    const ruler = u => { const ends = Math.hypot(u.pts[0][0] - u.pts[u.pts.length - 1][0], u.pts[0][1] - u.pts[u.pts.length - 1][1]); return u.len <= 1.15 * ends && ends >= 0.9 * sc.reach; };
    const both = on[0] >= 0.5 * of[0] && on[1] >= 0.5 * of[1];
    if ((on[0] + on[1] >= 0.5 * sc.turns.length) && (both || [...hit].every(ruler))) { bounded = true; for (const u of hit) edge.add(u.i); }
  }
  // (the room each piece of writing inside it fills — what it would take, and what it would not — its box a little
  // grown, at least a square 0.6 of its size; not the lines it stops at, nor the lines of a drawing)
  let freeArea = 0;
  for (const s of near) {
    if (s.fixed || s.scr || kept.has(s.i) || edge.has(s.i) || !(take.has(s.i) || s.fin >= 0.6)) continue;
    const t = 0.15 * s.size;
    freeArea += Math.max((s.b[2] - s.b[0] + t) * (s.b[3] - s.b[1] + t), 0.36 * s.size * s.size);
  }
  if (!bounded) {
    for (const s of S) {
      if (!s || take.has(s.i) || s.scr || s.pts.length < 6) continue;
      const ends = Math.hypot(s.pts[0][0] - s.pts[s.pts.length - 1][0], s.pts[0][1] - s.pts[s.pts.length - 1][1]);
      if (!(s.closed || ends <= 0.2 * s.size)) continue;
      const area = scrArea(s.pts);
      if (!(area > 0) || sc.area < 0.25 * area) continue;
      let inside = 0;
      for (const p of sc.path) if (scrInPoly(p, s.pts)) inside++;
      if (inside >= 0.9 * sc.path.length) { bounded = true; break; }
    }
  }
  // (between straight lines that run its length — a cell of a fraction bar, of a table — a bigger label is still a label)
  let ruled = edge.size > 0;
  for (const i of edge) {
    const u = S[i], ends = Math.hypot(u.pts[0][0] - u.pts[u.pts.length - 1][0], u.pts[0][1] - u.pts[u.pts.length - 1][1]);
    const ax = ends > 0 ? [(u.pts[u.pts.length - 1][0] - u.pts[0][0]) / ends, (u.pts[u.pts.length - 1][1] - u.pts[0][1]) / ends] : [1, 0];
    let lo = Infinity, hi = -Infinity;
    for (const p of sc.path) { const v = p[0] * ax[0] + p[1] * ax[1]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!(u.len <= 1.15 * ends && u.len >= 0.6 * (hi - lo))) { ruled = false; break; }
  }
  if (bounded && freeArea < (ruled ? 0.35 : 0.15) * sc.area) { out.why = 'shading'; return out; }
  // with the writing it takes, an earlier scribble it mostly lies over (one that fell short)
  for (const s of near) if (s.scr && !s.fixed && s.share >= 0.5) take.add(s.i);
  out.erase = [...take].sort((a, b) => a - b);
  out.why = 'scribbled out';
  return out;
}
