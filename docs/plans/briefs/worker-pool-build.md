# Nib 1.8.0: a page's cold read on every core

The task form of `docs/plans/worker-pool.md`. Read that first: it has the design, why the reading cannot differ, and
what the prototype measured. This is what to build, what must hold when it is built, and what to report.

You are working in a clone of croix18/Nib: a dependency-free handwriting-to-LaTeX engine, `dist/nib.js`, built by
`python3 build.py` from `src/*.js`; the pages `dist/Board.html`, `dist/Replicator.html`, `dist/Nib.html` are built by
`npm run build`. Read `docs/HANDOFF.md` — the file map at the top, then "Speed (1.7.0)" — and `src/core.js`
(`classifyGroup`), `src/recognize.js` (`class Recognizer`: `probs`, `prepare`, `recognize`, `warmup`), and in
`src/pad.js`: `_schedule`, `_partsSteps`, `_partsPass`, `_warm`, `recognize`, `_resume`, `_inkMoved`, `_recFor`.
`tools/pool/` is a prototype of the parts that could be tried without changing the engine (`lib.js`: `needs` and
`fill` done from outside, the worker's text, a small pool; `exact.js` and `proto.js`: the checks and measurements).
Use it as the reference for what the real thing must do, not as code to paste: it reaches into the engine in ways
the engine itself has no need to.

Do not commit and do not push.

## Before this

Nib 1.7.1 fixed the two faults of `docs/reviews/found-2026-11-15.md` (read its two "The fix" parts: `_partsPass` now
joins for as many rounds as there are pieces, and `Recognizer.idsOf` gives a stroke a new id when it has moved away
from the strokes it is read with or has another shape). Two things follow for this build:

- **Keys can go out of use between the asking and the answer.** `needs()` returns keys made of the ids the strokes
  have now. If a stroke is moved before the answer comes, its next `prepare` gives it a new id and the old key is
  never looked up again: `fill` may store the answer (it is the right classification of the strokes as they were) or
  drop it; it must not try to translate it. Do not keep anything keyed by stroke id outside the recognizer.
- **The reference** is `tools/verify/gold-1.6.7` (readings, and eight sessions) together with
  `tools/verify/gold-1.7.1` (two sessions on pages with 13 and 14 joins and with single strokes moved);
  `tools/verify/sessions.sh` runs all ten against the right one.

## What is there, and the goal

Since 1.7.0 the classifier runs in a WebAssembly kernel (`Nib.kernel`), with a JavaScript path that gives the same
bits, and a board's read is one run of steps (`_partsSteps`) in which every group is warmed (`Recognizer.warmup`)
before it is read (since 1.7.1 with a round of joining for every join the page needs). Opening a full page still has nothing in the recognizers' caches: every group of strokes is
classified on the page's thread, 14 ms at a time; 120 expressions take 3 s on a two-core machine, the thread is busy
for all of it, and a stroke written meanwhile stops the read until the pen rests again.

**Goal: that classifier work runs in worker threads, on every core but one, and goes on while the writer writes; the
reading that comes out is the one the page's thread alone gives; where workers cannot run, nothing changes.**

## The design (decided; follow it unless you find it cannot work, then stop and say why)

**The pool only fills caches ahead of the read.**

1. **`Recognizer.needs(input, options)`** does exactly what `warmup` does before and during its first loop, except
   that it does not classify: it returns `{ ref, bucket, jobs: [{ key, group }] }` — the groups the loop would
   classify now (those not in `this.cache`), the size they would be classified at (`cref`) and the cache bucket. It
   makes the same calls with the same effects as `warmup` does up to there (`prepare`, `classRef`, `pjoin`):
   `needs()` then `warmup()` leaves the recognizer exactly as `warmup()` alone does. Make `warmup`'s first loop and
   `needs` share one enumeration. `warmup` behaves exactly as before (the same yields: one a classification).
   **`Recognizer.fill(key, bucket, ref, e)`** stores the entry `probs` would have stored (the same key and object:
   what `classifyGroup` returns, the probabilities with `.hidden`; `memApply` adds `.mem`/`.memv` later), by the same
   cache-size rule, **only when no entry is there and `this.cref === ref`**. It returns whether it stored.

2. **A worker that classifies.** `build.py` wraps the engine as `(function (global) {…})(…)`; name that function
   (`NibEngine`) so the engine can read its own source (`NibEngine.toString()`) and start a worker from a Blob URL:
   `'self.__nibWorker = 1; (' + source + ')(self);'`. In a worker started that way the engine, once it has defined
   everything, answers `{ id, jobs: [{ g, ref }] }` with `{ id, out: [{ p, h }] }` — each job's
   `classifyGroup(g, ref)`: the probabilities and the hidden vector, their buffers transferred (the hidden vector's
   as a copy if the engine keeps its buffer). The group goes as it is (structured clone keeps the numbers exact; no
   rounding, no float32). A worker defines no custom element, reads no storage, and does not print the kernel's
   fallback line a second time.
   Measured: such a worker starts from `file://` with no flags and under the site's rule for the Nib pages; it is
   ready in 50 to 95 ms; posting 1,751 groups in chunks of 8 costs the page's thread 20 ms in all, so the groups need
   no packing.

3. **The pool** (`src/pool.js`, added to `build.py`'s list; nothing of it runs at engine start):
   - made on first use; `max(1, min(4, hardwareConcurrency − 1))` workers, and no more than
     `Math.floor(navigator.deviceMemory)` where that is a number (0 there: no pool);
   - `run(jobs)` → a Promise of the results or of "not done"; chunks of 8 groups that idle workers take from one
     queue;
   - **every failure ends in the same place: "not done", and the caller classifies on the page's thread as before.**
     No `Worker`/`Blob`/`URL.createObjectURL`; `new Worker` throws; the worker fires `error` (how a forbidden worker
     shows in Chrome: no throw, an `error` event about 15 ms later) or is not ready within 4 s; a chunk is not
     answered within 20 s; an answer of the wrong shape. Then the pool is dead for the page's life, its workers
     terminated, every pending request resolved as not done, one `console.info` line. Never retried. (A pool
     declared dead by mistake — the device slept through a limit — only costs speed until the page is opened again:
     do not make the limits clever);
   - workers idle for 30 s are terminated; the next request starts them again;
   - `Nib.workers` (getter): how many are running now. `Nib._internals.poolUse(n)`: `0` off, a number sets the
     count, `'auto'` back; and what the tests need (a way to kill a worker mid-request, to make one never answer, a
     count of the groups each side classified).

4. **The pad: ask ahead, then read as now.** In `_schedule`, when the timer fires and before the steps start:
   - when the clusters whose part is not in `this.parts` (nor in `_badParts`) have fewer than about 60 strokes
     between them, or the pool cannot run: go to the steps. A small read is not even planned;
   - take out of the pool's queue the pad's requests (from a read that was cancelled) whose strokes are no longer on
     the pad — `pool.run` therefore gives something to cancel by; a chunk a worker already holds finishes — and
     wait for the rest;
   - plan, in slices of 14 ms: for each such cluster, `needs()` on its recognizer (`_recFor(st[0])`, options as
     `_partsPass` gives `warmup`: `Object.assign({}, ro, { fix: this._fixFor(st) })`);
   - when what is listed is less than about 150 ms of this thread's classifying (keep a running cost of a
     classification): go to the steps;
   - `pool.run` it; as answers come, `fill` them **only if that recognizer is still the one the pad holds for that
     stroke** (`this.recs.get(first) === rec`), whatever happened to the read meanwhile;
   - when every request is answered (or the pool died), the steps run as they do now. Nothing about
     `_partsSteps`/`_partsPass` changes: they find the first loop in the caches, rehearse, classify the few groups it
     does not cover, and the groups `joinOperands` puts together, in slices, and announce;
   - a cancelled read (`gen` moved on) leaves its requests running; the next read waits for them, then asks only for
     what is missing;
   - the one-expression pad (`this.rec.warmup(ink, …)` in `_warm`) gets the same when its read is big;
   - `recognize()` never waits for the pool;
   - `pad.busy` is true from `_schedule` to the announcement; `_resume`, `destroy()`, a pad with no ink left,
     `read: false`, `auto: false` all still behave; `res.ms` covers the whole read, the asking included;
   - the Board's line at the foot of Settings (`board/template.html`, `board/board.js`, `#engineline`) says how many
     workers the pool may use.

5. Nothing about what is read may change: no reading option, no event, no result field. The new public name is
   `Nib.workers`; document it where `Nib.kernel` is.

## What must hold (each will be checked again by whoever asked for this)

1. **Readings, in node**: `tools/verify/readings.sh dist/nib.js tools/verify/out/readings`, then
   `node tools/verify/cmp.js tools/verify/gold-1.6.7/readings tools/verify/out/readings` → every count 0.
2. **Sessions, in Chrome**, three times — as it comes, with `NIB_SESSION_INIT="Nib._internals.poolUse(0)"`, and with
   `NIB_SESSION_INIT="Nib._internals.poolUse(2)"`: `tools/verify/sessions.sh dist/nib.js tools/verify/out/s-<name>`
   → `sessions: nothing differs` each time. Add no engine-level switch (an attribute, a storage key, a query string)
   for turning the pool off.
3. **The bits of a pooled read**: on a page of 60 expressions or more, the entries a pooled read leaves in the
   recognizers' caches equal, bit for bit, those a read on the page's thread leaves; with this thread forced to
   `'js'` and the workers on `'simd'`, too.
4. **Fallbacks, each in Chrome**: a page whose rule forbids workers (`worker-src 'none'`) reads as before, one info
   line, `Nib.workers === 0`; a worker killed in the middle of a page's read: the right reading; `poolUse(0)`: no
   worker is ever started; a pool that never answers: the read finishes on this thread after the limit; the engine
   `require`d in node: no pool, nothing thrown.
5. **The page's thread is free**, counted: of the groups classified during the cold read of a 60-expression page, at
   least 90% in workers (the prototype has 93.8%).
6. **Writing during a cold read**: strokes written while a 60-expression page is being read cold do not start its
   classification over (each first-loop group of the page is asked of the pool once), and the reading after the pen
   rests is the right one. A page replaced (`setState`) while it is being read cold: the new page's read does not
   wait for the old page's groups (the pool classifies no more of them than its workers already held).
7. `npm test`, `npm run test:browser`, `npm run lint`, `node tools/build_kern.js --check`,
   `npm run build && git diff --stat dist` consistent with the sources. `test/reading_browser.js` passes unchanged,
   with the pool on.
8. Measured, with the pool as it comes, off, and at two workers, on the machine at hand (say what
   `hardwareConcurrency` reports): the cold read of 20, 60 and 120 expressions (`tools/perf/live_perf.js`), and the
   longest hold of the page's thread during the 120. The prototype's numbers are in the plan; say where the build's
   differ and why.

## Tests to add (the repository's own; listed in `test/run.js`)

- node, `test/pool_check.js`: what `tools/pool/exact.js` checks, on the real `needs`/`fill` — `needs()` then
  `warmup()` leaves a recognizer as `warmup()` alone does (cache keys and values, `cref`, ids); a recognizer filled
  from classifications made apart reads the same, bit for bit, as one that classified itself, over a few hundred of
  `test/school_synth.jsonl`; `fill` never replaces, and refuses another size.
- browser, `test/pool_browser.js` with a page of its own beside `test/reading_page.html`: "What must hold" 3 to 6,
  from `file://`; the Board (`dist/Board.html`) opened on a saved page of 60 expressions starts workers and reads
  it; `dist/Nib.html` and a small pad never start one.
- No test asserts a time. They count.

## Also

- `docs/HANDOFF.md`: a part on the pool after "Speed (1.7.0)" — what runs where, why the reading cannot differ, every
  fallback, the numbers measured, what was tried and dropped; the file map's row for `src/pool.js`. `README.md`: a
  sentence where it speaks of speed, and `Nib.workers` beside `Nib.kernel`. `docs/plans/worker-pool.md` and this
  brief are marked done in `docs/plans/README.md`; `tools/pool/` is deleted (its checks are the suites' by then).
- `package.json` and the engine's version: 1.8.0.
- The repository's style: plain comments that say why, in the voice of those there; no new dependency; ESLint clean.
- Do not touch: the reading itself (`segment`, `finish`, the models), `kern.wat`, the scheduling outside what is
  described here.
- Never run two things that time themselves at once, and none of the Chrome tools beside the browser suites.

## Report back

What was built (files, the protocol, the limits and why), anything in this design that was changed and why, the
result of every check above (numbers), anything that failed or could not be verified, and anything noticed that is
wrong or risky outside this brief (listed, not fixed).
