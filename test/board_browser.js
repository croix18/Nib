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
  // the More menu's items (Copy LaTeX, My handwriting …) are a tap away
  const more = async sel => { if (await page.$eval('#morepop', e => e.hidden)) { await page.click('#morebtn'); await wait(150); } await page.click(sel); };
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
  // fresh writing is left as written for 2.5 s before it takes the view, so numbers do not change under the pen
  {
    const before = (await shown()).filter(s => !s.answer).length;
    await write(byId('arith_003'), [0.6, 0.62, 0.3, 0.25]);
    await wait(1200);
    const during = (await shown()).filter(s => !s.answer).length, read = await page.evaluate(() => document.getElementById('pad').result.parts.length);
    ok(read === 4 && during === before, `new writing is read (${read} expressions) but still shown as written 1.2 s after the pen lifts (${during} tidied symbols, as before)`);
    await wait(2200);
    const after = (await shown()).filter(s => !s.answer).length;
    ok(after > before, `and takes the Tidy view once the writer has rested (${after} tidied symbols)`);
    // take that writing off again (each undo removes one stroke; the result is null while a read is pending)
    const n3 = byId('arith_003').strokes.length;
    for (let i = 0; i < n3; i++) { await page.evaluate(() => document.getElementById('pad').undo()); await wait(120); }
    await wait(1200); await settled();
    ok((await page.evaluate(() => document.getElementById('pad').result.parts.length)) === 3, 'undone again: three expressions');
  }

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
  const [ch2] = await Promise.all([page.waitForFileChooser(), more('#hand')]);
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
  await more('#copy'); await wait(300);
  ok(await page.evaluate(() => window.__clip) === L && /copied/.test(await page.$eval('#notetext', e => e.textContent)), 'Copy LaTeX copies the whole board');
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('no')); window.__ec = document.execCommand; document.execCommand = () => false; });
  await more('#copy'); await wait(300);
  ok(await page.evaluate(() => { const t = document.getElementById('latexout'); return !document.getElementById('latexbox').hidden && t.value === document.getElementById('pad').latex && t.selectionEnd - t.selectionStart === t.value.length; }), 'without a clipboard the LaTeX is shown selected');
  ok(/Ctrl\+C/.test(await page.$eval('#notetext', e => e.textContent)), 'and, with a mouse, it says to press Ctrl+C');
  await page.click('#noteclose');
  {
    await page.click('#morebtn'); await wait(150);
    const cb = await (await page.$('#copy')).boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(400);
    ok(/Long-press the text to copy/.test(await page.$eval('#notetext', e => e.textContent)) && !(await page.$eval('#latexbox', e => e.hidden)), 'tapped with a finger, it says to long-press the text');
    await page.click('#noteclose');
    await page.evaluate(() => { window.__ecCalled = 0; document.execCommand = c => { window.__ecCalled++; return c === 'copy'; }; });
    await more('#copy'); await wait(300);
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
  ok(await page.$eval('#fix', e => e.getAttribute('aria-pressed')) === 'false' && await page.evaluate(() => document.getElementById('pad').mode) === 'draw', 'a second tap on empty board leaves Fix');
  await page.keyboard.press('x'); await wait(100);
  await page.keyboard.press('Escape');
  ok(await page.$eval('#fix', e => e.getAttribute('aria-pressed')) === 'false' && await page.evaluate(() => document.getElementById('pad').mode) === 'draw', 'Escape leaves Fix');
  // writing with Fix on writes (the pen never stops working), and Fix goes off by itself
  await page.keyboard.press('x'); await wait(100);
  ok(await page.evaluate(() => document.getElementById('pad').mode) === 'fix' && /Just write to carry on/.test(await page.$eval('#notetext', e => e.textContent)), 'Fix on again: the board says writing carries on');
  {
    const nW = await page.evaluate(() => document.getElementById('pad').strokes.length), x = cbF.x + cbF.width * 0.8, y = cbF.y + cbF.height * 0.8;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 4 * i, y: y - 5 * i, button: 'left' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 48, y: y - 60, button: 'left', clickCount: 1 });
    await wait(300);
    ok(await page.evaluate(n => document.getElementById('pad').strokes.length === n + 1, nW), 'a stroke written with Fix on is on the board');
    ok(await page.$eval('#fix', e => e.getAttribute('aria-pressed')) === 'false' && await page.evaluate(() => document.getElementById('pad').mode) === 'draw' && await page.$eval('#note', e => e.hidden), 'and writing leaves Fix');
    await page.click('#undo'); await wait(600); await settled();
    ok(await page.evaluate(n => document.getElementById('pad').strokes.length === n, nW) && await latex() === before, 'Undo takes that stroke away again');
  }
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
    await wait(2600);                                   // in a view, fresh writing and its answer wait for the writer to rest
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
    await more('#copy'); await wait(300);
    ok(await page.evaluate(() => window.__clip) === '12+30=42', 'Copy LaTeX includes the answer');
    await page.keyboard.press('s'); await wait(500);
    st = await pad();
    ok(await page.$eval('#solve', e => e.getAttribute('aria-pressed')) === 'false' && st.answers.length === 0 && (await gold()) < 10, 'key S hides the answers');
    await more('#copy'); await wait(300);
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
    // the navy ink's pixels (the board's paper is drawn under it, so every pixel is opaque)
    const inkIn = b => page.evaluate(b => { const c = document.querySelector('#pad canvas'), d = window.devicePixelRatio || 1; const D = c.getContext('2d').getImageData(Math.floor(b[0] * d), Math.floor(b[1] * d), Math.ceil((b[2] - b[0]) * d), Math.ceil((b[3] - b[1]) * d)).data; let n = 0; for (let i = 0; i < D.length; i += 4) if (D[i + 3] > 100 && D[i] < 120 && D[i + 1] < 120 && D[i + 2] < 160) n++; return n; }, b);
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
    // (the first time a 1.6 Board opens: no board of its own yet, and the old one under the old key)
    await page.evaluate(st => { localStorage.removeItem('nib-board-v3'); localStorage.setItem('nib-board-v1', JSON.stringify({ view: 'tidy', solve: true, strokes: st })); }, p1.strokes);
    await page.reload({ waitUntil: 'load' }); await wait(600); await sameReadX();
    ok(await pageno() === '1 / 1' && await nStrokesX() === p1.strokes.length && await view() === 'tidy', 'an older saved board ({view, solve, strokes}) opens as page 1');
  }

  console.log('saving');
  {
    const stored = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('nib-board-v3')); const p = s.pages[s.page]; return (p.pk || p.strokes).length; });
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
    ok(v1 && /can't be saved in this browser\. Export, Save the board keeps it as a file\./.test(t1), 'when the browser will not store it, a note says so: ' + t1);
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
    await page.click('#exportbtn'); await wait(200); await page.click('#saveimg'); await wait(800);
    const img = await page.evaluate(async () => {
      const d = window.__dl; if (!d) return null;
      const blob = await (await fetch(d.href)).blob(), bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
      const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
      const D = g.getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < D.length; i += 4) if (D[i] < 80 && D[i + 2] < 120) ink++;
      const cv = document.querySelector('#pad canvas').getBoundingClientRect();
      return { name: d.name, type: blob.type, w: bmp.width, h: bmp.height, cw: cv.width, ch: cv.height, bg: px(10, 10), dot: px(56, 56), ink };
    });
    ok(img && /^Nib-board-1-\d{4}-\d{2}-\d{2}\.png$/.test(img.name) && img.type === 'image/png', 'Export, Picture of the screen downloads a PNG named Nib-board-<page>-<date>.png: ' + (img && img.name));
    ok(img && img.w === Math.round(img.cw * 2) && img.h === Math.round(img.ch * 2), `at twice the board's size (${img && img.w} x ${img && img.h} for ${img && img.cw} x ${img && img.ch})`);
    ok(img && img.bg.join() === '251,248,239,255' && img.dot.join() !== img.bg.join() && img.ink > 500, `on the board's color, with the dot grid and the ink (${img && img.bg.join()} / ${img && img.dot.join()}, ${img && img.ink} ink pixels)`);
    await page.evaluate(() => { HTMLAnchorElement.prototype.click = window.__aclick; });
    const art = fs.readFileSync(path.join(__dirname, '..', 'dist', 'artifact', 'board.html'), 'utf8');
    ok(/window\.claude\.use\('downloads'\)/.test(art), "the published build asks for the downloads capability (with the <a download> fallback)");
  }

  console.log('keeping writing for training');
  {
    const T = () => page.evaluate(() => document.getElementById('pad').pad.training.map(r => JSON.parse(JSON.stringify(r))));
    const stored = () => page.evaluate(() => { const t = localStorage.getItem('nib-train-v1'); return t === null ? null : JSON.parse(t).records.length; });
    const countLine = async () => { await closeSettings(); await page.click('#gear'); await wait(150); const t = await page.$eval('#traincount', e => e.textContent); return t; };
    const sw = () => page.$eval('#train', e => e.getAttribute('aria-checked'));
    ok((await T()).length === 0 && await stored() === null && await sw() === 'false' && !(await page.evaluate(() => document.getElementById('pad').pad.o.train)),
      'with "Keep writing for training" off (the default) nothing written on the board so far was kept');
    const e1 = findX('3+4='), e2 = findX('5+6=');
    if (e1 && e2) {
      await page.click('#clear'); await wait(300);
      await write(e1, [0.15, 0.15, 0.3, 0.12]); await wait(600); await sameReadX(); await wait(4600);
      ok((await T()).length === 0, 'switch off: an expression written and left alone for 4 s is not kept');
      await page.click('#clear'); await wait(300);
      ok((await T()).length === 0, 'nor when its page is cleared');
      // on: the note says what is kept
      await page.click('#gear'); await wait(150);
      ok(/0 expressions kept · 0 corrected/.test(await page.$eval('#traincount', e => e.textContent)) && await page.$eval('#savetrain', e => e.disabled), 'Settings, Training: "0 expressions kept · 0 corrected", Save training disabled');
      const tb = await (await page.$('#train')).boundingBox();
      await page.click('#train'); await wait(150);
      const nt = await page.$eval('#notetext', e => e.textContent);
      ok(await sw() === 'true' && await page.evaluate(() => document.getElementById('pad').train) && tb.height >= 44, 'the switch turns it on (a 44 px target)');
      ok(/^Nib keeps what is written on this board — the strokes and how they were read — on this computer only, until you save it\. Nothing else is kept\.$/.test(nt) && !(await page.$eval('#note', e => e.hidden)), 'the first time, a note says what is kept: ' + nt);
      await page.click('#train'); await wait(100); await page.click('#train'); await wait(100);
      ok(await sw() === 'true', 'off and on again');
      await closeSettings();
      await page.evaluate(() => { window.__trainEv = []; document.getElementById('pad').addEventListener('nib:train', e => window.__trainEv.push(e.detail.key)); });
      await page.keyboard.press('2'); await wait(300);
      await write(e1, [0.15, 0.15, 0.3, 0.12]); await wait(600); await sameReadX();
      ok((await T()).length === 0, 'just read: not kept yet (it waits until the writing is left alone for 4 s)');
      await wait(4600);
      let R = await T();
      const info = await page.evaluate(() => { const p = document.getElementById('pad'), P = p.pad; return { n: P.strokes.length, latex: P.result.parts[0].result.latex, W: Math.round(P.canvas.width / P.dpr), H: Math.round(P.canvas.height / P.dpr), answers: p.answers.length }; });
      const r0 = R[0] || {};
      ok(R.length === 1 && r0.latex === '3+4=' && r0.latex === info.latex && r0.strokes.length === info.n, `then one record, with the reading and every stroke (${R.length} record: ${r0.latex}, ${r0.strokes && r0.strokes.length} strokes of ${info.n})`);
      ok(Array.isArray(r0.types) && r0.types.length === info.n && r0.types.every(t => t === 'mouse'), 'types: the pointer of each stroke (' + (r0.types || []).join(',') + ')');
      const pts = (r0.strokes || []).flat();
      ok(pts.length && Math.min(...pts.map(p => p[0])) === 0 && Math.min(...pts.map(p => p[1])) === 0 && pts.every(p => p.length === 3 && p.every(v => Math.round(v * 10) / 10 === v)) && r0.strokes[0][0][2] === 0 && pts.some(p => p[2] > 0),
        'strokes from the piece\'s top-left, to 0.1 px, with times from its first point');
      ok(typeof r0.key === 'string' && r0.key.length > 0 && r0.w === info.W && r0.h === info.H && r0.view === 'tidy' && typeof r0.t === 'number' && Math.abs(Date.now() - r0.t) < 60000 && r0.answered === (info.answers > 0) && typeof r0.confidence === 'number',
        `key, time, the board's size (${r0.w} x ${r0.h}), view, answered (${r0.answered}) and confidence (${r0.confidence})`);
      ok(Array.isArray(r0.symbols) && r0.symbols.map(s => s.label).join('') === '3+4=' && r0.symbols.every(s => s.strokes.every(i => i >= 0 && i < info.n)) && Array.isArray(r0.fixed) && r0.fixed.length === 0,
        'symbols with their labels and strokes, nothing fixed');
      ok(await page.evaluate(() => window.__trainEv.length) === 1, 'the pad sends nib:train with the record');
      await page.waitForFunction(() => localStorage.getItem('nib-train-v1') !== null, { timeout: 3000 }).catch(() => {});
      ok(await stored() === 1, 'the Board saves it under its own key, nib-train-v1');
      ok(/^1 expression kept · 0 corrected$/.test(await countLine()), 'the count line: ' + await page.$eval('#traincount', e => e.textContent));
      await closeSettings();
      await wait(4500);
      ok((await T()).length === 1, 'kept once (left alone longer, it is not kept again)');
      // Fix a symbol: the record is replaced with the corrected reading
      const hit = await page.evaluate(() => {
        const P = document.getElementById('pad').pad;
        for (const sym of P.result.symbols) {
          const alt = (sym.candidates || []).find(c => c[0] !== sym.label);
          const objs = sym.strokes.map(i => P.resultStrokes[i]);
          const it = P.plan && P.plan.items.find(q => !q.answer && q.from.length === objs.length && q.from.every(o => objs.includes(o)));
          if (alt && it && /^[0-9]$/.test(sym.label)) return { label: sym.label, x: (it.box[0] + it.box[2]) / 2, y: (it.box[1] + it.box[3]) / 2 };
        }
        return null;
      });
      if (hit) {
        await page.keyboard.press('x');
        const cbT = await (await page.$('#pad canvas')).boundingBox();
        await page.mouse.click(cbT.x + hit.x, cbT.y + hit.y); await wait(250);
        const alt = await page.$$eval('#fixpop .cand[aria-pressed="false"]', bs => { const l = bs.map(b => b.dataset.label); return l.find(x => /^[0-9a-z]$/i.test(x)) || l[0]; });
        await page.click(`#fixpop .cand[data-label="${alt.replace(/\\/g, '\\\\')}"]`); await wait(300); await settled();
        await page.keyboard.press('Escape'); await wait(100);
        R = await T();
        const now = await page.evaluate(() => document.getElementById('pad').pad.result.parts[0].result.latex);
        const r1 = R[0] || {};
        ok(R.length === 1 && r1.key === r0.key && r1.latex === now && r1.latex !== r0.latex && r1.symbols.some(s => s.label === alt), `a Fix (${hit.label} -> ${alt}) replaces the record with the corrected reading: ${r0.latex} -> ${r1.latex}`);
        ok(r1.fixed && r1.fixed.length === 1 && r1.fixed[0].label === alt && r1.fixed[0].strokes.length >= 1 && r1.fixed[0].strokes.every(i => i >= 0 && i < info.n), 'and "fixed" has the correction: ' + JSON.stringify(r1.fixed));
        await page.evaluate(() => Nib.memory.clear());
      } else ok(false, 'a digit with another reading among its candidates, to fix');
      // a second expression on the page, then the page is left at once: it is kept on the way out
      await write(e2, [0.15, 0.55, 0.3, 0.12]); await wait(600); await sameReadX();
      ok((await T()).length === 1, 'a second expression, just read: not kept yet');
      await page.click('#newpage'); await wait(300);
      R = await T();
      ok(R.length === 2 && R[1].latex === '5+6=' && R[1].strokes.length === e2.strokes.length, `changing page keeps it straight away (${R.map(r => r.latex).join(', ')})`);
      await page.click('#prev'); await wait(600); await sameReadX(); await wait(4500);
      ok((await T()).length === 2, 'back on the page, the same writing is not kept again');
      // Clear keeps what is on the page too
      {
        const e3 = findX('8-2=');
        if (e3) {
          await write(e3, [0.55, 0.15, 0.3, 0.12]); await wait(600); await sameReadX();
          await page.click('#clear'); await wait(300);
          R = await T();
          ok(R.length === 3 && R[2].latex === '8-2=', 'Clear keeps what was on the page first (' + R.map(r => r.latex).join(', ') + ')');
          await page.click('#undo'); await wait(600); await sameReadX(); await wait(4500);
          ok((await T()).length === 3, 'and Undo brings it back without keeping it twice');
          await page.keyboard.press('e');
          const b3 = await page.evaluate(() => { const P = document.getElementById('pad').pad, k = P.strokes.length - 1, s = P.strokes[k]; return s[Math.floor(s.length / 2)]; });
          const cbE = await (await page.$('#pad canvas')).boundingBox();
          await page.mouse.move(cbE.x + b3[0], cbE.y + b3[1]); await page.mouse.down(); await page.mouse.move(cbE.x + b3[0] + 2, cbE.y + b3[1], { steps: 2 }); await page.mouse.up();
          await page.keyboard.press('e');
          await page.waitForFunction(() => { const p = document.getElementById('pad').pad; return p.result && p.resultStrokes.length === p.strokes.length; }, { timeout: 20000 }).catch(() => {});
          await page.click('#undo'); await wait(600); await sameReadX(); await wait(4500);
          ok((await T()).length === 3, 'nor after part of it is rubbed out and put back');
        } else console.log('    (no writer read 8-2= right; skipped)');
      }
      // a reload: the log and the count are still there
      await wait(800);
      await page.reload({ waitUntil: 'load' }); await wait(600); await sameReadX();
      R = await T();
      const nR = R.length, nC = R.filter(r => r.fixed.length).length;
      ok(nR >= 2 && await stored() === nR && R.map(r => r.latex).includes('5+6='), `after a reload the log is still there (${nR} records)`);
      ok(await sw() === 'true' && await page.evaluate(() => document.getElementById('pad').train), 'and the switch is still on');
      const cl = await countLine();
      ok(cl === `${nR} expressions kept · ${nC} corrected`, 'the count line is right: ' + cl);
      await closeSettings(); await wait(4500);
      ok((await T()).length === nR, 'the writing put back on the board is not kept again');
      // Save training: a file in the right shape
      await page.evaluate(() => { window.__dl = null; window.__aclick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl = { name: this.download, href: this.href }; else window.__aclick.call(this); }; });
      await page.click('#gear'); await wait(150);
      await page.click('#savetrain'); await wait(500);
      const dl = await page.evaluate(async () => { const d = window.__dl; if (!d) return null; const b = await (await fetch(d.href)).blob(); return { name: d.name, type: b.type, text: await b.text() }; });
      await page.evaluate(() => { HTMLAnchorElement.prototype.click = window.__aclick; });
      let F = null; try { F = JSON.parse(dl.text); } catch (e) { F = null; }
      const ver = await page.evaluate(() => Nib.version);
      ok(dl && /^Nib-training-\d{4}-\d{2}-\d{2}\.json$/.test(dl.name) && dl.type === 'application/json', 'Save training downloads Nib-training-<date>.json: ' + (dl && dl.name));
      ok(F && F.format === 'nib-training' && F.version === 1 && !isNaN(Date.parse(F.exported)) && /T/.test(F.exported) && F.engine === ver && Array.isArray(F.records) && F.records.length === nR,
        `{format: 'nib-training', version: 1, exported, engine: ${F && F.engine}, records: ${F && F.records.length}}`);
      ok(F && JSON.stringify(Object.keys(F.records[0]).sort()) === JSON.stringify(['answered', 'confidence', 'fixed', 'key', 'latex', 'strokes', 'symbols', 't', 'types', 'widths', 'view', 'w', 'h'].sort()), 'each record has exactly the fields of the format: ' + (F && Object.keys(F.records[0]).join(',')));
      // the converter on the saved file
      if (F) {
        const dir = path.join(out, 'downloads'); fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, dl.name), jl = path.join(dir, 'board-training.jsonl');
        fs.writeFileSync(file, dl.text);
        const run = require('child_process').spawnSync('python3', ['-I', path.join(__dirname, '..', 'tools', 'training_to_jsonl.py'), file, jl], { encoding: 'utf8' });
        const rowsJ = run.status === 0 ? fs.readFileSync(jl, 'utf8').trim().split('\n').map(JSON.parse) : [];
        const nS = F.records.reduce((n, r) => n + r.strokes.length, 0);
        ok(run.status === 0 && new RegExp(`${nR} records, ${nS} strokes, \\d+ symbols, ${nC} fixed`).test(run.stdout), 'the converter runs and prints its counts: ' + (run.stdout || run.stderr).trim());
        const byLatex = new Map(F.records.map(r => [r.latex, r]));
        ok(rowsJ.length === nR && rowsJ.every(w => {
          const r = byLatex.get(w.latex);
          return r && w.source === 'board' && w.fixed === (r.fixed.length > 0) && typeof w.id === 'string' && w.truth === '$' + r.latex + '$' &&
            JSON.stringify(w.strokes) === JSON.stringify(r.strokes.map(s => s.map(p => [p[0], p[1]]))) && JSON.stringify(w.types) === JSON.stringify(r.types) &&
            w.symbols.length === r.symbols.length && w.symbols.every((s, i) => s.label === r.symbols[i].label && JSON.stringify(s.strokes) === JSON.stringify(r.symbols[i].strokes.slice().sort((a, b) => a - b))) && w.orphans.length === 0;
        }), `it writes one trainer row per record: id, strokes as [x, y] (y down, as kept), symbols, latex, source, types, fixed (${rowsJ.map(w => w.latex + (w.fixed ? ' fixed' : '')).join(', ')})`);
      }
      // Forget, with a confirm on the page
      await page.click('#forgettrain'); await wait(150);
      ok(!(await page.$eval('#forgetask', e => e.hidden)) && new RegExp(`Forget the ${nR} expressions`).test(await page.$eval('#forgetq', e => e.textContent)) && (await T()).length === nR, '"Forget training" asks first, on the page');
      await page.click('#forgetno'); await wait(100);
      ok(await page.$eval('#forgetask', e => e.hidden) && (await T()).length === nR, '"Keep it" keeps it');
      await page.click('#forgettrain'); await wait(100); await page.click('#forgetyes'); await wait(300);
      ok((await T()).length === 0 && await stored() === null && await page.$eval('#traincount', e => e.textContent) === '0 expressions kept · 0 corrected' && await page.$eval('#savetrain', e => e.disabled), 'Forget empties the log, its storage and the count');
      await closeSettings(); await wait(4500);
      ok((await T()).length === 0, 'and the writing still on the board is not kept again');
      await page.click('#gear'); await wait(150); await page.click('#train'); await wait(100); await closeSettings();
      ok(await sw() === 'false', 'switched off again');
    } else ok(false, 'writers for 3 + 4 = and 5 + 6 =');
    await page.click('#next'); await wait(300);
    await page.click('#gear'); await wait(100); await page.click('#delpage'); await wait(100); await page.click('#delyes'); await wait(500);
  }

  console.log('the training drill');
  {
    const N = 60;
    const T = () => page.evaluate(() => document.getElementById('pad').pad.training.map(r => JSON.parse(JSON.stringify(r))));
    const DS = () => page.evaluate(() => JSON.parse(localStorage.getItem('nib-drill-v1') || 'null'));
    const bar = () => page.evaluate(() => {
      const g = id => document.getElementById(id);
      return { hidden: g('drill').hidden, n: g('dn').textContent, prompt: [...document.querySelectorAll('#dprompt .dl')].map(e => e.textContent).join(' | '), read: g('dread').textContent, state: g('dread').dataset.state,
        warn: g('drill').classList.contains('warn'), how: g('dhow').textContent, sum: g('dsum').hidden ? null : g('dsum').textContent, right: !g('dright').disabled };
    });
    const until = (state, ms) => page.waitForFunction(s => document.getElementById('dread').dataset.state === s, { timeout: ms || 20000 }, state).catch(() => {});
    const goText = async () => { await closeSettings(); await page.click('#gear'); await wait(150); return page.evaluate(() => ({ go: document.getElementById('drillgo').textContent, again: !document.getElementById('drillagain').hidden })); };
    const e1 = findX('7-1='), eMiss = findX('3+4='), eF = findX('7+4=');
    if (e1 && eMiss && eF) {
      // something on the page, so the drill has to take a new one
      await page.click('#gear'); await wait(150);
      if (await page.$eval('#train', e => e.getAttribute('aria-checked')) === 'true') { await page.click('#train'); await wait(100); }
      await closeSettings();
      await write(eMiss, [0.1, 0.5, 0.25, 0.1]); await wait(600); await sameReadX();
      const pg0 = await page.$eval('#pageno', e => e.textContent), np0 = +pg0.split('/')[1];
      const g0 = await goText();
      ok(g0.go === 'Start the drill' && !g0.again, 'Settings, Training: "Start the drill"');
      await page.click('#drillgo'); await wait(400);
      let B = await bar();
      const meta = await page.evaluate(() => document.getElementById('pad').trainMeta);
      ok(!B.hidden && B.n === `1 / ${N}` && B.prompt === '7 − 1 =' && await page.$eval('#settings', e => e.hidden), `it shows the drill bar with prompt 1 and "1 / ${N}" (${B.prompt}, ${B.n})`);
      ok(await page.$eval('#train', e => e.getAttribute('aria-checked')) === 'true' && await page.evaluate(() => document.getElementById('pad').train), 'and turns "Keep writing for training" on');
      ok(await page.$eval('#pageno', e => e.textContent) === `${np0 + 1} / ${np0 + 1}` && await nStrokesX() === 0, `on a new page (${pg0} -> ${await page.$eval('#pageno', e => e.textContent)})`);
      ok(meta && meta.expect === '7-1=' && meta.drill === 'v1' && meta.item === 1 && meta.how === 'any', 'the pad\'s trainMeta is the prompt: ' + JSON.stringify(meta));
      const geo = await page.evaluate(() => { const b = document.getElementById('drill').getBoundingClientRect(), f = document.getElementById('surface').getBoundingClientRect(), r = document.getElementById('rail').getBoundingClientRect();
        return { top: Math.abs(b.top - f.top) < 1 && b.top >= r.bottom - 1, width: Math.abs(b.width - f.width) < 1, small: [...document.querySelectorAll('#drill button')].filter(x => x.offsetParent && x.getBoundingClientRect().height < 44).length,
          right: getComputedStyle(document.getElementById('dright')).backgroundColor, gold: getComputedStyle(document.documentElement).getPropertyValue('--gold').trim(), font: parseFloat(getComputedStyle(document.getElementById('dprompt')).fontSize) }; });
      ok(geo.top && geo.width && geo.small === 0 && geo.font >= 28, `across the top of the board under the rail, the prompt large (${geo.font} px), every button at least 44 px`);
      ok(geo.right === 'rgb(201, 162, 39)', 'Right is the gold button: ' + geo.right);
      ok(B.read === 'Write it on the board.' && !B.right, 'before any writing: "Write it on the board.", Right not yet');
      await page.screenshot({ path: path.join(out, 'board-test-drill-start.png') });
      // the prompt copied: read, and in gold
      await write(e1, [0.2, 0.45, 0.3, 0.12]);
      await wait(200);
      const early = (await bar()).state;
      await until('match');
      B = await bar();
      const col = await page.evaluate(() => ({ c: getComputedStyle(document.getElementById('dread')).color, g: getComputedStyle(document.documentElement).getPropertyValue('--gold-ink').trim() }));
      ok(early === 'wait' && B.state === 'match' && /^Read: 7 − 1 = → 6$/.test(B.read) && B.right, `once read and rested, the reading line: "${B.read}" (${B.state})`);
      ok(col.c === 'rgb(138, 106, 16)', 'in gold: ' + col.c);
      await page.screenshot({ path: path.join(out, 'board-test-drill-read.png') });
      await page.click('#dright'); await wait(400);
      let R = await T();
      const r1 = R.filter(r => r.item === 1);
      ok(r1.length === 1 && r1[0].expect === '7-1=' && r1[0].verified === true && r1[0].drill === 'v1' && r1[0].how === 'any' && r1[0].latex === '7-1=',
        `Right: pad.training has one record for it, with expect, verified: true, item: 1 (${JSON.stringify({ expect: r1[0] && r1[0].expect, verified: r1[0] && r1[0].verified, item: r1[0] && r1[0].item, latex: r1[0] && r1[0].latex })})`);
      B = await bar();
      ok(await nStrokesX() === 0 && B.n === `2 / ${N}` && B.prompt === '17 + 71 =', `the board is empty and the bar shows prompt 2 (${B.prompt})`);
      let ds = await DS();
      ok(ds && ds.drill === 'v1' && ds.pos === 1 && ds.done.length === 1 && ds.done[0] === r1[0].key && ds.skipped.length === 0, 'progress kept in nib-drill-v1: ' + JSON.stringify(ds && { pos: ds.pos, done: ds.done.length, skipped: ds.skipped }));
      await page.waitForFunction(() => { const t = JSON.parse(localStorage.getItem('nib-train-v1') || 'null'); return t && t.records.some(r => r.verified === true); }, { timeout: 3000 }).catch(() => {});
      ok(await page.evaluate(() => JSON.parse(localStorage.getItem('nib-train-v1')).records.some(r => r.item === 1 && r.verified === true)), 'and the verified record is in the stored log');
      // something else: coral
      await write(eMiss, [0.2, 0.45, 0.3, 0.12]);
      await until('miss');
      B = await bar();
      const col2 = await page.evaluate(() => getComputedStyle(document.getElementById('dread')).color);
      ok(B.state === 'miss' && /^Read: 3 \+ 4 =/.test(B.read) && col2 === 'rgb(217, 101, 79)', `writing that does not match: "${B.read}" in coral (${col2})`);
      await wait(4500);                                      // long enough to be kept by itself; a skip takes it out again
      await page.click('#dskip'); await wait(400);
      B = await bar(); ds = await DS(); R = await T();
      ok(B.n === `3 / ${N}` && ds.pos === 2 && JSON.stringify(ds.skipped) === '[2]' && await nStrokesX() === 0, `Skip: on to 3, item 2 remembered as skipped (${JSON.stringify(ds.skipped)})`);
      ok(!R.some(r => r.item === 2) && !R.some(r => r.latex === '3+4=' && r.expect), 'and nothing kept for it');
      // Undo in the bar takes back the last stroke; Back goes to the prompt before and drops what it kept
      await write(e1, [0.2, 0.45, 0.3, 0.12]); await wait(300);
      const nBefore = await nStrokesX();
      await page.click('#dundo'); await wait(300);
      ok(await nStrokesX() === nBefore - 1, `Undo in the bar takes back the last stroke (${nBefore} -> ${await nStrokesX()})`);
      await page.click('#dback'); await wait(400);
      B = await bar(); ds = await DS(); R = await T();
      ok(B.n === `2 / ${N}` && ds.pos === 1 && ds.skipped.length === 0 && await nStrokesX() === 0, `Back: prompt 2 again, its skip unmarked, the board cleared (${B.n}, skipped ${JSON.stringify(ds.skipped)})`);
      await page.click('#dback'); await wait(400);
      B = await bar(); ds = await DS(); R = await T();
      ok(B.n === `1 / ${N}` && ds.pos === 0 && ds.done.length === 0 && !R.some(r => r.item === 1), `Back again: prompt 1, and the record Right kept for it is dropped (${R.length} records)`);
      ok(await page.$eval('#dback', e => e.disabled), 'Back is off at the first prompt');
      await write(e1, [0.2, 0.45, 0.3, 0.12]); await until('match'); await page.click('#dright'); await wait(400);
      await write(eMiss, [0.2, 0.45, 0.3, 0.12]); await until('miss'); await page.click('#dskip'); await wait(400);
      ds = await DS();
      ok(ds.pos === 2 && JSON.stringify(ds.skipped) === '[2]' && ds.done.length === 1, 'done again the same way: at prompt 3 with item 2 skipped');
      // Stop, Continue, reload
      await page.click('#dstop'); await wait(300);
      ok((await bar()).hidden && await page.evaluate(() => document.getElementById('pad').trainMeta === null), 'Stop hides the bar (and the pad has no trainMeta)');
      let g = await goText();
      ok(g.go === `Continue the drill · 3 / ${N}` && g.again, 'Settings shows: ' + g.go);
      await closeSettings(); await wait(600);
      await page.reload({ waitUntil: 'load' }); await wait(800);
      g = await goText();
      ok((await bar()).hidden && g.go === `Continue the drill · 3 / ${N}`, 'after a reload, still: ' + g.go);
      await page.click('#drillgo'); await wait(400);
      B = await bar();
      ok(!B.hidden && B.n === `3 / ${N}` && B.prompt === '1001 − 101 =', `Continue: prompt 3 (${B.prompt})`);
      ok(await page.evaluate(() => document.getElementById('pad').trainMeta.item) === 3, 'with its trainMeta');
      // the finger prompts: written with a mouse, the bar says so in coral
      await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('nib-drill-v1')); d.pos = 55; d.active = true; localStorage.setItem('nib-drill-v1', JSON.stringify(d)); });
      await page.reload({ waitUntil: 'load' }); await wait(800);
      B = await bar();
      ok(!B.hidden && B.n === `56 / ${N}` && B.prompt === '7 + 4 =' && B.how === 'With your finger' && !B.warn, `a drill under way comes back after a reload; prompt 56 says "${B.how}"`);
      await write(eF, [0.2, 0.45, 0.3, 0.12]);
      await until('match');
      B = await bar();
      const bc = await page.evaluate(() => getComputedStyle(document.getElementById('drill')).borderLeftColor);
      ok(B.warn && /With your finger — that was a mouse: with your finger, please/.test(B.how) && bc === 'rgb(217, 101, 79)', `written with a mouse: coral border and "${B.how}"`);
      await page.screenshot({ path: path.join(out, 'board-test-drill-finger.png') });
      await page.click('#dright'); await wait(400);
      R = await T();
      const rF = R.find(r => r.item === 56);
      ok(rF && rF.how === 'finger' && rF.verified === true && rF.types.every(t => t === 'mouse'), 'it is still kept (how: finger, types: mouse)');
      // the end: jump to the last prompt
      await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('nib-drill-v1')); d.pos = 59; localStorage.setItem('nib-drill-v1', JSON.stringify(d)); });
      await page.reload({ waitUntil: 'load' }); await wait(800);
      B = await bar();
      ok(B.n === `60 / ${N}` && B.prompt === '3(x − 2) =', 'the last prompt: ' + B.prompt);
      await page.click('#dskip'); await wait(400);
      B = await bar();
      const endBtns = await page.evaluate(() => ({ save: !document.getElementById('dend').hidden && !document.getElementById('dsave').disabled, again: !!document.getElementById('dagain').offsetParent, play: document.getElementById('dplay').hidden }));
      ok(B.sum && /^2 done, 2 skipped, 0 fixed/.test(B.sum) && /Skipped: 2, 60/.test(B.sum) && endBtns.save && endBtns.again && endBtns.play, `after the last prompt, the summary: "${B.sum}" with Save training and Start again`);
      await page.screenshot({ path: path.join(out, 'board-test-drill-end.png') });
      // Save training from the summary, and the converter on it
      await page.evaluate(() => { window.__dl = null; window.__aclick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl = { name: this.download, href: this.href }; else window.__aclick.call(this); }; });
      await page.click('#dsave'); await wait(500);
      const dl = await page.evaluate(async () => { const d = window.__dl; if (!d) return null; return { name: d.name, text: await (await (await fetch(d.href)).blob()).text() }; });
      await page.evaluate(() => { HTMLAnchorElement.prototype.click = window.__aclick; });
      let F = null; try { F = JSON.parse(dl.text); } catch (e) { F = null; }
      const ver = F ? F.records.filter(r => r.verified === true) : [];
      ok(F && F.records.length === 2 && ver.length === 2 && ver.every(r => r.expect && r.drill === 'v1' && Number.isInteger(r.item) && r.how), `Save training on the bar saves the file (${F && F.records.length} records, ${ver.length} verified; the writing on the page before the drill, made with training off, is not among them)`);
      if (F) {
        const dir = path.join(out, 'downloads'); fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'drill-' + dl.name), jl = path.join(dir, 'drill.jsonl'), jv = path.join(dir, 'drill-verified.jsonl');
        fs.writeFileSync(file, dl.text);
        const conv = (args, o) => require('child_process').spawnSync('python3', ['-I', path.join(__dirname, '..', 'tools', 'training_to_jsonl.py'), file, o].concat(args), { encoding: 'utf8' });
        const all = conv([], jl), only = conv(['--verified-only'], jv);
        const rowsA = all.status === 0 ? fs.readFileSync(jl, 'utf8').trim().split('\n').map(JSON.parse) : [];
        const rowsV = only.status === 0 ? fs.readFileSync(jv, 'utf8').trim().split('\n').map(JSON.parse) : [];
        ok(all.status === 0 && rowsA.length === F.records.length && rowsA.filter(w => w.gold).length === 2 && rowsA.every(w => w.gold === (w.verified === true)) && /^2 gold/m.test(all.stdout),
          'the converter carries the drill fields and marks the verified rows that read as their prompt gold: ' + (all.stdout || all.stderr).trim().split('\n').pop());
        ok(only.status === 0 && rowsV.length === 2 && rowsV.every(w => w.verified === true && w.gold && w.expect && w.drill === 'v1' && w.item && w.how) && rowsV.map(w => w.item).sort((a, b) => a - b).join() === '1,56',
          '--verified-only writes only those (' + rowsV.map(w => `${w.item}: ${w.latex} ${w.how}`).join(', ') + ')');
      }
      await page.click('#dagain'); await wait(400);
      B = await bar(); ds = await DS();
      ok(B.n === `1 / ${N}` && ds.pos === 0 && ds.done.length === 0 && ds.skipped.length === 0, 'Start again: prompt 1, progress reset');
      // Fix: a symbol corrected, the reading line follows it, and Right keeps it fixed and verified
      await write(e1, [0.2, 0.45, 0.3, 0.12]);
      await until('match');
      await page.click('#dfix'); await wait(200);
      const fx = await page.evaluate(() => ({ on: document.getElementById('dfix').getAttribute('aria-pressed') === 'true' && document.getElementById('pad').mode === 'fix' }));
      const sym = await page.evaluate(() => { const P = document.getElementById('pad').pad, s = P.result.symbols.find(q => q.label === '1'); return s ? { x: s.box.x + s.box.w / 2, y: s.box.y + s.box.h / 2 } : null; });
      if (fx.on && sym) {
        const cbF = await (await page.$('#pad canvas')).boundingBox();
        await page.mouse.click(cbF.x + sym.x, cbF.y + sym.y); await wait(250);
        const alt = await page.$$eval('#fixpop .cand[aria-pressed="false"]', bs => { const l = bs.map(b => b.dataset.label); return l.find(x => /^[0-9]$/.test(x)) || l[0]; });
        await page.click(`#fixpop .cand[data-label="${alt.replace(/\\/g, '\\\\')}"]`);
        await until('miss', 8000);
        B = await bar();
        ok(B.state === 'miss' && B.read.includes('Read: 7 − ' + alt), `Fix on the bar turns Fix on; a symbol changed (1 -> ${alt}) and the reading line follows: "${B.read}"`);
        await page.click('#dright'); await wait(400);
        R = await T(); ds = await DS();
        const rx = R.find(r => r.item === 1 && r.verified === true);
        ok(rx && rx.fixed.length === 1 && rx.fixed[0].label === alt && JSON.stringify(ds.fixed) === '[1]' && ds.pos === 1 && (await page.evaluate(() => document.getElementById('pad').mode)) === 'draw',
          'Right then keeps it fixed and verified, counts it as fixed, and Fix mode ends');
        await page.evaluate(() => Nib.memory.clear());
      } else ok(false, 'Fix from the drill bar (' + JSON.stringify(fx) + ', a 1 to fix: ' + !!sym + ')');
      // Erase left on: the bar says so (the pen would rub out, not write)
      await page.click('#erase'); await wait(200);
      B = await bar();
      ok(/Erase is on/.test(B.read) && !B.right, `with Erase on the bar says so: "${B.read}"`);
      await page.click('#erase'); await wait(200);
      ok(!/Erase is on/.test((await bar()).read), 'and stops saying so when Erase goes off');
      // prompt 7 as he wrote it on the tablet (2 · 22 + 2 = with spaces between the pieces, with the pen): one piece, matched
      for (let i = 0; i < 5; i++) { await page.click('#dskip'); await wait(150); }
      B = await bar();
      ok(B.n === `7 / ${N}`, 'skipped on to prompt 7');
      {
        const T2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'training_2026-11-07b.json'), 'utf8'));
        const main = T2.records[68].strokes, eq = T2.records[67].strokes.slice(1).map(s => s.map(p => [p[0] + 299, p[1] + 18]));
        const cb7 = await (await page.$('#pad canvas')).boundingBox(), ox = cb7.x + 60, oy = cb7.y + cb7.height * 0.45;
        for (const s of main.concat(eq)) {
          const P = s.map(p => [ox + p[0], oy + p[1]]);
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P[0][0], y: P[0][1], button: 'left', clickCount: 1, pointerType: 'pen' });
          for (let i = 1; i < P.length; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: P[i][0], y: P[i][1], button: 'left', pointerType: 'pen' });
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P[P.length - 1][0], y: P[P.length - 1][1], button: 'left', clickCount: 1, pointerType: 'pen' });
        }
        await until('match');
        B = await bar();
        const parts7 = await page.evaluate(() => (document.getElementById('pad').pad.result.parts || []).length);
        ok(B.state === 'match' && parts7 === 1 && /Read: 2 · 22 \+ 2 = → 46/.test(B.read), `his 2 · 22 + 2 = is read as one piece and matches: "${B.read}" (${parts7} piece)`);
        await page.click('#dright'); await wait(400);
        R = await T();
        ok(R.some(r => r.item === 7 && r.verified === true && r.expect === '2\\cdot 22+2=' && r.types.every(t => t === 'pen')), 'Right keeps it, verified, written with the pen');
      }
      // prompt 36 as he wrote it: 4x − 7 = 21 with "x =" dropped well under it (his pen strokes from the third file): one piece, matched
      await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('nib-drill-v1')); d.pos = 35; d.active = true; localStorage.setItem('nib-drill-v1', JSON.stringify(d)); });
      await page.reload({ waitUntil: 'load' }); await wait(800);
      B = await bar();
      ok(!B.hidden && B.n === `36 / ${N}` && /first line, then the second/.test(B.how), `prompt 36 after a reload: "${B.prompt}" — ${B.how}`);
      {
        const T3 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'training_2026-11-07c.json'), 'utf8'));
        const eq = T3.records[100].strokes, xe = T3.records[101].strokes, hEq = Math.max(...eq.flat().map(p => p[1]));
        const cb6 = await (await page.$('#pad canvas')).boundingBox(), ox = cb6.x + 80, oy = cb6.y + cb6.height * 0.4;
        const penWrite = async strokes => { for (const s of strokes) {
          const P = s.map(p => [ox + p[0], oy + p[1]]);
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P[0][0], y: P[0][1], button: 'left', clickCount: 1, pointerType: 'pen' });
          for (let i = 1; i < P.length; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: P[i][0], y: P[i][1], button: 'left', pointerType: 'pen' });
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P[P.length - 1][0], y: P[P.length - 1][1], button: 'left', clickCount: 1, pointerType: 'pen' });
        } };
        await penWrite(eq);
        await penWrite(xe.map(s => s.map(p => [p[0] + 150, p[1] + hEq + 70])));      // 70 px under: further than nearness alone joins
        await until('match');
        B = await bar();
        const parts36 = await page.evaluate(() => (document.getElementById('pad').pad.result.parts || []).length);
        ok(B.state === 'match' && parts36 === 1 && /Read: 4x − 7 = 21 \/ x = → 7/.test(B.read), `"x =" 70 px under the equation joins it, and the drill matches both lines: "${B.read}" (${parts36} piece)`);
        await page.click('#dright'); await wait(400);
        R = await T();
        const r36 = R.find(r => r.item === 36 && r.verified === true);
        ok(r36 && r36.latex === '\\begin{gathered}4x-7=21 \\\\ x=\\end{gathered}' && r36.strokes.length === eq.length + xe.length && Array.isArray(r36.widths), `Right keeps both lines as one record (${r36 ? r36.strokes.length : 0} strokes, with widths)`);
      }
      // Finger: Ignored (pen only) in Settings — a finger writes nothing; a finger prompt says so
      await page.click('#gear'); await wait(150); await page.click('#settings .seg[data-set="finger"] button[data-v="ignored"]'); await wait(150); await closeSettings();
      {
        const cbg = await (await page.$('#pad canvas')).boundingBox(), n0 = await page.evaluate(() => document.getElementById('pad').strokes.length);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cbg.x + 300, y: cbg.y + 500 }] });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cbg.x + 300 + 8 * i, y: cbg.y + 500 + i }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(1800);
        ok(await page.evaluate(() => document.getElementById('pad').strokes.length) === n0 && await page.evaluate(() => document.getElementById('pad').hasAttribute('pen-only')), 'Finger: Ignored — a finger stroke writes nothing (pen-only on the pad)');
        await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('nib-drill-v1')); d.pos = 55; d.active = true; localStorage.setItem('nib-drill-v1', JSON.stringify(d)); });
        await page.reload({ waitUntil: 'load' }); await wait(800);
        B = await bar();
        ok(B.n === `56 / ${N}` && /finger is set to do nothing/.test(B.read) && await page.evaluate(() => document.getElementById('pad').hasAttribute('pen-only')), `the setting is kept, and a finger prompt says so: "${B.read}"`);
        await page.click('#gear'); await wait(150); await page.click('#settings .seg[data-set="finger"] button[data-v="writes"]'); await wait(150); await closeSettings();
        ok(!(await page.evaluate(() => document.getElementById('pad').hasAttribute('pen-only'))) && !/finger is set/.test((await bar()).read), 'Finger: Writes again');
        await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('nib-drill-v1')); d.pos = 37; localStorage.setItem('nib-drill-v1', JSON.stringify(d)); });
        await page.reload({ waitUntil: 'load' }); await wait(800);
      }
      await page.click('#dstop'); await wait(200);
      // tidy up: forget the log, training off
      await page.click('#gear'); await wait(150);
      await page.click('#forgettrain'); await wait(100); await page.click('#forgetyes'); await wait(200);
      await page.click('#train'); await wait(100); await closeSettings();
      ok((await bar()).hidden && await page.$eval('#train', e => e.getAttribute('aria-checked')) === 'false', 'stopped; training off again');
    } else ok(false, 'writers for 7 - 1 =, 3 + 4 = and 7 + 4 =');
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
    await closeSettings();
    const penSize = async v => { await page.click('[data-tool="pen"]'); await wait(100); if (await page.$eval('#stylepop', e => e.hidden)) { await page.click('[data-tool="pen"]'); await wait(150); } await page.click(`#sizes [data-v="${v}"]`); await wait(100); await page.keyboard.press('Escape'); await wait(100); };
    await penSize(5);
    ok(await page.evaluate(() => { const p = document.getElementById('pad'); return p.pad.o.width === 5 && p.tool.size === 5; }), 'the pen, tapped again: size 5 (its strokes, and answers, are 5 px)');
    await penSize(2.5);
    ok(await page.evaluate(() => { const p = document.getElementById('pad'); return p.pad.o.width === 2.5 && p.tool.size === 2.5; }), 'size 2.5');
    await setting('solve', 'off');
    ok(await page.$eval('#solve', e => e.getAttribute('aria-pressed')) === 'false' && await page.evaluate(() => !document.getElementById('pad').solve), 'Answers Off is the Solve button');
    await setting('solve', 'on');
    await penSize(5);
    await setting('rail', 'left'); await setting('theme', 'dark'); await closeSettings();
    await wait(800);
    await page.reload({ waitUntil: 'load' }); await wait(800);
    const kept = await page.evaluate(() => ({ rail: document.getElementById('board').dataset.rail, theme: document.documentElement.getAttribute('data-theme'), w: document.getElementById('pad').pad.o.width, solve: document.getElementById('pad').solve, reveal: document.getElementById('pad').reveal }));
    ok(kept.rail === 'left' && kept.theme === 'dark' && kept.w === 5 && kept.solve && kept.reveal, 'after a reload the settings are kept: ' + JSON.stringify(kept));
    await page.screenshot({ path: path.join(out, 'board-test-left-dark.png') });
    await setting('theme', 'system'); await closeSettings(); await penSize(3.5);
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
      const seen = () => page.evaluate(() => { const P = document.getElementById('pad').pad, d = P.dpr, W = P.canvas.width / d, H = P.canvas.height / d;
        const b = P.strokes.map(Nib._internals.sbox).reduce((a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])]);
        const a = P.toScreen([b[0], b[1]]), z = P.toScreen([b[2], b[3]]);
        return { W, H, z: P.cam.z, x: P.cam.x, y: P.cam.y, inside: a[0] >= 0 && a[1] >= 0 && z[0] <= W && z[1] <= H, hist: P.history.length, fixOk: P.fixes.length === 1 && P.fixes[0].strokes[0] === P.strokes[0] }; });
      const b0 = await box(), L0 = await latex(), s0 = await seen();
      await page.setViewport({ width: 360, height: 760 }); await wait(500);
      const s1 = await seen();
      ok(b0[2] > s1.W && s1.z < 1 && s1.inside && JSON.stringify(await box()) === JSON.stringify(b0), `writing that no longer fits stays in sight: the board zooms out to ${Math.round(s1.z * 100)}% and nothing moves (${b0.join(',')} on ${Math.round(s1.W)} px)`);
      ok(s1.hist === s0.hist && s1.fixOk, 'nothing goes into the history, and the correction stays with its stroke');
      await wait(600); await sameReadX();
      ok(await latex() === L0, 'and it reads the same: ' + await latex());
      ok(await page.$eval('#zpct', e => e.textContent) === Math.round(s1.z * 100) + '%', 'the zoom shows ' + await page.$eval('#zpct', e => e.textContent));
      await page.setViewport({ width: 1280, height: 760 }); await wait(500);
      const s2 = await seen();
      ok(s2.z === s0.z && s2.x === s0.x && s2.y === s0.y, `a bigger board again: back to ${Math.round(s2.z * 100)}% where it was`);
      // a page put away at full size and taken out on the smaller board is fitted too
      await page.click('#newpage'); await wait(300);
      await page.setViewport({ width: 360, height: 760 }); await wait(400);
      await page.click('#prev'); await wait(400);
      const s3 = await seen();
      ok(s3.z < 1 && s3.inside, `a page taken out on a smaller board shows all its writing too (${Math.round(s3.z * 100)}%)`);
      // an empty page is not zoomed by a resize
      await page.click('#next'); await wait(300);
      ok(await page.evaluate(() => document.getElementById('pad').pad.cam.z) === 1, 'an empty page stays at 100%');
      await page.setViewport({ width: 1280, height: 760 }); await wait(400);
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

  console.log('a new network learns the corrections kept in the training log');
  {
    const mp = await browser.newPage(); mp.on('pageerror', e => errors.push(String(e)));
    await mp.setViewport({ width: 1280, height: 800 });
    await mp.goto(url, { waitUntil: 'load' }); await wait(800);
    const T3 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'training_2026-11-07c.json'), 'utf8'));
    const recs = [T3.records[75], T3.records[92]], nFixed = recs.reduce((n, r) => n + r.fixed.length, 0);
    const kept = await mp.evaluate((recs) => {
      const was = { t: localStorage.getItem('nib-train-v1'), m: localStorage.getItem('nib-memory-v1') };
      localStorage.setItem('nib-train-v1', JSON.stringify({ v: 1, records: recs }));
      localStorage.setItem('nib-memory-v1', JSON.stringify({ model: 'an-older-network', items: [{ l: '7', v: Array(192).fill(0.07) }, { l: '9', v: Array(192).fill(-0.07) }] }));
      return was;
    }, recs);
    await mp.reload({ waitUntil: 'load' }); await wait(1500);
    const m1 = await mp.evaluate(() => { const M = JSON.parse(localStorage.getItem('nib-memory-v1')); return { model: M.model, items: M.items.length, labels: M.items.map(i => i.l), now: Nib.memory.model, size: Nib.memory.size }; });
    ok(m1.model === m1.now && m1.size === nFixed && m1.items === nFixed, `the old network's corrections are dropped and the ${nFixed} in the training log are learned again for this one (${JSON.stringify(m1)})`);
    ok(recs.every(r => r.fixed.every(f => m1.labels.includes(f.label === '\\cdot' ? '.' : f.label))), 'with their labels');
    await mp.reload({ waitUntil: 'load' }); await wait(1200);
    ok(await mp.evaluate(() => Nib.memory.size) === nFixed, 'and only once: a second load learns nothing more');
    await mp.evaluate((was) => {
      if (was.t === null) localStorage.removeItem('nib-train-v1'); else localStorage.setItem('nib-train-v1', was.t);
      if (was.m === null) localStorage.removeItem('nib-memory-v1'); else localStorage.setItem('nib-memory-v1', was.m);
    }, kept);
    await mp.close();
  }

  console.log('phone, dark');
  const ph = await browser.newPage(); ph.on('pageerror', e => errors.push(String(e)));
  await ph.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await ph.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ph.goto(url, { waitUntil: 'load' }); await wait(1500);
  ok(await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'no sideways scrolling on a phone');
  const bg = await ph.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg !== 'rgb(251, 248, 239)', 'dark mode changes the board color: ' + bg);
  await ph.screenshot({ path: path.join(out, 'board-test-phone-dark.png') });
  await browser.close();
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
