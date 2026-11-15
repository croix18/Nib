// The pool's first claim, in node (no workers needed for it): a recognizer whose cache was filled ahead of the read
// with classifications computed somewhere else reads exactly what a recognizer that classified everything itself reads.
// For every school problem (or every n-th):
//   cold     a new Recognizer reads it
//   warm     a new Recognizer is warmed, then reads it (what the pad does today)
//   filled   needs() lists the groups the warm-up's first loop would classify; each is classified apart, from a
//            structured clone of its strokes (what a worker is sent), and comes back as a clone of the typed arrays
//            (what a worker sends); fill() puts them in the cache; then the warm-up and the read run as they are
// and the three must give the same reading (every field but the time), the same cache keys, and the same bits in
// every cache entry. It also counts what the pool would take off the main thread: the groups needs() lists, against
// what is left for the warm-up to classify after them.
//   node tools/pool/exact.js [every n-th = 1] [options JSON = {}]      KERNEL=js: the JavaScript path
'use strict';
const fs = require('fs'), path = require('path');
const REPO = path.join(__dirname, '..', '..');
const Nib = require(process.env.NIB || REPO + '/dist/nib.js'), I = Nib._internals;
if (process.env.KERNEL) I.kernelUse(process.env.KERNEL);
const P = require('./lib.js')(Nib);
const MOD = +process.argv[2] || 1, OPTS = JSON.parse(process.argv[3] || '{}');
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').map(JSON.parse).filter((r, i) => i % MOD === 0);

const drain = it => { let n = 0; while (!it.next().done) n++; return n; };
const plain = res => JSON.stringify(Object.assign({}, res, { ms: 0 }));
const cacheSame = (a, b) => {
  if (a.cache.size !== b.cache.size) return `cache sizes ${a.cache.size} and ${b.cache.size}`;
  for (const [k, e] of a.cache) { const f = b.cache.get(k); if (!f) return 'no entry ' + k; if (!P.same(e, f)) return 'entry ' + k + ' differs'; }
  return null;
};
let bad = 0, n = 0, jobsAll = 0, leftAll = 0, coldAll = 0, warmAll = 0, strokes = 0, twice = 0;
const fails = [];
const t0 = Date.now();
for (const r of rows) {
  n++; strokes += r.strokes.length;
  // corrections on every 9th problem: the first stroke fixed as what it was read as (a fix widens what the segmentation tries)
  const cold = new Nib.Recognizer(), r0 = cold.recognize(r.strokes, OPTS);
  const o = n % 9 === 0 && r0.symbols.length ? Object.assign({}, OPTS, { fix: [{ strokes: r0.symbols[0].strokes, label: r0.symbols[0].label }] }) : OPTS;
  const c0 = new Nib.Recognizer(), rc = c0.recognize(r.strokes, o);
  const warm = new Nib.Recognizer(); drain(warm.warmup(r.strokes, o)); const w0 = warm.classified || 0, rw = warm.recognize(r.strokes, o);
  const fil = new Nib.Recognizer();
  const jobs = P.needs(fil, r.strokes, o);
  if (fil.classified) { bad++; fails.push(`${r.id}: needs() classified ${fil.classified}`); }
  const again = P.needs(fil, r.strokes, o);
  if (again.length !== jobs.length || again.some((j, i) => j.k !== jobs[i].k || j.ref !== jobs[i].ref)) { twice++; fails.push(`${r.id}: needs() asked twice gives another list`); }
  for (const j of jobs) {
    const sent = structuredClone({ g: j.g, ref: j.ref });                       // as posted to a worker
    const z = I.classifyGroup(sent.g, sent.ref);
    const back = structuredClone({ p: z, h: z.hidden.slice() });                // as posted back
    if (!P.fill(fil, j.k, P.entry(back))) { bad++; fails.push(`${r.id}: ${j.k} was there already`); }
  }
  const left = drain(fil.warmup(r.strokes, o));                                // what the warm-up still classifies
  if ((fil.classified || 0) !== left) { bad++; fails.push(`${r.id}: the warm-up classified ${fil.classified} in ${left} steps`); }
  const rf = fil.recognize(r.strokes, o);
  if ((fil.classified || 0) !== left) { bad++; fails.push(`${r.id}: the read classified ${(fil.classified || 0) - left} more`); }
  const pc = plain(rc);
  if (plain(rw) !== pc) { bad++; fails.push(`${r.id}: warmed reads another reading than cold`); }
  if (plain(rf) !== pc) { bad++; fails.push(`${r.id}: filled reads another reading than cold`); }
  const d = cacheSame(warm, fil) || (fil.cref !== warm.cref ? `cref ${fil.cref} and ${warm.cref}` : null);
  if (d) { bad++; fails.push(`${r.id}: filled against warmed: ${d}`); }
  jobsAll += jobs.length; leftAll += left; coldAll += c0.classified || 0; warmAll += w0;
}
const share = jobsAll / (jobsAll + leftAll);
console.log(`${n} problems, ${strokes} strokes, options ${JSON.stringify(OPTS)}, classifier ${Nib.kernel} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
console.log(`  a warm-up classifies ${warmAll} groups (${(warmAll / strokes).toFixed(2)} a stroke); a cold read ${coldAll}`);
console.log(`  needs() lists ${jobsAll} of them (${(100 * share).toFixed(1)}%): the pool's; ${leftAll} are left for the warm-up (${(100 * (1 - share)).toFixed(1)}%)`);
console.log(`  filled against cold and against warmed: ${bad} differences${twice ? `, needs() unstable ${twice} times` : ''}`);
for (const f of fails.slice(0, 12)) console.log('   ' + f);
process.exit(bad || twice ? 1 : 0);
