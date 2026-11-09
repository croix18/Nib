// Nib inside another tool, as Deckhand uses it: a fixed page (page="W H": shown whole and centred in whatever room it is
// given, nothing pans or zooms it, two fingers write, the world is the page's own units), symbolAt for a Fix tool, and a
// layer of answers over a host's own ink (draw="answers": the host's strokes given with syncStrokes and kept by
// identity, only the answers drawn — out of focus until tapped — answerAt / showAnswer / hideAnswer, no input of its own).
//   node test/embed_browser.js
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core'));
const Nib = require(path.join(__dirname, '..', 'dist', 'nib.js'));
const { compose } = require('./compose.js');
const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const flat = t => t.replace(/\s/g, '');
// an expression composed from real writers' symbols that Nib reads as written, its top left at (x, y), its symbols
// about h tall
const written = (tex, x, y, h) => {
  for (let k = 0; k < 80; k++) {
    const e = compose(tex);
    if (flat(new Nib.Recognizer().recognize(e.strokes, { times: false }).latex) !== flat(tex)) continue;
    const xs = e.strokes.flat().map(p => p[0]), ys = e.strokes.flat().map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), s = h / 50;
    return e.strokes.map(st => st.map(p => [Math.round((x + (p[0] - x0) * s) * 10) / 10, Math.round((y + (p[1] - y0) * s) * 10) / 10]));
  }
  return null;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('file://' + path.join(__dirname, 'embed_page.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => window.pg && pg.pad && window.ans && ans.pad);
  await wait(200);
  // the reading caught up with the ink
  const settled = id => page.waitForFunction(id => { const P = document.getElementById(id).pad; return P.result && !P.anim && P.resultStrokes.length === P.strokes.length && P.resultStrokes.every((s, i) => s === P.strokes[i]); }, { timeout: 30000 }, id).catch(() => {});

  // ------------------------------------------------------------------ a fixed page
  console.log('a fixed page (page="1280 960")');
  const camOf = () => page.evaluate(() => Object.assign({}, pg.pad.cam));
  let cam = await camOf();
  const z1 = 500 / 960;
  ok(near(cam.z, z1) && near(cam.x, -(800 / z1 - 1280) / 2) && near(cam.y, 0), `shown whole and centred in an 800 × 500 frame: zoom ${cam.z.toFixed(4)}, left edge ${cam.x.toFixed(1)}`);
  await page.evaluate(() => { const f = document.getElementById('frame'); f.style.width = '640px'; f.style.height = '480px'; });
  await page.waitForFunction(() => Math.abs(pg.pad.cam.z - 0.5) < 1e-9, { timeout: 3000 }).catch(() => {});
  cam = await camOf();
  ok(near(cam.z, 0.5) && near(cam.x, 0) && near(cam.y, 0), `the frame resized to 640 × 480: the page scales with it (zoom ${cam.z})`);
  await page.evaluate(() => { const f = document.getElementById('frame'); f.style.width = '400px'; f.style.height = '700px'; });
  await page.waitForFunction(() => Math.abs(pg.pad.cam.z - 400 / 1280) < 1e-9, { timeout: 3000 }).catch(() => {});
  cam = await camOf();
  ok(near(cam.z, 400 / 1280) && near(cam.x, 0) && near(cam.y, -(700 / (400 / 1280) - 960) / 2), `a tall frame: centred top to bottom (top edge ${cam.y.toFixed(1)})`);
  await page.evaluate(() => { const f = document.getElementById('frame'); f.style.width = '800px'; f.style.height = '600px'; });
  await page.waitForFunction(() => Math.abs(pg.pad.cam.z - 0.625) < 1e-9, { timeout: 3000 }).catch(() => {});
  cam = await camOf();
  ok(near(cam.z, 0.625) && near(cam.x, 0) && near(cam.y, 0), 'a frame of the page\'s own shape: the page fills it exactly');

  // nothing moves it
  await page.evaluate(() => {
    const cv = pg.querySelector('canvas'), r = cv.getBoundingClientRect();
    for (const o of [{ deltaY: 120 }, { deltaY: -240, ctrlKey: true }, { deltaX: 200, shiftKey: true }]) cv.dispatchEvent(new WheelEvent('wheel', Object.assign({ clientX: r.left + 200, clientY: r.top + 200, bubbles: true, cancelable: true }, o)));
    pg.pad.setCamera({ x: 50, y: 60, z: 2 }); pg.pad.panBy(100, 100); pg.pad.zoomAt(3, 100, 100); pg.pad.fitContent && pg.pad.fitContent();
  });
  await wait(150);
  cam = await camOf();
  ok(near(cam.z, 0.625) && near(cam.x, 0) && near(cam.y, 0), 'the wheel, ctrl+wheel, setCamera, panBy, zoomAt and fitContent leave it where it is');

  // two fingers put down together write two strokes: nothing on a page zooms
  const two = await page.evaluate(() => {
    const n = pg.pad.strokes.length;
    ptr(pg, 'down', 'touch', 21, 600, 450); ptr(pg, 'down', 'touch', 22, 660, 450);
    for (let i = 1; i <= 8; i++) { ptr(pg, 'move', 'touch', 21, 600 - 6 * i, 450 + 4 * i); ptr(pg, 'move', 'touch', 22, 660 + 6 * i, 450 + 4 * i); }
    ptr(pg, 'up', 'touch', 21, 552, 482); ptr(pg, 'up', 'touch', 22, 708, 482);
    return { added: pg.pad.strokes.length - n, cam: Object.assign({}, pg.pad.cam) };
  });
  ok(two.added === 2 && near(two.cam.z, 0.625) && near(two.cam.x, 0), `two fingers together write two strokes, and the page stays put (${two.added} strokes)`);
  // palm="false": a touch however wide writes (a panel may report every finger that wide); single: one pointer at a time
  const hands = await page.evaluate(() => {
    const P = pg.pad, n0 = P.strokes.length, tick = (id, x, y, o) => { ptr(pg, 'down', 'touch', id, x, y, o); for (let i = 1; i <= 6; i++) ptr(pg, 'move', 'touch', id, x + 8 * i, y + 3 * i, o); ptr(pg, 'up', 'touch', id, x + 48, y + 18, o); };
    tick(51, 100, 420, { width: 40, height: 40 });
    const palmDefault = P.strokes.length - n0;
    pg.setAttribute('palm', 'false');
    tick(52, 100, 470, { width: 40, height: 40 });
    const palmOff = P.strokes.length - n0 - palmDefault;
    pg.setAttribute('single', '');
    const n1 = P.strokes.length;
    ptr(pg, 'down', 'touch', 53, 300, 420); ptr(pg, 'move', 'touch', 53, 320, 430);
    ptr(pg, 'down', 'touch', 54, 500, 420); ptr(pg, 'move', 'touch', 54, 520, 430); ptr(pg, 'move', 'touch', 53, 340, 440);
    ptr(pg, 'up', 'touch', 54, 540, 440); ptr(pg, 'up', 'touch', 53, 360, 450);
    const single = P.strokes.length - n1;
    tick(55, 300, 500);
    const after = P.strokes.length - n1 - single;
    // a pen, then at once a finger's stroke and a finger's tap: with palm="false" both write (no pen-and-palm rules)
    pg.removeAttribute('single');
    const n2 = P.strokes.length;
    ptr(pg, 'down', 'pen', 56, 600, 300); ptr(pg, 'move', 'pen', 56, 640, 310); ptr(pg, 'up', 'pen', 56, 660, 320);
    tick(57, 600, 360);
    ptr(pg, 'down', 'touch', 58, 700, 360); ptr(pg, 'up', 'touch', 58, 700, 360);
    const afterPen = P.strokes.length - n2;
    pg.removeAttribute('palm');
    return { palmDefault, palmOff, single, after, afterPen };
  });
  ok(hands.palmDefault === 0 && hands.palmOff === 1, `a 40 px touch is a palm by default and writes with palm="false" (${hands.palmDefault}, ${hands.palmOff})`);
  ok(hands.single === 1 && hands.after === 1, `single: a second finger while the first writes makes nothing; the next one after it writes (${hands.single}, ${hands.after})`);
  ok(hands.afterPen === 3, `palm="false": straight after a pen, a finger's stroke and a finger's tap write too (${hands.afterPen} of 3)`);
  await page.evaluate(() => { pg.clear(); pg.pad.history = []; pg.pad.future = []; });

  // writing lands in the page's own units
  const prob = written('12+30=', 200, 300, 90);
  ok(!!prob, 'a composed "12 + 30 =" that reads as written');
  if (prob) {
    await page.evaluate(s => writeWorld(pg, s, 'pen'), prob);
    await settled('pg');
    const st = await page.evaluate(() => ({ first: pg.pad.strokes[0][0], n: pg.pad.strokes.length, answers: pg.answers.map(a => a.latex), chips: pg.pad.plan.chips.length }));
    ok(st.n === prob.length && Math.hypot(st.first[0] - prob[0][0][0], st.first[1] - prob[0][0][1]) < 1, `the pen's strokes are in page units (the first point ${st.first.map(v => v.toFixed(1))} for ${prob[0][0]})`);
    ok(st.answers.join() === '42' && st.chips === 1, `read and worked out (${st.answers.join()}), the answer waiting for a tap`);
    const gs = await page.evaluate(() => { const s = pg.getState(); return { cam: 'cam' in s, n: s.strokes.length }; });
    ok(!gs.cam && gs.n === prob.length, 'getState keeps the strokes and no camera (the page is always shown whole)');
    await page.evaluate(() => { const s = pg.getState(); s.cam = { x: 300, y: 300, z: 4 }; pg.setState(s); });
    await settled('pg');
    cam = await camOf();
    ok(near(cam.z, 0.625) && near(cam.x, 0) && await page.evaluate(() => pg.answers.length === 1), 'setState with a camera in it puts the page back and leaves the camera');

    // the answer: found under a point on screen, shown and hidden again
    const a = await page.evaluate(() => {
      const P = pg.pad, c = P.plan.chips[0], r = P.canvas.getBoundingClientRect(), s = P.toScreen([c.cx, c.cy]);
      return { at: P.answerAt(r.left + s[0], r.top + s[1]), off: P.answerAt(r.left + 5, r.top + 5), key: c.key };
    });
    ok(a.at && a.at.hidden && a.at.key === a.key && !a.off, `answerAt finds the hidden answer under its point, nothing in the corner (${a.at && a.at.box.map(Math.round)})`);
    await page.evaluate(k => pg.pad.showAnswer(k), a.key);
    await wait(450);
    const shown = await page.evaluate(() => ({ hidden: pg.pad.plan.items.filter(i => i.answer).some(i => i.hidden), chips: pg.pad.plan.chips.length, kept: pg.getState().revealed.length }));
    ok(!shown.hidden && shown.chips === 0 && shown.kept === 1, 'showAnswer shows it (and the page keeps it shown)');
    const at2 = await page.evaluate(() => { const P = pg.pad, it = P.plan.items.find(i => i.answer), b = it.box, r = P.canvas.getBoundingClientRect(), s = P.toScreen([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]); return P.answerAt(r.left + s[0], r.top + s[1]); });
    ok(at2 && at2.hidden === false, 'answerAt finds a shown answer too, as shown');
    await page.evaluate(k => pg.pad.hideAnswer(k), a.key);
    await wait(100);
    ok(await page.evaluate(() => pg.pad.plan.chips.length === 1 && pg.getState().revealed.length === 0), 'hideAnswer puts it back out of focus');
    // a tap on it with the pen shows it (no dot written)
    const n0 = await page.evaluate(() => pg.pad.strokes.length);
    await page.evaluate(() => { const P = pg.pad, c = P.plan.chips[0], s = P.toScreen([c.cx, c.cy]); ptr(pg, 'down', 'pen', 7, s[0], s[1]); ptr(pg, 'up', 'pen', 7, s[0], s[1]); });
    await wait(450);
    ok(await page.evaluate(n0 => pg.pad.plan.chips.length === 0 && pg.pad.strokes.length === n0, n0), 'a pen tap on it shows it and writes nothing');

    // symbolAt, for a Fix tool: the symbol under a point of the page; relabel changes the reading
    const sy = await page.evaluate(() => {
      const P = pg.pad, res = P.result, plus = res.symbols.find(s => s.label === '+'), three = res.symbols.find(s => s.label === '3');
      const mid = s => [s.box.x + s.box.w / 2, s.box.y + s.box.h / 2];
      const a = P.symbolAt(...mid(plus)), b = P.symbolAt(1250, 940), c = P.symbolAt(...mid(three));
      return { plus: a && a.sym.label, box: a && a.box, none: b, three: c && c.sym.label };
    });
    ok(sy.plus === '+' && sy.three === '3' && sy.none === null, `symbolAt picks the symbol under a point (${sy.plus}, ${sy.three}) and nothing far from the writing`);
    await page.evaluate(() => { const P = pg.pad, s = P.result.symbols.find(q => q.label === '3'); const hit = P.symbolAt(s.box.x + s.box.w / 2, s.box.y + s.box.h / 2); pg.relabel(hit.sym, '8'); });
    await settled('pg'); await wait(300);
    const fixed = await page.evaluate(() => ({ latex: pg.latex, answers: pg.answers.map(a => a.latex) }));
    ok(flat(fixed.latex).startsWith('12+80=') && fixed.answers.join() === '92', `relabel: the 3 fixed to an 8 reads ${flat(fixed.latex)}, and the answer follows (${fixed.answers.join()})`);
    // Fix mode: a tap is sent on, in page units
    const tap = await page.evaluate(() => new Promise(res => {
      const P = pg.pad, s = P.result.symbols.find(q => q.label === '1'), w = [s.box.x + s.box.w / 2, s.box.y + s.box.h / 2], q = P.toScreen(w);
      pg.mode = 'fix';
      pg.addEventListener('nib:tap', e => res({ d: e.detail, w }), { once: true });
      ptr(pg, 'down', 'pen', 9, q[0], q[1]); ptr(pg, 'up', 'pen', 9, q[0], q[1]);
      setTimeout(() => res(null), 1000);
    }));
    ok(tap && Math.hypot(tap.d.x - tap.w[0], tap.d.y - tap.w[1]) < 1.5, `in fix mode a tap comes as nib:tap in page units (${tap && [tap.d.x, tap.d.y].map(v => v.toFixed(1))} for ${tap && tap.w.map(v => v.toFixed(1))})`);
    await page.evaluate(() => { pg.mode = 'draw'; });
    // a page put back with steps: Undo takes its strokes back one by one, last first
    const steps = await page.evaluate(() => {
      const s = pg.getState(), n = s.strokes.length;
      pg.setState(s, { steps: true });
      const h = pg.pad.history.length;
      pg.undo();
      const one = pg.pad.strokes.length;
      pg.redo();
      pg.setState(s);
      return { n, h, one, plain: pg.pad.history.length, back: pg.pad.strokes.length };
    });
    ok(steps.h === steps.n && steps.one === steps.n - 1 && steps.plain === 0 && steps.back === steps.n, `setState(state, {steps: true}): ${steps.h} steps for ${steps.n} strokes, Undo takes the last one back; without it, no history`);
    await settled('pg'); await wait(200);
    // a fix tells the host (nib:change), so a host keeping the page keeps the fix
    const told = await page.evaluate(() => {
      let n = 0; const f = () => n++;
      pg.addEventListener('nib:change', f);
      const sym = pg.pad.result.symbols.find(q => q.label === '+');
      pg.relabel(sym, '-');
      const fixes = pg.getState().fixes.length;
      pg.removeEventListener('nib:change', f);
      return { n, fixes };
    });
    ok(told.n >= 1 && told.fixes >= 1, `relabel sends nib:change, and the fix is in getState (${JSON.stringify(told)})`);
  }
  // keep: a pad taken out of the page and put back later is the same pad, history and all
  const kept = await page.evaluate(async () => {
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:900px;top:560px;width:300px;height:200px';
    box.innerHTML = '<nib-pad keep page="300 200" style="height:100%"></nib-pad>'; document.body.appendChild(box);
    const el = box.firstChild, P0 = el.pad;
    ptr(el, 'down', 'mouse', 61, 20, 20); ptr(el, 'move', 'mouse', 61, 80, 60); ptr(el, 'up', 'mouse', 61, 120, 90);
    const h0 = P0.history.length;
    el.remove();
    await new Promise(r => setTimeout(r, 120));
    box.appendChild(el);
    const out = { same: el.pad === P0, h: el.pad && el.pad.history.length, h0, n: el.pad && el.pad.strokes.length };
    box.remove();
    return out;
  });
  ok(kept.same && kept.h === kept.h0 && kept.n === 1, `keep: taken out and put back after a while, the same pad with its history (${JSON.stringify(kept)})`);
  // ink written beyond the page (a frame of another shape has margins, and they are written on) is never cut off when
  // the frame gets smaller: the page is shown with it, about the page's middle
  const beyond = await page.evaluate(async () => {
    const f = document.getElementById('frame'), P = pg.pad, tick = () => new Promise(r => setTimeout(r, 300));
    f.style.width = '1000px'; f.style.height = '480px'; await tick();
    const z0 = P.cam.z;
    ptr(pg, 'down', 'mouse', 41, 960, 120); for (let i = 1; i <= 8; i++) ptr(pg, 'move', 'mouse', 41, 962 + i, 120 + 25 * i); ptr(pg, 'up', 'mouse', 41, 970, 320);
    const s = P.strokes[P.strokes.length - 1], b = P._bounds(s);
    f.style.width = '640px'; f.style.height = '480px'; await tick();
    const a = P.toScreen([b[0], b[1]]), c = P.toScreen([b[2], b[3]]), pg0 = P.toScreen([0, 0]), pg1 = P.toScreen([1280, 960]);
    const out = { worldX: b[2], z0, z1: P.cam.z, inView: a[0] >= 0 && c[0] <= 640 && a[1] >= 0 && c[1] <= 480, centred: Math.abs((pg0[0] + pg1[0]) / 2 - 320) < 1 && Math.abs((pg0[1] + pg1[1]) / 2 - 240) < 1 };
    f.style.width = '800px'; f.style.height = '600px'; await tick();
    return out;
  });
  ok(beyond.worldX > 1280 && beyond.inView && beyond.centred && beyond.z1 < beyond.z0, `writing in a wide frame's margin (to x ${Math.round(beyond.worldX)}) stays in view in a smaller frame, the page still centred (zoom ${beyond.z0} → ${beyond.z1.toFixed(3)})`);
  await page.screenshot({ path: path.join(out, 'embed-page.png') });

  // ------------------------------------------------------------------ a layer of answers over a host's ink
  console.log('a layer of answers (draw="answers") over a host\'s own ink');
  await page.evaluate(() => { document.getElementById('frame').style.display = 'none'; });
  const host = written('56+7=', 200, 200, 70), other = written('9+5=', 700, 420, 60);
  ok(!!host && !!other, 'composed "56 + 7 =" and "9 + 5 =" that read as written');
  if (host && other) {
    const cam0 = await page.evaluate(() => Object.assign({}, ans.pad.cam));
    ok(near(cam0.x, 0) && near(cam0.y, 0) && near(cam0.z, 1), 'its world is its own CSS px (the host\'s coordinates over the same rect)');
    await page.evaluate(h => { window.H = h; window.NH = h.length; drawHost(h); }, host);
    const c1 = await page.evaluate(() => ans.pad.syncStrokes(H));
    await settled('ans'); await wait(200);
    const L = await page.evaluate(() => ({ n: ans.pad.strokes.length, answers: ans.answers.map(a => a.latex), chips: ans.pad.plan.chips.length }));
    ok(c1 === true && L.n === host.length && L.answers.join() === '63' && L.chips === 1, `syncStrokes gives it the host's strokes: read and worked out (${L.answers.join()}), waiting for a tap`);
    // only the answer is drawn, out of focus where it goes
    const px = () => page.evaluate(() => {
      const P = ans.pad, c = P.canvas, k = c.width / c.getBoundingClientRect().width, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let ink = 0, gold = 0, any = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 30) continue; any++; if (d[i + 2] > d[i] + 25) ink++; if (d[i] - d[i + 2] > 40) gold++; }
      const A = P.plan ? P.plan.items.filter(i => i.answer) : [], b = A.length ? A.map(i => i.box || i.group).reduce((u, q) => [Math.min(u[0], q[0]), Math.min(u[1], q[1]), Math.max(u[2], q[2]), Math.max(u[3], q[3])]) : [0, 0, 1, 1];
      const x0 = Math.floor(b[0] * k), y0 = Math.floor(b[1] * k), w = Math.ceil((b[2] - b[0]) * k), h = Math.ceil((b[3] - b[1]) * k), e = c.getContext('2d').getImageData(x0, y0, w, h).data;
      let step = 0;
      for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) { const i = (y * w + x) * 4; step = Math.max(step, Math.abs(e[i + 3] - e[i - 1])); }
      return { ink, gold, any, step };
    });
    const p0 = await px();
    ok(p0.ink === 0 && p0.gold > 150 && p0.step <= 40, `the layer draws no ink of its own, only the answer, out of focus (${p0.gold} gold pixels, the sharpest step in its alpha ${p0.step})`);
    await page.screenshot({ path: path.join(out, 'embed-layer-hidden.png') });
    // the same arrays again: nothing changes, nothing is read again
    const same = await page.evaluate(() => { const before = ans.pad.strokes.slice(), r = ans.pad.syncStrokes(H); return { r, kept: ans.pad.strokes.every((s, i) => s === before[i]) }; });
    ok(same.r === false && same.kept, 'the same arrays given again: no change, the same strokes kept');
    // a tap on the host (the page asks answerAt where the pen came down), then showAnswer
    const hit = await page.evaluate(() => { const c = ans.pad.plan.chips[0], r = ans.pad.canvas.getBoundingClientRect(); return ans.pad.answerAt(r.left + c.cx, r.top + c.cy); });
    ok(hit && hit.hidden && hit.key, 'answerAt finds it from the host\'s pointer');
    await page.evaluate(k => ans.pad.showAnswer(k), hit.key);
    await wait(450);
    const p1 = await px();
    ok(await page.evaluate(() => ans.pad.plan.chips.length === 0) && p1.step >= 120 && p1.ink === 0, `showAnswer: it comes into focus (the sharpest step ${p1.step})`);
    await page.screenshot({ path: path.join(out, 'embed-layer-shown.png') });
    // more ink elsewhere (a new array): the shown answer stays shown, and the new line is read too
    await page.evaluate(o => { window.O = o; H.push(...o); drawHost(H); ans.pad.syncStrokes(H); }, other);
    await settled('ans'); await wait(200);
    const L2 = await page.evaluate(() => ({ answers: ans.answers.map(a => a.latex).sort(), chips: ans.pad.plan.chips.length, shown: ans.pad.plan.items.filter(i => i.answer && !i.hidden).length }));
    ok(L2.answers.join() === '14,63' && L2.chips === 1 && L2.shown >= 1, `more ink: its line read too (${L2.answers.join()}), the shown answer still shown, the new one waiting (${JSON.stringify(L2)})`);
    // the "=" of the first line taken away (erased in the host) and given back (undone): the answer comes back shown
    const eq = await page.evaluate(() => {
      const P = ans.pad, res = P.result, sy = res.symbols.filter(s => s.label === '=').map(s => s.strokes.map(i => P.resultStrokes[i]));
      const mine = sy.find(ss => ss[0][0][0] < 600);
      const idx = mine.map(st => P.strokes.indexOf(st));
      window.EQ = idx.map(i => H[i]);
      ans.pad.syncStrokes(H.filter(h => !EQ.includes(h)));
      return idx.length;
    });
    await settled('ans'); await wait(200);
    const gone = await page.evaluate(() => ans.answers.map(a => a.latex));
    await page.evaluate(() => ans.pad.syncStrokes(H));
    await settled('ans'); await wait(300);
    const back = await page.evaluate(() => ({ answers: ans.answers.map(a => a.latex).sort(), shown: ans.pad.plan.items.filter(i => i.answer && !i.hidden).map(i => i.revealKey.split('|')[1]) }));
    ok(eq >= 1 && gone.join() === '14' && back.answers.join() === '14,63' && back.shown.includes('63'), `its "=" taken away: that answer goes (${gone.join()}); given back as the same arrays: it is back, still shown (${JSON.stringify(back)})`);
    // the host drags the first line somewhere else (a lasso: new arrays) and says which were which: it is read where it
    // is now, and its answer, shown, stays shown
    const before = await page.evaluate(() => {
      const P = ans.pad, it = P.plan.items.find(i => i.answer && /\|63$/.test(i.revealKey)), pairs = [];
      const H2 = H.map((h, i) => { if (i >= NH) return h; const nu = h.map(p => [p[0] + 40, p[1] + 30]); pairs.push([nu, h]); return nu; });
      const n0 = P.strokes.slice(0, NH);
      window.HOLD = H; window.H = H2; drawHost(H2); window.R0 = P.result;
      const r = P.syncStrokes(H2, pairs);
      return { box: it.box.slice(), r, same: P.strokes.slice(0, NH).every((s, i) => s === n0[i]) };
    });
    // the same strokes, so the reading is done when a new one comes
    await page.waitForFunction(() => ans.pad.result && ans.pad.result !== R0 && !ans.pad.anim, { timeout: 30000 }).catch(() => {});
    await settled('ans'); await wait(300);
    const after = await page.evaluate(() => {
      const P = ans.pad, it = P.plan.items.find(i => i.answer && /\|63$/.test(i.revealKey));
      return { answers: ans.answers.map(a => a.latex).sort(), box: it && it.box.slice(), hidden: it ? it.hidden : null, again: P.syncStrokes(H) };
    });
    const dx = after.box ? (after.box[0] - before.box[0]) : 0, dy = after.box ? (after.box[1] - before.box[1]) : 0;
    ok(before.r && before.same && after.answers.join() === '14,63' && after.hidden === false && Math.abs(dx - 40) < 12 && Math.abs(dy - 30) < 12 && after.again === false,
      `a line moved by the host (new arrays, paired with the old): the same strokes, read where they are, its answer moved with it (${dx.toFixed(0)}, ${dy.toFixed(0)}) and still shown`);
    // the host takes the move back (its Undo gives the arrays it had before): the line is where it was, still shown
    const undone = await page.evaluate(() => {
      const P = ans.pad;
      window.R1 = P.result; window.H = HOLD; drawHost(HOLD);
      return { r: P.syncStrokes(HOLD) };
    });
    await page.waitForFunction(() => ans.pad.result && ans.pad.result !== R1 && !ans.pad.anim, { timeout: 30000 }).catch(() => {});
    await settled('ans'); await wait(300);
    const back2 = await page.evaluate(() => { const P = ans.pad, it = P.plan.items.find(i => i.answer && /\|63$/.test(i.revealKey)); return { box: it && it.box.slice(), hidden: it ? it.hidden : null, first: P.strokes[0][0].slice(0, 2) }; });
    ok(undone.r && back2.box && Math.abs(back2.box[0] - before.box[0]) < 12 && Math.abs(back2.box[1] - before.box[1]) < 12 && back2.hidden === false,
      `the host's Undo of the move (the old arrays again): back where it was, its answer with it, still shown (${JSON.stringify(back2)})`);
    // it takes no input of its own
    const n1 = await page.evaluate(() => { const n = ans.pad.strokes.length; ptr(ans, 'down', 'pen', 31, 100, 600); for (let i = 1; i < 8; i++) ptr(ans, 'move', 'pen', 31, 100 + 20 * i, 600); ptr(ans, 'up', 'pen', 31, 260, 600); return ans.pad.strokes.length - n; });
    ok(n1 === 0, 'pointer events on the layer write nothing (the host writes)');
    // emptied: no answers
    await page.evaluate(() => ans.pad.syncStrokes([]));
    await wait(400);
    const p2 = await px();
    ok(await page.evaluate(() => ans.pad.strokes.length === 0 && ans.answers.length === 0) && p2.any === 0, 'syncStrokes([]): nothing to read, nothing drawn');
  }

  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
