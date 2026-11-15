# Plans

What is planned for Nib and not built yet, and the briefs the last pieces of work were done from. `docs/HANDOFF.md`
is what Nib is; `docs/reviews/` what was found in it; this folder what comes next and how it is to be judged.

| File | What it is |
| --- | --- |
| `worker-pool.md` | **the next subsystem**: a full page read across the processor's cores. The design as decided, why no reading can differ, what the prototype measured (`tools/pool/`), the order to build it in, and the checks it must pass before it is released. Not built: nothing in `src/` or `dist/` knows of it |
| `briefs/worker-pool-build.md` | the instruction to build it from, for whoever does (a person or an agent): `worker-pool.md` in the form of a task |
| `briefs/1.6.7-hardening.md` | done — the brief the fixes of the audit were made from (Nib 1.6.7, `docs/reviews/audit-2026-11-14.md`) |
| `briefs/1.7.0-classifier.md` | done — the classifier in a WebAssembly kernel (Nib 1.7.0, `docs/HANDOFF.md`, Speed (1.7.0)) |
| `briefs/1.7.0-review-of-the-boards-read.md` | done — the independent review asked for of the board's read as steps, before it was pushed; its four findings were fixed and are pinned in `test/reading_browser.js` |

The three done briefs are kept as they were given, so they name the scratch folders the work was done in. What they
point at is in the repository now:

| In a brief | Here |
| --- | --- |
| `/tmp/speed/readall.js`, `cmp.js`, `session.js`, `cmpsess.js` | `tools/verify/` |
| `/tmp/speed/runset.sh`, `runrest.sh` | `tools/verify/readings.sh` |
| `/tmp/speed/gold/`, `/tmp/speed/sess/gold/` | `tools/verify/gold-1.6.7/readings/`, `sessions/` |
| `/tmp/speed/nib-1.6.7.js` | `tools/verify/engine.sh b84b93d` |
| `/tmp/speed/prof.js`, `prof_live.js`, `live_perf2.js`, `work/split.js` | `tools/perf/` (`live_perf2.js` is `live_perf.js`) |
| `/tmp/fuzz/` | `tools/fuzz/` |
| `/tmp/speed/kern.wat`, `bench_kern.js` (the kernel's first sketch) | became `src/kern.wat`, `tools/build_kern.js` and `test/kern_check.js` |
| `/tmp/speed/wtest.js` (WebAssembly in a worker from `file://`) | became `tools/pool/proto.js` |
| `/tmp/speed/site/probe.js`, `dh_probe.js`, `dh.config.js` (the site's pages, Deckhand's file, Deckhand's suite) | `tools/verify/pages_probe.js`, `file_probe.js`, `deckhand/` |
| `/tmp/speed/refsess.sh`, `refsess2.sh` (recording 1.6.7's sessions) | `tools/verify/sessions.sh` with the engine from `engine.sh` |
| one-off probes (`arrow_probe.js`, `engineline.js`, `session_dbg.js`) | not kept: what they found is pinned by `test/board_canvas_browser.js`, `test/kern_browser.js` and `test/reading_browser.js` |
| `/tmp/speed/variant/` (1.6.7 with the new arithmetic, to count what it moves) | not kept: its result is in Speed (1.7.0), "The arithmetic", and the kernel's own tests hold the arithmetic now |

## How a plan here is meant to be used

Before the pool: `docs/reviews/found-2026-11-15.md`, two faults found while it was prepared. They are not the
pool's, and the plan says why the first should be fixed before the pool is built.

A plan says what is decided and what is still open, and names the commands that judge the result. The rule the last
two releases were held to, and the pool will be: **a change to how fast Nib reads may not change what it reads**, and
that is shown, not argued — `tools/verify/` compares every reading of the sample and every step of the scripted
sessions with the release before.
