// The Replicator in a real browser: writes real handwriting into the boxes with the mouse, waits for the font,
// downloads it (as a file page and through a stand-in for the claude.ai downloads capability), reads it back,
// checks Chrome accepts and draws every font test/font_check.js made, copies the web-page CSS and uses it,
// tries undo, clear, open/save, a pen-weight change without freezing the page, Teach Nib, and screenshots
// desktop, phone and dark.
//   node test/replicator_browser.js [page=dist/Replicator.html] [outdir=test/shots]
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(require('./data').npm('puppeteer-core'));
const opentype = require(require('./data').npm('opentype.js'));
const R = require(path.join(__dirname, '..', 'replicator', 'core.js'));
const { need } = require('./data');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const [page_ = path.join(__dirname, '..', 'dist', 'Replicator.html'), out = path.join(__dirname, 'shots')] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const dl = path.join(out, 'downloads'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });
  const rows = fs.readFileSync(need('test.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
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
  const browser = await puppeteer.launch({ executablePath: require('./data').needChrome(), headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const errors = [];
  // (the published page links Google Fonts, which this sandbox cannot reach: those failures are not the page's)
  const watch = p => { p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource: net::ERR_(TUNNEL_CONNECTION_FAILED|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|PROXY_CONNECTION_FAILED)/.test(m.text())) errors.push(m.text()); }); };
  const page = await browser.newPage(); watch(page);
  const cdp = await page.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }).catch(() => cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dl }));
  await page.evaluateOnNewDocument(() => {
    window.__long = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* unsupported */ }
  });
  await page.setViewport({ width: 1366, height: 900 });
  // the published page is wrapped in a document skeleton (with the viewport tag) when it is published: test it so
  let file = path.resolve(page_);
  const src = fs.readFileSync(file, 'utf8');
  if (!/^\s*<!doctype/i.test(src)) {
    file = path.join(out, 'published-' + path.basename(file));
    fs.writeFileSync(file, '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + src + '</body></html>');
  }
  const url = 'file://' + file;
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

  console.log('the eraser (8 Nov, Croix: "There was also no eraser besides clearing the whole thing.")');
  {
    // a box with two strokes or more: rub across one of them
    // (the point of its first stroke furthest from the others: a rub where two strokes cross takes both, as it should)
    const pick = await page.evaluate(() => {
      const g = JSON.parse(localStorage.getItem('replicator-v1')).glyphs;
      const ch = Object.keys(g).find(c => g[c].length >= 2 && [...document.querySelectorAll('.box .ch')].some(e => e.textContent === c));
      if (!ch) return null;
      const [first, ...rest] = g[ch], far = p => Math.min(...rest.flat().map(q => Math.hypot(q[0] - p[0], q[1] - p[1])));
      const at = first.reduce((a, p) => (far(p) > far(a) ? p : a), first[0]);
      return { ch, at, n: g[ch].length, room: far(at) };
    });
    if (pick) {
      const bx = await page.evaluateHandle(ch => [...document.querySelectorAll('.box')].find(b => b.querySelector('.ch').textContent === ch), pick.ch);
      const c = await (await bx.asElement().$('canvas')).boundingBox(), mid = pick.at;
      await page.click('#eraser'); await wait(80);
      ok(await page.$eval('#eraser', e => e.getAttribute('aria-pressed')) === 'true', 'the Eraser button turns the eraser on');
      await page.mouse.move(c.x + mid[0] * c.width - 3, c.y + mid[1] * c.height - 3); await page.mouse.down();
      await page.mouse.move(c.x + mid[0] * c.width + 3, c.y + mid[1] * c.height + 3, { steps: 3 }); await page.mouse.up(); await wait(500);
      const n1 = ((await stored()).glyphs[pick.ch] || []).length;
      ok(n1 === pick.n - 1, `rubbing across a stroke in "${pick.ch}" takes that stroke and leaves the rest (${pick.n} → ${n1})`);
      await page.click('#undo'); await wait(500);
      ok(((await stored()).glyphs[pick.ch] || []).length === pick.n, 'Undo puts it back');
      await page.keyboard.press('e'); await wait(80);
      ok(await page.$eval('#eraser', e => e.getAttribute('aria-pressed')) === 'false', 'E turns it off again');
      // the pen turned round (its eraser end) rubs out with the eraser off
      const r = await page.evaluate((ch, mid) => {
        const b = [...document.querySelectorAll('.box')].find(x => x.querySelector('.ch').textContent === ch), cv = b.querySelector('canvas'), q = cv.getBoundingClientRect();
        const ev = (type, dx) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: 'pen', button: type === 'pointerdown' ? 5 : -1, buttons: type === 'pointerup' ? 0 : 32, clientX: q.left + mid[0] * q.width + dx, clientY: q.top + mid[1] * q.height + dx, bubbles: true, cancelable: true, pressure: 0.5 }));
        ev('pointerdown', -3); ev('pointermove', 0); ev('pointermove', 3); ev('pointerup', 3);
        return JSON.parse(localStorage.getItem('replicator-v1') || '{}');
      }, pick.ch, mid);
      await wait(500);
      ok(((await stored()).glyphs[pick.ch] || []).length < pick.n, "the pen's eraser end rubs out too");
      await page.click('#undo'); await wait(500);
      void r;
    } else ok(false, 'a box with two strokes to rub out');
  }

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

  console.log('sentences');
  {
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }, U = (a, b) => a + (b - a) * rnd();
    // the same drawing written again: a little bigger or smaller, turned, slanted, each stroke nudged (as in test/replicator_check.js)
    const again = st => {
      const sc = U(0.93, 1.07), rot = U(-0.05, 0.05), sh = U(-0.06, 0.06);
      return st.map(s => { const nx = U(-0.01, 0.01), ny = U(-0.01, 0.01); return s.map(p => { const x = (p[0] - 0.5) * sc, y = (p[1] - 0.6) * sc; return [0.5 + x * Math.cos(rot) - y * Math.sin(rot) + sh * y + nx, 0.6 + x * Math.sin(rot) + y * Math.cos(rot) + ny]; }); });
    };
    const hand = (await stored()).glyphs;
    const other = ch => (pool[ch] && pool[ch].length ? place(ch, pool[ch][0]) : null);      // a letter not in the boxes, written anyway
    const geo = () => page.evaluate(() => {
      const el = document.getElementById('strip'); el.scrollIntoView({ block: 'center' });
      const c = el.querySelector('canvas').getBoundingClientRect();
      return { x: c.left, y: c.top, w: c.width, lines: +el.dataset.lines, rowH: +el.dataset.rowH };
    });
    // a sentence laid out on the ruled lines, the way it is written: [{li, s (line units)}], i/j dots and t bars sometimes after the word
    const layout = (text, g) => {
      const out = [], width = g.w / g.rowH - 0.3;
      let x = 0.15, li = 0;
      for (const word of text.split(' ')) {
        const gl = [...word].map(ch => { const st = hand[ch] && hand[ch].length ? hand[ch] : other(ch); return { ch, st: st ? R.toLine(again(st)) : null }; });
        const span = st => { const xs = st.flat().map(p => p[0]); return [Math.min(...xs), Math.max(...xs)]; };
        const wordW = gl.reduce((t, q) => (q.st ? t + span(q.st)[1] - span(q.st)[0] + 0.1 : t), 0);
        if (x + wordW > width && x > 0.2) { li++; x = 0.15; }
        const late = [];
        for (const q of gl) {
          if (!q.st) continue;
          const [a, b] = span(q.st);
          q.st.forEach((s, si) => {
            const p = s.map(pt => [pt[0] - a + x, pt[1]]);
            const isLate = ((q.ch === 'i' || q.ch === 'j') && si === q.st.length - 1 && q.st.length > 1) || (q.ch === 't' && si === 1);
            (isLate && rnd() < 0.5 ? late : out).push({ li, s: p });
          });
          x += b - a + U(0.07, 0.13);
        }
        out.push(...late);
        x += U(0.28, 0.42);
      }
      return out;
    };
    const drawStroke = async (g, t) => {
      const P = t.s.map(p => [g.x + p[0] * g.rowH, g.y + 4 + (t.li + p[1]) * g.rowH]);
      await page.mouse.move(P[0][0], P[0][1]); await page.mouse.down();
      for (let i = 1; i < P.length; i += 2) await page.mouse.move(P[i][0], P[i][1]);
      await page.mouse.move(P[P.length - 1][0], P[P.length - 1][1]); await page.mouse.up();
    };
    const strokesOnLines = () => page.$eval('#strip', e => +e.dataset.strokes);
    const learnNote = async () => {
      await page.waitForFunction(() => /^(Learned|That did not|Every word)/.test(document.getElementById('sentNote').textContent), { timeout: 20000 }).catch(() => {});
      return page.$eval('#sentNote', e => e.textContent);
    };
    const samplesIn = d => Object.values(d.samples || {}).reduce((n, l) => n + l.length, 0);

    await tab('sent');
    ok(await page.$eval('#sent', e => !e.hidden) && await page.$eval('#grid', e => e.hidden), 'the Sentences tab shows ruled lines in place of the boxes');
    const s1 = await page.$eval('#sentText', e => e.value);
    ok(s1 === 'The quick brown fox jumps over the lazy dog.', 'a sentence to copy is ready: ' + s1);
    ok(await page.$eval('#sentLearn', e => e.disabled), 'nothing written yet: nothing to learn');
    let g = await geo();
    ok(g.lines >= 3 && g.lines <= 4 && g.rowH >= 64 && g.rowH <= 132, `${g.lines} ruled lines on a computer, room for the sentence (${g.rowH} px each)`);
    const w1 = layout(s1, g);
    for (const t of w1) await drawStroke(g, t);
    ok(await strokesOnLines() === w1.length, `every stroke is on the lines (${w1.length})`);
    const famBefore = await page.$eval('#preview', e => e.style.fontFamily);
    await page.evaluate(() => { window.__long.length = 0; });
    await page.click('#sentLearn');
    const n1 = await learnNote(), m1 = n1.match(/^Learned (\d+) of (\d+) letters/);
    const lt = await page.evaluate(() => window.__long.slice());
    ok(m1 && +m1[2] === 36 && +m1[1] >= 27, 'most of the letters are learned (j and l have no box to match): ' + n1);
    console.log(`        reading the sentence: longest task ${Math.max(0, ...lt)} ms`);
    await wait(700);
    let d = await stored();
    const learned1 = m1 ? +m1[1] : 0;
    ok(samplesIn(d) === learned1 && d.sentDone === 1, `the letters are kept (${samplesIn(d)}), one sentence done`);
    ok(!d.samples.j && !d.samples.l, 'letters with no box drawing are never learned');
    const avgN = Object.keys(d.avg || {}).length, distinct = Object.keys(d.samples).length;
    ok(avgN >= 0.8 * distinct, `the font uses the average for the letters written (${avgN} of ${distinct})`);
    await page.waitForFunction(f => document.getElementById('preview').style.fontFamily !== f, { timeout: 30000 }, famBefore).catch(() => {});
    ok(await page.$eval('#preview', e => e.style.fontFamily) !== famBefore, 'the font is rebuilt with them');
    ok((await page.$$eval('.tab', ts => ts.map(t => t.textContent))).includes('Sentences1'), 'the Sentences tab counts the sentence');
    await page.screenshot({ path: out + '/replicator-sentences.png' });

    // Undo takes the sentence back, leaving the writing to learn again
    await page.click('#undo'); await wait(700);
    d = await stored();
    ok(samplesIn(d) === 0 && d.sentDone === 0 && await strokesOnLines() === w1.length && !(await page.$eval('#sentLearn', e => e.disabled)), 'Undo takes the learned letters back and leaves the writing');
    await page.click('#sentLearn');
    const n1b = await learnNote();
    ok(n1b === n1, 'learning it again gives the same letters');
    await wait(700);

    // the next stroke starts the next sentence
    g = await geo();
    const s2 = 'Sphinx of black quartz, judge my vow.';
    const w2 = layout(s2, g);
    await drawStroke(g, w2[0]);
    ok(await page.$eval('#sentText', e => e.value) === s2 && await strokesOnLines() === 1, 'writing again starts the next sentence on clear lines');
    for (const t of w2.slice(1)) await drawStroke(g, t);
    await drawStroke(g, { li: 2, s: [[9.2, 0.3], [9.6, 0.35], [9.9, 0.32]] });
    await page.click('#undo'); await wait(200);
    ok(await strokesOnLines() === w2.length, 'Undo takes back the last stroke on the lines');
    // the eraser on the lines: one stroke rubbed out, Undo puts it back
    {
      const t = w2[Math.floor(w2.length / 2)], mid = t.s[Math.floor(t.s.length / 2)];
      const X = g.x + mid[0] * g.rowH, Y = g.y + 4 + (t.li + mid[1]) * g.rowH;
      await page.click('#eraser'); await wait(60);
      await page.mouse.move(X - 2, Y - 2); await page.mouse.down(); await page.mouse.move(X + 2, Y + 2, { steps: 2 }); await page.mouse.up(); await wait(150);
      const after = await strokesOnLines();
      ok(after < w2.length && after >= w2.length - 3, `the eraser takes what it rubs on the lines, not the rest (${w2.length} → ${after})`);
      await page.click('#undo'); await wait(150);
      ok(await strokesOnLines() === w2.length, 'Undo puts it back');
      await page.click('#eraser'); await wait(60);
    }
    await page.click('#sentLearn');
    const n2 = await learnNote();
    ok(/^Learned/.test(n2), 'the second sentence: ' + n2);
    await wait(800);
    d = await stored();
    ok(d.sentDone === 2 && samplesIn(d) > learned1, `two sentences, ${samplesIn(d)} letters`);

    // a sentence that is not the one written teaches nothing
    g = await geo();
    const w3 = layout('Pack my box with five dozen jugs.', g);
    await drawStroke(g, w3[0]);
    const s3 = await page.$eval('#sentText', e => e.value);
    for (const t of w3.slice(1)) await drawStroke(g, t);
    await page.click('#sentLearn');
    const n3 = await learnNote();
    ok(/^That did not line up/.test(n3), `writing a different sentence (“${s3}” asked) teaches nothing: ${n3}`);
    await page.click('#sentClear'); await wait(700);
    ok(await page.$eval('#sentText', e => e.value) === s3 && await strokesOnLines() === 0, 'Clear keeps the same sentence to try again');
    await page.click('#undo'); await wait(200);
    ok(await strokesOnLines() === w3.length, 'and Undo brings the cleared writing back');
    await page.click('#sentClear'); await wait(300);
    d = await stored();
    const keep = samplesIn(d);
    ok(keep === samplesIn(await stored()) && d.sentDone === 2, 'and nothing was added');

    await tab('lower');
    const badge = await page.evaluate(() => { const b = [...document.querySelectorAll('.box')].find(x => x.querySelector('.ch').textContent === 'o'); return b ? b.querySelector('.cnt').textContent : null; });
    ok(badge === '×' + (d.samples.o || []).length && (d.samples.o || []).length > 0, `each box shows how often its letter was written in sentences (o: ${badge})`);
    await tab('sent');

    await page.click('#useSamples'); await wait(800);
    d = await stored();
    ok(d.useSamples === false && d.avg === undefined && samplesIn(d) === keep, 'sentences can be left out of the font without forgetting them');
    await page.click('#useSamples'); await wait(800);
    ok((await stored()).useSamples === true && Object.keys((await stored()).avg || {}).length > 0, 'and put back');

    await page.reload({ waitUntil: 'load' }); await wait(800);
    d = await stored();
    ok(samplesIn(d) === keep && await page.$eval('#sent', e => !e.hidden), 'a reload keeps the sentences and the tab');
    ok(await page.$eval('#sentText', e => e.value) === s3, 'and the sentence still to write');

    for (const f of fs.readdirSync(dl)) if (f.endsWith('.json')) fs.rmSync(path.join(dl, f));
    await page.click('#save');
    let sj = null;
    for (let t = 0; t < 40 && !sj; t++) { await wait(250); sj = fs.readdirSync(dl).find(f => f.endsWith('.json')); }
    const file = sj ? JSON.parse(fs.readFileSync(path.join(dl, sj), 'utf8')) : {};
    ok(samplesIn(file) === keep && Object.keys(file.avg || {}).length > 0, 'Save handwriting keeps the sentences and their averages (for Nib Board)');
    if (sj) {
      await page.evaluate(() => { localStorage.clear(); }); await page.reload({ waitUntil: 'load' }); await wait(500);
      await (await page.$('#file')).uploadFile(path.join(dl, sj)); await wait(2500);
      ok(samplesIn(await stored()) === keep && (await stored()).sentDone === 2, 'and Open handwriting brings them back');
    }
    if (!(await page.evaluate(() => !!window.REPLICATOR_PUBLISHED)) && await page.$eval('#teach', e => !e.hidden)) {
      await page.evaluate(() => { localStorage.removeItem('nib-memory-v1'); });
      await page.click('#teach'); await wait(1500);
      const taught = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('nib-memory-v1')).items.length; } catch (e) { return 0; } });
      const boxes = Object.values((await stored()).glyphs).filter(s => s.length).length;
      ok(taught > boxes, `Teach Nib uses the sentences too (${taught} shapes for ${boxes} characters)`);
    }

    await tab('sent');
    await page.click('#sentForget'); await wait(100);
    ok(/Tap again to forget all \d+ letters/.test(await page.$eval('#sentForget', e => e.textContent)) && samplesIn(await stored()) === keep, 'Forget asks for a second tap first');
    await page.click('#sentForget'); await wait(800);
    d = await stored();
    ok(samplesIn(d) === 0 && d.sentDone === 0 && Object.keys(d.avg || {}).length === 0, 'and then forgets every sentence');
    ok(strokesIn(d) > 0, 'the box drawings stay');
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
    await p.click('#tab-sent'); await wait(300);
    const sp = await p.evaluate(() => ({ lines: +document.getElementById('strip').dataset.lines, over: document.documentElement.scrollWidth - window.innerWidth }));
    ok(sp.lines >= 5 && sp.over <= 0, `phone ${scheme}: ${sp.lines} shorter lines for sentences, no sideways scrolling (${sp.over}px)`);
    await p.screenshot({ path: `${out}/replicator-phone-sentences-${scheme}.png`, fullPage: true });
    await p.click('#tab-upper'); await wait(100);
    await p.close();
  }
  await browser.close();
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
