# tools/verify: one engine against another

The suites (`npm test`, `npm run test:browser`) hold fingerprints of what 1.6.7 read, so they notice a reading that
moved. They cannot say which reading, or compare two engines side by side over the full sample. These tools do: they
are how Nib 1.7.0 was shown to read exactly what 1.6.7 read before it was released, and how the next change to the
reader (the worker pool, `docs/plans/worker-pool.md`) is to be checked.

Everything here runs from a clone after `npm ci` and `npm run data` (the Chrome ones need Chrome at `$CHROME`, default
`/usr/bin/google-chrome`). Nothing here is part of the engine or of what ships.

## The tools

| File | What it does |
| --- | --- |
| `readall.js` | reads every expression (or every n-th) of a corpus with one engine in node: one JSON line each — the LaTeX, every symbol with its strokes, its top three candidates, the answers after "=", the confidence. `KERNEL=js` reads on the JavaScript path |
| `readings.sh` | `readall.js` over the reference sample: 16 runs, 5,605 expressions (the 700 school problems, the 239 Board rows, CROHME's test set and t12 whole, a third of the test set with `symbols: 'all'`, halves of t13, valid and synth_t13, a quarter of each stress set). `SETS="school board"` reads only those |
| `cmp.js` | two folders of such readings, file by file and expression by expression: how many differ in the LaTeX, the symbols, the answers, the candidates, and the largest difference in a confidence. Exit 1 when anything differs, 2 when there was nothing to compare |
| `session.js` | a scripted session on a board in Chrome, the same for any engine (a seed decides it): a page of expressions loaded, then writing stroke by stroke, Undo, Redo, moving, deleting and copying pieces, corrections, options and views changed, the board cleared, saved and opened. After every step one JSON line: the reading, the symbols, the pieces, the answers, the view's items with their boxes. Its 7th argument is a line of script run in the page first |
| `sessions.sh` | the ten reference sessions, each compared with its reference as it ends. Eight against 1.6.7 (`s1`–`s6`: 16 expressions, 30 steps; `big8`: 60 and 30; `big7`: 100 and 22; 640 steps in all). Two against 1.7.1 (`many9`, `many11`: 120 expressions and 22 steps, 112 steps in all, on pages that need 13 and 14 joins, with half of their moves taking one stroke off its symbol: what 1.6.7 and 1.7.0 read wrongly). `SESSIONS="s1 big8"` runs only those; `NIB_SESSION_INIT` is the line of script, `NIB_SESSION_ATTRS` more attributes for the pad |
| `cmpsess.js` | two recorded sessions step by step: which steps differ, and in what. A confidence that moved by 2.5e-6 at most is counted apart (engines whose arithmetic differs in the last bit). Exit 1 when a step differs |
| `engine.sh` | a released engine out of this repository's history (`dist/nib.js` at a commit) into `.engines/`, to compare with. 1.6.7 is `b84b93d`, 1.7.0 is `fc9b824` |
| `pages_probe.js` | pages that carry Nib, served over http the way a site serves them: which classifier runs under each page's own Content-Security-Policy, what the Board's Settings says, whether a rule was broken, and a reading. Each page is tried again with `'wasm-unsafe-eval'` taken out of its rule, which must fall back to JavaScript. Written for mrshaffer.org (`node tools/verify/pages_probe.js ../mrshaffer-site/public`) |
| `file_probe.js` | a file that carries Nib, opened from `file://` as a teacher opens it: which Nib is inside, which classifier it runs, whether it reads. For a file the engine was just put into, before it is pushed: `node tools/verify/file_probe.js ../deckhand/Deckhand.html dist/Board.html` |
| `joins_probe.js`, `moved_probe.js` | the two faults of `docs/reviews/found-2026-11-15.md`, each on pages made for it: does a board join every pair of pieces that belongs together, however many there are; is a symbol whose stroke was moved read where its strokes are now. Each exits 1 on an engine that has its fault (1.7.0 and before), 0 since 1.7.1; both take an engine as their last argument |
| `deckhand/playwright.system-chrome.config.js` | Deckhand's own Playwright suite run with the system's Chrome, for a machine where Playwright's Chromium cannot be downloaded (how 7.63.1 was checked before it was pushed) |
| `gold-1.6.7/` | the reference: what Nib 1.6.7 (`b84b93d`) read and did — `readings/` (16 files, 5,605 lines) and `sessions/` (8 files, 640 lines), gzipped, with `SHA256` (the hash, the lines and the bytes of each file unzipped) |
| `gold-1.7.1/` | what Nib 1.7.1 did in the two sessions 1.6.7 cannot be the reference for — `sessions/` (2 files, 112 lines), gzipped, with `SHA256` |

`.engines/` and `out/` are where the tools write; neither is committed.

## Checking a change to the reader

```
tools/verify/readings.sh dist/nib.js tools/verify/out/readings          # about 3 minutes
node tools/verify/cmp.js tools/verify/gold-1.6.7/readings tools/verify/out/readings
tools/verify/sessions.sh dist/nib.js tools/verify/out/sessions          # about 9 minutes, in Chrome
```

`cmp.js` must end `latex 0, symbols 0, answers 0, candidate lists 0`; `sessions.sh` must end `sessions: nothing
differs`. A change that is meant to move readings is another matter: then these say exactly which ones moved, and a
new reference is recorded on purpose (below).

Never run two of these at once on a small machine, or beside the browser suites: the sessions wait for the pad to
come to rest, and a starved page only makes them slow, but the suites that time things can fail.

## The reference, and making it again

`gold-1.6.7/` was recorded on 14 November 2026 with the engine at `b84b93d` (Nib 1.6.7, the last one before the
WebAssembly kernel), in node 22 and Chrome 153. It can be made again from the repository alone:

```
E=$(tools/verify/engine.sh b84b93d)                    # tools/verify/.engines/nib-b84b93d.js
tools/verify/readings.sh "$E" tools/verify/out/r167    # about 25 minutes: 1.6.7 classifies 16 times slower
tools/verify/sessions.sh "$E" tools/verify/out/s167    # about 20 minutes; must say nothing differs
```

and compared with what is committed (`cmp.js`; checked for the Board rows on 15 November 2026: 239 of 239 the same,
confidences included). A new reference (say `gold-1.8.0/`) is these three lines with another commit, the files
gzipped, and `SHA256` written the same way: `sha256  path  lines  bytes` for each file unzipped.
`test/verify_check.js` (in `npm test`) checks that the committed reference is what `SHA256` says and that `readall.js`,
`cmp.js` and `cmpsess.js` still do their work (a few seconds).

`gold-1.7.1/` was recorded on 15 November 2026 with Nib 1.7.1 as released
(`SESSIONS="many9 many11" tools/verify/sessions.sh dist/nib.js <out>` with no reference there yet, the two files
gzipped). The released 1.7.0 differs from it at 55 of 58 and 54 of 54 steps: those pages have more than the eight
joins it made. A session of this kind needs `NIB_SESSION_STROKES=1` when it is run by hand (`sessions.sh` sets it for
the two).

## What they showed for 1.7.1 (15 November 2026)

- **Readings**: 5,605 of 5,605 as 1.6.7 read them; the largest difference in a confidence 2.3e-7, as for 1.7.0.
- **Sessions**: the eight of 1.6.7, 640 of 640 steps the same: none of their pages has more than eight joins, and
  none of their moves takes a stroke off its symbol, so nothing in them was touched by the two fixes.
- **The two faults**: `joins_probe.js` ends `every page was joined to the end` and `moved_probe.js`
  `moved ink is read where it is`; with 1.7.0 both exit 1 (`docs/reviews/found-2026-11-15.md` has the tables).
- **The pool's prototype** (`tools/pool/exact.js`) still holds on 1.7.1: a cache filled ahead reads what a cold read
  reads, 0 differences.

## What they showed for 1.7.0 (14 and 15 November 2026)

- **Readings**: 5,605 of 5,605 the same as 1.6.7's — LaTeX, every symbol's label and strokes, the answers, each
  symbol's top three candidates. The largest difference in a confidence: 2.3e-7 (the arithmetic was defined anew, see
  `docs/HANDOFF.md`, Speed (1.7.0)). With the JavaScript path forced (`KERNEL=js`), the school problems, the Board
  rows and a third of the test set (1,339): the same, and line for line what the kernel gives.
- **Sessions**: 640 of 640 steps the same; in some the confidence moved in its seventh digit.
- **The site's pages** (`pages_probe.js`, 15 November): the Board, the Replicator and Deckhand's copy run Nib 1.7.0 on
  the kernel under the site's rules; the Board under the rule it had before falls back to JavaScript, which is why the
  site's rule for the two Nib pages now carries `'wasm-unsafe-eval'`.
- **Deckhand 7.63.1** (Nib 1.7.0 inside): 379 of its 380 tests with the system's Chrome on two workers; the one left
  (v7.42, a clicker test that is sensitive to load) passes alone, with the new engine and with the old.
