// The <nib-pad> element in a real browser: two pads on one page, events, undo/redo/clear, erase mode, the strokes
// setter, moving the element in the page and putting it back, palm rejection (pen then touch), a cancelled tap,
// and reading speed with the CPU slowed 4x (a Chromebook) without long main-thread stalls; the pointer rules (a pen's
// one-second window over touch, palms by contact size, a pen taking over from a palm, the pen's eraser end, two
// fingers at once, the mode kept per stroke, a lost pointerup) and the eraser (ring, radius, segments).
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
  const strokesB = await page.evaluate(() => b.strokes.length);
  const bb = await (await page.$('#b canvas')).boundingBox();
  const touchLine = async (x0, y0, x1, y1) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bb.x + x0, y: bb.y + y0 }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bb.x + x0 + (x1 - x0) * i / 6, y: bb.y + y0 + (y1 - y0) * i / 6 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await touchLine(30, 30, 80, 60);                       // straight after the pen: a hand resting on the board
  ok(await page.evaluate(() => b.strokes.length) === strokesB, 'a resting palm (touch) just after the pen draws nothing');
  await settle();
  const penLatex = await latex('b');
  ok(penLatex === '\\frac{35}{528}', 'numbers pad reads the pen ink: ' + penLatex);
  await touchLine(30, 120, 90, 125);                     // more than a second after the pen: a finger writes again
  ok(await page.evaluate(() => b.strokes.length) === strokesB + 1, 'a second after the pen, a finger draws again by itself');
  await page.evaluate(() => b.undo()); await settle(600);

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

  console.log('pointer rules (synthetic pointer events)');
  // events straight to a pad's canvas: what a panel, a tablet's pen or a palm sends (width/height, buttons)
  await page.evaluate(() => {
    window.ptr = (el, type, kind, id, x, y, o = {}) => {
      const c = el.querySelector('canvas'), r = c.getBoundingClientRect();
      const e = new PointerEvent('pointer' + type, Object.assign({ pointerId: id, pointerType: kind, clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true,
        isPrimary: true, button: type === 'down' ? 0 : -1, buttons: type === 'up' ? 0 : 1, width: 1, height: 1, pressure: 0.5 }, o));
      c.dispatchEvent(e); return e.defaultPrevented;
    };
    window.line = (el, kind, id, x0, y0, x1, y1, o = {}, n = 8) => {
      ptr(el, 'down', kind, id, x0, y0, o);
      for (let i = 1; i <= n; i++) ptr(el, 'move', kind, id, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, o);
      ptr(el, 'up', kind, id, x1, y1, o);
    };
  });
  await page.evaluate(() => { a.clear(); a.pad.penUntil = 0; a.setAttribute('auto', 'false'); });
  const nA = () => page.evaluate(() => a.strokes.length);
  await page.evaluate(() => line(a, 'touch', 11, 20, 20, 120, 30, { width: 40, height: 40 }));
  ok(await nA() === 0, 'a wide contact (a palm, 40 px) draws nothing');
  await page.evaluate(() => line(a, 'touch', 12, 20, 20, 120, 30, { width: 1, height: 1 }));
  ok(await nA() === 1, 'a contact the browser gives no size for (1 px) is a finger: it draws');
  await page.evaluate(() => line(a, 'touch', 13, 20, 60, 120, 70, { width: 0, height: 0 }));
  ok(await nA() === 2, 'and so does one reported as 0');
  await page.evaluate(() => { ptr(a, 'down', 'touch', 14, 20, 100); ptr(a, 'move', 'touch', 14, 30, 102); ptr(a, 'move', 'touch', 14, 30, 102, { width: 50, height: 50 }); ptr(a, 'up', 'touch', 14, 40, 104); });
  ok(await nA() === 2, 'a touch whose contact grows into a palm while it is young is dropped');
  // the palm lands first, then the pen: the palm's young stroke goes and the pen writes
  await page.evaluate(() => {
    ptr(a, 'down', 'touch', 21, 200, 150); ptr(a, 'move', 'touch', 21, 205, 152);
    line(a, 'pen', 22, 300, 40, 380, 60);
    ptr(a, 'move', 'touch', 21, 215, 160); ptr(a, 'up', 'touch', 21, 220, 162);
  });
  const kinds = await page.evaluate(() => a.strokes.map(s => Math.round(s[0][0])));
  ok(kinds.length === 3 && kinds[2] === 300, `a pen coming down while a touch stroke is young drops the touch and keeps the pen (${kinds.join(', ')})`);
  await page.evaluate(() => { ptr(a, 'down', 'pen', 23, 300, 120); line(a, 'touch', 24, 20, 140, 120, 150); ptr(a, 'move', 'pen', 23, 330, 125); ptr(a, 'up', 'pen', 23, 360, 130); });
  ok(await nA() === 4, 'while a pen is down a new touch is ignored, and the pen stroke stands');
  ok(await page.evaluate(() => a.pad.penUntil - performance.now()) > 700, 'touch stays ignored for about a second after the pen');
  await page.evaluate(() => line(a, 'touch', 25, 20, 180, 120, 190));
  ok(await nA() === 4, 'a finger right after the pen draws nothing');
  await new Promise(r => setTimeout(r, 1100));
  await page.evaluate(() => line(a, 'touch', 26, 20, 180, 120, 190));
  ok(await nA() === 5, 'a second later the same finger writes');
  // the pen's eraser end erases (for that stroke only)
  const before5 = await page.evaluate(() => a.strokes.map(s => Math.round(s[0][1])));
  await page.evaluate(() => line(a, 'pen', 27, 70, 0, 70, 80, { buttons: 32 }));
  const after5 = await page.evaluate(() => ({ ys: a.strokes.map(s => Math.round(s[0][1])), mode: a.mode }));
  ok(after5.ys.length < before5.length && after5.mode === 'draw', `the pen's eraser end erases what it crosses and leaves the pad drawing (${before5.length} -> ${after5.ys.length})`);
  await page.evaluate(() => line(a, 'pen', 28, 400, 150, 450, 160));
  ok(await nA() === after5.ys.length + 1, 'the next pen stroke draws');
  // two fingers at once: two strokes, each finished on its own
  await page.evaluate(() => { a.clear(); a.pad.penUntil = 0; });
  await page.evaluate(() => {
    ptr(a, 'down', 'touch', 31, 20, 40); ptr(a, 'down', 'touch', 32, 400, 40, { isPrimary: false });
    for (let i = 1; i <= 8; i++) { ptr(a, 'move', 'touch', 31, 20 + 10 * i, 40 + i); ptr(a, 'move', 'touch', 32, 400 + 10 * i, 60 + i, { isPrimary: false }); }
    ptr(a, 'up', 'touch', 32, 480, 68, { isPrimary: false });
    window.__mid = a.strokes.length;
    for (let i = 9; i <= 12; i++) ptr(a, 'move', 'touch', 31, 20 + 10 * i, 40 + i);
    ptr(a, 'up', 'touch', 31, 140, 52);
  });
  const two = await page.evaluate(() => ({ mid: __mid, n: a.strokes.length, len: a.strokes.map(s => s.length), xs: a.strokes.map(s => Math.round(s[0][0])) }));
  ok(two.mid === 1 && two.n === 2 && two.xs.includes(20) && two.xs.includes(400) && two.len.every(l => l >= 9), `two fingers write two strokes at once, each finished on its own (${JSON.stringify(two)})`);
  // erase switched on in the middle of a stroke: the stroke still ends as one stroke, once
  await page.evaluate(() => { a.clear(); a.pad.history.length = 0; window.__err = null; });
  await page.evaluate(() => { try { ptr(a, 'down', 'mouse', 1, 20, 20); ptr(a, 'move', 'mouse', 1, 60, 30); a.mode = 'erase'; ptr(a, 'move', 'mouse', 1, 100, 40); ptr(a, 'up', 'mouse', 1, 120, 40); } catch (e) { window.__err = String(e); } });
  const mid = await page.evaluate(() => ({ n: a.strokes.length, h: a.pad.history.length, err: __err, len: a.strokes[0] && a.strokes[0].length }));
  ok(mid.n === 1 && mid.h === 1 && !mid.err && mid.len === 3, `Erase turned on mid-stroke: the stroke is kept whole, once, no error (${JSON.stringify(mid)})`);
  await page.evaluate(() => { try { ptr(a, 'down', 'mouse', 1, 20, 20); a.mode = 'draw'; ptr(a, 'move', 'mouse', 1, 100, 40); ptr(a, 'up', 'mouse', 1, 120, 40); } catch (e) { window.__err = String(e); } });
  const mid2 = await page.evaluate(() => ({ n: a.strokes.length, h: a.pad.history.length, err: __err, last: a.pad.history[a.pad.history.length - 1] }));
  ok(mid2.n === 0 && mid2.h === 2 && !mid2.err && !!mid2.last.erase, `Erase turned off mid-stroke: that stroke still erases, and leaves no ghost stroke (${mid2.n} strokes)`);
  await page.evaluate(() => { a.mode = 'draw'; });
  // a pointer that lost its pointerup: after 1.5 s quiet, a new pointerdown finishes it and is taken
  await page.evaluate(() => { a.clear(); ptr(a, 'down', 'touch', 41, 20, 20); for (let i = 1; i < 6; i++) ptr(a, 'move', 'touch', 41, 20 + 8 * i, 20); });
  await new Promise(r => setTimeout(r, 1600));
  await page.evaluate(() => line(a, 'touch', 42, 20, 120, 120, 130));
  ok(await page.evaluate(() => a.strokes.length === 2 && a.pad.ptrs.size === 0), 'a stroke whose pointerup was lost is finished when the next pointer comes down 1.5 s later');
  // two real fingers through the browser (CDP touch events)
  await page.evaluate(() => { a.clear(); a.pad.penUntil = 0; });
  {
    const ab = await (await page.$('#a canvas')).boundingBox();
    const P = i => [{ x: ab.x + 40 + 10 * i, y: ab.y + 40, id: 1 }, { x: ab.x + 400 + 10 * i, y: ab.y + 120 + 3 * i, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: P(0) });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: P(i) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const got = await page.evaluate(() => a.strokes.map(s => [Math.round(s[0][0]), s.length]));
    ok(got.length === 2 && got.every(g => g[1] >= 8), `two fingers through the browser's touch events: two strokes (${JSON.stringify(got)})`);
  }
  // the eraser: a ring where it is, a radius from the writing's size, strokes tested along their segments
  await page.evaluate(() => { a.clear(); a.mode = 'erase'; });
  const ring = await page.evaluate(() => {
    ptr(a, 'down', 'mouse', 1, 300, 130); ptr(a, 'move', 'mouse', 1, 302, 130);
    return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => {
      const c = a.querySelector('canvas'), d = a.pad.dpr, r = a.pad.ptrs.get(1).r, g = c.getContext('2d');
      const px = (x, y) => g.getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data[3];
      let onRing = 0; for (let k = 0; k < 16; k++) { const t = k * Math.PI / 8; onRing += Math.max(px(302 + r * Math.cos(t), 130 + r * Math.sin(t)), px(302 + (r - 0.7) * Math.cos(t), 130 + (r - 0.7) * Math.sin(t)), px(302 + (r + 0.7) * Math.cos(t), 130 + (r + 0.7) * Math.sin(t))) > 0 ? 1 : 0; }
      const centre = px(302, 130);
      ptr(a, 'up', 'mouse', 1, 302, 130);
      requestAnimationFrame(() => { const after = g.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0); res({ r, onRing, centre, after }); });
    })));
  });
  ok(ring.r === 14 && ring.onRing >= 12 && ring.centre === 0 && !ring.after, `erasing shows a faint ring of the eraser's size (r ${ring.r}, ${ring.onRing}/16 points on it), gone when the eraser lifts`);
  const rad = await page.evaluate(() => {
    a.mode = 'draw';
    a.strokes = [[[100, 40], [100, 140]], [[160, 40], [160, 140]], [[600, 40], [700, 40]]];
    a.mode = 'erase'; ptr(a, 'down', 'touch', 51, 130, 90, { width: 60, height: 60 }); const r1 = a.pad.ptrs.size ? a.pad.ptrs.get(51).r : -1; ptr(a, 'up', 'touch', 51, 130, 90);
    ptr(a, 'down', 'mouse', 1, 130, 90); const r2 = a.pad.ptrs.get(1).r; ptr(a, 'up', 'mouse', 1, 130, 90);
    a.pad.penUntil = 0; ptr(a, 'down', 'pen', 52, 130, 90); const r3 = a.pad.ptrs.get(52).r; ptr(a, 'up', 'pen', 52, 130, 90);
    return { r1, r2, r3 };
  });
  ok(rad.r2 === 20 && rad.r3 === 20, `the eraser's radius is a fifth of the writing near it (100 px tall: ${rad.r2})`);
  ok(rad.r1 === 30, `with Erase on, the side of a hand (60 px contact) rubs out with half its width (${rad.r1})`);
  const seg = await page.evaluate(() => { a.mode = 'draw'; a.strokes = [[[100, 60], [500, 60]]]; a.mode = 'erase'; line(a, 'mouse', 1, 300, 50, 300, 52, {}, 2); const n = a.strokes.length; a.mode = 'draw'; return n; });
  ok(seg === 0, 'a long straight stroke (two points, 400 px apart) is erased by touching its middle');
  await page.evaluate(() => { a.removeAttribute('auto'); a.clear(); a.mode = 'draw'; });

  console.log('history, state');
  const hist = await page.evaluate(() => { a.setAttribute('auto', 'false'); for (let i = 0; i < 620; i++) line(a, 'mouse', 1, 20 + (i % 50) * 9, 20 + Math.floor(i / 50) * 15, 25 + (i % 50) * 9, 26 + Math.floor(i / 50) * 15, {}, 2); const h = a.pad.history.length; a.clear(); return h; });
  ok(hist === 500, `undo history is capped at 500 steps (${hist})`);
  const st = await page.evaluate(() => {
    a.strokes = [[[10, 10], [20, 20]], [[30, 10], [40, 20]], [[50, 10], [60, 20]]];
    a.pad.fixes = [{ strokes: [a.pad.strokes[1]], label: '7' }];
    const s1 = a.getState(); a.clear(); a.setState(s1); const s2 = a.getState();
    a.clear(); a.undo(); const back = a.pad.fixes.length === 1 && a.pad.fixes[0].strokes[0] === a.pad.strokes[1];
    a.removeAttribute('auto'); a.clear();
    return { s1, s2, back };
  });
  ok(JSON.stringify(st.s1) === JSON.stringify(st.s2) && st.s1.fixes[0].strokes[0] === 1, 'getState/setState keep the strokes and the corrections (as stroke indices)');
  ok(st.back, 'Clear then Undo brings the corrections back with the strokes');

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
