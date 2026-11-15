// One stroke of a symbol moved away from the other: is the symbol read again where its strokes are now?
// (Found on 15 November 2026, docs/reviews/found-2026-11-15.md: a recognizer keeps a group's classification under the
// strokes' ids, and a stroke that is moved keeps its id — so the pair is still read as what it was.)
// A pad reads "2 + 3" with the plus written as two strokes; the bar of the plus is selected and nudged down or up;
// the pad reads again; and a recognizer that has never seen the strokes reads the same ink. The two must agree.
//   node tools/verify/moved_probe.js [engine = dist/nib.js]          exit 1 when they do not
'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(T.npm('puppeteer-core'));
const ENGINE = path.resolve(process.argv[2] || REPO + '/dist/nib.js');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nibmoved-'));
  const pads = { 'a board': 'separate', 'a pad of one expression': '' };
  for (const k of Object.keys(pads)) fs.writeFileSync(path.join(dir, pads[k] + 'page.html'), `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}nib-pad{display:block;width:1000px;height:700px}</style>
<nib-pad id="pad" view="ink" settle="0" delay="30" auto="false" ${pads[k]} times="false"></nib-pad><script src="${ENGINE}"></script>`);
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, args: ['--no-sandbox'] });
  let stale = 0;
  for (const k of Object.keys(pads)) for (const dy of [26, 40, -30]) {
    const page = await browser.newPage(); await page.setViewport({ width: 1000, height: 700 });
    await page.goto('file://' + path.join(dir, pads[k] + 'page.html'), { waitUntil: 'load' });
    const r = await page.evaluate(async dy => {
      const el = document.getElementById('pad'); for (let i = 0; i < 300 && !el.pad; i++) await new Promise(r => setTimeout(r, 20));
      const P = el.pad;
      const line = (x0, y0, x1, y1, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
      const path = pts => pts.flatMap((p, i, a) => (i ? line(a[i - 1][0], a[i - 1][1], p[0], p[1], 6).slice(1) : [p]));
      const two = path([[100, 110], [110, 100], [125, 100], [132, 110], [128, 125], [100, 150], [135, 150]]), three = path([[250, 102], [275, 100], [262, 122], [278, 135], [270, 150], [250, 150]]);
      P.setState({ strokes: [two, line(190, 105, 190, 150, 12), line(168, 128, 212, 128, 12), three] });
      const before = P.recognize().latex, bar = P.ink[2];
      P.select([bar]); P.nudgeSelection(0, dy); P.clearSelection();
      return { before, after: P.recognize().latex, fresh: new Nib.Recognizer().recognize(P.ink, P._ropts()).latex, nib: Nib.version };
    }, dy);
    const ok = r.after === r.fresh; if (!ok) stale++;
    console.log(`${ok ? 'ok   ' : 'STALE'} ${k} (Nib ${r.nib}): "${r.before}", the bar of the plus nudged ${dy > 0 ? 'down' : 'up'} by ${Math.abs(dy)}: the pad reads "${r.after}", a recognizer that never saw the strokes "${r.fresh}"`);
    await page.close();
  }
  await browser.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(stale ? `\n${stale} of 6: the pad still reads what was there before the stroke moved` : '\nmoved ink is read where it is');
  process.exit(stale ? 1 : 0);
})();
