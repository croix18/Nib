// The worker pool's node side (1.8.0; the browser side is test/pool_browser.js). The pool classifies ahead of a
// read: Recognizer.needs lists what a warm-up's first loop would classify, Recognizer.fill takes each answer, and
// probs uses an answer only in place of the very call to the classifier it was made for. This holds that a read
// cannot come out otherwise for it:
//   1. needs() changes nothing a read can see — the cache, the join cache, the held size, lastIds — on a new
//      recognizer and on one that has read; it classifies nothing, and asked twice lists the same groups
//   2. a recognizer whose answers were made apart — through a structured clone both ways, as a worker's are — reads
//      the same, every field, and ends with the same cache, bit for bit, as one that classified everything itself;
//      over the school problems, with corrections, with other options, and on the JavaScript path
//   3. fill: an answer waits beside the cache and is used once, for exactly the strokes and the size it was made for;
//      one for another size, for strokes that have moved, or under a key the recognizer has filled itself is never read
//   4. asked, and then the ink changes before the answers come (a stroke added, one moved, all of it moved, one taken
//      away, all of it resized), with and without a read before: the reading and the recognizer are, bit for bit,
//      those of a recognizer that was never asked
//   5. in node there is no pool: Nib.workers is 0, poolUse does nothing harmful, nothing is thrown
//   node test/pool_check.js
'use strict';
const fs = require('fs'), path = require('path');
const Nib = require(path.join(__dirname, '..', 'dist', 'nib.js'));
const I = Nib._internals;
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (c) passes++; else fails++; };
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

const drain = it => { let n = 0; while (!it.next().done) n++; return n; };
const plain = res => JSON.stringify(Object.assign({}, res, { ms: 0 }));
// a cache entry, bit for bit: the probabilities and the hidden vector, of the same types
const same = (a, b) => {
  if (!a || !b || a.constructor !== b.constructor || a.length !== b.length || !a.hidden || !b.hidden) return false;
  if (a.hidden.constructor !== b.hidden.constructor || a.hidden.length !== b.hidden.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  for (let i = 0; i < a.hidden.length; i++) if (!Object.is(a.hidden[i], b.hidden[i])) return false;
  return true;
};
// what is the same between two recognizers that read the same strokes, or why not
const recSame = (a, b, strokes) => {
  if (a.cache.size !== b.cache.size) return `cache sizes ${a.cache.size} and ${b.cache.size}`;
  for (const [k, e] of a.cache) { const f = b.cache.get(k); if (!f) return 'no entry ' + k; if (!same(e, f)) return 'entry ' + k + ' differs'; }
  if (a.jcache.size !== b.jcache.size) return `join caches ${a.jcache.size} and ${b.jcache.size}`;
  for (const [k, p] of a.jcache) if (!Object.is(b.jcache.get(k), p)) return 'join entry ' + k + ' differs';
  if (!Object.is(a.cref, b.cref)) return `cref ${a.cref} and ${b.cref}`;
  if (a.next !== b.next) return `ids made ${a.next} and ${b.next}`;
  if ([...a.lastIds].join() !== [...b.lastIds].join()) return 'lastIds differ';
  for (const s of strokes) { const x = a.ids.get(s), y = b.ids.get(s); if (!x !== !y || (x && x.id !== y.id)) return 'a stroke\'s id differs'; }
  return null;
};
// everything a read can see of a recognizer, as one string: the cache (keys and bits), the join cache, the held size, lastIds
const bytes = t => Buffer.from(t.buffer, t.byteOffset, t.byteLength).toString('base64');
const seen = r => JSON.stringify([[...r.cache].map(([k, e]) => [k, bytes(e), bytes(e.hidden)]), [...r.jcache], r.cref, [...r.lastIds]]);
// the same, without the names the strokes were given (two recognizers that met the strokes in another order name
// them differently, and nothing but the names differs): the entries' bits in order, the join cache's values, the size
const unnamed = r => JSON.stringify([[...r.cache.values()].map(e => bytes(e) + bytes(e.hidden)).sort(), [...r.jcache.values()].sort(), r.cref, r.lastIds.size]);
// classified apart, as a worker classifies: a structured clone of the strokes there, and of the answer back
const apart = (group, ref) => {
  const sent = structuredClone({ g: group, ref });
  const z = I.classifyGroup(sent.g, sent.ref);
  const back = structuredClone({ p: z, h: z.hidden });
  back.p.hidden = back.h;
  return back.p;
};
// what a pad does with a piece: ask, and hand each answer to the recognizer
const ask = (rec, strokes, o) => { const need = rec.needs(strokes, o); return need.jobs.map(j => ({ key: j.key, bucket: need.bucket, ref: need.ref, group: j.group, e: apart(j.group, need.ref) })); };
const give = (rec, answers) => answers.filter(a => rec.fill(a.key, a.bucket, a.ref, a.group, a.e)).length;

// ---------------------------------------------------------------- 1, 2
// over every n-th school problem: cold (a new recognizer reads it), warm (warmed, then read: what the pad does),
// needs-then-warm (the same recognizer asked first), filled (needs, each group classified apart and handed over, then
// the warm-up and the read as they are)
function sweep(name, every, base, kernel) {
  if (kernel) I.kernelUse(kernel);
  const t0 = Date.now();
  let n = 0, jobsAll = 0, leftAll = 0, warmAll = 0, bad = [];
  for (let r = 0; r < rows.length; r += every) {
    const strokes = rows[r].strokes; n++;
    let o = base;
    if (n % 9 === 0) {            // corrections: the first symbol fixed as what it was read as (a fix widens what the segmentation tries)
      const r0 = new Nib.Recognizer().recognize(strokes, base);
      if (r0.symbols.length) o = Object.assign({}, base, { fix: [{ strokes: r0.symbols[0].strokes, label: r0.symbols[0].label }] });
    }
    const cold = new Nib.Recognizer(), rc = cold.recognize(strokes, o);
    const warm = new Nib.Recognizer(); const steps = drain(warm.warmup(strokes, o));
    warmAll += warm.classified || 0;
    if (steps !== (warm.classified || 0)) bad.push(`${rows[r].id}: the warm-up yielded ${steps} times for ${warm.classified} classifications`);
    // asked: nothing a read can see has changed, nothing was classified, and asked again the list is the same
    const twice = new Nib.Recognizer(), before = seen(twice), nd = twice.needs(strokes, o);
    if (twice.classified || seen(twice) !== before || twice.ahead.size) bad.push(`${rows[r].id}: needs() classified ${twice.classified || 0}, or left something a read can see`);
    const nd2 = twice.needs(strokes, o);
    if (nd2.ref !== nd.ref || nd2.bucket !== nd.bucket || nd2.jobs.length !== nd.jobs.length || nd2.jobs.some((j, i) => j.key !== nd.jobs[i].key)) bad.push(`${rows[r].id}: needs() asked twice lists another set`);
    drain(twice.warmup(strokes, o));
    const d1 = recSame(warm, twice, strokes);
    if (d1) bad.push(`${rows[r].id}: needs() then warmup() against warmup() alone: ${d1}`);
    // answered: every answer waits, a second asking lists nothing, the warm-up and the read classify only the rest
    const fil = new Nib.Recognizer(), answers = ask(fil, strokes, o);
    if (give(fil, answers) !== answers.length || fil.ahead.size !== answers.length || fil.cache.size) bad.push(`${rows[r].id}: ${answers.length} answers, ${fil.ahead.size} waiting, ${fil.cache.size} in the cache`);
    if (fil.needs(strokes, o).jobs.length) bad.push(`${rows[r].id}: asked again with every answer waiting, needs() lists ${fil.needs(strokes, o).jobs.length}`);
    drain(fil.warmup(strokes, o));
    const left = fil.classified || 0;
    const rf = fil.recognize(strokes, o), rw = warm.recognize(strokes, o);
    if ((fil.classified || 0) !== left) bad.push(`${rows[r].id}: the read after the warm-up classified ${(fil.classified || 0) - left}`);
    if (left !== (warm.classified || 0) - answers.length) bad.push(`${rows[r].id}: ${answers.length} answers, and the warm-up classified ${left} of the ${warm.classified} itself`);
    if (fil.ahead.size) bad.push(`${rows[r].id}: ${fil.ahead.size} answers still waiting after the read`);
    if (plain(rw) !== plain(rc)) bad.push(`${rows[r].id}: warmed reads another reading than cold`);
    if (plain(rf) !== plain(rc)) bad.push(`${rows[r].id}: answered reads another reading than cold`);
    const d2 = recSame(warm, fil, strokes);
    if (d2) bad.push(`${rows[r].id}: answered against warmed: ${d2}`);
    jobsAll += answers.length; leftAll += left;
  }
  if (kernel) I.kernelUse('auto');
  ok(!bad.length, `${name}: ${n} problems on ${kernel || Nib.kernel}, a warm-up classifying ${warmAll} groups; needs() lists ${jobsAll} ` +
    `(${(100 * jobsAll / Math.max(1, jobsAll + leftAll)).toFixed(1)}%) and leaves nothing behind, ${leftAll} left for the warm-up; needs()+warmup() is warmup(); ` +
    `answered reads as cold and as warmed, bit for bit: ${bad.length ? bad.length + ' differences' : 'yes'} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const b of bad.slice(0, 8)) console.log('        ' + b);
}
console.log('needs and fill against the warm-up and the cold read');
sweep('the school problems, every 2nd', 2, {});
sweep('with times: false, every 7th', 7, { times: false });
sweep("with symbols: 'all' and smoothing, every 9th", 9, { symbols: 'all', smooth: 2 });
sweep('on the JavaScript path, every 25th', 25, {}, 'js');

// needs() on a recognizer that has read: writing that grew by its last two strokes since
{
  let bad = 0, n = 0, listed = 0;
  for (let r = 2; r < rows.length && n < 80; r += 5) {
    const S = rows[r].strokes; if (S.length < 5) continue;
    n++;
    const rec = new Nib.Recognizer();
    rec.recognize(S.slice(0, -2), {});
    const before = seen(rec), cl = rec.classified, need = rec.needs(S, {});
    listed += need.jobs.length;
    if (seen(rec) !== before || rec.classified !== cl || rec.ahead.size || !need.jobs.length) bad++;
  }
  ok(n >= 60 && bad === 0, `needs() on a recognizer that has read, ${n} problems grown by two strokes: ${listed} groups listed, and the cache, the join cache, the held size and lastIds are what they were: ${bad ? bad + ' changed' : 'yes'}`);
}

// ---------------------------------------------------------------- 3
console.log('fill');
{
  const strokes = rows[3].strokes, rec = new Nib.Recognizer(), need = rec.needs(strokes, {});
  const j = need.jobs[0], k = j.key + need.bucket, e = apart(j.group, need.ref), e2 = apart(j.group, need.ref);
  ok(need.jobs.length > 3 && need.ref > 0 && need.bucket === '|' + Math.round(Math.log(need.ref) * 40), `needs() gives ${need.jobs.length} groups at ${need.ref.toFixed(2)}, bucket ${need.bucket}`);
  ok(rec.fill(j.key, need.bucket, need.ref, j.group, e) === true && rec.ahead.get(k).e === e && !rec.cache.has(k), 'an answer waits beside the cache, not in it');
  ok(rec.fill(j.key, need.bucket, need.ref, j.group, e2) === true && rec.ahead.get(k).e === e2 && rec.ahead.size === 1, 'a later answer for the same key takes the place of the one waiting');
  ok(rec.needs(strokes, {}).jobs.length === need.jobs.length - 1, 'needs() no longer lists a group whose answer is waiting');
  // the read takes it, once, and it is the entry the cache then holds
  drain(rec.warmup(strokes, {}));
  ok(rec.cache.get(k) === e2 && !rec.ahead.has(k), 'the warm-up takes it: the very object is the cache\'s entry, and nothing waits');
  // an entry the recognizer made itself stays, and an answer for it is not kept
  const k1 = need.jobs[1], mine = rec.cache.get(k1.key + need.bucket);
  ok(mine && rec.fill(k1.key, need.bucket, need.ref, k1.group, apart(k1.group, need.ref)) === false && rec.cache.get(k1.key + need.bucket) === mine && !rec.ahead.size, 'an answer for a group the recognizer classified itself is not kept');
  // what is not an answer
  const r2 = new Nib.Recognizer(), n2 = r2.needs(strokes, {}), j2 = n2.jobs[0], z = apart(j2.group, n2.ref);
  ok(r2.fill(j2.key, '|0', n2.ref, j2.group, z) === false && r2.fill(j2.key, n2.bucket, n2.ref, j2.group, new Float64Array(3)) === false &&
    r2.fill(j2.key, n2.bucket, n2.ref, null, z) === false && r2.fill(j2.key, n2.bucket, 0, j2.group, z) === false && !r2.ahead.size && !r2.cache.size,
    'not kept: an answer under a bucket that is not its size\'s, one without a hidden vector, one without its strokes, one for no size');
  // an answer for another size (1% larger: often the same bucket) waits, and is never read
  let badSize = 0, sameBucket = 0, tried = 0;
  for (let r = 0; r < rows.length && tried < 40; r += 17) {
    const S = rows[r].strokes, a = new Nib.Recognizer(), na = a.needs(S, {}), other = na.ref * 1.01, ob = '|' + Math.round(Math.log(other) * 40);
    tried++; if (ob === na.bucket) sameBucket++;
    for (const q of na.jobs) a.fill(q.key, ob, other, q.group, apart(q.group, other));
    drain(a.warmup(S, {}));
    const b = new Nib.Recognizer(); drain(b.warmup(S, {}));
    if (plain(a.recognize(S, {})) !== plain(b.recognize(S, {})) || seen(a) !== seen(b) || a.classified !== b.classified) badSize++;
  }
  ok(tried === 40 && sameBucket >= 10 && badSize === 0, `answers for a size 1% larger, ${tried} problems (${sameBucket} in the same bucket as the read's): none is read — the recognizer classifies every group itself and ends as one never asked: ${badSize ? badSize + ' differ' : 'yes'}`);
  // an answer for strokes that have since moved as a whole (the same ids, so the same key): not read either
  let badMove = 0, wasted = 0;
  for (let r = 1; r < rows.length && r < 400; r += 13) {
    const S = rows[r].strokes.map(s => s.map(p => p.slice())), a = new Nib.Recognizer(), ans = ask(a, S, {});
    for (const s of S) for (const p of s) { p[0] += 37.25; p[1] -= 11.5; }
    give(a, ans);
    const keysBefore = ans.map(q => q.key).join(';'), again = a.needs(S, {});
    if (again.jobs.map(q => q.key).join(';') !== keysBefore) badMove++;           // (the same keys, asked again: the strokes under them are elsewhere)
    drain(a.warmup(S, {}));
    const b = new Nib.Recognizer(); drain(b.warmup(S, {}));
    if (plain(a.recognize(S, {})) !== plain(b.recognize(S, {})) || seen(a) !== seen(b) || a.classified !== b.classified || a.ahead.size) badMove++;
    wasted += ans.length;
  }
  ok(badMove === 0 && wasted > 300, `answers for writing moved as a whole since it was asked (${wasted} of them, their keys still in use): none is read, needs() lists the groups again, and the reading is that of a recognizer never asked: ${badMove ? badMove + ' differ' : 'yes'}`);
  // a table of waiting answers over its size is emptied before the next, as the cache is
  const r4 = new Nib.Recognizer({ cacheSize: 4 }), n4 = r4.needs(strokes, {});
  n4.jobs.slice(0, 6).forEach(q => r4.fill(q.key, n4.bucket, n4.ref, q.group, apart(q.group, n4.ref)));
  ok(r4.ahead.size === 1 && !r4.cache.size, `what waits is emptied over the cache's size (4) before the next answer: ${r4.ahead.size} waiting after 6`);
}

// ---------------------------------------------------------------- 4
// The ink changes between the asking and the answers. A: asked on the ink as it was, the answers handed over after
// the change, then read. B: never asked, reads the changed ink. With a read of the first strokes before all of it
// (so a size is held and a cache is there), and without.
console.log('the ink changes between the asking and the answers');
{
  const CH = {
    'a stroke added to it': (S, ink) => { ink.push(S[S.length - 1]); },
    'one of its strokes moved': (S, ink) => { for (const p of ink[1]) { p[0] += 400; p[1] += 260; } },
    'all of it moved': (S, ink) => { for (const s of ink) for (const p of s) { p[0] += 123.4; p[1] -= 56.7; } },
    'a stroke taken away': (S, ink) => { ink.splice(1, 1); },
    'all of it a third larger': (S, ink) => { for (const s of ink) for (const p of s) { p[0] *= 1.3; p[1] *= 1.3; } },
    'two strokes added, the first a little larger': (S, ink) => { const s = S[S.length - 1], x0 = s[0][0], y0 = s[0][1]; ink.push(s.map(p => [x0 + (p[0] - x0) * 1.5, y0 + (p[1] - y0) * 1.5])); ink.push(S[S.length - 1]); },
    'nothing': () => {},
  };
  for (const prior of [false, true]) {
    for (const [name, change] of Object.entries(CH)) {
      let n = 0, bad = 0, adopted = 0, answered = 0, held = 0;
      const why = [];
      for (let r = 0; r < rows.length && n < 70; r += 3) {
        if (rows[r].strokes.length < 6) continue;
        n++;
        const S = rows[r].strokes.map(s => s.map(p => p.slice())), ink = S.slice(0, -1);
        const A = new Nib.Recognizer(), B = new Nib.Recognizer();
        if (prior) { for (const R of [A, B]) { drain(R.warmup(S.slice(0, -3), {})); R.recognize(S.slice(0, -3), {}); } }
        const c0 = A.cref, answers = ask(A, ink, {});
        change(S, ink);
        give(A, answers); answered += answers.length;
        const before = A.classified || 0;
        drain(A.warmup(ink, {})); drain(B.warmup(ink, {}));
        const ra = A.recognize(ink, {}), rb = B.recognize(ink, {});
        // (what A did not classify itself of what B classified since the change: the answers it took)
        adopted += (B.classified || 0) - (A.classified || 0);
        if (prior && A.cref === c0) held++;
        if (plain(ra) !== plain(rb)) { bad++; why.push(rows[r].id + ': the reading'); }
        else if (unnamed(A) !== unnamed(B)) { bad++; why.push(rows[r].id + ': the recognizer (cache bits, join cache, or the held size)'); }
        void before;
      }
      ok(n >= 60 && bad === 0, `${prior ? 'after a read of its first strokes' : 'writing never read'}, asked, then ${name}: ${n} problems, ${answered} answers of which ${adopted} stood in for a classification` +
        `${prior ? `, the size held in ${held}` : ''}; the reading and the recognizer are those of one never asked: ${bad ? bad + ' differ (' + why.slice(0, 3).join('; ') + ')' : 'yes'}`);
    }
  }
}

// ---------------------------------------------------------------- 5
console.log('node');
{
  let threw = null, w = null, size = null;
  try {
    w = Nib.workers; size = I.poolSize();
    I.poolUse(2); I.poolUse(0); I.poolUse('auto');
  } catch (e) { threw = e; }
  ok(!threw && w === 0 && size === 0, `no pool here: Nib.workers ${w}, the size it may use ${size}${threw ? ', threw ' + threw.message : ', nothing thrown'}`);
  let bad = null;
  try { I.poolUse(-1); } catch (e) { bad = e; }
  ok(bad && /poolUse/.test(bad.message), 'poolUse takes 0, a count or \'auto\' (anything else throws)');
  // a pad's read in node is not a thing; the pool's run here says "not done" at once
  let res = null;
  I.poolRun([{ key: 'k1', group: rows[0].strokes, ref: 40 }], () => {}).done.then(v => { res = v; });
  setTimeout(() => {
    ok(res === false, `the pool asked to run here: ${res === false ? '"not done"' : res}, nothing started (Nib.workers ${Nib.workers})`);
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails ? 1 : 0);
  }, 50);
}
