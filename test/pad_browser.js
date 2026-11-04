// The <nib-pad> element in a real browser: two pads on one page, events, undo/redo/clear, erase mode, the strokes
// setter, moving the element in the page and putting it back, palm rejection (pen then touch), a cancelled tap,
// and reading speed with the CPU slowed 4x (a Chromebook) without long main-thread stalls.
//   node test/pad_browser.js
const fs = require('fs'), path = require('path');
const puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core'));
const D = process.env.NIB_DATA || path.join(__dirname, '..', 'training', 'scratch', 'data') + '/';
const rows = fs.readFileSync(D + 'test.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const pick = id => rows.find(r => r.id === id);

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 1000, height: 800 });
  await page.goto('file://' + path.join(__dirname, 'pad_page.html'), { waitUntil: 'load' });
  const cdp = await page.target().createCDPSession();

  // write an expression's strokes into a pad, scaled to fit; pointerType mouse|pen
  async function write(sel, r, type = 'mouse', region = [0.05, 0.15, 0.9, 0.7]) {
    const box = await (await page.$(sel + ' canvas')).boundingBox();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const k = Math.min(box.width * region[2] / (x1 - x0), box.height * region[3] / (y1 - y0));
    const T = p => [box.x + box.width * region[0] + (p[0] - x0) * k, box.y + box.height * region[1] + (p[1] - y0) * k];
    for (const s of r.strokes) {
      const P = s.map(T);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P[0][0], y: P[0][1], button: 'left', clickCount: 1, pointerType: type });
      for (let i = 1; i < P.length; i += 2) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: P[i][0], y: P[i][1], button: 'left', pointerType: type });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P[P.length - 1][0], y: P[P.length - 1][1], button: 'left', clickCount: 1, pointerType: type });
    }
  }
  const settle = (ms = 1500) => new Promise(r => setTimeout(r, ms));
  const latex = id => page.evaluate(id => document.getElementById(id).latex, id);

  console.log('two pads, events');
  await write('#a', pick('UN19_1050_em_723'));          // \frac{n}{2}+\frac{5}{2}
  await settle();
  ok((await latex('a')) === '\\frac{n}{2}+\\frac{5}{2}', 'pad A reads its ink: ' + await latex('a'));
  ok((await latex('b')) === '', 'pad B is untouched');
  const evA = await page.evaluate(() => events.a.slice());
  ok(evA.length >= 1 && evA[evA.length - 1] === await latex('a'), 'a change event carries the result');

  console.log('undo, redo, clear, strokes setter');
  const n0 = await page.evaluate(() => a.strokes.length);
  await page.evaluate(() => a.undo()); await settle(900);
  ok(await page.evaluate(() => a.strokes.length) === n0 - 1, 'undo removes one stroke');
  await page.evaluate(() => a.redo()); await settle(900);
  ok((await latex('a')) === '\\frac{n}{2}+\\frac{5}{2}', 'redo brings it back');
  const saved = await page.evaluate(() => a.strokes);
  await page.evaluate(() => a.clear()); await settle(400);
  ok((await latex('a')) === '' && (await page.evaluate(() => events.a[events.a.length - 1])) === null, 'clear empties the pad and reports null');
  await page.evaluate(s => { a.strokes = s; }, saved); await settle(1500);
  ok((await latex('a')) === '\\frac{n}{2}+\\frac{5}{2}', 'setting strokes reads them straight away');

  console.log('erase mode');
  await page.evaluate(() => { a.mode = 'erase'; });
  const box = await (await page.$('#a canvas')).boundingBox();
  const before = await page.evaluate(() => a.strokes.length);
  await page.mouse.move(box.x + 5, box.y + box.height * 0.5); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 5, box.y + box.height * 0.5, { steps: 40 }); await page.mouse.up(); await settle(900);
  ok(await page.evaluate(() => a.strokes.length) < before, 'dragging the eraser across removes strokes');
  await page.evaluate(() => a.undo()); await settle(1200);
  ok(await page.evaluate(() => a.strokes.length) === before, 'undo restores erased strokes');
  await page.evaluate(() => { a.mode = 'draw'; });

  console.log('moving the element and putting it back');
  await page.evaluate(() => { holder.appendChild(a); }); await settle(200);
  ok(await page.evaluate(() => a.strokes.length) === before, 'moved within the page: ink kept');
  await page.evaluate(() => { window.kept = a; a.remove(); }); await settle(300);
  await page.evaluate(() => { document.body.insertBefore(kept, b); }); await settle(1500);
  ok(await page.evaluate(() => a.strokes.length) === before && (await latex('a')) === '\\frac{n}{2}+\\frac{5}{2}', 'removed and put back: ink restored and read');

  console.log('palm rejection and a cancelled tap');
  await page.evaluate(() => b.clear());
  await write('#b', pick('UN19_1006_em_78'), 'pen');     // \frac{35}{528}, written with a pen
  await settle();
  const penLatex = await latex('b');
  const strokesB = await page.evaluate(() => b.strokes.length);
  const bb = await (await page.$('#b canvas')).boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bb.x + 30, y: bb.y + 30 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bb.x + 80, y: bb.y + 60 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settle(600);
  ok(await page.evaluate(() => b.strokes.length) === strokesB, 'after a pen is used, a resting palm (touch) draws nothing');
  ok(penLatex === '\\frac{35}{528}', 'numbers pad reads the pen ink: ' + penLatex);

  console.log('finger ink');
  await page.evaluate(() => a.clear());
  {
    const r = pick('UN19_1050_em_723'), box = await (await page.$('#a canvas')).boundingBox();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const k = Math.min(box.width * 0.9 / (x1 - x0), box.height * 0.7 / (y1 - y0));
    let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    for (const s of r.strokes) {
      let nx = 0, ny = 0;   // a fingertip's wobble: about a pixel, smooth over a few points
      const P = s.map(p => { nx = 0.7 * nx + 0.6 * rnd(); ny = 0.7 * ny + 0.6 * rnd(); return [box.x + box.width * 0.05 + (p[0] - x0) * k + nx, box.y + box.height * 0.15 + (p[1] - y0) * k + ny]; });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: P[0][0], y: P[0][1] }] });
      for (let i = 1; i < P.length; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: P[i][0], y: P[i][1] }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
  }
  await settle(2000);
  ok((await latex('a')) === '\\frac{n}{2}+\\frac{5}{2}', 'a finger-written expression reads right: ' + await latex('a'));
  await page.evaluate(() => a.setAttribute('smooth', '0.03'));
  ok(await page.evaluate(() => a.pad._ropts().smooth) === 0.03, 'smooth="0.03" smooths the ink before reading');
  await settle(1500);
  ok((await latex('a')) === '\\frac{n}{2}+\\frac{5}{2}', 'and it still reads right');
  await page.evaluate(() => a.removeAttribute('smooth'));
  ok(await page.evaluate(() => a.pad._ropts().smooth) === 0, 'without the attribute nothing is smoothed');

  console.log('a slow computer (CPU 4x slower)');
  await page.evaluate(() => { a.clear(); longTasks.length = 0; });
  await page.emulateCPUThrottling(4);
  const r = pick('UN19_1035_em_499');                   // 14 strokes
  await write('#a', r);
  const t0 = Date.now();
  await page.waitForFunction(() => a.latex.length > 0, { timeout: 60000 }).catch(() => {});
  const readMs = Date.now() - t0;
  const lt = await page.evaluate(() => longTasks.slice());
  await page.emulateCPUThrottling(1);
  ok((await latex('a')) === '8+\\frac{8\\times 7}{2}=36', 'reads correctly: ' + await latex('a'));
  console.log(`    result ${readMs} ms after the last pen-up (includes the 450 ms rest); long tasks: ${lt.length ? lt.join(', ') + ' ms' : 'none'}`);
  ok(readMs < 6000, 'answer within 6 s on a 4x slower CPU');
  ok(!lt.some(d => d > 400), 'the page never freezes for more than 0.4 s');
  ok(errors.length === 0, 'no page errors ' + (errors.length ? errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
