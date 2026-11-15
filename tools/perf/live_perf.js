// A full page, already read: what does one more stroke cost? (the final pass over the whole page, on the main thread)
// NIB_INIT: a line of script run as soon as the engine is there, before the Board reads ("Nib._internals.poolUse(0)":
// the pool off, 1.8.0); SLOW=1 for the normal speed only (default 1,4). The cold read: from the page's load to its
// reading, the read's own time (result.ms, the asking of the pool included), and the longest the page's thread was
// held meanwhile (a 4 ms heartbeat; the gaps before the read begins — the page being built and drawn — not counted).
'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(T.npm('puppeteer-core'));
const BOARD = 'file://' + (process.env.BOARD || REPO + '/dist/Board.html');
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const wait = ms => new Promise(r => setTimeout(r, ms));
const Nib = require(REPO + '/dist/nib.js'), K = Nib.canvas;
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niblive-'));
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, userDataDir: dir, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  for (const count of (process.argv[2] || '20,60,120').split(',').map(Number)) {
    const pk = [];
    for (let i = 0; i < count; i++) { const r = rows[(i * 7) % rows.length], col = i % 4, row = Math.floor(i / 4); let x0 = Infinity, y0 = Infinity; for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); }
      for (const s of r.strokes) pk.push(K.pack(s.map(p => [(p[0] - x0) * 0.7 + 60 + col * 900, (p[1] - y0) * 0.7 + 400 + row * 260]), false)); }
    for (const slow of (process.env.SLOW || '1,4').split(',').map(Number)) {
      const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.setViewport({ width: 1400, height: 900 });
      await page.evaluateOnNewDocument(kv => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]); sessionStorage.setItem('seeded', '1'); } }, { 'nib-board-v3': JSON.stringify({ v: 3, page: 0, pages: [{ pk, fixes: [], revealed: [], types: [], paper: { kind: 'dots', tone: 'theme' } }] }) });
      // (the line runs when the engine sets window.Nib, before the Board's first read is due)
      await page.evaluateOnNewDocument(init => {
        let v;
        // the read begins when its timer fires: _ask (1.8.0) or _partsSteps (1.7) is first called
        const began = x => { for (const k of ['_ask', '_partsSteps']) { const P = x.Pad && x.Pad.prototype, f = P && P[k]; if (f) { P[k] = function () { if (!window.__began) window.__began = performance.now(); return f.apply(this, arguments); }; return; } } };
        Object.defineProperty(window, 'Nib', { configurable: true, get: () => v, set: x => { v = x; Object.defineProperty(window, 'Nib', { value: x, writable: true, configurable: true }); began(x); if (init) (0, eval)(init); } });
        // the heartbeat: the longest gap between two ticks from then until the reading is there
        window.__hold = 0; window.__began = 0; let last = 0;
        setInterval(() => { const t = performance.now(), p = document.getElementById('pad'); if (last && window.__began && last >= window.__began && p && p.pad && p.pad.busy) window.__hold = Math.max(window.__hold, t - last); last = t; }, 4);
      }, process.env.NIB_INIT || '');
      await page.goto(BOARD, { waitUntil: 'load' });
      const t0 = Date.now();
      await page.waitForFunction(() => { const p = document.getElementById('pad'); return p.pad && p.pad.result && p.pad.result.parts && p.pad.strokes.length === p.pad.resultStrokes.length; }, { timeout: 600000 });
      const coldS = (Date.now() - t0) / 1000;
      const cold = await page.evaluate(() => ({ ms: document.getElementById('pad').pad.result.ms, hold: Math.round(window.__hold), workers: Nib.workers, pool: Nib._internals.poolTest ? Nib._internals.poolTest('stats') : null }));
      const c = await page.createCDPSession(); if (slow > 1) await c.send('Emulation.setCPUThrottlingRate', { rate: slow });
      const r = await page.evaluate(async () => {
        const P = document.getElementById('pad').pad, el = document.querySelector('#pad canvas'), b = el.getBoundingClientRect();
        // time the pieces of the final pass
        const T = { announce: 0, readParts: 0, replan: 0, emit: 0, n: 0 };
        for (const k of ['_announce', '_readParts', '_replan', '_emit']) { const f = P[k]; P[k] = function () { const t = performance.now(); try { return f.apply(this, arguments); } finally { const d = performance.now() - t; T[k.replace('_', '')] += d; if (k === '_announce') T.n++; } }; }
        let gap = 0, last = performance.now(), on = true; const tick = () => { const n = performance.now(); if (n - last > gap) gap = n - last; last = n; if (on) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'pen', isPrimary: true, clientX: x, clientY: y, pressure: 0.5, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
        const results = []; document.getElementById('pad').addEventListener('nib:result', () => results.push(performance.now()));
        // write a "1" then a "+" then a "2" at the top of the page, a second apart, as a hand would
        const strokes = [[[300, 120], [300, 180]], [[340, 150], [380, 150]], [[360, 130], [360, 170]], [[420, 125], [445, 118], [455, 135], [425, 178], [460, 178]]];
        const out = [];
        for (const s of strokes) {
          const before = results.length; gap = 0;
          ev('pointerdown', b.left + s[0][0], b.top + s[0][1]);
          for (let i = 1; i < s.length; i++) { for (let k = 1; k <= 6; k++) { ev('pointermove', b.left + s[i - 1][0] + (s[i][0] - s[i - 1][0]) * k / 6, b.top + s[i - 1][1] + (s[i][1] - s[i - 1][1]) * k / 6); } await new Promise(r => requestAnimationFrame(r)); }
          const tUp = performance.now(); ev('pointerup', b.left + s[s.length - 1][0], b.top + s[s.length - 1][1]);
          const t1 = performance.now();
          while (results.length === before && performance.now() - t1 < 20000) await new Promise(r => setTimeout(r, 20));
          await new Promise(r => setTimeout(r, 300));
          out.push({ toResult: Math.round((results[results.length - 1] || performance.now()) - tUp), stuck: Math.round(gap) });
        }
        on = false;
        return { out, T: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, k === 'n' ? v : Math.round(v / Math.max(1, T.n))])), parts: P.result.parts.length };
      });
      console.log(`${String(count).padStart(3)} expressions on the page, cpu x${slow} (cold read took ${coldS.toFixed(1)} s from load; the read ${cold.ms} ms, the page's thread held ${cold.hold} ms at the longest; ${cold.pool ? cold.pool.started + ' workers started, ' + cold.pool.answered + ' groups in them, ' + cold.pool.here + ' here' : 'no pool'}): each new stroke → result after ${r.out.map(o => o.toResult).join(', ')} ms; page stuck for ${r.out.map(o => o.stuck).join(', ')} ms | per read: announce ${r.T.announce} ms (emit ${r.T.emit} of which replan ${r.T.replan})${errors.length ? ' ERR ' + errors[0] : ''}`);
      await page.close();
    }
  }
  await browser.close(); fs.rmSync(dir, { recursive: true, force: true });
})();
