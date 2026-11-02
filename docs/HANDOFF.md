# Nib — handoff

Read this before changing anything. It is the project memory: what Nib is, how it works, how it was trained and tuned, how to rebuild it, and where it is weak.

## What it is

Nib turns live handwriting (pen, finger or mouse strokes) into LaTeX, in the browser, with no network and no dependencies. It ships as one file, `dist/nib.js` (about 850 KB including the models), so it can be pasted into any single-file tool (Deckhand, Cadence, Tally, Boards Up, the practice tests) and run from Drive over `file://` on the classroom Chromebox. `dist/Nib.html` is a self-contained tester with everything (fonts, KaTeX) inlined.

It reads ink, not photos. A photo of paper is a different (much harder) problem and is out of scope.

## Files

| Path | What |
| --- | --- |
| `src/core.js` | helpers, rasterizer, trajectory features, network inference (int8 weights), the two small MLPs, feature functions, symbol sets, personal memory |
| `src/recognize.js` | `Recognizer`: segmentation, symbol fix-ups, layout (roots, fractions, lines, baselines), context model, output |
| `src/pad.js` | `Pad` (canvas writing surface, time-sliced reading) and the `<nib-pad>` custom element |
| `src/api.js` | the public `Nib` object |
| `build.py` | quantises the model and writes `dist/nib.js` (sources wrapped in one IIFE, data inlined) |
| `demo/` | `template.html` + `build_demo.py` (+ `sample.json`, one real expression) → `dist/Nib.html` (offline) and `dist/artifact/nib.html` (CDN fonts and KaTeX) |
| `training/` | everything that produced the models; see `training/README.md` |
| `test/` | `eval.js` (CROHME accuracy), `eval_synth.js` + `compose.js` (middle-school expressions composed from real handwriting), `tune_all.js` / `tune.js` (weight search), `memcal.js` (memory calibration), `browser.js` (headless page check with timings), `np_forward_v2.py` (JS↔Python parity) |
| `tools/push.sh` | commit and push from a Claude session (token in the git-ignored `.github-token`) |

## Pipeline

1. **Strokes in.** Arrays of `[x, y]` (or `{x, y}`, or `{points}`), y down, any units. Consecutive duplicate points dropped.
2. **Scale.** `ref` = median over strokes of max(width, height). Every threshold below is in units of `ref`. The classifier sees a size reference that is held steady while the same ink keeps growing (changes only when the writing's scale moves more than ~15%), so earlier symbols are not re-classified after each stroke.
3. **Segmentation.** Dynamic programme over time-ordered strokes (a symbol is 1–4 consecutive strokes whose boxes stay within 1.2·`ref`; only 0.5% of CROHME symbols break time order). A group is scored by the network's not-junk probability (weight `wJunk`; the network has a `junk` class trained on stroke groups that span two symbols), its best class probability (`wClass`), the stroke-join model (P(stroke k and k+1 belong together) from 16 geometric features, weight `wJoin`) and a per-symbol cost (`beta`). Boundaries the join model is very sure of are not crossed (`prune`). Two rules: a tiny mark at the baseline corner of a digit or letter is its own decimal point (`dotPen`), and two tall arcs after an open bracket are `)(` not `x` (`parenPen`). The DP keeps label states, so an optional writing-order context term (`lmSeg`) can score labels while segmenting; it did not help in tuning and is off.
4. **Classifier.** Each group is seen two ways. (a) Rendered to 4 orientation channels (0/45/90/135°, undirected, so stroke order and direction do not matter) on a 32×32 grid → 5 conv layers (24-48-48-96-96) with 3 max-pools. (b) Its pen path resampled to 48 points (x, y, direction, new-stroke flag) → three 1-D conv layers (32-64-64), max- and mean-pooled. Both, plus 5 scalars (aspect, size relative to `ref`, stroke count, ink length), feed FC 192 → 104 classes (101 CROHME symbols + `%` + `$` + `junk`). Int8 weights with per-channel scales, dequantised at load. `rasterize()` / `onlineFeatures()` in `core.js` mirror `training/raster.py` / `training/online.py` (parity: max pixel difference 1/255; probabilities within 0.016 of the float model; top-1 agreement 299/300).
5. **School prior.** The network learned CROHME's symbol frequencies (university maths: many letters). With `symbols: 'school'` each class probability is re-weighted by (frequency in a middle-school corpus / frequency in CROHME)^`prior` (table `DATA.prior.school`, built by `training/prior.py`; ratios run from 0.2 for rare-in-school symbols to 5.2 for digits).
6. **Symbol fix-ups.** Two stacked dots → `:`; `-` over `-` → `=`; `+` over `-` → `±` (only when nothing sits directly above or below the pair, so fraction bars are safe).
7. **Layout.** In order:
   - square roots, largest first: body = units right of the check mark's lowest point and under the overline (grows when a nested root is found; fraction bars under it and units starting below it are excluded); index = a small unit up and to the left;
   - fraction bars, widest first: a `-` with units clearly above and below it within reach (bar line fitted through the stroke, so sloped bars work), numerator/denominator grown by stacking and by running past the bar ends; operators at the very ends of the bar and units that straddle it are excluded; rejected unless both sides are roughly centred on the bar;
   - lines: units grouped into horizontal bands; a band of up to four small units, each sitting just above and right of a symbol in the line below (or right after the previous one), is merged back as exponents — anything else is a new line (so a short answer line like `88` stays its own line);
   - absolute value: two tall straight strokes read as `1`/brackets that hang below the line of characters and that the classifier finds bar-like are paired into `| |` (`barH`, `barW`);
   - baselines: units sorted by centre x; each unit is Right / Sup / Sub of the current baseline unit by the relation model (MLP over box geometry, typography class and digit/letter flags) with hard rules: operators and open brackets take no scripts; relations are never scripts; a leading minus joins the exponent it starts; a digit after a digit is an exponent only when clearly raised; a cross between two numbers is a times sign and takes no subscript.
8. **Personal memory.** `Pad.relabel` (the "did you mean" menu) stores the corrected symbol's 192-number embedding with its label in localStorage (`nib-memory-v1`, 400 max). A later symbol whose embedding is nearly identical (cosine 0.88 → 0.96 ramps the pull from 0 to 0.8) has its probabilities pulled toward the remembered label. Ink itself is not stored. `Nib.memory.clear()` forgets. Calibrated with `test/memcal.js` on the 2013 writers: corrections fixed 170 later mistakes and disturbed 49 correct readings (5,627 symbols).
9. **Context model.** Viterbi over each row's symbol candidates with a bigram model (CROHME rows + 30,000 synthetic middle-school expressions, weight `lm`), then a final layout pass if any label changed.
10. **Post-layout.** A dot on the baseline is a decimal point, a raised dot is `\cdot`; a small raised circle after a digit or `)` is a degree sign (`degrees`); `x` between two numbers is `\times`.
11. **Output.** LaTeX (KaTeX/MathJax-ready), plain text, per-line tokens, the tree, each symbol with box and candidates, a confidence.

The pad reads in time slices: `Recognizer.warmup()` classifies the stroke groups the DP will need one at a time (newest ink first) and the pad runs it ~14 ms per slice between frames; new ink cancels a read in progress. `Nib.recognizeAsync()` does the same for whole expressions.

## Training data and models

- **CROHME** (online handwritten maths expressions, InkML with symbol-level segmentation and MathML ground truth). CROHME 2019 from the GitHub mirror `Mahdiyeh-Asgharpour/CROHME2019` (train 8,901; CROHME 2014 test 986; CROHME 2019 test 1,199) and the CROHME 2012 and 2013 test sets from `ThomasLech/CROHME_extractor` (488 + 671, not part of the 2019 release). Splits: **train** = 2019 train + 2014 test + 2012 test (10,375 expressions, ~102k symbols); **tuning** = 2013 test (671) and `synth_t13` (700 school expressions composed from the 2013 writers' symbols); **reported test** = 2019 test (1,199) and `test/school_synth.jsonl` (700 composed from the 2019 test writers), never used for training or tuning. CROHME is distributed for research use; the models here are derived from it.
- Classifier v2 (shipped): 14 epochs over six augmented renderings + one clean, AdamW, cosine schedule, label smoothing, class weights; 90.4% symbol accuracy (99.0% top-3) on the 2013 writers over all 101 classes. v1 (a smaller raster-only CNN on less data) reached 59.7% / 75.7% on the two tuning sets where v2 reaches 61.8% / 80.6% before tuning.
- Join and relation MLPs (scikit-learn): 95.3% and 97.1% on the 2013 writers.

## Tuning knobs (options to `recognize`)

All tuned by grid search on the two tuning sets (mean of the real and composed exact-match rates).

| Option | Default | Effect |
| --- | --- | --- |
| `symbols` | `'school'` | allowed classes; `'all'`, `'numbers'`, or an array of labels |
| `prior` | 0.5 | strength of the school prior (only for `symbols: 'school'`; 0 = off) |
| `wJunk`, `wClass`, `wJoin`, `beta` | 2, 1, 0.2, 0.5 | segmentation scoring (see Pipeline 3) |
| `prune` | 0.03 | skip stroke groups across a boundary the join model is this sure about (halves classifier calls, no accuracy change) |
| `dotPen`, `parenPen` | 3, 3 | decimal-point and `)(` rules |
| `lm` | 0.35 | context-model weight (0 = off) |
| `lmSeg` | 0 | writing-order context during segmentation (off) |
| `size` | 0 | height-consistency term in the context model (hurt in tuning, off) |
| `maxGap` | 1.6 | furthest a numerator/denominator may sit from its bar, in `ref` |
| `barH`, `barW` | 1.1, 0.15 | absolute-value bar: height vs. the line's characters, width/height |
| `lines`, `degrees`, `memory` | true | split lines; degree signs; apply remembered corrections |
| `fix` | — | `[{strokes: [indices], label}]` forces a symbol (used by `Pad.relabel`) |

## Results

Measured on the CROHME 2019 test writers, never used for training or tuning (`node test/eval.js test full school`, `node test/eval_synth.js`, `node test/eval.js test full all '{"symbols":"all","prior":0}'`):

| Set | Expressions | Exact | Detail |
| --- | --- | --- | --- |
| Middle-school maths composed from those writers' real symbols | 700 | 86.7% | token error 3.1%; arithmetic 90, equations 89, inequalities 92, fractions 89, powers 94, roots 95, percents/money 93, ratios 90, formulas 83, multi-line 77, absolute value 46 |
| Real expressions in middle-school notation | 546 | 69.0% | structure right 82.6%; symbols segmented right 98.7%, labelled right 95.6% |
| Full CROHME 2019 test, all symbols, no school prior | 1,187 | 55.6% | structure 68.8%; symbols 98.2% / 93.7% |

The full-set figure is in the range published research models report on this benchmark (most of those read images, not ink, and run on servers). On the tuning sets the shipped engine reaches 63.9% (real 2013 school-style) and 87.3% (composed from the 2013 writers); the first version of the engine (v1 network, untuned) reached 59.7% and 75.7%.

Speed (headless Chrome on a 2-core server, shared with other work): the 14-stroke sample is read 0.9 s after navigation including page load; a 6-symbol expression is ready 0.75 s after the last pen-up, of which 0.45 s is the deliberate rest delay. In Node a whole 8–20-stroke expression takes 0.35–1.2 s from cold and about 10 ms once its strokes are cached.

## Known weak spots

- Letter/number look-alikes without context: `q`/`9`, `s`/`5`, `z`/`2`, `b`/`6`, `P`/`p`, `V`/`v`. The school prior leans toward numbers; with `symbols: 'all'` pass `prior: 0`.
- Some two-stroke `4`s are still split into `1 +`; some small radicals read as `r`/`v`.
- Subscripts are deliberately hard to trigger (rare in middle school); `\lim`, `\sum` and `\int` limits are not laid out.
- Strokes added later to an earlier symbol (crossing a t at the end) are not merged.
- `%` and `$` are learned from synthetic samples only (CROHME has neither).
- CROHME is adults writing on tablets; children writing with fingers on Chromebooks will be messier. Collecting a few hundred consented, anonymous samples from the pad (strokes + the corrected LaTeX) and fine-tuning would be the biggest single improvement; the correction memory already captures part of this per device.
