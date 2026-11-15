# tools/fuzz: the audit's probes

What the audit of 14 November 2026 threw at Nib (`docs/reviews/audit-2026-11-14.md`: what was checked, what was
found, what 1.6.7 fixed). Every finding that was fixed is pinned by `test/hardening_check.js` or
`test/hardening_browser.js`, which run in the suites; these are the wider nets those cases were caught with, kept so
the sweep can be made again after a large change. They take minutes, some of them many, and print a tally to be read
by a person: none is a suite.

| File | What it does |
| --- | --- |
| `run.js`, `child.js` | the runner: a file of cases against `dist/nib.js` in a child process with a watchdog (a case past the limit is a hang; the child is killed and the run goes on after it). `node tools/fuzz/run.js tools/fuzz/solve_cases.js [limit ms = 4000] [slow ms = 400]`; `NIB=` another engine, `OUT=` where the tally is written as JSON |
| `solve_cases.js` | 10,455 strings for `Nib.solve`: towers of powers, huge factorials, 100,000 nested brackets, a million characters, random token soup, odd values. Nothing may throw or hang; what comes back must be rows of `null` or `{latex, text}` |
| `api_cases.js` | 6,237 calls over the rest of the public API (recognize, classify, neaten, typeset, hand, memory, pack/unpack, PDF, shapes, colors, papers, scribble) with input that is not what it should be |
| `board_boot.js` | the Board opened with damaged data already in the browser's storage, 118 cases: each must start with no page error, read new writing, save, and come back after a reload. `node tools/fuzz/board_boot.js [filter] [pages at once = 4]` |
| `pages_boot.js` | the same for the Replicator and the demo page, 17 cases |
| `attr_fuzz.js` | 1,650 garbage values over the 33 attributes of `<nib-pad>` |
| `rec_scale.js`, `scr_scale.js`, `scr_legs.js`, `rep_scale.js` | how the time grows with the input: the recognizer on 25 to 200 strokes of four kinds; the scribble detector on one stroke of 500 to 16,000 points and of 200 to 8,000 legs; the Replicator's outline and font on letters up to 1,000 boxes outside theirs |
| `mutate.sh`, `mutate2.sh`, `mutate3.sh` | the mutation sample: one thing broken in a copy of the repository, rebuilt, and the suite that should notice run. `caught` is good; `MISSED` is a gap in the tests. The first is the 18 mutants of the audit (the suites of 1.6.6 missed 9); `mutate2.sh` tries the missed ones, and four of 1.6.7's guards taken out, against the tests 1.6.7 added (13); `mutate3.sh` two of those again. They build in `$TMPDIR/nib-mutrepo*` and take a suite run a mutant |

## Reading the tallies (Nib 1.7.0, 15 November 2026)

- `solve_cases.js`: 10,455 cases, no throw, no hang. One `SLOW` (a million characters: 0.7 s) and one `BAD RESULT`:
  the answer to `(x+y)^{24}=`, 409 characters, over the probe's own bound of 400. It is the right expansion.
- `api_cases.js`: 6,237 cases, `THREW: 123`, no hang, no bad result. The 123 are the errors the API raises on purpose
  for input it cannot take: `pdfMake: no pages` (36), `pdfMake: page 1 has no JPEG` (84), an unknown symbol set (3).
  Before 1.6.7 there were 287 others. Seven are `SLOW`: hundreds of strokes handed to `Nib.recognize` at once (up to
  2 s), and 600 symbols learned in a row.
- `attr_fuzz.js`: 1,650 values, none with an error. `pages_boot.js`: 17 cases, all clean.
- `board_boot.js`: 115 of 118 clean. The three: one stroke of 300,000 points, with which the Board takes 9 to 12 s to
  open (the audit's "Found and left"; 1.6.7 takes the same), and two whose damaged data the browser itself refuses to
  store (a memory of 5,000 symbols and a hand of 10,000-point letters are past the storage's quota), so the case never
  happens: `seed failed`. A case that raises a page error, never reads the new writing, or loses it over a reload, is a
  finding. The 3,000 strokes in one cluster that 1.6.7 was still reading after 45 s are read in time by 1.7.0.

Two of the probes' own mistakes were put right when they were moved here (15 November 2026): `api_cases.js` took
`Nib.scribble.covers` to answer a number (it answers counts, as documented), and `board_boot.js` waited for a reading
of every element where text, shapes and pictures have none, and on a board whose reading is off.
