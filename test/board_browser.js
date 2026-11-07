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
  await page.screenshot({ path: path.join(out, 'board-test-tidy.png') });
  ok(await view() === 'tidy', 'the board opens in the tidy view');
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
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('no')); });
  await page.click('#copy'); await wait(300);
  ok(await page.evaluate(() => { const t = document.getElementById('latexout'); return !document.getElementById('latexbox').hidden && t.value === document.getElementById('pad').latex && t.selectionEnd - t.selectionStart === t.value.length; }), 'without a clipboard the LaTeX is shown selected');
  await page.click('#noteclose');
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
  ok(await page.$eval('#fix', e => e.getAttribute('aria-pressed')) === 'false' && await page.$eval('#fixpop', e => e.hidden) && /Changed to/.test(await page.$eval('#notetext', e => e.textContent)), 'then the board is back to writing, and says so');
  ok(await page.evaluate(n => document.getElementById('pad').strokes.length === n, nF), 'the taps wrote nothing on the board');
  const back = await findDigit(target.alt);
  await page.keyboard.press('x');
  await page.mouse.click(cbF.x + back.x, cbF.y + back.y); await wait(250);
  await page.click(`#fixpop .cand[data-label="${target.label}"]`);
  await wait(500); await settled();
  ok(await latex() === before, 'fixing it back restores the reading');
  await page.keyboard.press('x'); await wait(100);
  await page.mouse.click(cbF.x + 3, cbF.y + 3); await wait(150);
  ok(await page.$eval('#fixpop', e => e.hidden) && /Tap a symbol/.test(await page.$eval('#notetext', e => e.textContent)), 'tapping empty board while fixing asks for a symbol');
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
