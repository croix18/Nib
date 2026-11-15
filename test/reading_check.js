// The board's read (1.7.0), the parts that need no browser:
//   1. clustersOf finds its pairs through a grid; the groups are those of trying every stroke against every other
//      (the 1.6.7 code, kept here as the reference), on boards of every shape: scattered, a page of rows, one column,
//      long strokes among short ones, strokes exactly at the thresholds, dots, far from the origin, with an empty stroke;
//      and tiny writing a billion units out, where the grid once had millions of cells to look through
//   2. joinOperands keeps what it needs of a part with the part: the same joins for the same parts made again, asked
//      twice, and after a part was given another reading
//   node test/reading_check.js
'use strict';
const fs = require('fs'), path = require('path');
const Nib = require(path.join(__dirname, '..', 'dist', 'nib.js'));
const I = Nib._internals;
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (c) passes++; else fails++; };

// ------------------------------------------------------------------ 1. clustersOf
// the reference: every pair (Nib 1.6.7, src/pad.js)
function clustersAllPairs(strokes) {
  const { sbox, refSize } = I, ubox = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
  const n = strokes.length;
  if (!n) return [];
  const boxes = strokes.map(sbox), ref = refSize(strokes);
  const up = Array.from({ length: n }, (_, i) => i);
  const find = i => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = boxes[i], b = boxes[j];
    const gx = Math.max(0, b[0] - a[2], a[0] - b[2]), gy = Math.max(0, b[1] - a[3], a[1] - b[3]);
    if ((gx <= 1.5 * ref && gy <= 0.6 * ref) || (gx <= 0.3 * ref && gy <= 1.6 * ref)) { const ri = find(i), rj = find(j); if (ri !== rj) up[Math.max(ri, rj)] = Math.min(ri, rj); }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  const list = [...groups.values()].map(g => { let b = boxes[g[0]]; for (const i of g) b = ubox(b, boxes[i]); return { g, b }; });
  list.sort((p, q) => p.b[1] - q.b[1]);
  const rows = [];
  for (const it of list) {
    const row = rows.find(r => it.b[1] < r.y1 && it.b[3] > r.y0);
    if (row) { row.items.push(it); row.y0 = Math.min(row.y0, it.b[1]); row.y1 = Math.max(row.y1, it.b[3]); }
    else rows.push({ y0: it.b[1], y1: it.b[3], items: [it] });
  }
  return [].concat(...rows.map(r => r.items.sort((p, q) => p.b[0] - q.b[0]).map(it => it.g)));
}
let seed = 20261114;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const KINDS = ['scattered', 'a page of rows', 'one column', 'long strokes among short ones', 'at the thresholds', 'dots and tiny marks'];
function board(n, kind) {
  const st = [], scale = [1, 30, 0.001, 1e5][Math.floor(rnd() * 4)], off = [0, 1e6, -3e8, 9e8][Math.floor(rnd() * 4)];
  for (let i = 0; i < n; i++) {
    let x, y, w, h;
    if (kind === 0) { x = rnd() * 4000; y = rnd() * 3000; w = rnd() * 40; h = rnd() * 50; }
    else if (kind === 1) { const c = Math.floor(rnd() * 5), r = Math.floor(rnd() * 40); x = c * 800 + rnd() * 300; y = r * 120 + rnd() * 40; w = 5 + rnd() * 30; h = 5 + rnd() * 40; }
    else if (kind === 2) { x = rnd() * 300; y = rnd() * 30000; w = rnd() * 30; h = rnd() * 40; }
    else if (kind === 3) { x = rnd() * 3000; y = rnd() * 2000; w = rnd() < 0.05 ? 2500 * rnd() : rnd() * 30; h = rnd() < 0.05 ? 1800 * rnd() : rnd() * 30; }
    else if (kind === 4) { x = Math.floor(rnd() * 60) * 45; y = Math.floor(rnd() * 40) * 48; w = 30; h = 30; }
    else { x = rnd() * 500; y = rnd() * 400; w = rnd() < 0.5 ? 0 : rnd() * 3; h = rnd() < 0.5 ? 0 : rnd() * 3; }
    st.push([[x, y], [x + w, y + h * rnd()], [x + w * rnd(), y + h]].map(p => [p[0] * scale + off, p[1] * scale + off]));
  }
  return st;
}
{
  const bad = KINDS.map(() => 0), seen = KINDS.map(() => 0);
  let groups = 0;
  for (let t = 0; t < 900; t++) {
    const n = [1, 2, 40, 63, 64, 65, 120, 300, 700][Math.floor(rnd() * 9)], kind = t % 6, st = board(n, kind);
    if (t % 97 === 0 && n > 3) st[2] = [];
    const a = clustersAllPairs(st), b = I.clustersOf(st);
    seen[kind]++; groups += a.length;
    if (JSON.stringify(a) !== JSON.stringify(b)) bad[kind]++;
  }
  KINDS.forEach((k, i) => ok(bad[i] === 0, `clustersOf, ${k}: the groups of every pair tried, on ${seen[i]} boards (${bad[i]} differ)`));
  ok(groups > 20000, `(${groups} groups in all)`);
  const st = board(1200, 1);
  let t0 = Date.now(); for (let i = 0; i < 5; i++) clustersAllPairs(st); const slow = (Date.now() - t0) / 5;
  t0 = Date.now(); for (let i = 0; i < 5; i++) I.clustersOf(st); const fast = (Date.now() - t0) / 5;
  ok(fast < slow, `a page of 1,200 strokes: ${fast.toFixed(1)} ms (every pair: ${slow.toFixed(1)} ms)`);
  // writing a ten-thousandth of a unit tall, a billion units from the origin: the grid's cells are never finer than
  // the rounding it allows for (they were, once: millions of cells looked through for every stroke, half a minute)
  let same = true, worst = 0;
  for (const size of [1e-2, 1e-4, 1e-5]) {
    const far = [];
    for (let i = 0; i < 80; i++) { const x = 1e9 - 50 + (i % 10) * size * 3, y = -1e9 + 50 + Math.floor(i / 10) * size * 4; far.push([[x, y], [x + size * rnd(), y + size]]); }
    const t = Date.now(), b = I.clustersOf(far); worst = Math.max(worst, Date.now() - t);
    if (JSON.stringify(clustersAllPairs(far)) !== JSON.stringify(b)) same = false;
  }
  ok(same && worst < 2000, `tiny writing a billion units out: the same groups, at once (${worst} ms at most)`);
}

// ------------------------------------------------------------------ 2. joinOperands
{
  const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  // a line of pieces: each expression cut after its first + − × ÷ = and the right part pushed away
  const OPS = new Set(['+', '-', '\\times', '\\div', '=', '\\cdot']);
  const strokes = [];
  let x = 0, used = 0;
  for (const r of rows) {
    if (used >= 6) break;
    const k = r.symbols.findIndex((sy, i) => i > 0 && i < r.symbols.length - 1 && OPS.has(sy.label));
    if (k < 0 || r.symbols.length > 7 || /frac|sqrt|\^|_|\\\\/.test(r.latex)) continue;
    const xs = r.strokes.flat().map(p => p[0]), x0 = Math.min(...xs), w = Math.max(...xs) - x0;
    const right = new Set([].concat(...r.symbols.slice(k + 1).map(sy => sy.strokes)));
    r.strokes.forEach((s, i) => strokes.push(s.map(p => [p[0] - x0 + x + (right.has(i) ? 90 : 0), p[1]])));
    x += w + 90 + 700; used++;
  }
  const read = groups => groups.map(g => { const st = g.map(i => strokes[i]); return { idx: g, strokes: st, result: new Nib.Recognizer().recognize(st, { times: false }) }; });
  let parts = read(I.clustersOf(strokes));
  const first = parts.length;
  let joins = 0, same = true;
  for (let round = 0; round < 8; round++) {
    const j = I.joinOperands(parts);
    const again = I.joinOperands(parts), fresh = I.joinOperands(parts.map(p => ({ idx: p.idx, strokes: p.strokes, result: p.result })));
    if (JSON.stringify(j) !== JSON.stringify(again) || JSON.stringify(j) !== JSON.stringify(fresh)) same = false;
    if (!j) break;
    joins++;
    // as the pad does it: a group nothing joined keeps its part
    const by = new Map(parts.map(p => [p.idx, p]));
    parts = j.map(g => by.get(g) || read([g])[0]);
  }
  ok(used === 6 && first > 6, `six expressions written with a gap after a sign: ${first} pieces`);
  ok(joins >= 4, `joinOperands puts them together (${joins} joins, ${parts.length} pieces left)`);
  ok(same, 'the same joins asked twice, and for the same parts made again');
  // a part given another reading (a caller's own object): what was kept for it is not used
  if (parts.length >= 2) {
    const p = parts.map(q => ({ idx: q.idx, strokes: q.strokes, result: q.result }));
    const before = JSON.stringify(I.joinOperands(p));
    const k = p.findIndex(q => q.result.lines.length === 1);
    p[k].result = Object.assign({}, p[k].result, { lines: [Object.assign({}, p[k].result.lines[0], { latex: '7+' })] });
    const after = JSON.stringify(I.joinOperands(p)), fresh = JSON.stringify(I.joinOperands(p.map(q => ({ idx: q.idx, strokes: q.strokes, result: q.result }))));
    ok(after === fresh, `a part given another reading is looked at again (${before === after ? 'the joins stay' : 'the joins change'})`);
  } else ok(false, 'two pieces left to try');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
