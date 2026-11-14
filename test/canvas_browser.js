// The canvas in a <nib-pad infinite>: pan and zoom (wheel, ctrl+wheel, the hand tool, space, two fingers, fingers that
// pan), pens, markers and highlighters (color, size, pressure), what Nib reads (pen and marker only), select (lasso,
// box, tap, move, resize, delete, duplicate, copy and paste, restyle, order, nudge), text, pictures, the area eraser,
// the laser, draw-and-hold shapes, the shape tool, paper, export (PNG pictures), state (looks, pressure, camera) and a
// crowded canvas.
//   node test/canvas_browser.js
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core'));
const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const byId = id => rows.find(r => r.id === id);
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const near = (a, b, e = 0.5) => Math.abs(a - b) <= e;

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('file://' + path.join(__dirname, 'canvas_page.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => window.c && c.pad);
  const reset = () => page.evaluate(() => { const P = c.pad; c.clear(); P.history = []; P.future = []; P.setCamera({ x: 0, y: 0, z: 1 }); P.setMode('draw'); P.tool = { kind: 'pen', color: null, size: null }; P.penUntil = 0; P.penSeen = -1e9; P.setOptions({ fingers: 'write', pinch: true, eraser: 'stroke', read: true, hold: true }); });
  // a real handwritten expression from the composed school set, written at world rect [x, y, w, h] (scaled to fit)
  const putRow = (id, rect, kind = 'mouse', pid = 1) => page.evaluate((r, rect, kind, pid) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const k = Math.min(rect[2] / (x1 - x0), rect[3] / (y1 - y0)), P = c.pad, z = P.cam.z;
    for (const s of r.strokes) {
      const pts = s.map(p => [((rect[0] + (p[0] - x0) * k) - P.cam.x) * z, ((rect[1] + (p[1] - y0) * k) - P.cam.y) * z]);
      ptr('down', kind, pid, pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ptr('move', kind, pid, pts[i][0], pts[i][1]);
      ptr('up', kind, pid, pts[pts.length - 1][0], pts[pts.length - 1][1]);
    }
  }, byId(id), rect, kind, pid);
  const read = () => page.evaluate(() => { c.pad.recognize(); return c.latex; });

  console.log('pan and zoom');
  await reset();
  await page.evaluate(() => wheel(400, 300, 0, 120));
  let cam = await page.evaluate(() => c.camera);
  ok(near(cam.y, 120) && near(cam.x, 0) && cam.z === 1, `the wheel scrolls the board down: ${JSON.stringify(cam)}`);
  await page.evaluate(() => wheel(400, 300, 0, 120, { shiftKey: true }));
  cam = await page.evaluate(() => c.camera);
  ok(near(cam.x, 120) && near(cam.y, 120), `shift + wheel scrolls sideways: ${JSON.stringify(cam)}`);
  const under = await page.evaluate(() => { const P = c.pad, w0 = P.toWorld(400, 300); wheel(400, 300, 0, -200, { ctrlKey: true }); const w1 = P.toWorld(400, 300); return { w0, w1, z: P.cam.z }; });
  ok(under.z > 1.5 && near(under.w0[0], under.w1[0], 1e-6) && near(under.w0[1], under.w1[1], 1e-6), `ctrl + wheel (a trackpad pinch) zooms in about the pointer: z ${under.z.toFixed(2)}, the point under it stays (${under.w1.map(v => v.toFixed(1))})`);
  const lim = await page.evaluate(() => { for (let i = 0; i < 60; i++) wheel(400, 300, 0, -500, { ctrlKey: true }); const hi = c.pad.cam.z; for (let i = 0; i < 80; i++) wheel(400, 300, 0, 500, { ctrlKey: true }); return [hi, c.pad.cam.z]; });
  ok(lim[0] === 8 && lim[1] === 0.1, `zoom stays between 10% and 800%: ${lim}`);
  await reset();
  const drawn = await page.evaluate(() => { c.pad.setCamera({ x: 100, y: 50, z: 2 }); line('mouse', 1, [[100, 100], [300, 100]]); return c.pad.strokes[0].map(p => [p[0], p[1]]); });
  ok(near(drawn[0][0], 150) && near(drawn[0][1], 100) && near(drawn[drawn.length - 1][0], 250), `ink is kept where it is on the board, whatever the zoom: ${drawn[0].map(v => v.toFixed(1))} … ${drawn[drawn.length - 1].map(v => v.toFixed(1))}`);
  const fit = await page.evaluate(() => { c.pad.setCamera({ x: 5000, y: 5000, z: 3 }); c.fitContent(); const P = c.pad, v = P.viewRect, b = P.contentRect(0); return { inside: b[0] >= v[0] && b[2] <= v[2] && b[1] >= v[1] && b[3] <= v[3], z: P.cam.z }; });
  ok(fit.inside && fit.z <= 1, `fit content brings it all into view (z ${fit.z.toFixed(2)})`);
  const camEv = await page.evaluate(() => new Promise(res => { c.addEventListener('nib:camera', e => res(e.detail), { once: true }); c.pad.panBy(10, 0); setTimeout(() => res(null), 400); }));
  ok(camEv && typeof camEv.z === 'number', 'nib:camera tells the page where the board is');

  console.log('the hand tool, space, the middle button');
  await reset();
  const hand = await page.evaluate(() => {
    const P = c.pad; P.setMode('pan');
    line('mouse', 1, [[500, 400], [400, 300]]);
    const a = Object.assign({}, P.cam), n1 = P.strokes.length;
    P.setMode('draw'); P.spacePan = true;
    line('mouse', 1, [[400, 300], [500, 300]]);
    const b = Object.assign({}, P.cam), n2 = P.strokes.length; P.spacePan = false;
    ptr('down', 'mouse', 1, 300, 300, { button: 1, buttons: 4 }); ptr('move', 'mouse', 1, 300, 350, { buttons: 4 }); ptr('up', 'mouse', 1, 300, 350, { button: 1, buttons: 0 });
    return { a, b, c: Object.assign({}, P.cam), n1, n2, n3: P.strokes.length };
  });
  ok(near(hand.a.x, 100) && near(hand.a.y, 100) && hand.n1 === 0, `the hand tool drags the board (no ink): ${JSON.stringify(hand.a)}`);
  ok(near(hand.b.x, 0) && hand.n2 === 0, 'space + drag pans too');
  ok(near(hand.c.y, 50) && hand.n3 === 0, 'and the middle mouse button');

  console.log('two fingers');
  await reset();
  const pinch = await page.evaluate(() => {
    const P = c.pad;
    ptr('down', 'touch', 21, 600, 400); ptr('move', 'touch', 21, 602, 401);
    ptr('down', 'touch', 22, 700, 400);
    for (let i = 1; i <= 10; i++) { ptr('move', 'touch', 21, 600 - 10 * i, 400); ptr('move', 'touch', 22, 700 + 10 * i, 400); }
    ptr('up', 'touch', 21, 500, 400); ptr('move', 'touch', 22, 760, 400); ptr('up', 'touch', 22, 760, 400);
    return { z: P.cam.z, n: P.strokes.length, why: P.why };
  });
  ok(near(pinch.z, 300 / Math.hypot(98, 1), 0.02) && pinch.n === 0, `two fingers put down together and spread apart zoom (z ${pinch.z.toFixed(2)}); the first finger's stroke is taken back (${pinch.n} strokes)`);
  await reset();
  const two = await page.evaluate(() => {
    const P = c.pad;
    ptr('down', 'touch', 31, 100, 300); ptr('move', 'touch', 31, 105, 305);
    ptr('down', 'touch', 32, 1100, 300);
    for (let i = 1; i <= 8; i++) { ptr('move', 'touch', 31, 100 + 10 * i, 300 + 5 * i); ptr('move', 'touch', 32, 1100 - 10 * i, 300 + 5 * i); }
    ptr('up', 'touch', 31, 180, 340); ptr('up', 'touch', 32, 1020, 340);
    return { z: P.cam.z, n: P.strokes.length };
  });
  ok(two.z === 1 && two.n === 2, `two students far apart at the panel: two strokes, no zoom (${two.n})`);
  await reset();
  const noPinch = await page.evaluate(() => {
    const P = c.pad; P.setOptions({ pinch: false });
    ptr('down', 'touch', 41, 600, 400); ptr('down', 'touch', 42, 650, 400);
    for (let i = 1; i <= 8; i++) { ptr('move', 'touch', 41, 600 - 8 * i, 400); ptr('move', 'touch', 42, 650 + 8 * i, 400); }
    ptr('up', 'touch', 41, 536, 400); ptr('up', 'touch', 42, 714, 400);
    return { z: P.cam.z, n: P.strokes.length };
  });
  ok(noPinch.z === 1 && noPinch.n === 2, 'with two-finger zoom off, two fingers close together write');
  await reset();
  const fpan = await page.evaluate(() => {
    const P = c.pad; P.setOptions({ fingers: 'pan' });
    line('touch', 51, [[400, 400], [300, 350]]);
    const a = Object.assign({}, P.cam), n = P.strokes.length;
    P.penUntil = 0;
    line('pen', 52, [[200, 200], [300, 220]]);
    return { a, n, n2: P.strokes.length };
  });
  ok(near(fpan.a.x, 100) && near(fpan.a.y, 50) && fpan.n === 0 && fpan.n2 === 1, `fingers set to move the board: a finger pans (${JSON.stringify(fpan.a)}), the pen writes`);

  console.log('pens, markers, highlighters');
  await reset();
  const looks = await page.evaluate(() => {
    const P = c.pad;
    P.tool = { kind: 'pen', color: '@red', size: 4 }; line('pen', 1, [[100, 100], [300, 120]], { pressure: (k, i) => 0.2 + 0.08 * i });
    P.penUntil = 0;
    P.tool = { kind: 'marker', color: '@blue', size: 12 }; line('mouse', 1, [[100, 200], [300, 220]]);
    P.tool = { kind: 'highlighter', color: '@hl-yellow', size: 24 }; line('mouse', 1, [[100, 300], [300, 300]]);
    const S = P.strokes;
    return { looks: S.map(s => P.lookOf(s)), press: S[0].map(q => q[3]), ink: P.ink.length, pxRed: px(200, 110), pxHl: px(200, 300) };
  });
  ok(looks.looks[0].color === '@red' && looks.looks[0].size === 4 && !looks.looks[0].tool, `a red pen of size 4: ${JSON.stringify(looks.looks[0])}`);
  ok(looks.press.every(p => typeof p === 'number') && looks.press[looks.press.length - 2] > looks.press[1], `the pen's pressure is kept with each point (${looks.press.slice(0, 4).join(', ')} …)`);
  ok(looks.looks[1].tool === 'marker' && looks.looks[2].tool === 'highlighter', 'a marker and a highlighter');
  ok(looks.ink === 2, `Nib reads the pen and the marker, not the highlighter (${looks.ink} of 3)`);
  ok(looks.pxRed[0] > 150 && looks.pxRed[1] < 110, `the red pen draws red: ${looks.pxRed}`);
  ok(looks.pxHl[0] > 200 && looks.pxHl[1] > 180 && looks.pxHl[2] < 150, `the highlighter is yellow and see-through: ${looks.pxHl}`);
  const thick = await page.evaluate(() => { const P = c.pad; let n = 0; for (let y = 180; y <= 240; y++) { const p = px(200, y); if (p[2] > 120 && p[0] < 120) n++; } return n; });
  ok(thick >= 10 && thick <= 14, `the marker's line is about 12 px wide (${thick})`);
  // 1.6.4 (Croix at the Promethean board: "The default pen or marker worked well. The highlighter broke. It made a dot
  // and didn't track."): written at a hand's pace, a frame between the moves, every tool's stroke is drawn as it goes
  // and all of it stays when the pen lifts. The highlighter is drawn whole on every frame, and each stroke's drawing was
  // kept from the first frame it was drawn in — a dot — however far the stroke went on.
  await reset();
  const paced = await page.evaluate(async () => {
    const P = c.pad, out = {};
    const inked = (x, y) => { const p = px(x, y); return p[3] > 0 && (p[0] < 240 || p[1] < 240 || p[2] < 240); };
    // (and the highlighter with a finger: the Promethean's touch frame reports touches)
    for (const [kind, y, by] of [['pen', 120, 'pen'], ['marker', 220, 'pen'], ['highlighter', 320, 'pen'], ['highlighter', 420, 'touch']]) {
      P.penUntil = 0;
      P.tool = Object.assign({ kind }, kind === 'highlighter' ? { color: '@hl-yellow', size: 24 } : {});
      const live = [];
      await lineSlow(by, 60, [[100, y], [700, y]], {}, 30, m => { if (m === 15) live.push(inked(150, y), inked(380, y)); if (m === 29) live.push(inked(670, y)); });
      out[kind + (by === 'pen' ? '' : ' by finger')] = { live, after: [inked(110, y), inked(400, y), inked(690, y)], n: P.strokes[P.strokes.length - 1].length, of: P.strokes.length };
    }
    return out;
  });
  for (const kind of ['pen', 'marker', 'highlighter', 'highlighter by finger']) {
    const r = paced[kind];
    ok(r.live.every(Boolean), `${kind}, at a hand's pace: drawn as it goes (start, middle so far, near the pen: ${r.live})`);
    ok(r.after.every(Boolean), `${kind}: all of it is there when the pen lifts (${r.after}; ${r.n} points)`);
  }
  ok(paced['highlighter by finger'].of === 4, 'the four strokes are four strokes (' + paced['highlighter by finger'].of + ')');
  // a pen stroke that the board redraws while it is being written (an answer coming into focus, another pen, a pause
  // that tried a shape): all of it is there when the pen lifts
  await reset();
  const redrawn = await page.evaluate(async () => {
    const P = c.pad;
    const inked = (x, y) => { const p = px(x, y); return p[3] > 0 && (p[0] < 240 || p[1] < 240 || p[2] < 240); };
    P.penUntil = 0; P.tool = { kind: 'pen' };
    await lineSlow('pen', 61, [[100, 420], [700, 420]], {}, 30, m => { if (m === 10) P.redraw(); });
    P.redraw();
    return [inked(110, 420), inked(400, 420), inked(690, 420)];
  });
  ok(redrawn.every(Boolean), `a pen stroke redrawn while it is written is all there after (${redrawn})`);
  // a pen line held still long enough to become a line, then on (1.6.1's "my pen kept skipping"): the points were kept
  // since 1.6.1, but the drawing stopped at the pause until 1.6.4
  await reset();
  const paused = await page.evaluate(async () => {
    const P = c.pad;
    const inked = (x, y) => { const p = px(x, y); return p[3] > 0 && (p[0] < 240 || p[1] < 240 || p[2] < 240); };
    const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    P.penUntil = 0; P.tool = { kind: 'pen' };
    ptr('down', 'pen', 62, 100, 300);
    for (let x = 110; x <= 400; x += 10) { ptr('move', 'pen', 62, x, 300); await frame(); }
    await new Promise(r => setTimeout(r, 900));
    const held = [...P.ptrs.values()].some(q => q.snap);
    for (let x = 410; x <= 700; x += 10) { ptr('move', 'pen', 62, x, 300 + (x - 400) * 0.3); await frame(); }
    ptr('up', 'pen', 62, 700, 390); await frame();
    return { held, n: P.strokes.length, after: [inked(150, 300), inked(390, 300), inked(550, 345), inked(690, 387)] };
  });
  ok(paused.held && paused.n === 1 && paused.after.every(Boolean), `a pen line held still (it became a line) and then carried on: one stroke, all of it drawn (${JSON.stringify(paused)})`);
  // two at once: a highlighter and a pen (two students), each drawn whole
  await reset();
  const both = await page.evaluate(async () => {
    const P = c.pad;
    const inked = (x, y) => { const p = px(x, y); return p[3] > 0 && (p[0] < 240 || p[1] < 240 || p[2] < 240); };
    P.penUntil = 0; P.tool = { kind: 'highlighter', color: '@hl-yellow', size: 24 };
    const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    ptr('down', 'mouse', 70, 100, 150); ptr('down', 'touch', 71, 100, 450);
    for (let i = 1; i <= 30; i++) { ptr('move', 'mouse', 70, 100 + 20 * i, 150); ptr('move', 'touch', 71, 100 + 20 * i, 450); await frame(); }
    ptr('up', 'mouse', 70, 700, 150); ptr('up', 'touch', 71, 700, 450);
    await frame(); P.redraw();
    return { a: [inked(110, 150), inked(690, 150)], b: [inked(110, 450), inked(690, 450)], n: P.strokes.length };
  });
  ok(both.n === 2 && both.a.every(Boolean) && both.b.every(Boolean), `two at once, each drawn whole (${JSON.stringify(both)})`);

  console.log('what Nib reads');
  await reset();
  await putRow('arith_001', [100, 100, 400, 120]);
  const t1 = await read();
  await page.evaluate(() => {
    const P = c.pad;
    P.tool = { kind: 'highlighter', color: '@hl-green', size: 30 }; line('mouse', 1, [[90, 160], [520, 160]]);
    P.addElement([[80, 80], [540, 240]], { tool: 'shape', shape: 'rect', size: 3 });
    P.addElement([[100, 260], [300, 300]], { tool: 'text', text: '7 + 4 =', size: 32 });
  });
  const t2 = await read();
  ok(t1 && t2 === t1, `a highlighter over the writing, a box round it and a text below change nothing in what is read: ${t1} → ${t2}`);
  const off = await page.evaluate(() => { c.setAttribute('read', 'false'); c.pad.recognize(); const r = { latex: c.latex, ink: c.pad.ink.length }; c.removeAttribute('read'); return r; });
  ok(off.latex === '' && off.ink === 0, 'read="false": a plain whiteboard (nothing read)');

  console.log('select');
  await reset();
  await page.evaluate(() => { line('mouse', 1, [[100, 100], [200, 100]]); line('mouse', 1, [[100, 140], [200, 160]]); line('mouse', 1, [[600, 100], [700, 120]]); });
  const sel = await page.evaluate(() => {
    const P = c.pad; P.setMode('select');
    let ev = null; c.addEventListener('nib:select', e => { ev = e.detail; });
    line('pen', 7, [[80, 80], [240, 80], [240, 190], [80, 190], [80, 80]]);
    const n = P.selected.length;
    // drag the selection 100 to the right, 50 down
    line('pen', 7, [[150, 130], [250, 180]]);
    const moved = P.strokes[0][0].slice(0, 2);
    P.undo();
    const back = P.strokes[0][0].slice(0, 2);
    return { n, ev, moved, back };
  });
  ok(sel.n === 2 && sel.ev && sel.ev.count === 2, `a lasso round two strokes selects them (${sel.n}; nib:select ${JSON.stringify(sel.ev && sel.ev.count)})`);
  ok(near(sel.moved[0], 200) && near(sel.moved[1], 150), `dragging moves them: ${sel.moved.map(v => v.toFixed(1))}`);
  ok(near(sel.back[0], 100) && near(sel.back[1], 100), 'undo puts them back');
  const sel2 = await page.evaluate(() => {
    const P = c.pad;
    P.select(P.strokes.slice(0, 2));
    const b = P._selBox(P.selected), h = P.toScreen([b[2], b[3]]);
    line('mouse', 1, [[h[0], h[1]], [h[0] + 106, h[1] + 66]]);      // the corner handle
    // the ink itself (the box round it adds a margin of its own)
    const ext = () => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of P.selected) for (const q of s) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return [x1 - x0, y1 - y0]; };
    const big = ext(); P.undo(); const was = ext(); P.redo();
    P.undo();
    const dup = P.duplicateSelection().length, n1 = P.strokes.length;
    P.undo();
    P.select([P.strokes[2]]);
    const del = P.deleteSelection(), n2 = P.strokes.length;
    P.undo();
    P.select([P.strokes[0]]); P.restyleSelection({ color: '@green', size: 7 });
    const look = P.lookOf(P.strokes[0]);
    P.orderSelection(true);
    const last = P.strokes[P.strokes.length - 1] === P.selected[0];
    const clip = P.copySelection(); P.clearSelection(); P.paste(clip, [1000, 1000]);
    const pasted = P.selected.length && P.selected[0] !== clip.items[0];
    const at = P.selected.length ? P._bounds(P.selected[0]) : null;
    P.nudgeSelection(10, 0);
    const nudged = P.selected.length ? P._bounds(P.selected[0])[0] - at[0] : 0;
    return { big, was, dup, n1, del, n2, look, last, pasted, at, nudged, n: P.strokes.length };
  });
  ok(sel2.big[0] > sel2.was[0] * 1.5 && Math.abs(sel2.big[0] / sel2.big[1] - sel2.was[0] / sel2.was[1]) < 0.05, `a corner handle makes it bigger, keeping its shape (${sel2.was.map(Math.round)} → ${sel2.big.map(Math.round)})`);
  ok(sel2.dup === 2 && sel2.n1 === 5, 'duplicate copies the selection');
  ok(sel2.del === 1 && sel2.n2 === 2, 'delete takes it away (undo brings it back)');
  ok(sel2.look.color === '@green' && sel2.look.size === 7, 'a new color and size for what is selected');
  ok(sel2.last, 'bring to front');
  ok(sel2.pasted && near((sel2.at[0] + sel2.at[2]) / 2, 1000, 2) && near((sel2.at[1] + sel2.at[3]) / 2, 1000, 2), 'paste puts a copy where it is asked to');
  ok(near(sel2.nudged, 10), 'the arrow keys nudge it');
  const boxSel = await page.evaluate(() => {
    const P = c.pad; P.clearSelection();
    line('mouse', 1, [[50, 50], [260, 210]]);                   // a mouse drags a box
    const n = P.selected.length;
    line('mouse', 1, [[150, 100], [150, 100]]);                  // a tap on a stroke
    const tap = P.selected.length;
    line('mouse', 1, [[900, 600], [900, 600]]);                  // a tap on nothing
    return { n, tap, none: P.selected.length };
  });
  ok(boxSel.n === 2 && boxSel.tap === 1 && boxSel.none === 0, `a mouse box selects (${boxSel.n}); a tap selects what is under it (${boxSel.tap}); a tap on nothing selects nothing`);

  console.log('text');
  await reset();
  const txt = await page.evaluate(async () => {
    const P = c.pad; P.setMode('text'); P.textTool = { color: '@purple', size: 40 };
    line('mouse', 1, [[300, 300], [300, 300]]);
    const ta = c.querySelector('textarea');
    if (!ta) return { ta: false };
    ta.value = 'Area = l × w'; ta.dispatchEvent(new Event('input'));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    const n = P.strokes.length, E = P.lookOf(P.strokes[0]), box = P._bounds(P.strokes[0]);
    // tap it again: write in it, empty it: it goes
    line('mouse', 1, [[310, 300], [310, 300]]);
    const ta2 = c.querySelector('textarea'), same = ta2 && ta2.value === 'Area = l × w';
    ta2.value = ''; ta2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const gone = P.strokes.length;
    P.undo();
    return { ta: true, n, E, box, same, gone, back: P.strokes.length };
  });
  ok(txt.ta && txt.n === 1 && txt.E.tool === 'text' && txt.E.text === 'Area = l × w' && txt.E.color === '@purple' && txt.E.size === 40, `a tap with the text tool writes a text box: ${JSON.stringify(txt.E)}`);
  ok(txt.box && txt.box[2] - txt.box[0] > 150 && near(txt.box[3] - txt.box[1], 50, 2), `its box fits its text (${txt.box && txt.box.map(Math.round)})`);
  ok(txt.same && txt.gone === 0 && txt.back === 1, 'tapping it opens it again; emptied, it goes; undo brings it back');
  const txtScale = await page.evaluate(() => {
    const P = c.pad; P.setMode('select'); P.select([P.strokes[0]]);
    const b = P._selBox(P.selected), h = P.toScreen([b[2], b[3]]);
    line('mouse', 1, [[h[0], h[1]], [h[0] + 120, h[1] + 30]]);
    return P.lookOf(P.strokes[0]).size;
  });
  ok(txtScale > 45, `a text made bigger by its corner gets a bigger size (${txtScale})`);

  console.log('pictures');
  await reset();
  const pic = await page.evaluate(async () => {
    const P = c.pad; let ev = null; c.addEventListener('nib:image', e => { ev = e.detail; }, { once: true });
    const s = await c.addImage(picture(400, 200));
    await new Promise(r => setTimeout(r, 50));
    const b = P._bounds(s), mid = P.toScreen([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
    const st = P.getState();
    return { ok: !!s, w: b[2] - b[0], h: b[3] - b[1], color: px(mid[0], mid[1]), id: ev && ev.id, meta: st.meta && st.meta[0], sel: P.selected.length };
  });
  ok(pic.ok && near(pic.w, 400) && near(pic.h, 200) && pic.sel === 1, `a picture goes in the middle of the view, at its size, selected (${pic.w}×${pic.h})`);
  ok(pic.color[0] > 200 && pic.color[2] < 80, `and is drawn: ${pic.color}`);
  ok(pic.id && pic.meta && pic.meta.k === 'image' && pic.meta.im === pic.id, 'nib:image gives the page its id and data to keep; the page state names it');
  const need = await page.evaluate(() => new Promise(res => {
    const P = c.pad, st = P.getState(); P.images.clear(); P._asked = new Set();
    c.addEventListener('nib:needimage', e => res(e.detail.id), { once: true });
    P.setState(st);
    setTimeout(() => res(null), 500);
  }));
  ok(need === pic.id, 'a page put back without its picture asks for it (nib:needimage)');

  console.log('the area eraser');
  await reset();
  const area = await page.evaluate(() => {
    const P = c.pad; line('mouse', 1, [[100, 400], [700, 400]], {}, 40);
    P.setOptions({ eraser: 'area' }); P.setMode('erase');
    line('mouse', 1, [[400, 360], [400, 440]], {}, 8);
    const n = P.strokes.length, ends = P.strokes.map(s => [Math.round(s[0][0]), Math.round(s[s.length - 1][0])]);
    P.undo(); const u = P.strokes.length; P.redo(); const r = P.strokes.length;
    return { n, ends, u, r };
  });
  ok(area.n === 2 && area.ends[0][0] === 100 && area.ends[1][1] === 700, `rubbing across a line cuts it in two (${JSON.stringify(area.ends)})`);
  ok(area.u === 1 && area.r === 2, 'undo makes it whole again; redo cuts it again');

  console.log('the laser');
  await reset();
  const laser = await page.evaluate(async () => {
    const P = c.pad; P.setMode('laser');
    line('mouse', 1, [[100, 500], [500, 520]]);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const red = px(480, 519), n = P.strokes.length, hist = P.history.length;
    await new Promise(r => setTimeout(r, 1000));
    return { red, n, hist, after: px(480, 519), left: P.lasers.length };
  });
  ok(laser.n === 0 && laser.hist === 0, 'the laser keeps nothing');
  ok(laser.red[0] > 200 && laser.red[1] < 150, `it draws a red trail: ${laser.red}`);
  ok(laser.left === 0 && (laser.after[3] === 0 || laser.after[0] < 150), `that fades away within a second: ${laser.after}`);

  console.log('state');
  await reset();
  const st = await page.evaluate(async () => {
    const P = c.pad;
    P.tool = { kind: 'pen', color: '@blue', size: 5 }; line('pen', 1, [[100, 100], [200, 130]], { pressure: 0.8 }); P.penUntil = 0;
    P.addElement([[300, 100], [400, 200]], { tool: 'shape', shape: 'ellipse', size: 4, color: '@red', fill: 'rgba(209,53,43,.2)', dash: true });
    P.addElement([[100, 300], [200, 340]], { tool: 'text', text: 'hello', size: 32 });
    P.setCamera({ x: 40, y: -20, z: 1.5 });
    const s1 = P.getState(), json = JSON.stringify(s1);
    c.clear(); P.setCamera({ x: 0, y: 0, z: 1 });
    P.setState(JSON.parse(json));
    const s2 = P.getState();
    // a page saved before the canvas: strokes only
    P.setState({ strokes: [[[10, 10], [50, 50]]], fixes: [], revealed: [] });
    return { same: JSON.stringify(s2) === json, cam: s2.cam, meta: s1.meta, press: s1.press && s1.press[0] && s1.press[0][1], old: P.strokes.length, oldLook: P.lookOf(P.strokes[0]), oldCam: P.cam };
  });
  ok(st.same, 'getState → setState gives back the same page (looks, pressure and camera included)');
  ok(st.cam && st.cam.x === 40 && st.cam.z === 1.5, `the camera is kept with the page: ${JSON.stringify(st.cam)}`);
  ok(st.meta[0].c === '@blue' && st.meta[1].k === 'shape' && st.meta[1].sh === 'ellipse' && st.meta[1].d === 1 && st.meta[2].x === 'hello' && st.press === 80, `looks kept compactly: ${JSON.stringify(st.meta)}`);
  ok(st.old === 1 && st.oldLook === null && st.oldCam.z === 1, 'a page saved before the canvas still opens (a plain pen stroke, at 100%)');

  console.log('export');
  await reset();
  await putRow('arith_004', [200, 200, 300, 100]);
  const ex = await page.evaluate(() => {
    const P = c.pad; P.recognize();
    P.addElement([[150, 150], [550, 350]], { tool: 'shape', shape: 'rect', size: 3 });
    const b = P.contentRect(40), cv = c.exportImage({ scale: 2 });
    const one = c.exportImage({ scale: 1, rect: [0, 0, 300, 200] });
    const big = c.exportImage({ scale: 4, maxPixels: 1e6 });
    return { w: cv.width, h: cv.height, bw: (b[2] - b[0]) * 2, bh: (b[3] - b[1]) * 2, one: [one.width, one.height], big: big.width * big.height };
  });
  ok(near(ex.w, ex.bw, 2) && near(ex.h, ex.bh, 2), `a picture of everything on the page at 2× (${ex.w}×${ex.h})`);
  ok(ex.one[0] === 300 && ex.one[1] === 200, 'or of a given part of it');
  ok(ex.big <= 1e6 * 1.01, 'never more pixels than asked for');

  console.log('what the review of 1.6 found');
  {
    // a pinch whose second finger's pointerup is lost: the board listens again 1.5 s later (a pen at once)
    await reset();
    await page.evaluate(() => { ptr('down', 'touch', 31, 400, 300); ptr('down', 'touch', 32, 480, 300); for (let i = 1; i <= 6; i++) { ptr('move', 'touch', 31, 400 - 10 * i, 300); ptr('move', 'touch', 32, 480 + 10 * i, 300); } ptr('up', 'touch', 31, 340, 300); });
    const stuck = await page.evaluate(() => !!c.pad.gesture);
    await wait(1600);
    await page.evaluate(() => line('mouse', 33, [[100, 500], [200, 520]]));
    const n1 = await page.evaluate(() => c.pad.strokes.length);
    await page.evaluate(() => { ptr('down', 'touch', 34, 400, 300); ptr('down', 'touch', 35, 480, 300); ptr('move', 'touch', 35, 520, 300); });
    await page.evaluate(() => line('pen', 36, [[100, 600], [200, 620]]));
    const n2 = await page.evaluate(() => c.pad.strokes.length);
    await page.evaluate(() => { ptr('up', 'touch', 34, 400, 300); ptr('up', 'touch', 35, 520, 300); });
    ok(stuck && n1 === 1 && n2 === 2, `a gesture that lost a pointerup ends: a mouse stroke 1.6 s later writes (${n1}), and a pen ends a gesture of fingers at once (${n2})`);
    // a pinch begun with the select, shape or text tool zooms (and leaves nothing behind)
    const pinch = await page.evaluate(() => {
      const out = {};
      for (const m of ['select', 'shape', 'text']) {
        const P = c.pad; P.setCamera({ x: 0, y: 0, z: 1 }); P.setMode(m); P.penSeen = -1e9; P.penUntil = 0; P.touches.clear();
        ptr('down', 'touch', 41, 400, 300); ptr('down', 'touch', 42, 480, 300);
        for (let i = 1; i <= 6; i++) { ptr('move', 'touch', 41, 400 - 10 * i, 300); ptr('move', 'touch', 42, 480 + 10 * i, 300); }
        ptr('up', 'touch', 41, 340, 300); ptr('up', 'touch', 42, 540, 300);
        out[m] = Math.round(P.cam.z * 100) / 100 + ':' + P.strokes.length + (P.editing ? ':editing' : '');
      }
      c.pad.setMode('draw');
      return out;
    });
    ok(Object.values(pinch).every(v => +v.split(':')[0] > 1.5 && v.split(':')[1] === '2' && !v.includes('editing')), 'two fingers zoom with the select, shape and text tools too, and make nothing: ' + JSON.stringify(pinch));
    // writing on a picture: a lasso drag that starts on the picture takes the writing, not the picture
    await reset();
    const lasso = await page.evaluate(async () => {
      const P = c.pad;
      const img = await c.addImage(picture(400, 300), { at: [400, 350] });
      P.clearSelection();
      line('mouse', 51, [[330, 330], [420, 360]]);
      P.setMode('select');
      line('mouse', 52, [[300, 300], [460, 300], [460, 400], [300, 400]]);
      const sel = P.selected.map(s => P.lookOf(s).tool || 'pen');
      const at = img.map(q => q.slice());
      P.clearSelection();
      // the picture is still moved from its edge, or once it is selected
      line('mouse', 53, [[202, 350], [252, 350]]);
      const moved = img[0][0] - at[0][0];
      P.setMode('draw');
      return { sel, moved };
    });
    ok(JSON.stringify(lasso.sel) === '["pen"]' && near(lasso.moved, 50), `a box dragged across a picture selects the writing on it (${lasso.sel}); dragged from its edge, the picture moves (${lasso.moved})`);
    // a highlighter drawn and held becomes a straight highlighter, still see-through and under the writing
    await reset();
    const hl = await page.evaluate(() => new Promise(res => {
      const P = c.pad; P.tool = { kind: 'highlighter', color: '@hl-yellow', size: 24 };
      ptr('down', 'pen', 61, 100, 200);
      for (let i = 1; i <= 20; i++) ptr('move', 'pen', 61, 100 + 15 * i, 200 + (i % 2));
      setTimeout(() => { ptr('up', 'pen', 61, 400, 200); const E = P.lookOf(P.strokes[0]); res({ tool: E.tool, n: P.strokes[0].length }); P.tool = { kind: 'pen', color: null, size: null }; }, 800);
    }));
    ok(hl.tool === 'highlighter' && hl.n === 2, `a highlighter held still becomes a straight one, still a highlighter (${JSON.stringify(hl)})`);
    // an answer key takes in the answers still waiting for a tap
    await reset();
    const key = await page.evaluate(() => { const P = c.pad; return { a: P.contentRect(0), b: P.contentRect(0, { hidden: true }) }; });
    ok(key.a === null && key.b === null, 'an empty page has no content either way');
  }

  console.log('what Croix found on his tablet (8 Nov): the pen skipping, and a lasso');
  {
    // the S Pen resting a moment in the middle of a stroke (a hand thinking) made what was written so far a straight line
    // and dropped the rest of the stroke: now the hand moving on means it was writing, and all of it is kept as ink
    await reset();
    const go = (pts, holdAt, holdMs, end = 0) => page.evaluate((pts, holdAt, holdMs, end) => new Promise(res => {
      const P = c.pad; let i = 0;
      ptr('down', 'pen', 71, pts[0][0], pts[0][1], { pressure: 0.4 });
      const step = () => {
        i++;
        if (i >= pts.length) { setTimeout(() => { ptr('up', 'pen', 71, pts[pts.length - 1][0], pts[pts.length - 1][1]); const s = P.strokes[P.strokes.length - 1], E = P.lookOf(s); res({ n: P.strokes.length, len: s.length, tool: E.tool || 'pen', shape: E.shape || null }); }, end); return; }
        ptr('move', 'pen', 71, pts[i][0], pts[i][1], { pressure: 0.4 });
        if (i === holdAt) {                                // still, but for the hand's tremor (under a pixel)
          let t = 0; const tick = () => { t += 50; ptr('move', 'pen', 71, pts[i][0] + (t % 100 ? 0.4 : -0.4), pts[i][1], { pressure: 0.4 }); if (t < holdMs) setTimeout(tick, 50); else setTimeout(step, 8); };
          setTimeout(tick, 50);
        } else setTimeout(step, 8);
      };
      setTimeout(step, 8);
    }), pts, holdAt, holdMs, end);
    const seg = (x0, y0, x1, y1, n = 20) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
    const ell = seg(100, 100, 100, 260).concat(seg(100, 260, 260, 260).slice(1));
    let r = await go(ell, 20, 800);
    ok(r.n === 1 && r.tool === 'pen' && r.len >= 38, `a pause of 0.8 s in the middle of a stroke, then on: one pen stroke, all of it kept (${JSON.stringify(r)})`);
    await reset();
    r = await go(seg(300, 100, 300, 160), 20, 800, 0);
    ok(r.tool === 'pen', `a short line (60 px) held still at its end stays writing (${JSON.stringify(r)})`);
    await reset();
    await putRow('arith_001', [100, 300, 360, 60]);   // writing on the board: its strokes some 30-60 px
    r = await go(seg(500, 300, 500, 400), 20, 800);
    ok(r.tool === 'pen', `beside writing, a 100 px stroke held still stays writing (a 1, a fraction bar): ${JSON.stringify(r)}`);
    r = await go(seg(100, 500, 700, 500, 30), 30, 800);
    ok(r.tool === 'shape' && r.shape === 'line', `a line well beyond the writing's size, held still at its end, becomes a clean line (${JSON.stringify(r)})`);
    // the lasso tool: a loop drawn round what to select, starting anywhere, with a mouse too
    await reset();
    const las = await page.evaluate(() => {
      const P = c.pad;
      line('mouse', 1, [[100, 100], [100, 200]]); line('mouse', 1, [[160, 100], [160, 200]]); line('mouse', 1, [[400, 100], [400, 200]]);
      P.setMode('lasso');
      const mode = P.mode, cur = P.canvas.style.cursor;
      // a loop round the first two, starting on the first stroke itself (Select would pick that stroke up and move it)
      const loop = [[100, 150], [60, 80], [200, 80], [210, 220], [60, 230], [100, 150]];
      ptr('down', 'mouse', 1, loop[0][0], loop[0][1]);
      for (const q of loop.slice(1)) for (let k = 1; k <= 6; k++) ptr('move', 'mouse', 1, q[0], q[1]);
      ptr('up', 'mouse', 1, 100, 150);
      const picked = P.selected.length, moved = P.strokes[0][0][0];
      // a drag from inside the selection moves it
      ptr('down', 'mouse', 1, 130, 150); for (let k = 1; k <= 5; k++) ptr('move', 'mouse', 1, 130 + 10 * k, 150); ptr('up', 'mouse', 1, 180, 150);
      const after = [P.strokes[0][0][0], P.strokes[1][0][0], P.strokes[2][0][0]];
      // a tap on the third picks it alone
      ptr('down', 'pen', 7, 400, 150); ptr('up', 'pen', 7, 400, 150);
      const tap = P.selected.length === 1 && P.selected[0] === P.strokes[2];
      P.setMode('select'); const back = P.lassoOnly;
      P.setMode('draw');
      return { mode, cur, picked, moved, after, tap, back };
    });
    ok(las.mode === 'select' && las.cur === 'crosshair' && las.picked === 2 && las.moved === 100, `the lasso tool: a loop drawn with the mouse, starting on writing, selects what it goes round (${las.picked}), nothing moved by it`);
    ok(las.after[0] === 150 && las.after[1] === 210 && las.after[2] === 400, `what the lasso took moves from inside it (${las.after})`);
    ok(las.tap && las.back === false, 'a tap picks one thing; Select is Select again after it');
  }

  console.log('a crowded canvas');
  await reset();
  const perf = await page.evaluate(() => {
    const P = c.pad;
    const list = [];
    for (let i = 0; i < 2000; i++) { const x = (i % 50) * 60, y = Math.floor(i / 50) * 60, s = []; for (let k = 0; k < 30; k++) s.push([x + k * 1.5, y + 20 * Math.sin(k / 4), 0, 0.5]); list.push(s); }
    for (const s of list) { P.info.set(s, { type: 'pen', width: null, size: 3, color: '@blue' }); P.strokes.push(s); }
    P.setCamera({ x: 0, y: 0, z: 0.4 });
    let t = performance.now(); for (let i = 0; i < 10; i++) P.redraw(); const all = (performance.now() - t) / 10;
    P.setCamera({ x: 0, y: 0, z: 1.5 });
    t = performance.now(); for (let i = 0; i < 10; i++) { P.cam.x += 3; P.redraw(); } const part = (performance.now() - t) / 10;
    return { all, part };
  });
  ok(perf.all < 40, `2,000 strokes all in view redraw in ${perf.all.toFixed(1)} ms`);
  ok(perf.part < 12, `zoomed in, a pan frame takes ${perf.part.toFixed(1)} ms (what is out of view is skipped)`);

  await page.screenshot({ path: path.join(out, 'canvas-test.png') });
  await browser.close();
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
