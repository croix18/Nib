// Nib Board in a real browser: separate expressions read separately, every view, a Replicator file opened for
// "My hand", keyboard shortcuts, erase and undo in a view, copy, clear and undo, a reload that keeps the board, a
// crowded board on a 4x slower CPU, phone width and dark mode.
//   node test/board_browser.js [page=dist/Board.html]
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core'));
const D = process.env.NIB_DATA || path.join(__dirname, '..', 'training', 'scratch', 'data') + '/';
const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const byId = id => rows.find(r => r.id === id);
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

function makeHandFile() {
  const t = fs.readFileSync(D + 'test.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  const pool = {};
  for (const r of t) for (const s of r.symbols) (pool[s.label] = pool[s.label] || []).push(s.strokes.map(k => r.strokes[k]));
  const G = { cap: 0.2, x: 0.376, base: 0.76, desc: 0.944 }, glyphs = {};
  for (const ch of '0123456789abcdefghijklmnopqrstuvwxyz+-=()'.split('')) {
    const list = pool[ch]; if (!list) continue;
    const st = list[Math.min(2, list.length - 1)];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    let top = G.cap, bot = G.base;
    if (/[a-z]/.test(ch) && !/[bdfhklt]/.test(ch)) top = G.x;
    if (/[gjpqy]/.test(ch)) { top = G.x; bot = G.desc; }
    if ('-+='.includes(ch)) { top = G.x - 0.03; bot = G.base - 0.1; }
    if ('()'.includes(ch)) { top = G.cap - 0.04; bot = G.base + 0.15; }
    const k = Math.min((bot - top) / Math.max(y1 - y0, 1e-9), 0.8 / Math.max(x1 - x0, 1e-9));
    glyphs[ch] = st.map(s => s.map(p => [Math.round((0.1 + (p[0] - x0) * k) * 1e4) / 1e4, Math.round((top + (p[1] - y0) * k) * 1e4) / 1e4]));
  }
  // the Replicator's own save format
  const file = path.join(out, 'my-handwriting.json');
  fs.writeFileSync(file, JSON.stringify({ name: 'Test Hand', weight: 80, spacing: 50, smoothing: 2, tidy: true, big: false, section: 'upper', glyphs }));
  return file;
}

(async () => {
  const handFile = makeHandFile();
  const page_ = process.argv[2] || path.join(__dirname, '..', 'dist', 'Board.html');
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|net::/.test(m.text())) errors.push(m.text()); });
  await page.evaluateOnNewDocument(() => {
    window.__long = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* unsupported */ }
  });
  await page.setViewport({ width: 1280, height: 760 });
  const url = 'file://' + path.resolve(page_);
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  const cdp = await page.target().createCDPSession();
  const write = async (r, reg) => {
    const box = await (await page.$('#pad canvas')).boundingBox();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const k = Math.min(box.width * reg[2] / (x1 - x0), box.height * reg[3] / (y1 - y0));
    for (const s of r.strokes) {
      const P = s.map(p => [box.x + box.width * reg[0] + (p[0] - x0) * k, box.y + box.height * reg[1] + (p[1] - y0) * k]);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P[0][0], y: P[0][1], button: 'left', clickCount: 1 });
      for (let i = 1; i < P.length; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: P[i][0], y: P[i][1], button: 'left' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P[P.length - 1][0], y: P[P.length - 1][1], button: 'left', clickCount: 1 });
    }
  };
  const latex = () => page.evaluate(() => document.getElementById('pad').latex);
  const shown = () => page.evaluate(() => document.getElementById('pad').shown.map(s => ({ label: s.label, box: s.box, kinds: s.parts.map(p => p.t) })));
  const view = () => page.evaluate(() => document.getElementById('pad').view);
  const settled = () => page.waitForFunction(() => { const p = document.getElementById('pad'); return p.pad && !p.pad.anim && p.pad.result && p.pad.strokes.length === p.pad.resultStrokes.length; }, { timeout: 30000 }).catch(() => {});

  console.log('separate expressions');
  const ex = [['linear_002', [0.04, 0.06, 0.36, 0.28]], ['frac_002', [0.58, 0.06, 0.3, 0.32]], ['power_002', [0.1, 0.62, 0.3, 0.25]]];
  for (const [id, reg] of ex) { await write(byId(id), reg); await wait(250); }
  await wait(1500); await settled();
  const L = await latex();
  const parts = await page.evaluate(() => document.getElementById('pad').result.parts.map(p => p.result.latex));
  ok(parts.length === 3, `three expressions written apart are read as three (${parts.join(' | ')})`);
  ok(/^\\begin\{gathered\}.*\\\\.*\\\\.*\\end\{gathered\}$/.test(L), 'the board\'s LaTeX lists each expression on its own line');
  // each is read as it would be alone
  const single = [];
  for (const [id] of ex) single.push(await page.evaluate(st => Nib.recognize(st).latex, byId(id).strokes));
  ok(single.every(s => parts.includes(s)), 'each reads exactly as it does on its own: ' + single.join(' | '));
  ok(await view() === 'ink' && await page.$eval('#pad', e => e.getAttribute('view')) === 'ink' && await page.$eval('#views button[data-view="ink"]', e => e.getAttribute('aria-checked')) === 'true', 'the board opens in the Ink view');
  await page.keyboard.press('2'); await wait(900);
  await page.screenshot({ path: path.join(out, 'board-test-tidy.png') });
  const nsym = await page.evaluate(() => document.getElementById('pad').result.symbols.length);
  ok((await shown()).length >= nsym, `every symbol is shown tidied (${(await shown()).length} for ${nsym})`);

  console.log('views and keys');
  await page.keyboard.press('4'); await wait(900);
  ok(await view() === 'typeset' && (await shown()).some(s => s.kinds.includes('text')), 'key 4: typeset');
  await page.screenshot({ path: path.join(out, 'board-test-typeset.png') });
  await page.keyboard.press('1'); await wait(700);
  ok(await view() === 'ink' && (await shown()).length === 0, 'key 1: ink as written');
  await page.click('#views button[data-view="hand"]'); await wait(500);
  ok(!(await page.$eval('#note', e => e.hidden)) && /not on this computer/.test(await page.$eval('#notetext', e => e.textContent)), 'My hand without handwriting explains what to do');
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('#noteact')]);
  await chooser.accept([handFile]); await wait(1200);
  ok(/ready: \d+ characters from Test Hand/.test(await page.$eval('#notetext', e => e.textContent)), 'opening the Replicator file loads the handwriting: ' + await page.$eval('#notetext', e => e.textContent));
  ok((await shown()).length >= nsym && await view() === 'hand', 'and the board shows it');
  await page.screenshot({ path: path.join(out, 'board-test-hand.png') });
  const bad = path.join(out, 'not-a-hand.json'); fs.writeFileSync(bad, '{"nope": true}');
  const [ch2] = await Promise.all([page.waitForFileChooser(), page.click('#hand')]);
  await ch2.accept([bad]); await wait(600);
  ok(/not handwriting/.test(await page.$eval('#notetext', e => e.textContent)) && await page.evaluate(() => Nib.hand.size) > 20, 'a file that is not handwriting is refused and the loaded hand stays');

  console.log('erase in a view, undo, copy, clear');
  await page.keyboard.press('4'); await wait(900);
  const n0 = await page.evaluate(() => document.getElementById('pad').strokes.length);
  await page.keyboard.press('e');
  ok(await page.$eval('#erase', e => e.getAttribute('aria-pressed')) === 'true', 'key E: eraser on');
  const it = (await shown())[0], cb = await (await page.$('#pad canvas')).boundingBox();
  await page.mouse.move(cb.x + (it.box[0] + it.box[2]) / 2 - 2, cb.y + (it.box[1] + it.box[3]) / 2); await page.mouse.down();
  await page.mouse.move(cb.x + (it.box[0] + it.box[2]) / 2 + 2, cb.y + (it.box[1] + it.box[3]) / 2, { steps: 2 }); await page.mouse.up();
  await wait(300);
  ok(await page.evaluate(() => document.getElementById('pad').strokes.length) < n0, 'erasing a typeset symbol takes its ink away');
  await page.keyboard.press('e');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
  await wait(1500); await settled();
  ok(await page.evaluate(() => document.getElementById('pad').strokes.length) === n0 && await latex() === L, 'Ctrl+Z brings it back');
  await page.evaluate(() => { window.__clip = null; navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); }; });
  await page.click('#copy'); await wait(300);
  ok(await page.evaluate(() => window.__clip) === L && /copied/.test(await page.$eval('#notetext', e => e.textContent)), 'Copy LaTeX copies the whole board');
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('no')); window.__ec = document.execCommand; document.execCommand = () => false; });
  await page.click('#copy'); await wait(300);
  ok(await page.evaluate(() => { const t = document.getElementById('latexout'); return !document.getElementById('latexbox').hidden && t.value === document.getElementById('pad').latex && t.selectionEnd - t.selectionStart === t.value.length; }), 'without a clipboard the LaTeX is shown selected');
  ok(/Ctrl\+C/.test(await page.$eval('#notetext', e => e.textContent)), 'and, with a mouse, it says to press Ctrl+C');
  await page.click('#noteclose');
  {
    const cb = await (await page.$('#copy')).boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(400);
    ok(/Long-press the text to copy/.test(await page.$eval('#notetext', e => e.textContent)) && !(await page.$eval('#latexbox', e => e.hidden)), 'tapped with a finger, it says to long-press the text');
    await page.click('#noteclose');
    await page.evaluate(() => { window.__ecCalled = 0; document.execCommand = c => { window.__ecCalled++; return c === 'copy'; }; });
    await page.click('#copy'); await wait(300);
    ok(await page.evaluate(() => window.__ecCalled === 1) && /copied/.test(await page.$eval('#notetext', e => e.textContent)) && await page.$eval('#latexbox', e => e.hidden), 'where the old copy command works, it copies the selected text by itself');
    await page.evaluate(() => { document.execCommand = window.__ec; });
  }
  await page.click('#clear'); await wait(500);
  ok(await page.evaluate(() => document.getElementById('pad').strokes.length) === 0 && /Undo brings it back/.test(await page.$eval('#notetext', e => e.textContent)), 'Clear empties the board and says how to get it back');
  await page.click('#undo'); await wait(1500); await settled();
  ok(await latex() === L, 'Undo after Clear restores the board');

  console.log('a reload keeps the board');
  await wait(800);
  await page.reload({ waitUntil: 'load' }); await wait(500); await settled(); await wait(600);
  ok(await view() === 'typeset' && await latex() === L, 'after a reload: same view, same writing, same reading');

  console.log('fixing a misread symbol');
  await page.keyboard.press('2'); await wait(700);
  const findDigit = (want) => page.evaluate(want => {
    const P = document.getElementById('pad').pad;
    for (const sym of P.result.symbols) {
      if (want ? !(sym.fixed && sym.label === want) : !/^[0-9]$/.test(sym.label)) continue;
      const alt = sym.candidates.find(c => c[0] !== sym.label && /^[0-9]$/.test(c[0]));
      if (!alt && !want) continue;
      const objs = sym.strokes.map(i => P.resultStrokes[i]);
      const it = P.plan && P.plan.items.find(q => q.from.length === objs.length && q.from.every(o => objs.includes(o)));
      if (!it) continue;
      return { label: sym.label, alt: alt ? alt[0] : null, x: (it.box[0] + it.box[2]) / 2, y: (it.box[1] + it.box[3]) / 2 };
    }
    return null;
  }, want);
  const before = await latex(), target = await findDigit();
  ok(!!target, 'a digit with another digit among its candidates');
  await page.keyboard.press('x');
  ok(await page.$eval('#fix', e => e.getAttribute('aria-pressed')) === 'true' && /Tap a symbol/.test(await page.$eval('#notetext', e => e.textContent)), 'key X: Fix on, and it says what to do');
  const cbF = await (await page.$('#pad canvas')).boundingBox(), nF = await page.evaluate(() => document.getElementById('pad').strokes.length);
  await page.mouse.click(cbF.x + target.x, cbF.y + target.y); await wait(250);
  const cands = await page.$$eval('#fixpop .cand', bs => bs.map(b => ({ l: b.dataset.label, on: b.getAttribute('aria-pressed') })));
  ok(cands.length >= 2 && cands[0].l === target.label && cands[0].on === 'true' && cands.some(c => c.l === target.alt), `tapping it offers what it could be, its reading first (${cands.map(c => c.l).join(' ')})`);
  await page.screenshot({ path: path.join(out, 'board-test-fix.png') });
  await page.click(`#fixpop .cand[data-label="${target.alt}"]`);
  await wait(500); await settled();
  const fixedL = await latex();
  ok(fixedL !== before && await page.evaluate(alt => document.getElementById('pad').result.symbols.some(s => s.fixed && s.label === alt), target.alt), `choosing ${target.alt} re-reads the board with it: ${before} -> ${fixedL}`);
  ok(await page.$eval('#fix', e => e.getAttribute('aria-pressed')) === 'true' && await page.$eval('#fixpop', e => e.hidden) && /Changed to/.test(await page.$eval('#notetext', e => e.textContent)), 'then Fix stays on for the next symbol, and the board says what changed');
  ok(await page.evaluate(n => document.getElementById('pad').strokes.length === n, nF), 'the taps wrote nothing on the board');
  // a correction survives a reload, and Clear then Undo
  await wait(900);
  await page.reload({ waitUntil: 'load' }); await wait(500); await settled(); await wait(400);
  const kept = await page.evaluate(alt => { const P = document.getElementById('pad').pad; return { fixes: P.fixes.length, fixed: P.result && P.result.symbols.some(s => s.fixed && s.label === alt) }; }, target.alt);
  ok(kept.fixes === 1 && kept.fixed && await latex() === fixedL, `after a reload the correction is still there (${JSON.stringify(kept)})`);
  await page.click('#clear'); await wait(300);
  ok(await page.evaluate(() => document.getElementById('pad').pad.fixes.length) === 0, 'Clear takes the correction away with the ink');
  await page.click('#undo'); await wait(600); await settled();
  ok(await page.evaluate(() => document.getElementById('pad').pad.fixes.length) === 1 && await latex() === fixedL, 'Undo brings it back with the ink');
  await page.keyboard.press('2'); await wait(600);
  const back = await findDigit(target.alt);
  await page.keyboard.press('x');
  ok(await page.$eval('#fix', e => e.getAttribute('aria-pressed')) === 'true', 'Fix on again');
  await page.mouse.click(cbF.x + back.x, cbF.y + back.y); await wait(250);
  await page.click(`#fixpop .cand[data-label="${target.label}"]`);
  await wait(500); await settled();
  ok(await latex() === before, 'fixing it back restores the reading');
  await page.mouse.click(cbF.x + 3, cbF.y + 3); await wait(150);
  ok(await page.$eval('#fixpop', e => e.hidden) && /Tap a symbol/.test(await page.$eval('#notetext', e => e.textContent)) && await page.$eval('#fix', e => e.getAttribute('aria-pressed')) === 'true', 'tapping empty board while fixing asks for a symbol');
  await page.mouse.click(cbF.x + 3, cbF.y + 3); await wait(150);
  ok(await page.$eval('#fix', e => e.getAttribute('aria-pressed')) === 'false' && await page.$eval('#fixlayer', e => e.hidden), 'a second tap on empty board leaves Fix');
  await page.keyboard.press('x'); await wait(100);
  await page.keyboard.press('Escape');
  ok(await page.$eval('#fix', e => e.getAttribute('aria-pressed')) === 'false' && await page.$eval('#fixlayer', e => e.hidden), 'Escape leaves Fix');
  await page.evaluate(() => Nib.memory.clear());

  console.log('answers after "="');
  {
    const { compose } = require('./compose.js');
    const NibNode = require(path.join(__dirname, '..', 'dist', 'nib.js'));
    let prob = null;                                   // a writer whose "12+30=" reads right
    for (let k = 0; k < 20 && !prob; k++) { const e = compose('12+30='); if (new NibNode.Recognizer().recognize(e.strokes).latex === '12+30=') prob = e; }
    const pad = () => page.evaluate(() => { const p = document.getElementById('pad'); return { answers: p.answers, solved: p.solved, latex: p.latex }; });
    const sameRead = () => page.waitForFunction(() => { const p = document.getElementById('pad').pad; return p.result && !p.anim && p.resultStrokes.length === p.strokes.length && p.resultStrokes.every((s, i) => s === p.strokes[i]); }, { timeout: 30000 }).catch(() => {});
    // pixels in the answers' gold (light or dark board)
    const gold = () => page.evaluate(() => {
      const c = document.querySelector('#pad canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 120 && d[i] > 120 && d[i + 1] > 85 && d[i + 2] < 95 && d[i] - d[i + 2] > 70) n++; return n;
    });
    const ansBoxes = () => page.evaluate(() => { const P = document.getElementById('pad').pad; return P.plan ? P.plan.items.filter(i => i.answer).map(i => i.box) : []; });
    await page.click('#clear'); await wait(300);
    await page.keyboard.press('2'); await wait(300);
    ok(await page.$eval('#solve', e => e.getAttribute('aria-pressed')) === 'true', 'Solve is on from the start');
    ok(await page.evaluate(() => document.getElementById('pad').reveal === true), 'and answers wait for a tap from the start');
    await page.click('#gear'); await wait(150);
    await page.click('#settings [data-set="reveal"] [data-v="off"]'); await wait(150);
    await page.click('#gear'); await wait(150);
    ok(await page.evaluate(() => document.getElementById('pad').reveal === false), 'Settings: "Reveal answers on tap" off writes answers straight in');
    ok(!!prob, 'a handwritten 12 + 30 = to work with');
    await write(prob, [0.3, 0.3, 0.3, 0.12]);
    await wait(600); await sameRead();
    let st = await pad();
    ok(st.answers.length === 1 && st.answers[0].latex === '42', `12 + 30 = is answered 42 (${JSON.stringify(st.answers.map(a => a.latex))})`);
    const g1 = await gold();
    ok(g1 > 80, `the answer is written in gold (${g1} gold pixels)`);
    const where = await page.evaluate(() => { const P = document.getElementById('pad').pad; const A = P.plan.items.filter(i => i.answer).map(i => i.box); const eq = P.plan.items.filter(i => !i.answer && i.label === '=').pop(); return { A, eq: eq && eq.box }; });
    const mid = where.eq ? (where.eq[1] + where.eq[3]) / 2 : 0;
    ok(where.eq && where.A.length && where.A.every(b => b[0] > where.eq[2] && b[0] - where.eq[2] < 200) && where.A.some(b => b[1] < mid && b[3] > mid - 6), 'just after the "=", on its line');
    ok(st.solved === '12+30=42' && st.latex === '12+30=', `the reading stays the writing; "solved" has the answer in (${st.solved})`);
    for (const [k, v] of [['1', 'ink'], ['3', 'my hand'], ['4', 'typeset'], ['2', 'tidy']]) {
      await page.keyboard.press(k); await wait(800);
      ok((await gold()) > 50, `answer shown in ${v}`);
    }
    await page.screenshot({ path: path.join(out, 'board-test-solve.png') });
    await page.evaluate(() => { window.__clip = null; navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); }; });
    await page.click('#copy'); await wait(300);
    ok(await page.evaluate(() => window.__clip) === '12+30=42', 'Copy LaTeX includes the answer');
    await page.keyboard.press('s'); await wait(500);
    st = await pad();
    ok(await page.$eval('#solve', e => e.getAttribute('aria-pressed')) === 'false' && st.answers.length === 0 && (await gold()) < 10, 'key S hides the answers');
    await page.click('#copy'); await wait(300);
    ok(await page.evaluate(() => window.__clip) === '12+30=', 'and Copy LaTeX is just the writing again');
    await page.keyboard.press('s'); await wait(700);
    ok(await page.$eval('#solve', e => e.getAttribute('aria-pressed')) === 'true' && (await gold()) > 80, 'S again brings them back');
    // writing over the answer: it steps aside the moment the pen comes down, and the line is read again
    const A = await ansBoxes(), cb = await (await page.$('#pad canvas')).boundingBox();
    const ab = A.reduce((b, x) => [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    await page.mouse.move(cb.x + ab[0] + 2, cb.y + (ab[1] + ab[3]) / 2); await page.mouse.down();
    const during = await gold();
    await page.mouse.move(cb.x + ab[2] - 2, cb.y + (ab[1] + ab[3]) / 2 + 3, { steps: 5 });
    await page.mouse.up();
    ok(during < 10, `writing over the answer hides it at once (${during} gold pixels with the pen down)`);
    await wait(600); await sameRead();
    ok((await pad()).answers.every(a => a.latex !== '42'), 'once more is written after the "=", 42 is no longer offered');
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    await wait(600); await sameRead();
    ok(JSON.stringify((await pad()).answers.map(a => a.latex)) === '["42"]', 'undo: the answer is back');
    // erasing the "=" takes the answer with it
    const eqb = (await page.evaluate(() => { const P = document.getElementById('pad').pad; const e = P.plan.items.filter(i => !i.answer && i.label === '=').pop(); return e.box; }));
    await page.keyboard.press('e');
    await page.mouse.move(cb.x + (eqb[0] + eqb[2]) / 2 - 3, cb.y + (eqb[1] + eqb[3]) / 2); await page.mouse.down();
    await page.mouse.move(cb.x + (eqb[0] + eqb[2]) / 2 + 3, cb.y + (eqb[1] + eqb[3]) / 2, { steps: 3 }); await page.mouse.up();
    await page.keyboard.press('e');
    ok((await gold()) < 10, 'erasing the "=" takes the answer away at once');
    await wait(600); await sameRead();
    ok((await pad()).answers.length === 0, 'and no answer comes back without it');
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    await wait(600); await sameRead();
    ok((await pad()).answers.length === 1 && (await gold()) > 80, 'undo brings the "=" and its answer back');
    // Solve's state survives a reload
    await page.keyboard.press('s'); await wait(800);
    await page.reload({ waitUntil: 'load' }); await wait(1200);
    ok(await page.$eval('#solve', e => e.getAttribute('aria-pressed')) === 'false', 'Solve off is remembered after a reload');
    await page.keyboard.press('s'); await wait(800); await sameRead();
    ok(JSON.stringify((await pad()).answers.map(a => a.latex)) === '["42"]', 'and back on, the board answers again');
  }

  console.log('equations, and x as a letter');
  {
    const { compose } = require('./compose.js');
    const NibNode = require(path.join(__dirname, '..', 'dist', 'nib.js'));
    const X = { times: false };
    const flat = t => t.replace(/\\begin\{gathered\}|\\end\{gathered\}|\s/g, '');
    const find = tex => { for (let k = 0; k < 40; k++) { const e = compose(tex); if (flat(new NibNode.Recognizer().recognize(e.strokes, X).latex) === flat(tex)) return e; } return null; };
    const answers = () => page.evaluate(() => document.getElementById('pad').answers.map(a => a.latex));
    const sameRead = () => page.waitForFunction(() => { const p = document.getElementById('pad').pad; return p.result && !p.anim && p.resultStrokes.length === p.strokes.length && p.resultStrokes.every((s, i) => s === p.strokes[i]); }, { timeout: 30000 }).catch(() => {});
    const gold = () => page.evaluate(() => {
      const c = document.querySelector('#pad canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 120 && d[i] > 120 && d[i + 1] > 85 && d[i + 2] < 95 && d[i] - d[i + 2] > 70) n++; return n;
    });
    ok(await page.$eval('#pad', e => e.getAttribute('times')) === 'false' && await page.evaluate(() => document.getElementById('pad').pad.o.times === false), 'the board reads every cross as the letter x (times="false")');
    await page.keyboard.press('1'); await wait(400);                     // ink: the answer is the only gold
    for (const [tex, want, what] of [['2x+3=11 \\\\ x=', '4', 'x = under 2x + 3 = 11 is answered 4'], ['x^{2}=49 \\\\ x=', '\\pm 7', 'x = under x² = 49 is answered ±7'],
      ['2x+3<11 \\\\ x<', '4', 'x < under 2x + 3 < 11 is answered 4'], ['2x(x+5)=', '2x^{2}+10x', 'a cross is the letter x: 2x(x + 5) = 2x² + 10x'], ['121\\cdot 21=', '2541', 'a raised dot multiplies: 121 · 21 = 2541']]) {
      const e = find(tex);
      if (!e) { console.log('    (no writer read ' + tex + ' right in 40 tries; skipped)'); continue; }
      await page.click('#clear'); await wait(300);
      await write(e, [0.2, 0.2, 0.45, 0.4]);
      await wait(600); await sameRead();
      const got = await answers(), g = await gold();
      ok(got.includes(want) && g > 40, `${what} (${JSON.stringify(got)}, ${g} gold pixels)`);
    }
    // writing carried on past a gap after a sign is one problem; two problems on one line stay two
    {
      const a = find('13.999+'), b = find('2+7='), c = find('3+4='), d = find('5+6=');
      if (a && b && c && d) {
        await page.click('#clear'); await wait(300);
        await write(a, [0.05, 0.25, 0.25, 0.1]); await write(b, [0.38, 0.25, 0.2, 0.1]);
        await write(c, [0.05, 0.6, 0.18, 0.1]); await write(d, [0.55, 0.6, 0.18, 0.1]);
        await wait(600); await sameRead();
        const got = await answers(), parts = await page.evaluate(() => {
          const P = document.getElementById('pad').pad, sb = s => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return [x0, y0, x1, y1]; };
          return { R: Nib._internals.refSize(P.resultStrokes), parts: (P.result.parts || []).map(p => p.result.latex + ' ' + p.strokes.map(sb).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]).map(Math.round).join(',')) };
        });
        ok(got.includes('22.999') && !got.includes('9') && got.includes('7') && got.includes('11'), `"13.999 +" then a gap then "2 + 7 =" is 22.999; 3 + 4 = and 5 + 6 = on one line stay two (${JSON.stringify(got)}; read ${JSON.stringify(parts)})`);
      } else console.log('    (no writers for the gap check; skipped)');
    }
    // Fix on a times dot offers both the times dot and the decimal point
    { const e = find('121\\cdot 21='); if (e) { await page.click('#clear'); await wait(300); await write(e, [0.2, 0.2, 0.45, 0.4]); await wait(600); await sameRead(); } }
    const dot = await page.evaluate(() => {
      const P = document.getElementById('pad').pad, s = P.result && P.result.symbols.find(q => q.label === '\\cdot');
      return s ? [s.box.x + s.box.w / 2, s.box.y + s.box.h / 2] : null;
    });
    if (dot) {
      await page.click('#fix'); await wait(200);
      const cb = await (await page.$('#pad canvas')).boundingBox();
      await page.mouse.click(cb.x + dot[0], cb.y + dot[1]); await wait(300);
      const offered = await page.$$eval('#fixpop .cand', b => b.map(x => x.dataset.label));
      ok(offered[0] === '\\cdot' && offered.includes('.'), `Fix on a times dot offers it and the decimal point (${offered.join(' ')})`);
      await page.keyboard.press('Escape'); await wait(200);
    } else console.log('    (no times dot on the board to fix; skipped)');
    await page.keyboard.press('2'); await wait(400);
  }

  // ------------------------------------------------------------------ the panel and tablet round
  const NibN = require(path.join(__dirname, '..', 'dist', 'nib.js'));
  const { compose: composeX } = require('./compose.js');
  const flatX = t => t.replace(/\\begin\{gathered\}|\\end\{gathered\}|\s/g, '');
  const findX = tex => { for (let k = 0; k < 40; k++) { const e = composeX(tex); if (flatX(new NibN.Recognizer().recognize(e.strokes, { times: false }).latex) === flatX(tex)) return e; } return null; };
  const sameReadX = () => page.waitForFunction(() => { const p = document.getElementById('pad').pad; return p.result && !p.anim && p.resultStrokes.length === p.strokes.length && p.resultStrokes.every((s, i) => s === p.strokes[i]); }, { timeout: 30000 }).catch(() => {});
  // gold pixels on the board (outside a circle [cx, cy, r] in CSS px, when given)
  const goldX = ex => page.evaluate(ex => {
    const c = document.querySelector('#pad canvas'), k = window.devicePixelRatio || 1, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) {
      if (!(d[i + 3] > 120 && d[i] > 120 && d[i + 1] > 85 && d[i + 2] < 95 && d[i] - d[i + 2] > 70)) continue;
      if (ex) { const j = i / 4, x = (j % c.width) / k, y = Math.floor(j / c.width) / k; if (Math.hypot(x - ex[0], y - ex[1]) <= ex[2] + 2) continue; }
      n++;
    } return n;
  }, ex || null);
  const nStrokesX = () => page.evaluate(() => document.getElementById('pad').strokes.length);
  const tapX = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const setting = async (set, v) => {
    if (await page.$eval('#settings', e => e.hidden)) { await page.click('#gear'); await wait(150); }
    await page.click(`#settings [data-set="${set}"] [data-v="${v}"]`); await wait(150);
  };
  const closeSettings = async () => { if (!(await page.$eval('#settings', e => e.hidden))) { await page.click('#gear'); await wait(150); } };
  const prob = findX('12+30=');

  console.log('answers revealed by a tap');
  if (prob) {
    await setting('reveal', 'on'); await closeSettings();
    await page.click('#clear'); await wait(300);
    await page.keyboard.press('1'); await wait(300);
    await write(prob, [0.3, 0.3, 0.3, 0.12]);
    await wait(600); await sameReadX();
    const st = await page.evaluate(() => {
      const p = document.getElementById('pad'), P = p.pad, A = P.plan ? P.plan.items.filter(i => i.answer) : [], eq = P.result.symbols.filter(s => s.label === '=').pop();
      return { answers: p.answers.map(a => a.latex), hidden: A.length > 0 && A.every(i => i.hidden), chips: (P.plan.chips || []).map(c => ({ cx: c.cx, cy: c.cy, r: c.r })), em: A.length ? A[0].em : 0,
        group: A.length ? A[0].group : null, eqRight: eq ? eq.box.x + eq.box.w : 0 };
    });
    ok(st.answers.join() === '42' && st.hidden && st.chips.length === 1, `with reveal on, 12 + 30 = is worked out (${st.answers.join()}) but waits behind one chip`);
    const ch = st.chips[0] || { cx: 0, cy: 0, r: 0 };
    ok(Math.abs(2 * ch.r - Math.max(14, 0.48 * st.em)) < 1 && Math.abs(ch.cx - ch.r - st.group[0]) < 1 && ch.cx > st.eqRight, `the chip is the writing's x-height (${(2 * ch.r).toFixed(1)} px for an em of ${st.em.toFixed(1)}) and sits where the answer starts, after the "="`);
    const g0 = await goldX(), g0out = await goldX([ch.cx, ch.cy, ch.r]);
    ok(g0 > 30 && g0out < 10, `only the gold chip shows (${g0} gold pixels in it, ${g0out} outside it)`);
    await page.screenshot({ path: path.join(out, 'board-test-chip.png') });
    const cb = await (await page.$('#pad canvas')).boundingBox(), n0 = await nStrokesX();
    // a drag that starts on the chip is writing, not a tap
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cb.x + ch.cx, y: cb.y + ch.cy }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cb.x + ch.cx + 8 * i, y: cb.y + ch.cy + 30 + 2 * i }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ok(await nStrokesX() === n0 + 1, 'a drag that starts on the chip writes a stroke');
    await page.click('#undo'); await wait(600); await sameReadX();
    await tapX(cb.x + ch.cx, cb.y + ch.cy);
    await wait(80);
    const mid = await page.evaluate(() => !!document.getElementById('pad').pad.anim);
    await wait(500);
    const r1 = await page.evaluate(() => { const P = document.getElementById('pad').pad; return { shown: P.plan.items.filter(i => i.answer).every(i => !i.hidden), chips: P.plan.chips.length, last: Object.keys(P.history[P.history.length - 1]) }; });
    const g1 = await goldX([ch.cx, ch.cy, ch.r]);
    ok(r1.shown && r1.chips === 0 && g1 > 80 && await nStrokesX() === n0, `a tap on the chip shows the answer (${g1} gold pixels outside where the chip was) and writes nothing (${JSON.stringify(r1)}, ${await nStrokesX()} strokes for ${n0})`);
    ok(mid, 'it comes in with the morph animation');
    await page.screenshot({ path: path.join(out, 'board-test-revealed.png') });
    await wait(800);
    await page.reload({ waitUntil: 'load' }); await wait(500); await sameReadX(); await wait(500);
    ok(await page.evaluate(() => { const P = document.getElementById('pad').pad; return P.plan && P.plan.items.some(i => i.answer) && P.plan.items.filter(i => i.answer).every(i => !i.hidden); }), 'a shown answer is still shown after a reload');
    // the eraser over a shown answer puts it back behind its chip (one undoable step)
    const ab = await page.evaluate(() => { const P = document.getElementById('pad').pad; const A = P.plan.items.filter(i => i.answer); return A[0].box; });
    const cb2 = await (await page.$('#pad canvas')).boundingBox(), nE = await nStrokesX();
    await page.keyboard.press('e');
    await page.mouse.move(cb2.x + (ab[0] + ab[2]) / 2, cb2.y + (ab[1] + ab[3]) / 2); await page.mouse.down();
    await page.mouse.move(cb2.x + (ab[0] + ab[2]) / 2 + 2, cb2.y + (ab[1] + ab[3]) / 2, { steps: 2 }); await page.mouse.up();
    await page.keyboard.press('e'); await wait(200);
    const er = await page.evaluate(() => { const P = document.getElementById('pad').pad; return { hidden: P.plan.items.filter(i => i.answer).every(i => i.hidden), chips: P.plan.chips.length, last: P.history[P.history.length - 1] }; });
    ok(er.hidden && er.chips === 1 && await nStrokesX() === nE && er.last.hide && er.last.hide.length === 1, 'erasing a shown answer hides it again (its chip comes back), and erases no ink');
    await page.click('#undo'); await wait(600); await sameReadX();
    ok(await page.evaluate(() => { const P = document.getElementById('pad').pad; return P.plan.items.filter(i => i.answer).every(i => !i.hidden); }), 'Undo shows it again');
    // erase the "+" (the line changes, so no answer), then undo: the same line comes back, still shown
    const plus = await page.evaluate(() => { const P = document.getElementById('pad').pad; const s = P.result.symbols.find(q => q.label === '+'); return s ? [s.box.x + s.box.w / 2, s.box.y + s.box.h / 2] : null; });
    if (plus) {
      await page.keyboard.press('e');
      await page.mouse.move(cb2.x + plus[0] - 2, cb2.y + plus[1]); await page.mouse.down(); await page.mouse.move(cb2.x + plus[0] + 2, cb2.y + plus[1], { steps: 2 }); await page.mouse.up();
      await page.keyboard.press('e'); await wait(600); await sameReadX();
      await page.click('#undo'); await wait(600); await sameReadX();
      ok(await page.evaluate(() => { const P = document.getElementById('pad').pad; return P.plan.items.some(i => i.answer) && P.plan.items.filter(i => i.answer).every(i => !i.hidden); }), 'a line that comes back unchanged keeps its answer shown');
    }
    // the same problem written again is a new line: its answer waits for a tap
    await page.click('#clear'); await wait(300);
    await write(prob, [0.3, 0.3, 0.3, 0.12]); await wait(600); await sameReadX();
    ok(await page.evaluate(() => { const P = document.getElementById('pad').pad; return P.plan.chips.length === 1 && P.plan.items.filter(i => i.answer).every(i => i.hidden); }), 'the line rewritten: its answer is behind a chip again');
    await setting('reveal', 'off'); await closeSettings(); await wait(300);
    ok(await page.evaluate(() => { const P = document.getElementById('pad').pad; return !(P.plan.chips || []).length && P.plan.items.filter(i => i.answer).every(i => !i.hidden); }) && (await goldX()) > 80, 'reveal off: the answer is written straight in, as before');
    await setting('reveal', 'on'); await closeSettings(); await wait(300);
  } else console.log('    (no writer read 12+30= right; skipped)');

  console.log('the eraser on the board');
  if (prob) {
    await page.keyboard.press('2'); await wait(900);
    const it = await page.evaluate(() => { const P = document.getElementById('pad').pad; const i = P.plan.items.find(q => !q.answer && q.label === '3'); return i ? i.box : null; });
    const inkIn = b => page.evaluate(b => { const c = document.querySelector('#pad canvas'), d = window.devicePixelRatio || 1; const D = c.getContext('2d').getImageData(Math.floor(b[0] * d), Math.floor(b[1] * d), Math.ceil((b[2] - b[0]) * d), Math.ceil((b[3] - b[1]) * d)).data; let n = 0; for (let i = 3; i < D.length; i += 4) if (D[i] > 100) n++; return n; }, b);
    if (it) {
      const cb = await (await page.$('#pad canvas')).boundingBox(), before = await inkIn(it);
      await page.keyboard.press('e');
      await page.mouse.move(cb.x + (it[0] + it[2]) / 2, cb.y + (it[1] + it[3]) / 2); await page.mouse.down();
      await page.mouse.move(cb.x + (it[0] + it[2]) / 2 + 1, cb.y + (it[1] + it[3]) / 2, { steps: 1 });
      const during = await inkIn(it), P = await page.evaluate(() => { const P = document.getElementById('pad').pad; const e = [...P.ptrs.values()][0]; return e ? { r: e.r, ref: Nib._internals.refSize(P.strokes.length ? P.strokes : [[[0, 0], [1, 1]]]), at: !!e.at } : null; });
      await page.mouse.up(); await page.keyboard.press('e');
      ok(before > 30 && during < before * 0.5, `erasing a tidied symbol clears it from the board at once, before the eraser lifts (${before} -> ${during} ink pixels)`);
      ok(P && P.at && P.r >= 14, `with a ring of radius ${P && P.r.toFixed(1)} (the writing near it: ${P && P.ref.toFixed(1)} px)`);
      await page.click('#undo'); await wait(600); await sameReadX();
    } else console.log('    (no 3 on the board; skipped)');
  }

  console.log('pages');
  {
    const pageno = () => page.$eval('#pageno', e => e.textContent);
    const p1 = await page.evaluate(() => document.getElementById('pad').getState());
    ok(await pageno() === '1 / 1' && await page.$eval('#prev', e => e.disabled) && await page.$eval('#next', e => e.disabled), 'one page to start: "1 / 1", no arrows to follow');
    await page.click('#newpage'); await wait(300);
    ok(await pageno() === '2 / 2' && await nStrokesX() === 0 && !(await page.$eval('#prev', e => e.disabled)), 'the + makes page 2, empty');
    const p2prob = findX('3+4=');
    if (p2prob) { await write(p2prob, [0.2, 0.2, 0.3, 0.12]); await wait(600); await sameReadX(); }
    const n2 = await nStrokesX();
    await page.click('#prev'); await wait(600); await sameReadX();
    ok(await pageno() === '1 / 2' && JSON.stringify(await page.evaluate(() => document.getElementById('pad').getState().strokes)) === JSON.stringify(p1.strokes), 'the left arrow goes back to page 1, its writing as it was');
    ok(await page.evaluate(() => document.getElementById('pad').pad.canUndo), 'with its undo history');
    await page.click('#next'); await wait(600); await sameReadX();
    ok(await pageno() === '2 / 2' && await nStrokesX() === n2 && n2 > 0, 'the right arrow: page 2 again');
    await page.click('#clear'); await wait(300);
    await page.click('#prev'); await wait(400);
    ok(await nStrokesX() === p1.strokes.length, 'Clear on page 2 leaves page 1 alone');
    await page.click('#next'); await wait(300); await page.click('#undo'); await wait(600); await sameReadX();
    ok(await nStrokesX() === n2, 'and Undo on page 2 brings its writing back');
    await wait(800);
    await page.reload({ waitUntil: 'load' }); await wait(600); await sameReadX();
    ok(await pageno() === '2 / 2' && await nStrokesX() === n2, 'after a reload: both pages, still on page 2');
    await page.click('#prev'); await wait(500);
    ok(await nStrokesX() === p1.strokes.length, 'and page 1 kept its writing');
    await page.click('#next'); await wait(300);
    await page.evaluate(() => { window.__confirms = 0; window.confirm = () => { window.__confirms++; return true; }; });
    await page.click('#gear'); await wait(150);
    await page.click('#delpage'); await wait(150);
    ok(!(await page.$eval('#delask', e => e.hidden)) && /page 2/.test(await page.$eval('#delq', e => e.textContent)) && await pageno() === '2 / 2', 'Settings: "Delete this page" asks first, on the page');
    await page.click('#delno'); await wait(150);
    ok(await page.$eval('#delask', e => e.hidden) && await pageno() === '2 / 2' && await nStrokesX() === n2, '"Keep it" keeps it');
    await page.click('#delpage'); await wait(100); await page.click('#delyes'); await wait(500);
    ok(await pageno() === '1 / 1' && await nStrokesX() === p1.strokes.length && await page.evaluate(() => window.__confirms === 0) && await page.$eval('#settings', e => e.hidden), '"Delete" removes page 2 and shows page 1 (no browser confirm box)');
    // a board saved before there were pages is page 1
    await wait(800);
    await page.evaluate(st => localStorage.setItem('nib-board-v1', JSON.stringify({ view: 'tidy', solve: true, strokes: st })), p1.strokes);
    await page.reload({ waitUntil: 'load' }); await wait(600); await sameReadX();
    ok(await pageno() === '1 / 1' && await nStrokesX() === p1.strokes.length && await view() === 'tidy', 'an older saved board ({view, solve, strokes}) opens as page 1');
  }

  console.log('saving');
  {
    const stored = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('nib-board-v1')); return s.pages[s.page].strokes.length; });
    const tick = async (x, y) => { const cb = await (await page.$('#pad canvas')).boundingBox(); await page.mouse.move(cb.x + x, cb.y + y); await page.mouse.down(); await page.mouse.move(cb.x + x + 12, cb.y + y + 4, { steps: 3 }); await page.mouse.up(); };
    await wait(800);
    const n0 = await stored();
    await tick(40, 600);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    ok(await stored() === n0 + 1, 'pagehide saves at once (no waiting for the half-second save)');
    await tick(80, 600);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState; });
    ok(await stored() === n0 + 2, 'so does the page being hidden (a tab switched, a Chromebox asleep)');
    await page.evaluate(() => { window.__set = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
    await tick(120, 600);
    await page.waitForFunction(() => !document.getElementById('note').hidden && /saved/.test(document.getElementById('notetext').textContent), { timeout: 8000 }).catch(() => {});
    const t1 = await page.$eval('#notetext', e => e.textContent), v1 = !(await page.$eval('#note', e => e.hidden));
    ok(v1 && /can't be saved in this browser\. Save an image to keep it\./.test(t1), 'when the browser will not store it, a note says so: ' + t1);
    await page.click('#noteclose');
    await tick(160, 600); await wait(600); await sameReadX(); await wait(900);
    ok(await page.$eval('#note', e => e.hidden), 'once only');
    await page.evaluate(() => { Storage.prototype.setItem = window.__set; });
    for (let i = 0; i < 4; i++) await page.click('#undo');
    await wait(800);
  }

  console.log('save image');
  {
    await page.evaluate(() => { window.__dl = null; window.__aclick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl = { name: this.download, href: this.href }; else window.__aclick.call(this); }; });
    await page.click('#saveimg'); await wait(800);
    const img = await page.evaluate(async () => {
      const d = window.__dl; if (!d) return null;
      const blob = await (await fetch(d.href)).blob(), bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
      const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
      const D = g.getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < D.length; i += 4) if (D[i] < 80 && D[i + 2] < 120) ink++;
      const cv = document.querySelector('#pad canvas').getBoundingClientRect();
      return { name: d.name, type: blob.type, w: bmp.width, h: bmp.height, cw: cv.width, ch: cv.height, bg: px(10, 10), dot: px(56, 56), ink };
    });
    ok(img && /^Nib-board-1-\d{4}-\d{2}-\d{2}\.png$/.test(img.name) && img.type === 'image/png', 'Save image downloads a PNG named Nib-board-<page>-<date>.png: ' + (img && img.name));
    ok(img && img.w === Math.round(img.cw * 2) && img.h === Math.round(img.ch * 2), `at twice the board's size (${img && img.w} x ${img && img.h} for ${img && img.cw} x ${img && img.ch})`);
    ok(img && img.bg.join() === '251,248,239,255' && img.dot.join() !== img.bg.join() && img.ink > 500, `on the board's colour, with the dot grid and the ink (${img && img.bg.join()} / ${img && img.dot.join()}, ${img && img.ink} ink pixels)`);
    await page.evaluate(() => { HTMLAnchorElement.prototype.click = window.__aclick; });
    const art = fs.readFileSync(path.join(__dirname, '..', 'dist', 'artifact', 'board.html'), 'utf8');
    ok(/window\.claude\.use\('downloads'\)/.test(art), "the published build asks for the downloads capability (with the <a download> fallback)");
  }

  console.log('settings, rails and themes');
  {
    await page.click('#newpage'); await wait(300);                 // an empty page: resizing it moves no ink
    await page.click('#gear'); await wait(200);
    const pop = await page.evaluate(() => { const s = document.getElementById('settings').getBoundingClientRect(), f = document.getElementById('surface').getBoundingClientRect();
      return { inside: s.left >= f.left && s.right <= f.right && s.top >= f.top && s.bottom <= f.bottom, small: [...document.querySelectorAll('#settings button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 44).length, exp: document.getElementById('gear').getAttribute('aria-expanded') }; });
    ok(pop.inside && pop.small === 0 && pop.exp === 'true', 'the gear opens Settings inside the board, every button at least 44 px tall');
    const n0 = await nStrokesX(), cb = await (await page.$('#pad canvas')).boundingBox();
    await tapX(cb.x + 300, cb.y + 400); await wait(200);
    ok(await page.$eval('#settings', e => e.hidden) && await nStrokesX() === n0, 'a tap outside closes it and writes nothing');
    await setting('theme', 'dark');
    const dark = await page.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, ans: getComputedStyle(document.documentElement).getPropertyValue('--answer').trim(), meta: document.querySelector('meta[name="theme-color"]').content }));
    ok(dark.t === 'dark' && dark.bg === 'rgb(16, 26, 46)' && dark.ans === '#e0b84f' && dark.meta === '#0b1324', `Theme Dark: dark board, the dark theme's gold kept, the browser bar follows (${JSON.stringify(dark)})`);
    await setting('theme', 'light');
    const light = await page.evaluate(() => ({ t: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, ans: getComputedStyle(document.documentElement).getPropertyValue('--answer').trim() }));
    ok(light.t === 'light' && light.bg === 'rgb(251, 248, 239)' && light.ans === '#8a6a10', `Theme Light: cream board, answers in the darker gold #8a6a10 (${JSON.stringify(light)})`);
    await setting('theme', 'system');
    ok(await page.evaluate(() => !document.documentElement.hasAttribute('data-theme')), 'Theme System: the computer decides');
    await setting('pen', 'thick');
    ok(await page.evaluate(() => document.getElementById('pad').pad.o.width === 5), 'Pen Thick: 5 px');
    await setting('pen', 'thin');
    ok(await page.evaluate(() => document.getElementById('pad').pad.o.width === 2.5), 'Pen Thin: 2.5 px');
    await setting('solve', 'off');
    ok(await page.$eval('#solve', e => e.getAttribute('aria-pressed')) === 'false' && await page.evaluate(() => !document.getElementById('pad').solve), 'Answers Off is the Solve button');
    await setting('solve', 'on');
    await setting('rail', 'left'); await setting('theme', 'dark'); await setting('pen', 'thick'); await closeSettings();
    await wait(800);
    await page.reload({ waitUntil: 'load' }); await wait(800);
    const kept = await page.evaluate(() => ({ rail: document.getElementById('board').dataset.rail, theme: document.documentElement.getAttribute('data-theme'), w: document.getElementById('pad').pad.o.width, solve: document.getElementById('pad').solve, reveal: document.getElementById('pad').reveal }));
    ok(kept.rail === 'left' && kept.theme === 'dark' && kept.w === 5 && kept.solve && kept.reveal, 'after a reload the settings are kept: ' + JSON.stringify(kept));
    await page.screenshot({ path: path.join(out, 'board-test-left-dark.png') });
    await setting('theme', 'system'); await setting('pen', 'medium');
    // the rail on each edge at the panel's, a landscape tablet's and a portrait tablet's size: nothing off screen
    for (const [w, h] of [[1920, 1080], [1280, 800], [800, 1280]]) {
      await page.setViewport({ width: w, height: h }); await wait(250);
      for (const r of ['top', 'bottom', 'left', 'right']) {
        await setting('rail', r);
        const m = await page.evaluate(r => {
          const rail = document.getElementById('rail').getBoundingClientRect(), f = document.getElementById('surface').getBoundingClientRect(), st = document.getElementById('settings').getBoundingClientRect();
          const off = [...document.querySelectorAll('#rail > *, #rail .pages > *, #rail .seg > *')].filter(e => !e.hidden && e.offsetParent).filter(e => { const q = e.getBoundingClientRect(); return q.right > innerWidth + 0.5 || q.bottom > innerHeight + 0.5 || q.left < -0.5 || q.top < -0.5 || q.right > rail.right + 0.5 || q.bottom > rail.bottom + 0.5 || q.left < rail.left - 0.5 || q.top < rail.top - 0.5; }).map(e => e.id || e.className);
          const side = r === 'left' || r === 'right';
          const where = r === 'top' ? rail.bottom <= f.top + 1 : r === 'bottom' ? rail.top >= f.bottom - 1 : r === 'left' ? rail.right <= f.left + 1 : rail.left >= f.right - 1;
          const labels = [...document.querySelectorAll('#rail .tool .t, #rail .seg .vt')].filter(e => e.offsetParent).length;
          const titled = [...document.querySelectorAll('#rail button')].every(b => b.title || b.getAttribute('aria-label'));
          return { off, where, side, labels, titled, scroll: [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight, document.getElementById('rail').scrollHeight - document.getElementById('rail').clientHeight],
            settingsIn: st.left >= f.left - 0.5 && st.right <= f.right + 0.5 && st.top >= f.top - 0.5 && st.bottom <= f.bottom + 0.5 };
        }, r);
        await closeSettings();
        await page.evaluate(() => { document.getElementById('note').hidden = false; document.getElementById('notetext').textContent = 'A note that is long enough to need most of the width of a narrow board to show.'; });
        const noteIn = await page.evaluate(() => { const n = document.getElementById('note').getBoundingClientRect(), f = document.getElementById('surface').getBoundingClientRect(); return n.left >= f.left && n.right <= f.right && n.top >= f.top && n.bottom <= f.bottom; });
        await page.evaluate(() => { document.getElementById('note').hidden = true; });
        ok(!m.off.length && m.where && m.scroll.every(v => v <= 0) && m.settingsIn && noteIn && (!m.side || (m.labels === 0 && m.titled)),
          `${w}x${h}, rail ${r}: nothing off screen, Settings and notes inside the board${m.side ? ', icons only with titles' : ''}${m.off.length ? ' (off: ' + m.off.join(' ') + ')' : ''} ${JSON.stringify(m.scroll)}`);
        if (w === 1280 && (r === 'left' || r === 'bottom')) await page.screenshot({ path: path.join(out, `board-test-rail-${r}-${w}x${h}.png`) });
      }
    }
    await setting('rail', 'top'); await closeSettings();
    await page.setViewport({ width: 1280, height: 760 }); await wait(300);
    await page.click('#gear'); await wait(100); await page.click('#delpage'); await wait(100); await page.click('#delyes'); await wait(500);
  }

  console.log('a smaller board (a tablet turned)');
  {
    const e = findX('25-7=');
    await page.click('#newpage'); await wait(300);
    if (e) {
      await write(e, [0.62, 0.72, 0.3, 0.12]); await wait(600); await sameReadX();
      // a correction on one stroke, to follow it
      await page.evaluate(() => { const P = document.getElementById('pad').pad; P.fixes = [{ strokes: [P.strokes[0]], label: '2' }]; P.parts.clear(); P.recognize(); });
      const box = () => page.evaluate(() => { const P = document.getElementById('pad').pad; const b = P.strokes.map(Nib._internals.sbox).reduce((a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])]); return b.map(v => Math.round(v * 10) / 10); });
      const b0 = await box(), L0 = await latex();
      await page.setViewport({ width: 360, height: 760 }); await wait(500);
      const after = await page.evaluate(() => { const P = document.getElementById('pad').pad, d = P.dpr; return { W: P.canvas.width / d, H: P.canvas.height / d, last: P.history[P.history.length - 1], fixOk: P.fixes.length === 1 && P.strokes.includes(P.fixes[0].strokes[0]) && P.fixes[0].strokes[0] === P.strokes[0] }; });
      const b1 = await box();
      const k = (b1[2] - b1[0]) / (b0[2] - b0[0]), k2 = (b1[3] - b1[1]) / (b0[3] - b0[1]);
      ok(b0[2] > after.W && b1[0] >= 15.9 && b1[2] <= after.W - 15.9 && b1[3] <= after.H - 15.9, `ink that no longer fits is brought in, 16 px from the edge (${b0.join(',')} -> ${b1.join(',')} on ${Math.round(after.W)} px)`);
      ok(k <= 1 && Math.abs(k - k2) < 0.01 && after.last && after.last.move, `scaled the same both ways (${k.toFixed(3)}), as one step of history`);
      ok(after.fixOk, 'the correction stays with its stroke');
      await wait(600); await sameReadX();
      ok(await latex() === L0, 'and it reads the same: ' + await latex());
      await page.click('#undo'); await wait(300);
      ok(JSON.stringify(await box()) === JSON.stringify(b0), 'Undo puts it back where it was');
      await page.click('#redo'); await wait(300);
      ok(JSON.stringify(await box()) === JSON.stringify(b1), 'Redo brings it in again');
      await page.setViewport({ width: 1280, height: 760 }); await wait(500);
      ok(JSON.stringify(await box()) === JSON.stringify(b1), 'a bigger board again does not scale the ink up');
      // a page put away at full size and taken out on the smaller board is brought in too
      await page.click('#undo'); await wait(300);
      await page.click('#newpage'); await wait(300);
      await page.setViewport({ width: 360, height: 760 }); await wait(400);
      await page.click('#prev'); await wait(400);
      const b2 = await box(), W2 = await page.evaluate(() => { const P = document.getElementById('pad').pad; return P.canvas.width / P.dpr; });
      ok(b2[2] <= W2 - 15.9 && b2[0] >= 15.9 && await page.evaluate(() => { const P = document.getElementById('pad').pad; return !!P.history[P.history.length - 1].move; }), `a page taken out on a smaller board is brought in as well (${b2.join(',')} on ${Math.round(W2)} px)`);
      await page.setViewport({ width: 1280, height: 760 }); await wait(400);
      await page.click('#next'); await wait(300);
      await page.click('#gear'); await wait(100); await page.click('#delpage'); await wait(100); await page.click('#delyes'); await wait(500);
    } else console.log('    (no writer read 25-7= right; skipped)');
    await page.click('#gear'); await wait(100); await page.click('#delpage'); await wait(100); await page.click('#delyes'); await wait(500);
  }

  console.log('what the panel sends (hold the Nib. mark)');
  {
    const mb = await (await page.$('#mark')).boundingBox();
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2); await page.mouse.down(); await wait(750); await page.mouse.up();
    ok(!(await page.$eval('#diag', e => e.hidden)), 'a long press on "Nib." opens the pointer overlay');
    const cb = await (await page.$('#pad canvas')).boundingBox();
    await tapX(cb.x + 600, cb.y + 500); await wait(150);
    const t = await page.$eval('#diag', e => e.textContent);
    ok(/down\s+touch\s+w [\d.]+\s+h [\d.]+\s+p [\d.]+\s+b \d+\s+primary\s+draw/.test(t), 'it lists each event: type, pointerType, width, height, pressure, buttons, isPrimary, and what the board did');
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2); await page.mouse.down(); await wait(200); await page.mouse.up(); await wait(500);
    ok(!(await page.$eval('#diag', e => e.hidden)), 'a short press does nothing');
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2); await page.mouse.down(); await wait(750); await page.mouse.up();
    ok(await page.$eval('#diag', e => e.hidden), 'another long press closes it');
    await page.click('#undo'); await wait(300);
  }

  console.log('two students at once, and the small things');
  {
    const cb = await (await page.$('#pad canvas')).boundingBox(), n0 = await nStrokesX();
    const P = i => [{ x: cb.x + 100 + 8 * i, y: cb.y + 560, id: 1 }, { x: cb.x + 800 + 8 * i, y: cb.y + 580 + 2 * i, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: P(0) });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: P(i) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ok(await nStrokesX() === n0 + 2, 'two fingers writing at once on the board make two strokes');
    await page.click('#undo'); await page.click('#undo'); await wait(300);
    const small = await page.evaluate(() => {
      const cs = e => getComputedStyle(e), rail = document.getElementById('rail');
      const ev = el => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; };
      return {
        over: cs(document.documentElement).overscrollBehaviorY + ' ' + cs(document.body).overscrollBehaviorY,
        rail: cs(rail).userSelect + ' ' + cs(rail).touchAction, note: cs(document.getElementById('note')).userSelect, pop: cs(document.getElementById('settings')).touchAction + ' ' + cs(document.getElementById('fixpop')).userSelect,
        menu: ev(document.querySelector('#pad canvas')) && ev(rail), textMenu: ev(document.getElementById('latexout')),
        metas: !!document.querySelector('meta[name="theme-color"]') && document.querySelector('meta[name="mobile-web-app-capable"]').content === 'yes',
      };
    });
    ok(small.over === 'none none', 'no pull-to-refresh or bounce (overscroll-behavior: none)');
    ok(small.rail === 'none manipulation' && small.note === 'none' && small.pop === 'manipulation none', `the rail, notes and popovers are not selectable and take taps at once (${small.rail}; ${small.note}; ${small.pop})`);
    ok(small.menu && !small.textMenu, 'a long press opens no browser menu, except on the LaTeX text');
    ok(small.metas, 'theme-color and mobile-web-app-capable are in the page');
  }

  console.log('a crowded board on a slow computer');
  const many = rows.filter((r, i) => i % 37 === 5).slice(0, 12);
  await page.click('#clear'); await wait(400);
  for (let i = 0; i < many.length; i++) await write(many[i], [0.02 + (i % 4) * 0.245, 0.04 + Math.floor(i / 4) * 0.32, 0.2, 0.22]);
  await wait(2500); await settled();
  const crowdParts = await page.evaluate(() => document.getElementById('pad').result.parts.length);
  ok(crowdParts === many.length, `${many.length} expressions on one board read as ${crowdParts}`);
  const nStrokes = await page.evaluate(() => document.getElementById('pad').strokes.length);
  await page.evaluate(() => { window.__long.length = 0; });
  await page.emulateCPUThrottling(4);
  await write(byId('arith_003'), [0.8, 0.86, 0.15, 0.1]);
  const t0 = Date.now();
  await page.waitForFunction(n => { const p = document.getElementById('pad'); return p.pad.result && p.pad.resultStrokes.length > n && !p.pad.anim; }, { timeout: 60000 }, nStrokes).catch(() => {});
  const took = Date.now() - t0, lt = await page.evaluate(() => window.__long.slice());
  await page.emulateCPUThrottling(1);
  console.log(`    ${nStrokes} strokes on the board; the new expression shows ${took} ms after the last pen-up; long tasks: ${lt.length ? lt.join(', ') : 'none'}`);
  ok(took < 6000, 'a new expression on a crowded board appears within 6 s on a 4x slower CPU');
  ok(!lt.some(d => d > 450), 'the board never freezes for more than 0.45 s');
  await page.screenshot({ path: path.join(out, 'board-test-crowded.png') });

  console.log('handwriting written in the Replicator, in the same browser');
  // both offline files open in one Chrome share their storage: the board picks up the Replicator's newer work by itself
  const repPath = path.join(path.dirname(path.resolve(page_)), 'Replicator.html');
  if (fs.existsSync(repPath) && page_.endsWith('Board.html')) {
    const rep = await browser.newPage(); rep.on('pageerror', e => errors.push('replicator: ' + e));
    await rep.setViewport({ width: 1366, height: 900 });
    await rep.goto('file://' + repPath, { waitUntil: 'load' });
    await rep.evaluate(() => { const n = document.getElementById('name'); n.value = 'Made in Replicator'; n.dispatchEvent(new Event('input', { bubbles: true })); });
    await rep.click('#tab-digits'); await wait(150);
    const glyphs = JSON.parse(fs.readFileSync(handFile, 'utf8')).glyphs;
    for (const ch of '0123456789') {
      for (const b of await rep.$$('.box')) {
        if (await b.$eval('.ch', e => e.textContent) !== ch) continue;
        const c = await (await b.$('canvas')).boundingBox();
        for (const s of glyphs[ch]) {
          const P = s.map(p => [c.x + p[0] * c.width, c.y + p[1] * c.height]);
          await rep.mouse.move(P[0][0], P[0][1]); await rep.mouse.down();
          for (let i = 1; i < P.length; i += 2) await rep.mouse.move(P[i][0], P[i][1]);
          await rep.mouse.up();
        }
      }
    }
    await wait(900);
    await page.bringToFront();
    await page.keyboard.press('3'); await wait(900);
    const got = await page.evaluate(() => ({ name: Nib.hand.name, size: Nib.hand.size, view: document.getElementById('pad').view, shown: document.getElementById('pad').shown.length }));
    ok(got.name === 'Made in Replicator' && got.size === 10, `the board uses the Replicator's newer handwriting by itself (${got.name}, ${got.size} characters)`);
    ok(got.view === 'hand' && got.shown > 0, 'and shows the board in it');
    await rep.close();
  } else console.log('    (skipped: no offline Replicator beside this page)');

  console.log('a real board: Croix\'s screenshot of 4 Nov, its strokes written again');
  {
    // test/fixtures/board_2026-11-04.json: the strokes taken back out of his screenshot (tools/strokes_from_screenshot.py),
    // in page px of the 1440 x 900 window it was written in. That board gave three wrong answers (2 + 7 = 9 for
    // 13.999 + 2 + 7, 7 + ½ = −5, 5x + 2x = 2x + 5, its first x written like a plus); none may come back.
    const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'board_2026-11-04.json'), 'utf8'));
    const bp = await browser.newPage(); bp.on('pageerror', e => errors.push(String(e)));
    await bp.setViewport({ width: F.width, height: F.height });
    await bp.goto(url, { waitUntil: 'load' });
    await bp.evaluate(() => localStorage.clear()); await bp.reload({ waitUntil: 'load' }); await wait(600);
    if (await bp.$eval('#solve', e => e.getAttribute('aria-pressed')) !== 'true') await bp.click('#solve');
    const bc = await bp.target().createCDPSession();
    for (const s of F.strokes) {
      await bc.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s[0][0], y: s[0][1], button: 'left', clickCount: 1 });
      for (let i = 1; i < s.length; i++) await bc.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s[i][0], y: s[i][1], button: 'left' });
      await bc.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s[s.length - 1][0], y: s[s.length - 1][1], button: 'left', clickCount: 1 });
    }
    await wait(1500);
    await bp.waitForFunction(() => { const p = document.getElementById('pad'); return p.pad && !p.pad.anim && p.pad.result && p.pad.strokes.length === p.pad.resultStrokes.length; }, { timeout: 60000 }).catch(() => {});
    await wait(600);
    // each line as read, with the answer after it (lines in reading order)
    const lines = await bp.evaluate(() => {
      const P = document.getElementById('pad').pad, by = new Map(P.answers.map(a => [a.line, a.latex]));
      return P.result.lines.map((l, i) => ({ latex: l.latex, answer: by.has(i) ? by.get(i) : null }));
    });
    const said = lines.map(l => l.latex + (l.answer === null ? '' : ' → ' + l.answer));
    const want = [['7+7=', '14'], ['14^{2}=', '196'], ['13.999+2+7=', '22.999'], ['7-7=', '0'], ['14^{2}=', '196'], ['7+\\frac{1}{2}=', '\\frac{15}{2}'],
      ['13+4=', '17'], ['\\sqrt{14}=', '3.741\\ldots'], ['7+\\frac{1}{2}=', '\\frac{15}{2}'], ['7-7=', '0'], ['3.741^{2}=', '13.995081'], ['5x+2x=', '7x']];
    let right = 0;
    for (const [tex, ans] of want) if (lines.some(l => l.latex === tex && l.answer === ans)) right++;
    ok(right >= 11, `${right} of the ${want.length} problems on it are read and answered right: ${said.join(';  ')}`);
    const wrong = lines.filter(l => l.answer !== null && !want.some(([tex, ans]) => l.latex === tex && l.answer === ans));
    ok(wrong.length === 0, 'and no answer on it is wrong' + (wrong.length ? ': ' + wrong.map(l => l.latex + ' → ' + l.answer).join(', ') : ''));
    ok(!lines.some(l => l.answer === '9' || l.answer === '-5' || l.answer === '2x+5'), 'none of the three wrong answers it showed comes back');
    // 13.999 + 2 + 7 = was written against the right edge: its answer must still be on the board, whole
    for (const v of ['1', '2', '4']) {
      await bp.keyboard.press(v); await wait(1200);
      const edge = await bp.evaluate(() => { const p = document.getElementById('pad'), W = p.pad.canvas.width / (p.pad.dpr || 1), H = p.pad.canvas.height / (p.pad.dpr || 1);
        const A = p.shown.filter(s => s.answer).map(s => s.box); return { W, H, n: A.length, right: Math.max(...A.map(b => b[2])), bottom: Math.max(...A.map(b => b[3])) }; });
      ok(edge.n > 0 && edge.right <= edge.W && edge.bottom <= edge.H, `${['', 'ink', 'tidy', '', 'typeset'][+v]}: every answer is on the board, the one at the edge too (rightmost ends at ${Math.round(edge.right)} of ${Math.round(edge.W)} px)`);
    }
    await bp.screenshot({ path: path.join(out, 'board-replayed-2026-11-04.png') });
    await bp.close();
  }

  console.log('phone, dark');
  const ph = await browser.newPage(); ph.on('pageerror', e => errors.push(String(e)));
  await ph.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await ph.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ph.goto(url, { waitUntil: 'load' }); await wait(1500);
  ok(await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scrolling on a phone');
  const bg = await ph.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg !== 'rgb(251, 248, 239)', 'dark mode changes the board colour: ' + bg);
  await ph.screenshot({ path: path.join(out, 'board-test-phone-dark.png') });
  await browser.close();
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
