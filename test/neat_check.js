// In-place views (tidy, my handwriting, typeset) without a browser: every symbol accounted for, lines level, the
// tidied ink reads back the same, nothing overlaps that should not, odd input never throws.
//   node test/neat_check.js [--full]
'use strict';
const fs = require('fs'), path = require('path');
const Nib = require(process.env.NIB || path.join(__dirname, '..', 'dist', 'nib.js'));
const I = Nib._internals;
const FULL = process.argv.includes('--full');
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  FAIL', m); } };
const section = n => console.log(n);
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const sample = FULL ? rows : rows.filter((r, i) => i % 7 === 0);
const tokens = res => [].concat(...res.lines.map((l, i) => (i ? ['\\\\'] : []).concat(l.tokens)));
const same = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);

// a hand built from the 2019 test writers' symbols, placed on the Replicator's guides (as test/neat_view.js does)
const { need } = require('./data');
function makeHand() {
  const t = fs.readFileSync(need('test.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const pool = {};
  for (const r of t) for (const s of r.symbols) (pool[s.label] = pool[s.label] || []).push(s.strokes.map(k => r.strokes[k]));
  const G = { cap: 0.2, x: 0.376, base: 0.76, desc: 0.944 };
  const L = { '×': '\\times', '÷': '\\div', '±': '\\pm', '≠': '\\neq', '≤': '\\leq', '≥': '\\geq', 'π': '\\pi', 'θ': '\\theta', '√': '\\sqrt', '∞': '\\infty' };
  const glyphs = {};
  for (const ch of '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-=()<>/.,%$|[]'.split('').concat(Object.keys(L))) {
    const list = pool[L[ch] || ch]; if (!list) continue;
    const st = list[Math.min(1, list.length - 1)];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    let top = G.cap, bot = G.base;
    if (/[a-z]/.test(ch) && !/[bdfhklt]/.test(ch)) top = G.x;
    if (/[gjpqy]/.test(ch)) { top = G.x; bot = G.desc; }
    if ('.,'.includes(ch)) { top = G.base - 0.05; bot = G.base + (ch === ',' ? 0.08 : 0); }
    if ('-+=×÷<>≤≥≠±'.includes(ch)) { top = G.x - 0.03; bot = G.base - 0.1; }
    if ('()[]|/'.includes(ch)) { top = G.cap - 0.04; bot = G.base + 0.15; }
    if (ch === '√') { top = G.cap - 0.05; bot = G.base + 0.05; }
    const k = Math.min((bot - top) / Math.max(y1 - y0, 1e-9), 0.8 / Math.max(x1 - x0, 1e-9));
    glyphs[ch] = st.map(s => s.map(p => [0.1 + (p[0] - x0) * k, top + (p[1] - y0) * k]));
  }
  return { name: 'Test hand', glyphs };
}
const hand = makeHand();

// ------------------------------------------------------------------ 1. the API
section('1. API');
for (const f of ['neaten', 'typeset']) ok(typeof Nib[f] === 'function', 'Nib.' + f);
ok(Nib.hand && typeof Nib.hand.load === 'function' && typeof Nib.hand.clear === 'function' && 'size' in Nib.hand, 'Nib.hand');
const r0 = rows[3], t0 = Nib.neaten(r0.strokes);
for (const k of ['style', 'latex', 'result', 'em', 'skew', 'items', 'strokes']) ok(k in t0, 'neaten result has ' + k);
ok(t0.items.every(it => it.key && Array.isArray(it.src) && Array.isArray(it.parts) && it.box.length === 4), 'items carry key, source strokes, parts and box');

// ------------------------------------------------------------------ 2. every symbol accounted for, nothing invented
section('2. every symbol accounted for');
let lost = 0, dup = 0;
for (const r of sample) for (const style of ['tidy', 'hand', 'typeset']) {
  const res = Nib.recognize(r.strokes);
  const o = style === 'typeset' ? Nib.typeset(r.strokes, { result: res }) : Nib.neaten(r.strokes, { result: res, style, hand });
  const seen = new Map();
  for (const it of o.items) for (const k of it.src) seen.set(k, (seen.get(k) || 0) + 1);
  for (const s of res.symbols) for (const k of s.strokes) if (!seen.has(k)) lost++;
  for (const v of seen.values()) if (v > 1) dup++;
}
ok(lost === 0, `every stroke of the reading is drawn (${lost} lost)`);
ok(dup === 0, `no stroke is drawn twice (${dup} doubled)`);

// ------------------------------------------------------------------ 3. the tidied ink reads back the same
section('3. tidy and hand read back');
let back = 0, backN = 0, backHand = 0, backHandN = 0;
const misses = [];
for (const r of sample) {
  const res = Nib.recognize(r.strokes), want = tokens(res);
  const t = Nib.neaten(r.strokes, { result: res });
  const again = new Nib.Recognizer().recognize(t.strokes);
  backN++; if (same(tokens(again), want)) back++; else if (misses.length < 6) misses.push(`${r.id}: ${res.latex}  ->  ${again.latex}`);
  const h = Nib.neaten(r.strokes, { result: res, style: 'hand', hand });
  const againH = new Nib.Recognizer().recognize(h.strokes);
  backHandN++; if (same(tokens(againH), want)) backHand++;
}
console.log(`  tidy reads back the same: ${back} of ${backN}; my handwriting: ${backHand} of ${backHandN}`);
if (misses.length) console.log('   ' + misses.join('\n   '));
ok(back / backN >= 0.9, 'tidy ink reads back as the same maths (90%+)');

// ------------------------------------------------------------------ 4. geometry: level lines, glyphs on the baseline, no collisions
section('4. geometry');
let notLevel = 0, overlaps = 0, offSize = 0, far = 0, checked = 0;
for (const r of sample) {
  const res = Nib.recognize(r.strokes);
  for (const style of ['tidy', 'typeset']) {
    const o = style === 'typeset' ? Nib.typeset(r.strokes, { result: res }) : Nib.neaten(r.strokes, { result: res });
    const top = new Map(res.tree.flatMap((row, li) => row.filter(u => u.k === 's').map(u => [u.strokes.join(','), li])));
    // digits on the same written line share one baseline
    const byLine = new Map();
    for (const it of o.items) {
      const li = top.get(it.src.join(','));
      if (li === undefined || !/^[0-9]$/.test(it.label)) continue;
      (byLine.get(li) || byLine.set(li, []).get(li)).push(it.box[3]);
    }
    for (const ys of byLine.values()) if (Math.max(...ys) - Math.min(...ys) > 0.02 * o.em) notLevel++;
    // neighbours on a line do not overlap
    const tops = o.items.filter(it => top.has(it.src.join(','))).sort((a, b) => a.box[0] - b.box[0]);
    for (let i = 1; i < tops.length; i++) {
      const a = tops[i - 1], b = tops[i];
      if (top.get(a.src.join(',')) !== top.get(b.src.join(','))) continue;
      if (b.box[0] < a.box[2] - 0.02 * o.em && Math.min(a.box[3], b.box[3]) > Math.max(a.box[1], b.box[1])) overlaps++;
    }
    // the result stays where it was written: its middle within a few em of the ink's
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of o.items) { x0 = Math.min(x0, it.box[0]); y0 = Math.min(y0, it.box[1]); x1 = Math.max(x1, it.box[2]); y1 = Math.max(y1, it.box[3]); }
    let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
    for (const s of r.strokes) for (const p of s) { a0 = Math.min(a0, p[0]); b0 = Math.min(b0, p[1]); a1 = Math.max(a1, p[0]); b1 = Math.max(b1, p[1]); }
    if (Math.abs((x0 + x1) / 2 - (a0 + a1) / 2) > 1.5 * o.em || Math.abs((y0 + y1) / 2 - (b0 + b1) / 2) > 1.0 * o.em) far++;
    if ((x1 - x0) > 1.35 * (a1 - a0) + 0.5 * o.em) offSize++;
    checked++;
  }
}
ok(notLevel === 0, `digits on a line share one baseline (${notLevel} lines off)`);
ok(overlaps === 0, `neighbouring symbols do not overlap (${overlaps} overlaps)`);
ok(far === 0, `the result stays where it was written (${far} of ${checked} moved)`);
ok(offSize === 0, `the result is about as wide as the writing (${offSize} of ${checked} much wider)`);

// ------------------------------------------------------------------ 5. slanted writing comes out level
section('5. slanted writing');
let slantOk = 0, slantN = 0;
for (const r of sample.slice(0, 30)) {
  const a = 8 * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  const turned = r.strokes.map(st => st.map(p => [p[0] * c - p[1] * sn, p[0] * sn + p[1] * c]));
  const res = Nib.recognize(turned);
  if (!res.skew) continue;
  const o = Nib.neaten(turned, { result: res });
  const digits = o.items.filter(it => /^[0-9]$/.test(it.label) && res.tree[0].some(u => u.k === 's' && u.strokes.join(',') === it.src.join(',')));
  if (digits.length < 2) continue;
  slantN++;
  const ys = digits.map(it => it.box[3]);
  if (Math.max(...ys) - Math.min(...ys) < 0.02 * o.em) slantOk++;
}
ok(slantN > 10 && slantOk === slantN, `lines written at 8 degrees come out level (${slantOk} of ${slantN})`);

// ------------------------------------------------------------------ 6. equals signs one under another stay aligned
section('6. aligned equals signs');
let aligned = 0, alignN = 0;
for (const r of rows.filter(x => x.cat === 'multi').slice(0, FULL ? 75 : 25)) {
  const res = Nib.recognize(r.strokes);
  if (res.lines.length < 2) continue;
  const o = Nib.neaten(r.strokes, { result: res });
  const rel = [];
  res.tree.forEach(row => { const rs = row.filter(u => u.k === 's' && /^(=|<|>|\\le|\\ge|\\ne)$/.test(u.label)); if (rs.length === 1) rel.push(rs[0]); });
  if (rel.length < 2) continue;
  const raw = rel.map(u => { let x0 = Infinity, x1 = -Infinity; for (const k of u.strokes) for (const p of r.strokes[k]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); } return (x0 + x1) / 2; });
  const spread = Math.max(...raw) - Math.min(...raw);
  if (spread > 0.8 * o.em) continue;            // the writer did not line them up
  alignN++;
  const placed = rel.map(u => { const it = o.items.find(i => i.src.join(',') === u.strokes.join(',')); return (it.box[0] + it.box[2]) / 2; });
  if (Math.max(...placed) - Math.min(...placed) < 0.02 * o.em) aligned++;
}
ok(alignN === 0 || aligned === alignN, `equals signs written one under another come out exactly aligned (${aligned} of ${alignN})`);

// ------------------------------------------------------------------ 7. odd input
section('7. odd input');
const quiet = (name, f) => { try { const v = f(); ok(true, name); return v; } catch (e) { ok(false, name + ' threw ' + e.message); return null; } };
for (const style of ['tidy', 'hand', 'typeset']) {
  const run = (x, o) => (style === 'typeset' ? Nib.typeset(x, o) : Nib.neaten(x, Object.assign({ style, hand }, o)));
  const e = quiet(style + ': nothing', () => run([]));
  ok(e && e.items.length === 0 && e.strokes.length === 0, style + ': nothing in, nothing out');
  quiet(style + ': undefined', () => run(undefined));
  quiet(style + ': one dot', () => run([[[5, 5]]]));
  quiet(style + ': junk points', () => run([[[NaN, 1], [2, 'x']], null, [[1, 1], [3, 4]]]));
  quiet(style + ': {x, y} points', () => run([{ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }, [{ x: 10, y: 0 }, { x: 0, y: 10 }]]));
  quiet(style + ': a huge stroke', () => run([Array.from({ length: 5000 }, (_, i) => [i * 0.5, 50 + 40 * Math.sin(i / 30)])]));
  const many = quiet(style + ': 200 random strokes', () => {
    let seed = 9; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const st = Array.from({ length: 200 }, () => { const x = rnd() * 900, y = rnd() * 400; return Array.from({ length: 12 }, (_, i) => [x + i * 3, y + 10 * Math.sin(i + x)]); });
    return run(st);
  });
  ok(many && many.items.every(it => it.parts.every(p => p.t !== 'ink' || p.paths.every(s => s.every(q => isFinite(q[0]) && isFinite(q[1]))))), style + ': every coordinate is a number');
  quiet(style + ': a result passed in', () => run(rows[1].strokes, { result: Nib.recognize(rows[1].strokes) }));
  quiet(style + ': far from the origin, tiny', () => run(rows[1].strokes.map(s => s.map(p => [p[0] * 0.001 + 1e6, p[1] * 0.001 - 5e5]))));
}
// my handwriting: missing characters fall back to tidy strokes; a hand without anything usable is refused
const partial = { glyphs: { '2': hand.glyphs['2'] } };
const ph = Nib.neaten(rows[1].strokes, { style: 'hand', hand: partial });
ok(ph.items.length > 0 && ph.strokes.length > 0, 'a hand missing most characters still draws everything (tidy stand-ins)');
let refused = false; try { Nib.hand.load({ glyphs: { a: 'nope' } }); } catch (e) { refused = true; }
ok(refused, 'a hand without usable strokes is refused');
refused = false; try { Nib.hand.load('not json'); } catch (e) { refused = true; }
ok(refused, 'text that is not JSON is refused');
ok(Nib.hand.load(JSON.stringify(hand)) > 50, 'a Replicator file (as JSON text) loads');
ok(Nib.hand.size > 50 && Nib.hand.has('7') && Nib.hand.has('\\times') && !Nib.hand.has('\\sum'), 'the loaded hand answers size and has()');
Nib.hand.clear();
ok(Nib.hand.size === 0, 'clear() forgets it');
// which handwriting a browser holds: a file opened in Nib, or the Replicator's own work there — the newest wins
{
  const store = new Map();
  global.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const again = () => { Nib._internals.HAND.loaded = false; return Nib.hand.name; };
  const g7 = { 7: hand.glyphs['7'] }, g2 = { 2: hand.glyphs['2'], 3: hand.glyphs['3'] };
  store.set('replicator-v1', JSON.stringify({ name: 'From Replicator', glyphs: g2 }));
  ok(again() === 'From Replicator' && Nib.hand.size === 2, 'the Replicator\'s work in this browser is found');
  store.set('nib-hand-v1', JSON.stringify({ name: 'Opened file', glyphs: g7 }));
  ok(again() === 'Opened file', 'with neither dated, a file opened in Nib comes first (as before)');
  store.set('replicator-v1', JSON.stringify({ name: 'From Replicator', saved: Date.now() - 1000, glyphs: g2 }));
  ok(again() === 'From Replicator', 'letters redone in the Replicator later win over an older file');
  Nib.hand.load({ name: 'Newer file', glyphs: g7 });
  ok(again() === 'Newer file' && JSON.parse(store.get('nib-hand-v1')).saved > 0, 'a file opened afterwards wins again (and is dated)');
  store.set('nib-hand-v1', '{broken');
  ok(again() === 'From Replicator', 'damaged saved data falls back to the other');
  store.set('replicator-v1', JSON.stringify({ name: 'Empty', saved: Date.now() + 9000, glyphs: { a: 'nope' } }));
  store.set('nib-hand-v1', JSON.stringify({ name: 'Opened file', glyphs: g7 }));
  ok(again() === 'Opened file', 'newer but unusable handwriting is passed over');
  store.clear();
  ok(again() === '' && Nib.hand.size === 0, 'nothing saved: no handwriting');
  // letters also written in sentences: the Replicator keeps their average beside the box drawings (avg)
  const avg2 = hand.glyphs['7'], box2 = hand.glyphs['2'];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  store.set('replicator-v1', JSON.stringify({ name: 'Sentences', saved: Date.now(), glyphs: g2, avg: { 2: avg2 } }));
  again();
  ok(same(Nib._internals.HAND.glyphs['2'], avg2) && same(Nib._internals.HAND.glyphs['3'], hand.glyphs['3']), 'a letter written in sentences is drawn as its average, the rest as their boxes');
  store.set('replicator-v1', JSON.stringify({ name: 'Sentences off', saved: Date.now(), glyphs: g2, avg: { 2: avg2 }, useSamples: false }));
  again();
  ok(same(Nib._internals.HAND.glyphs['2'], box2), 'with sentences turned off in the Replicator, the box drawing');
  store.set('replicator-v1', JSON.stringify({ name: 'Junk avg', saved: Date.now(), glyphs: g2, avg: { 2: 'nope', 3: [[['x']]] } }));
  again();
  ok(same(Nib._internals.HAND.glyphs['2'], box2) && same(Nib._internals.HAND.glyphs['3'], hand.glyphs['3']), 'a damaged average is passed over');
  store.set('replicator-v1', JSON.stringify({ name: 'Array avg', saved: Date.now(), glyphs: g2, avg: [avg2] }));
  ok(again() === 'Array avg' && Nib.hand.size === 2, 'an average that is not a map is ignored');
  Nib.hand.load({ name: 'Opened with avg', glyphs: g2, avg: { 2: avg2 } });
  ok(same(Nib._internals.HAND.glyphs['2'], avg2) && same(JSON.parse(store.get('nib-hand-v1')).glyphs['2'], avg2), 'a saved Replicator file opened in Nib uses the averages too');
  const viaOption = Nib.neaten(rows[1].strokes, { style: 'hand', hand: { glyphs: g2, avg: { 2: avg2 } } });
  ok(viaOption.items.length > 0, 'a hand passed as an option may carry averages');
  store.clear(); Nib.hand.clear();
  delete global.localStorage;
}

// ------------------------------------------------------------------ 8. determinism and invariance
section('8. determinism');
const strokesKey = o => JSON.stringify(o.items.map(it => it.parts));
let differ = 0;
for (const r of sample.slice(0, 15)) if (strokesKey(Nib.neaten(r.strokes)) !== strokesKey(Nib.neaten(r.strokes))) differ++;
ok(differ === 0, 'the same ink gives the same result');
let moved = 0;
for (const r of sample.slice(0, 15)) {
  const a = Nib.neaten(r.strokes), b = Nib.neaten(r.strokes.map(s => s.map(p => [p[0] + 300, p[1] - 120])));
  const pa = I.pathsOf(a.items), pb = I.pathsOf(b.items);
  const tol = 0.002 * a.em;                     // floating point at the edge of a smoothing window, nothing more
  if (pa.length !== pb.length || pa.some((s, i) => s.length !== pb[i].length || s.some((q, j) => Math.abs(q[0] + 300 - pb[i][j][0]) > tol || Math.abs(q[1] - 120 - pb[i][j][1]) > tol))) moved++;
}
ok(moved === 0, 'moved ink gives the same result, moved');

// ------------------------------------------------------------------ 9. signs drawn the way they are meant (tidy)
section('9. signs');
{
  const T = I.tidyProvider(), s = 1;
  const glyph = (label, pts) => T.glyph({ k: 's', label, pts }, s).draw[0].paths;
  const bx = p => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); } return [x0, y0, x1, y1]; };
  const line = (a, b, n = 8) => Array.from({ length: n }, (_, i) => [a[0] + (b[0] - a[0]) * i / (n - 1), a[1] + (b[1] - a[1]) * i / (n - 1)]);
  const near = (a, b, t = 0.01) => Math.abs(a - b) < t;
  // ÷: the dots over the middle of the bar
  const dv = glyph('\\div', [line([0, 50], [40, 52]), [[8, 34], [9, 35]], [[31, 67], [32, 68]]]);
  const bar = dv.find(p => p.length > 4), dots = dv.filter(p => p !== bar), bm = (bx(bar)[0] + bx(bar)[2]) / 2;
  ok(dots.length === 2 && dots.every(p => near((bx(p)[0] + bx(p)[2]) / 2, bm)), '÷: both dots sit over the middle of the bar');
  // ≠: the two bars level, the same length, one above the other; the slash kept
  const ne = glyph('\\ne', [line([0, 40], [30, 42]), line([4, 60], [40, 57]), line([28, 25], [12, 75])]);
  const flat = ne.filter(p => { const b = bx(p); return b[2] - b[0] > 3 * (b[3] - b[1]); });
  ok(flat.length === 2 && flat.every(p => near(bx(p)[1], bx(p)[3])) && near(bx(flat[0])[0], bx(flat[1])[0]) && near(bx(flat[0])[2], bx(flat[1])[2]), '≠: two level bars of one length');
  ok(ne.length === 3, '≠: the stroke through it is kept');
  // ±: the upright through the middle of the top bar, the lower bar as long as the top one
  const pm = glyph('\\pm', [line([0, 30], [40, 31]), line([26, 10], [27, 52]), line([6, 70], [30, 71])]);
  const hs = pm.filter(p => { const b = bx(p); return b[2] - b[0] > 3 * (b[3] - b[1]); }), up = pm.find(p => { const b = bx(p); return b[3] - b[1] > 3 * (b[2] - b[0]); });
  const top = hs.slice().sort((a, b) => bx(b)[1] - bx(a)[1])[0], low = hs.find(p => p !== top);
  ok(up && near((bx(up)[0] + bx(up)[2]) / 2, (bx(top)[0] + bx(top)[2]) / 2), '±: the upright stands on the middle of the bar');
  ok(low && near(bx(low)[0], bx(top)[0]) && near(bx(low)[2], bx(top)[2]), '±: the lower bar as long as the top one');
  // ⋅: a dot, not a squiggle
  const cd = glyph('\\cdot', [[[10, 50], [12, 51], [11, 53], [9, 52]]]);
  ok(cd.length === 1 && cd[0].length === 1, '⋅: drawn as one round dot');
  // = and + (already right; kept right)
  const eq = glyph('=', [line([0, 40], [30, 43]), line([5, 58], [36, 56])]);
  ok(eq.every(p => near(bx(p)[1], bx(p)[3])) && near(bx(eq[0])[0], bx(eq[1])[0]) && near(bx(eq[0])[2], bx(eq[1])[2]), '=: two level bars of one length');
  const pl = glyph('+', [line([0, 30], [40, 31]), line([28, 10], [27, 52])]);
  const ph = pl.find(p => bx(p)[2] - bx(p)[0] > 3 * (bx(p)[3] - bx(p)[1])), pv = pl.find(p => p !== ph);
  ok(near((bx(pv)[0] + bx(pv)[2]) / 2, (bx(ph)[0] + bx(ph)[2]) / 2) && near((bx(ph)[1] + bx(ph)[3]) / 2, (bx(pv)[1] + bx(pv)[3]) / 2), '+: upright and bar cross in their middles');
}

// ------------------------------------------------------------------ 10. answers: radicals, ± in a fraction, a comma, letters
section('10. answers drawn: (−3 ± √5)/2, −3, −2 and −2/3 x + 4 after "x ="');
{
  const { compose } = require('./compose.js');
  let e = null, res = null;
  for (let k = 0; k < 20 && !e; k++) { const c = compose('x='), r = new Nib.Recognizer().recognize(c.strokes, { times: false }); if (r.latex.replace(/\s/g, '') === 'x=') { e = c; res = r; } }
  const nodesOf = tex => I.solveRows(I.latexRows(tex), { times: false }).pop().nodes;
  const rad = nodesOf('x^{2}+3x+1=0 \\\\ x='), two = nodesOf('x^{2}+5x+6=0 \\\\ x='), lit = nodesOf('2y+3x=12 \\\\ x=');
  if (!e) console.log('    (x= misread every time; skipped)');
  else for (const [name, nodes, need] of [['(-3±√5)/2', rad, ['-', '3', '\\pm', '\\sqrt', '5', '2']], ['-3, -2', two, ['-', '3', ',', '2']], ['-2/3 y + 4', lit, ['-', '2', '3', 'y', '+', '4']]]) {
    for (const [style, extra] of [['tidy', {}], ['hand', { hand }], ['typeset', {}], ['tidy', { sample: l => I.DEFAULT_GLYPHS[l] || null }]]) {
      const opts = Object.assign({ result: res, answers: [nodes] }, extra);
      const t = style === 'typeset' ? Nib.typeset(e.strokes, opts) : Nib.neaten(e.strokes, Object.assign({ style }, opts));
      const A = t.items.filter(it => it.answer), eq = t.items.find(it => !it.answer && it.label === '=');
      const label = `${style}${extra.sample ? ' (built-in hand only)' : ''}: ${name}`;
      ok(A.length && need.every(l => A.some(it => it.label === l)) && A.every(it => it.parts.length && it.box.every(isFinite) && it.box[0] > eq.box[2]), `${label} drawn after the = (${A.map(it => it.label).join(' ')})`);
      if (nodes === rad) {
        // the bar spans the top, the 2 under it, √ over the 5 with ± before it, all of the top above the bar
        const bars = A.filter(it => it.label === '-'), bar = bars.reduce((a, b) => (b.box[2] - b.box[0] > a.box[2] - a.box[0] ? b : a));
        const top = A.filter(it => it !== bar && it.box[3] <= bar.box[1] + 1), den = A.filter(it => it.box[1] >= bar.box[3] - 1 && it !== bar);
        const root = A.find(it => it.label === '\\sqrt'), five = A.find(it => it.label === '5'), pm = A.find(it => it.label === '\\pm');
        ok(top.length === 5 && den.length === 1 && den[0].label === '2' && top.every(it => it.box[0] >= bar.box[0] - 1 && it.box[2] <= bar.box[2] + 1),
          `${label}: a fraction, -3 ± √5 over its bar and 2 under it`);
        ok(root && five && pm && root.box[0] <= five.box[0] && root.box[2] >= five.box[2] - 1 && root.box[1] < five.box[1] && pm.box[2] <= root.box[0] + 1, `${label}: the root covers the 5, ± before it`);
      }
      if (nodes === two) { const c = A.find(it => it.label === ','), d = A.filter(it => it.label === '3' || it.label === '2'); ok(c && d.length === 2 && d[0].box[2] <= c.box[0] + 1 && c.box[2] <= d[1].box[0], `${label}: the comma between the two roots`); }
    }
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
