# Nib — handoff

Read this before changing anything. It is the project memory: what Nib is, how it works, how it was trained and tuned, how to rebuild it, and where it is weak.

## What it is

Nib turns live handwriting (pen, finger or mouse strokes) into LaTeX, in the browser, with no network and no dependencies. It ships as one file, `dist/nib.js` (about 870 KB including the models), so it can be pasted into any single-file tool (Deckhand, Cadence, Tally, Boards Up, the practice tests) and run from Drive over `file://` on the classroom Chromebox. `dist/Nib.html` is a self-contained tester with everything (fonts, KaTeX) inlined.

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
| `replicator/` | `core.js` (strokes → outlines → a TrueType file, no dependencies), `template.html` (the page), `build.py` → `dist/Replicator.html` (offline) and `dist/artifact/replicator.html` |
| `training/` | everything that produced the models; see `training/README.md` |
| `test/` | `check.js` (the regression suite: run it before shipping), `eval.js` (CROHME accuracy), `eval_synth.js` + `compose.js` (middle-school expressions composed from real handwriting), `stress.js` (the same expressions written messily: reversed and reordered strokes, late strokes, mouse, finger, slanted, drifting, mixed), `tune_all.js` / `tune.js` (weight search), `memcal.js` (memory calibration), `browser.js` (the tester page with timings), `pad_browser.js` + `pad_page.html` (the `<nib-pad>` element: two pads, undo, erase, palm, finger, a 4× slower CPU), `replicator_browser.js`, `font_check.js` + `font_check.py` (Replicator fonts read back by opentype.js, fontTools and Chrome), `parity.js` + `np_forward_v2.py` (the int8 engine against the float model) |
| `tools/push.sh` | commit and push from a Claude session (token in the git-ignored `.github-token`) |

## Pipeline

1. **Strokes in.** Arrays of `[x, y]` (or `{x, y}`, or `{points}`), y down, any units. Consecutive duplicate points dropped. With `smooth` > 0 each stroke is smoothed along its path (Gaussian, sigma = `smooth`·`ref`, ends fixed). It is off by default: with the v2 network, 0.03 lifted finger-written expressions from 80% to 89% exact on the stress set, but the v3 network reads finger ink at 90.6% unsmoothed and smoothing only takes a little off that (89.3%).
2. **Scale.** `ref` = median over strokes of max(width, height). Every threshold below is in units of `ref`. The classifier sees a size reference that is held steady while the same ink keeps growing (changes only when the writing's scale moves more than ~15%), so earlier symbols are not re-classified after each stroke.
3. **Segmentation.** Dynamic programme over time-ordered strokes (a symbol is 1–4 consecutive strokes whose boxes stay within 1.2·`ref`; only 0.5% of CROHME symbols break time order). A group is scored by the network's not-junk probability (weight `wJunk`; the network has a `junk` class trained on stroke groups that span two symbols), its best class probability (`wClass`), the stroke-join model (P(stroke k and k+1 belong together) from 16 geometric features, weight `wJoin`) and a per-symbol cost (`beta`). Boundaries the join model is very sure of are not crossed (`prune`). Two rules: a tiny mark at the baseline corner of a digit or letter is its own decimal point (`dotPen`), and two tall arcs after an open bracket are `)(` not `x` (`parenPen`). The DP keeps label states, so an optional writing-order context term (`lmSeg`) can score labels while segmenting; it did not help in tuning and is off. **Late strokes** (`delayed`): the DP keeps time order, so a stroke added to an earlier symbol much later (crossing a t at the end, the bar of a + or the second half of an x after the next number) would read as a symbol of its own. Before segmenting, a stroke that touches or crosses ink written two or more strokes earlier (within `lateTol`·`ref`), but neither the stroke just before it nor the one after it, is moved to just after the latest stroke it touches, so the DP sees the symbol's strokes together. After segmenting, two symbols that are not neighbours in time are still merged when their boxes overlap and the network reads the union as one confident symbol that scores `delayGain` better than the two apart; a dot joins only a symbol it sits just above or below (the dot of an i, the dots of ÷), never one it sits beside (a decimal point stays a decimal point). On the stress set where one stroke of a symbol is written last, this takes exact readings from 31% (1.0) to 85.5%.
4. **Classifier.** Each group is seen two ways. (a) Rendered to 4 orientation channels (0/45/90/135°, undirected, so stroke order and direction do not matter) on a 32×32 grid → 5 conv layers (24-48-48-96-96) with 3 max-pools. (b) Its pen path resampled to 48 points (x, y, direction, new-stroke flag) → three 1-D conv layers (32-64-64), max- and mean-pooled. Both, plus 5 scalars (aspect, size relative to `ref`, stroke count, ink length), feed FC 192 → 104 classes (101 CROHME symbols + `%` + `$` + `junk`). Int8 weights with per-channel scales, dequantised at load. `rasterize()` / `onlineFeatures()` in `core.js` mirror `training/raster.py` / `training/online.py` (parity: max pixel difference 1/255; probabilities within 0.016 of the float model; top-1 agreement 299/300).
5. **School prior.** The network learned CROHME's symbol frequencies (university maths: many letters). With `symbols: 'school'` each class probability is re-weighted by (frequency in a middle-school corpus / frequency in CROHME)^`prior` (table `DATA.prior.school`, built by `training/prior.py`; ratios run from 0.2 for rare-in-school symbols to 5.2 for digits).
6. **Symbol fix-ups.** Two stacked dots → `:`; `-` over `-` → `=`; `+` over `-` → `±` (only when nothing sits directly above or below the pair, so fraction bars are safe).
7. **Layout.** In order:
   - square roots, largest first: body = units right of the check mark's lowest point and under the overline (grows when a nested root is found; fraction bars under it and units starting below it are excluded); index = a small unit up and to the left;
   - fraction bars, widest first: a `-` with units clearly above and below it within reach (bar line fitted through the stroke, so sloped bars work), numerator/denominator grown by stacking and by running past the bar ends; operators at the very ends of the bar and units that straddle it are excluded; rejected unless both sides are roughly centred on the bar;
   - lines: units grouped into horizontal bands; a band of up to four small units, each sitting just above and right of a symbol in the line below (or right after the previous one), is merged back as exponents — anything else is a new line (so a short answer line like `88` stays its own line);
   - absolute value: two tall straight strokes read as `1`/brackets are paired into `| |` when both hang below the line of characters and the classifier finds them bar-like (`barH`, `barW`), or when two `1`s stand exactly where bars would: around a plain operand (digits or letters, no relation inside), each at an operand boundary (after an operator, a relation, an open bracket or the start; before one or the end);
   - baselines: units sorted by centre x; each unit is Right / Sup / Sub of the current baseline unit by the relation model (MLP over box geometry, typography class and digit/letter flags) with hard rules: operators and open brackets take no scripts; relations are never scripts; a leading minus joins the exponent it starts; a digit after a digit is an exponent only when clearly raised; a cross between two numbers is a times sign and takes no subscript.
8. **Slope.** After the first layout, the writing's slope is measured from the symbols just read, in writing order: neighbouring digits and letters of a similar size for their kind (an x-height letter counts as 0.62 of a digit) give the line through their bottoms, signs give the line through their middles; pairs steeper than 17° are dropped (exponents, the next line), the rest vote with weight growing with distance, and at least two must agree. When the agreed slope is more than `deskew` degrees, the same symbols are sheared level and laid out again (they are not re-read; boxes are reported around the ink as written) and `result.skew` says by how much. On the stress sets this lifts drifting lines from 84% to 89% and turned lines from 85% to 87% (v2 network), multi-line work most of all, while straight writing reads exactly as before (the composed set and the real 2013 set unchanged).
9. **Personal memory.** `Pad.relabel` (the "did you mean" menu) stores the corrected symbol's 192-number embedding with its label in localStorage (`nib-memory-v1`, 400 max). A later symbol whose embedding is nearly identical (cosine 0.88 → 0.96 ramps the pull from 0 to 0.8) has its probabilities pulled toward the remembered label. Ink itself is not stored. `Nib.memory.clear()` forgets. Calibrated with `test/memcal.js` on the 2013 writers: corrections fixed 170 later mistakes and disturbed 49 correct readings (5,627 symbols).
10. **Context model.** Viterbi over each row's symbol candidates with a bigram model (CROHME rows + 30,000 synthetic middle-school expressions, weight `lm`), then a final layout pass if any label changed.
11. **Post-layout.** A dot on the baseline is a decimal point, a raised dot is `\cdot`; a small raised circle after a digit or `)` is a degree sign (`degrees`); `x` between two numbers is `\times`.
12. **Output.** LaTeX (KaTeX/MathJax-ready), plain text, per-line tokens, the tree, each symbol with box and candidates, a confidence.

The pad reads in time slices: `Recognizer.warmup()` classifies the stroke groups the DP will need one at a time (newest ink first) and the pad runs it ~14 ms per slice between frames; new ink cancels a read in progress. `Nib.recognizeAsync()` does the same for whole expressions.

## Training data and models

- **CROHME** (online handwritten maths expressions, InkML with symbol-level segmentation and MathML ground truth). CROHME 2019 from the GitHub mirror `Mahdiyeh-Asgharpour/CROHME2019` (train 8,901; CROHME 2014 test 986; CROHME 2019 test 1,199) and the CROHME 2012 and 2013 test sets from `ThomasLech/CROHME_extractor` (488 + 671, not part of the 2019 release). Splits: **train** = 2019 train + 2014 test + 2012 test (10,375 expressions, ~102k symbols); **tuning** = 2013 test (671) and `synth_t13` (700 school expressions composed from the 2013 writers' symbols); **reported test** = 2019 test (1,199) and `test/school_synth.jsonl` (700 composed from the 2019 test writers), never used for training or tuning. CROHME is distributed for research use; the models here are derived from it.
- Classifier v2: 14 epochs over six augmented renderings + one clean, AdamW, cosine schedule, label smoothing, class weights; 90.4% symbol accuracy (99.0% top-3) on the 2013 writers over all 101 classes. v1 (a smaller raster-only CNN on less data) reached 59.7% / 75.7% on the two tuning sets where v2 reaches 61.8% / 80.6% before tuning.
- Classifier v3 (shipped in 1.1): v2 fine-tuned for 6 more epochs (`training/train_v3.py`), half of them rendered with `training/aug3.py` on top of v2's augmentation: strokes drawn backwards (30%), the strokes of a symbol in another order (35%), mouse-like sparse pixel-snapped points (20%) and finger-like wobble (20%). On the 2013 writers' symbols it keeps v2's accuracy on clean ink (90.4%) and reads the same symbols rewritten messily far better (87.4% vs 82.0%). End to end it raised every stress set (finger 80% → 91%), the composed 2019-writer set (90.2% → 91.5% on the stress tool's sample) and the real 2019 school set, and is slightly lower on the 2013 tuning sets (real 63.4% → 60.7%, composed 89.1% → 88.6%, mostly single letters of ambiguous case: s/S, v/V, w/u). The epoch-4 model and an average of epochs 4–6 were both weaker overall. Remembered corrections from 1.0 do not carry over (the memory is keyed to the network).
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
| `delayed`, `lateTol`, `delayGain` | true, 0.08, 0.3 | join late strokes back to their symbol (Pipeline 3) |
| `deskew` | 3 | level writing that slopes more than this many degrees (0 = off; Pipeline 8) |
| `skewW`, `skewAgree` | 2.5, 0.5 | how much agreeing evidence the slope needs (weight, share of all votes) |
| `smooth` | 0 | smooth each stroke along its path, sigma in `ref` (the pad uses 0.03 for finger ink) |
| `lines`, `degrees`, `memory` | true | split lines; degree signs; apply remembered corrections |
| `fix` | — | `[{strokes: [indices], label}]` forces a symbol (used by `Pad.relabel`) |

## Results

Measured on the CROHME 2019 test writers, never used for training or tuning (`node test/eval.js test full school`, `node test/eval_synth.js`, `node test/eval.js test full all 100000 '{"prior":0}'`):

| Set | Expressions | Exact | Detail |
| --- | --- | --- | --- |
| Middle-school maths composed from those writers' real symbols | 700 | 89.3% (1.0: 86.7%) | token error 2.2%; arithmetic 90, equations 88, inequalities 88, fractions 90, powers 94, roots 95, percents/money 96, ratios 90, formulas 87, absolute value 83, multi-line 81 |
| Real expressions in middle-school notation | 546 | 70.0% (1.0: 69.0%) | structure right 82.6%; symbols segmented right 98.8%, labelled right 95.5% |
| Full CROHME 2019 test, all symbols, no school prior | 1,187 | 55.8% (1.0: 55.6%) | structure 69.3%; symbols 98.0% / 93.6% |

Messy writing (`node test/stress.js` rewrites the composed set; each variant scored on every third expression, `EVERY=3 SYNTH=training/scratch/data/stress_<variant>.jsonl node test/eval_synth.js`), 1.0 → 1.1: neat 88.5 → 91.5, strokes drawn backwards 83.8 → 90.2, strokes of a symbol reordered 83.3 → 87.6, one stroke added at the end 31.2 → 85.5, mouse 87.6 → 90.2, finger 78.2 → 90.6, line turned 6–12° 82.9 → 88.0, line drifting 6–12° 82.1 → 90.2, two or three at once 62.8 → 83.3. In 1.1 the network (v3) accounts for most of the backwards, reordered, finger and mixed gains, the late-stroke stage for the late strokes, the slope stage for turned and drifting lines (and the multi-line category), and the absolute-value rule for `| |` (46% → 83% on the composed set).

The full-set figure is in the range published research models report on this benchmark (most of those read images, not ink, and run on servers). On the tuning sets 1.1 reaches 61.3% (real 2013 school-style) and 88.6% (composed from the 2013 writers); 1.0 reached 63.9% and 87.3%, and the first version of the engine (v1 network, untuned) 59.7% and 75.7%.

Speed (headless Chrome on a 2-core server, shared with other work): the 14-stroke sample is read 0.9 s after navigation including page load; a 6-symbol expression is ready 0.75 s after the last pen-up, of which 0.45 s is the deliberate rest delay. In Node a whole 8–20-stroke expression takes 0.35–1.2 s from cold and about 10 ms once its strokes are cached.

## Known weak spots

- Letter/number look-alikes without context: `q`/`9`, `s`/`5`, `z`/`2`, `b`/`6`, `P`/`p`, `V`/`v`. The school prior leans toward numbers; with `symbols: 'all'` pass `prior: 0`.
- Some two-stroke `4`s are still split into `1 +`; some small radicals read as `r`/`v`.
- Subscripts are deliberately hard to trigger (rare in middle school); `\lim`, `\sum` and `\int` limits are not laid out.
- A late stroke that does not touch its symbol (the two halves of an x written far apart in time and not meeting) is still read on its own.
- `%` and `$` are learned from synthetic samples only (CROHME has neither).
- CROHME is adults writing on tablets; children writing with fingers on Chromebooks will be messier (the stress sets imitate some of it). Collecting a few hundred consented, anonymous samples from the pad (strokes + the corrected LaTeX) and fine-tuning would be the biggest single improvement; the correction memory already captures part of this per device.
