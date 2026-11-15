// Nib 1.6.7, hardened (node; the pad and the pages are in test/hardening_browser.js). What the audit of 1.6.6 found,
// each pinned so it cannot come back:
//   1. input that is not strokes reads as nothing; a point that is not two coordinates is left out (a null is not a
//      0); coordinates past 1e9; options that are no numbers; a segmentation whose scores are NaN; classify; the hand
//   2. symbol sets looked up as their own properties, and one clear error for anything else
//   3. scribbles: the detector's bounds and its time for any stroke at any scale, the same answers as before for
//      everything else (the old functions, side by side), and what a scribble takes at its edge (the share)
//   4. the Replicator: a font from letters written far outside their boxes, in bounded time
//   5. small guards: Nib.solve with a malformed tree, pdfFit, color, shapeFromDrag, scribble.erase / covers
//   6. what a sample of mutations showed nothing noticed: the solver's limits, + over − and its neighbors, the
//      memory's cap and reach, the tidy view's exponents, the Replicator's pen weight
//   7. the test runner counts what the suites skip
//   node test/hardening_check.js
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const Nib = require(path.join(ROOT, 'dist', 'nib.js'));
const R = require(path.join(ROOT, 'replicator', 'core.js'));
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (c) passes++; else fails++; };
const section = n => console.log('\n' + n);
const ms = f => { const t0 = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - t0) / 1e6, r]; };
const throws = f => { try { f(); return null; } catch (e) { return e; } };
const finite = o => !JSON.stringify(o, (k, v) => (typeof v === 'number' && !isFinite(v) ? 'NONFINITE' : v)).includes('NONFINITE');
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const box = ss => { let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const s of ss) for (const p of s) b = [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])]; return b; };
// every symbol of a label in the school problems, as its strokes
const symbolsOf = label => { const out = []; for (const r of rows) for (const y of r.symbols) if (y.label === label) out.push(y.strokes.map(i => r.strokes[i])); return out; };
// strokes scaled to w wide (placeH: h tall), top left at (x, y)
const place = (ss, x, y, w) => { const b = box(ss), k = w / Math.max(b[2] - b[0], 1e-9); return ss.map(s => s.map(p => [x + (p[0] - b[0]) * k, y + (p[1] - b[1]) * k])); };
const placeH = (ss, x, y, h) => { const b = box(ss), k = h / Math.max(b[3] - b[1], 1e-9); return ss.map(s => s.map(p => [x + (p[0] - b[0]) * k, y + (p[1] - b[1]) * k])); };
// a src/ file in a function scope of its own (as store_check does), handing out the names asked for
const srcScope = (files, names, edit) => new Function("'use strict';\n" + (edit || (s => s))(files.map(f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8')).join('\n').replace(/'use strict';\n/g, '')) + '\nreturn {' + names.join(', ') + '};')();

// ================================================================== 1
section('1. what is not strokes reads as nothing; a point is two coordinates');
{
  const odd = { 'a number': 42, 'a string': 'abc', 'an object': {}, 'true': true, 'a function': () => [[[1, 2]]], 'a Date': new Date(),
    'an arguments-like object': { length: 2, 0: [[1, 2], [3, 4]], 1: [[5, 6], [7, 8]] }, '[[null, null]]': [[null, null]], '[{points: {points: []}}]': [{ points: { points: [] } }],
    'BigInt points': [[[1n, 2n], [3n, 4n], [5n, 6n]]], 'a Symbol in a point': [[[Symbol('x'), 1]]] };
  for (const [name, input] of Object.entries(odd)) {
    let r = null, n = null, c = null;
    const e = throws(() => { r = Nib.recognize(input); n = Nib.neaten(input); c = Nib.classify(input); });
    ok(!e && r && r.latex === '' && n && Array.isArray(n.items) && Array.isArray(c), `${name}: recognize, neaten and classify read nothing and do not throw${e ? ' (' + e.message + ')' : ''}`);
  }
  // a stroke of a 1 near (100, 100); one odd point put into the middle of it
  const one = Array.from({ length: 12 }, (_, i) => [100 + i * 0.4, 100 + i * 6]);
  const boxOf = st => { const r = Nib.recognize([st]); const b = r.symbols[0] && r.symbols[0].box; return b ? [b.x, b.y, b.x + b.w, b.y + b.h] : null; };
  const plain = boxOf(one);
  for (const [name, p] of Object.entries({ '[null, null]': [null, null], '[0, null]': [100, null], "['', '']": ['', ''], '[true, 120]': [true, 120], '[[103], 120]': [[103], 120],
    '{x: null, y: 120}': { x: null, y: 120 }, '[2e9, 120] (past 1e9)': [2e9, 120], '[1e308, 1e308]': [1e308, 1e308], '[NaN, 120]': [NaN, 120] })) {
    const st = one.slice(0, 6).concat([p], one.slice(6));
    const b = boxOf(st);
    ok(b && JSON.stringify(b) === JSON.stringify(plain), `a point ${name} is left out (the 1's box stays ${plain.map(v => v.toFixed(1)).join(',')}; got ${b && b.map(v => v.toFixed(1)).join(',')})`);
  }
  const strs = one.map(p => [String(p[0]), ' ' + p[1] + ' ']);
  ok(Nib.recognize([strs]).latex === Nib.recognize([one]).latex && JSON.stringify(boxOf(strs)) === JSON.stringify(plain), 'numbers written as strings are still coordinates (as before)');
  ok(Nib.recognize([one.map(p => ({ x: p[0], y: p[1] }))]).latex === Nib.recognize([one]).latex, '{x, y} points are read as before');
  // a null coordinate is not 0: the stroke saved with a NaN in it (JSON makes it null) is not a spike to the origin
  const spike = Nib.recognize([one.slice(0, 6).concat([[null, null]], one.slice(6))]);
  ok(spike.symbols.length === 1 && spike.symbols[0].box.x > 50, `a null coordinate drops the point, it does not become 0 (box x ${spike.symbols[0] && spike.symbols[0].box.x.toFixed(1)})`);
  // the pad's own way in, and the stored form
  const packed = Nib.canvas.unpack(Nib.canvas.pack([[1, 1], [null, null], ['', 3], [true, 4], [[5], 5], [2, 2]], false));
  ok(packed.length === 2 && packed[1][0] === 2, 'storePack leaves out points whose coordinates are null, \'\', true or [] (it kept them as 0 or 1): ' + JSON.stringify(packed));
  // the readings of huge and NaN-making input
  const s0 = rows[0].strokes;
  const huge = s0.map(st => st.map(p => [p[0] * 1e306, p[1] * 1e306]));
  let rh = null;
  ok(!throws(() => { rh = Nib.recognize(huge); }) && rh && finite(rh), 'strokes with coordinates near 1e308 read (as nothing) without throwing: ' + JSON.stringify(rh && rh.latex));
  const ch = Nib.classify([[[1e308, 1e308], [-1e308, 1], [5e307, 1e307]]]);
  ok(Array.isArray(ch) && finite(ch), 'classify never gives NaN probabilities: ' + JSON.stringify(ch).slice(0, 60));
  const c0 = Nib.classify([s0[0]]);
  ok(c0.length > 0 && finite(c0) && c0.every(([l, p]) => typeof l === 'string' && p >= 0 && p <= 1), 'classify of a real stroke is as it was: ' + c0.slice(0, 2).map(x => x[0] + ' ' + x[1].toFixed(3)).join(', '));
  const base = Nib.recognize(s0).latex;
  for (const o of [{ wJunk: NaN }, { wClass: NaN }, { wJoin: Infinity }, { beta: 'x' }, { prune: {} }, { lm: undefined }, { maxGap: -Infinity }]) {
    let r = null; const e = throws(() => { r = Nib.recognize(s0, o); });
    ok(!e && r.latex === base, `option ${JSON.stringify(o, (k, v) => (typeof v === 'number' && !isFinite(v) ? String(v) : v === undefined ? 'undefined' : v))} that is no number is its default: ${r && r.latex}`);
  }
  for (const o of [{ prior: 1e9 }, { prior: -1e9 }]) {
    let r = null; const e = throws(() => { r = Nib.recognize(s0, o); });
    ok(!e && r && finite(r) && typeof r.latex === 'string', `prior ${o.prior}: a reading, no NaN in it (${r && r.latex})`);
  }
  // the segmentation itself: scores that are all NaN still give a path (one symbol per stroke at worst)
  const rec = new Nib.Recognizer(), I = Nib._internals, st = s0.map(s => s.map(p => [p[0], p[1]])), ref = I.refSize(st);
  const opts = { wJunk: NaN, wClass: NaN, wJoin: 0.2, beta: 0.5, lm: 0.35, prune: 0.03, dotPen: 3, parenPen: 3, parenH: 1, lmSeg: 0, memory: false };
  let seg = null; const se = throws(() => { seg = rec.segment(st, st.map((_, i) => 'h' + i), ref, I.allowedMask('school'), opts, null, null, ref); });
  const covered = seg ? [].concat(...seg.map(y => y.strokes)).sort((a, b) => a - b).join() : '';
  ok(!se && seg && covered === st.map((_, i) => i).join(), `Recognizer.segment with every score NaN gives symbols that use every stroke${se ? ' (threw ' + se.message + ')' : ''}`);
  // the hand: glyph points are finite and in reach of the glyph's box
  const n = Nib.hand.load({ glyphs: { a: [[[0.2, 0.3], [0.5, 0.8], [0.8, 0.3]]], b: [[[0.2, 0.1], [1e300, 0.5], [0.3, 0.9], [null, 0.4], [true, 0.5], [0.8, 0.9]]], c: [[[1e300, 1e300], [-1e300, 5]]] } });
  const G = I.HAND.glyphs, pts = [].concat(...Object.values(G).map(st => [].concat(...st)));
  ok(n === 2 && !G.c && G.b[0].length === 3 && pts.every(p => p.every(v => isFinite(v) && v >= -10 && v <= 11)), `Nib.hand.load keeps only points within 10 boxes of the glyph (${n} glyphs; b has ${G.b && G.b[0].length} points)`);
  const hv = Nib.neaten(rows[1].strokes, { style: 'hand' });
  ok(finite(hv.items.map(it => it.parts)), 'the hand view draws finite strokes');
  Nib.hand.clear();
}

// ================================================================== 2
section('2. symbol sets');
{
  const s = rows[0].strokes;
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 5, {}, { include: 'abc' }, () => 'school', true]) {
    const e = throws(() => Nib.recognize(s, { symbols: bad }));
    ok(e && /^Nib: unknown symbol set/.test(e.message), `symbols ${typeof bad === 'function' ? 'a function' : JSON.stringify(bad)}: "${e && e.message}"`);
  }
  ok(/^Nib: unknown symbol set typo$/.test((throws(() => Nib.recognize(s, { symbols: 'typo' })) || {}).message), 'an unknown name still throws, naming it (the contract in check.js)');
  for (const good of ['school', 'all', 'numbers', null, ['2', '3', '+', '='], { include: ['2', '3'] }, { exclude: ['x'] }]) ok(!throws(() => Nib.recognize(s, { symbols: good })), 'symbols ' + JSON.stringify(good) + ' reads');
}

// ================================================================== 3
section('3. scribbles: bounded, the same answers, the share');
{
  let S = { SCR_MAX: null };
  try { S = srcScope(['scribble.js'], ['SCR_MAX']); } catch (e) { /* no bounds */ }
  // The largest scribbles test/scribble_check.js makes (its thirteen kinds over whole lines of writing), measured: 111,552
  // points, a path of 305,660 px, 447 turns. The bounds are above them, so its counts stay as they were.
  ok(!!S.SCR_MAX && S.SCR_MAX.points > 111552 && S.SCR_MAX.path > 305660 && S.SCR_MAX.legs > 447, `the bounds ${JSON.stringify(S.SCR_MAX)} are above the largest scribble scribble_check makes (111,552 points, 305,660 px, 447 turns)`);
  const T = (name, pts, z, most) => { const [t, r] = ms(() => Nib.scribble.of(pts, z)); ok(t < most, `${name} (${pts.length} points): ${t.toFixed(0)} ms (under ${most}) — ${r ? 'a ' + r.kind : 'ink'}`); return r; };
  // the long strokes of the audit (the Board's pen-lift table): a zig-zag of legs of 25 points 600 px wide
  const boardZig = n => Array.from({ length: n }, (_, i) => { const leg = Math.floor(i / 25), k = i % 25; return [200 + (leg % 2 ? 600 - k * 24 : k * 24), 150 + (leg * 0.9) % 500]; });
  for (const n of [2000, 8000, 16000, 40000]) T('the Board\'s long zig-zag', boardZig(n), 1, 150);
  // shapes a long stroke can have (the audit's scale probe), each size
  const gens = {
    zigzag: n => Array.from({ length: n }, (_, i) => { const leg = Math.floor(i / 25), k = i % 25; return [leg % 2 ? 300 - k * 12 : k * 12, 50 + leg * 3 + k * 0.12]; }),
    spiral: n => Array.from({ length: n }, (_, i) => [300 + (20 + i / 60) * Math.cos(i / 9), 300 + (20 + i / 60) * Math.sin(i / 9)]),
    wander: n => { let x = 0, y = 0, a = 0; return Array.from({ length: n }, (_, i) => { a += Math.sin(i / 37) * 0.2; x += Math.cos(a) * 3; y += Math.sin(a) * 3; return [x, y]; }); },
    straight: n => Array.from({ length: n }, (_, i) => [i * 2, 100 + Math.sin(i / 50)]),
    coloring: n => Array.from({ length: n }, (_, i) => { const leg = Math.floor(i / 40), k = i % 40; return [leg % 2 ? 400 - k * 10 : k * 10, 100 + leg * 1.5]; }),
  };
  for (const g of Object.keys(gens)) {
    let worst = 0, at = 0;
    for (const n of [500, 1000, 2000, 4000, 8000, 16000]) { const [t] = ms(() => Nib.scribble.of(gens[g](n), 1)); if (t > worst) { worst = t; at = n; } }
    ok(worst < 250, `a long ${g}, 500 to 16,000 points: the slowest ${worst.toFixed(0)} ms (${at} points)`);
  }
  // legs of 10, 3 and 1 points, up to 8,000 legs (the audit's legs probe)
  for (const per of [10, 3, 1]) {
    let worst = 0;
    for (const legs of [200, 500, 1000, 2000, 4000, 8000]) {
      const pts = []; for (let l = 0; l < legs; l++) for (let k = 0; k < per; k++) pts.push([l % 2 ? 200 - (k + 1) * 200 / per : (k + 1) * 200 / per, 50 + l * 0.6 + (l % 7) * 0.3]);
      const [t] = ms(() => Nib.scribble.of(pts, 1)); worst = Math.max(worst, t);
    }
    ok(worst < 250, `200 to 8,000 legs of ${per} point${per > 1 ? 's' : ''}: the slowest ${worst.toFixed(0)} ms`);
  }
  // at any scale, through the API (Deckhand's z left at 1): a 73-point zig-zag made 10,000 to 1e12 times bigger
  const line = (x0, y0, x1, y1, n = 8) => Array.from({ length: n }, (_, i) => [x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * i / (n - 1)]);
  const zig9 = Array.from({ length: 9 }, (_, i) => [i % 2 ? 100 : 0, i * 6]).reduce((acc, p, i, a) => (i ? acc.concat(line(a[i - 1][0], a[i - 1][1], p[0], p[1], 8)) : [p]), []);
  for (const k of [1e4, 1e6, 1e12]) for (const z of [1, undefined, 1e-9, 1e9]) T(`a zig-zag ×${k}, z ${z}`, zig9.map(p => [p[0] * k, p[1] * k]), z, 250);
  T('a stroke of 200,000 points', Array.from({ length: 200000 }, (_, i) => [(i % 400) * (Math.floor(i / 400) % 2 ? -1 : 1) + 400, i * 0.01]), 1, 250);
  // the point bound on its own: a plain 20-leg zig-zag (a path of 6,000 px, far under the other two bounds) is a scribble
  // sampled just under SCR_MAX.points and ink just over it
  if (S.SCR_MAX) {
    const dense = n => { const out = [], per = Math.floor(n / 20); for (let l = 0; l < 20; l++) for (let k = 0; k < per; k++) { const t = k / per; out.push([100 + (l % 2 ? 300 * (1 - t) : 300 * t), 100 + 120 * (l + t) / 20]); } return out; };
    const under = Nib.scribble.of(dense(S.SCR_MAX.points - 1000), 1), over = Nib.scribble.of(dense(S.SCR_MAX.points + 1000), 1);
    ok(!!under && under.kind === 'zigzag' && over === null, `a 20-leg zig-zag of ${S.SCR_MAX.points - 1000} points is a scribble, of ${S.SCR_MAX.points + 1000} points ink (${under ? under.kind : 'ink'}, ${over ? over.kind : 'ink'})`);
  }
  // a real scribble at the size a hand makes it is still a scribble
  const zigOver = (x0, y0, w, h, legs, step) => { const out = []; for (let k = 0; k <= legs; k++) { const p = [k % 2 ? x0 + w : x0, y0 + h * k / legs]; if (out.length) { const q = out[out.length - 1], d = Math.hypot(p[0] - q[0], p[1] - q[1]), m = Math.max(1, Math.round(d / step)); for (let i = 1; i <= m; i++) out.push([q[0] + (p[0] - q[0]) * i / m, q[1] + (p[1] - q[1]) * i / m]); } else out.push(p); } return out; };
  for (const [name, s] of [['over one symbol', zigOver(100, 100, 60, 60, 12, 3)], ['over a whole equation, slowly', zigOver(100, 100, 900, 120, 70, 2)]]) {
    const r = Nib.scribble.of(s, 1);
    ok(r && r.kind === 'zigzag', `a zig-zag ${name} (${s.length} points) is a scribble`);
  }

  // The same answers as before: the three functions 1.6.7 made faster, and the order of two checks, as they were in
  // 1.6.6, put back into the source side by side, and every answer of scribbleOf compared whole (real strokes,
  // scribbles of every size a hand makes and more, long strokes)
  const OLD = {
    scrRepeats: `function scrRepeats(pts, turns, d) {
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
}`,
    scrOverlap: `function scrOverlap(pts, d) {
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
}`,
    scrDistC: `function scrDistC(p, chunks) {
  let best = Infinity;
  for (const c of chunks) {
    const b = c.box, dx = Math.max(b[0] - p[0], 0, p[0] - b[2]), dy = Math.max(b[1] - p[1], 0, p[1] - b[3]);
    if (dx * dx + dy * dy >= best * best) continue;
    const d = scrDist(p, c.part);
    if (d < best) best = d;
  }
  return best;
}`,
  };
  const swapFn = (src, name, text) => { const a = src.indexOf('function ' + name + '('), b = src.indexOf('\n}\n', a); if (a < 0 || b < 0) throw new Error('no ' + name + ' in src/scribble.js'); return src.slice(0, a) + text + src.slice(b + 2); };
  const NEW_ORDER = 'if (sc && scrFill(reach(), gap) < 0.67 && scrOverlap(pts, 1.5 / z) >= 0.9) sc = null;', OLD_ORDER = 'if (sc && scrOverlap(pts, 1.5 / z) >= 0.9 && scrFill(reach(), gap) < 0.67) sc = null;';
  let V = null;
  const ve = throws(() => {
    V = srcScope(['scribble.js'], ['scribbleOf', 'scribbleErase'], src => {
      if (!src.includes(NEW_ORDER)) throw new Error('the fill-then-overlap line is not in src/scribble.js');
      for (const k of Object.keys(OLD)) src = swapFn(src, k, OLD[k]);
      return src.replace(NEW_ORDER, OLD_ORDER);
    });
  });
  ok(!ve, 'the 1.6.6 functions put back into src/scribble.js' + (ve ? ': ' + ve.message : ''));
  if (V) {
    const corpus = [];
    for (const r of rows.slice(0, 250)) { for (const s of r.strokes) corpus.push([s, 1]); corpus.push([[].concat(...r.strokes.slice(0, 3)), 1]); }
    for (let k = 0; k < 40; k++) {
      const w = 30 + (k * 37) % 400, h = 20 + (k * 53) % 200, legs = 5 + (k * 7) % 60, step = 1.5 + (k % 5);
      const s = zigOver(100, 100, w, h, legs, step);
      if (k % 4 === 1) for (let i = 0; i < s.length; i++) s[i] = [s[i][0] + Math.sin(i * 1.3) * 1.2, s[i][1] + Math.cos(i * 0.7) * 1.2];
      if (k % 4 === 2) for (let i = 0; i < s.length; i++) { const a = 0.4, x = s[i][0], y = s[i][1]; s[i] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]; }
      corpus.push([s, 1], [s, 2], [s, 0.5]);
    }
    for (let k = 0; k < 12; k++) corpus.push([Array.from({ length: 300 + k * 120 }, (_, i) => [300 + (15 + k * 3 + i / 50) * Math.cos(i / (6 + k)), 300 + (12 + k * 2 + i / 60) * Math.sin(i / (6 + k))]), 1]);
    for (const g of Object.keys(gens)) for (const n of [500, 2000]) corpus.push([gens[g](n), 1]);
    for (const n of [2000, 3000]) corpus.push([boardZig(n), 1]);
    let same = 0, scr = 0;
    const diff = [];
    for (const [s, z] of corpus) {
      const a = JSON.stringify(Nib.scribble.of(s, z)), b = JSON.stringify(V.scribbleOf(s, z));
      if (a === b) same++; else if (diff.length < 3) diff.push(s.length);
      if (a !== 'null') scr++;
    }
    ok(same === corpus.length, `scribbleOf answers exactly as the 1.6.6 functions do: ${same} of ${corpus.length} strokes (${scr} of them scribbles)${diff.length ? '; differ: ' + diff.join(', ') + ' points' : ''}`);
  }
  // what a scribble takes at its edge: a neighbor stroke about half under it stays, one mostly under it goes (SCR.share,
  // 0.6: a change of it and of the other 0.6 bars to 0.4 went unnoticed by scribble_check)
  const zz = []; for (let k = 0; k <= 14; k++) { const p = [k % 2 ? 226 : 94, 96 + 68 * k / 14]; if (zz.length) { const q = zz[zz.length - 1]; for (let i = 1; i <= 8; i++) zz.push([q[0] + (p[0] - q[0]) * i / 8, q[1] + (p[1] - q[1]) * i / 8]); } else zz.push(p); }
  const sc = Nib.scribble.of(zz, 1);
  ok(!!sc && sc.kind === 'zigzag', 'a zig-zag over 94..226 × 96..164');
  const dash = (x0, x1, y) => Array.from({ length: 30 }, (_, i) => [x0 + (x1 - x0) * i / 29, y + Math.sin(i) * 0.5]);
  for (const y of [120, 130, 140, 150]) {
    const e = Nib.scribble.erase(sc, [{ pts: dash(60, 160, y) }], 1);
    ok(!e.erase.length && e.shares[0] > 0.5 && e.shares[0] < Nib._internals.SCR.share, `a line from 60 to 160 at y ${y}, about half under it, stays (share ${e.shares[0].toFixed(2)}, ${e.why})`);
  }
  for (const x0 of [124, 112]) {
    const e = Nib.scribble.erase(sc, [{ pts: dash(x0, x0 + 120, 130) }], 1);
    ok(e.erase.length === 1 && e.shares[0] > 0.8, `a line from ${x0} to ${x0 + 120}, mostly under it, goes (share ${e.shares[0].toFixed(2)}, ${e.why})`);
  }
}

// ================================================================== 4
section('4. the Replicator: letters written far outside their boxes');
{
  const ttf = b => b && b.length > 12 && b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0;
  const B = [[[0.2, 0.2], [0.5, 0.8], [0.8, 0.2]]];
  for (const k of [10, 30, 100, 1000]) {
    const A = [[[-0.5 * k, -0.5 * k], [0.9, k], [k, 0.03]]];
    let f = null, e = null; const [t] = ms(() => { e = throws(() => { f = R.buildFont({ A, B, C: [[[1e300, 1e300], [-1e300, 0.5]]] }, { name: 'T', weight: 80, spacing: 50, smoothing: 5, tidy: true, even: true }); }); });
    ok(!e && t < 3000 && f && ttf(f.bytes) && f.built.includes('A') && f.built.includes('B'), `a letter reaching ${k} boxes out: the font in ${t.toFixed(0)} ms (under 3,000), a TrueType file, A drawn clipped to its box and a box around it${e ? ' (threw ' + e.message + ')' : ''}`);
  }
  const held = R.boxStrokes([[[-30, 0.5], [0.5, 0.5], [40, 2], [0.2, -7]]])[0];
  ok(JSON.stringify(held) === '[[-1,0.5],[0.5,0.5],[2,2],[0.2,-1]]', 'saved strokes are held to -1 .. 2 of the box: ' + JSON.stringify(held));
  const inside = [[[0, 0], [0.31, 0.77], [1, 1], [0.999, 0.0001]]];
  ok(JSON.stringify(R.boxStrokes(inside)) === JSON.stringify(inside), 'a glyph written inside its box is not changed at all');
  const line = [[[0.2, 0.5], [7.5, 0.6], [12, 1.2]]];
  ok(JSON.stringify(R.cleanStrokes(line)) === JSON.stringify(line), 'cleanStrokes itself holds nothing to a box (a sentence\'s strokes, in line units, run far to the right)');
  let f2 = null; const e2 = throws(() => { f2 = R.buildFont({ A: B, B }, { weight: 1e9 }); R.buildFont({ A: B }, { weight: NaN, smoothing: 1e9 }); R.buildFont({ A: B }, { unit: 1e-6 }); });
  ok(!e2 && f2 && ttf(f2.bytes), 'odd pen settings (a weight of 1e9 or NaN, a raster unit of 1e-6) never throw' + (e2 ? ': ' + e2.message : ''));
  let ras; const [tr] = ms(() => { try { ras = R.rasterize([[[0, 0], [1e7, 1e7]]], 80, 1); } catch (e) { ras = e; } });
  ok(ras === null && tr < 50, `a raster bigger than RASTER_MAX is refused (null) at once (${tr.toFixed(1)} ms)`);
  // a point every 0 units would never end (the smoothing's resampling): in a child, with a deadline
  const kid = spawnSync(process.execPath, ['-e', `const R = require(${JSON.stringify(path.join(ROOT, 'replicator', 'core.js'))}); const s = R.smooth([[0, 0], [5, 5], [10, 0], [15, 5]], 0, 3); const L = R.smooth(Array.from({ length: 2000 }, (_, i) => [i % 2 ? 1e7 : 0, i]), 6, 3); console.log(s.length + ' ' + L.length);`], { timeout: 15000, encoding: 'utf8' });
  ok(kid.status === 0 && /^\d+ \d+/.test(kid.stdout) && +kid.stdout.split(' ')[1] <= 100001, `resampling ends: spacing 0, and a very long stroke at most 100,000 points (${(kid.stdout || kid.error || '').toString().trim()})`);
}

// ================================================================== 5
section('5. small guards');
{
  const trees = { '[[null]]': [[null]], '{}': {}, "'x'": 'x', 'a sup that is a string': [[{ k: 's', label: '2', strokes: [0], sup: 'x' }, { k: 's', label: '=', strokes: [1] }]],
    'a label that is a number': [[{ k: 's', label: 5, strokes: [0] }, { k: 's', label: '=', strokes: [1] }]], 'rows that are not arrays': [5, null, 'x', {}],
    'a tree inside itself': (() => { const row = []; row.push({ k: 'frac', num: row, den: [{ k: 's', label: '2' }] }, { k: 's', label: '=' }); return [row]; })() };
  for (const [name, tree] of Object.entries(trees)) {
    let r; const e = throws(() => { r = Nib.solve({ tree }); });
    ok(!e && Array.isArray(r) && r.every(a => a === null), `Nib.solve({tree: ${name}}): ${e ? 'threw ' + e.message : JSON.stringify(r)}`);
  }
  ok(JSON.stringify(Nib.solve({ tree: {} })) === '[]' && JSON.stringify(Nib.solve({ tree: 'x' })) === '[]', 'a tree that is not an array of rows is []');
  const good = Nib._internals.latexRows('2+3= \\\\ 4 \\times 5 =');
  const mixed = Nib.solve({ tree: [good[0], [null], good[1]] });
  ok(mixed.length === 3 && mixed[0] && mixed[0].latex === '5' && mixed[1] === null && mixed[2] && mixed[2].latex === '20', 'a malformed row among good ones: the good rows are still answered: ' + JSON.stringify(mixed.map(a => a && a.latex)));
  for (const args of [[0, 0, 0, 0], ['a', 'b', 'c', 'd'], [], [null, null], [100, 100, NaN, 792], [-5, 10, 612, 792, -3], [1200, 900, 792, 612, 1n]]) {
    let r; const e = throws(() => { r = Nib.canvas.pdfFit(...args); });
    ok(!e && r.length === 4 && r.every(Number.isFinite), `pdfFit(${args.map(a => (typeof a === 'bigint' ? a + 'n' : JSON.stringify(a))).join(', ')}) → ${JSON.stringify(r)}`);
  }
  const fit166 = (iw, ih, pw, ph, margin) => { const mg = Math.max(0, +margin || 0), aw = Math.max(1e-3, pw - 2 * mg), ah = Math.max(1e-3, ph - 2 * mg); const k = Math.min(aw / iw, ah / ih), w = iw * k, h = ih * k; return [(pw - w) / 2, (ph - h) / 2, w, h]; };
  const sizes = [[1200, 900, 792, 612, 36], [1224, 1584, 612, 792, 36], [1600, 1000, 842, 595, 24], [2000, 1500, 792, 612, 18], [800, 600, 612, 792], [1, 1, 612, 792, 0]];
  ok(sizes.every(a => JSON.stringify(Nib.canvas.pdfFit(...a)) === JSON.stringify(fit166(...a))), 'pdfFit of real sizes is exactly as before');
  for (const c of [5, {}, [], true]) ok(Nib.canvas.color(c, false, '#123456') === '#123456', `color(${JSON.stringify(c)}) is the ink color, not the value given`);
  ok(Nib.canvas.color('@red', false, '#123456') !== '#123456' && Nib.canvas.color('#abcdef', true, '#123456') === '#abcdef', 'named and CSS colors are as before');
  for (const [a, b] of [[undefined, undefined], [null, [1, 2]], [[1, 2], 'x'], [5, 6]]) ok(Nib.canvas.shapeFromDrag('rect', a, b) === null, `shapeFromDrag('rect', ${JSON.stringify(a)}, ${JSON.stringify(b)}) → null`);
  ok(!!Nib.canvas.shapeFromDrag('rect', [0, 0], [100, 50]), 'a real drag still makes a shape');
  const items = [{ pts: [[1, 1], [2, 2]] }];
  for (const sc of [{}, [], 5, 'x', { hull: [] }, { hull: [], chunks: [{}], box: [], path: [], turns: [], band: 1, reach: 1 }]) {
    let e1, c1; const e = throws(() => { e1 = Nib.scribble.erase(sc, items, 1); c1 = Nib.scribble.covers(sc, [[1, 1]], 1); });
    ok(!e && e1.why === 'not a scribble' && e1.erase.length === 0 && c1.got === 0 && c1.of === 0 && c1.share === 0, `scribble.erase / .covers given ${JSON.stringify(sc)}: not a scribble, a zero cover`);
  }
  ok(Nib.scribble.erase(null, items, 1).why === 'nothing under it', 'no scribble at all is, as before, nothing under it');
}

// ================================================================== 6
section('6. what the mutation sample showed untested (characterization: these are today\'s numbers)');
{
  const ans = s => { const r = Nib.solve(s); const a = r[r.length - 1]; return a ? a.latex : null; };
  const pin = (s, want) => ok(ans(s) === want, `${s} → ${JSON.stringify(ans(s))} (${want === null ? 'nothing' : want})`);
  pin('200! \\div 199! =', '200'); pin('201! \\div 200! =', null);                          // the factorial limit
  pin('x^{12}x^{12} =', 'x^{24}'); pin('x^{13}x^{12} =', null);                             // powers of letters
  pin('2^{1024} \\div 2^{1023} =', '2'); pin('2^{1025} \\div 2^{1024} =', null);            // the size limit, SOLVE_BITS (4096)
  pin('\\sqrt[64]{2^{64}} =', '2'); pin('\\sqrt[65]{2^{65}} =', null);                      // the root index
  pin('0.\\overline{123456789012} =', '\\frac{41152263004}{333333333333}'); pin('0.\\overline{1234567890123} =', null);   // repeating digits
  pin('2^{79} =', '604462909807314587353088'); pin('2^{80} =', null);                       // answers of 24 digits at most
  // + over − is ±, − over − is =, two stacked dots are : (real symbols from the school problems, between a 2 and a 3)
  const P = symbolsOf('+'), M = symbolsOf('-'), D = symbolsOf('.'), two = symbolsOf('2'), three = symbolsOf('3');
  const read = (mk, want) => { const got = []; for (let k = 0; k < 12; k++) got.push(Nib.recognize(mk(k, placeH(two[k], 0, 0, 50), placeH(three[k], 160, 0, 50))).latex); return { n: got.filter(t => t.replace(/\s/g, '') === want).length, got }; };
  const cases = [
    ['+ over −', '2\\pm3', (k, a, c) => a.concat(place(P[k], 70, 5, 36), place(M[k], 70, 47, 36), c), 9],
    ['+ over −, the + written after the 3', '2\\pm3', (k, a, c) => a.concat(place(M[k], 70, 47, 36), c, place(P[k], 70, 5, 36)), 10],
    ['− over −, the second written after the 3', '2=3', (k, a, c) => a.concat(place(M[k], 70, 17, 36), c, place(M[(k + 5) % M.length], 70, 33, 36)), 12],
    ['two stacked dots', '2:3', (k, a, c) => a.concat(placeH(D[k], 85, 12, 5), placeH(D[(k + 3) % D.length], 85, 36, 5), c), 8],
  ];
  for (const [name, want, mk, n] of cases) { const r = read(mk, want); ok(r.n === n, `${name}: ${r.n} of 12 read ${want} (${n} today): ${r.got.join(' ')}`); }
  // the memory: at most MEM_MAX (400) corrections, the oldest going first
  Nib.memory.clear();
  const shapes = [];
  // (a correction nearly the same as one kept replaces it: of 560 symbols, more than 400 are kept as their own)
  for (const r of rows) { for (const y of r.symbols) { shapes.push(y.strokes.map(i => r.strokes[i])); if (shapes.length >= 560) break; } if (shapes.length >= 560) break; }
  let most = 0;
  for (const g of shapes) { Nib.memory.learn(g, '7'); most = Math.max(most, Nib.memory.size); }
  ok(Nib.memory.size === 400 && most === 400, `560 corrections keep the last 400 (${Nib.memory.size}, never more than ${most})`);
  Nib.memory.clear();
  // ...and a correction pulls only near-identical shapes (MEM_SIM0, 0.88): a 2 learned as 7 changes the reading of 2s
  // whose embedding is within 0.88 of it, and not of one at 0.87
  const I = Nib._internals, twos = two.slice(0, 60), unitOf = g => { const h = I.classifyGroup(g, I.refSize(g)).hidden; let n = 0; for (const x of h) n += x * x; n = Math.sqrt(n); return Array.from(h, x => x / n); };
  const cos = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };
  const A = unitOf(twos[32]);
  Nib.memory.learn(twos[32], '7');
  const rec = new Nib.Recognizer(), seven = I.model().idx['7'];
  for (const [j, pulled] of [[32, true], [27, true], [6, true], [50, true], [34, false]]) {
    const g = twos[j], ref = I.refSize(g), c = cos(A, unitOf(g));
    const p0 = rec.probs(g, ref, 'mem' + j, false)[seven], p1 = rec.probs(g, ref, 'mem' + j, true)[seven];
    ok(pulled ? p1 > p0 : p1 === p0, `a 2 at similarity ${c.toFixed(3)} to the corrected one: ${pulled ? 'pulled toward 7' : 'untouched'} (p(7) ${p0.toFixed(4)} → ${p1.toFixed(4)})`);
  }
  Nib.memory.clear();
  // the tidy view's exponents: NEAT.script (0.65) of a symbol's size, so a 2 as an exponent is 0.65 × 0.7 em tall
  const hs = [];
  for (const r of rows.filter(r => /\^\{2\}/.test(r.latex)).slice(0, 8)) {
    const t = Nib.neaten(r.strokes), sup = [];
    const walk = row => { for (const u of row) { if (u.sup) for (const v of u.sup) if (v.k === 's' && v.label === '2') sup.push(v.strokes.join(',')); for (const k of ['num', 'den', 'body', 'sub', 'sup']) if (u[k]) walk(u[k]); } };
    t.result.tree.forEach(walk);
    for (const it of t.items) if (it.label === '2' && sup.includes(it.src.join(','))) hs.push((it.box[3] - it.box[1]) / t.em);
  }
  ok(hs.length >= 5 && hs.every(h => Math.abs(h - 0.455) < 1e-3), `a 2 written as an exponent is drawn 0.455 em tall in the tidy view (${hs.map(h => h.toFixed(3)).join(' ')})`);
  // the Replicator's pen weight: the outline of a letter grows with it by the difference each way (a mutation that
  // ignored the weight passed replicator_check and font_check)
  const V = [[[0.2, 0.2], [0.5, 0.8], [0.8, 0.2]]];
  const wide = w => { const o = R.outline(V, { weight: w, smoothing: 5 }); return [o.bbox[2] - o.bbox[0], o.bbox[3] - o.bbox[1]]; };
  const w40 = wide(40), w80 = wide(80), w150 = wide(150);
  ok(Math.abs(w80[0] - w40[0] - 40) < 6 && Math.abs(w150[0] - w80[0] - 70) < 6 && Math.abs(w150[1] - w40[1] - 110) < 6,
    `the Replicator's pen weight sets the width of the ink: a V is ${w40.map(Math.round).join(' × ')} at 40, ${w80.map(Math.round).join(' × ')} at 80, ${w150.map(Math.round).join(' × ')} at 150 (font units)`);
}

// ================================================================== 7
section('7. the test runner says what was skipped');
{
  const run = require('./run.js');
  const skips = ['    (x= misread every time; skipped)', '    (no writer read x² = 49 / x = right; skipped)', '    (no writer read 0.2 right; skipped)', '    (no CROHME 2019 test writers (training/scratch/data/test.jsonl))',
    '  (no data sets at /x/: the school problems only; set NIB_DATA)', '  (skipped: no puppeteer-core / Chrome)', '    (skipped: no offline Replicator beside this page)'];
  const plain = ['  ok   the hand tool drags the board (no ink): {"x":100}', '  ok   zoomed in, a pan frame takes 2.0 ms (what is out of view is skipped)', 'all passed', '35 passed, 0 failed', '(16 s)', '  FAIL something (no answer)'];
  ok(skips.every(l => run.SKIP_LINE.test(l)), 'the suites\' skip lines are counted (' + skips.length + ' kinds)');
  ok(!plain.some(l => run.SKIP_LINE.test(l)), 'lines that only mention "no" or "skipped" are not');
  ok(run.skipsIn(skips.concat(plain)).length === skips.length, 'skipsIn finds just them');
  ok(run.strictSkips({ CI: 'true' }) && run.strictSkips({ NIB_STRICT: '1' }) && !run.strictSkips({}) && !run.strictSkips({ CI: 'false' }) && !run.strictSkips({ NIB_STRICT: '0' }), 'skips fail the run with CI or NIB_STRICT=1, not otherwise');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
