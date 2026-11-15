// Nib 1.6.7, hardened, in a real browser (the node side is test/hardening_check.js):
//   1. a piece of writing that cannot be read (its reading throws) stays ink, the rest is read and answered, it is
//      said once (console.warn, nib:fault, pad.faults) and not tried again; writing, erasing, Undo and the state still
//      work, and taking the ink away brings the reading back; the same for one expression (a pad without separate)
//   2. a malformed reading, a view that cannot be laid out and an item that cannot be drawn: the result is still
//      kept and announced, the rest of the board is drawn and the canvas is sound after it
//   3. symbols="…" that names no set reads with the school set (one warning)
//   4. the Board opened with a camera of 1e308: what is written there is read, saved and back after a reload; a
//      board file that cannot be read says so
//   5. a 16,000-point pen stroke on the Board: the page is not stuck when the pen lifts
//   6. the Replicator opened with letters saved far outside their boxes stays alive; a stroke dragged far out of a
//      box is kept to it
//   node test/hardening_browser.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(require('./data').npm('puppeteer-core'));
const Nib = require(path.join(__dirname, '..', 'dist', 'nib.js'));
const { compose } = require('./compose.js');
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (c) passes++; else fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const flat = t => String(t || '').replace(/\s/g, '');
const BOARD = 'file://' + path.join(__dirname, '..', 'dist', 'Board.html');
const REPLICATOR = 'file://' + path.join(__dirname, '..', 'dist', 'Replicator.html');
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-hardening-'));
  const browser = await puppeteer.launch({ executablePath: require('./data').needChrome(), headless: true, userDataDir: dir, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const open = async (url, seed) => {
    const page = await browser.newPage(), errors = [], warns = [];
    page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'warn' || m.type() === 'warning') warns.push(m.text()); if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.setViewport({ width: 1200, height: 800 });
    await page.evaluateOnNewDocument(kv => {
      if (kv && !sessionStorage.getItem('seeded')) { localStorage.clear(); for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]); sessionStorage.setItem('seeded', '1'); }
      window.__gap = 0; let last = performance.now();
      const tick = () => { const n = performance.now(); if (n - last > window.__gap) window.__gap = n - last; last = n; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, seed || null);
    await page.goto(url, { waitUntil: 'load' });
    return { page, errors, warns };
  };
  const A = written('2+3=', 80, 80, 50), B = written('7-4=', 560, 80, 50), C = written('5+1=', 80, 400, 50), D = written('8+1=', 560, 400, 50);
  ok(A && B && C && D, 'writing composed that reads 2+3=, 7-4=, 5+1= and 8+1=');

  // ---------------------------------------------------------------- 1. a piece that cannot be read (separate)
  console.log('a piece of writing that cannot be read');
  {
    const { page, errors, warns } = await open('file://' + path.join(__dirname, 'scribble_page.html'));
    await page.waitForFunction(() => window.Nib && document.getElementById('pad').pad);
    await page.evaluate(() => {
      const el = document.getElementById('pad');
      window.faults = []; window.results = 0; window.bad = new Set(); window.badCalls = 0; window.mode = 'throw';
      el.addEventListener('nib:fault', e => faults.push(e.detail.where));
      el.addEventListener('nib:result', () => results++);
      // the reading of any group with a stroke in `bad` throws (as an engine bug on some odd ink would), warm-up and all
      const R = Nib.Recognizer.prototype, rec = R.recognize, warm = R.warmup;
      R.recognize = function (st, o) {
        if (Array.isArray(st) && st.some(s => bad.has(s))) {
          badCalls++;
          if (mode === 'throw') throw new Error('injected: this piece cannot be read');
          return { latex: 'x', text: 'x', symbols: [{ label: 'x', box: null, strokes: [0] }], lines: undefined, tree: [[{ k: 's', label: 'x', strokes: [0] }]] };
        }
        return rec.call(this, st, o);
      };
      R.warmup = function* (st, o) { if (Array.isArray(st) && st.some(s => bad.has(s)) && mode === 'throw') { badCalls++; throw new Error('injected: this piece cannot be warmed up'); } yield* warm.call(this, st, o); };
    });
    const put = async (groups, badAt) => page.evaluate((groups, badAt) => {
      const P = document.getElementById('pad').pad;
      window.mark = results;
      P.setStrokes([].concat(...groups));
      bad.clear();
      let i = 0; groups.forEach((g, k) => { for (let j = 0; j < g.length; j++, i++) if (k === badAt) bad.add(P.strokes[i]); });
    }, groups, badAt);
    const settle = () => page.waitForFunction(() => { const P = document.getElementById('pad').pad; return results > mark && P.result && P.resultStrokes.length === P.ink.length; }, { timeout: 15000 }).then(() => true, () => false);
    const state = () => page.evaluate(() => { const P = document.getElementById('pad').pad; return { latex: P.result ? P.result.latex : null, parts: P.result && P.result.parts ? P.result.parts.map(p => flat(p.result.latex)) : null, answers: P.answers.map(a => a.latex), n: P.strokes.length, h: P.history.length, faults: faults.slice(), padFaults: (P.faults || []).map(f => f.where + ': ' + f.message), results, badCalls }; function flat(t) { return String(t || '').replace(/\s/g, ''); } });
    const settled = async () => { await wait(300); return settle(); };
    await put([A, B, C], 1);
    ok(await settled(), 'the reading settles');
    let s = await state();
    const nWarn = () => warns.filter(w => /^Nib: /.test(w)).length;
    ok(s.parts && s.parts.includes('2+3=') && s.parts.includes('5+1=') && s.parts.filter(p => p === '').length === 1, 'the other two pieces are read, the bad one reads as nothing: ' + JSON.stringify(s.parts));
    ok(s.answers.includes('5') && s.answers.includes('6') && s.answers.length === 2, 'and answered: ' + JSON.stringify(s.answers));
    ok(s.results >= 1, `nib:result fires (${s.results})`);
    ok(nWarn() === 1 && s.faults.length === 1 && s.faults[0] === 'read' && s.padFaults.length === 1 && /injected/.test(s.padFaults[0]), `one warning, one nib:fault, kept in pad.faults: ${JSON.stringify(warns.filter(w => /^Nib: /.test(w)))} ${JSON.stringify(s.padFaults)}`);
    ok(errors.length === 0, 'no page error: ' + errors.join(' | '));
    // not tried again while it is the same (more reads, a view, a stroke elsewhere)
    const calls = s.badCalls;
    await page.evaluate(() => { const P = document.getElementById('pad').pad; P.recognize(); P.recognize(); P.setOptions({ view: 'tidy' }); P.setOptions({ view: 'ink' }); window.mark = results; });
    await page.evaluate(D => { window.mark = results; writeWorld(document.getElementById('pad'), D); }, D);
    ok(await settled(), 'new writing elsewhere is read');
    s = await state();
    ok(s.badCalls === calls && s.parts.includes('8+1=') && s.answers.includes('9'), `the bad piece is not tried again (${calls} → ${s.badCalls} tries) and the new writing is read and answered: ${JSON.stringify(s.parts)}`);
    ok(nWarn() === 1 && s.faults.length === 1, 'and nothing more is said');
    // the basics: erase, Undo, the state
    const n0 = s.n;
    await page.evaluate(() => { const el = document.getElementById('pad'), P = el.pad; P.setMode('erase'); const last = P.strokes[P.strokes.length - 1], q = P.toScreen(last[Math.floor(last.length / 2)]); ptr(el, 'down', 'mouse', 9, q[0] - 30, q[1]); for (let i = 1; i <= 12; i++) ptr(el, 'move', 'mouse', 9, q[0] - 30 + i * 5, q[1]); ptr(el, 'up', 'mouse', 9, q[0] + 30, q[1]); P.setMode('draw'); });
    s = await state();
    ok(s.n < n0, `erasing works (${n0} → ${s.n} strokes)`);
    await page.evaluate(() => document.getElementById('pad').pad.undo());
    s = await state();
    ok(s.n === n0, 'Undo puts it back');
    const st = await page.evaluate(() => { const P = document.getElementById('pad').pad, g = P.getState(); P.setState(g); return { saved: g.strokes.length, back: P.strokes.length }; });
    ok(st.saved === n0 && st.back === n0, `getState / setState keep every stroke (${st.saved}, ${st.back})`);
    // taking the bad ink away brings a normal reading
    await put([A, B, C, D], -1);
    ok(await settled(), 'with nothing that cannot be read on it');
    s = await state();
    ok(['2+3=', '7-4=', '5+1=', '8+1='].every(t => s.parts.includes(t)) && s.answers.length === 4, 'every piece is read and answered again: ' + JSON.stringify(s.parts) + ' ' + JSON.stringify(s.answers));

    // ------------------------------------------------------------ 2. malformed: a reading, a view, an item, an element
    console.log('a malformed reading, a view that cannot be laid out, a thing that cannot be drawn');
    await page.evaluate(() => { window.mode = 'malformed'; });
    await put([A, B, C], 1);
    ok(await settled(), 'a piece whose reading comes back malformed: the reading settles');
    s = await state();
    ok(s.parts.includes('2+3=') && s.parts.includes('5+1=') && s.parts.filter(p => p === '').length === 1 && s.answers.length === 2, 'it is left as ink, the rest read and answered: ' + JSON.stringify(s.parts));
    const em = await page.evaluate(() => {
      const el = document.getElementById('pad'), P = el.pad, out = {};
      let got = 0; const on = () => got++; el.addEventListener('nib:result', on);
      el.setAttribute('view', 'tidy');
      try { P._emit({ latex: 'x', text: 'x', symbols: [{ label: 'x', box: null, strokes: [0] }], lines: undefined, tree: [[{ k: 's', label: 'x', strokes: [0], box: null }]] }); out.emit = 'ok'; } catch (e) { out.emit = 'threw ' + e.message; }
      try { P.redraw(); out.paint = 'ok'; } catch (e) { out.paint = 'threw ' + e.message; }
      out.result = !!P.result && P.result.latex === 'x'; out.events = got; out.plan = P.plan;
      el.removeEventListener('nib:result', on);
      el.setAttribute('view', 'ink');
      return out;
    });
    ok(em.emit === 'ok' && em.paint === 'ok' && em.result && em.events === 1, `_emit of a malformed reading does not throw, keeps it and announces it, and the board is drawn (${em.emit}, ${em.paint}, ${em.events} event)`);
    // one planned item and one element that throw while they are drawn: the rest is drawn, the canvas is sound after
    await page.evaluate(() => { window.mode = 'throw'; });
    await put([A, C], -1);
    ok(await settled(), 'plain writing again');
    const pt = await page.evaluate(nA => {
      const el = document.getElementById('pad'), P = el.pad, ctx = P.ctx, d = P.dpr || 1;
      // a text box whose text cannot be turned into a string the second time it is asked (after the drawing has saved
      // the canvas and set its font), and a planned item with nothing in it
      let n = 0; const text = { toString() { if (++n % 2 === 0) throw new Error('injected: this text cannot be drawn'); return 'ab'; } };
      P.addElement([[300, 300], [400, 340]], { tool: 'text', text, size: 32 });
      P.plan = { style: 'tidy', items: [{ label: 'x', from: [P.strokes[0]], parts: null, box: [0, 0, 10, 10], id: 'bad' }], chips: [] };
      // count what is saved and restored while the board is drawn
      let depth = 0, most = 0; const sv = ctx.save, rs = ctx.restore;
      ctx.save = function () { depth++; most = Math.max(most, depth); return sv.call(this); };
      ctx.restore = function () { depth = Math.max(0, depth - 1); return rs.call(this); };
      let threw = null; try { P.redraw(); } catch (e) { threw = e.message; }
      delete ctx.save; delete ctx.restore;
      const T = ctx.getTransform(), z = P.cam.z;
      // a stroke drawn after both: its ink is there (one of C's strokes, in the middle of it)
      const s = P.strokes[nA], q = P.toScreen(s[Math.floor(s.length / 2)]);
      const px = ctx.getImageData(Math.round(q[0] * d) - 3, Math.round(q[1] * d) - 3, 7, 7).data;
      let ink = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 100) ink++;
      P.plan = null; P.redraw();
      return { threw, depth, most, transform: [T.a, T.d, T.e, T.f].map(v => Math.round(v * 1000) / 1000), want: [d * z, d * z, -P.cam.x * d * z, -P.cam.y * d * z].map(v => Math.round(v * 1000) / 1000), ink, faults: (P.faults || []).map(f => f.where) };
    }, A.length).catch(e => ({ threw: 'evaluate: ' + e.message }));
    ok(pt.threw === null, 'drawing the board does not throw' + (pt.threw ? ': ' + pt.threw : ''));
    ok(pt.depth === 0 && JSON.stringify(pt.transform) === JSON.stringify(pt.want), `after it the canvas has nothing left saved (${pt.depth}) and the board's transform (${JSON.stringify(pt.transform)})`);
    ok(pt.ink > 0, `the writing drawn after them is drawn (${pt.ink} inked pixels under a stroke)`);
    ok(pt.faults && pt.faults.filter(w => w === 'paint').length >= 1, 'said as a paint fault: ' + JSON.stringify(pt.faults));
    ok(errors.length === 0, 'no page error: ' + errors.join(' | '));

    // ------------------------------------------------------------ one expression (no separate)
    console.log('one expression (a pad without separate)');
    const one = await page.evaluate(async (A, D) => {
      const el = document.createElement('nib-pad'); el.id = 'one'; el.setAttribute('delay', '60'); el.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:300px';
      document.body.appendChild(el);
      const P = el.pad, sleep = t => new Promise(r => setTimeout(r, t));
      let evs = 0, fl = 0; el.addEventListener('nib:result', () => evs++); el.addEventListener('nib:fault', () => fl++);
      P.setStrokes(A); for (const s of P.strokes) bad.add(s);
      const calls0 = badCalls;
      await sleep(700);
      const r1 = { latex: P.result && P.result.latex, evs, fl, tries: badCalls - calls0 };
      P.recognize(); P.setOptions({ view: 'tidy' }); P.setOptions({ view: 'ink' }); await sleep(300);
      const r2 = { tries: badCalls - calls0, fl };
      P.setStrokes(D); await sleep(700);
      const r3 = { latex: P.result && P.result.latex };
      el.remove();
      return { r1, r2, r3 };
    }, A, D);
    ok(one.r1.latex === '' && one.r1.evs >= 1 && one.r1.fl === 1, `a read that throws gives an empty reading, announced (${one.r1.evs} nib:result, ${one.r1.fl} nib:fault)`);
    ok(one.r2.tries === one.r1.tries && one.r2.fl === 1, `and is not tried again for the same ink (${one.r1.tries} → ${one.r2.tries} tries)`);
    ok(flat(one.r3.latex) === '8+1=', 'other ink reads: ' + one.r3.latex);

    // ------------------------------------------------------------ 3. symbols="…"
    console.log('symbols that names no set');
    const sy = await page.evaluate(async A => {
      const out = [];
      for (const v of ['typo', '__proto__', 'constructor']) {
        const el = document.createElement('nib-pad'); el.setAttribute('symbols', v); el.setAttribute('delay', '60'); el.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:300px';
        document.body.appendChild(el);
        let fl = 0; el.addEventListener('nib:fault', () => fl++);
        el.pad.setStrokes(A); await new Promise(r => setTimeout(r, 900));
        out.push({ v, latex: el.latex, symbols: el.pad.o.symbols, fl });
        el.remove();
      }
      const el = document.createElement('nib-pad'); el.setAttribute('delay', '60'); document.body.appendChild(el);
      el.pad.setStrokes(A); el.setAttribute('symbols', 'nope'); await new Promise(r => setTimeout(r, 900));
      out.push({ v: 'nope (set later)', latex: el.latex, symbols: el.pad.o.symbols });
      el.pad.setOptions({ symbols: 'numbers' }); out.push({ v: 'numbers', symbols: el.pad.o.symbols });
      el.remove();
      return out;
    }, A);
    for (const r of sy.slice(0, 4)) ok(flat(r.latex) === '2+3=' && r.symbols === 'school', `symbols="${r.v}": read with the school set (${r.latex})`);
    ok(sy[4].symbols === 'numbers', 'a set that exists is still taken');
    const symWarn = warns.filter(w => /unknown symbol set/.test(w));
    ok(symWarn.length === 4, `one warning for each (${symWarn.length}): ${symWarn[0]}`);
    ok(errors.length === 0, 'no page error: ' + errors.join(' | '));
    await page.close();
  }

  // ---------------------------------------------------------------- 4. the Board: a camera of 1e308; a file it cannot read
  console.log('the Board opened with a camera of 1e308');
  {
    const K = Nib.canvas, pk = A.map(s => K.pack(s, false));
    const seed = { 'nib-board-v3': JSON.stringify({ v: 3, page: 0, pages: [{ pk, fixes: [], revealed: [], types: [], paper: { kind: 'dots', tone: 'theme' }, cam: { x: 1e308, y: -1e308, z: 1e9 } }] }) };
    const { page, errors } = await open(BOARD, seed);
    await page.waitForFunction(() => document.getElementById('pad').pad, { timeout: 10000 });
    await wait(600);
    const cam = await page.evaluate(() => document.getElementById('pad').pad.getCamera());
    ok(Math.abs(cam.x) <= 1e9 && Math.abs(cam.y) <= 1e9 && cam.z <= 8 && errors.length === 0, `it opens, the camera held to the board (${JSON.stringify(cam)}), no error`);
    // write 8+1= where the camera is, with pointer events
    const n0 = await page.evaluate(() => document.getElementById('pad').pad.strokes.length);
    await page.evaluate(D => {
      const el = document.getElementById('pad'), P = el.pad, cv = el.querySelector('canvas'), r = cv.getBoundingClientRect(), v = P.viewRect;
      const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent('pointer' + type, { pointerId: 3, pointerType: 'mouse', clientX: r.left + x, clientY: r.top + y, button: type === 'down' ? 0 : -1, buttons: type === 'up' ? 0 : 1, isPrimary: true, bubbles: true, cancelable: true }));
      for (const s of D) {
        const q = s.map(p => P.toScreen([v[0] + (p[0] - 500) * 1, v[1] + (p[1] - 380) * 1]));
        ev('down', q[0][0], q[0][1]); for (let i = 1; i < q.length; i++) ev('move', q[i][0], q[i][1]); ev('up', q[q.length - 1][0], q[q.length - 1][1]);
      }
    }, D);
    const read = await page.waitForFunction(() => { const P = document.getElementById('pad').pad; return P.result && P.resultStrokes.length === P.ink.length && P.result.parts && P.result.parts.some(p => /8\s*\+\s*1\s*=/.test(p.result.latex)); }, { timeout: 15000 }).then(() => true, () => false);
    const n1 = await page.evaluate(() => document.getElementById('pad').pad.strokes.length);
    ok(n1 === n0 + D.length && read, `the writing there is read (${n0} → ${n1} strokes; 8+1= ${read ? 'read' : 'not read'})`);
    await wait(1500);
    const saved = await page.evaluate(() => { try { const d = JSON.parse(localStorage.getItem('nib-board-v3')); return d.pages[d.page].pk.length; } catch (e) { return -1; } });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('pad').pad, { timeout: 10000 });
    await wait(600);
    const n2 = await page.evaluate(() => document.getElementById('pad').pad.strokes.length);
    ok(saved === n1 && n2 === n1, `saved (${saved}) and back after a reload (${n2} of ${n1} strokes)`);
    ok(errors.length === 0, 'no page error: ' + errors.join(' | '));
    // a board file that cannot be read (gone, or not allowed): a note says so, nothing is thrown
    const note = await page.evaluate(async () => {
      Blob.prototype.text = () => Promise.reject(new DOMException('The file could not be read', 'NotReadableError'));
      const dt = new DataTransfer(); dt.items.add(new File(['{}'], 'lesson.nibboard.json', { type: 'application/json' }));
      document.getElementById('surface').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 300));
      return document.getElementById('note').hidden ? '' : document.getElementById('notetext').textContent;
    });
    ok(/could not be read/.test(note), `a board file that cannot be read says so: "${note}"`);
    await wait(200);
    ok(errors.length === 0, 'no page error (nor an unhandled rejection): ' + errors.join(' | '));
    await page.close();
  }

  // ---------------------------------------------------------------- 5. a 16,000-point stroke on the Board
  console.log('a very long stroke on the Board');
  {
    const { page, errors } = await open(BOARD, {});
    await page.waitForFunction(() => document.getElementById('pad').pad, { timeout: 10000 });
    await wait(800);
    const r = await page.evaluate(async () => {
      const c = document.querySelector('#pad canvas'), b = c.getBoundingClientRect(), n = 16000;
      const pts = []; for (let i = 0; i < n; i++) { const leg = Math.floor(i / 25), k = i % 25; pts.push([b.left + 200 + (leg % 2 ? 600 - k * 24 : k * 24), b.top + 150 + (leg * 0.9) % 500]); }
      const ev = (type, p) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: p[0], clientY: p[1], pressure: 0.5, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
      ev('pointerdown', pts[0]);
      for (let i = 1; i < n; i++) { ev('pointermove', pts[i]); if (i % 400 === 0) await new Promise(r => requestAnimationFrame(r)); }
      window.__gap = 0; await new Promise(r => requestAnimationFrame(r));
      const t1 = performance.now(); ev('pointerup', pts[n - 1]); const up = performance.now() - t1;
      await new Promise(r => setTimeout(r, 1500));
      const P = document.getElementById('pad').pad;
      return { up: Math.round(up), gap: Math.round(window.__gap), kept: P.strokes.length, pts: P.strokes[0] ? P.strokes[0].length : 0 };
    });
    // (1.6.6: the pen lift itself took 1,350 ms on this machine; the bound leaves room for a slow CI machine)
    ok(r.up < 150, `the pen lift takes ${r.up} ms (under 150)`);
    ok(r.gap < 600, `the longest stuck frame in the 1.5 s after it: ${r.gap} ms (under 600, the reading of the stroke included)`);
    ok(r.kept === 1 && r.pts >= 15000, `the stroke is kept as ink (${r.kept} element of ${r.pts} points)`);
    ok(errors.length === 0, 'no page error: ' + errors.join(' | '));
    await page.close();
  }

  // ---------------------------------------------------------------- 6. the Replicator
  console.log('the Replicator with letters saved far outside their boxes');
  {
    const far = k => [[[-0.5 * k, -0.5 * k], [0.9, k], [k, 0.03]], [[0.2, 0.2], [k, -k]]];
    const glyphs = {}; for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') glyphs[ch] = far(25);
    const seed = { 'replicator-v1': JSON.stringify({ v: 2, name: 'Far', weight: 80, spacing: 50, smoothing: 5, tidy: true, even: true, glyphs, samples: { a: [far(30)] } }) };
    const t0 = Date.now();
    const { page, errors } = await open(REPLICATOR, seed);
    const built = await page.waitForFunction(() => /^\d+ of/.test(document.getElementById('status').textContent), { timeout: 20000 }).then(() => true, () => false);
    const alive = await Promise.race([page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(true)))), wait(5000).then(() => false)]);
    ok(built && alive, `it opens and builds its font (${((Date.now() - t0) / 1000).toFixed(1)} s): "${await page.$eval('#status', e => e.textContent).catch(() => '?')}"`);
    // a stroke started in a box and dragged far across the screen
    const box = await (await page.$('.box canvas')).boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5); await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * (0.5 + i * 0.5), box.y + box.height * (0.5 + i * 0.3));
    await page.mouse.up();
    await wait(400);
    const st = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('replicator-v1') || '{}'); const ch = document.querySelector('.box .ch').textContent, s = d.glyphs[ch]; const last = s[s.length - 1]; return { ch, last, max: Math.max(...last.map(p => Math.max(p[0], p[1]))) }; });
    ok(st.max <= 2 && st.max >= 1.9, `a stroke dragged ten boxes out of "${st.ch}" is kept to it and a box around it (reaches ${st.max})`);
    // (saved again with that stroke: what was opened is saved as it was taken in)
    const held = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('replicator-v1') || '{}'); const all = [].concat(...Object.values(d.glyphs || {}).map(st => [].concat(...st)), ...Object.values(d.samples || {}).map(l => [].concat(...l.map(st => [].concat(...st))))); return { n: all.length, out: all.filter(p => p[0] < -1 || p[0] > 2 || p[1] < -1 || p[1] > 2).length }; });
    ok(held.n > 100 && held.out === 0, `the letters opened from storage are held to the box and a box around it (${held.out} of ${held.n} points outside)`);
    ok(errors.length === 0, 'no page error: ' + errors.join(' | '));
    await page.close();
  }

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
