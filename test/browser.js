// Headless check of the demo page: loads it from file://, draws real ink with the mouse,
// reads back the LaTeX, and saves screenshots (desktop light, phone light + dark).
// node test/browser.js <page.html> <outdir> [expressionId]
const path = require('path');
const fs = require('fs');
const puppeteer = require(require('./data').npm('puppeteer-core'));

(async () => {
  const [page_ = require('path').join(__dirname, '..', 'dist', 'Nib.html'), out = require('path').join(__dirname, 'shots'), id] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: require('./data').needChrome(), headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const errors = [];
  const url = 'file://' + path.resolve(page_);

  // 1. desktop: sample loads and is recognized
  let page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
  const tLoad = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#latex').textContent.length > 0, { timeout: 30000 }).catch(() => {});
  const sampleMs = Date.now() - tLoad;
  await new Promise(r => setTimeout(r, 300));
  const sampleLatex = await page.$eval('#latex', e => e.textContent);
  await page.screenshot({ path: out + '/desktop.png' });

  // 2. clear, then draw an expression with the mouse
  const rows = fs.readFileSync(require('./data').need('test.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const expr = id ? rows.find(r => r.id === id) : rows.find(r => r.truth && /\\frac\{[0-9]+\}\{[0-9]+\}x/.test(r.truth)) || rows[0];
  await page.click('#clear');
  const box = await (await page.$('#pad canvas')).boundingBox();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of expr.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const k = Math.min((box.width - 80) / (x1 - x0), (box.height * 0.6) / (y1 - y0));
  const tx = p => [box.x + 40 + (p[0] - x0) * k, box.y + box.height * 0.2 + (p[1] - y0) * k];
  const t0 = Date.now();
  for (const s of expr.strokes) {
    const pts = s.map(tx);
    await page.mouse.move(pts[0][0], pts[0][1]);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i += 2) await page.mouse.move(pts[i][0], pts[i][1]);
    await page.mouse.move(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    await page.mouse.up();
  }
  const tUp = Date.now();
  await page.waitForFunction(() => document.querySelector('#latex').textContent.length > 0, { timeout: 30000 }).catch(() => {});
  const readMs = Date.now() - tUp;
  await new Promise(r => setTimeout(r, 300));
  const drawn = await page.$eval('#latex', e => e.textContent);
  const timing = await page.$eval('#timing', e => e.textContent);
  await page.click('#boxes');
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: out + '/desktop-drawn.png' });
  // tap the first symbol chip to open its alternatives
  const chip = await page.$('#chips .chip');
  if (chip) { await chip.click(); await new Promise(r => setTimeout(r, 200)); }
  const alts = await page.$$eval('#alts .chip', a => a.length);
  // the views: typeset in place, my hand without a hand saved (explained), back to ink — the reading never changes
  await page.click('#boxes');                                   // boxes off again, so the canvas shows only the view
  const views = {};
  for (const v of ['ink', 'typeset', 'tidy', 'hand', 'ink']) {
    await page.click(`#views button[data-view="${v}"]`);
    await new Promise(r => setTimeout(r, 900));
    views[v + (views[v] ? '2' : '')] = await page.evaluate(() => ({
      latex: document.querySelector('#latex').textContent,
      img: document.querySelector('#pad canvas').toDataURL(),
      note: document.getElementById('handnote').hidden ? '' : document.getElementById('handnote').textContent,
      file: !document.getElementById('handfile').hidden,
    }));
    if (v === 'typeset') await page.screenshot({ path: out + '/desktop-typeset.png' });
  }
  const viewFails = [];
  // Solve on: a reading without a trailing "=" is left as it is, and nothing breaks
  await page.click('#solve'); await new Promise(r => setTimeout(r, 600));
  const sv = await page.evaluate(() => ({ pressed: document.getElementById('solve').getAttribute('aria-pressed'), latex: document.querySelector('#latex').textContent }));
  if (sv.pressed !== 'true' || sv.latex !== drawn) viewFails.push('Solve toggle changed the reading: ' + sv.latex);
  await page.click('#solve'); await new Promise(r => setTimeout(r, 300));
  if (Object.values(views).some(x => x.latex !== drawn)) viewFails.push('a view changed the reading');
  if (views.typeset.img === views.ink.img || views.tidy.img === views.ink.img) viewFails.push('a view did not change what is drawn');
  if (views.ink2.img !== views.ink.img) viewFails.push('back to ink does not show the ink as written');
  if (!/Replicator/.test(views.hand.note) || !views.hand.file) viewFails.push('My hand without a hand does not explain itself');
  if (views.ink2.note || views.ink2.file) viewFails.push('the hand note stays after leaving My hand');
  await page.close();

  // 3. phone, light and dark
  for (const scheme of ['light', 'dark']) {
    page = await browser.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(url, { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 1200));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.screenshot({ path: `${out}/phone-${scheme}.png`, fullPage: true });
    console.log(`phone ${scheme}: horizontal overflow ${overflow}px`);
    await page.close();
  }
  await browser.close();
  console.log('sample latex :', sampleLatex, `(${sampleMs} ms from navigation, includes page load)`);
  console.log(`result ${readMs} ms after the last pen-up (includes the 450 ms rest delay)`);
  console.log('drew', expr.id, 'truth', expr.truth);
  console.log('recognized   :', drawn, '|', timing, '| alternatives shown:', alts);
  console.log('views        :', viewFails.length ? 'FAIL ' + viewFails.join('; ') : 'ink, typeset, tidy, my hand (explained) and back: ok');
  console.log('errors:', errors.length ? errors : 'none');
  process.exit(errors.length || viewFails.length ? 1 : 0);
})();
