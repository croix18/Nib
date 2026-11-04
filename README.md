# Nib

Handwritten maths to LaTeX, in the browser. One file, no internet, no dependencies, nothing stored or sent anywhere.

```
dist/nib.js            the engine and the writing pad (drop into any page)
dist/Nib.html          a self-contained tester: open it from Drive or your desktop
dist/Replicator.html   turn your own handwriting into a font (see the end of this page)
```

It reads ink — pen, finger or mouse strokes — not photos of paper.

## How well it reads

Measured on handwriting from writers it never saw in training (the CROHME 2019 test set) and never used for tuning.

| Test | Expressions | Read exactly right |
| --- | --- | --- |
| Middle-school maths composed from those writers' real symbols (`test/school_synth.jsonl`) | 700 | 89.3% |
| Real expressions in middle-school notation (no subscripts, calculus or rare symbols) | 546 | 70.0% |
| The full CROHME 2019 test set (university maths, symbol set `all`) | 1,187 | 55.8% |

"Exactly right" means every symbol and every fraction, power, root and line in the LaTeX matches. By category on the composed school set: arithmetic 90%, one- and two-step equations 88%, inequalities 88%, fractions and mixed numbers 90%, powers and scientific notation 94%, roots 95%, percents and money 96%, ratios 90%, formulas 87%, absolute value 83%, multi-line work 81%.

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

Attributes: `symbols="school|all|numbers|0,1,2,x,+"`, `ink="#1b2a4a"`, `stroke-width="3"`, `delay="450"` (ms of rest before reading), `auto="false"` (only read when you call `recognize()`), `boxes` (draw what was read), `pen-only` (ignore fingers and palms), `lines="false"`, `degrees="false"`, `smooth="0.03"` (smooth very shaky ink before reading; off by default, as finger ink already reads as well as pen ink).

Properties and methods: `latex`, `text`, `result`, `strokes` (get or set), `mode` (`'draw'` or `'erase'`), `undo()`, `redo()`, `clear()`, `recognize()`, `relabel(symbol, label)`.

The pad takes its ink colour from the CSS variable `--nib-ink` (or the element's text colour), so it follows each tool's theme. Reading happens a few milliseconds at a time between frames, so the page never freezes while a long expression is read (checked with the processor slowed four times). With a pen in use, a resting palm draws nothing. Two pads on one page work independently, and a pad moved or removed and put back keeps its ink.

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
- The engine file is about 870 KB. A new stroke is read in roughly 0.1–0.3 s on a laptop; a whole expression handed over at once takes longer (about 0.05 s per stroke).

`docs/HANDOFF.md` explains how it works and how to change it; `training/README.md` how to retrain it; `node test/check.js` runs the regression suite.

## Replicator: your handwriting as a font

`dist/Replicator.html` is one file that works offline. Write each character in its box — capitals, lowercase, numbers, punctuation and the maths signs — and the font builds itself beside the sheet as you go. The dashed lines are the tops of capitals and of small letters, the solid line is where letters sit, and the dotted line is how far `g j p q y` hang.

- **Pen weight, letter spacing and smoothing** change the whole font at once. **Line up with the guides** sets letters that sit a little high or low onto the line.
- **Download font (.ttf)** gives a TrueType font. On Windows or a Mac, double-click it and choose Install; it then appears in Word, PowerPoint, Pages and the rest. In Canva, add it under Brand Kit → Fonts → Upload. Chromebooks cannot install fonts, and Google Docs and Slides only offer Google's own fonts.
- **Copy font for web pages** copies a `@font-face` rule with the whole font inside it. Paste it into the `<style>` of any single-file tool and use `font-family: "My Handwriting"` (or whatever you named it).
- **Save handwriting** keeps your strokes as a `.json` file; **Open handwriting** brings them back on any computer to change a character or try a different pen weight.
- **Teach Nib my handwriting** stores the shape of every character you wrote in Nib's memory in this browser, so tools that use Nib read your writing better.

Your writing stays in the browser (local storage) until you save it. Missing characters fall back to the system font wherever the font is used.
