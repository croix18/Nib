# tools/pool: the worker pool's prototype

The pool (`docs/plans/worker-pool.md`) is planned, not built. This folder is how its design was tried against the
released engine **without changing it**: what could go wrong was found here first, and the plan's numbers come from
here. When the pool is built these checks become the suites' and this folder is deleted.

| File | What it is |
| --- | --- |
| `lib.js` | the pool's parts, done from outside the engine: `needs(rec, strokes, options)` — the groups a recognizer's warm-up would classify first, without classifying them (the engine's own first loop, reached through its `oracle` option and a shadowed `probs`); `fill` — a classification put in the cache where `probs` would put it; the text a worker is started from (the engine's source, then a message handler); a small pool that runs jobs in chunks of 8 over `n` workers. Loads in node and in a page |
| `exact.js` | node: over the school problems, a recognizer whose cache was filled ahead from classifications made apart (through a structured clone both ways, as a worker's are) reads exactly what a cold one and a warmed one read — every field, every cache key, every bit — and how much of the work `needs()` lists. `node tools/pool/exact.js [every n-th] [options JSON]`, `KERNEL=js` for the JavaScript path |
| `proto.js` | Chrome, in five parts: **start** (a worker from the engine's own source through a Blob URL, from `file://` with no flags; how long, how much memory), **identity** (a full page's groups classified in workers and on the page's thread, on either path: the same bits), **read** (a board read as today, at once, and after a prefetch by 1 and 2 workers: the same reading and cache bits, what the pool takes, the times), **rules** (the same under a Content-Security-Policy over http), **inline** (the files that carry the engine inside their own HTML — the pages in `dist/`, and Deckhand's with `DECKHAND=path/to/Deckhand.html`: a worker from the source the page itself holds). `node tools/pool/proto.js [expressions = 120] [start,identity,read,rules,inline]` |

`proto.js` makes one change to a copy of the engine, in a temporary folder: the wrapper function gets a name, and a
way to read its own source (what `build.py` will do). `dist/nib.js` is not touched.

Run them alone on a quiet machine: `read` times things. Both exit 1 when something that must hold does not.

## What they said (Nib 1.7.0, Chrome 153, two cores, 15 November 2026)

```
$ node tools/pool/exact.js
700 problems, 6292 strokes, options {}, classifier simd (49 s)
  a warm-up classifies 10494 groups (1.67 a stroke); a cold read 10396
  needs() lists 10414 of them (99.2%): the pool's; 80 are left for the warm-up (0.8%)
  filled against cold and against warmed: 0 differences
```

(the same with `{"times":false}`; with `{"symbols":"all","smooth":2}` on every third; with `KERNEL=js` on every
twelfth)

```
$ node tools/pool/proto.js 120
— start: a worker from the engine's own source, from file:// with no flags
ok   the page: Nib 1.7.0, classifier simd, hardwareConcurrency 2
ok   the engine's own source through Function.toString(): 1434739 characters, the wrapper function exactly as the file has it
ok   two workers started in 89.5 ms (the source put together in 0.1 ms; each ready after 77.5 ms and 71.2 ms)
ok   in a worker: Nib 1.7.0, classifier simd, document not there, the custom element not defined
     a worker started again in the same page: 49.3 ms
     four more workers, each having classified: the page's process grows by 136 MB (34.1 MB a worker)

— identity: the groups of a full page, classified in two workers and on the page's thread
ok   1751 groups (76655 points): 0 differ between a worker and this thread, both on the kernel
ok   every 5th (351) with this thread on the JavaScript path and the workers on the kernel: 0 differ
ok   and with the workers on the JavaScript path and this thread on the kernel: 0 differ
     one group costs 1.19 ms on this thread and 1.15 ms in a worker; on the JavaScript path 14.0 ms

— read: a board of 120 expressions, cold, each way on a new page (three times each; the middle one)
     1039 strokes in 143 recognizers; a cold read classifies 1828 groups (1.76 a stroke)
ok   the same reading and the same bits in every cache entry, all 12 runs: yes (1828 entries, f7bb437d)
     as today (the pad's read, in slices): 3102 ms; all 1828 groups classified on this thread
     at once (recognize()): 2156 ms, this thread held for all of it
     1 worker: 2538 ms = plan 80.1 ms + pool 2170 ms + the read 328 ms; the pool took 1751 groups (95.8%), 77 stayed
     2 workers: 1664 ms = plan 70.0 ms + pool 1197 ms + the read 369 ms
          this thread spent 24.5 ms posting and 3.9 ms taking answers, and was held 14.6 ms at the longest
ok   what stays on this thread: 11 groups in the clusters' rehearsals and 66 in the groups joinOperands puts together
ok   the joined groups handed to the pool too, round by round: 65 more groups in 8 rounds; 12 then stay on this thread

— rules: the same page over http, under a Content-Security-Policy
ok   no rule: a worker started, on simd; 168 groups, 0 differ
ok   the site's rule for the two Nib pages: a worker started, on simd; 168 groups, 0 differ
ok   that rule with workers forbidden (worker-src 'none'): no worker — worker error event, known after 13.3 ms
ok   the site's rule for its other pages (no WebAssembly): this thread on js; a worker started, on js; 0 differ
ok   a rule without blob:: no worker — worker error event, known after 16.0 ms

— inline: the files that carry the engine in their own HTML, from file://
ok   Board.html: Nib 1.7.0; a worker from the source in the page is ready in 60.8 ms, on simd; 172 groups, 0 differ
ok   Replicator.html: … 54.7 ms, on simd; 172 groups, 0 differ
ok   Nib.html: … 53.8 ms, on simd; 172 groups, 0 differ
ok   Deckhand.html (Deckhand): … 53.8 ms, on simd; 172 groups, 0 differ
```

(lines shortened). With 20 and 60 expressions: `docs/plans/worker-pool.md`, "What the prototype showed".
