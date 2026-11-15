# The worker pool: a full page read on every core

**Planned for Nib 1.8.0. Not built**: nothing in `src/` or `dist/` knows of it. What is here is the design as
decided, the measurements it rests on (`tools/pool/`, a prototype that runs against the released engine without
changing it; 15 November 2026, Chrome 153 on a two-core machine), the order to build it in, and the checks it has to
pass. The instruction to build from is `briefs/worker-pool-build.md`.

## Why

Since 1.7.0 a classification costs about a millisecond, and nothing is classified with the page held. What is left is
the page that arrives all at once — the Board opening a saved board, a large paste, Undo of a Clear — with nothing in
the recognizers' caches. Every stroke group is classified then, 1.75 a stroke, on the page's thread, 14 ms at a time:

| A board of | strokes | classifications | read today |
| --- | --- | --- | --- |
| 20 expressions | 169 | 303 | 0.6 s |
| 60 expressions | 426 | 742 | 1.2 s |
| 120 expressions | 1,039 | 1,828 | 3.1 s |

on this machine, and in proportion on a slower one (with the processor slowed 4×, the Board takes 13 s to bring back
120 expressions). The page's thread is busy for all of it, and a stroke written meanwhile stops the read until the
pen rests again. The devices this is for have four to eight cores, and the read uses one.

## What it will do

The classifier work of a big read runs in worker threads, on every core but one, and goes on while the writer
writes. The reading that comes out is the one the page's thread alone gives. Where workers cannot run, nothing
changes. Small reads — ordinary writing — never touch the pool.

## The design

**The pool only fills caches ahead of the read.** A classification is a pure function of the strokes of a group and
the size they are classified at (`classifyGroup(group, ref)`, `src/core.js`). `Recognizer.warmup` begins by
classifying every candidate group of the segmentation (its first loop), and finding those groups takes no classifier
result: only the strokes, their boxes, the join model and the options. So that list can be made first, classified
elsewhere, and put in the cache; the read then runs exactly as it does today and finds the work done.

1. **The recognizer says what it needs, and takes what it is given.**
   `Recognizer.needs(input, options)` does what `warmup` does up to and through its first loop, except that it does
   not classify: it returns the groups that loop would classify now (those not in the cache), each with its cache
   key, and the size and bucket they would be classified at. `warmup`'s first loop and `needs` are one enumeration,
   so they cannot drift apart; `needs()` then `warmup()` leaves the recognizer as `warmup()` alone does.
   `Recognizer.fill(key, bucket, ref, entry)` puts a classification where `probs` would have put its own — the same
   key, the same rule for a full cache — and only if **no entry is there** and **the recognizer still classifies at
   that size** (`this.cref === ref`). The second condition keeps the cache's one invariant: an entry was computed at
   the recognizer's size when it was stored.

2. **The engine is its own worker.** `build.py` names the engine's wrapper function (`NibEngine`), so the engine can
   read its own source (`NibEngine.toString()`) and start a worker from a Blob URL:
   `'self.__nibWorker = 1; (' + source + ')(self);'`. Started that way, the engine answers messages
   `{id, jobs: [{g, ref}]}` with `{id, out: [{p, h}]}`: each job's `classifyGroup(g, ref)`, the probabilities
   (`Float64Array(104)`) and the hidden vector (`Float32Array(192)`) transferred. Groups go as they are; structured
   clone keeps every number exact. One file still, no second download, works from `file://` and offline.

3. **The pool** (`src/pool.js`; nothing of it runs at engine start):
   - made on first use; `max(1, min(4, hardwareConcurrency − 1))` workers, and no more than
     `floor(navigator.deviceMemory)` where the browser says it (a worker costs about 34 MB: below);
   - `run(jobs)` → a Promise; the jobs are cut into chunks of 8 groups that idle workers take from one queue, so a
     big request spreads over all workers, slow cores take less, and requests interleave in the order given;
   - **every failure ends in the same place: the caller is told "not done" and classifies on the page's thread, as
     today.** No `Worker`, `Blob` or `URL.createObjectURL`; `new Worker` throws; the worker fires `error` (that is
     how a page whose Content-Security-Policy forbids it shows, 15 ms after `new Worker`, which itself does not
     throw in Chrome) or does not say it is ready within 4 s; a chunk is not answered within 20 s; an answer of the
     wrong shape. The pool is then dead for the page's life: workers terminated, every request resolved as not
     done, one `console.info` line. A dead pool is never tried again;
   - workers idle for 30 s are terminated, and started again by the next request;
   - `Nib.workers`: how many are running now. `Nib._internals.poolUse(n)` for tests: `0` turns the pool off, a
     number sets how many workers, `'auto'` puts it back.

4. **The pad asks ahead, then reads as it does now.** In `_schedule`, when the read's timer fires and before the
   steps begin:
   - *is it worth asking?* When the clusters whose reading is not kept (`this.parts`, `_badParts`) have few strokes
     between them (under about 60: some hundred groups), or the pool cannot run, go straight to the steps. An
     ordinary read — a stroke, an expression — is not even planned;
   - *drop and wait*: requests of a cancelled read that are still queued are taken out when their strokes are no
     longer on the pad (a page cleared or replaced while it was being read must not make the next one wait); for the
     rest, wait until they are answered;
   - *plan*: for every such cluster, `needs()` on the recognizer the pad keeps for it (`_recFor(st[0])`, with the
     options `_partsPass` gives `warmup`). In slices of 14 ms, as the read is: planning runs the stroke clean-up and
     the join model for every stroke (70 ms for 120 expressions here);
   - *decide*: when what is listed is less than about 150 ms of work for this thread (it knows what its own
     classifications have been costing), go to the steps;
   - *run*: `pool.run` all of it. As answers come they are filled in — if the recognizer is still the one the pad
     holds for that stroke (`this.recs.get(first) === rec`; the pad replaces its recognizers when ink is resized) —
     whatever has become of the read meanwhile;
   - *read*: when every request is answered, or the pool has died, the steps run as they do today. They find the
     first loop's groups in the caches, rehearse, classify what is left (below) in slices, and announce.
   - **New ink does not waste the work.** A read that is cancelled leaves its requests running and their answers
     are kept; the next read waits for them and asks only for what is still missing. A page opened cold keeps being
     classified while the writer writes.
   - `recognize()`, the synchronous read, never waits: it classifies what is missing on this thread, and an answer
     that comes later for a group it classified is dropped by `fill`.
   - A pad of one expression (`separate` off) gets the same when its read is big.
   - `pad.busy` is true from `_schedule` to the announcement, the asking included, and `res.ms` covers it.
   - The Board's line at the foot of Settings says how many workers the pool may use ("Nib 1.8.0 · the fast reader
     is on · 3 at once"): the only way to learn what a classroom panel gives it.

Nothing else changes: no option, no event, no field of a result, nothing in `segment`, `finish`, the models or the
kernel.

## Why no reading can differ

1. A classification depends on the group's strokes and the size, and on nothing else: no option, no state. The
   kernel and the JavaScript path give the same bits (`test/kern_check.js`), and so does a worker: 1,751 groups of a
   full page classified in workers and on the page's thread, with each of the two on either path — **0 differ**.
2. The read asks for classifications through one door, `probs`, which looks in the cache first. An entry under the
   same key and bucket, computed for the same strokes at the size `probs` would have used, is the entry `probs` would
   have made. `fill` stores nothing else.
3. `needs()` is the warm-up's own first loop with the classifying left out, so the groups, keys and size are the
   warm-up's.
4. So a read after a prefetch runs today's code on the cache contents today's read would have made for itself.
   Measured with the prototype, where `needs` and `fill` are done from outside the engine:
   - 700 school problems, each read cold, warmed, and filled from classifications made apart (through a structured
     clone both ways, as a worker's are): the same reading in every field, the same cache keys, the same bits in every
     entry — 0 differences; the same with `times: false`, with `symbols: 'all'` and smoothing, with corrections, and
     on the JavaScript path (`tools/pool/exact.js`);
   - a board of 20, 60 and 120 expressions read by the pad as today, at once, and after a prefetch by one and by two
     workers, each on a new page: one reading and one set of cache bits (1,828 entries at 120), in all 42 runs
     (`tools/pool/proto.js`).
5. Everything else the pool does is failure handling, and every failure ends with this thread classifying.

**What this does not claim.** What is in a recognizer's cache depends, today, on which reads ran: a read cut short by
new ink leaves its classifications behind, at the size the piece had then, and a later read at a size within the same
2.5% bucket finds them. With the pool, a read cut short leaves *all* the classifications it asked for behind, not
only those its slices had reached. Both are readings the engine gives for that ink; they can differ in a confidence's
last digits and, for a symbol on the edge between two readings, in the symbol — as a fast machine and a slow one can
today. Where every read is let come to rest — the scripted sessions of `tools/verify`, and the suites — the pool
must give the reference's readings step for step, and that is the check.

## What the prototype showed

`node tools/pool/proto.js` (four parts; it exits 1 when something that must hold does not) and
`node tools/pool/exact.js`.

**It starts.** A worker made from the engine's own source through a Blob URL starts from a `file://` page with no
flags. The engine loads there as it is (no `document`, no custom element, nothing thrown), on the kernel.
`Function.toString()` gives the wrapper function exactly as the file has it (1.43 MB) in a tenth of a millisecond.
Two workers are ready 90 ms after they are asked for (50 ms each once the page has made one before).

**It takes nearly all of the work.** Of a cold read's classifications, the warm-up's first loop — the pool's share —
is 99.2% for an expression alone (10,414 of 10,494 over the school problems) and 94 to 96% on a board:

| A board of | pool | left: the rehearsals | left: joined pieces |
| --- | --- | --- | --- |
| 20 expressions | 285 of 303 | 1 | 17 |
| 60 expressions | 696 of 742 | 6 | 40 |
| 120 expressions | 1,751 of 1,828 | 11 | 66 |

What stays is what cannot be listed ahead: the few groups only a rehearsal asks for, and the pieces `joinOperands`
puts together, which are known only once their parts are read.

**The page's thread is free.** Handing 1,751 groups to the workers costs it 20 ms in all (posting 219 chunks) and
taking the answers 4 ms; while the pool runs it is never held longer than 15 ms. Planning costs 70 ms at once (to be
sliced), and the read that follows 0.33 s (sliced as today).

**The times** (the middle of three runs each, every run on a new page; the workers' start, 60 to 75 ms, not counted):

| A board of | today, in slices | at once | 1 worker | 2 workers |
| --- | --- | --- | --- | --- |
| 20 expressions | 575 ms | 408 ms | 483 ms | 346 ms |
| 60 expressions | 1,247 ms | 930 ms | 1,011 ms | 706 ms |
| 120 expressions | 3,102 ms | 2,156 ms | 2,538 ms = 80 + 2,170 + 328 | 1,664 ms = 70 + 1,197 + 369 |

(= planning + the pool + the read after it.) This machine has two cores: one worker is what the pool would use here,
and "2 workers" has both cores classifying while the page's thread waits. A group costs 1.15 ms in a worker and
1.19 ms on the page's thread. The times move by a tenth and more from one run of the whole to the next: a second
run gave 3,039, 2,383, 2,752 and 1,434 ms for the 120.

**It runs where the pages are.** Over http under the site's rule for the two Nib pages
(`default-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' data: blob:; …`) a worker starts, on the kernel: the site
needs no change. With `worker-src 'none'`, or without `blob:`, no worker starts and the page knows 15 ms later.
Under a rule without WebAssembly both the page and the worker fall back to JavaScript, and still agree bit for bit.

## What to expect

From the pieces measured at 120 expressions — 2.06 s of classification to share out, 0.08 s of planning and 0.37 s
of reading that stay on the page's thread:

| Workers | The device | 120 expressions read in | Of today's 3.1 s |
| --- | --- | --- | --- |
| 1 | two cores | 2.5 s (measured) | 82% |
| 2 | (both cores of this machine) | 1.7 s (measured) | 54% |
| 3 | four cores | about 1.15 s | 37% |
| 4 | eight cores (the pool stops at 4) | about 0.95 s | 31% |

The last two rows are arithmetic, not measurements: they assume cores as fast as each other, which a tablet's are
not. Expect **a third to two fifths of today's time on the panel and the tablet**, not a quarter: a seventh of such a
read is not classification (0.45 s of the 3.1) and stays where it is.

And on every device, one worker included: the page's thread is busy for about half a second of the read instead of
all of it, and writing during it no longer starts it over.

## What it costs

- **Memory.** Four workers that have each classified grow the page's process by 136 MB: **34 MB a worker** (its own
  copy of the engine's source and model, the kernel's 3 MB, and a JavaScript heap). They exist only around a big
  read and go 30 s after. This is the one cost worth a thought on the panel; see "Open".
- **Starting.** 60 to 95 ms here before the first group is classified, several times that on slow hardware. It is
  why a small read never uses the pool, and why workers are kept for 30 s.
- **Size.** The engine's file grows by the pool's own code, a few kilobytes; the worker is the same file.

## Building it

In this order; each step can be checked alone, and the build is not to go on while one fails.

1. **`Recognizer.needs` and `fill`** (`src/recognize.js`), with `test/pool_check.js` in `npm test`: what
   `tools/pool/exact.js` checks, on the engine's own methods; `needs()` then `warmup()` against `warmup()` alone;
   `fill` never replaces, and refuses an entry for another size.
2. **The engine as a worker** (`build.py`: the wrapper named; the worker's message handler at the end of the engine):
   in Chrome from `file://`, it starts, classifies, and agrees bit for bit on both paths (`tools/pool/proto.js`,
   "start" and "identity", moved into `test/pool_browser.js`).
3. **`src/pool.js`**, with every failure tried: a rule that forbids workers, a worker killed mid-request, a pool that
   never answers, `poolUse(0)`, node.
4. **The pad** (`_schedule`, and what it needs to keep of requests in flight), with the checks 3 to 6 below in
   `test/pool_browser.js`.
5. The Board's line, `Nib.workers` in the README beside `Nib.kernel`, a part on the pool in `docs/HANDOFF.md`,
   version 1.8.0.
6. The checks below, then the release as 1.7.0 went: Windmill's kit (`nib/`), Deckhand (a public deploy), the site
   (`tools/sync.py`; its rule already allows the pool).
7. `tools/pool/` is deleted: its checks are the suites' by then.

## The checks before it is released

1. **Every reading of the sample**, node (no workers there: this shows `needs`/`fill` and the wrapper's name moved
   nothing): `tools/verify/readings.sh dist/nib.js tools/verify/out/readings`, then `cmp.js` against the reference →
   `latex 0, symbols 0, answers 0, candidate lists 0`.
2. **Every step of the scripted sessions**, Chrome, three times: with the pool as it comes
   (`tools/verify/sessions.sh dist/nib.js tools/verify/out/s-auto`), off
   (`NIB_SESSION_INIT="Nib._internals.poolUse(0)" …`), and with two workers (`…poolUse(2)`: on a two-core machine
   the pool has one by itself) → `sessions: nothing differs` each time. Each session opens with a page of 16 to 100
   expressions, which is where the pool runs.
3. **The bits of a pooled read**: on a page of 60 expressions or more, the entries a pooled read leaves in the
   recognizers equal, bit for bit, those a read on the page's thread leaves; also with this thread forced to the
   JavaScript path and the workers on the kernel.
4. **Every fallback, in Chrome**: `worker-src 'none'` → the page reads as before, one info line,
   `Nib.workers === 0`; a worker killed in the middle of a page's read → the right reading; a pool that never answers
   → the read finishes on this thread after the limit; `poolUse(0)` → no worker is ever made; node → no pool,
   nothing thrown.
5. **The page's thread is free**, counted and not timed: of the groups classified in the cold read of a 60-expression
   page, at least 90% in workers.
6. **Writing during a cold read**: strokes written while a page of 60 expressions is being read cold do not start
   its classification over (each group is asked of the pool once), and the reading when the pen rests is the right
   one. A page replaced while it is being read cold: the new page's read does not wait for the old page's groups
   (counted: the pool classifies at most the chunks its workers already held).
7. `npm test`, `npm run test:browser`, `npm run lint`, `node tools/build_kern.js --check`, the pages rebuilt;
   `test/reading_browser.js` (the 1.6.7 session fingerprint) unchanged, with the pool on.
8. The times above measured again on the build, with the pool on, off and at two workers
   (`tools/perf/live_perf.js`), and the longest hold of the page's thread during a 120-expression read.

No test may assert a time: the suites run on slow machines. They count.

## Open, for Croix

1. **The two faults found on the way** (`docs/reviews/found-2026-11-15.md`): a page gets at most eight joins, and a
   symbol whose strokes were moved apart keeps its old reading. Neither is the pool's, but the first should be fixed
   **before** the pool is built: the pool is judged against a recorded reference, that fix moves the reference on
   crowded pages, and it makes joined pieces a larger share of a full page's work (which the pool could then take
   too). Suggested: both as Nib 1.7.1, with a new reference, then the pool as 1.8.0.
2. **Memory on the panel.** Up to four workers, 34 MB each, for the length of a big read and half a minute after. If
   the panel is short of memory the cap comes down to 2 or 3; the Board's line will say what the panel reports once
   the pool is there, and nothing needs deciding before then.

## After the first build

- **Joined pieces to the pool as well.** Tried in the prototype: the pieces `joinOperands` puts together, handed
  to the pool round by round as the read finds them, leave 12 of 1,828 groups on the page's thread instead of 77,
  with the same reading and bits. It makes the read wait for the pool in its middle, once a round, for 4% of the work
  as joins stand today. Worth it once a page can have more than eight joins.
- **A page that is set is read at once.** `setState` waits out the pen's delay before it reads, as a stroke does;
  there is no pen to wait for. Independent of the pool.
- **A worker's 34 MB.** A worker needs neither the JavaScript path's copy of the weights nor the engine's text once it
  runs on the kernel; what it could give back was not measured.
