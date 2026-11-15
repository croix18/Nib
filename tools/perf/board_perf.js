// The Board under load: (1) how long the page is stuck when a very long stroke is lifted, (2) how long after a reload
// a full page's answers are back, and whether the page answers input meanwhile, (3) a reading that throws.
'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(T.npm('puppeteer-core'));
const BOARD = 'file://' + (process.env.BOARD || REPO + '/dist/Board.html');
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const wait = ms => new Promise(r => setTimeout(r, ms));
const Nib = require(REPO + '/dist/nib.js');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nibperf-'));
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, userDataDir: dir, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const open = async (kv, slow) => {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
    await page.setViewport({ width: 1400, height: 900 });
    await page.evaluateOnNewDocument(kv => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]); sessionStorage.setItem('seeded', '1'); }
      // the longest gap between animation frames: how long the page was stuck
      window.__gap = 0; let last = performance.now(); const tick = () => { const n = performance.now(); if (n - last > window.__gap) window.__gap = n - last; last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }, kv || {});
    if (slow) { const c = await page.createCDPSession(); await c.send('Emulation.setCPUThrottlingRate', { rate: slow }); }
    await page.goto(BOARD, { waitUntil: 'load' }); await wait(800);
    return { page, errors };
  };
  // ---- 1. a very long stroke
  for (const [name, n, legsPer] of [['2,000 point zig-zag', 2000, 25], ['8,000 point zig-zag', 8000, 25], ['16,000 point zig-zag (a minute of shading)', 16000, 25], ['16,000 point wandering line', 16000, 0], ['40,000 point zig-zag', 40000, 25]]) {
    for (const slow of [1, 4]) {
      const { page, errors } = await open({}, slow);
      const r = await page.evaluate(async ([n, legsPer]) => {
        const c = document.querySelector('#pad canvas'), b = c.getBoundingClientRect();
        const pts = []; let x = 0, y = 0, a = 0;
        for (let i = 0; i < n; i++) {
          if (legsPer) { const leg = Math.floor(i / legsPer), k = i % legsPer; pts.push([b.left + 200 + (leg % 2 ? 600 - k * 24 : k * 24), b.top + 150 + (leg * 0.9) % 500]); }
          else { a += Math.sin(i / 37) * 0.2; x += Math.cos(a) * 1.5; y += Math.sin(a) * 1.5; pts.push([b.left + 700 + (x % 500), b.top + 450 + (y % 300)]); }
        }
        const ev = (type, p) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: p[0], clientY: p[1], pressure: 0.5, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
        ev('pointerdown', pts[0]);
        const t0 = performance.now();
        for (let i = 1; i < n; i++) { ev('pointermove', pts[i]); if (i % 400 === 0) await new Promise(r => requestAnimationFrame(r)); }
        const drawMs = performance.now() - t0;
        window.__gap = 0; await new Promise(r => requestAnimationFrame(r));
        const t1 = performance.now(); ev('pointerup', pts[n - 1]); const upMs = performance.now() - t1;
        await new Promise(r => setTimeout(r, 1500));
        const P = document.getElementById('pad').pad;
        return { drawMs: Math.round(drawMs), upMs: Math.round(upMs), gapAfter: Math.round(window.__gap), strokes: P.strokes.length, pts: P.strokes[0] ? P.strokes[0].length : 0 };
      }, [n, legsPer]);
      console.log(`long stroke: ${name.padEnd(44)} cpu x${slow}: pen-up handler ${String(r.upMs).padStart(6)} ms, longest stuck frame after ${String(r.gapAfter).padStart(6)} ms, kept ${r.strokes} element(s) of ${r.pts} points${errors.length ? '  ERRORS ' + errors[0] : ''}`);
      await page.close();
    }
  }
  // ---- 2. a full page after a reload
  const K = Nib.canvas;
  for (const count of [20, 60, 120]) {
    const pk = [];
    for (let i = 0; i < count; i++) { const r = rows[(i * 7) % rows.length], col = i % 4, row = Math.floor(i / 4); let x0 = Infinity, y0 = Infinity; for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); }
      for (const s of r.strokes) pk.push(K.pack(s.map(p => [(p[0] - x0) * 0.7 + 60 + col * 900, (p[1] - y0) * 0.7 + 60 + row * 260]), false)); }
    for (const slow of [1, 4]) {
      const { page, errors } = await open({ 'nib-board-v3': JSON.stringify({ v: 3, page: 0, pages: [{ pk, fixes: [], revealed: [], types: [], paper: { kind: 'dots', tone: 'theme' } }] }) }, slow);
      const t0 = Date.now();
      const done = await page.waitForFunction(() => { const p = document.getElementById('pad'); return p.pad && p.pad.result && p.pad.strokes.length === p.pad.resultStrokes.length; }, { timeout: 240000 }).then(() => true).catch(() => false);
      const r = await page.evaluate(() => ({ gap: Math.round(window.__gap), n: document.getElementById('pad').pad.strokes.length, parts: document.getElementById('pad').pad.result ? document.getElementById('pad').pad.result.parts.length : 0 }));
      console.log(`reload: ${String(count).padStart(3)} expressions (${r.n} strokes) cpu x${slow}: ${done ? 'read again after ' + ((Date.now() - t0 + 800) / 1000).toFixed(1) + ' s' : 'NOT read after 240 s'}, ${r.parts} parts, longest stuck frame ${r.gap} ms${errors.length ? '  ERRORS ' + errors[0] : ''}`);
      await page.close();
    }
  }
  // ---- 3. one piece of writing whose reading throws
  {
    const { page, errors } = await open({});
    const out = await page.evaluate(async rows => {
      const P = document.getElementById('pad').pad, el = document.getElementById('pad');
      let evs = 0; el.addEventListener('nib:result', () => evs++);
      const place = (r, dx, dy) => r.strokes.map(s => s.map(p => [p[0] * 0.6 + dx, p[1] * 0.6 + dy]));
      const A = place(rows[0], 60, 60), B = place(rows[1], 700, 60), C = place(rows[2], 60, 420);
      // the second piece's reading throws (as an engine bug on some odd ink would)
      const orig = Nib.Recognizer.prototype.recognize, bad = new Set();
      Nib.Recognizer.prototype.recognize = function (st, o) { if (st.some(s => bad.has(s))) throw new Error('injected: this piece cannot be read'); return orig.call(this, st, o); };
      const origW = Nib.Recognizer.prototype.warmup;
      Nib.Recognizer.prototype.warmup = function* (st, o) { if (st.some(s => bad.has(s))) throw new Error('injected: this piece cannot be warmed'); yield* origW.call(this, st, o); };
      P.setStrokes(A.concat(B, C));
      for (const s of P.strokes.slice(A.length, A.length + B.length)) bad.add(s);
      P._changed();
      await new Promise(r => setTimeout(r, 6000));
      return { result: !!P.result, parts: P.result && P.result.parts ? P.result.parts.length : null, evs, strokes: P.strokes.length };
    }, rows.slice(0, 3).map(r => ({ strokes: r.strokes })));
    console.log('a piece whose reading throws:', JSON.stringify(out), 'page errors:', errors.length, errors[0] || '');
    await page.close();
  }
  await browser.close(); fs.rmSync(dir, { recursive: true, force: true });
})();
