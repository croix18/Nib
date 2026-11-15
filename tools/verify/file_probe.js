// A file that carries Nib, opened from file:// as a teacher opens it: which Nib is inside, which classifier it runs,
// and whether it reads. For a file the engine was just put into (Deckhand.html after tools/vendor_nib.py, the pages in
// dist/) before it is pushed.
//   node tools/verify/file_probe.js <file.html> [more files]         exit 1 on a page error, no Nib, or a wrong reading
'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const path = require('path'), fs = require('fs');
const puppeteer = require(T.npm('puppeteer-core'));
const FILES = process.argv.slice(2);
if (!FILES.length) { console.log('usage: node tools/verify/file_probe.js <file.html> [more files]'); process.exit(2); }
(async () => {
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, args: ['--no-sandbox'] });
  let bad = 0;
  for (const f of FILES) {
    const file = path.resolve(f);
    if (!fs.existsSync(file)) { console.log(`FAIL ${f}: not there`); bad++; continue; }
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
    const errors = [], said = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (/Nib/.test(m.text())) said.push(m.text().slice(0, 120)); });
    await page.goto('file://' + file, { waitUntil: 'load' }); await new Promise(r => setTimeout(r, 1500));
    const r = await page.evaluate(() => (window.Nib ? { nib: Nib.version, kernel: Nib.kernel,
      read: Nib.recognize([[[0, 0], [0, 40]], [[20, 20], [50, 20]], [[35, 5], [35, 35]], [[70, 2], [90, 0], [92, 18], [72, 40], [95, 40]]], { times: false }).latex } : null));
    const ok = !!r && r.read === '1+2' && errors.length === 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${f}: ` + (r ? `Nib ${r.nib}, classifier ${r.kernel}, reads ${r.read}` : 'no Nib in the page') +
      (errors.length ? ' | page errors: ' + errors.slice(0, 2).join(' ; ') : '') + (said.length ? ' | it said: ' + said.join(' ; ') : ''));
    await page.close();
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
