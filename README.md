# Nib

Handwritten math to LaTeX, in the browser. One file, no internet, no dependencies, nothing stored or sent anywhere.

```
dist/nib.js            the engine and the writing pad (drop into any page)
dist/Nib.html          a self-contained tester: open it from Drive or your desktop
dist/Board.html        a canvas for the class display: pens, shapes, papers, pages, export — and Nib reads the math
dist/Replicator.html   turn your own handwriting into a font (see the end of this page)
```

It reads ink — pen, finger or mouse strokes — not photos of paper.

## How well it reads

Measured on handwriting from writers it never saw in training (the CROHME 2019 test set) and never used for tuning.

| Test | Expressions | Read exactly right |
| --- | --- | --- |
| Middle-school math composed from those writers' real symbols (`test/school_synth.jsonl`) | 700 | 89.7% |
| Real expressions in middle-school notation (no subscripts, calculus or rare symbols) | 546 | 69.8% |
| The full CROHME 2019 test set (university math, symbol set `all`) | 1,187 | 55.3% |

"Exactly right" means every symbol and every fraction, power, root and line in the LaTeX matches. Since 1.6.3 a 1 with a long, flat top is read as a 7, the way an American reader reads it ("I would never make the top that long on a one"); these writers, mostly European, write some of their 1s that way, which costs these figures about half a point (they were 90.6%, 70.3% and 55.9%). By category on the composed school set: arithmetic 95%, one- and two-step equations 87%, inequalities 87%, fractions and mixed numbers 91%, powers and scientific notation 95%, roots 96%, percents and money 91%, ratios 90%, formulas 85%, absolute value 83%, multi-line work 84%.

### When the writing is messy

The same composed school expressions, rewritten the ways real writing goes wrong (`test/stress.js`; a third of each set):

| The writing | Nib 1.0 | Nib 1.1 |
| --- | --- | --- |
| Written neatly | 88.5% | 91.5% |
| Some strokes drawn backwards (right-to-left minus, bottom-up 1) | 83.8% | 90.2% |
| The strokes inside symbols in a different order | 83.3% | 87.6% |
| One stroke of a symbol added at the very end (crossing the t last) | 31.2% | 85.5% |
| With a mouse or trackpad | 87.6% | 90.2% |
| With a finger on a touchscreen | 78.2% | 90.6% |
| The whole line turned 6–12° | 82.9% | 88.0% |
| The line drifting uphill or downhill 6–12°, symbols upright | 82.1% | 90.2% |
| Two or three of the above at once | 62.8% | 83.3% |

## Add it to a page

Paste `nib.js` into the page once — as `<script src="nib.js"></script>` next to the HTML file, or inline inside a `<script>` tag for single-file tools.

### A writing pad, no code

```html
<nib-pad id="answer" style="height: 240px"></nib-pad>
<script>
  answer.addEventListener('change', e => {
    const r = e.detail;            // null when the pad is cleared
    if (r) render(r.latex);        // e.g. katex.render(r.latex, el)
  });
</script>
```

Attributes: `symbols="school|all|numbers|0,1,2,x,+"`, `ink="#1b2a4a"`, `stroke-width="3"`, `delay="450"` (ms of rest before reading), `auto="false"` (only read when you call `recognize()`), `boxes` (draw what was read), `pen-only` (ignore fingers and palms), `lines="false"`, `degrees="false"`, `smooth="0.03"` (smooth very shaky ink before reading; off by default, as finger ink already reads as well as pen ink), `view="tidy|hand|typeset"` (show what was read in place — see below), `motion="false"` (change views without animating), `separate` (a board: writing in different places is read as separate expressions), `solve` (write the answer after any line that ends with "=", and solve equations — see below), `times="false"` (× is never read: x is always a letter, and you multiply with a dot or brackets), `reveal` (with `solve`: each answer is drawn out of focus, where it goes, until it is tapped), `fit` (when the pad gets smaller and the ink no longer fits, shrink and move it in, as one undoable step).

Properties and methods: `latex`, `text`, `result`, `strokes` (get or set), `view` (get or set), `solve` (get or set), `answers` and `solved` (the answers, and the LaTeX with them written in), `shown` (what the view draws), `mode` (`'draw'` or `'erase'`), `undo()`, `redo()`, `clear()`, `recognize()`, `relabel(symbol, label)`, `toImage()`, `image({scale, background, dots})` (the ink as the view shows it, as a canvas, 2× by default), `getState()` / `setState(state)` (the strokes, the corrections as stroke indices and the answers shown by a tap, to keep and put back), `reveal` (get or set).

The pad takes its ink color from the CSS variable `--nib-ink` (or the element's text color), so it follows each tool's theme. Reading happens a few milliseconds at a time between frames, so the page never freezes while a long expression is read (checked with the processor slowed four times). Pen, finger and mouse all write. A pen wins over touch: while a pen is down, and for a second after it lifts, touch draws nothing; a wide contact (a palm, 28 px or more where the browser reports the size) never draws (with Erase on, it rubs out, as the side of a hand does on a whiteboard); a palm that lands just before the pen, or rests on the glass when it comes down, is wiped; and while the pen is the instrument in use, a brief brush of the hand waits a moment and goes if the pen follows. The pen's eraser end erases. Several fingers can write at once (two students at the board), and the eraser shows a faint ring of its size. Two pads on one page work independently, and a pad moved or removed and put back keeps its ink.

### Your own element

```js
const pad = Nib.attach(document.querySelector('#board'), {
  symbols: 'school',
  onResult: r => { /* r is null after clear() */ },
});
pad.undo(); pad.clear(); pad.setStrokes(saved); pad.getStrokes();
```

### Ink you already have

```js
const r = Nib.recognize(strokes, { symbols: 'numbers' });   // strokes: [[ [x, y], [x, y], ... ], ...]
const r2 = await Nib.recognizeAsync(strokes);                // same, without blocking the page
```

### Inside another tool

Two ways to put Nib in a tool that has its own drawing — how Deckhand's Sketch Pad and its pen over the slides use it:

- **A fixed page**, `page="1280 960"`: the pad's world is a page of that many units, always shown whole and centred in whatever room the element is given (a card that is resized, or put on the stage, shows the same page bigger or smaller). Nothing pans or zooms it, two fingers write, and writing beyond the page's edges (a card of another shape has margins) is kept in view when the frame gets smaller. `getState()` holds no camera. The host draws its own background under it from `el.pad.toScreen([0, 0])` and `el.pad.toScreen([1280, 960])` (`el.pad` is the element's engine), and repaints on `nib:camera`.
- **Answers over a host's own ink**, `draw="answers"`: the element draws only the answers, takes no input (put it in a container with `pointer-events: none`) and reads the strokes the host gives it: `el.pad.syncStrokes(list, moved)` with `list` the host's strokes as arrays of `[x, y]` points in the element's CSS pixels, in the order they were written. A stroke given again as the same array is the same stroke (its corrections, and an answer shown by a tap on its line, stay); `moved` pairs `[newArray, oldArray]` for strokes the host moved, resized or recolored as new arrays, so they keep what Nib knew about them. On the host's pointer down, `el.pad.answerAt(clientX, clientY)` says whether an answer is there (`{key, hidden, box}`, a hidden one found anywhere on a fingertip-sized target); `el.pad.showAnswer(key)` shows it (the blur eases away) and `el.pad.hideAnswer(key)` hides it again.

For a Fix tool on either: in `mode = 'fix'` a tap comes as `nib:tap {x, y}` (world units) and writes nothing; `el.pad.symbolAt(x, y)` gives the symbol drawn there (`{sym, box}`, with `sym.candidates`), and `el.relabel(sym, label)` corrects it — Nib remembers the shape (in this browser) for next time.

And for a tool that had its own pad before: `palm="false"` turns off the hand's rules (a touch 28 px or more across is a palm, touch waits a second after the pen, a brief touch just before the pen is the hand, a finger's tap beside the pen is its heel) — every touch writes, as on a panel that reports fingers that wide or a stylus as a pen; `single` lets one pointer write at a time; `keep` keeps the pad alive when the element leaves the page, so a host that takes it out and puts it back later (a card torn down and built again) gets it back with its Undo history, corrections and reading; `setState(state, {steps: true})` puts a page back with its strokes undoable one by one. Every change to the page, a Fix included, sends `nib:change`.

## What you get back

```js
{
  latex: '\\frac{3}{4}x+2=11',     // one line; several lines come wrapped in \begin{gathered}
  text:  '(3/4)x+2=11',            // plain text (* for ×, sqrt(…), ^ for powers)
  lines: [{ latex, text, tokens }],// one entry per written line
  symbols: [{ label, latex, box: {x, y, w, h}, strokes, candidates: [[label, p], ...], fixed }],
  tree, confidence,
  skew,                            // degrees of slope levelled before laying out: + downhill, − uphill, 0 none
  ms
}
```

`candidates` drive a "did you mean" menu: call `pad.relabel(symbol, label)` and the expression is re-read with that symbol fixed.

## In place: tidy, your hand, typeset

A pad can show what it read right where it was written, at the size it was written. Set `view` on the pad (or switch it at any time) and the ink glides into its new form a moment after the pen rests:

- `tidy` — your own strokes, cleaned up: every symbol straightened and sized to one line (digits and capitals one height, small letters one height, `g y p` hanging below), signs made square (`=` level and even, `+` upright, fraction bars and roots straight), lines that drifted uphill levelled, and the spacing evened out while keeping your gaps.
- `hand` — each symbol redrawn with the same character from your [Replicator](#replicator-your-handwriting-as-a-font) handwriting, on the same lines and spacing. Characters you never wrote there are tidied instead.
- `typeset` — the LaTeX itself, set in KaTeX's math fonts (built in, no internet needed) exactly where the writing was: fractions, powers, roots, and work over several lines with the equals signs lined up.

Every symbol stays tied to the strokes that made it: the eraser takes away what you touch as shown, undo brings it back, a correction with `relabel` redraws that symbol, and new writing joins the view as soon as it is read. The read itself is never changed by a view.

```js
const t = Nib.neaten(strokes);                     // tidy: { latex, items, strokes } — strokes to draw anywhere
const h = Nib.neaten(strokes, { style: 'hand' });  // in your handwriting (Nib.hand, or { hand: savedFile })
const s = Nib.typeset(strokes);                    // items with text, rules and positions in the ink's coordinates
Nib.hand.load(savedJsonText);                      // the file Replicator saves; kept in this browser
Nib.hand.size; Nib.hand.name; Nib.hand.has('7'); Nib.hand.clear();
```

## Answers after "="

Turn on **Solve** (on the Board it starts on) and any line that ends with "=" gets its answer written just after the equals sign, in gold, at the size of your writing: in your own digits where you have written them on the board, in your Replicator handwriting where you haven't, and typeset in the Typeset view. Change the problem and the answer follows it. Start writing your own answer after the "=" and the gold one steps aside; erase the "=" and it goes. Write the "=" right against the edge of the board and the answer is squeezed in after it, or, if it would be too small, written just under the line, ending at the edge.

- Whole numbers, decimals, fractions, mixed numbers and percents are worked out exactly, with + − × · ÷ /, brackets, powers, square and cube roots, absolute value and factorials, in the usual order of operations.
- The answer comes in the form the question was asked in: decimals give decimals (repeating ones with a bar, 1 ÷ 3 = 0.3̄; ones whose repeat is too long to show are cut and marked with "…", 1 ÷ 17 = 0.0588…), fractions give fractions (stacked or with a slash: 1/3 + 1/3 = 2/3), mixed numbers give mixed numbers, and dividing whole numbers gives a decimal.
- A lone number becomes its other form: 3/4 = 0.75, 0.75 = 3/4, 6/8 = 3/4, 5 1/3 = 16/3, 16/3 = 5 1/3, 75% = 0.75. Percents added together stay percents (15% + 5% = 20%), and so does anything times 100% (3/4 × 100% = 75%).
- A repeating decimal written with its bar becomes its fraction: 0.3̄ = 1/3, 0.16̄ = 1/6, 2.4̄5̄ = 2 5/11. (From LaTeX, `0.\overline{3}=`; the handwriting reader does not read a bar over digits yet.)
- Scientific notation is just arithmetic: 3.2 × 10⁴ = 32000, (3 × 10⁴)(2 × 10³) = 60000000, 6 × 10⁵ over 3 × 10² = 2000, 4.5 × 10⁻³ = 0.0045.
- π and roots that don't come out are cut to three places and marked with "…" (π = 3.141…, √2 = 1.414…): the digits shown are always how the number really starts, never rounded up, and an approximation is never passed off as exact.
- Letters stay letters: like terms are combined, brackets multiplied out, a term divided by a term (6x ÷ 3x = 2), in standard form (a² − 2ab + b²): 3(x + 2) − x = 2x + 6. Something already as simple as it gets gets no answer. A line like x = 5 gives x for the lines below it in the same piece of work.
- A chain works when its parts agree: 2(3 + 4) = 2 · 7 = gives 14, but 3 + 4 = 9 + 1 = gives nothing.
- "15% of 80 =" means what you'd mean, so does 2/3x (two thirds of x), and so does "3 x 4 =" (an x between two numbers) — unless x is always a letter (below).
- Nothing appears when there is nothing sound to say: dividing by zero or by letters, an unfinished line, something written two ways at once (80 + 15%: 15% of what?), a number straight after a letter or bracket (x4, (2)3), function notation (f(2)), units and words (1m + 50cm, GCF(12, 18)), money, sin and log.

### Solving equations

Write an equation, then **x =** on the line below it, and x's value appears:

- one-step, two-step and multi-step equations, with x on both sides and with fractions or decimals: 3(x − 2) = 2x + 5 gives x = 11; 2/3 x = 4 gives x = 6; 4x = 6 gives x = 3/2 (decimals in the equation give a decimal answer);
- x² = p and x³ = q: x² = 49 gives x = ±7, x³ = −8 gives x = −2 (a square root that does not come out is a decimal: x² = 50 gives ±7.071…);
- quadratics, in any form: x² + 5x + 6 = 0, x² = −5x − 6, x(x − 3) = 10 or (x + 1)(x − 2) = 4. Two roots are listed smallest first (x = −3, −2), a repeated root once (x² − 4x + 4 = 0 gives 2), roots that are not whole numbers or fractions in simplest radical form (x² + 3x + 1 = 0 gives (−3 ± √5)/2, x² + 4x + 2 = 0 gives −2 ± √2), and a quadratic with no real roots gets nothing;
- rearranging formulas: **y =** under 2x + 3y = 12 gives −2/3 x + 4; under y − 3 = 2(x − 1) it gives 2x + 1; **w =** under A = lw gives A/l, **t =** under d = rt gives d/r, **x =** under y = mx + b gives (y − b)/m. When the letter is divided by a number the answer is written as terms (P = 2l + 2w, **l =** gives ½P − w); when it is divided by letters, as one fraction. The letter must appear only once-powered and never underneath (x² + y² = 25, or 1/x + y = 2, get nothing), and values written above are put in first (A = lw, l = 5, then w = gives ⅕A). Lines of rearranging working right above it must agree;
- slope: m = (5 − 1)/(3 − 1), then m = gives 2; with x₁ = 1, y₁ = 3, x₂ = 4, y₂ = 9 written above, (y₂ − y₁)/(x₂ − x₁) = gives 2 (the reader is slow to take a small low digit as a subscript, so this works best from LaTeX); y = ½x + 3, x = 4, then y = gives 5;
- inequalities: under 2x + 3 < 11 write **x <**, and 4 appears. Deciding which way the sign points is the lesson, so the number only appears when the sign you wrote is the right one (under −3x ≥ 12, x ≤ gives −4 and x ≥ gives nothing);
- fractions with x underneath, like proportions: 3/x = 6/10 gives x = 5 (a value that would divide by zero is never given);
- two or three equations together: under x + y = 10 and x − y = 2, x = gives 6 and y = gives 4;
- formulas, with values given below them: A = lw, l = 5, w = 3, then A = gives 15.

It solves the nearest equation above with that letter in it, and checks the working: every line of working right above it must give the same answer, so a slip in a step (2x + 3 = 11, then 2x = 14) gets no answer instead of the answer to the slip. A line with x in it that Nib can't work out (|x| = 5, √x = 4, 2ˣ = 8, or a misread line) also means no answer below it, never an answer to an older equation. Equations it can't settle — no solution, every number, a quadratic with no real roots — get nothing, and so do two equations beside each other that disagree about the letter (they are a system, not working). A value found by solving (2x + 3 = 11, then x = 4) is used below only where there is nothing else to do: x + 1 = gives 5, but 3x + 2x = still gives 5x.

### x as a letter

With `times="false"` (`{times: false}` for `Nib.recognize`, `Nib.solve` and the rest), × is never read: every cross is the letter x, and you multiply with a raised dot or brackets, 2x(x + 5) = 2x² + 10x, (x + 2)(x − 3) = x² − x − 6, 121 · 21 = 2541. The Board works this way.

```js
Nib.solve('\\frac{1}{3}+\\frac{1}{6}=')   // [{ latex: '\\frac{1}{2}', text: '1/2', kind: 'fraction', exact: true, value: 0.5 }]
Nib.solve('2x+3=11 \\\\ x=')           // [null, { latex: '4', text: '4', kind: 'integer', exact: true, value: 4 }]
Nib.solve(strokes, { times: false })       // one entry per line of the writing: an answer, or null
Nib.neaten(strokes, { solve: true })       // the tidy view with the answers drawn in
```

## Nib Board

`dist/Board.html` is a canvas for the classroom display (or a tablet), in one file that works offline: an endless board that pans and zooms, with pens, markers, highlighters, shapes, text and pictures over the paper you choose, page after page — and Nib reads the math written on it. Write anywhere, with the pen or a finger; two students can write at once. Each expression is read on its own, and the board shows it as **Ink**, exactly as written (the default), **Tidy**, in **My hand** or **Typeset** (keys 1–4).

**The tools** (left of the rail; tap a tool again for its colors and sizes, or use the round color button beside them):

- **Select** (V): a box with the mouse, or a lasso drawn round things with a pen or finger (starting on empty board), or a tap on one. **Lasso** (O): a loop drawn round what to select, starting anywhere — on the writing too — with a pen, a finger or the mouse; a tap still picks one thing. Either way: drag to move, drag a corner or side handle to size (pictures and text keep their shape). A bar above the selection: color and size, change it (a text's words, a number line's or a plane's numbers), duplicate, copy, to the front, to the back, save as a picture, delete. Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste — onto another page too; on a panel or tablet, the bar's Copy and More, Paste — Ctrl+D duplicates, Ctrl+A selects everything, Delete deletes, the arrow keys nudge (Shift: 10 px).
- **Hand** (H): drag to move the board. Also: hold Space and drag, drag with the middle mouse button, scroll the wheel (Shift: sideways), or put two fingers down together and pinch to zoom. A finger far from the first one still writes, so two students can write at once (Settings can make two fingers write instead, or a finger always move the board).
- **Pen** (P), **Marker** (M), **Highlighter** (I): eleven colors that read on any paper (on the chalkboard and dark papers, the lighter shade of each) and any other color from the picker; a choice of sizes (the pen 1.5–8, the marker 6–24, the highlighter 14–40; `[` and `]` step through them). The pen's line follows its pressure. The highlighter is see-through and goes under the writing. **Nib reads only the pen and the marker**: highlighting, shapes, text and pictures never change a reading.
- **Eraser** (E; E again goes back to the tool you had): whole strokes, or only where it rubs (the color button, with the eraser in hand). It rubs out what was drawn — pens, markers, highlighters and shapes — and leaves what was placed — text, pictures, number lines and planes — for Select and Delete. The pen's eraser end erases too.
- **Shapes** (R; tap it again for the eleven): line, arrow, double arrow, rectangle, square, ellipse, circle, triangle, right triangle, **number line** and **coordinate plane**. Drag one out, or tap for one of a standard size; color, width, a light or solid fill and dashes from the color button. On a paper with a grid, shapes snap to it (Settings can turn that off). A number line or plane drawn says its numbers and offers to change them: from, to, every (fractions like 1/4 are fine), numbers on the ticks, as fractions, grid lines. Or draw a line, circle, box or triangle freehand with the pen, bigger than your writing, and hold still a moment at the end: it becomes a clean one. Writing never does: a 1, a 0 or a fraction bar held still stays writing, and if the pen moves on after a pause, the stroke goes on as writing.
- **Text** (T): tap where it goes and type; Escape or a tap elsewhere ends it. Tap it again with Select to change it.
- **Laser** (L): a bright red pointer that fades as it goes; it keeps nothing.

**Solve** (S): answers after every "=", and **x =** under an equation solves it, as above. It starts on. Each answer waits behind a small gold **?** where it will go: tap it to show the answer (it stays shown until the line is changed; rub it out with the eraser to hide it again). Turn "Reveal answers on tap" off in Settings to have answers written straight in. On the Board x is always a letter: multiply with a raised dot or brackets. An answer that would run past the right edge of the screen is squeezed in, or written under its line.

**Fix** (X): tap a symbol that was read wrong and pick what it is (a dot offers both the times dot and the decimal point); the board re-reads it, Nib remembers your shape, and Fix stays on for the next one until you tap Fix again, tap empty board twice, or just write — writing always writes.

**Paper** (the grid button): blank, dots, grid, graph paper, lined, isometric dots, a coordinate plane and number lines, each in the board's own colors (following light and dark), white, cream, chalkboard green or black. Each page has its own; a new page takes the one last chosen. The plane's and the number lines' numbers stay readable at every zoom.

**Zoom** (bottom right): − and +, the percentage (tap: back to 100%), and show everything on the page. Ctrl+wheel or a trackpad pinch zooms about the pointer; Ctrl+0 and Ctrl+1 do 100% and show everything. When the screen gets smaller (a tablet turned), the board zooms out just enough to keep the writing you were looking at in sight, and back in when it is bigger again; nothing on the page moves.

**Pages**: the arrows go between pages, **+** starts a new one, and the page number ("2 / 5") shows every page small: tap one to go to it, **Duplicate this page**, **Move it left / right**. Each page keeps its own writing, paper, view, corrections, shown answers and undo history. **Undo** (Ctrl+Z), **Redo** (Ctrl+Y or Ctrl+Shift+Z), **Clear** (this page only; Undo brings it back).

**Pictures**: paste one (Ctrl+V: a screenshot of a worksheet, say), drop a file on the board, or More, Insert a picture (also in the shapes menu). It comes in selected, to move and size, and is kept in this browser with the board.

**Export**, to post for students: **This page**, **All pages**, what is **On screen** or what is **Selected**, as a **PDF** (Letter or A4, turned to suit the writing, or a page the writing's own size; one page per board page), a **Picture** (PNG) or **Copy picture** (to paste into Google Classroom, a doc or a slide). Answers **as shown**, **all** of them (an answer key, even with Solve off) or **none**; the paper **with its lines** or **plain white**. Published on claude.ai the Board asks before it saves a file. **Save the board** keeps the whole board — every page and picture — as a `.nibboard.json` file; **Open a board** (or the file dropped on the board) puts it back on any computer, at the page it was saved on (after the pages there, or instead of them). **Picture of the screen** saves what is on screen as a PNG at twice its size.

**More** (…): **Copy LaTeX** (the page, one line per expression, with the answers in when Solve is on; where the browser will not copy, the text is shown selected: long-press it, or press Ctrl+C), **My handwriting** (opens the file Replicator saves; when Replicator and the Board are open in the same Chrome, the Board picks up what you last wrote there by itself), Insert a picture, Paste what was copied, Select everything, Show everything, **Pointer events** (below), **Full screen** (F).

**Settings** (the gear): where the rail goes (top, bottom, left or right — the sides show icons only), the theme (light, dark or the computer's), what **a finger** does (writes; moves the board, so only the pen writes; or nothing — pen only, for a tablet where your hand rests on the glass), what **two fingers together** do (zoom and move, or write), answers on or off, reveal on tap on or off, draw-and-hold shapes, snapping to the paper's grid, the pen's pressure, whether Nib reads the writing at all (off: a plain whiteboard), training (below) and **Delete this page** (it asks first).

In the Tidy, My hand and Typeset views, fresh writing stays exactly as written until you have rested the pen for 2.5 s (the `settle` attribute); only then does it change into the view, so nothing moves under your hand. The Ink view never changes your writing.

**Keep writing for training** (Settings, Training; off until you turn it on): the board keeps each expression written on it once it has been read and left alone for 4 seconds (or when its page is left): its strokes, the pointer that wrote each (pen, finger or mouse), how it was read, any symbol you fixed and whether it was answered. Nothing else: no names, no pictures, nothing about who wrote it. It stays in this browser (its own key, `nib-train-v1`, up to 3,000 expressions) until **Save training** downloads it as `Nib-training-<date>.json` (`{format: 'nib-training', version: 1, exported, engine, records}`, one record per expression); **Forget training** (it asks first) empties it. `python3 -I tools/training_to_jsonl.py Nib-training-*.json board.jsonl` turns saved files into rows the trainer reads, to fine-tune Nib on real classroom writing (see `docs/HANDOFF.md`).

**Training drill** (Settings, Training, **Start the drill**): 60 problems to copy onto the board one at a time, so that each piece of writing is kept with what it was meant to say. It turns "Keep writing for training" on, starts a new page and puts a bar across the top of the board with the problem in large type, "12 / 60", and **Right**, **Fix**, **Skip** and **Stop**; where it matters the bar also says how to write it (with your finger, small, large, fast, a closed 4). Copy the problem anywhere on the board, spaced out as the prompt shows it or not (pieces of one line that end or begin in an operator are read together); once it has been read and the pen has rested a second, the bar shows the reading under the problem ("Read: 4x − 7 = 21 / x = → 7"), in gold when it is the problem and in coral when it is not. **Right** keeps it, marked as checked, clears the page and shows the next problem; **Fix** lets you correct a misread symbol first (Right then keeps it fixed); **Undo** takes back the last stroke; **Skip** goes on without keeping anything; **Back** returns to the problem before and drops what was kept for it; **Stop** puts the bar away, and Settings then offers **Continue the drill · n / 60** (also after a reload; the place is kept in `nib-drill-v1`). For a two-line problem write the second line under the first, as far down as you like. A problem meant for a finger that was written with the pen turns the bar coral, but is still kept (if Settings has a finger set to move the board or do nothing, the bar says so). After the last one the bar sums up ("57 done, 3 skipped, 9 fixed", and which were skipped) with **Save training** and **Start again** right there. The converter marks a checked expression whose reading is the problem `gold: true`, and `--verified-only` keeps only the checked ones.

The board keeps its pages, pictures and settings in the browser and saves as you write (and at once when the tab is closed or hidden), so a reload loses nothing; boards kept by an older Board open as they were. If the browser will not store it, a note says so and stays, with **Save the board** to keep it as a file. Opened in a second tab or window of the same browser, the Board shows the board but saves nothing, and says so (two saving at once would write over each other); when the first one closes, the second offers to reload and carry on. More, **Pointer events** (or, on a screen 1320 px wide or more, holding the **Nib.** mark a moment) shows what the panel or tablet sends for each touch (pointer type, contact size, pressure, buttons) and what the board did with it; the same again closes it.

## It learns your handwriting

Every correction made with `relabel` is remembered: Nib keeps a compact fingerprint of that symbol's shape and, the next time the same writer makes a nearly identical shape, leans toward the corrected label. In a simulation where each writer corrected every mistake once, this fixed about three later mistakes for every correct reading it disturbed. The memory lives in the browser's local storage (key `nib-memory-v1`, up to 400 shapes, ink is not stored), is shared by every tool on the same site (and, in Chrome, by every HTML file opened from the same computer), and never leaves the device. The Replicator's "Teach Nib my handwriting" fills it with every character you write there.

```js
Nib.memory.size                    // how many corrections are remembered
Nib.memory.learn(strokes, 'x')     // teach one symbol directly
Nib.memory.clear()                 // forget everything
Nib.recognize(strokes, { memory: false })  // ignore it for one read
```

## Symbol sets

- `school` (default): digits, letters, `+ − × ÷ · ± = ≠ < > ≤ ≥`, brackets, `| |`, `/`, fractions, powers, `√` and `∛`, `π θ α β Δ`, `%`, `$`, `:`, decimals and the degree sign. Leaves out look-alikes that cause trouble in middle school (`l`, `o`, `O`, `I`, `X`) and calculus symbols, and expects middle-school content (more numbers than letters).
- `numbers`: digits, `. , + − × ÷ = / % $ ( )` and fractions — for answer boxes that only take a number.
- `all`: everything the model knows (adds `∑ ∫ lim log sin cos tan ∞ → ∈ ∀ ∃`, more Greek, `!`, braces). Pass `prior: 0` with it for university-style content.
- or your own list: `['0','1','2','3','4','5','6','7','8','9','x','+','-','=']`.

Restricting the set is the single best way to raise accuracy in a given box.

## Good to know

- Writing that drifts uphill or downhill is levelled before it is laid out (`result.skew` says by how much); straight writing is left alone.
- A stroke added later to an earlier symbol (crossing a t at the end, finishing a 4 after the next number) is joined back to it when the shapes overlap and the joined symbol reads clearly.
- Multi-line work is read line by line.
- The engine file is about 1 MB (the typeset fonts are 70 KB of it). A new stroke is read in roughly 0.1–0.3 s on a laptop; a whole expression handed over at once takes longer (about 0.05 s per stroke). The reading is done a few milliseconds at a time, so the page stays responsive throughout, even on a crowded board with the processor slowed four times.
- The typeset view uses the KaTeX fonts, embedded unchanged under the SIL Open Font License 1.1 (`licenses/OFL-KaTeX-fonts.txt`).

`docs/HANDOFF.md` explains how it works and how to change it; `training/README.md` how to retrain it; `node test/check.js` runs the regression suite.

## Replicator: your handwriting as a font

`dist/Replicator.html` is one file that works offline. Write each character in its box — capitals, lowercase, numbers, punctuation and the math signs — and the font builds itself beside the sheet as you go. The dashed lines are the tops of capitals and of small letters, the solid line is where letters sit, and the dotted line is how far `g j p q y` hang.

- **Eraser** (or E, or the pen turned round to its eraser end): rub over a stroke, in a box or on the sentence lines, and it goes; **Undo** puts it back. **Undo** (Ctrl+Z) takes back the last stroke, a box cleared with its ×, or the sentence lines cleared.
- **Pen weight, letter spacing and smoothing** change the whole font at once. Smoothing runs from 0 (your strokes exactly as written) to 10: it irons out the wobble along a stroke while keeping its corners sharp, and takes away the little flick a pen makes as it lands or lifts. **Line up with the guides** sets letters that sit a little high or low onto the line, and **Even out letter sizes** brings each letter to the height its kind should have (a capital to the capital line, an `a` to the small-letter line), within reason.
- **Sentences** (the last tab) is for writing the way you really write. Copy the sentence shown onto the ruled lines, in print with the letters apart, and tap **Learn from this**: each letter is matched to the one in its box, and from then on the font draws every character as the average of all the times you have written it, so the odd wobble in one drawing fades. Learned letters turn gold and are labeled; ones that did not match the letter in their box closely enough stay coral and teach nothing. A sentence that lines up word for word always teaches the letters that match, however few — one word written differently ("jumped" for "jumps") costs only that word — while one that does not line up (not the sentence shown) teaches nothing at all, and the note under the lines says which of the two it was. A box shows ×3 when its letter has been written three more times; **Undo** takes back the last stroke on the lines, or the last sentence learned; **Use my sentences in the font** switches the averaging off without forgetting anything. The first sentences use every letter of the alphabet; later ones bring in capitals, numbers and signs. A few sentences make a real difference.
- **Pen weight, letter spacing and smoothing** apply to the sentence letters too, and the box drawings are still what each average starts from: write the boxes first.
- **Download font (.ttf)** gives a TrueType font. On Windows or a Mac, double-click it and choose Install; it then appears in Word, PowerPoint, Pages and the rest. In Canva, add it under Brand Kit → Fonts → Upload. Chromebooks cannot install fonts, and Google Docs and Slides only offer Google's own fonts.
- **Copy font for web pages** copies a `@font-face` rule with the whole font inside it. Paste it into the `<style>` of any single-file tool and use `font-family: "My Handwriting"` (or whatever you named it).
- **Save handwriting** keeps your strokes, sentences included, as a `.json` file; **Open handwriting** brings them back on any computer to change a character or try a different pen weight. The same file opened in Nib Board's **My handwriting** shows the board in your hand, with the averaged letters.
- **Teach Nib my handwriting** stores the shape of every character you wrote in Nib's memory in this browser (the box drawing and the two most recent times you wrote it in a sentence), so tools that use Nib read your writing better.

Your writing stays in the browser (local storage) until you save it. Missing characters fall back to the system font wherever the font is used.
