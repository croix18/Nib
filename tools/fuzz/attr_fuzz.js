'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(T.npm('puppeteer-core'));
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').slice(0, 5).map(JSON.parse);
const wait = ms => new Promise(r => setTimeout(r, ms));
const html = '<!doctype html><meta charset="utf-8"><style>nib-pad{display:block;width:700px;height:400px;border:1px solid #ccc}</style><body><script src="file://' + REPO + '/dist/nib.js"></script><div id="host"></div></body>';
const PAGE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nibattrpage-')), 'attr_page.html');
fs.writeFileSync(PAGE, html);
const vals = ['', 'x', 'true', 'false', '0', '-1', 'NaN', 'Infinity', '1e9', '1e-9', 'null', 'undefined', '__proto__', 'constructor', 'school', 'all', 'numbers', 'nope', '1,2,3', ',', 'a,b', '1,nope', 'tidy', 'hand', 'typeset', 'ink', '@red', '#fff', 'url(x)', 'dots', 'grid white', 'plane black', 'nope nope', 'grid nope', '800 600', '0 0', '-5 1e9', 'x y', '800', '1e9 1e9', '0.001 0.001', 'answers', 'stroke', 'area', 'writes', 'pans', 'ignored', '😀', ' ', 'x'.repeat(5000)];
const attrs = ['symbols', 'ink', 'stroke-width', 'delay', 'settle', 'auto', 'boxes', 'pen-only', 'lines', 'degrees', 'smooth', 'view', 'motion', 'separate', 'solve', 'times', 'reveal', 'fit', 'train', 'infinite', 'paper', 'fingers', 'pinch', 'pressure', 'eraser', 'snap', 'hold', 'read', 'page', 'draw', 'palm', 'single', 'scribble'];
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nibattr-'));
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, userDataDir: dir, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage(); let errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 140) + ' @ ' + String(e.stack || '').split('\n')[1]));
  await page.goto('file://' + PAGE, { waitUntil: 'load' });
  const bad = [];
  let n = 0;
  for (const a of attrs) for (const v of vals) {
    errors = [];
    const r = await page.evaluate(async ([a, v, strokes]) => {
      const host = document.getElementById('host'); host.innerHTML = '';
      const el = document.createElement('nib-pad'); el.setAttribute('solve', ''); el.setAttribute(a, v);
      let threw = null;
      try { host.appendChild(el); } catch (e) { threw = 'append: ' + e.message; }
      await new Promise(r => setTimeout(r, 30));
      let got = null;
      try {
        el.strokes = strokes.map(s => s.map(p => [p[0] * 0.5 + 40, p[1] * 0.5 + 60]));
        const t0 = performance.now();
        while (performance.now() - t0 < 2500 && !(el.pad && el.pad.result)) await new Promise(r => setTimeout(r, 40));
        // change it while live, draw, state round trip
        el.setAttribute(a, v + ' '); el.setAttribute(a, v);
        const st = el.getState(); el.setState(st);
        if (el.pad) { el.pad.redraw(); el.pad.undo(); el.pad.redraw(); }
        got = { pad: !!el.pad, res: !!(el.pad && el.pad.result), latex: el.latex, n: el.pad ? el.pad.strokes.length : -1 };
      } catch (e) { threw = (threw ? threw + '; ' : '') + e.message + ' @ ' + String(e.stack).split('\n')[1]; }
      return { got, threw };
    }, [a, v, rows[1].strokes]);
    await wait(60);
    n++;
    const reads = !['auto', 'read', 'draw'].includes(a);
    if (errors.length || r.threw || !r.got || !r.got.pad) bad.push(`${a}="${v.slice(0, 20)}"  ${r.threw ? 'threw ' + r.threw.slice(0, 160) : ''} ${errors.length ? errors.length + ' page error(s): ' + errors[0].slice(0, 200) : ''} ${JSON.stringify(r.got)}`);
  }
  console.log(n + ' attribute values tried; ' + bad.length + ' with errors');
  const by = {}; for (const b of bad) { const k = b.split('"')[0] + ' :: ' + (b.match(/(threw|page error\(s\):) ([^@]{0,70})/) || [])[2]; (by[k] = by[k] || []).push(b); }
  for (const k of Object.keys(by)) console.log(String(by[k].length).padStart(3), k, '\n      e.g.', by[k][0].slice(0, 330));
  await browser.close(); fs.rmSync(dir, { recursive: true, force: true });
})();
