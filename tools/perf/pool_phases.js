// Where a pooled cold read's time goes (1.8.0): the pad of test/pool_page.html given a page of N expressions, with
// the pool off, at one worker and at two — the time until the first group is sent (listing what there is to
// classify, and the first worker's start), the workers' own time, and the read's steps after their last answer.
// It prints; it asserts nothing. Three runs of each, each on a new page.
//   node tools/perf/pool_phases.js [N=120] [workers=0,1,2]
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const REPO = path.join(__dirname, '..', '..'), T = require(REPO + '/test/data'), puppeteer = require(T.npm('puppeteer-core'));   // the repository, and where its tests find packages and Chrome
// (the page's helpers are the browser suite's own: its pageMain, taken out of its source)
const src = fs.readFileSync(REPO + '/test/pool_browser.js', 'utf8');
const a = src.indexOf('function pageMain()'), b = src.indexOf('// ---------------------------------------------------------------- the driver');
const helper = '(' + src.slice(a, b).trim() + ')();';
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').map(JSON.parse).map(r => ({ strokes: r.strokes }));
const ATTRS = { view: 'ink', settle: '0', delay: '30', separate: '', times: 'false', reveal: '', solve: '', infinite: '', paper: 'dots' };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-'));
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, userDataDir: path.join(dir, 'p'), protocolTimeout: 0, args: ['--no-sandbox'] });
  const N = +(process.argv[2] || 120);
  for (const use of (process.argv[3] || '0,1,2').split(',').map(Number)) {
    for (let rep = 0; rep < 3; rep++) {
      const page = await browser.newPage(); await page.setViewport({ width: 1400, height: 900 });
      await page.goto('file://' + REPO + '/test/pool_page.html', { waitUntil: 'load' });
      await page.addScriptTag({ content: helper });
      const r = await page.evaluate(async (attrs, rows, N, use) => {
        const I = Nib._internals; X.attrs = attrs; I.poolUse(use);
        X.pad(X.attrs);
        const P = X.P, t = {};
        const ask = P._ask.bind(P), steps = P._steps.bind(P);
        P._ask = (gen, then) => { if (!t.ask) t.ask = performance.now(); return ask(gen, then); };
        P._steps = (gen, start) => { t.steps = performance.now(); return steps(gen, start); };
        P.setState({ strokes: X.strokes(rows, N, 1) });
        // when the pool is first given work (the steps begin as its last answer comes)
        let sent = 0;
        const iv = setInterval(() => { if (!sent && I.poolTest('stats').sent > 0) sent = performance.now(); }, 2);
        await X.rest(); clearInterval(iv);
        const end = performance.now(), s = I.poolTest('stats');
        return { toFirstGroupSent: sent ? Math.round(sent - t.ask) : null, workers: sent ? Math.round(t.steps - sent) : null, steps: Math.round(end - t.steps), read: P.result.ms, inWorkers: s.answered, here: s.here };
      }, ATTRS, rows, N, use);
      console.log(`${N} expressions, poolUse(${use}):`, JSON.stringify(r));
      await page.close();
    }
  }
  await browser.close();
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
