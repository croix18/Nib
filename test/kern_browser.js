// The classifier's kernel in a real browser (1.7.0; the node side is test/kern_check.js):
//   1. the Board opened as file://, with no flags, classifies with the kernel (Nib.kernel is 'simd')
//   2. with a Content-Security-Policy that forbids WebAssembly, and with WebAssembly gone before the engine loads, it
//      reads the same writing to the same LaTeX on the JS path, says so once with console.info, and has no page error
//   node test/kern_browser.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(require('./data').npm('puppeteer-core'));
const Nib = require(path.join(__dirname, '..', 'dist', 'nib.js'));
const { compose } = require('./compose.js');
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (c) passes++; else fails++; };
const flat = t => String(t || '').replace(/\s/g, '');
const BOARD = path.join(__dirname, '..', 'dist', 'Board.html');
// an expression from real writers' symbols that Nib reads as written, top left at (x, y), symbols about h tall
const written = (tex, x, y, h) => {
  for (let k = 0; k < 120; k++) {
    const e = compose(tex);
    if (flat(new Nib.Recognizer().recognize(e.strokes, { times: false }).latex) !== flat(tex)) continue;
    const xs = e.strokes.flat().map(p => p[0]), ys = e.strokes.flat().map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), s = h / 50;
    return e.strokes.map(st => st.map(p => [Math.round((x + (p[0] - x0) * s) * 10) / 10, Math.round((y + (p[1] - y0) * s) * 10) / 10]));
  }
  return null;
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-kern-'));
  // the Board with a policy that allows its own inline script and nothing else: no WebAssembly ('wasm-unsafe-eval')
  const csp = path.join(dir, 'Board-csp.html');
  fs.writeFileSync(csp, fs.readFileSync(BOARD, 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="script-src \'unsafe-inline\'">'));
  const A = written('3x+4=19', 80, 120, 50), B = written('6+7=', 80, 320, 50);
  ok(A && B, 'writing composed that reads 3x+4=19 and 6+7=');
  const pk = [...A, ...B].map(s => Nib.canvas.pack(s, false));
  const seed = { 'nib-board-v3': JSON.stringify({ v: 3, page: 0, pages: [{ pk, fixes: [], revealed: [], types: [], paper: { kind: 'blank', tone: 'theme' } }] }) };
  // the classroom's way: a file opened in Chrome, no flags
  const browser = await puppeteer.launch({ executablePath: require('./data').needChrome(), headless: true, userDataDir: path.join(dir, 'profile'), args: ['--no-sandbox'] });
  const read = async (file, before) => {
    const page = await browser.newPage(), errors = [], infos = [];
    page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'info') infos.push(m.text()); if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
    await page.setViewport({ width: 1200, height: 800 });
    await page.evaluateOnNewDocument((kv, gone) => {
      localStorage.clear(); for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]);
      if (gone) delete window.WebAssembly;
    }, seed, before === 'gone');
    await page.goto('file://' + file, { waitUntil: 'load' });
    await page.waitForFunction(() => { const p = document.getElementById('pad'); return p && p.pad && p.pad.result && p.pad.result.parts && p.pad.strokes.length && p.pad.strokes.length === p.pad.resultStrokes.length; }, { timeout: 120000 });
    const r = await page.evaluate(() => ({ kernel: Nib.kernel, wasm: typeof WebAssembly, parts: document.getElementById('pad').pad.result.parts.map(p => p.result.latex).sort(), line: (document.getElementById('engineline') || {}).textContent || '' }));
    await page.close();
    return Object.assign(r, { errors, infos });
  };

  console.log('the Board, file://');
  const k = await read(BOARD);
  ok(k.kernel === 'simd', `Nib.kernel is ${k.kernel}`);
  ok(k.parts.length === 2 && k.parts.map(flat).join(' ') === '3x+4=19 6+7=', `it reads ${JSON.stringify(k.parts)}`);
  ok(!k.infos.some(t => /JavaScript/.test(t)) && !k.errors.length, 'nothing said, no page error' + (k.errors.length ? ': ' + k.errors.join(' | ') : ''));
  ok(k.line === 'Nib ' + Nib.version + ' · the fast reader is on', `Settings says so at its foot: ${JSON.stringify(k.line)}`);

  console.log('where WebAssembly cannot run');
  for (const [name, file, before] of [['a Content-Security-Policy without wasm-unsafe-eval', csp], ['WebAssembly deleted before the engine loads', BOARD, 'gone']]) {
    const j = await read(file, before);
    ok(j.kernel === 'js', `${name}: Nib.kernel is ${j.kernel} (WebAssembly: ${j.wasm})`);
    ok(JSON.stringify(j.parts) === JSON.stringify(k.parts), `the same reading on the JS path: ${JSON.stringify(j.parts)}`);
    const said = j.infos.filter(t => /^Nib: the classifier runs in JavaScript/.test(t));
    ok(said.length === 1 && !j.errors.length, `said once (${JSON.stringify(said[0] || '')}), no page error` + (j.errors.length ? ': ' + j.errors.join(' | ') : ''));
    ok(/cannot run the fast reader/.test(j.line), `and Settings: ${JSON.stringify(j.line)}`);
  }

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
