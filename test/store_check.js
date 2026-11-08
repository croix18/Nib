// src/store.js without a browser: packed points round trip exactly (with and without pressure, negative and huge
// coordinates, 1-point and 10,000-point strokes), how much smaller they are than JSON, how fast; bad input gives []
// without throwing; the image store's in-memory fallback (node has no IndexedDB); top-level names are unique in src/.
//   node test/store_check.js
'use strict';
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const NAMES = ['storePack', 'storeUnpack', 'storeImagePut', 'storeImageGet', 'storeImageDelete', 'storeImageIds', 'storeImagesDurable', 'STORE_DB', 'STORE_IMAGES'];
const S = new Function("'use strict';\n" + fs.readFileSync(path.join(SRC, 'store.js'), 'utf8') + '\nreturn {' + NAMES.join(', ') + '};')();
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  FAIL', m); } };
const section = n => console.log(n);
let seed = 20261108;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];

// what a packed point must come back as: x, y to 0.1 (clamped to ±2^49 units), p to 0.01 within 0..1
const MAXQ = 2 ** 49, q10 = v => { const r = Math.round(v * 10); return Math.max(-MAXQ, Math.min(MAXQ, r)); };
const qp = p => Math.round(Math.min(1, Math.max(0, p)) * 100);
function expectOf(points, wp) {
  const out = []; let lastP = null;
  for (const q of points) {
    if (!q || !Number.isFinite(+q[0]) || !Number.isFinite(+q[1])) continue;
    const e = [q10(+q[0]) / 10, q10(+q[1]) / 10, 0];
    if (wp) { const p = Number.isFinite(+q[3]) && q.length > 3 ? qp(+q[3]) : lastP === null ? 50 : lastP; lastP = p; e.push(p / 100); }
    out.push(e);
  }
  return out;
}
function sameRows(a, b) {
  if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return `point ${i}: ${a[i].length} values vs ${b[i].length}`;
    for (let k = 0; k < a[i].length; k++) if (a[i][k] !== b[i][k]) return `point ${i}[${k}]: ${a[i][k]} vs ${b[i][k]}`;
  }
  return '';
}
// a random stroke: a walk from a base point, steps of a given scale, now and then a jump
function stroke(len, base, scale, wp, pressureKind) {
  const pts = []; let x = base[0] + rnd() * 100, y = base[1] + rnd() * 100, p = rnd(), t = 0;
  for (let i = 0; i < len; i++) {
    const s = rnd() < 0.02 ? scale * 1000 : scale;
    x += (rnd() - 0.5) * 2 * s; y += (rnd() - 0.5) * 2 * s; t += 8;
    if (pressureKind === 'wild') p = pick([0, 1, rnd(), -0.3, 1.4, rnd()]);
    else p = Math.min(1, Math.max(0, p + (rnd() - 0.5) * 0.1));
    pts.push(wp ? [x, y, t, p] : [x, y, t]);
  }
  return pts;
}

// ------------------------------------------------------------------ 1. round trip
section('1. round trip');
let trips = 0, tripPoints = 0, firstBad = '';
const bases = [[0, 0], [-500, -800], [1e7, 1e7], [-1e7, -1e7], [-1e7, 1e7], [123456.789, -98765.4321]];
for (let trial = 0; trial < 1500; trial++) {
  const len = pick([1, 1, 2, 3, 5, 17, 40, 100, 1000]), wp = rnd() < 0.5;
  const pts = stroke(len, pick(bases), pick([0.05, 0.7, 1.5, 3, 50, 1e6]), wp, rnd() < 0.3 ? 'wild' : 'smooth');
  const s = S.storePack(pts, wp), u = S.storeUnpack(s), why = sameRows(u, expectOf(pts, wp));
  if (why && !firstBad) firstBad = `trial ${trial} (len ${len}, pressure ${wp}): ${why}`;
  if (!why && S.storePack(u, wp) === s) trips++; else if (!firstBad) firstBad = `trial ${trial}: packing the unpacked points again gives a different string`;
  tripPoints += len;
}
ok(trips === 1500, `1500 random strokes (${tripPoints} points; 1-, 2-, 3-point and longer; at 0, negative, ±1e7) come back exactly: ${trips}` + (firstBad ? ' — ' + firstBad : ''));
for (const wp of [false, true]) {
  const long = stroke(10000, [-3000, 2500], 2, wp, 'smooth'), s = S.storePack(long, wp), u = S.storeUnpack(s);
  ok(!sameRows(u, expectOf(long, wp)) && S.storePack(u, wp) === s, `a 10,000-point stroke ${wp ? 'with' : 'without'} pressure comes back exactly (${s.length} chars)`);
}
const one = S.storeUnpack(S.storePack([[12.34, -56.78, 99]], false));
ok(one.length === 1 && one[0][0] === 12.3 && one[0][1] === -56.8 && one[0][2] === 0 && one[0].length === 3, 'a 1-point stroke: ' + JSON.stringify(one));
const oneP = S.storeUnpack(S.storePack([[1e7, -1e7, 5, 0.537]], true));
ok(oneP.length === 1 && oneP[0][0] === 1e7 && oneP[0][1] === -1e7 && oneP[0][3] === 0.54 && oneP[0].length === 4, 'a 1-point stroke at (1e7, -1e7) with pressure: ' + JSON.stringify(oneP));
const exact = [[0.1, 0.2], [0.3, -0.7], [1234.5, 6789.1], [-0.05, 0.05], [9999999.9, -9999999.9]];
ok(!sameRows(S.storeUnpack(S.storePack(exact, false)), exact.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, 0])), 'tenths come back as the same doubles (0.1, 0.3, 1234.5, 9999999.9 …)');
const jump = S.storeUnpack(S.storePack([[-1e7, -1e7], [1e7, 1e7], [-1e7, 1e7]], false));
ok(jump.length === 3 && jump[1][0] === 1e7 && jump[2][0] === -1e7 && jump[2][1] === 1e7, 'jumps of 2e7 px between points');
const huge = S.storeUnpack(S.storePack([[1e20, -1e20], [5, 5]], false));
ok(huge.length === 2 && huge[0][0] === MAXQ / 10 && huge[0][1] === -MAXQ / 10 && huge[1][0] === 5, `beyond ±2^49/10 px a coordinate is clamped there (${huge[0][0]}), the stroke still packs`);
// pressure: left out it is on when the points have one; a point without one takes the one before (0.5 at first)
ok(S.storePack([[1, 2, 0, 0.5]])[0] === 'B' && S.storePack([[1, 2, 0]])[0] === 'A', 'withPressure left out: on when the points have a p ("B…"), off otherwise ("A…")');
const gaps = S.storeUnpack(S.storePack([[0, 0, 0], [1, 1, 0, 0.8], [2, 2, 0], [3, 3, 0, NaN], [4, 4, 0, 0.1]], true));
ok(gaps.map(p => p[3]).join() === '0.5,0.8,0.8,0.8,0.1', 'with pressure, a point without one takes the one before it (0.5 at first): ' + gaps.map(p => p[3]).join());
const clamp = S.storeUnpack(S.storePack([[0, 0, 0, -0.4], [1, 1, 0, 1.7], [2, 2, 0, 0.999], [3, 3, 0, 0.004]], true));
ok(clamp.map(p => p[3]).join() === '0,1,1,0', 'pressure is kept within 0..1 to 0.01: ' + clamp.map(p => p[3]).join());
const holes = S.storeUnpack(S.storePack([[1, 1], null, [NaN, 2], [3, Infinity], 'x', [4, 4], [undefined, 1], [5, 5]], false));
ok(holes.length === 3 && holes.map(p => p[0]).join() === '1,4,5', 'points without a finite x and y are left out: ' + JSON.stringify(holes));
ok(S.storePack([], false) === 'A' && S.storeUnpack('A').length === 0 && S.storePack(null) === 'A' && S.storePack(undefined, true) === 'B', 'no points: "A" (or "B"), which unpacks to []');
ok(/^[A-Za-z0-9_-]+$/.test(S.storePack(stroke(500, [-1e7, 1e7], 30, true, 'wild'), true)), 'packed strings use only base64url characters');
const forJson = S.storePack(stroke(500, [-1e7, 10], 300, true, 'wild'), true);
ok(JSON.stringify(forJson).length === forJson.length + 2, 'a packed string needs no escaping in JSON');

// ------------------------------------------------------------------ 2. bad input
section('2. bad input');
const good = S.storePack(stroke(30, [100, 100], 2, true), true), goodNP = S.storePack(stroke(30, [100, 100], 2, false), false);
const bad = ['', 'A', 'B', '!', '!!!!', 'hello world', 'Zgg', 'C' + goodNP.slice(1), '_AAA', 'AéA', 'A A', 'A=', 'Ag', 'AB', 'BAA', 'BAAAA', 'A' + 'g'.repeat(20) + 'A',
  good.slice(0, -1), goodNP.slice(0, -1), good + 'g', goodNP + 'A', null, undefined, 42, {}, [], [[1, 2]], true, NaN, () => 'A', Symbol('x')];
let badOk = 0; const badWrong = [];
for (const b of bad) {
  let r;
  try { r = S.storeUnpack(b); } catch (e) { r = 'threw ' + e.message; }
  if (Array.isArray(r) && r.length === 0) badOk++; else badWrong.push(String(typeof b === 'symbol' ? 'symbol' : JSON.stringify(b)).slice(0, 30) + ' → ' + JSON.stringify(r).slice(0, 40));
}
ok(badOk === bad.length, `${bad.length} bad inputs ('' , garbage, unknown flags, cut-off and overlong strings, non-strings) → [] without throwing: ${badOk}` + (badWrong.length ? ' — ' + badWrong.join('; ') : ''));
let fuzzThrew = 0, fuzzOdd = 0;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_!. é\u{1F600}';
for (let i = 0; i < 20000; i++) {
  let s = rnd() < 0.5 ? pick(['A', 'B']) : '';
  const n = Math.floor(rnd() * 40);
  for (let k = 0; k < n; k++) s += alphabet[Math.floor(rnd() * alphabet.length)];
  try {
    const r = S.storeUnpack(s);
    if (!Array.isArray(r) || r.some(p => !Array.isArray(p) || p.some(v => !Number.isFinite(v)))) fuzzOdd++;
  } catch (e) { fuzzThrew++; }
}
ok(fuzzThrew === 0 && fuzzOdd === 0, `20,000 random strings: never throws (${fuzzThrew}), always an array of finite points (${fuzzOdd} odd)`);

// ------------------------------------------------------------------ 3. size against JSON
section('3. size');
const fx = path.join(__dirname, 'fixtures');
const pen = [];
for (const f of fs.readdirSync(fx).filter(f => /^training_.*\.json$/.test(f))) {
  for (const r of JSON.parse(fs.readFileSync(path.join(fx, f), 'utf8')).records) {
    const ox = 100 + rnd() * 1300, oy = 100 + rnd() * 1900;          // the record's ink placed somewhere on a Board page
    for (const s of r.strokes) pen.push(s.map(p => [p[0] + ox, p[1] + oy, p[2]]));
  }
}
const boardFx = JSON.parse(fs.readFileSync(path.join(fx, 'board_2026-11-04.json'), 'utf8')).strokes;
const r1 = v => Math.round(v * 10) / 10;
function sizes(strokes, wp) {
  let packed = 0, json = 0, jsonT = 0, n = 0;
  for (const s of strokes) {
    packed += S.storePack(s, wp).length; n += s.length;
    json += JSON.stringify(s.map(p => wp ? [r1(p[0]), r1(p[1]), Math.round(p[3] * 100) / 100] : [r1(p[0]), r1(p[1])])).length;
    jsonT += JSON.stringify(s.map(p => wp ? [r1(p[0]), r1(p[1]), p[2] || 0, Math.round(p[3] * 100) / 100] : [r1(p[0]), r1(p[1]), p[2] || 0])).length;
  }
  return { n, packed, json, jsonT, per: packed / n, ratio: json / packed, ratioT: jsonT / packed };
}
// pressure for the real strokes: a smooth curve, as a pen gives (these records were saved without it)
const penP = pen.map(s => { let p = 0.3 + rnd() * 0.4; return s.map(q => (p = Math.min(1, Math.max(0.05, p + (rnd() - 0.5) * 0.04)), [q[0], q[1], q[2], p])); });
const SZ = { 'S Pen strokes (training fixtures)': sizes(pen, false), '  the same with pressure': sizes(penP, true), 'the board fixture (screen px)': sizes(boardFx.map(s => s.map(p => [p[0], p[1], 0])), false) };
for (const [k, v] of Object.entries(SZ))
  console.log(`  ${k.padEnd(36)} ${String(v.n).padStart(6)} points: packed ${v.packed} chars (${v.per.toFixed(2)}/point); JSON rounded to 0.1 ${v.json} → ${v.ratio.toFixed(2)}× smaller; with t ${v.jsonT} → ${v.ratioT.toFixed(2)}×`);
ok(SZ['S Pen strokes (training fixtures)'].ratio >= 4, `real pen strokes pack at least 4× smaller than JSON of [x, y] rounded to 0.1 (${SZ['S Pen strokes (training fixtures)'].ratio.toFixed(2)}×)`);
ok(SZ['  the same with pressure'].ratio >= 3, `with pressure at least 3× smaller than JSON of [x, y, p] (${SZ['  the same with pressure'].ratio.toFixed(2)}×)`);

// ------------------------------------------------------------------ 4. speed
section('4. speed');
// exactly 100,000 points of the real strokes (the fixtures again, moved, until there are enough)
function hundredK(src) {
  const out = []; let n = 0, k = 0;
  while (n < 100000) {
    const s = src[k++ % src.length], take = Math.min(s.length, 100000 - n), dx = 37 * Math.floor(k / src.length);
    out.push(s.slice(0, take).map(p => p.length > 3 ? [p[0] + dx, p[1], p[2], p[3]] : [p[0] + dx, p[1], p[2]])); n += take;
  }
  return out;
}
const ms = t0 => Number(process.hrtime.bigint() - t0) / 1e6, med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
function speed(strokes, wp) {
  const P = [], U = [], T = [];
  for (let r = 0; r < 15; r++) {
    let t0 = process.hrtime.bigint();
    const packed = strokes.map(s => S.storePack(s, wp));
    P.push(ms(t0)); t0 = process.hrtime.bigint();
    let n = 0;
    for (const s of packed) n += S.storeUnpack(s).length;
    U.push(ms(t0)); T.push(P[r] + U[r]);
    if (n !== 100000) throw new Error('lost points: ' + n);
  }
  return { pack: med(P), unpack: med(U), total: med(T), best: Math.min(...T) };
}
const SP = {
  [`${hundredK(pen).length} real pen strokes`]: speed(hundredK(pen), false),
  '  the same with pressure': speed(hundredK(penP), true),
  'one 100,000-point stroke': speed([stroke(100000, [500, 500], 1, false)], false),
  '  the same with pressure ': speed([stroke(100000, [500, 500], 1, true)], true),
};
for (const [k, v] of Object.entries(SP))
  console.log(`  100,000 points, ${k.padEnd(27)} pack ${v.pack.toFixed(1)} ms + unpack ${v.unpack.toFixed(1)} ms = ${v.total.toFixed(1)} ms (median of 15; best ${v.best.toFixed(1)} ms)`);
const real = Object.values(SP).slice(0, 2);
ok(real.every(v => v.total < 50), 'pack + unpack of 100,000 real pen points under 50 ms (median): ' + real.map(v => v.total.toFixed(1)).join(' / ') + ' ms');
ok(Object.values(SP).every(v => v.best < 25), 'and at least twice as fast as that at best, for every set (one long stroke too): ' + Object.values(SP).map(v => v.best.toFixed(1)).join(' / ') + ' ms');

// ------------------------------------------------------------------ 5. images without IndexedDB (node): the in-memory fallback
section('5. images, in memory');
(async () => {
  ok(S.STORE_DB === 'nib-board' && S.STORE_IMAGES === 'images', 'database nib-board, object store images');
  const calls = [S.storeImagePut('a', 'data:image/png;base64,AAAA'), S.storeImagePut('b', 'data:image/png;base64,BBBB'), S.storeImagePut(7, 'data:,seven'),
    S.storeImageGet('a'), S.storeImageIds(), S.storeImagesDurable()];
  ok(calls.every(c => c && typeof c.then === 'function'), 'every function returns a Promise');
  const [pa, pb, p7, ga, ids0, dur] = await Promise.all(calls);
  ok(pa === true && pb === true && p7 === true, 'put → true');
  ok(ga === 'data:image/png;base64,AAAA', 'get → the data URL');
  ok(JSON.stringify(ids0) === '["7","a","b"]', 'ids → every id, as strings, sorted: ' + JSON.stringify(ids0));
  ok(dur === false, 'storeImagesDurable() → false without IndexedDB');
  ok(await S.storeImageDelete('b') === true && await S.storeImageGet('b') === null, 'delete → true, then get → null');
  ok(await S.storeImageDelete('never-there') === true, 'deleting an id that is not there → true');
  ok(await S.storeImageGet('nope') === null, 'an unknown id → null');
  const big = 'data:image/png;base64,' + 'QUJD'.repeat(786432);
  ok(await S.storeImagePut('big', big) === true && (await S.storeImageGet('big')).length === big.length, `a ${(big.length / 1e6).toFixed(1)} MB data URL`);
  const order = [S.storeImagePut('o', '1'), S.storeImagePut('o', '2'), S.storeImageGet('o'), S.storeImageDelete('o'), S.storeImageGet('o')];
  const ov = await Promise.all(order);
  ok(ov[2] === '2' && ov[4] === null, 'calls take effect in the order made (put 1, put 2, get → 2, delete, get → null)');
  let threw = 0; const res = [];
  for (const [f, args] of [['storeImagePut', [null, 'x']], ['storeImagePut', ['', 'x']], ['storeImagePut', ['k', 42]], ['storeImagePut', [{}, 'x']], ['storeImagePut', [NaN, 'x']],
    ['storeImageGet', [undefined]], ['storeImageGet', [{}]], ['storeImageDelete', [null]], ['storeImageIds', []], ['storeImagesDurable', []]]) {
    try { res.push(await S[f](...args)); } catch (e) { threw++; }
  }
  ok(threw === 0 && JSON.stringify(res.slice(0, 8)) === '[false,false,false,false,false,null,null,false]', 'bad ids or values resolve false / null, never throw: ' + JSON.stringify(res.slice(0, 8)));

  // ------------------------------------------------------------------ 6. names
  section('6. top-level names');
  const mine = topNames(fs.readFileSync(path.join(SRC, 'store.js'), 'utf8'));
  ok(mine.length > 10 && mine.every(n => /^(store|STORE_)/.test(n)), `every top-level name in store.js starts with store / STORE_ (${mine.length}: ${mine.filter(n => !/^(store|STORE_)/.test(n)).join(' ') || 'all'})`);
  const clash = [];
  for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.js') && f !== 'store.js'))
    for (const n of topNames(fs.readFileSync(path.join(SRC, f), 'utf8'))) if (mine.includes(n)) clash.push(f + ': ' + n);
  ok(!clash.length, 'no other src/ file declares any of them at top level' + (clash.length ? ': ' + clash.join(', ') : ''));

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();

// the top-level names a src/ file declares (lines that start with function / const / let / var / class)
function topNames(src) {
  const out = [];
  for (const line of src.split('\n')) {
    const m = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(line) || /^class\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) { out.push(m[1]); continue; }
    const d = /^(?:const|let|var)\s+/.exec(line);
    if (!d) continue;
    let depth = 0, expect = true;
    for (let i = d[0].length; i < line.length; i++) {
      const c = line[i];
      if (c === '"' || c === "'" || c === '`') { for (i++; i < line.length && line[i] !== c; i++) if (line[i] === '\\') i++; continue; }
      if (c === '/' && line[i + 1] === '/') break;
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ',' && depth === 0) expect = true;
      else if (expect && depth === 0 && /[A-Za-z_$]/.test(c)) { const id = /^[A-Za-z_$][\w$]*/.exec(line.slice(i))[0]; out.push(id); i += id.length - 1; expect = false; }
    }
  }
  return out;
}
