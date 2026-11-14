// An answer keeps the look it was first drawn with (1.6.5, Croix: "I do not like when you retroactively change the font in
// answers you already put up. I like that nib adapts as I go, but I don't like it to constantly update the previous
// answers."): an answer's symbols come from the board's own writing, and when the board learns a better one, only the
// answers that come after show it. The look is saved with the board (getState / setState) and comes back with it; a
// changed answer, or another view, is drawn anew.
//   node test/looks_browser.js
'use strict';
const path = require('path');
const puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core'));
const Nib = require(path.join(__dirname, '..', 'dist', 'nib.js'));
const { compose } = require('./compose.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const flat = t => String(t || '').replace(/\s/g, '');
// an expression from real writers' symbols that Nib reads as written, top left at (x, y), symbols about h tall
const written = (tex, x, y, h, want) => {
  for (let k = 0; k < 200; k++) {
    const e = compose(tex);
    if (flat(new Nib.Recognizer().recognize(e.strokes, { times: false }).latex) !== flat(tex)) continue;
    if (want && !want(e)) continue;
    const xs = e.strokes.flat().map(p => p[0]), ys = e.strokes.flat().map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), s = h / 50;
    return { strokes: e.strokes.map(st => st.map(p => [Math.round((x + (p[0] - x0) * s) * 10) / 10, Math.round((y + (p[1] - y0) * s) * 10) / 10])), symbols: e.symbols };
  }
  return null;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 1100, height: 720 });
  await page.goto('file://' + path.join(__dirname, 'scribble_page.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => window.Nib && document.getElementById('pad').pad);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* none */ } const el = document.getElementById('pad'); el.setAttribute('scribble', 'false'); el.pad.setStrokes([]); });
  const write = strokes => page.evaluate(s => writeWorld(document.getElementById('pad'), s, 'pen'), strokes);
  // each answer on the board: its value and a signature of the ink each of its symbols is drawn with (rounded, so a
  // glyph is the same glyph wherever the answer sits)
  const answers = () => page.evaluate(() => {
    const P = document.getElementById('pad').pad, out = {};
    for (const it of (P.plan && P.plan.items) || []) {
      if (!it.answer) continue;
      const paths = (it.parts || []).filter(pt => pt.paths).map(pt => pt.paths).flat(), b = it.box, w = Math.max(b[2] - b[0], b[3] - b[1], 1e-9);
      const sig = paths.map(p => p.map(q => Math.round((q[0] - b[0]) / w * 50) + ':' + Math.round((q[1] - b[1]) / w * 50)).join(' ')).join('/');
      if (!sig) continue;
      (out[it.revealKey] = out[it.revealKey] || []).push(it.label + '=' + sig);
    }
    return out;
  });
  const settledAnswers = async n => { try { await page.waitForFunction(n => { const P = document.getElementById('pad').pad; return P.plan && new Set(P.plan.items.filter(i => i.answer).map(i => i.revealKey)).size >= n && !P.anim; }, { timeout: 15000 }, n); } catch (e) { /* the check below says */ } await new Promise(r => setTimeout(r, 300)); return answers(); };

  console.log('an answer keeps its look');
  // 2 + 3 = : no 5 on the board yet, so its answer's 5 is the built-in one
  const A = written('2+3=', 120, 100, 60);
  ok(!!A, 'writing composed that reads 2+3=');
  await write(A.strokes);
  let a1 = await settledAnswers(1);
  const k1 = Object.keys(a1).find(k => /\|5$/.test(k));
  ok(!!k1, 'the answer 5 is there: ' + JSON.stringify(Object.keys(a1)));
  const look1 = k1 && a1[k1].join('|');
  // then the board gets a 5 of its own (5 + 1 =, with a clear 5), and another problem whose answer is 5 (4 + 1 =)
  const B = written('5+1=', 120, 260, 60), C = written('4+1=', 120, 420, 60);
  ok(!!B && !!C, 'writing composed that reads 5+1= and 4+1=');
  await write(B.strokes);
  await write(C.strokes);
  const a3 = await settledAnswers(3);
  const k3 = Object.keys(a3).find(k => k !== k1 && /\|5$/.test(k));
  ok(!!k3, 'the second answer 5 is there: ' + JSON.stringify(Object.keys(a3)));
  ok(k1 && a3[k1] && a3[k1].join('|') === look1, 'the first answer 5 keeps the look it was drawn with');
  ok(k3 && a3[k3].join('|') !== look1, 'the new answer 5 is drawn with the board\'s own 5 (Nib learned it): the answers that come after show what it learns');
  // the look is saved with the board and comes back with it (a reload, a page switch)
  const st = await page.evaluate(() => document.getElementById('pad').pad.getState());
  ok(Array.isArray(st.looks) && st.looks.length >= 3, 'the board\'s state keeps the answers\' looks: ' + (st.looks ? st.looks.length : 0));
  await page.evaluate(s => { const P = document.getElementById('pad').pad; P.setStrokes([]); P.setState(s); }, st);
  const a4 = await settledAnswers(3);
  const sigs = o => Object.values(o).map(v => v.join('|')).sort();
  ok(JSON.stringify(sigs(a4)) === JSON.stringify(sigs(a3)), 'put back, every answer has the look it had');
  // a look kept as points (not the board's strokes) comes back the same: the built-in glyph, and packed points
  const kinds = st.looks.map(L => Object.values(L.g).map(v => (v.s ? 's' : v.d ? 'd' : v.p ? 'p' : '?')).join('')).join(',');
  ok(/d/.test(kinds) && /s/.test(kinds), 'kept as the built-in glyph and as the board\'s strokes: ' + kinds);
  // another view draws anew; back in ink, the answers look as they did
  await page.evaluate(() => document.getElementById('pad').setAttribute('view', 'tidy'));
  await settledAnswers(3);
  await page.evaluate(() => document.getElementById('pad').setAttribute('view', 'ink'));
  const a5 = await settledAnswers(3);
  ok(JSON.stringify(sigs(a5)) === JSON.stringify(sigs(a3)), 'Tidy and back to Ink: the answers look as they did');

  // the Board: the looks are saved with the page and come back when the Board is opened again
  console.log('the Board, opened again');
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'Board.html'), { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* none */ } });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.Nib && document.getElementById('pad') && document.getElementById('pad').pad);
  const boardWrite = strokes => page.evaluate(list => {
    const el = document.getElementById('pad'), P = el.pad, cv = el.querySelector('canvas'), r = cv.getBoundingClientRect();
    const ev = (type, q) => cv.dispatchEvent(new PointerEvent('pointer' + type, { pointerId: 7, pointerType: 'mouse', clientX: r.left + q[0], clientY: r.top + q[1], bubbles: true, cancelable: true, isPrimary: true, button: type === 'down' ? 0 : -1, buttons: type === 'up' ? 0 : 1, width: 1, height: 1, pressure: 0.5 }));
    for (const s of list) { const q = s.map(p => P.toScreen(p)); ev('down', q[0]); for (let i = 1; i < q.length; i++) ev('move', q[i]); ev('up', q[q.length - 1]); }
  }, strokes);
  await boardWrite(A.strokes);
  await settledAnswers(1);
  await boardWrite(B.strokes); await boardWrite(C.strokes);
  const b3 = await settledAnswers(3);
  ok(Object.keys(b3).length === 3, 'the Board works out the three: ' + Object.keys(b3).length);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const kept = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('nib-board-v3')); const p = s.pages[s.page]; return Array.isArray(p.looks) ? p.looks.length : 0; });
  ok(kept >= 3, 'the Board saves the answers\' looks with the page: ' + kept);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.Nib && document.getElementById('pad') && document.getElementById('pad').pad);
  const b4 = await settledAnswers(3);
  ok(JSON.stringify(sigs(b4)) === JSON.stringify(sigs(b3)), 'opened again, every answer on the Board looks as it did');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
