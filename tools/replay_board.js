// Write strokes onto the Board again, as a pen would, and say what it reads and answers on every line.
//   node tools/replay_board.js strokes.json [page=dist/Board.html] [shot.png]
//   VIEW=1..4 (ink, tidy, my hand, typeset) and DARK=1 set how the shot looks.
// strokes.json: {width, height, strokes} in page px, in the order written (tools/strokes_from_screenshot.py makes one
// from a screenshot; test/fixtures/board_2026-11-04.json is one). The window is made that size, Solve is turned on.
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core'));
const [, , file, page_ = path.join(__dirname, '..', 'dist', 'Board.html'), shot] = process.argv;
if (!file) { console.log('usage: node tools/replay_board.js strokes.json [page] [shot.png]'); process.exit(1); }
const F = JSON.parse(fs.readFileSync(file, 'utf8'));

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (process.env.DARK) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.setViewport({ width: F.width, height: F.height });
  await page.goto('file://' + path.resolve(page_), { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 600));
  if (await page.$eval('#solve', e => e.getAttribute('aria-pressed')) !== 'true') await page.click('#solve');
  const cdp = await page.target().createCDPSession();
  for (const s of F.strokes) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s[0][0], y: s[0][1], button: 'left', clickCount: 1 });
    for (let i = 1; i < s.length; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s[i][0], y: s[i][1], button: 'left' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s[s.length - 1][0], y: s[s.length - 1][1], button: 'left', clickCount: 1 });
  }
  await new Promise(r => setTimeout(r, 1500));
  await page.waitForFunction(() => { const p = document.getElementById('pad'); return p.pad && !p.pad.anim && p.pad.result && p.pad.strokes.length === p.pad.resultStrokes.length; }, { timeout: 60000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 600));
  const lines = await page.evaluate(() => {
    const P = document.getElementById('pad').pad, by = new Map(P.answers.map(a => [a.line, a.latex]));
    const at = P.resultStrokes && P.resultStrokes.length ? P.resultStrokes : P.strokes;
    const out = []; let li = 0;
    for (const part of P.result.parts || []) {
      const r = part.result; if (!r) continue;
      r.lines.forEach((l, k) => {
        const ix = new Set();
        const walk = row => { for (const u of row) { for (const s of u.strokes || []) ix.add(part.idx[s]); for (const key of ['num', 'den', 'body', 'idx', 'sup', 'sub']) if (u[key]) walk(u[key]); } };
        walk(r.tree[k] || []);
        let b = [Infinity, Infinity, -Infinity, -Infinity];
        for (const i of ix) for (const q of at[i] || []) b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])];
        out.push({ latex: l.latex, box: b.map(Math.round), answer: by.has(li) ? by.get(li) : null }); li++;
      });
    }
    return out;
  });
  for (const l of lines) console.log(`  [${l.box.join(',')}]`.padEnd(24) + `${l.latex.padEnd(40)} ${l.answer === null ? '(no answer)' : '→ ' + l.answer}`);
  if (process.env.VIEW) { await page.keyboard.press(String(process.env.VIEW)); await new Promise(r => setTimeout(r, 1500)); }
  if (shot) await page.screenshot({ path: shot });
  if (errors.length) console.log('page errors:', errors.join(' | '));
  await browser.close();
})();
