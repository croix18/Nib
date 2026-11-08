// The Replicator's core without a browser: smoothing, even sizes, and learning from written sentences — matching a
// sentence's strokes to its letters and averaging each letter's samples — on synthetic writers made from real
// CROHME handwriting (one writer's box drawings, then the same letters written again with natural variation).
//   node test/replicator_check.js
'use strict';
const fs = require('fs'), path = require('path');
const R = require(path.join(__dirname, '..', 'replicator', 'core.js'));
const D = process.env.NIB_DATA || path.join(__dirname, '..', 'training', 'scratch', 'data') + '/';
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; if (process.env.VERBOSE) console.log('  ok  ', m); } else { fails++; console.log('  FAIL', m); } };
const section = n => console.log(n);

// ------------------------------------------------------------------ a seeded random
let seed = 20261104;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const U = (a, b) => a + (b - a) * rnd();

section('1. smoothing: the shake goes, corners and stroke ends stay');
{
  const noisy = [];
  for (let i = 0; i <= 200; i++) { const a = i / 200 * Math.PI * 1.8; noisy.push([300 + 200 * Math.cos(a) + 6 * Math.sin(i * 1.7), 300 + 200 * Math.sin(a) + 6 * Math.cos(i * 2.3)]); }
  const rough = s => { let t = 0; for (let i = 1; i + 1 < s.length; i++) t += Math.hypot(s[i - 1][0] - 2 * s[i][0] + s[i + 1][0], s[i - 1][1] - 2 * s[i][1] + s[i + 1][1]); return t / (s.length - 2); };
  const r = [0, 2, 4, 6, 8, 10].map(lv => rough(R.smooth(noisy, 6, lv)));
  ok(r.every((v, i) => i === 0 || v < r[i - 1]), `each step of smoothing is smoother (${r.map(v => v.toFixed(2)).join(' > ')})`);
  ok(r[5] < 0.05 * r[0], 'the strongest smoothing takes away nearly all the shake');
  const s10 = R.smooth(noisy, 6, 10);
  ok(Math.hypot(s10[0][0] - noisy[0][0], s10[0][1] - noisy[0][1]) < 1e-9 && Math.hypot(s10[s10.length - 1][0] - noisy[200][0], s10[s10.length - 1][1] - noisy[200][1]) < 2, 'a stroke still starts and ends where it did');
  let shrink = 0; for (const p of s10) shrink += Math.hypot(p[0] - 300, p[1] - 300) - 200;
  ok(Math.abs(shrink / s10.length) < 6, `a curve keeps its size (${(shrink / s10.length).toFixed(1)} units on a radius of 200)`);
  const V = []; for (let i = 0; i <= 50; i++) V.push([i * 4, i * 8]); for (let i = 1; i <= 50; i++) V.push([200 + i * 4, 400 - i * 8]);
  const apex = R.smooth(V, 6, 10).reduce((b, p) => (p[1] > b[1] ? p : b));
  ok(Math.hypot(apex[0] - 200, apex[1] - 400) < 6, `the point of a V stays sharp at the strongest smoothing (${apex.map(v => v.toFixed(1)).join(', ')})`);
  ok(R.smooth([[1, 2]], 6, 10).length === 1 && R.smooth([[1, 2], [3, 4]], 6, 10).length === 2 && R.smooth([], 6, 10).length === 0, 'dots and tiny strokes pass through');
  ok(JSON.stringify(R.smooth(noisy, 6, 99)) === JSON.stringify(R.smooth(noisy, 6, 10)) && R.smooth(noisy, 6, -3).length === R.smooth(noisy, 6, 0).length, 'out-of-range strengths are held to 0..10');
  // hooks: the flick of the pen landing or lifting goes; a real flag stays
  const down = []; for (let i = 0; i <= 60; i++) down.push([300, 650 - i * 10]);                    // a downstroke to y = 50
  const hooked = down.concat([[304, 54], [309, 60], [313, 64]]);                                       // and a 15-unit flick back up
  const end = s => s[s.length - 1];
  const h4 = R.smooth(hooked, 6, 4), h0 = R.smooth(hooked, 6, 0);
  ok(Math.hypot(end(h4)[0] - 300, end(h4)[1] - 50) < 8 && end(h0)[1] > 60, `a flick at the end of a stroke goes (ends at ${end(h4).map(v => v.toFixed(0)).join(', ')}; kept with no smoothing)`);
  const both = [[292, 640], [296, 646], [300, 650]].concat(hooked);
  const hb = R.smooth(both, 6, 6);
  ok(Math.hypot(hb[0][0] - 300, hb[0][1] - 650) < 8 && Math.hypot(end(hb)[0] - 300, end(hb)[1] - 50) < 8, 'flicks at both ends go');
  const flag = [[240, 560], [255, 590], [270, 620], [285, 650], [300, 680]].concat(down.map(p => [p[0], p[1] + 30]));   // a 1 with its flag
  const f10 = R.smooth(flag, 6, 10);
  ok(Math.hypot(f10[0][0] - 240, f10[0][1] - 560) < 1, 'the flag of a 1 stays at the strongest smoothing');
  const tick = [[0, 0], [20, 0], [24, 3], [20, 6], [0, 6]];
  ok(R.smooth(tick, 6, 10).length >= 3 && Math.abs(end(R.smooth(tick, 6, 10))[1] - 6) < 1, 'a short stroke is never cut down');
  const zig = []; for (let i = 0; i < 40; i++) zig.push([i * 12, i % 2 ? 8 : 0]);
  ok(R.smooth(zig, 6, 10).length > 10, 'a scribble keeps its length');
}

section('2. even sizes: letters span their guides, the pen keeps its weight');
{
  const small = [[[0.35, 0.62], [0.5, 0.57], [0.6, 0.63], [0.58, 0.72]], [[0.58, 0.66], [0.42, 0.66], [0.37, 0.7], [0.45, 0.73], [0.58, 0.69]]];
  const span = (g, w) => [g.bbox[1] + w / 2, g.bbox[3] - w / 2];
  const plain = R.outline(small, { weight: 60, smoothing: 2 }), even = R.outline(small, { weight: 60, smoothing: 2, even: true, ch: 'a' });
  const [b0, t0] = span(even, 60);
  ok(Math.abs(b0 - R.GUIDE.base) < 12, `a small a sits on the baseline (${b0.toFixed(0)})`);
  ok(t0 > span(plain, 60)[1] + 20, 'and grows toward the x-height');
  const tall = [[[0.3, 0.1], [0.32, 0.76]], [[0.32, 0.4], [0.6, 0.38], [0.62, 0.76]]];          // an h written too tall
  const h = R.outline(tall, { weight: 60, smoothing: 0, even: true, ch: 'h' });
  ok(Math.abs(span(h, 60)[1] - R.GUIDE.cap) < 12 && Math.abs(span(h, 60)[0]) < 12, `an h spans baseline to cap height (${span(h, 60).map(v => v.toFixed(0)).join('..')})`);
  const y = [[[0.3, 0.4], [0.45, 0.62]], [[0.6, 0.4], [0.4, 0.95]]];
  const gy = R.outline(y, { weight: 60, smoothing: 0, even: true, ch: 'y' });
  ok(Math.abs(span(gy, 60)[1] - R.GUIDE.x) < 12, 'a y hangs from the x-height');
  const dot = R.outline([[[0.5, 0.75]]], { weight: 60, smoothing: 0, even: true, ch: '.' });
  ok(dot && dot.bbox[2] - dot.bbox[0] < 80, 'punctuation is never stretched');
  const f1 = R.buildFont({ a: small, h: tall }, { even: true }), f2 = R.buildFont({ a: small, h: tall }, { even: false });
  ok(f1.built.join('') === 'ah' && f2.built.join('') === 'ah' && f1.bytes.length > 100, 'fonts build with and without even sizes');
}

// ------------------------------------------------------------------ synthetic writers
const rows = fs.readFileSync(D + 'test.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const byWriter = new Map();
for (const r of rows) for (const s of r.symbols) {
  const w = r.writer || r.id.split('_')[0];
  if (!byWriter.has(w)) byWriter.set(w, {});
  const m = byWriter.get(w);
  (m[s.label] = m[s.label] || []).push(s.strokes.map(k => r.strokes[k]));
}
const pool = {};
for (const m of byWriter.values()) for (const [l, v] of Object.entries(m)) (pool[l] = pool[l] || []).push(...v);
const G = R.GUIDE_FRAC;
// a symbol's strokes into its box, at the height its kind is written
function place(ch, st) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  let top = G.cap, bot = G.base;
  if (/[a-z]/.test(ch) && !/[bdfhklt]/.test(ch)) top = G.x;
  if (/[gjpqy]/.test(ch)) { top = G.x; bot = G.desc; }
  if (ch === 'i' || ch === 'j') top = G.x - 0.1;
  if (ch === 't') top = G.cap + 0.08;
  if (ch === '.') { top = G.base - 0.06; bot = G.base; }
  const k = Math.min((bot - top) / Math.max(y1 - y0, 1e-9), 0.7 / Math.max(x1 - x0, 1e-9));
  return st.map(s => s.map(p => [0.15 + (p[0] - x0) * k, top + (p[1] - y0) * k]));
}
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.';
// a writer: one drawing per character (from one CROHME writer where it has it, else any)
function writer(n) {
  const ws = [...byWriter.values()], w = ws[n % ws.length], hand = {};
  for (const ch of LETTERS) {
    const own = w[ch] && w[ch].filter(st => st.length <= 3), any = (pool[ch] || []).filter(st => st.length <= 3);
    const pick = own && own.length ? own[Math.floor(rnd() * own.length)] : any.length ? any[Math.floor(rnd() * any.length)] : null;
    if (pick) hand[ch] = place(ch, pick);
  }
  return hand;
}
// the same drawing written again: a little bigger or smaller, turned, slanted, each stroke nudged, the hand shaking
function again(st, amt) {
  const a = amt === undefined ? 1 : amt;
  const sc = U(1 - 0.08 * a, 1 + 0.08 * a), rot = U(-0.06, 0.06) * a, sh = U(-0.08, 0.08) * a, f1 = U(5, 9), f2 = U(5, 9), ph = U(0, 6);
  return st.map(s => {
    const nx = U(-0.012, 0.012) * a, ny = U(-0.012, 0.012) * a;
    return s.map((p, i) => {
      const x = (p[0] - 0.5) * sc, y = (p[1] - 0.6) * sc;
      const rx = x * Math.cos(rot) - y * Math.sin(rot) + sh * y, ry = x * Math.sin(rot) + y * Math.cos(rot);
      return [0.5 + rx + nx + 0.004 * a * Math.sin(i / f1 + ph), 0.6 + ry + ny + 0.004 * a * Math.cos(i / f2 + ph)];
    });
  });
}
// a sentence written on ruled lines: [lines of strokes in line units, the true letter of every stroke]
function writeSentence(hand, text, o) {
  const P = Object.assign({ width: 12, late: 0.5, amt: 1 }, o || {});
  const lines = [[]], truth = [[]];
  let x = 0.1, li = 0;
  for (const word of text.split(' ')) {
    const glyphs = [...word].map(ch => ({ ch, st: hand[ch] ? R.toLine(again(hand[ch], P.amt)) : null }));
    const width = glyphs.reduce((t, g) => { if (!g.st) return t; const xs = g.st.flat().map(p => p[0]); return t + Math.max(...xs) - Math.min(...xs) + 0.12; }, 0);
    if (x + width > P.width && x > 0.2) { lines.push([]); truth.push([]); li++; x = 0.1; }
    const lateStrokes = [];
    glyphs.forEach((g, gi) => {
      if (!g.st) return;
      const xs = g.st.flat().map(p => p[0]), dx = x - Math.min(...xs);
      const placed = g.st.map(s => s.map(p => [p[0] + dx, p[1]]));
      placed.forEach((s, si) => {
        // the dot of an i or j, or the bar of a t, sometimes added after the whole word
        const isLate = ((g.ch === 'i' || g.ch === 'j') && si === placed.length - 1 && placed.length > 1) || (g.ch === 't' && si === 1);
        if (isLate && rnd() < P.late) lateStrokes.push({ s, k: gi });
        else { lines[li].push(s); truth[li].push(gi + ':' + g.ch + ':' + word); }
      });
      x += Math.max(...xs) - Math.min(...xs) + U(0.06, 0.14);
    });
    for (const t of lateStrokes) { lines[li].push(t.s); truth[li].push(t.k + ':' + word[t.k] + ':' + word); }
    x += U(0.25, 0.45);
  }
  return { lines, truth };
}
const SENTENCES = ['The quick brown fox jumps over the lazy dog.', 'Sphinx of black quartz, judge my vow.', 'How vexingly quick daft zebras jump.',
  'The five boxing wizards jump quickly.', 'Jackdaws love my big sphinx of quartz.', 'Pack my box with five dozen jugs.', 'Bright vixens jump; dozy fowl quack.',
  'We promptly judged antique ivory buckles for the next prize.'];

section('3. sentences: every stroke goes to the right letter');
{
  // exact check with known truth: strokes tagged as they are written
  let total = 0, right = 0, okWrong = 0, okTotal = 0, sentences = 0, rejected = 0;
  for (let w = 0; w < 10; w++) {
    const hand = writer(w * 11 + 5), templates = {};
    for (const [ch, st] of Object.entries(hand)) templates[ch] = [R.toLine(st)];
    for (const text of SENTENCES) {
      const t = text.replace(/[,;]/g, ''), { lines, truth } = writeSentence(hand, t);
      const res = R.alignSentence(lines, t, templates);
      sentences++; if (!res.letters.some(L => L.ok)) rejected++;
      // which strokes each letter got, by identity
      const id = new Map(); lines.forEach((ln, li) => ln.forEach((s, si) => id.set(JSON.stringify(s.map(p => [+(p[0] + 0).toFixed(5), +p[1].toFixed(5)])), truth[li][si])));
      const chars = [...t].filter(c => c !== ' ');
      let wordAt = 0;
      const words = t.split(' '), owner = [];
      words.forEach(wd => [...wd].forEach((c, k) => owner.push(k + ':' + c + ':' + wd)));
      res.letters.forEach((L, j) => {
        total++;
        const tags = L.strokes.map(s => id.get(JSON.stringify(s.map(p => [+(p[0] + 0).toFixed(5), +p[1].toFixed(5)]))));
        const exact = L.strokes.length > 0 && tags.every(tg => tg === owner[j]) && truthCount(truth, owner[j]) === L.strokes.length;
        if (exact) right++;
        if (L.ok) { okTotal++; if (!exact) okWrong++; }
      });
      void wordAt; void chars;
    }
  }
  function truthCount(truth, tag) { let n = 0; for (const ln of truth) for (const t of ln) if (t === tag) n++; return n; }
  ok(right / total > 0.9, `strokes land on the right letters (${right} of ${total}, ${(100 * right / total).toFixed(1)}%), dots and crossings added after the word included`);
  ok(okWrong / Math.max(1, okTotal) < 0.02, `a letter learned has the right strokes (${okTotal - okWrong} of ${okTotal})`);
  ok(rejected === 0, `no sentence written as asked is turned away (${rejected} of ${sentences})`);
}
{
  // mistakes: a letter left out, a stray stroke, the wrong sentence
  const hand = writer(42), templates = {};
  for (const [ch, st] of Object.entries(hand)) templates[ch] = [R.toLine(st)];
  const t = 'The quick brown fox jumps over the lazy dog.';
  const missing = writeSentence(hand, t.replace('quick', 'qick'));
  const r1 = R.alignSentence(missing.lines, t, templates);
  ok(r1.letters.filter(L => L.ok).length > 25 && !r1.letters[4].ok, `a letter left out is passed over, the rest still learned (${r1.letters.filter(L => L.ok).length} learned)`);
  const stray = writeSentence(hand, t); stray.lines[0].splice(5, 0, [[3, 0.2], [3.3, 0.25]]);
  const r2 = R.alignSentence(stray.lines, t, templates);
  ok(r2.letters.filter(L => L.ok).length > 28, `a stray stroke is passed over (${r2.letters.filter(L => L.ok).length} learned)`);
  const other = writeSentence(hand, 'Pack my box with five dozen jugs.');
  const r3 = R.alignSentence(other.lines, t, templates);
  ok(r3.letters.filter(L => L.ok).length === 0, `writing a different sentence teaches nothing (${r3.letters.filter(L => L.ok).length} letters)`);
  // a different sentence against every other one, for every writer: nothing learned
  let wrongLearned = 0, pairs = 0;
  for (let w = 0; w < 6; w++) {
    const hw = writer(w * 7 + 3), tw = {};
    for (const [ch, st] of Object.entries(hw)) tw[ch] = [R.toLine(st)];
    for (let a = 0; a < SENTENCES.length; a++) {
      const b = (a + 1 + w) % SENTENCES.length, wrote = writeSentence(hw, SENTENCES[a].replace(/[,;]/g, ''));
      wrongLearned += R.alignSentence(wrote.lines, SENTENCES[b].replace(/[,;]/g, ''), tw).letters.filter(L => L.ok).length; pairs++;
    }
  }
  ok(wrongLearned <= 2, `the wrong sentence teaches nothing (${wrongLearned} letters over ${pairs} tries)`);
  // written much less like the boxes (bigger, smaller, more slanted, shakier): still learned from
  let away = 0, tries = 0, okL = 0, allL = 0;
  for (let w = 0; w < 6; w++) {
    const hw = writer(w * 13 + 2), tw = {};
    for (const [ch, st] of Object.entries(hw)) tw[ch] = [R.toLine(st)];
    for (const text of SENTENCES) {
      const t = text.replace(/[,;]/g, ''), r = R.alignSentence(writeSentence(hw, t, { amt: 2.2 }).lines, t, tw);
      tries++; const k = r.letters.filter(L => L.ok).length; if (!k) away++; okL += k; allL += r.letters.length;
    }
  }
  ok(away <= 1, `sentences written far less like the boxes are still learned from (${away} of ${tries} turned away, ${(100 * okL / allL).toFixed(0)}% of letters learned)`);
  // 8 Nov 2026, Croix's tablet: a sentence that lined up letter for letter (each letter's name under its strokes) was
  // turned away whole, because on the whole its letters were too unlike their boxes. A sentence that lines up word for
  // word now teaches the letters that match, however few; only one that does not line up is judged as a whole.
  let oldAway = 0, nowAway = 0, shaky = 0, lined = 0;
  for (let w = 0; w < 6; w++) {
    const hw = writer(w * 13 + 2), tw = {};
    for (const [ch, st] of Object.entries(hw)) tw[ch] = [R.toLine(st)];
    for (const text of SENTENCES) {
      const t = text.replace(/[,;]/g, ''), r = R.alignSentence(writeSentence(hw, t, { amt: 4 }).lines, t, tw);
      const k = r.letters.filter(L => L.ok).length;
      shaky++; if (r.lined) lined++; if (!k) nowAway++;
      if (r.cost > 1.3 * 0.085 || k < 0.35 * r.letters.length) oldAway++;
    }
  }
  ok(nowAway <= 3 && oldAway > nowAway && oldAway >= 3 && lined >= 0.85 * shaky, `written much less like the boxes still (twice as shaky): ${nowAway} of ${shaky} turned away, where judging the whole sentence turned ${oldAway} away (${lined} lined up word for word)`);
  const jumped = R.alignSentence(writeSentence(hand, 'The quick brown fox jumped over the lazy dog.').lines, t, templates);
  ok(jumped.lined && jumped.letters.filter(L => L.ok).length >= 25 && !jumped.letters[20].ok && jumped.letters.slice(16, 20).every(L => L.ok),
    `one word written differently ("jumped" for "jumps"): the rest is still learned, j-u-m-p too, the s not (${jumped.letters.filter(L => L.ok).length} letters)`);
  ok(Array.isArray(jumped.words) && jumped.words.length === 9 && jumped.words[4].text === 'jumps', 'each word is reported, with what was missing or extra in it');
  ok(R.alignSentence([], t, templates).letters.length === 0 && R.alignSentence(missing.lines, '', templates).letters.length === 0, 'nothing written, or no text: nothing learned');
  const r4 = R.alignSentence(missing.lines, t, {});
  ok(r4.letters.every(L => !L.ok), 'without box drawings to compare with, nothing is learned');
  let threw = false;
  try { R.alignSentence([[null, 5, [[NaN, 1]], [[1, 2], [Infinity, 3]]]], 'ab', { a: [[[[0, 0]]]] }); R.alignSentence('x', null, null); } catch (e) { threw = e.message; }
  ok(!threw, 'odd input never throws' + (threw ? ': ' + threw : ''));
}

section('4. averaging: the letter as it is usually written');
{
  const hand = writer(9);
  let better = 0, n = 0;
  for (const ch of 'aehnorstABE5') {
    if (!hand[ch]) continue;
    const truth = R.toLine(hand[ch]), samples = [hand[ch]].concat(Array.from({ length: 6 }, () => again(hand[ch], 1)));
    const avg = R.averageGlyph(samples);
    if (!avg) continue;
    n++;
    const dAvg = R.cloudDist(R.cloud(R.toLine(avg), 32), R.cloud(truth, 32));
    const dOne = samples.slice(1).reduce((t, s) => t + R.cloudDist(R.cloud(R.toLine(s), 32), R.cloud(truth, 32)), 0) / 6;
    if (dAvg < dOne) better++;
  }
  ok(n >= 10 && better / n >= 0.8, `the average is nearer the true shape than a typical sample (${better} of ${n})`);
  const e = hand.e || hand.a, odd = [[[0.2, 0.2], [0.8, 0.9]]];
  const withOdd = R.averageGlyph([e, again(e), again(e), again(e), odd]);
  ok(withOdd && withOdd.length === e.length, 'a sample with a different number of strokes is left out');
  const flipped = e.map(s => s.slice().reverse()).reverse();
  const avg2 = R.averageGlyph([e, flipped, again(e), again(flipped)]);
  ok(avg2 && R.cloudDist(R.cloud(R.toLine(avg2), 32), R.cloud(R.toLine(e), 32)) < 0.04, 'strokes written in another order or direction are matched up');
  ok(R.averageGlyph([e]) === null && R.averageGlyph([]) === null && R.averageGlyph(null) === null, 'one sample alone is not averaged');
  ok(R.averageGlyph([[[[0.5, 0.7]]], [[[0.52, 0.71]]]]) !== null, 'a dot averages with a dot');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
