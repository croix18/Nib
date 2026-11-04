// The Replicator in a real browser: writes real handwriting into the boxes with the mouse, waits for the font,
// downloads it (as a file page and through a stand-in for the claude.ai downloads capability), reads it back,
// checks Chrome accepts and draws every font test/font_check.js made, copies the web-page CSS and uses it,
// tries undo, clear, open/save, a pen-weight change without freezing the page, Teach Nib, and screenshots
// desktop, phone and dark.
//   node test/replicator_browser.js [page=dist/Replicator.html] [outdir=test/shots]
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core'));
const opentype = require(path.join(__dirname, '..', 'demo', 'node_modules', 'opentype.js'));
const R = require(path.join(__dirname, '..', 'replicator', 'core.js'));
const D = process.env.NIB_DATA || path.join(__dirname, '..', 'training', 'scratch', 'data') + '/';

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const [page_ = path.join(__dirname, '..', 'dist', 'Replicator.html'), out = path.join(__dirname, 'shots')] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const dl = path.join(out, 'downloads'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });
  const rows = fs.readFileSync(D + 'test.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  const pool = {};
  for (const r of rows) for (const s of r.symbols) (pool[s.label] = pool[s.label] || []).push(s.strokes.map(k => r.strokes[k]));
  const G = R.GUIDE_FRAC;
  const place = (ch, st) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    let top = G.cap, bot = G.base;
    if (/[a-z]/.test(ch) && !/[bdfhklt]/.test(ch)) top = G.x;
    if (/[gjpqy]/.test(ch)) { top = G.x; bot = G.desc; }
    if ('-+='.includes(ch)) { top = G.x - 0.05; bot = G.base - 0.12; }
    const k = Math.min((bot - top) / Math.max(y1 - y0, 1e-9), 0.75 / Math.max(x1 - x0, 1e-9));
    return st.map(s => s.map(p => [0.12 + (p[0] - x0) * k, top + (p[1] - y0) * k]));
  };
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const errors = [];
  const watch = p => { p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); };
  const page = await browser.newPage(); watch(page);
  const cdp = await page.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }).catch(() => cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }));
  await page.evaluateOnNewDocument(() => {
    window.__long = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* unsupported */ }
  });
  await page.setViewport({ width: 1366, height: 900 });
  const url = 'file://' + path.resolve(page_);
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'load' });

  const writeChar = async (ch, strokes) => {
    for (const b of await page.$$('.box')) {
      if (await b.$eval('.ch', e => e.textContent) !== ch) continue;
      const c = await (await b.$('canvas')).boundingBox();
      for (const s of strokes) {
        const P = s.map(p => [c.x + p[0] * c.width, c.y + p[1] * c.height]);
        await page.mouse.move(P[0][0], P[0][1]); await page.mouse.down();
        for (let i = 1; i < P.length; i += 2) await page.mouse.move(P[i][0], P[i][1]);
        await page.mouse.move(P[P.length - 1][0], P[P.length - 1][1]); await page.mouse.up();
      }
      return true;
    }
    return false;
  };
  const tab = async id => { await page.click('#tab-' + id); await wait(150); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('replicator-v1') || '{}'));
  const strokesIn = d => Object.values(d.glyphs || {}).reduce((n, s) => n + s.length, 0);

  console.log('writing');
  const want = { upper: 'HABCDEFGILMNPRSTVXY', lower: 'abcdefghikmnopqrstuvwxyz', digits: '0123456789' };
  let written = 0;
  for (const [sec, chars] of Object.entries(want)) {
    await tab(sec);
    for (const ch of chars) { const st = pool[ch] && pool[ch][3 % pool[ch].length]; if (st && await writeChar(ch, place(ch, st))) written++; }
  }
  await tab('punct');
  for (const ch of ['.', '+', '=', '(', ')', '-']) {
    const st = pool[ch] && pool[ch][2];
    if (st && await writeChar(ch, ch === '.' ? [[[0.4, G.base - 0.03], [0.41, G.base - 0.02]]] : place(ch, st))) written++;
  }
  await page.waitForFunction(n => /^(\d+) of/.test(document.getElementById('status').textContent) && +document.getElementById('status').textContent.split(' ')[0] === n, { timeout: 30000 }, written).catch(() => {});
  const status = await page.$eval('#status', e => e.textContent);
  ok(status.startsWith(written + ' of '), `status counts what was written: "${status}" (${written} written)`);
  const tabs = await page.$$eval('.tab', ts => ts.map(t => t.textContent));
  ok(tabs.some(t => /Numbers\s*10\/10/.test(t)), 'the Numbers tab shows 10/10: ' + tabs.join(' | '));
  await page.$eval('#sample', e => { e.value = 'Hamburgers 3 + 4 = 7 (big deal)'; e.dispatchEvent(new Event('input')); });
  await tab('lower'); await wait(400);
  const pv = await page.evaluate(() => { const el = document.getElementById('preview'); return { fam: el.style.fontFamily, text: el.textContent, loaded: [...document.fonts].filter(f => f.family.startsWith('Replicator Preview') && f.status === 'loaded').length }; });
  ok(pv.loaded === 1 && /Replicator Preview/.test(pv.fam) && pv.text.startsWith('Hamburgers'), `the preview uses the new font (${pv.loaded} preview face loaded)`);
  await page.screenshot({ path: out + '/replicator-desktop.png' });

  console.log('undo and clear');
  const before = await stored();
  await page.click('#undo'); await wait(600);
  ok(strokesIn(await stored()) === strokesIn(before) - 1, 'undo removes the last stroke');
  const box = await page.$('.box.has'); const boxCh = await box.$eval('.ch', e => e.textContent);
  await box.hover(); await (await box.$('.x')).click(); await wait(600);
  ok(((await stored()).glyphs[boxCh] || []).length === 0, `the clear button empties "${boxCh}"`);
  await page.click('#undo'); await wait(600);
  ok(((await stored()).glyphs[boxCh] || []).length > 0, 'undo brings the cleared box back');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control'); await wait(400);
  ok(strokesIn(await stored()) === strokesIn(before) - 2, 'Ctrl+Z undoes too');

  console.log('settings without freezing the page');
  await page.evaluate(() => { window.__long.length = 0; const w = document.getElementById('weight'); w.value = 140; w.dispatchEvent(new Event('input')); });
  await page.waitForFunction(() => document.getElementById('preview').style.fontFamily.indexOf('Preview') > 0 && !document.querySelector('#status').textContent.includes('could not'), { timeout: 30000 });
  await wait(4000);
  const lt = await page.evaluate(() => window.__long.slice());
  ok(!lt.some(d => d > 250), 'rebuilding every glyph for a new pen weight never blocks the page for more than 0.25 s' + (lt.length ? ' (long tasks ' + lt.join(', ') + ' ms)' : ''));
  await page.evaluate(() => { const w = document.getElementById('weight'); w.value = 80; w.dispatchEvent(new Event('input')); });

  console.log('download as a file page');
  await page.click('#download');                                             // straight after a change: still exact
  let ttf = null;
  for (let t = 0; t < 60 && !ttf; t++) { await wait(250); ttf = fs.readdirSync(dl).find(f => f.endsWith('.ttf')); }
  ok(!!ttf, 'a .ttf file was downloaded: ' + ttf);
  let parsed = null;
  if (ttf) { const b = fs.readFileSync(path.join(dl, ttf)); parsed = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
  ok(parsed && parsed.outlinesFormat === 'truetype' && parsed.names.fontFamily.en === 'My Handwriting', 'it is a TrueType font named "My Handwriting"');
  const nowGlyphs = Object.entries((await stored()).glyphs).filter(([, s]) => s.length).length;
  ok(parsed && parsed.glyphs.length === nowGlyphs + 2, `it holds every character on the sheet (${parsed && parsed.glyphs.length - 2} of ${nowGlyphs})`);
  ok(parsed && parsed.charToGlyph('a').advanceWidth > 0, 'the "a" has a width');
  const noteText = await page.$eval('#exportNote', e => e.textContent);
  ok(/Saved .*\.ttf/.test(noteText), 'the note says where it went: ' + noteText);

  console.log('copy for web pages');
  const cssRe = /^@font-face \{\n  font-family: "My Handwriting";\n  src: url\(data:font\/ttf;base64,[A-Za-z0-9+/=]+\) format\("truetype"\);/;
  await page.evaluate(() => { window.__clip = null; navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); }; });
  await page.click('#css'); await wait(400);
  const css = await page.evaluate(() => window.__clip);
  ok(cssRe.test(css || '') && /^Copied/.test(await page.$eval('#exportNote', e => e.textContent)), 'with a clipboard: the CSS with the whole font is copied');
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
  await page.click('#css'); await wait(400);
  const shown = await page.evaluate(() => { const t = document.getElementById('cssOut'); return { text: t.hidden ? '' : t.value, selected: t.selectionEnd - t.selectionStart, focused: document.activeElement === t }; });
  ok(cssRe.test(shown.text) && shown.selected === shown.text.length && shown.focused, 'without one: the CSS is shown selected, ready for Ctrl+C');
  await page.click('#undo'); await wait(1500);
  ok(await page.$eval('#cssOut', e => e.hidden), 'once the sheet changes, the out-of-date copy box goes away');
  await page.click('#undo'); await wait(300);
  const used = await browser.newPage(); watch(used);
  await used.setContent(`<style>${css} .a{font:40px "My Handwriting", monospace} .b{font:40px monospace}</style><span class="a">Hamburgers</span><br><span class="b">Hamburgers</span>`);
  await used.evaluate(() => document.fonts.ready);
  const widths = await used.evaluate(() => [...document.querySelectorAll('span')].map(s => s.getBoundingClientRect().width));
  ok(Math.abs(widths[0] - widths[1]) > 5, `pasted into a page, the CSS font draws the text (${widths.map(Math.round).join(' vs ')} px)`);
  await used.close();

  console.log('save and open handwriting');
  await page.click('#save');
  let json = null;
  for (let t = 0; t < 40 && !json; t++) { await wait(250); json = fs.readdirSync(dl).find(f => f.endsWith('.json')); }
  ok(!!json, 'Save handwriting writes a .json file');
  if (json) {
    const saved = JSON.parse(fs.readFileSync(path.join(dl, json), 'utf8'));
    await page.evaluate(() => { localStorage.clear(); }); await page.reload({ waitUntil: 'load' }); await wait(500);
    ok(strokesIn(await stored()) === 0, 'a fresh sheet after clearing storage');
    const input = await page.$('#file');
    await input.uploadFile(path.join(dl, json)); await wait(2500);
    ok(strokesIn(await stored()) === strokesIn(saved), 'Open handwriting brings every stroke back');
    const bad = path.join(out, 'not-handwriting.json'); fs.writeFileSync(bad, '{"hello": 1}');
    await input.uploadFile(bad); await wait(800);
    ok(/could not be opened/.test(await page.$eval('#exportNote', e => e.textContent)) && strokesIn(await stored()) === strokesIn(saved), 'a file that is not handwriting is refused and changes nothing');
    const junk = path.join(out, 'junk.json'); fs.writeFileSync(junk, 'not json at all');
    await input.uploadFile(junk); await wait(800);
    ok(/could not be opened/.test(await page.$eval('#exportNote', e => e.textContent)), 'a broken file is refused');
  }

  console.log('Teach Nib');
  if (await page.evaluate(() => !!window.REPLICATOR_PUBLISHED)) {
    ok(await page.$eval('#teach', e => e.hidden), 'the published page has no Teach Nib button (its storage is its own)');
  } else if (await page.$eval('#teach', e => !e.hidden)) {
    await page.click('#teach'); await wait(1500);
    const taught = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('nib-memory-v1')).items.length; } catch (e) { return 0; } });
    ok(taught > 40, `Nib learned ${taught} characters`);
  } else ok(false, 'the Teach Nib button is missing');
  await page.close();

  console.log('as a published artifact (stand-in downloads capability)');
  const art = await browser.newPage(); watch(art);
  await art.evaluateOnNewDocument(() => {
    window.__saved = [];
    const downloads = Object.freeze({ save: async r => { window.__saved.push({ filename: r.filename, size: r.data.byteLength || r.data.length, type: Object.prototype.toString.call(r.data) }); return { status: 'saved' }; } });
    window.claude = { use: name => new Promise(res => setTimeout(() => res(name === 'downloads' ? downloads : null), 50)) };
  });
  await art.goto(url, { waitUntil: 'load' }); await wait(2500);
  await art.click('#download'); await wait(500);
  await art.click('#save'); await wait(500);
  const saved = await art.evaluate(() => window.__saved);
  ok(saved.length === 2 && saved[0].filename === 'My-Handwriting.ttf' && saved[0].size > 1000 && saved[1].filename.endsWith('.json'), 'downloads go through the capability: ' + JSON.stringify(saved));
  await art.close();

  console.log('every test font loads and draws in Chrome');
  const fontsDir = path.join(__dirname, 'shots', 'fonts');
  const files = fs.existsSync(fontsDir) ? fs.readdirSync(fontsDir).filter(f => f.endsWith('.ttf')) : [];
  ok(files.length >= 5, files.length + ' fonts from test/font_check.js');
  const fp = await browser.newPage(); watch(fp);
  await fp.setContent('<body></body>');
  for (const f of files) {
    const buf = fs.readFileSync(path.join(fontsDir, f));
    const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    const text = Object.keys(font.tables.cmap.glyphIndexMap).map(Number).filter(c => c > 32 && c !== 0xA0).map(c => String.fromCodePoint(c)).join('');
    const r = await fp.evaluate(async (b64, f, text) => {
      const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const fam = 'T' + f.replace(/\W/g, '');
      try { const face = await new FontFace(fam, u).load(); document.fonts.add(face); } catch (e) { return 'rejected: ' + e.message; }
      if (!text) return 'ok';
      // the font's own characters drawn with it differ from the same text in two unrelated fallbacks
      const c = document.createElement('canvas').getContext('2d');
      c.font = `40px ${fam}, monospace`; const w1 = c.measureText(text).width;
      c.font = '40px monospace'; const w2 = c.measureText(text).width;
      c.font = `40px ${fam}, serif`; const w3 = c.measureText(text).width;
      c.font = '40px serif'; const w4 = c.measureText(text).width;
      return Math.abs(w1 - w3) < 0.01 && (Math.abs(w1 - w2) > 0.5 || Math.abs(w3 - w4) > 0.5) ? 'ok' : `draws like the fallback (${w1} ${w2} ${w3} ${w4})`;
    }, buf.toString('base64'), f, text);
    ok(r === 'ok', `${f}: Chrome loads it and draws ${text.length} characters with it`);
  }
  await fp.close();

  for (const scheme of ['light', 'dark']) {
    const p = await browser.newPage(); watch(p);
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.goto(url, { waitUntil: 'load' }); await wait(2500);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 0, `phone ${scheme}: no sideways scrolling (${overflow}px)`);
    await p.screenshot({ path: `${out}/replicator-phone-${scheme}.png`, fullPage: true });
    await p.close();
  }
  await browser.close();
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
