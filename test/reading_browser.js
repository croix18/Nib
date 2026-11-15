// The board's read (1.7.0) in a real browser (the node side is test/reading_check.js):
//   1. the read of a board is one run of steps, each classifying at most one group of strokes: every group, and every
//      group joinOperands puts together, is warmed before it is read, so the step that returns the reading
//      classifies nothing (until 1.7.0 the joined groups were read cold at the end, with the page held); what is
//      read is what a cold read of the same page gives
//   2. a read put off by a touch that wrote nothing — an eraser that met no ink, the laser, two fingers moving the
//      board — starts again when the pointers are up (until 1.7.0 it waited for the next change); pad.busy says a
//      reading is due
//   2b. what changes under a read spread over slices: a stroke rubbed out by an eraser that was already down (the
//      reading announced is of the ink as it is), options set on a pad that no longer reads by itself (the reading,
//      and what the read kept, are of the new options), a read put off and then nothing to read by itself (not due)
//   3. a scripted session on a board (a page loaded, an expression written stroke by stroke, Undo and Redo, a piece
//      moved, deleted, copied, a symbol corrected, options and views changed, the board put away and taken out, saved
//      and opened): what the pad reads, answers and lays out after every step is what Nib 1.6.7 read, answered and
//      laid out — a fingerprint of the session, taken with the 1.6.7 engine before the read was made of steps
//   4. (1.7.1) a page gets every join, not eight: fourteen expressions each written with a gap after a sign are
//      joined wherever the rule joins, read at once and in slices alike; on a page of hundreds of pieces the rounds are counted out
//      (JOIN_WORK), and the read ends. Ink that is moved is read where it is: a stroke nudged away from the rest of
//      its symbol, put back by Undo, moved again by Redo, moved by a host (syncStrokes) — on a board and on a pad of
//      one expression, the reading a new recognizer gives; a whole piece nudged is not classified again
//   node test/reading_browser.js            (--record: only the session, and print its fingerprint)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const puppeteer = require(require('./data').npm('puppeteer-core'));
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (c) passes++; else fails++; };
const RECORD = process.argv.includes('--record');
const PAGE = 'file://' + path.join(__dirname, 'reading_page.html');
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
// the session's fingerprint with Nib 1.6.7 (sha256 of its steps; see section 3)
const SESSION_167 = '4c6af2248bb323a63416b1651e38c245f6614fe05796bfafdb05350428fee557';

// expressions of one line with a sign inside: cut after the sign, the right part pushed 90 units away (a gap wider
// than the writing's own spaces, close enough for joinOperands)
const OPS = new Set(['+', '-', '\\times', '\\div', '=', '\\cdot']);
function spaced(count) {
  const out = [];
  for (const r of rows) {
    if (out.length >= count) break;
    const k = r.symbols.findIndex((sy, i) => i > 0 && i < r.symbols.length - 1 && OPS.has(sy.label));
    if (k < 0 || r.symbols.length > 7 || /frac|sqrt|\^|_|\\\\/.test(r.latex)) continue;
    const right = new Set([].concat(...r.symbols.slice(k + 1).map(sy => sy.strokes)));
    out.push(r.strokes.map((s, i) => s.map(p => [p[0] + (right.has(i) ? 90 : 0), p[1]])));
  }
  return out;
}
// expressions set out on a page, four to a row
function pageOf(list) {
  const out = [];
  list.forEach((st, i) => {
    let x0 = Infinity, y0 = Infinity;
    for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); }
    for (const s of st) out.push(s.map(p => [Math.round(((p[0] - x0) * 0.7 + 60 + (i % 4) * 900) * 10) / 10, Math.round(((p[1] - y0) * 0.7 + 200 + Math.floor(i / 4) * 260) * 10) / 10]));
  });
  return out;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-reading-'));
  const browser = await puppeteer.launch({ executablePath: require('./data').needChrome(), headless: true, userDataDir: dir, protocolTimeout: 0, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const open = async () => {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(PAGE, { waitUntil: 'load' });
    return { page, errors };
  };

  // ---------------------------------------------------------------- 1. the read as steps
  if (!RECORD) {
    const { page, errors } = await open();
    const strokes = pageOf([...spaced(5), ...rows.slice(40, 47).map(r => r.strokes)]);
    const r = await page.evaluate(async strokes => {
      const mk = () => { const el = window.makePad({ separate: '', times: 'false', solve: '', infinite: '', auto: 'false' }); return el.pad; };
      const sig = res => res.latex + ' | ' + res.symbols.map(s => s.label + ':' + s.strokes.join('.')).join(' ') + ' | ' + res.parts.map(p => p.idx.join('.')).join(' / ');
      // how many groups of strokes the pad's recognizers have classified so far
      const classified = P => { const seen = new Set(); let n = 0; for (const s of P.strokes) { const rec = P.recs.get(s); if (rec && !seen.has(rec)) { seen.add(rec); n += rec.classified || 0; } } return n; };
      let P = mk(); P.setState({ strokes });
      const clusters = Nib._internals.clustersOf(P.ink).length;
      const it = P._partsSteps(P._ropts());
      let steps = 0, most = 0, total = 0, lastStep = 0, res = null;
      for (;;) {
        const before = classified(P), x = it.next(), d = classified(P) - before;
        steps++; total += d; if (d > most) most = d;
        if (x.done) { res = x.value; lastStep = d; break; }
      }
      const out = { clusters, parts: res.parts.length, steps, most, total, lastStep, stepped: sig(res) };
      // the same page read at once on a pad that has seen nothing, and read cold (no warm-up at all: each group as the
      // recognizer reads it, joined as the pad joins)
      P = mk(); P.setState({ strokes });
      out.atOnce = sig(P.recognize());
      P = mk(); P.setState({ strokes });
      const ink = P.ink, I = Nib._internals;
      const read = groups => groups.map(g => { const st = g.map(i => ink[i]); return { idx: g, strokes: st, result: new Nib.Recognizer().recognize(st, Object.assign(P._ropts(), { fix: [] })) }; });
      let parts = read(I.clustersOf(ink));
      for (let k = 0; k < 8; k++) { const j = I.joinOperands(parts); if (!j) break; parts = read(j); }
      out.cold = parts.map(p => p.result.latex).join(' ; ');
      out.steppedLatex = res.parts.map(p => p.result.latex).join(' ; ');
      return out;
    }, strokes);
    ok(r.clusters > r.parts && r.parts >= 12, `a page of 12 expressions, 5 written with a gap after a sign: ${r.clusters} groups of strokes, ${r.parts} pieces once joined`);
    ok(r.total > 100 && r.most === 1, `the read is ${r.steps} steps, ${r.total} groups classified, never more than one in a step (most: ${r.most})`);
    ok(r.lastStep === 0, `the step that returns the reading classifies nothing (${r.lastStep})`);
    ok(r.stepped === r.atOnce, 'read at once (recognize()), the page reads the same');
    ok(r.steppedLatex === r.cold, 'and the same as each piece read cold');
    ok(errors.length === 0, 'no page error: ' + errors.join(' | '));
    await page.close();
  }

  // ---------------------------------------------------------------- 2. a read put off by a touch
  if (!RECORD) {
    const { page, errors } = await open();
    const strokes = pageOf(rows.slice(40, 44).map(r => r.strokes));
    const r = await page.evaluate(async strokes => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const el = window.makePad({ separate: '', times: 'false', solve: '', infinite: '', delay: '700' }), P = el.pad, c = el.querySelector('canvas') || el.shadowRoot.querySelector('canvas'), b = c.getBoundingClientRect();
      const ev = (type, id, ptype, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: ptype, isPrimary: id < 20, clientX: b.left + x, clientY: b.top + y, pressure: 0.5, width: 1, height: 1, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
      const done = () => { const ink = P.ink, rs = P.resultStrokes || []; return !!P.result && rs.length === ink.length && rs.every((s, k) => s === ink[k]); };
      const until = async ms => { const t = performance.now(); while (performance.now() - t < ms) { if (done() && !P.busy) return Math.round(performance.now() - t); await sleep(20); } return -1; };
      const out = {};
      P.setState({ strokes });
      out.loaded = await until(20000);
      // a stroke written: the read waits 700 ms for the pen to rest; before it starts, a touch that writes nothing
      const write = async () => { ev('pointerdown', 1, 'pen', 300, 60); for (let k = 1; k <= 8; k++) ev('pointermove', 1, 'pen', 300, 60 + 6 * k); ev('pointerup', 1, 'pen', 300, 108); await sleep(60); };
      const n0 = P.ink.length;
      await write();
      out.wrote = P.ink.length - n0; out.busyAfterStroke = P.busy; out.doneAfterStroke = done();
      // an eraser that meets no ink
      P.setMode('erase'); ev('pointerdown', 2, 'pen', 1200, 800); ev('pointermove', 2, 'pen', 1210, 805); ev('pointerup', 2, 'pen', 1210, 805); P.setMode('draw');
      out.busyAfterEraser = P.busy; out.inkAfterEraser = P.ink.length - n0;
      out.eraser = await until(6000);
      // the laser
      await write();
      P.setMode('laser'); ev('pointerdown', 3, 'pen', 1000, 700); ev('pointermove', 3, 'pen', 1100, 720); ev('pointerup', 3, 'pen', 1100, 720); P.setMode('draw');
      out.laser = await until(6000);
      out.faults = P.faults.length;
      // two fingers put down together move the board (the first finger's stroke is taken back): on a board written
      // with a finger (a touch just after a pen is the hand, and is ignored)
      {
        const el2 = window.makePad({ separate: '', times: 'false', solve: '', infinite: '', delay: '700' }), Q = el2.pad, c2 = el2.querySelector('canvas') || el2.shadowRoot.querySelector('canvas'), b2 = c2.getBoundingClientRect();
        const ev2 = (type, id, x, y) => c2.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 21, clientX: b2.left + x, clientY: b2.top + y, pressure: 0.5, width: 1, height: 1, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
        const done2 = () => { const ink = Q.ink, rs = Q.resultStrokes || []; return !!Q.result && rs.length === ink.length && rs.every((s, k) => s === ink[k]); };
        Q.setState({ strokes });
        for (let t = performance.now(); performance.now() - t < 20000 && !(done2() && !Q.busy);) await sleep(20);
        const m0 = Q.ink.length;
        ev2('pointerdown', 21, 300, 60); for (let k = 1; k <= 8; k++) ev2('pointermove', 21, 300, 60 + 6 * k); ev2('pointerup', 21, 300, 108);
        await sleep(450);                                   // (two fingers are a gesture when they come down together: not right after the stroke)
        out.fingerWrote = Q.ink.length - m0; out.busyBeforeFingers = Q.busy;
        const cam0 = Q.getCamera();
        ev2('pointerdown', 21, 600, 500); ev2('pointerdown', 22, 680, 520);
        for (let k = 1; k <= 6; k++) { ev2('pointermove', 21, 600 + 10 * k, 500 + 8 * k); ev2('pointermove', 22, 680 + 10 * k, 520 + 8 * k); }
        ev2('pointerup', 21, 660, 548); ev2('pointerup', 22, 740, 568);
        const cam1 = Q.getCamera();
        out.moved = cam0.x !== cam1.x || cam0.y !== cam1.y; out.inkAfterFingers = Q.ink.length - m0; out.busyAfterFingers = Q.busy;
        const t = performance.now(); out.fingers = -1;
        while (performance.now() - t < 6000) { if (done2() && !Q.busy) { out.fingers = Math.round(performance.now() - t); break; } await sleep(20); }
        out.faults += Q.faults.length;
      }
      return out;
    }, strokes);
    ok(r.loaded >= 0, `four expressions opened and read (${r.loaded} ms)`);
    ok(r.wrote === 1 && r.busyAfterStroke === true && r.doneAfterStroke === false, `a stroke written: a reading is due (pad.busy ${r.busyAfterStroke})`);
    ok(r.inkAfterEraser === 1 && r.busyAfterEraser === true && r.eraser >= 0, `an eraser that met no ink before the read began: the page is read all the same (${r.eraser} ms)`);
    ok(r.laser >= 0, `the laser: read all the same (${r.laser} ms)`);
    ok(r.fingerWrote === 1 && r.busyBeforeFingers === true && r.moved && r.inkAfterFingers === 1 && r.busyAfterFingers === true && r.fingers >= 0, `two fingers that moved the board before the read began: read all the same (${r.fingers} ms)`);
    ok(r.faults === 0 && errors.length === 0, 'no fault, no page error: ' + errors.join(' | '));
    await page.close();
  }

  // ---------------------------------------------------------------- 2b. what changes under a read
  if (!RECORD) {
    const { page, errors } = await open();
    // "9x8=72"-like rows: with times off the cross is a letter, with times on a times sign
    const cross = rows.filter(r => /^\d+\\times ?\d+/.test(r.latex) && !/frac|sqrt|\^|\\\\/.test(r.latex)).slice(0, 4).map(r => r.strokes);
    const strokes = pageOf([...cross, ...rows.slice(40, 48).map(r => r.strokes)]);
    const r = await page.evaluate(async strokes => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const mk = attrs => { const el = window.makePad(Object.assign({ separate: '', times: 'false', solve: '', infinite: '' }, attrs)); return el; };
      const until = async (P, ms) => { const t = performance.now(); while (performance.now() - t < ms) { if (!P.busy) return true; await sleep(15); } return false; };
      const out = {};
      // --- ink rubbed out under the read by a pen that was already down
      {
        const el = mk({ delay: '0' }), P = el.pad, c = el.querySelector('canvas') || el.shadowRoot.querySelector('canvas'), b = c.getBoundingClientRect();
        const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: 31, pointerType: 'pen', isPrimary: true, clientX: b.left + x, clientY: b.top + y, pressure: 0.5, width: 1, height: 1, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
        P.setState({ strokes });
        await until(P, 20000);
        const before = P.ink.length, victim = P.ink[P.ink.length - 3], at = P.toScreen(victim[Math.floor(victim.length / 2)]);
        P.setMode('erase'); ev('pointerdown', 1300, 850); P.setMode('draw');      // the eraser comes down on nothing, and stays down
        // a stroke is written (by code: another hand), and as its read begins the eraser moves onto a stroke
        const mark = P._inkMark; let moved = false;
        P._inkMark = function (ink) { const m = mark.call(this, ink); if (!moved) { moved = true; ev('pointermove', at[0], at[1]); ev('pointermove', at[0] + 1, at[1] + 1); } return m; };
        P.addElement([[300, 40], [300, 90]]);
        out.readDone = await until(P, 20000);
        P._inkMark = mark;
        const ink = P.ink, rs = P.resultStrokes || [], res = P.result;
        out.moved = moved; out.erased = before + 1 - ink.length; out.victimGone = !ink.includes(victim);
        out.sameInk = !!res && rs.length === ink.length && rs.every((s, k) => s === ink[k]);
        out.indices = !!res && res.symbols.every(sy => sy.strokes.every(i => i >= 0 && i < rs.length));
        out.partsOfInk = !!res && res.parts.every(p => p.strokes.every(st => ink.includes(st)));
        ev('pointerup', at[0] + 1, at[1] + 1);
        await until(P, 20000);
        // the same page, read at once on a pad that saw none of it
        const fresh = mk({ auto: 'false' }).pad; fresh.setState({ strokes: P.ink.map(st => st.map(q => [q[0], q[1]])) });
        out.sameAsFresh = fresh.recognize().latex === P.result.latex;
        out.faults = P.faults.length;
      }
      // --- the options changed under the read of a pad that no longer reads by itself
      {
        const el = mk({ delay: '0' }), P = el.pad;
        const mark = P._inkMark; let set = false;
        P._inkMark = function (ink) { const m = mark.call(this, ink); if (!set) { set = true; this.setOptions({ auto: false, times: true }); } return m; };
        P.setState({ strokes });
        out.optsDone = await until(P, 20000);
        P._inkMark = mark;
        const fresh = mk({ auto: 'false', times: 'true' }).pad; fresh.setState({ strokes });
        const want = fresh.recognize().latex;
        out.optsSet = set; out.times = (P.result ? P.result.latex : '').split('\\times').length - 1;
        out.optsSame = !!P.result && P.result.latex === want;
        out.optsKept = P.recognize().latex === want;               // and what the read kept is of the new options
      }
      // --- a read put off, then nothing left to read by itself: no reading is due
      {
        const el = mk({ delay: '700' }), P = el.pad, c = el.querySelector('canvas') || el.shadowRoot.querySelector('canvas'), b = c.getBoundingClientRect();
        const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: 41, pointerType: 'pen', isPrimary: true, clientX: b.left + x, clientY: b.top + y, pressure: 0.5, width: 1, height: 1, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
        ev('pointerdown', 300, 60); for (let k = 1; k <= 8; k++) ev('pointermove', 300, 60 + 6 * k); ev('pointerup', 300, 108);
        out.due = P.busy;
        P.setMode('erase'); ev('pointerdown', 1200, 800); P.setOptions({ auto: false }); out.dueWhileDown = P.busy; ev('pointerup', 1200, 800); P.setMode('draw');
        out.dueAfter = P.busy;
        P.setOptions({ auto: true }); out.dueAgain = P.busy;        // reading by itself again: what is unread is read
        out.readAgain = await until(P, 6000) && !!P.result && P.resultStrokes.length === P.ink.length;
      }
      return out;
    }, strokes);
    ok(r.readDone && r.moved && r.erased >= 1 && r.victimGone, `a stroke rubbed out under a read by an eraser that was already down (${r.erased} gone)`);
    ok(r.sameInk && r.indices && r.partsOfInk, 'the reading announced is of the ink as it is: its strokes, its symbols\' strokes, its pieces');
    ok(r.sameAsFresh && r.faults === 0, 'and reads as the same page read at once');
    ok(r.optsDone && r.optsSet && r.times >= 3 && r.optsSame, `options changed under the read of a pad that no longer reads by itself: the reading is of the new options (${r.times} times signs)`);
    ok(r.optsKept, 'and so is what the read kept');
    ok(r.due === true && r.dueWhileDown === true && r.dueAfter === false, `a read put off by a touch, and the pad told not to read by itself: no reading is due (busy ${r.due}, ${r.dueWhileDown}, ${r.dueAfter})`);
    ok(r.dueAgain === true && r.readAgain, 'told to read by itself again, it reads what is unread');
    ok(errors.length === 0, 'no page error: ' + errors.join(' | '));
    await page.close();
  }

  // ---------------------------------------------------------------- 3. the session
  {
    const { page, errors } = await open();
    const lines = await page.evaluate(async rows => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const el = window.makePad({ view: 'ink', settle: '0', delay: '30', separate: '', times: 'false', reveal: '', solve: '', infinite: '', paper: 'dots' }), P = el.pad;
      let seed = 1; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      const pick = a => a[Math.floor(rnd() * a.length)];
      let lastEmit = performance.now();
      el.addEventListener('nib:result', () => { lastEmit = performance.now(); });
      const settled = () => { const ink = P.ink, rs = P.resultStrokes || []; return !ink.length ? !P.result || !rs.length : !!P.result && rs.length === ink.length && rs.every((s, k) => s === ink[k]); };
      // at rest: no reading due (pad.busy; an engine without it: nothing announced for 0.7 s)
      const rest = async () => {
        const t = performance.now();
        for (;;) {
          await sleep(25);
          const now = performance.now();
          if (typeof P.busy === 'boolean' ? !P.busy && settled() : settled() && now - lastEmit > 700 && now - t > 700) { await sleep(40); if (typeof P.busy !== 'boolean' || (!P.busy && settled())) return; }
          if (now - t > 300000) throw new Error('the pad did not come to rest');
        }
      };
      const place = (k, col, row, gap) => {
        const r = rows[(k * 7 + 13) % rows.length]; let x0 = Infinity, y0 = Infinity, y1 = -Infinity;
        for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
        const st = r.strokes.map(s => s.map(p => [(p[0] - x0) * 0.7 + 60 + col * 900, (p[1] - y0) * 0.7 + 400 + row * 260]));
        if (gap && st.length > 3) {
          const bx = st.map(s => [Math.min(...s.map(p => p[0])), Math.max(...s.map(p => p[0]))]);
          const order = bx.map((b, i) => i).sort((a, b) => bx[a][0] - bx[b][0]);
          let cut = -1, best = -Infinity, reach = bx[order[0]][1];
          for (let q = 1; q < order.length; q++) { const g = bx[order[q]][0] - reach; if (g > best) { best = g; cut = q; } reach = Math.max(reach, bx[order[q]][1]); }
          const H = (y1 - y0) * 0.7, right = new Set(order.slice(cut));
          st.forEach((s, i) => { if (right.has(i)) for (const p of s) p[0] += 1.3 * H; });
        }
        return st;
      };
      // what the pad says of the page: the reading, its symbols and pieces, the answers, the view's items
      const digest = step => {
        const res = P.result, rs = P.resultStrokes || [], ink = P.ink, at = new Map(ink.map((s, i) => [s, i]));
        return JSON.stringify({ step, n: ink.length, latex: res ? res.latex : null, text: res ? res.text : null,
          syms: res ? res.symbols.map(s => s.label + ':' + s.strokes.map(i => at.get(rs[i])).join('.') + ':' + (s.candidates || []).slice(0, 3).map(c => c[0]).join('/')).join(' ') : null,
          parts: res && res.parts ? res.parts.map(p => p.idx.map(i => at.get(rs[i])).join('.') + '=' + (p.result ? p.result.latex : '')) : null,
          answers: (P.answers || []).map(a => [a.line, a.latex, a.kind, a.exact]), solved: P.solvedLatex(),
          plan: P.plan ? [P.plan.style, P.plan.items.map(it => [it.id, it.answer ? 1 : 0, it.hidden ? 1 : 0, it.revealKey || ''])] : null,
          faults: (P.faults || []).length });
      };
      const out = [];
      const mark = async name => { await rest(); out.push(digest(name)); };
      const EXPRS = 10;
      const all = []; for (let i = 0; i < EXPRS; i++) all.push(...place(i, i % 4, Math.floor(i / 4), i % 5 === 4));
      P.setState({ strokes: all });
      await mark('load');
      let next = EXPRS, opt = 0, cam = 0;
      const partsNow = () => (P.result && P.result.parts ? P.result.parts.filter(p => p.strokes.length) : []);
      const OPTIONS = [{ symbols: 'all' }, { view: 'tidy' }, { solve: false }, { solve: true }, { view: 'hand' }, { degrees: false }, { view: 'ink' }, { symbols: 'school' }, { degrees: true }];
      const CAMERA = [() => P.panBy(-300, -200), () => P.zoomAt(0.6, 700, 450), () => P.panBy(250, 300), () => P.zoomAt(1.5, 700, 450), () => P.fitContent()];
      // every kind of step, in a fixed order (the random numbers only choose which piece, which symbol, how far)
      const STEPS = ['write', 'move', 'undo', 'redo', 'correct', 'copy', 'options', 'write', 'delete', 'undo', 'camera', 'options', 'move', 'put away', 'options', 'correct',
        'write', 'reopen', 'camera', 'options', 'move', 'undo', 'redo', 'options', 'delete', 'options', 'camera', 'options', 'copy', 'options', 'options', 'reopen'];
      for (const kind of STEPS) {
        let name = kind;
        if (kind === 'write') {                             // an expression, a stroke at a time (now and then three at once)
          const st = place(next, next % 4, Math.floor(next / 4), next % 3 === 0); next++;
          for (let i = 0; i < st.length; i++) { P.addElement(st[i]); if (rnd() < 0.3 && i + 2 < st.length) { P.addElement(st[++i]); P.addElement(st[++i]); } await mark('write.' + i); }
          continue;
        } else if (kind === 'undo' || kind === 'redo') { const n = 1 + Math.floor(rnd() * 4); for (let i = 0; i < n; i++) P[kind](); name = kind + ' ' + n; }
        else if (kind === 'move' || kind === 'delete' || kind === 'copy') {
          const ps = partsNow(); if (!ps.length) continue;
          P.select(pick(ps).strokes);
          if (kind === 'move') P.nudgeSelection(Math.round((rnd() - 0.5) * 400), Math.round((rnd() - 0.5) * 200)); else if (kind === 'delete') P.deleteSelection(); else P.duplicateSelection();
          P.clearSelection();
        } else if (kind === 'correct') { const res = P.result; if (!res || !res.symbols.length) continue; const sy = pick(res.symbols), c = (sy.candidates || [])[1]; if (!c) continue; P.relabel(sy, c[0]); name = 'correct ' + sy.label + ' to ' + c[0]; }
        else if (kind === 'options') { const o = OPTIONS[opt++ % OPTIONS.length]; P.setOptions(o); name = 'options ' + JSON.stringify(o); }
        else if (kind === 'camera') CAMERA[cam++ % CAMERA.length]();
        else if (kind === 'put away') { const snap = P.snapshot(); P.clear(); await mark('clear'); P.restore(snap); name = 'taken out'; }
        else if (kind === 'reopen') { const st = P.getState(); P.setState(st); }
        await mark(name);
      }
      return out;
    }, rows);
    const print = crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
    const kinds = new Set(lines.map(l => JSON.parse(l).step.replace(/[ .].*/, '').replace('taken', 'put away')));
    if (RECORD) console.log(`session: ${lines.length} steps (${[...kinds].join(', ')}), fingerprint ${print}`);
    else {
      ok(lines.length >= 50 && ['load', 'write', 'move', 'undo', 'redo', 'correct', 'copy', 'options', 'delete', 'camera', 'clear', 'put away', 'reopen'].every(k => kinds.has(k)), `a session of ${lines.length} steps on a board (${[...kinds].join(', ')})`);
      ok(print === SESSION_167, `what the pad read, answered and laid out at every step is what Nib 1.6.7 did (${print.slice(0, 16)}…)`);
    }
    ok(errors.length === 0, 'no page error: ' + errors.join(' | '));
    await page.close();
  }

  // ---------------------------------------------------------------- 4. every join; ink moved (1.7.1)
  if (!RECORD) {
    const { page, errors } = await open();
    // a plus and a digit of the sample's handwriting, for a page of hundreds of pairs
    const src = rows.find(r => r.symbols.some(sy => sy.label === '+' && sy.strokes.length === 2) && r.symbols.some(sy => /^[0-9]$/.test(sy.label) && sy.strokes.length === 1));
    const plusOf = src.symbols.find(sy => sy.label === '+' && sy.strokes.length === 2).strokes.map(i => src.strokes[i]), digitOf = src.symbols.find(sy => /^[0-9]$/.test(sy.label) && sy.strokes.length === 1).strokes.map(i => src.strokes[i]);
    const r = await page.evaluate(async (ink, plusOf, digitOf) => {
      const I = Nib._internals, sleep = ms => new Promise(r => setTimeout(r, ms));
      const attrs = { view: 'ink', settle: '0', delay: '30', separate: '', times: 'false', solve: '' };
      const undone = P => { let n = 0, now = P.result.parts.map(p => ({ idx: p.idx, strokes: p.strokes, result: p.result }));
        for (; n < 600; n++) { const j = I.joinOperands(now); if (!j) break; const old = new Map(now.map(p => [p.idx, p])); now = j.map(g => old.get(g) || { idx: g, strokes: g.map(i => P.ink[i]), result: new Nib.Recognizer().recognize(g.map(i => P.ink[i]), P._ropts()) }); }
        return n; };
      const out = {};
      // (a) fourteen expressions, each with a gap after a sign: at once
      let el = window.makePad(Object.assign({ auto: 'false' }, attrs)), P = el.pad;
      P.setState({ strokes: ink });
      out.clusters = I.clustersOf(P.ink).length;
      const res = P.recognize();
      out.pieces = res.parts.length; out.undone = undone(P);
      out.cold = res.parts.every(p => new Nib.Recognizer().recognize(p.strokes, P._ropts()).latex === p.result.latex);
      const atOnce = res.parts.map(p => p.result.latex).join(' | ');
      // … and in slices, by a pad that reads by itself
      el = window.makePad(attrs); P = el.pad;
      const done = new Promise(res => el.addEventListener('nib:result', function on() { if (P.result && (P.resultStrokes || []).length === P.ink.length) { el.removeEventListener('nib:result', on); res(); } }));
      P.setState({ strokes: ink }); await done;
      out.sliced = P.result.parts.map(p => p.result.latex).join(' | ') === atOnce; out.slicedPieces = P.result.parts.length;
      // (b) 200 pairs of a plus and a digit a gap apart, far from each other: 400 pieces, each pair one join
      const box = st => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return [x0, y0, x1, y1]; };
      const pb = box(plusOf), db = box(digitOf), H = db[3] - db[1], many = [];
      for (let k = 0; k < 200; k++) {
        const ox = (k % 10) * (pb[2] - pb[0] + 14 * H), oy = Math.floor(k / 10) * 5 * H;
        for (const s of plusOf) many.push(s.map(p => [p[0] - pb[0] + ox, p[1] - (pb[1] + pb[3]) / 2 + oy]));
        for (const s of digitOf) many.push(s.map(p => [p[0] - db[0] + ox + (pb[2] - pb[0]) + 2 * H, p[1] - (db[1] + db[3]) / 2 + oy]));
      }
      el = window.makePad(Object.assign({ auto: 'false' }, attrs)); P = el.pad;
      P.setState({ strokes: many });
      out.manyClusters = I.clustersOf(P.ink).length;
      const t0 = performance.now(), big = P.recognize();
      out.manyMs = Math.round(performance.now() - t0); out.manyJoined = out.manyClusters - big.parts.length; out.manyUndone = undone(P);
      out.manyRounds = Math.max(8, Math.min(out.manyClusters, Math.floor(3e7 / (out.manyClusters * out.manyClusters))));

      // (c) ink moved: "2 + 3" with the plus a stem and a bar, on a board and on a pad of one expression
      const line = (x0, y0, x1, y1, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
      const pathOf = pts => pts.flatMap((p, i, a) => (i ? line(a[i - 1][0], a[i - 1][1], p[0], p[1], 6).slice(1) : [p]));
      const plus = () => [pathOf([[100, 110], [110, 100], [125, 100], [132, 110], [128, 125], [100, 150], [135, 150]]), line(190, 105, 190, 150, 12), line(168, 128, 212, 128, 12),
        pathOf([[250, 102], [275, 100], [262, 122], [278, 135], [270, 150], [250, 150]])];
      const fresh = P => new Nib.Recognizer().recognize(P.ink, P._ropts()).latex;
      out.moved = [];
      for (const board of [true, false]) {
        el = window.makePad(Object.assign({ auto: 'false' }, attrs)); if (!board) el.removeAttribute('separate');
        P = el.pad;
        if (!board) { el = window.makePad({ view: 'ink', settle: '0', delay: '30', auto: 'false', times: 'false' }); P = el.pad; }
        const seen = new Set(), orig = P._recFor; P._recFor = function (f) { const q = orig.call(this, f); seen.add(q); return q; };
        const classified = () => { let n = P.rec ? P.rec.classified || 0 : 0; for (const q of seen) n += q.classified || 0; return n; };
        P.setState({ strokes: plus() });
        const m = { board, first: P.recognize().latex };
        // the whole of it nudged: read again, nothing classified again
        let c0 = classified();
        P.select(P.ink.slice()); P.nudgeSelection(37, -12); P.clearSelection();
        m.whole = P.recognize().latex; m.wholeAgain = classified() - c0;
        // the bar alone, down: read as a new recognizer reads it; Undo; Redo
        const bar = P.ink[2];
        P.select([bar]); P.nudgeSelection(0, 40); P.clearSelection();
        m.down = P.recognize().latex; m.downFresh = fresh(P);
        P.undo(); m.undo = P.recognize().latex; m.undoFresh = fresh(P);
        P.redo(); m.redo = P.recognize().latex; m.redoFresh = fresh(P);
        P.undo(); m.back = P.recognize().latex;
        out.moved.push(m);
      }
      // (d) a host's own strokes: one of them handed again as another array, moved
      el = window.makePad({ view: 'ink', settle: '0', delay: '30', auto: 'false', times: 'false' }); P = el.pad;
      const host = plus();
      P.syncStrokes(host); out.hostFirst = P.recognize().latex;
      const movedBar = host[2].map(p => [p[0], p[1] + 40]);
      P.syncStrokes([host[0], host[1], movedBar, host[3]], [[movedBar, host[2]]]);
      out.hostMoved = P.recognize().latex; out.hostFresh = fresh(P); out.hostSame = P.ink.length === 4;
      await sleep(50);
      return out;
    }, pageOf(spaced(14)), plusOf, digitOf);
    ok(r.clusters === 28 && r.clusters - r.pieces > 8 && r.undone === 0, `fourteen expressions written with a gap after a sign: ${r.clusters} pieces as they stand, ${r.pieces} once joined (${r.clusters - r.pieces} joins, more than the eight a page had until 1.7.1; ${r.undone} left undone)`);
    ok(r.cold, 'each is read as a new recognizer reads its strokes');
    ok(r.sliced && r.slicedPieces === r.pieces, `and the read in slices comes to the same ${r.pieces}`);
    ok(r.manyClusters === 400 && r.manyRounds === 187 && r.manyJoined === 187 && r.manyUndone === 13, `200 pairs a gap apart, 400 pieces: the rounds are counted out at ${r.manyRounds} — ${r.manyJoined} joined, ${r.manyUndone} left (${r.manyMs} ms)`);
    for (const m of r.moved) {
      const what = m.board ? 'a board' : 'a pad of one expression';
      ok(m.first === '2+3' && m.whole === '2+3' && m.wholeAgain === 0, `${what}: "${m.first}" nudged as a whole reads "${m.whole}", ${m.wholeAgain} groups classified again`);
      ok(m.down === m.downFresh && m.down !== '2+3', `${what}: the bar of the plus nudged down reads "${m.down}", as a new recognizer reads it ("${m.downFresh}")`);
      ok(m.undo === '2+3' && m.undoFresh === '2+3' && m.redo === m.redoFresh && m.redo === m.down && m.back === '2+3', `${what}: Undo "${m.undo}", Redo "${m.redo}", Undo "${m.back}"`);
    }
    ok(r.hostFirst === '2+3' && r.hostSame && r.hostMoved === r.hostFresh && r.hostMoved !== '2+3', `a host's stroke handed again where it was moved to (syncStrokes): "${r.hostMoved}", as new ("${r.hostFresh}")`);
    ok(errors.length === 0, 'no page error: ' + errors.join(' | '));
    await page.close();
  }

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
