// The board's read (1.7.0), the parts that need no browser:
//   1. clustersOf finds its pairs through a grid; the groups are those of trying every stroke against every other
//      (the 1.6.7 code, kept here as the reference), on boards of every shape: scattered, a page of rows, one column,
//      long strokes among short ones, strokes exactly at the thresholds, dots, far from the origin, with an empty stroke;
//      and tiny writing a billion units out, where the grid once had millions of cells to look through
//   2. joinOperands keeps what it needs of a part with the part: the same joins for the same parts made again, asked
//      twice, and after a part was given another reading
//   3. (1.7.1) a stroke keeps its id only where it stands among the strokes it is read with: ink moved as a whole is
//      not classified again; a stroke moved away from the others, put back, given another shape, or met again
//      beside strokes that moved without it, is — and the reading is the one a recognizer that never saw the ink
//      gives. Sequences of such moves over the school problems, after each one
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

// ------------------------------------------------------------------ 3. moved ink (1.7.1)
{
  const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const copy = st => st.map(s => s.map(p => p.slice()));
  const shift = (s, dx, dy) => { for (const p of s) { p[0] += dx; p[1] += dy; } };
  const fresh = st => new Nib.Recognizer().recognize(st);
  const sees = (rec, st) => { const before = rec.classified || 0, r = rec.recognize(st); return { r, n: (rec.classified || 0) - before }; };
  const line = (x0, y0, x1, y1, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
  const pathOf = pts => pts.flatMap((p, i, a) => (i ? line(a[i - 1][0], a[i - 1][1], p[0], p[1], 6).slice(1) : [p]));
  // "2 + 3", the plus a stem and a bar
  const plus = () => [pathOf([[100, 110], [110, 100], [125, 100], [132, 110], [128, 125], [100, 150], [135, 150]]), line(190, 105, 190, 150, 12), line(168, 128, 212, 128, 12),
    pathOf([[250, 102], [275, 100], [262, 122], [278, 135], [270, 150], [250, 150]])];

  // ink moved as a whole: nothing is classified again, by any amount
  {
    const st = plus(), rec = new Nib.Recognizer(), first = sees(rec, st);
    let again = 0, same = true;
    for (const [dx, dy] of [[0.1, 0.2], [37.5, -12.25], [1e-3, 1e-3], [123456.789, -98765.4321], [-123456.789 - 37.6 - 1e-3, 98765.4321 + 12.05 - 1e-3], [1e7, 1e7], [-1e7, -1e7]]) {
      for (const s of st) shift(s, dx, dy);
      const t = sees(rec, st); again += t.n; if (t.r.latex !== first.r.latex) same = false;
    }
    ok(first.r.latex === '2+3' && first.n > 0 && again === 0 && same, `"2+3" moved as a whole seven times, near and far: classified ${first.n} groups once and ${again} after; reads ${same ? 'the same' : 'ANOTHER'}`);
  }
  // the bar of the plus moved off its stem, and put back
  {
    const st = plus(), rec = new Nib.Recognizer(), bar = st[2];
    const a = sees(rec, st);
    shift(bar, 0, 40); const b = sees(rec, st), fb = fresh(st).latex;
    shift(bar, 0, -40); const c = sees(rec, st), fc = fresh(st).latex;
    shift(bar, 0, -30); const d = sees(rec, st), fd = fresh(st).latex;
    ok(a.r.latex === '2+3' && b.r.latex === fb && fb !== '2+3' && b.n > 0, `the bar of the plus moved 40 down: "${b.r.latex}", as a new recognizer reads it ("${fb}"); ${b.n} groups classified again`);
    ok(c.r.latex === fc && fc === '2+3', `put back: "${c.r.latex}"`);
    ok(d.r.latex === fd && fd !== '2+3', `moved 30 up: "${d.r.latex}" ("${fd}")`);
  }
  // a stroke given another shape in place (its points stretched, a point more)
  {
    const st = plus(), rec = new Nib.Recognizer(); sees(rec, st);
    const bar = st[2]; for (const p of bar) p[1] = 128 + (p[0] - 168) * 0.9;            // the bar tilted steeply
    const a = sees(rec, st), fa = fresh(st).latex;
    st[1].push([190, 151]); const b = sees(rec, st), fb = fresh(st).latex;
    ok(a.r.latex === fa && a.n > 0 && b.r.latex === fb && b.n > 0, `a stroke tilted in place, then one a point longer: classified again (${a.n}, ${b.n} groups), read as new ("${fa}", "${fb}")`);
  }
  // two of the four move together; the same object given twice; strokes met again beside others that moved without them
  {
    const st = plus(), rec = new Nib.Recognizer(); sees(rec, st);
    shift(st[2], 300, 0); shift(st[3], 300, 0);
    const a = sees(rec, st), fa = fresh(st).latex;
    ok(a.r.latex === fa, `two strokes of four moved away together: read as new ("${fa}")`);
    const two = plus(), r2 = new Nib.Recognizer(), ids = r2.prepare([two[0], two[1], two[0]], { smooth: 0, delayed: false }).ids;
    ok(ids.length === 3 && ids[0] === ids[2] && ids[0] !== ids[1], `the same object given twice is one stroke (${ids.join(' ')})`);
    const s3 = plus(), r3 = new Nib.Recognizer(); sees(r3, s3);
    shift(s3[0], 55, 0); shift(s3[1], 55, 0);                 // the 2 and the stem move; read without the others
    const part = sees(r3, [s3[0], s3[1]]);
    const whole = sees(r3, s3), fw = fresh(s3).latex;         // then with the bar and the 3, which did not move
    ok(part.n === 0 && whole.r.latex === fw && whole.n > 0, `two strokes moved and read alone (nothing classified), then read with the two that stayed: "${whole.r.latex}", as new ("${fw}")`);
  }
  // small writing far from the origin, and ink beside a stroke that is far away: a move of less than a unit is seen
  // (the tolerance goes by the floating-point grid where the strokes are, not by a share of the coordinates)
  {
    const small = (k, at) => plus().map(s => s.map(p => [p[0] * k + at, p[1] * k + at]));
    const out = [];
    for (const [k, at] of [[0.02, 9e8], [0.05, 9e8], [0.02, -9e8], [1, 0]]) {
      const st = small(k, at), rec = new Nib.Recognizer(), a = sees(rec, st);
      shift(st[2], 0, 40 * k);                                 // the bar dropped 0.8 of the stem's height: 0.8 of a unit at 0.02
      const b = sees(rec, st);
      out.push(a.r.latex === '2+3' && b.r.latex === fresh(st).latex && b.r.latex !== '2+3' && b.n > 0);
    }
    ok(out.every(Boolean), `"2+3" a fiftieth and a twentieth of its size, 900 million units out: the bar moved 0.8 of a unit and 2 is seen (${out.map(o => (o ? 'yes' : 'NO')).join(', ')})`);
    const st = plus().concat([line(1e9 - 50, 1e9 - 50, 1e9 - 20, 1e9 - 50, 6)]), rec = new Nib.Recognizer(); sees(rec, st);
    const before = rec.prepare(st, { smooth: 0, delayed: false }).ids.slice();
    shift(st[2], 0, 3.5);
    const after = rec.prepare(st, { smooth: 0, delayed: false }).ids;
    ok(before[2] !== after[2] && [0, 1, 3, 4].every(i => before[i] === after[i]), `a stroke a billion units away in the same writing: the bar moved 3.5 units still gets a new id (${before.join(' ')} → ${after.join(' ')})`);
  }
  // the same points in another order, in place: another stroke (its box, its ends, its points' sums are the same)
  {
    const zig = [[0, 0], [0, 30], [30, 0], [30, 30]].flatMap((p, i, a) => (i ? line(a[i - 1][0], a[i - 1][1], p[0], p[1], 5).slice(1) : [p]));
    const st = [zig], rec = new Nib.Recognizer(), a = sees(rec, st), n = zig.length;
    const mid = zig.slice(1, n - 1).reverse(); for (let i = 1; i < n - 1; i++) zig[i] = mid[i - 1];       // its inner points turned round
    const b = sees(rec, st), fb = fresh(st).latex;
    const loop = Array.from({ length: 25 }, (_, i) => [50 + 20 * Math.cos(i * Math.PI / 12), 50 + 26 * Math.sin(i * Math.PI / 12)]);
    const r2 = new Nib.Recognizer(), one = r2.prepare([loop], { smooth: 0, delayed: false }).ids[0];
    loop.reverse();                                           // a closed stroke drawn the other way: the same first and last point
    const two = r2.prepare([loop], { smooth: 0, delayed: false }).ids[0];
    ok(b.n > 0 && b.r.latex === fb && one !== two, `a stroke's inner points turned round in place ("${a.r.latex}" → "${b.r.latex}", as new "${fb}"), a closed stroke turned the other way: new ids`);
  }
  // a few neighbouring points of a stroke shifted against each other, at every place along it: another shape
  // (weights that rose evenly with the point's place let "one up, two down, one up" through)
  {
    const make = () => Array.from({ length: 200 }, (_, k) => [100 + 30 * Math.cos(k / 9) + k * 0.05, 100 + 40 * Math.sin(k / 7)]);
    const O = { smooth: 0, delayed: false }, missed = [];
    for (const pat of [[1, -2, 1], [1, -1, -1, 1], [1, -3, 3, -1], [1, -1], [1, 0, -1], [2, -1, -1], [1, -1, 0, -1, 1]]) {
      let miss = 0;
      for (let k = 1; k + pat.length < 200; k++) {
        const s = make(), rec = new Nib.Recognizer(), a = rec.prepare([s], O).ids[0];
        pat.forEach((c, j) => { s[k + j][1] += 2 * c; });
        if (rec.prepare([s], O).ids[0] === a) miss++;
      }
      if (miss) missed.push(`[${pat}] ${miss} times`);
    }
    ok(missed.length === 0, `a bend of 2 units over two to five neighbouring points, at each of 190 places along a stroke, in seven patterns: seen every time${missed.length ? ' — NOT: ' + missed.join('; ') : ''}`);
  }
  // a piece read far away and dragged home, then written beside (a new stroke first in what is read): the same ids
  // read after read, nothing classified again
  {
    const O = { smooth: 0, delayed: false }, out = [];
    for (const B of [2 ** 29, 2 ** 26, 2 ** 20, 1e7, 9e8]) {
      const rec = new Nib.Recognizer(), X = B - 60.123456789, A = line(X, X, X + 30.3, X + 40.7, 20);
      rec.prepare([A], O);
      const was = A.map(p => p.slice()), d = 100.37 - X; for (let i = 0; i < A.length; i++) { A[i][0] = was[i][0] + d; A[i][1] = was[i][1] + d; }
      rec.prepare([A], O);
      const mk = x => line(x + 0.1111, 101.3 + x / 1000, x + 10.7, 141.9, 20), inp = [mk(140.11), A, mk(160.29), mk(181.53), mk(203.77), mk(222.913)];
      const first = rec.prepare(inp, O).ids.join(' ');
      let same = true; for (let k = 0; k < 4; k++) if (rec.prepare(inp, O).ids.join(' ') !== first) same = false;
      rec.recognize(inp); const c = rec.classified || 0; rec.recognize(inp); rec.recognize(inp);
      out.push(same && (rec.classified || 0) === c);
    }
    ok(out.every(Boolean), `a stroke read up to 900 million units away, dragged home, and five new strokes read with it, a new one first: the same ids and nothing classified on later reads (${out.map(o => (o ? 'yes' : 'NO')).join(', ')})`);
  }
  // ordinary moves of all the ink keep every id: drags from a kept copy, long runs of arrow-key nudges, tiny and
  // huge amounts, near the origin and far from it, short strokes and long
  {
    const O = { smooth: 0, delayed: false }, lost = [];
    for (const at of [0, 1e5, 1e6, 9e8]) for (const pts of [100, 5000]) {
      const mk = (x, y) => Array.from({ length: pts }, (_, k) => [at + x + 30 * Math.cos(k / 9) + k * 0.004, at + y + 40 * Math.sin(k / 7)]);
      const st = [mk(0, 0), mk(60, 5), mk(130, -3), mk(190, 11)], rec = new Nib.Recognizer(), ids = rec.prepare(st, O).ids.join(' ');
      const same = what => { if (rec.prepare(st, O).ids.join(' ') !== ids) lost.push(`${what} at ${at}, ${pts} points`); };
      for (let k = 0; k < 20; k++) { const was = st.map(s => s.map(p => p.slice())), dx = (k * 37.3) % 211 - 100, dy = (k * 17.9) % 97 - 50; st.forEach((s, i) => s.forEach((p, j) => { p[0] = was[i][j][0] + dx; p[1] = was[i][j][1] + dy; })); same('a drag'); }
      for (let k = 0; k < 500; k++) for (const s of st) for (const p of s) { p[0] += 0.3; p[1] -= 1 / 3; }
      same('500 nudges');
      for (const s of st) for (const p of s) { p[0] += 1e-7; p[1] += 1e-7; }
      same('a move of a ten-millionth');
    }
    ok(lost.length === 0, `all of the ink dragged twenty times, nudged 500 times and moved by a ten-millionth, at 0, 1e5, 1e6 and 9e8, strokes of 100 and of 5,000 points: every id kept${lost.length ? ' — LOST after ' + lost.slice(0, 4).join('; ') : ''}`);
  }
  // a stroke read in turn with two sets of strokes that moved differently: classified again each time, never stale
  {
    const st = plus().concat([line(300, 105, 300, 150, 12)]), rec = new Nib.Recognizer(); sees(rec, st);
    shift(st[3], 5, 0); shift(st[4], 5, 0);                   // the 3 and the 1 after it, 5 to the right
    const P = [st[0], st[1], st[2]], Q = [st[2], st[3], st[4]];
    let stale = 0, again = 0;
    for (let k = 0; k < 4; k++) for (const X of [P, Q]) { const t = sees(rec, X); again += t.n; if (t.r.latex !== fresh(X).latex) stale++; }
    ok(stale === 0, `two sets of strokes with one stroke in both, one set moved, read in turn four times: never the old reading (${again} groups classified along the way)`);
  }
  // ink carried ten million units away and back between two reads: its points come back a rounding apart, and it is
  // read all the same
  {
    const st = plus(), rec = new Nib.Recognizer(), a = sees(rec, st);
    for (const s of st) shift(s, 1e7, -1e7); for (const s of st) shift(s, -1e7, 1e7);
    const b = sees(rec, st);
    ok(a.r.latex === '2+3' && b.r.latex === '2+3' && b.r.latex === fresh(st).latex, `ink carried ten million units away and back between two reads: "${b.r.latex}" (${b.n} groups classified again)`);
  }
  // sequences of moves over the school problems: after each, the reading a new recognizer gives
  {
    let seed = 20261115; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    let steps = 0, wrong = 0, rigid = 0, rigidAgain = 0; const bad = [];
    for (let k = 0; k < 60; k++) {
      const row = rows[(k * 11 + 3) % rows.length], st = copy(row.strokes), rec = new Nib.Recognizer(), saved = [];
      rec.recognize(st);
      for (let m = 0; m < 6; m++) {
        const kind = rnd(), H = 40;
        let n = null;
        if (kind < 0.3) { const dx = (rnd() - 0.5) * 400, dy = (rnd() - 0.5) * 200; for (const s of st) shift(s, dx, dy); n = sees(rec, st); rigid++; rigidAgain += n.n; }       // all of it
        else if (kind < 0.6) { const i = Math.floor(rnd() * st.length); saved.push([i, copy([st[i]])[0]]); shift(st[i], (rnd() - 0.5) * 2 * H, (rnd() - 0.5) * 2 * H); }              // one stroke
        else if (kind < 0.8) { const a = Math.floor(rnd() * st.length), dx = (rnd() - 0.5) * 3 * H, dy = (rnd() - 0.5) * H; for (let i = a; i < st.length; i++) shift(st[i], dx, dy); }   // the strokes from one on
        else if (saved.length) { const [i, was] = saved.pop(); st[i].length = 0; for (const p of was) st[i].push(p.slice()); }                                                         // Undo: its points put back
        else continue;
        if (!n) n = sees(rec, st);
        steps++;
        const f = fresh(st);
        if (n.r.latex !== f.latex || n.r.symbols.map(s => s.label + s.strokes).join() !== f.symbols.map(s => s.label + s.strokes).join()) { wrong++; if (bad.length < 4) bad.push(`${row.id} step ${m}: "${n.r.latex}" for "${f.latex}"`); }
      }
    }
    ok(wrong === 0 && steps > 200, `${steps} moves over 60 school problems (all of it, one stroke, the strokes from one on, a move undone): the reading a new recognizer gives after each (${wrong} wrong${bad.length ? ': ' + bad.join(' ; ') : ''})`);
    ok(rigid > 40 && rigidAgain === 0, `of them ${rigid} moved all of the ink: ${rigidAgain} groups classified again`);
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
