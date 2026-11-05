// Fringe cases for the pad's views in a real browser: views switched while they animate, writing and erasing during
// an animation, undo/redo storms, corrections in a view and on a board, theme changes, motion off and reduced
// motion, dots, tiny and huge writing, ink off the edge, a scribble, clearing during a read, the element moved or
// removed and put back, odd attribute values, a hand that is not there, fonts that cannot load, a sharp (2x) screen.
//   node test/fringe_browser.js
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core'));
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const byId = id => rows.find(r => r.id === id);
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const PAGE = 'file://' + path.join(__dirname, 'views_page.html');

// a row's strokes scaled into a region (shares of the pad) of a w x h pad, in CSS px with times
function place(r, w, h, region) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const k = Math.min(w * region[2] / Math.max(x1 - x0, 1e-9), h * region[3] / Math.max(y1 - y0, 1e-9));
  let t = 0;
  return r.strokes.map(s => s.map(p => [w * region[0] + (p[0] - x0) * k, h * region[1] + (p[1] - y0) * k, (t += 8)]));
}
// in-page helpers
const HELPERS = () => {
  window.settled = id => {
    const p = document.getElementById(id).pad;
    return !!(p && p.result && !p.anim && p.resultStrokes.length === p.strokes.length && p.resultStrokes.every((s, i) => s === p.strokes[i]));
  };
  // everything shown is backed by ink still on the pad, and every coordinate is a number
  window.sane = id => {
    const p = document.getElementById(id).pad;
    if (!p.plan) return true;
    const live = new Set(p.strokes), fin = Number.isFinite;
    return p.plan.items.every(it => (it.answer ? it.eqFrom.length && it.eqFrom.every(s => live.has(s)) : it.from.length && it.from.every(s => live.has(s))) && it.box.every(fin) &&
      it.parts.every(q => (q.paths || []).every(s => s.every(pt => fin(pt[0]) && fin(pt[1]))) &&
        (q.t !== 'text' || (fin(q.x) && fin(q.y) && q.size > 0)) && (q.t !== 'rule' || (fin(q.x) && fin(q.y) && fin(q.w) && fin(q.h)))));
  };
  window.inked = (id, test) => {
    const c = document.getElementById(id).querySelector('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40 && (!test || test(d[i], d[i + 1], d[i + 2], d[i + 3]))) n++; return n;
  };
  window.size = id => { const r = document.getElementById(id).querySelector('canvas').getBoundingClientRect(); return [r.width, r.height]; };
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1000, height: 700, deviceScaleFactor: 1 });
  await page.goto(PAGE, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'load' });
  await page.evaluate(HELPERS);
  const cdp = await page.target().createCDPSession();
  const settle = id => page.waitForFunction(id => settled(id), { timeout: 30000 }, id).then(() => true, () => false);
  const ev = (f, ...a) => page.evaluate(f, ...a);
  const [W, H] = await ev(() => size('a'));
  const stroke = async (id, pts) => {
    const b = await (await page.$('#' + id + ' canvas')).boundingBox();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: b.x + pts[0][0], y: b.y + pts[0][1], button: 'left', clickCount: 1 });
    for (const p of pts.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x + p[0], y: b.y + p[1], button: 'left' });
    const q = pts[pts.length - 1];
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x + q[0], y: b.y + q[1], button: 'left', clickCount: 1 });
  };
  const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n }, (_, i) => [x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * i / (n - 1)]);

  console.log('switching views while they animate');
  const r1 = byId('linear_001');
  await ev(st => { a.view = 'tidy'; a.strokes = st; }, place(r1, W, H, [0.05, 0.12, 0.6, 0.72]));
  ok(await settle('a'), 'ink given in code is read and shown');
  const L1 = await ev(() => a.latex), n1 = await ev(() => a.result.symbols.length), e1 = await ev(() => events.length);
  for (const v of ['typeset', 'hand', 'ink', 'tidy', 'typeset', 'ink', 'hand', 'typeset', 'tidy']) { await ev(v => { a.view = v; }, v); await wait(35); }
  ok(await settle('a'), 'nine view changes 35 ms apart settle');
  ok(await ev(() => a.view === 'tidy' && a.pad.plan && a.pad.plan.style === 'tidy'), 'on the last view chosen');
  ok(await ev(n => a.shown.length >= n && sane('a'), n1), 'with every symbol shown and backed by ink');
  ok(await ev(() => a.latex) === L1 && await ev(() => events.length) === e1, 'a view change does not read the ink again (same reading, no change event)');

  console.log('writing and erasing while a view animates');
  await ev(() => { a.view = 'typeset'; });
  await wait(20);
  const midA = await ev(() => !!a.pad.anim);
  await stroke('a', line(W * 0.8, H * 0.5, W * 0.92, H * 0.5));
  ok(midA, 'an animation is running when the pen comes down');
  ok(await settle('a'), 'the new stroke is read');
  const L2 = await ev(() => a.latex);
  ok(L2 !== L1 && await ev(n => a.strokes.length === n + 1, r1.strokes.length) && await ev(() => sane('a')), `and joins the view: ${L1} -> ${L2}`);
  await ev(() => { a.view = 'tidy'; });
  await wait(20);
  const it0 = (await ev(() => a.shown))[0], cb = await (await page.$('#a canvas')).boundingBox();
  await ev(() => { a.mode = 'erase'; });
  const cx = cb.x + (it0.box[0] + it0.box[2]) / 2, cy = cb.y + (it0.box[1] + it0.box[3]) / 2;
  await page.mouse.move(cx - 2, cy); await page.mouse.down(); await page.mouse.move(cx + 2, cy, { steps: 2 }); await page.mouse.up();
  await ev(() => { a.mode = 'draw'; });
  ok(await settle('a'), 'erasing during an animation settles');
  ok(await ev(n => a.strokes.length < n + 1, r1.strokes.length) && await ev(() => sane('a')), 'what was erased is gone from the ink and the view');
  await ev(() => a.undo());
  ok(await settle('a') && await ev(() => a.latex) === L2, 'undo brings it back');

  console.log('undo and redo storms');
  // written with the pen, so every stroke is in the history and nothing waits to be redone
  await ev(() => { a.strokes = []; });
  for (const s of place(r1, W, H, [0.05, 0.12, 0.6, 0.72])) await stroke('a', s.filter((_, i) => i % 2 === 0 || i === s.length - 1));
  ok(await settle('a'), 'the pen-written expression is read');
  const L3 = await ev(() => a.latex), nS = await ev(() => a.strokes.length);
  await ev(() => { for (let i = 0; i < 8; i++) a.undo(); for (let i = 0; i < 8; i++) a.redo(); });
  ok(await settle('a') && await ev(() => a.latex) === L3 && await ev(n => a.strokes.length === n, nS) && await ev(() => sane('a')), '8 undos and 8 redos at once end where they started');
  for (let i = 0; i < 6; i++) { await ev(() => a.undo()); await wait(25); }
  for (let i = 0; i < 6; i++) { await ev(() => a.redo()); await wait(25); }
  ok(await settle('a') && await ev(() => a.latex) === L3 && await ev(() => sane('a')), 'and the same spread over time');
  for (let i = 0; i < nS + 3; i++) await ev(() => a.undo());
  ok(await ev(() => a.strokes.length === 0 && a.latex === '' && a.shown.length === 0), 'undoing past the start leaves an empty pad');
  for (let i = 0; i < nS + 3; i++) await ev(() => a.redo());
  ok(await settle('a') && await ev(() => a.latex) === L3, 'redoing past the end brings it all back');

  console.log('a correction in a view');
  await ev(() => { a.view = 'typeset'; });
  await settle('a');
  const fix = await ev(() => {
    const s = a.result.symbols.find(x => /^[0-9]$/.test(x.label) && x.candidates.some(c => /^[0-9]$/.test(c[0]) && c[0] !== x.label));
    if (!s) return null;
    const alt = s.candidates.find(c => /^[0-9]$/.test(c[0]) && c[0] !== s.label)[0];
    a.relabel(s, alt);
    return { was: s.label, alt };
  });
  ok(!!fix, 'a digit with another digit among its candidates');
  if (fix) {
    ok(await ev(f => a.result.symbols.some(s => s.label === f.alt && s.fixed), fix), `relabel ${fix.was} -> ${fix.alt} is read at once`);
    ok(await settle('a') && await ev(f => a.shown.some(s => s.label === f.alt), fix) && await ev(() => sane('a')), 'and typeset with the new label');
    await ev(() => a.undo());
    ok(await settle('a') && await ev(() => sane('a')), 'undo after a correction is fine');
    await ev(() => a.redo());
    await settle('a');
  }
  await ev(() => Nib.memory.clear());

  console.log('a correction on a board');
  const [Wb, Hb] = await ev(() => size('b'));
  const left = place(byId('arith_002'), Wb, Hb, [0.02, 0.15, 0.4, 0.7]), right = place(byId('linear_002'), Wb, Hb, [0.55, 0.15, 0.42, 0.7]);
  await ev(st => { b.setAttribute('separate', ''); b.view = 'tidy'; b.strokes = st; }, left.concat(right));
  ok(await settle('b') && await ev(() => b.result.parts.length === 2), 'two expressions on a board read as two');
  const pl = await ev(() => b.result.parts.map(p => p.result.latex));
  const bf = await ev(n => {
    const s = b.result.symbols.find(x => x.strokes.every(i => i >= n) && /^[0-9]$/.test(x.label) && x.candidates.some(c => /^[0-9]$/.test(c[0]) && c[0] !== x.label));
    if (!s) return null;
    const alt = s.candidates.find(c => /^[0-9]$/.test(c[0]) && c[0] !== s.label)[0];
    b.relabel(s, alt); return alt;
  }, left.length);
  ok(!!bf, 'a digit in the second expression to correct');
  if (bf) {
    ok(await settle('b') && await ev(() => sane('b')), 'the board settles after the correction');
    const pl2 = await ev(() => b.result.parts.map(p => p.result.latex));
    ok(pl2[0] === pl[0] && pl2[1] !== pl[1] && pl2[1].includes(bf), `only the corrected expression changes: ${pl.join(' | ')} -> ${pl2.join(' | ')}`);
  }
  await ev(() => { Nib.memory.clear(); b.removeAttribute('separate'); b.view = 'ink'; b.clear(); });

  console.log('theme, motion, reduced motion, boxes');
  await ev(() => { a.view = 'tidy'; });
  await settle('a');
  await ev(() => { const st = document.createElement('style'); st.textContent = '.dark nib-pad { --nib-ink: rgb(250, 240, 200); }'; document.head.appendChild(st); document.documentElement.className = 'dark'; });
  await wait(150);
  ok(await ev(() => inked('a', (r, g, b) => r > 200 && g > 200 && b > 150)) > 100, 'a theme change redraws the view in the new ink');
  await ev(() => { document.documentElement.className = ''; });
  await wait(150);
  ok(await ev(() => inked('a', (r, g, b) => r > 200 && g > 200 && b > 150)) < 20, 'and back');
  await ev(() => { a.setAttribute('motion', 'false'); a.view = 'typeset'; });
  ok(await ev(() => a.pad.anim === null && a.shown.length > 0), 'motion="false": the view changes at once');
  await ev(() => { a.removeAttribute('motion'); });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await ev(() => { a.view = 'tidy'; });
  ok(await ev(() => a.pad.anim === null && a.shown.length > 0), 'a reader who asks for less motion gets no animation');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await ev(() => { a.setAttribute('boxes', ''); });
  await wait(100);
  ok(await ev(() => inked('a', (r, g, b) => r > 150 && g > 120 && b < 90)) > 50, 'boxes are drawn around what a view shows');
  await ev(() => { a.removeAttribute('boxes'); });
  await ev(() => { a.setAttribute('view', 'bogus'); });
  ok(await ev(() => a.view === 'ink' && a.pad.plan === null), 'an unknown view falls back to ink');
  await ev(() => { a.view = 'tidy'; });
  await settle('a');
  ok((await ev(() => a.toImage())).startsWith('data:image/png') && (await ev(() => a.toImage().length)) > 2000, 'toImage exports what the view shows');

  console.log('dots, tiny and huge writing, ink off the edge, a scribble');
  const dotted = rows.filter(r => r.symbols.some(s => ['.', '\\div', 'i', 'j', '!', ':', '\\cdot'].includes(s.label))).slice(0, 3);
  ok(dotted.length > 0, `expressions with dots to try (${dotted.map(r => r.id).join(', ')})`);
  const cases = dotted.map(r => [r.id, place(r, W, H, [0.05, 0.1, 0.8, 0.8])]).concat([
    ['tiny', place(r1, W, H, [0.4, 0.45, 0.12, 0.04])],
    ['huge', place(r1, W, H, [0, 0, 1, 1])],
    ['off the edge', place(r1, W, H, [-0.25, -0.2, 0.9, 0.9])],
    ['scribble', [Array.from({ length: 160 }, (_, i) => [200 + i * 2, 120 + (i % 2 ? 60 : -60) + Math.sin(i) * 9, i * 8])]],
  ]);
  for (const [name, st] of cases) {
    const res = [];
    for (const v of ['tidy', 'hand', 'typeset']) {
      await ev((st, v) => { a.view = v; a.strokes = st; }, st, v);
      const s = await settle('a');
      res.push(s && await ev(() => sane('a')) && await ev(() => inked('a')) > 20);
    }
    ok(res.every(Boolean), `${name}: every view settles, draws, and stays sane (${await ev(() => a.latex) || 'nothing read'})`);
  }

  console.log('clearing during a read; moving and removing the element');
  await ev(st => { a.view = 'tidy'; a.strokes = st; }, place(byId('formula_001'), W, H, [0.05, 0.1, 0.8, 0.8]));
  await wait(60);
  await ev(() => a.clear());
  await wait(1500);
  ok(await ev(() => a.strokes.length === 0 && a.latex === '' && a.shown.length === 0 && a.pad.result === null && inked('a') === 0), 'a clear during a read leaves nothing behind');
  await ev(st => { a.strokes = st; }, place(r1, W, H, [0.05, 0.12, 0.6, 0.72]));
  await settle('a');
  const pad0 = await ev(() => { window.__p = a.pad; a.parentNode.appendChild(a); return true; });
  await wait(50);
  ok(pad0 && await ev(() => a.pad === window.__p && a.view === 'tidy' && a.latex.length > 0), 'moving the element keeps the pad, its ink and its view');
  await ev(() => { window.__a = a; a.remove(); });
  await wait(60);
  await ev(() => { document.body.insertBefore(window.__a, b); });
  ok(await settle('a') && await ev(L => a.latex === L && a.view === 'tidy' && a.shown.length > 0 && sane('a'), L1), 'removed and put back: the ink is read again and shown in its view');

  console.log('odd ink handed over in code');
  const odd = await ev(() => {
    try {
      a.strokes = [[null, [100, 120], [NaN, 3], { x: 140, y: 130 }, [150, 'x'], [160, 140]], 'junk', { points: [[200, 100], [260, 160]] }, [], null, [[Infinity, 1]]];
      return { n: a.strokes.length, pts: a.strokes.map(s => s.length) };
    } catch (e) { return { err: String(e) }; }
  });
  ok(!odd.err && odd.n === 2 && odd.pts[0] === 3 && odd.pts[1] === 2, `points that are not points are dropped, the rest kept (${JSON.stringify(odd)})`);
  ok(await settle('a') && await ev(() => sane('a')), 'and what is left is read and shown');
  await ev(() => { a.strokes = 'nonsense'; });
  ok(await ev(() => a.strokes.length === 0 && a.latex === ''), 'strokes that are not a list leave an empty pad');
  await ev(st => { a.strokes = st; }, place(r1, W, H, [0.05, 0.12, 0.6, 0.72]));
  await settle('a');

  console.log('answers after "=" in a pad');
  {
    const { compose } = require('./compose.js');
    const NibNode = require(path.join(__dirname, '..', 'dist', 'nib.js'));
    const find = (tex, want) => { for (let k = 0; k < 25; k++) { const e = compose(tex); if (new NibNode.Recognizer().recognize(e.strokes).latex === want) return e; } return null; };
    const p1 = find('12+30=', '12+30='), p2 = find('x=5\\\\2x+1=', '\\begin{gathered}x=5 \\\\ 2x+1=\\end{gathered}');
    ok(!!p1 && !!p2, 'handwritten 12 + 30 = and a two-line x = 5, 2x + 1 =');
    const putIn = async e => { await ev(st => { a.strokes = st; }, place({ strokes: e.strokes }, W, H, [0.1, 0.15, 0.5, 0.7])); return settle('a'); };
    await ev(() => { a.view = 'tidy'; a.solve = true; });
    ok(await putIn(p1), 'read');
    ok(await ev(() => JSON.stringify(a.answers.map(x => x.latex)) === '["42"]' && a.solved === '12+30=42'), 'answers and solved');
    ok(await ev(() => a.shown.some(s => s.answer) && a.shown.filter(s => s.answer).every(s => s.label === '4' || s.label === '2')), 'the view shows the answer, marked as an answer');
    ok(await ev(() => sane('a')), 'answers are tied to the "=" they follow');
    for (let i = 0; i < 10; i++) { await ev(() => { a.solve = !a.solve; }); await wait(15); }
    ok(await settle('a') && await ev(() => a.solve === true && a.answers.length === 1 && sane('a')), 'Solve toggled ten times in a row lands where it should');
    for (const v of ['typeset', 'ink', 'hand', 'tidy']) { await ev(v => { a.view = v; }, v); await wait(40); }
    ok(await settle('a') && await ev(() => a.answers.length === 1 && a.shown.some(s => s.answer) && sane('a')), 'answers ride along through quick view changes');
    await ev(() => { a.solve = false; });
    ok(await ev(() => a.answers.length === 0 && !a.shown.some(s => s.answer) && a.solved === a.latex), 'solve off: no answers anywhere');
    await ev(() => { a.solve = true; });
    ok(await putIn(p2) && await ev(() => JSON.stringify(a.answers.map(x => [x.line, x.latex])) === '[[1,"11"]]'), 'x = 5 on one line sets x for the next: 2x + 1 = 11');
    await ev(() => { a.view = 'ink'; });
    await wait(400);
    ok(await ev(() => a.pad.plan && a.pad.plan.items.every(i => i.answer) && a.shown.length > 0 && sane('a')), 'ink as written: only the answer is drawn, the writing stays as it is');
    await ev(st => { a.strokes = st; }, place(r1, W, H, [0.05, 0.12, 0.6, 0.72]));
    ok(await settle('a') && await ev(() => a.answers.length === 0 && !a.shown.length), 'writing without a trailing "=": nothing extra');
    await ev(() => { a.solve = false; a.view = 'tidy'; });
    await settle('a');
  }

  console.log('my hand with no hand saved');
  await ev(() => { Nib.hand.clear(); a.view = 'hand'; });
  ok(await settle('a') && await ev(n => a.shown.length >= n && a.shown.every(s => s.parts.every(p => p.t === 'ink')) && sane('a'), n1), 'tidy stand-ins for every symbol');

  console.log('resizing during an animation');
  await ev(() => { a.view = 'typeset'; a.style.height = '200px'; });
  await wait(400);
  ok(await settle('a') && await ev(() => inked('a')) > 50 && await ev(() => sane('a')), 'the view redraws at the new size');
  await ev(() => { a.style.height = '300px'; });

  console.log('typeset when the fonts cannot load');
  const nf = await browser.newPage();
  nf.on('pageerror', e => errors.push('no-fonts page: ' + e));
  await nf.evaluateOnNewDocument(() => { delete window.FontFace; });
  await nf.setViewport({ width: 1000, height: 700 });
  await nf.goto(PAGE, { waitUntil: 'load' });
  await nf.evaluate(HELPERS);
  await nf.evaluate(st => { a.view = 'typeset'; a.strokes = st; }, place(r1, W, H, [0.05, 0.12, 0.6, 0.72]));
  ok(await nf.waitForFunction(() => settled('a'), { timeout: 30000 }).then(() => true, () => false), 'the read still settles');
  ok(await nf.evaluate(() => a.shown.some(s => s.parts.some(p => p.t === 'text')) && inked('a') > 100 && sane('a')), 'typeset draws with the system\'s maths fonts instead');
  await nf.close();

  console.log('a sharp (2x) screen');
  const hd = await browser.newPage();
  hd.on('pageerror', e => errors.push('2x page: ' + e));
  await hd.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
  await hd.goto(PAGE, { waitUntil: 'load' });
  await hd.evaluate(HELPERS);
  const c2 = await hd.createCDPSession(), bb = await (await hd.$('#a canvas')).boundingBox();
  await c2.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bb.x + 100, y: bb.y + 150, button: 'left', clickCount: 1 });
  for (let x = 110; x <= 300; x += 10) await c2.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bb.x + x, y: bb.y + 150, button: 'left' });
  await c2.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bb.x + 300, y: bb.y + 150, button: 'left', clickCount: 1 });
  const ext = await hd.evaluate(() => {
    const c = a.querySelector('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 100) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { w: c.width, cw: c.getBoundingClientRect().width, x0: x0 / 2, x1: x1 / 2, y: (y0 + y1) / 4 };
  });
  ok(Math.abs(ext.w - 2 * ext.cw) <= 2, `the canvas has two pixels per CSS pixel (${ext.w} for ${ext.cw})`);
  ok(Math.abs(ext.x0 - 100) < 4 && Math.abs(ext.x1 - 300) < 4 && Math.abs(ext.y - 150) < 3, `ink lands under the pen (${ext.x0.toFixed(1)}–${ext.x1.toFixed(1)} at ${ext.y.toFixed(1)})`);
  await hd.close();

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
