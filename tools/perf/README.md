# tools/perf: where the time goes

The measurements behind `docs/HANDOFF.md`, Speed (1.7.0). They print numbers and assert nothing: a suite that fails on
a busy machine is worse than no suite, so the suites count things instead (`test/reading_browser.js`,
`test/kern_check.js`) and the timing lives here. Run one at a time, on a machine doing nothing else; on the two-core
machine the numbers move by a fifth from run to run.

| File | What it measures |
| --- | --- |
| `prof.js` | node: one cold read of N school problems (default 40), each its own `Recognizer` as a reload reads them — the time a stroke and an expression, and each layer of the classifier timed directly. `NIB=path/to/nib.js` for another engine |
| `split.js` | node: the same cold read split into the classifier (`Recognizer.probs`) and everything else. `KERN=js` for the JavaScript path, `REP=5` for more repeats |
| `live_perf.js` | the Board in Chrome with 20, 60 and 120 expressions on the page (`node tools/perf/live_perf.js 120`): how long the cold read takes, then what one more stroke costs — how long the page is held at the end of its read, at full speed and with the processor slowed 4× |
| `prof_live.js` | the same page under Chrome's CPU profiler while one stroke is read: the functions by self time and by total time (`TOP=40` for more) |
| `board_perf.js` | the Board under load: how long the page is stuck when a very long stroke is lifted (2,000 to 40,000 points), how long after a reload a full page's answers are back and whether the page answers input meanwhile, and a reading that throws |

`BOARD=path/to/Board.html` points the Chrome ones at another build of the Board (an older release, say, taken out of
git with `git show <commit>:dist/Board.html`).

## What they said (the two-core machine, 14 November 2026; 1.6.7 → 1.7.0)

- A classification: 16 ms → about 1 ms on the kernel (13 ms on the JavaScript path).
- A cold read: 28 → 1.9 ms a stroke, of which the classifier 1.75.
- The Board opened again with 20 / 60 / 120 expressions: 8.6 / 19 / 47 s → 0.8 / 1.5 / 2.9 s; with the processor
  slowed 4×: 31 / 69 / 168 s → 2.8 / 5.9 / 13.4 s.
- One stroke on a page of 120 expressions holds the page about 100 ms → 21–40 ms (4× slower: 470–570 → 46–82 ms).
- What is left at the end of every read, putting the pieces together and laying out the views: 3 / 7 / 16 ms.
