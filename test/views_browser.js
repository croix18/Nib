// The pad's in-place views in a real browser: tidy, my handwriting and typeset, switching between them and back to
// ink, the animation, erasing what is shown, undo, a hand loaded from a Replicator file, a second pad left alone,
// odd sizes, and speed with the processor slowed four times. Screenshots go to test/shots/views-*.png.
//   node test/views_browser.js
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(require('./data').npm('puppeteer-core'));
const { need } = require('./data');
const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const byId = id => rows.find(r => r.id === id);

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

function makeHand() {
  const t = fs.readFileSync(need('test.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const pool = {};
  for (const r of t) for (const s of r.symbols) (pool[s.label] = pool[s.label] || []).push(s.strokes.map(k => r.strokes[k]));
  const G = { cap: 0.2, x: 0.376, base: 0.76, desc: 0.944 }, glyphs = {};
  for (const ch of '0123456789abcdefghijklmnopqrstuvwxyz+-=()'.split('')) {
    const list = pool[ch]; if (!list) continue;
    const st = list[Math.min(1, list.length - 1)];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    let top = G.cap, bot = G.base;
    if (/[a-z]/.test(ch) && !/[bdfhklt]/.test(ch)) top = G.x;
    if (/[gjpqy]/.test(ch)) { top = G.x; bot = G.desc; }
    if ('-+='.includes(ch)) { top = G.x - 0.03; bot = G.base - 0.1; }
    if ('()'.includes(ch)) { top = G.cap - 0.04; bot = G.base + 0.15; }
    const k = Math.min((bot - top) / Math.max(y1 - y0, 1e-9), 0.8 / Math.max(x1 - x0, 1e-9));
    glyphs[ch] = st.map(s => s.map(p => [0.1 + (p[0] - x0) * k, top + (p[1] - y0) * k]));
  }
  return { name: 'Test hand', glyphs };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: require('./data').needChrome(), headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1000, height: 700, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'views_page.html'), { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'load' });
  const cdp = await page.target().createCDPSession();
  const write = async (sel, r, region = [0.05, 0.12, 0.9, 0.72]) => {
    const box = await (await page.$(sel + ' canvas')).boundingBox();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const k = Math.min(box.width * region[2] / (x1 - x0), box.height * region[3] / (y1 - y0));
    for (const s of r.strokes) {
      const P = s.map(p => [box.x + box.width * region[0] + (p[0] - x0) * k, box.y + box.height * region[1] + (p[1] - y0) * k]);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P[0][0], y: P[0][1], button: 'left', clickCount: 1 });
      for (let i = 1; i < P.length; i += 2) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: P[i][0], y: P[i][1], button: 'left' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P[P.length - 1][0], y: P[P.length - 1][1], button: 'left', clickCount: 1 });
    }
  };
  const shown = id => page.evaluate(id => document.getElementById(id).shown.map(s => ({ label: s.label, box: s.box, kinds: s.parts.map(p => p.t) })), id);
  const shot = async name => { await (await page.$('#a')).screenshot({ path: path.join(out, `views-${name}.png`) }); };
  // pixels the pad has drawn (non-transparent), to tell an empty canvas from a drawn one
  const inked = id => page.evaluate(id => {
    const c = document.getElementById(id).querySelector('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n;
  }, id);

  console.log('tidy');
  const r1 = byId('linear_001') || rows[40];
  await write('#a', r1);
  await page.waitForFunction(() => a.latex.length > 0, { timeout: 20000 });
  await wait(600);
  const latex1 = await page.evaluate(() => a.latex);
  const t1 = await shown('a');
  const nsym = await page.evaluate(() => a.result.symbols.length);
  ok(t1.length >= nsym && t1.every(s => s.kinds.every(k => k === 'ink')), `tidy shows every symbol as ink (${t1.length} items for ${nsym} symbols): ${latex1}`);
  await shot('tidy');
  const strokesBefore = await page.evaluate(() => a.strokes.length);

  console.log('typeset');
  await page.evaluate(() => { a.view = 'typeset'; });
  await wait(120);
  const midAnim = await page.evaluate(() => !!(a.pad.anim && a.pad.anim.e < 1));
  ok(midAnim, 'switching view animates');
  await wait(800);
  const t2 = await shown('a');
  ok(t2.length > 0 && t2.some(s => s.kinds.includes('text')), `typeset shows text glyphs (${t2.length} items)`);
  const fontsOk = await page.evaluate(() => document.fonts.check('40px "Nib KaTeX Main"') && document.fonts.check('40px "Nib KaTeX Math"'));
  ok(fontsOk, 'the embedded KaTeX fonts are loaded');
  ok(await page.evaluate(() => a.pad.anim === null), 'the animation finishes');
  await shot('typeset');
  // typeset sits where the ink was: its box overlaps the ink's box
  const overlap = await page.evaluate(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of a.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
    for (const s of a.shown) { X0 = Math.min(X0, s.box[0]); Y0 = Math.min(Y0, s.box[1]); X1 = Math.max(X1, s.box[2]); Y1 = Math.max(Y1, s.box[3]); }
    const ix = Math.min(x1, X1) - Math.max(x0, X0), iy = Math.min(y1, Y1) - Math.max(y0, Y0);
    return ix > 0 && iy > 0 ? (ix * iy) / ((x1 - x0) * (y1 - y0)) : 0;
  });
  ok(overlap > 0.6, `the typeset maths sits where it was written (${Math.round(overlap * 100)}% of the ink's area covered)`);

  console.log('my handwriting');
  const hand = makeHand();
  await page.evaluate(h => { Nib.hand.load(JSON.stringify(h)); a.view = 'hand'; }, hand);
  await wait(900);
  const t3 = await shown('a');
  ok(t3.length > 0 && t3.every(s => s.kinds.every(k => k === 'ink')), `my handwriting shows ink glyphs (${t3.length} items)`);
  await shot('hand');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('nib-hand-v1')).glyphs['7'].length > 0), 'the hand is kept in this browser');
  // another page of the same site saving handwriting updates this pad
  const before = JSON.stringify(await shown('a'));
  await page.evaluate(h => { const g = JSON.parse(JSON.stringify(h)); for (const k of Object.keys(g.glyphs)) g.glyphs[k] = g.glyphs[k].map(s => s.map(p => [p[0] * 0.8, p[1]])); localStorage.setItem('nib-hand-v1', JSON.stringify(g)); window.dispatchEvent(new StorageEvent('storage', { key: 'nib-hand-v1' })); }, hand);
  await wait(900);
  ok(JSON.stringify(await shown('a')) !== before, 'handwriting saved in another page of the same site is picked up');

  console.log('erasing what is shown, undo');
  await page.evaluate(() => { a.view = 'typeset'; });
  await wait(900);
  const target = (await shown('a'))[0];
  const cb = await (await page.$('#a canvas')).boundingBox();
  await page.evaluate(() => { a.mode = 'erase'; });
  const cx = cb.x + (target.box[0] + target.box[2]) / 2, cy = cb.y + (target.box[1] + target.box[3]) / 2;
  await page.mouse.move(cx - 3, cy); await page.mouse.down(); await page.mouse.move(cx + 3, cy, { steps: 3 }); await page.mouse.up();
  await wait(300);
  const afterErase = await page.evaluate(() => a.strokes.length);
  ok(afterErase < strokesBefore, `erasing a typeset symbol removes its strokes (${strokesBefore} -> ${afterErase})`);
  await page.evaluate(() => { a.mode = 'draw'; a.undo(); });
  await wait(1200);
  ok(await page.evaluate(() => a.strokes.length) === strokesBefore && (await page.evaluate(() => a.latex)) === latex1, 'undo brings it back, read the same');

  console.log('back to ink');
  await page.evaluate(() => { a.view = 'ink'; });
  await wait(700);
  ok((await shown('a')).length === 0 && await page.evaluate(() => a.pad.plan === null), 'view "ink" shows the strokes as written');
  ok(await inked('a') > 200, 'and they are drawn');
  await shot('ink');

  console.log('writing more while in a view');
  await page.evaluate(() => { a.view = 'tidy'; a.clear(); });
  await wait(300);
  const r2 = byId('frac_001') || rows[100];
  await write('#a', r2, [0.05, 0.1, 0.45, 0.8]);
  await page.waitForFunction(() => a.latex.length > 0, { timeout: 20000 });
  await wait(700);
  const n1 = (await shown('a')).length;
  const r3 = byId('arith_002') || rows[2];
  await write('#a', r3, [0.6, 0.3, 0.35, 0.4]);
  await page.waitForFunction(n => a.shown.length > n, { timeout: 20000 }, n1).catch(() => {});
  await wait(700);
  const n2 = (await shown('a')).length;
  ok(n2 > n1, `new ink joins the view after it is read (${n1} -> ${n2} items)`);
  ok(await page.evaluate(() => { const live = new Set(a.pad.strokes); return a.pad.plan.items.every(it => it.from.every(s => live.has(s))); }), 'everything shown is backed by ink on the pad');
  await shot('more');

  console.log('the other pad, sizes, a clear');
  ok(await page.evaluate(() => b.view) === 'ink' && (await shown('b')).length === 0, 'the second pad keeps its own view');
  await page.evaluate(() => { a.style.height = '120px'; });
  await wait(600);
  ok(await inked('a') > 50, 'a resized pad redraws its view');
  await page.evaluate(() => { a.style.height = '300px'; a.clear(); });
  await wait(500);
  ok((await shown('a')).length === 0 && await inked('a') === 0, 'clear empties the view');

  console.log('a slow computer (CPU 4x slower)');
  await page.evaluate(() => { a.view = 'typeset'; longTasks.length = 0; });
  await page.emulateCPUThrottling(4);
  const r4 = byId('formula_001') || rows[600];
  await write('#a', r4);
  const t0 = Date.now();
  await page.waitForFunction(() => a.shown.length > 0 && a.pad.anim === null, { timeout: 60000 }).catch(() => {});
  const took = Date.now() - t0;
  const lt = await page.evaluate(() => longTasks.slice());
  await page.emulateCPUThrottling(1);
  console.log(`    typeset ${took} ms after the last pen-up (includes the 450 ms rest); long tasks: ${lt.length ? lt.join(', ') : 'none'}`);
  ok(took < 7000, 'typeset appears within 7 s on a 4x slower CPU');
  ok(!lt.some(d => d > 400), 'the page never freezes for more than 0.4 s');
  await shot('typeset-slow');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
