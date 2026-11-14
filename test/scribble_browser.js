// Scribbled out, in a real browser: a pen scribbled back and forth over writing rubs out what it lies over, as one step
// of Undo, and is not kept; over clear paper it is ink; a highlighter never rubs out; scribble="false" turns it off;
// a ring, a strike-through, a cancel slash or a box over writing is ink; in a tidy view what it lies over is what the
// view shows; a shown answer under it goes back out of focus; a dot filled in on a number line stays; touch and mouse
// scribble too; what went fades; undoScribble only undoes its own step.
//   node test/scribble_browser.js
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core'));
const Nib = require(path.join(__dirname, '..', 'dist', 'nib.js'));
const { compose } = require('./compose.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const flat = t => String(t || '').replace(/\s/g, '');
// an expression from real writers' symbols that Nib reads as written: its strokes and symbols, top left at (x, y),
// symbols about h tall
const written = (tex, x, y, h) => {
  for (let k = 0; k < 120; k++) {
    const e = compose(tex);
    if (flat(new Nib.Recognizer().recognize(e.strokes, { times: false }).latex) !== flat(tex)) continue;
    const xs = e.strokes.flat().map(p => p[0]), ys = e.strokes.flat().map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), s = h / 50;
    const strokes = e.strokes.map(st => st.map(p => [Math.round((x + (p[0] - x0) * s) * 10) / 10, Math.round((y + (p[1] - y0) * s) * 10) / 10]));
    return { strokes, symbols: e.symbols };
  }
  return null;
};
const boxOf = list => { let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const s of list) for (const p of s) b = [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])]; return b; };
// a zig-zag over box b: legs left-right ('h') or up-down ('v'), past the box by `over` each way
const zig = (b, legs, dir = 'h', over = 6) => {
  const out = [];
  for (let k = 0; k <= legs; k++) {
    const t = k / legs, side = k % 2;
    const p = dir === 'h' ? [side ? b[2] + over : b[0] - over, b[1] - over + (b[3] - b[1] + 2 * over) * t] : [b[0] - over + (b[2] - b[0] + 2 * over) * t, side ? b[3] + over : b[1] - over];
    if (out.length) { const q = out[out.length - 1]; for (let i = 1; i <= 6; i++) out.push([q[0] + (p[0] - q[0]) * i / 6, q[1] + (p[1] - q[1]) * i / 6]); } else out.push(p);
  }
  return out;
};
const ring = (c, r, turns = 3) => Array.from({ length: Math.round(48 * turns) + 1 }, (_, k) => { const a = 2 * Math.PI * k / 48; const rr = r * (1 + 0.04 * Math.sin(3 * a)) + k * 0.05; return [c[0] + rr * Math.cos(a), c[1] + rr * 0.7 * Math.sin(a)]; });

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 1100, height: 720 });
  await page.goto('file://' + path.join(__dirname, 'scribble_page.html'), { waitUntil: 'load' });
  await page.waitForFunction(() => window.Nib && document.getElementById('pad').pad);
  const st = () => page.evaluate(() => { const P = document.getElementById('pad').pad; return { n: P.strokes.length, h: P.history.length, latex: document.getElementById('pad').latex || '' }; });
  const settled = async (re, ms = 8000) => { try { await page.waitForFunction(re => new RegExp(re).test((document.getElementById('pad').latex || '').replace(/\s/g, '')), { timeout: ms }, re); return true; } catch (e) { return false; } };
  const write = (strokes, kind = 'pen') => page.evaluate((s, kind) => writeWorld(document.getElementById('pad'), s, kind), strokes, kind);
  const reset = () => page.evaluate(() => { const el = document.getElementById('pad'); el.pad.setStrokes([]); el.removeAttribute('scribble'); el.setAttribute('view', 'ink'); window.scribbles = []; el.tool = { kind: 'pen' }; });

  // ---------------------------------------------------------------- 1. a scribble over the 3 of 2+3= rubs it out
  console.log('scribbled out');
  const E = written('2+3=', 200, 200, 60);
  ok(!!E, 'writing composed that reads 2+3=');
  await write(E.strokes);
  ok(await settled('^2\\+3='), 'the pad reads 2+3=: ' + (await st()).latex);
  const three = E.symbols.find(y => y.label === '3');
  const b3 = boxOf(three.strokes.map(i => E.strokes[i]));
  const before = await st();
  await write([zig(b3, 9, 'h', 8)]);
  let after = await st();
  ok(after.n === before.n - three.strokes.length, `the 3 is gone and the scribble is not kept (${before.n} strokes → ${after.n})`);
  ok(after.h === before.h + 1, 'one step of Undo');
  ok(await page.evaluate(() => !!document.getElementById('pad').pad._fade), 'what went fades away');
  const ev = await page.evaluate(() => scribbles.map(s => ({ erased: s.erased, hidden: s.hidden })));
  ok(ev.length === 1 && ev[0].erased === three.strokes.length, 'nib:scribble says what it took: ' + JSON.stringify(ev));
  ok(await settled('^2\\+=?$|^2\\+='), 'the reading follows: ' + (await st()).latex);
  await wait(450);
  ok(await page.evaluate(() => !document.getElementById('pad').pad._fade), '…and is gone in a moment');
  // Undo, Redo
  await page.evaluate(() => document.getElementById('pad').pad.undo());
  after = await st();
  ok(after.n === before.n, 'Undo brings the 3 back');
  ok(await settled('^2\\+3='), 'and it reads 2+3= again');
  const same = await page.evaluate(n => { const P = document.getElementById('pad').pad; return P.strokes.length === n; }, before.n);
  ok(same, 'every stroke is back');
  await page.evaluate(() => document.getElementById('pad').pad.redo());
  ok((await st()).n === before.n - three.strokes.length, 'Redo rubs it out again');
  await page.evaluate(() => document.getElementById('pad').pad.undo());
  // undoScribble undoes only its own step
  await write([zig(b3, 9, 'v', 8)]);
  const step = await page.evaluate(() => scribbles.length);
  ok((await st()).n === before.n - three.strokes.length, 'up-and-down legs rub out the 3 too');
  await write([[[600, 400], [640, 410]]]);
  ok(await page.evaluate(() => !document.getElementById('pad').pad.undoScribble(window.scribbles[window.scribbles.length - 1].step)), 'undoScribble does nothing once something else was written');
  await page.evaluate(() => document.getElementById('pad').pad.undo());
  ok(await page.evaluate(() => document.getElementById('pad').pad.undoScribble(window.scribbles[window.scribbles.length - 1].step)), 'undoScribble undoes the scribble when it is the last step');
  ok((await st()).n === before.n, '…and the 3 is back');
  void step;

  // ---------------------------------------------------------------- 2. what is ink, not a scribble-out
  console.log('ink, not a scribble');
  let n0 = (await st()).n;
  await write([zig([600, 150, 700, 210], 9, 'h', 6)]);
  ok((await st()).n === n0 + 1, 'a scribble over clear paper is ink');
  await page.evaluate(() => document.getElementById('pad').pad.undo());
  n0 = (await st()).n;
  const b2 = boxOf(E.symbols.find(y => y.label === '2').strokes.map(i => E.strokes[i]));
  const marks = {
    'a ring three times round the 2': [ring([(b2[0] + b2[2]) / 2, (b2[1] + b2[3]) / 2], 42, 3)],
    'a strike-through': [[[b3[0] - 10, (b3[1] + b3[3]) / 2], [b3[2] + 10, (b3[1] + b3[3]) / 2 + 3]]],
    'a cancel slash': [[[b3[0] - 6, b3[3] + 6], [b3[2] + 6, b3[1] - 6]]],
    'a box round the 3': [[[b3[0] - 10, b3[1] - 10], [b3[2] + 10, b3[1] - 10], [b3[2] + 10, b3[3] + 10], [b3[0] - 10, b3[3] + 10], [b3[0] - 10, b3[1] - 8]]],
    'a zig-zag under the 3': [zig([b3[0] - 4, b3[3] + 10, b3[2] + 4, b3[3] + 22], 12, 'v', 0)],
  };
  for (const [name, list] of Object.entries(marks)) {
    const a = await st();
    await write(list);
    const c = await st();
    ok(c.n === a.n + list.length && (await page.evaluate(() => scribbles.length)) === 2, name + ' is ink, nothing rubbed out');
    for (let k = 0; k < list.length; k++) await page.evaluate(() => document.getElementById('pad').pad.undo());
  }
  // the highlighter never rubs out; scribble="false" turns it off
  await page.evaluate(() => (document.getElementById('pad').tool = { kind: 'highlighter' }));
  n0 = (await st()).n;
  await write([zig(b3, 9, 'h', 8)]);
  ok((await st()).n === n0 + 1, 'a highlighter scribbled over the 3 is a highlighter stroke (shading), nothing rubbed out');
  await page.evaluate(() => { const P = document.getElementById('pad').pad; P.undo(); document.getElementById('pad').tool = { kind: 'pen' }; });
  await page.evaluate(() => document.getElementById('pad').setAttribute('scribble', 'false'));
  n0 = (await st()).n;
  await write([zig(b3, 9, 'h', 8)]);
  ok((await st()).n === n0 + 1, 'scribble="false": the scribble is ink');
  await page.evaluate(() => { const el = document.getElementById('pad'); el.pad.undo(); el.removeAttribute('scribble'); });
  // the marker scribbles out too
  await page.evaluate(() => (document.getElementById('pad').tool = { kind: 'marker' }));
  n0 = (await st()).n;
  await write([zig(b3, 9, 'h', 8)]);
  ok((await st()).n === n0 - three.strokes.length, 'the marker scribbles out too');
  await page.evaluate(() => { const P = document.getElementById('pad').pad; P.undo(); document.getElementById('pad').tool = { kind: 'pen' }; });

  // ---------------------------------------------------------------- 3. touch and mouse
  console.log('touch and mouse');
  // a finger after the pen (more than a second later, at a hand's speed: the palm rules let it write)
  await wait(1200);
  n0 = (await st()).n;
  await page.evaluate(s => writeSlow(document.getElementById('pad'), s, 'touch', 700), [zig(b3, 9, 'h', 8)]);
  ok((await st()).n === n0 - three.strokes.length, 'a finger: scribbled out');
  await page.evaluate(() => document.getElementById('pad').pad.undo());
  // a finger on a pad with no palm rules (Deckhand's), quick as you like
  await page.evaluate(() => document.getElementById('pad').setAttribute('palm', 'false'));
  n0 = (await st()).n;
  await write([zig(b3, 9, 'h', 8)], 'touch');
  ok((await st()).n === n0 - three.strokes.length, 'a finger, palm="false": scribbled out');
  await page.evaluate(() => { const el = document.getElementById('pad'); el.pad.undo(); el.removeAttribute('palm'); });
  n0 = (await st()).n;
  await write([zig(b3, 9, 'h', 8)], 'mouse');
  ok((await st()).n === n0 - three.strokes.length, 'the mouse: scribbled out');
  await page.evaluate(() => document.getElementById('pad').pad.undo());

  // ---------------------------------------------------------------- 3b. a scribble the board heard in pieces
  // (a pen that left the glass for a moment at a turn, a touch frame that lost a fast finger)
  console.log('a scribble in pieces');
  const slow = (pieces, gaps, kinds) => page.evaluate(async (pieces, gaps, kinds) => {
    const el = document.getElementById('pad'), sleep = t => new Promise(r => setTimeout(r, t));
    for (let i = 0; i < pieces.length; i++) {
      if (i) await sleep(gaps[i - 1]);
      if (kinds) el.tool = { kind: kinds[i] };
      await writeSlow(el, [pieces[i]], 'pen', 10 * pieces[i].length);
    }
    el.tool = { kind: 'pen' };
  }, pieces, gaps, kinds || null);
  await wait(300);
  const Z = zig(b3, 8, 'h', 8), A = Z.slice(0, 25), B = Z.slice(26);   // four legs each (a sample lost between them)
  n0 = (await st()).n;
  await slow([A], []);
  ok((await st()).n === n0 + 1, 'four legs on their own are ink');
  await page.evaluate(() => document.getElementById('pad').pad.undo());
  await wait(300);
  let h0 = (await st()).h;
  await slow([A, B], [40]);
  let s1 = await st();
  ok(s1.n === n0 - three.strokes.length, `heard as two strokes 40 ms apart: the 3 is gone and neither piece stays (${n0} → ${s1.n})`);
  ok(s1.h === h0 + 1, `one step of Undo (${h0} → ${s1.h})`);
  ok(await page.evaluate(() => scribbles[scribbles.length - 1].erased) === three.strokes.length, 'nib:scribble says what it took');
  await page.evaluate(() => document.getElementById('pad').pad.undo());
  s1 = await st();
  ok(s1.n === n0 && s1.h === h0, `Undo puts the board back as it was before the scribble began: the 3, and no piece (${s1.n}, ${s1.h})`);
  await wait(300);
  // three pieces of two legs (any two together are four legs: ink)
  const Z6 = zig(b3, 6, 'h', 8), C3 = [Z6.slice(0, 13), Z6.slice(13, 25), Z6.slice(25)];
  h0 = (await st()).h;
  await slow(C3, [30, 30]);
  s1 = await st();
  ok(s1.n === n0 - three.strokes.length && s1.h === h0 + 1, `heard as three strokes: the 3 is gone, nothing stays, one step (${s1.n}, ${s1.h - h0})`);
  await page.evaluate(() => document.getElementById('pad').pad.undo());
  await wait(300);
  // not one scribble: the second piece 400 ms later; the second piece in the marker
  await slow([A, B], [400]);
  ok((await st()).n === n0 + 2, 'pieces 400 ms apart are two strokes of ink');
  await page.evaluate(() => { const P = document.getElementById('pad').pad; P.undo(); P.undo(); });
  await wait(300);
  await slow([A, B], [40], ['pen', 'marker']);
  ok((await st()).n === n0 + 2, 'a pen piece and a marker piece are two strokes of ink');
  await page.evaluate(() => { const P = document.getElementById('pad').pad; P.undo(); P.undo(); });
  ok((await st()).n === n0, '(the board as it was)');

  // ---------------------------------------------------------------- 4. answers
  console.log('answers');
  await settled('^2\\+3=');
  await page.waitForFunction(() => { const P = document.getElementById('pad').pad; return P.plan && P.plan.items.some(it => it.answer); }, { timeout: 8000 }).catch(() => {});
  const ans = await page.evaluate(() => { const P = document.getElementById('pad').pad, it = P.plan && P.plan.items.find(q => q.answer); return it ? { box: it.box, key: it.revealKey, hidden: it.hidden } : null; });
  ok(ans && ans.hidden, 'the answer waits for a tap');
  if (ans) {
    await page.evaluate(k => document.getElementById('pad').pad.showAnswer(k), ans.key);
    ok(await page.evaluate(k => document.getElementById('pad').pad.revealed.has(k), ans.key), 'shown');
    n0 = (await st()).n;
    await write([zig(ans.box, 9, 'h', 6)]);
    ok(await page.evaluate(k => !document.getElementById('pad').pad.revealed.has(k), ans.key), 'a scribble over the shown answer puts it back out of focus');
    ok((await st()).n === n0, '…takes no writing, and is not kept');
    await page.evaluate(() => document.getElementById('pad').pad.undo());
    ok(await page.evaluate(k => document.getElementById('pad').pad.revealed.has(k), ans.key), 'Undo shows it again');
  }

  // ---------------------------------------------------------------- 5. a tidy view: what it shows
  console.log('a tidy view');
  await page.evaluate(() => document.getElementById('pad').setAttribute('view', 'tidy'));
  await page.waitForFunction(() => { const P = document.getElementById('pad').pad; return P.plan && P.plan.style === 'tidy' && P.plan.items.some(it => !it.answer && it.label === '3'); }, { timeout: 8000 }).catch(() => {});
  const t3 = await page.evaluate(() => { const P = document.getElementById('pad').pad, it = P.plan && P.plan.items.find(q => !q.answer && q.label === '3'); return it ? it.box : null; });
  ok(!!t3, 'the tidy view shows the 3');
  if (t3) {
    n0 = (await st()).n;
    await write([zig(t3, 9, 'h', 8)]);
    ok((await st()).n === n0 - three.strokes.length, 'a scribble over the tidy 3 rubs out its strokes');
    await page.evaluate(() => document.getElementById('pad').pad.undo());
  }
  await page.evaluate(() => document.getElementById('pad').setAttribute('view', 'ink'));

  // ---------------------------------------------------------------- 6. a dot filled in on a number line stays
  console.log('shading');
  await reset();
  const line = [[100, 500], [900, 500]];
  const ticks = Array.from({ length: 9 }, (_, k) => [[100 + 100 * k, 490], [100 + 100 * k, 510]]);
  const dot = Array.from({ length: 41 }, (_, k) => [400 + 12 * Math.cos(2 * Math.PI * k / 40), 500 + 12 * Math.sin(2 * Math.PI * k / 40)]);
  await write([line, ...ticks, dot]);
  n0 = (await st()).n;
  const fill = [];
  for (let k = 0; k <= 12; k++) { const y = 489 + 22 * k / 12, w = Math.sqrt(Math.max(0, 121 - (y - 500) * (y - 500))); fill.push(k % 2 ? [400 + w, y] : [400 - w, y]); }
  await write([fill]);
  ok((await st()).n === n0 + 1, 'a dot filled in on a number line: the fill is ink, the dot, the line and its ticks stay');

  // ---------------------------------------------------------------- 7. the Board: the note with Undo, and its switch
  console.log('the Board');
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'Board.html'), { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { /* none */ } });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.Nib && document.getElementById('pad') && document.getElementById('pad').pad);
  const bWrite = strokes => page.evaluate(list => {
    const el = document.getElementById('pad'), P = el.pad, cv = el.querySelector('canvas'), r = cv.getBoundingClientRect();
    const ev = (type, q) => cv.dispatchEvent(new PointerEvent('pointer' + type, { pointerId: 7, pointerType: 'pen', clientX: r.left + q[0], clientY: r.top + q[1], bubbles: true, cancelable: true, isPrimary: true, button: type === 'down' ? 0 : -1, buttons: type === 'up' ? 0 : 1, width: 1, height: 1, pressure: 0.5 }));
    for (const s of list) { const q = s.map(p => P.toScreen(p)); ev('down', q[0]); for (let i = 1; i < q.length; i++) ev('move', q[i]); ev('up', q[q.length - 1]); }
  }, strokes);
  const bst = () => page.evaluate(() => {
    const $ = id => document.getElementById(id), el = $('pad');
    return { n: el.pad.strokes.length, latex: (el.latex || '').replace(/\s/g, ''), note: $('note').hidden ? '' : $('notetext').textContent, act: $('noteact').hidden ? '' : $('noteact').textContent,
      sw: $('scribsw').getAttribute('aria-checked'), attr: el.getAttribute('scribble') };
  });
  const bRead = async re => { try { await page.waitForFunction(re => new RegExp(re).test((document.getElementById('pad').latex || '').replace(/\s/g, '')), { timeout: 8000 }, re); } catch (e) { /* the check says */ } return (await bst()).latex; };
  await bWrite(E.strokes);
  ok(/^2\+3=/.test(await bRead('^2\\+3=')), 'the Board reads 2+3=');
  const bn = (await bst()).n;
  await bWrite([zig(b3, 9, 'h', 8)]);
  let bs = await bst();
  ok(bs.n === bn - three.strokes.length, `a scribble over the 3 rubs it out on the Board (${bn} strokes → ${bs.n})`);
  ok(bs.note.indexOf('Scribbled out.') === 0 && bs.act === 'Undo', 'a note says so, with Undo: ' + JSON.stringify([bs.note, bs.act]));
  await page.evaluate(() => document.getElementById('noteact').click());
  bs = await bst();
  ok(bs.n === bn && !bs.note, 'the note\'s Undo brings the 3 back, and the note goes');
  ok(/^2\+3=/.test(await bRead('^2\\+3=')), '…and it reads 2+3= again');
  await bWrite([zig(b3, 9, 'h', 8)]);
  ok((await bst()).note.indexOf('Scribbled out.') === 0, 'scribbled out again: the note');
  await bWrite([[[620, 420], [660, 430]]]);
  bs = await bst();
  ok(!bs.note || bs.note.indexOf('Scribbled out.') !== 0, 'writing something else puts the note away (its Undo would undo the wrong thing)');
  await page.evaluate(() => { const P = document.getElementById('pad').pad; P.undo(); P.undo(); });
  ok((await bst()).n === bn, '(the board as it was)');
  // Settings, "Scribble over writing to rub it out": off, a scribble is ink; it stays off when the Board is opened again
  await page.evaluate(() => document.getElementById('scribsw').click());
  bs = await bst();
  ok(bs.sw === 'false' && bs.attr === 'false', 'the switch turns it off: ' + JSON.stringify([bs.sw, bs.attr]));
  await bWrite([zig(b3, 9, 'h', 8)]);
  bs = await bst();
  ok(bs.n === bn + 1 && bs.note.indexOf('Scribbled out.') !== 0, 'off, a scribble over the 3 is a stroke of ink, and the 3 stays');
  await page.evaluate(() => document.getElementById('pad').pad.undo());
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.Nib && document.getElementById('pad') && document.getElementById('pad').pad);
  bs = await bst();
  ok(bs.sw === 'false' && bs.attr === 'false' && bs.n === bn, 'opened again, it is still off (and the board is as it was): ' + JSON.stringify([bs.sw, bs.attr, bs.n]));
  await page.evaluate(() => document.getElementById('scribsw').click());
  bs = await bst();
  ok(bs.sw === 'true' && bs.attr === null, 'and the switch turns it back on');
  await bWrite([zig(b3, 9, 'h', 8)]);
  ok((await bst()).n === bn - three.strokes.length, 'on again, a scribble rubs the 3 out');

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
