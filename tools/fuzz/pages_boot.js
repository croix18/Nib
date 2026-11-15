'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(T.npm('puppeteer-core'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const J = JSON.stringify, vec = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const g = [[[0.2, 0.2], [0.5, 0.8], [0.8, 0.2]]];
const REP = { 'nothing': {}, 'not JSON': { 'replicator-v1': 'x' }, 'null': { 'replicator-v1': 'null' }, 'array': { 'replicator-v1': '[]' }, 'glyphs string': { 'replicator-v1': J({ glyphs: 'x' }) }, 'glyphs array': { 'replicator-v1': J({ glyphs: [] }) },
  'glyphs odd': { 'replicator-v1': J({ v: 2, glyphs: { A: null, B: 5, C: 'x', D: [], E: [[]], F: [[[]]], G: [[[null, null]]], H: [[['a', 'b']]], I: [[[1e308, -1e308], [0, 0]]], J: [[{ x: 1, y: 2 }]], a: g, b: [vec(200000, i => [i % 2, i % 3])], __proto__: g, constructor: g } }) },
  'settings odd': { 'replicator-v1': J({ v: 'x', name: { a: 1 }, weight: 'heavy', spacing: null, smoothing: 1e9, tidy: 'yes', even: 5, big: 'x', section: 'nope', samples: 'x', useSamples: 0, sentDone: -5, sentIdx: 1e99, glyphs: { a: g } }) },
  'samples odd': { 'replicator-v1': J({ v: 2, glyphs: { a: g, b: g }, samples: { a: 'x', b: [null, 5, 'x', [[]], [[[null]]], g, vec(50, () => g)], c: [g], __proto__: [g] }, section: 'sent', sentIdx: 3 }) },
  'a full good hand': { 'replicator-v1': J({ v: 2, name: 'Test', glyphs: Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-=()'.split('').map((c, i) => [c, [[[0.2, 0.2 + (i % 5) / 20], [0.5, 0.8], [0.8, 0.25]]]])) }) },
  'degenerate glyphs for every letter': { 'replicator-v1': J({ v: 2, glyphs: Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('').map(c => [c, [[[0.5, 0.5], [0.5, 0.5]]]])) }) },
  'flat glyphs for every letter': { 'replicator-v1': J({ v: 2, glyphs: Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('').map(c => [c, [[[0, 0.5], [1, 0.5]]]])) }) },
  'out of the box glyphs': { 'replicator-v1': J({ v: 2, glyphs: Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('').map(c => [c, [[[-50, -50], [90, 1e6], [1e9, 3]]]])) }) } };
const DEMO = { 'nothing': {}, 'memory garbage': { 'nib-memory-v1': '!!' }, 'hand garbage': { 'nib-hand-v1': J({ glyphs: { 7: 'x' } }) }, 'everything garbage': { 'nib-memory-v1': '{', 'nib-hand-v1': '[', 'replicator-v1': '#', 'nib-board-v3': '?' } };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nibpages-'));
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, userDataDir: dir, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  let bad = 0;
  for (const [file, cases] of [['Replicator.html', REP], ['Nib.html', DEMO]]) for (const name of Object.keys(cases)) {
    const page = await browser.newPage(), errors = [], net = [];
    page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 150)); });
    await page.setRequestInterception(true); page.on('request', r => { if (!/^(file|data|blob|about):/.test(r.url())) net.push(r.url().slice(0, 100)); r.continue().catch(() => {}); });
    await page.setViewport({ width: 1300, height: 900 });
    await page.evaluateOnNewDocument(kv => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]); sessionStorage.setItem('seeded', '1'); } }, cases[name]);
    const t0 = Date.now();
    await page.goto('file://' + REPO + '/dist/' + file, { waitUntil: 'load', timeout: 60000 }).catch(e => errors.push('goto: ' + e.message));
    await wait(1500);
    const boot = Date.now() - t0;
    // write a stroke on the first canvas with the mouse, wait, reload
    const c = await page.$('canvas');
    if (c) { const b = await c.boundingBox(); if (b && b.width > 20) { await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3); await page.mouse.down(); await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.7, { steps: 8 }); await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.3, { steps: 8 }); await page.mouse.up(); } }
    await wait(1500);
    const alive = await Promise.race([page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(true)))), wait(5000).then(() => false)]);
    await page.reload({ waitUntil: 'load' }).catch(e => errors.push('reload: ' + e.message)); await wait(1200);
    const ok = !errors.length && !net.length && alive;
    if (!ok) bad++;
    console.log((ok ? 'ok   ' : 'FAIL ') + (file + ': ' + name).padEnd(52) + ' ' + boot + ' ms' + (errors.length ? '\n     → ' + errors.slice(0, 3).join('\n     → ') : '') + (net.length ? '\n     → network: ' + net.join(', ') : '') + (alive ? '' : '\n     → no frame'));
    await page.close();
  }
  await browser.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? bad + ' cases failed' : 'all clean');
})();
