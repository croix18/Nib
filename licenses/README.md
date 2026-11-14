# Third-party material in Nib

What Nib carries or was made from that is not its own, where it is, and the terms it comes under. The notices
themselves are the other files in this folder.

| What | Where it is | Terms | Notice |
| --- | --- | --- | --- |
| Three KaTeX fonts (KaTeX_Main-Regular, KaTeX_Math-Italic, KaTeX_Size1-Regular), unchanged | `dist/nib.js` and every page built from it (the typeset view); `model/nib-data.json` | SIL Open Font License 1.1 | `OFL-KaTeX-fonts.txt` |
| KaTeX's script and style sheet, with its other fonts, unchanged | `dist/Nib.html` (the demo page) only | MIT (code), SIL Open Font License 1.1 (fonts) | `MIT-KaTeX.txt`, `OFL-KaTeX-fonts.txt` |
| DM Sans, DM Serif Display and DM Mono, unchanged | `dist/Board.html`, `dist/Replicator.html`, `dist/Nib.html` (their own text) | SIL Open Font License 1.1 | `OFL-DM-fonts.txt` |
| CROHME handwriting data | not in this repository (see below) | research use, not commercial use | below |

The packages the tests and builds use (`package.json`: puppeteer-core, opentype.js, and the font and KaTeX packages
above) are development tools: nothing of puppeteer-core or opentype.js is in `dist/`.

## CROHME

The recognizer's weights (`model/nib-data.json`, and so `dist/nib.js` and the pages) were trained on the CROHME
competition data, then tuned on the owner's own writing. `test/school_synth.jsonl` is made of symbols cut out of the
CROHME 2019 test set and laid out as middle-school expressions. The data itself is not in this repository:
`npm run data` fetches it for the tests.

The CROHME organizers say their data and tools are "freely available only for research purpose without any commercial
use" (<https://www.isical.ac.in/~crohme/CROHME_data.html>); the CROHME 2023 release, which takes in the earlier
collections, is published under Creative Commons Attribution-NonCommercial-ShareAlike 3.0
(<https://doi.org/10.5281/zenodo.8428035>).

What follows from that, as a note and not legal advice: using Nib in a classroom is the kind of use those terms
describe. Selling Nib, or something with this recognizer in it, is not, and would want a recognizer trained on other
data or the organizers' agreement.

## Nib itself

Nib's own code has no license file yet. Which license it gets, if any, is the owner's decision.
