// src/store.js's images in a real browser: put / get / delete / ids survive a reload, from a page opened as a file
// (as the Board is) and from http://127.0.0.1; IndexedDB is opened once; calls take effect in the order made; a 3 MB
// data URL; the in-memory fallback (storeImagesDurable() false, nothing throws or rejects) when indexedDB throws, is
// missing, refuses to open, never answers, or refuses one image, and in real opaque origins (a data: URL page, a
// sandboxed iframe).
//   node test/store_browser.js
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core'));
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const section = n => console.log(n);

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'store.js'), 'utf8');
// the module as the build has it: one strict function scope
const MOD = "(function () {\n'use strict';\n" + SRC + '\nwindow.__store = { put: storeImagePut, get: storeImageGet, del: storeImageDelete, ids: storeImageIds, durable: storeImagesDurable };\n})();';
// counts IndexedDB opens, keeps unhandled rejections
const SPY = `(function () {
  window.__opens = 0; window.__rejections = [];
  window.addEventListener('unhandledrejection', e => window.__rejections.push(String(e.reason)));
  try { const open = IDBFactory.prototype.open; IDBFactory.prototype.open = function () { window.__opens++; return open.apply(this, arguments); }; } catch (e) { /* none */ }
})();`;
const BREAK = {
  'indexedDB throws when read': `Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('The user denied permission to access the database.', 'SecurityError'); } });`,
  'indexedDB is missing': `Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });`,
  'open() throws': `IDBFactory.prototype.open = function () { window.__opens = (window.__opens || 0) + 1; throw new DOMException('access to the Indexed Database API is denied in this context', 'SecurityError'); };`,
  'open() fails (blocked site data)': `IDBFactory.prototype.open = function () {
    window.__opens = (window.__opens || 0) + 1;
    const req = { result: undefined, error: null };
    setTimeout(() => { req.error = new DOMException('The user denied permission to access the database.', 'UnknownError'); if (req.onerror) req.onerror({ type: 'error', target: req, preventDefault() {} }); }, 5);
    return req;
  };`,
  'open() never answers': `IDBFactory.prototype.open = function () { window.__opens = (window.__opens || 0) + 1; return {}; };`,
};
// IndexedDB that opens but refuses some images: 'refuse' aborts its transaction (as a full disk does), 'throw' throws
const REFUSE = `(function () {
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (v, k) {
    if (k === 'throw') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    const r = put.call(this, v, k);
    if (k === 'refuse') this.transaction.abort();
    return r;
  };
})();`;

// a 3 MB data URL of random base64, and a hash to compare it by
const BIG = `(() => {
  let x = 12345, s = '';
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', parts = [];
  for (let k = 0; k < 3000; k++) { s = ''; for (let i = 0; i < 1000; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; s += A[x >>> 26]; } parts.push(s); }
  return 'data:image/png;base64,' + parts.join('');
})()`;
const HASH = 's => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return s.length + ":" + h; }';

async function openPage(browser, url, breaker) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push('page error: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.evaluateOnNewDocument(SPY);
  if (breaker) await page.evaluateOnNewDocument(breaker);
  await page.evaluateOnNewDocument(MOD);
  await page.goto(url);
  return { page, errors };
}
const clean = async (page, errors, label) => {
  const rej = await page.evaluate(() => window.__rejections);
  ok(!errors.length && !rej.length, `${label}: no page errors, console errors or unhandled rejections` + (errors.length || rej.length ? ': ' + errors.concat(rej).join(' | ') : ''));
};

// IndexedDB there: everything survives a reload
async function durable(browser, label, url) {
  const { page, errors } = await openPage(browser, url);
  const a = await page.evaluate(async (BIGSRC, HASHSRC) => {
    const S = window.__store, big = eval(BIGSRC), hash = eval(HASHSRC);
    for (const id of await S.ids()) await S.del(id);                        // a clean start
    const r = { durable: await S.durable(), puts: [] };
    r.puts.push(await S.put('a', 'data:image/png;base64,AAAA'), await S.put('b', 'data:image/jpeg;base64,BBBB'), await S.put('big', big), await S.put(42, 'data:,forty-two'));
    r.getA = await S.get('a'); r.getBig = hash(await S.get('big')); r.bigHash = hash(big); r.ids1 = await S.ids();
    r.delB = await S.del('b'); r.getB = await S.get('b'); r.ids2 = await S.ids();
    const o = [S.put('o', '1'), S.put('o', '2'), S.get('o'), S.put('d', 'x'), S.del('d'), S.get('d')];   // no waiting in between
    r.order = await Promise.all(o);
    r.missing = await S.get('never'); r.badPut = await S.put('', 'x'); r.badGet = await S.get(null);
    r.durable2 = await S.durable(); r.opens = window.__opens; r.localStorage = localStorage.length;
    return r;
  }, BIG, HASH);
  ok(a.durable === true, `${label}: storeImagesDurable() → true`);
  ok(a.puts.every(v => v === true), `${label}: put → true (4 images, one a ${(a.bigHash.split(':')[0] / 1e6).toFixed(1)} MB data URL)`);
  ok(a.getA === 'data:image/png;base64,AAAA' && a.getBig === a.bigHash, `${label}: get gives each back (the 3 MB one exactly)`);
  ok(JSON.stringify(a.ids1) === '["42","a","b","big"]', `${label}: ids → ${JSON.stringify(a.ids1)}`);
  ok(a.delB === true && a.getB === null && JSON.stringify(a.ids2) === '["42","a","big"]', `${label}: delete → true; then get → null, ids → ${JSON.stringify(a.ids2)}`);
  ok(JSON.stringify(a.order) === '[true,true,"2",true,true,null]', `${label}: calls take effect in the order made, without waiting in between: ${JSON.stringify(a.order)}`);
  ok(a.missing === null && a.badPut === false && a.badGet === null, `${label}: an unknown id → null; a bad id → false / null`);
  ok(a.opens === 1, `${label}: IndexedDB opened once for ${a.puts.length + 15} calls (${a.opens})`);
  ok(a.localStorage === 0, `${label}: nothing written to localStorage`);
  await page.reload();
  const b = await page.evaluate(async HASHSRC => {
    const S = window.__store, hash = eval(HASHSRC);
    return { a: await S.get('a'), b: await S.get('b'), big: hash(await S.get('big') || ''), n: await S.get(42), o: await S.get('o'), ids: await S.ids(), durable: await S.durable(), opens: window.__opens };
  }, HASH);
  ok(b.a === 'data:image/png;base64,AAAA' && b.big === a.bigHash && b.n === 'data:,forty-two' && b.o === '2' && b.b === null, `${label}: after a reload every image is still there (the 3 MB one exactly), the deleted one still gone`);
  ok(JSON.stringify(b.ids) === '["42","a","big","o"]' && b.durable === true && b.opens === 1, `${label}: after a reload ids → ${JSON.stringify(b.ids)}, durable, opened once`);
  await clean(page, errors, label);
  await page.close();
}

// IndexedDB not usable: a Map for the life of the page
async function memory(browser, label, url, breaker, waitMs) {
  const { page, errors } = await openPage(browser, url, breaker);
  const t0 = Date.now();
  const a = await page.evaluate(async (BIGSRC, HASHSRC) => {
    const S = window.__store, big = eval(BIGSRC), hash = eval(HASHSRC);
    const calls = [S.put('a', 'data:,A'), S.put('big', big), S.get('a'), S.ids(), S.durable()];
    const r = { promises: calls.every(c => c instanceof Promise) };
    [r.putA, r.putBig, r.getA, r.ids, r.durable] = await Promise.all(calls);
    r.big = hash(await S.get('big')) === hash(big);
    r.del = await S.del('a'); r.after = await S.get('a'); r.ids2 = await S.ids();
    return r;
  }, BIG, HASH);
  const took = Date.now() - t0;
  ok(a.promises && a.putA === true && a.putBig === true && a.getA === 'data:,A' && a.big && JSON.stringify(a.ids) === '["a","big"]',
    `${label}: put / get / ids work from memory (the 3 MB data URL too)` + (waitMs ? ` — after waiting ${(took / 1000).toFixed(1)} s for an answer` : ''));
  ok(a.durable === false, `${label}: storeImagesDurable() → false`);
  ok(a.del === true && a.after === null && JSON.stringify(a.ids2) === '["big"]', `${label}: delete → true, then get → null`);
  await page.reload();
  const b = await page.evaluate(async () => ({ big: await window.__store.get('big'), ids: await window.__store.ids(), durable: await window.__store.durable() }));
  ok(b.big === null && b.ids.length === 0 && b.durable === false, `${label}: a reload starts empty (memory lasts the life of the page)`);
  await clean(page, errors, label);
  await page.close();
}

(async () => {
  const harness = path.join(__dirname, 'store_page.html');
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/store_page.html')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(harness)); }
    else { res.writeHead(204); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}/store_page.html`, FILE = 'file://' + harness;
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  try {
    section('1. IndexedDB, a page opened as a file');
    await durable(browser, 'file://', FILE);
    section('2. IndexedDB, a page from http://127.0.0.1');
    await durable(browser, 'http', HTTP);

    section('3. IndexedDB that refuses some images');
    {
      const { page, errors } = await openPage(browser, HTTP, REFUSE);
      const r = await page.evaluate(async () => {
        const S = window.__store, o = {};
        for (const id of await S.ids()) await S.del(id);                        // the same origin as section 2: start clean
        o.put1 = await S.put('ok1', 'data:,ok'); o.d1 = await S.durable();
        o.putR = await S.put('refuse', 'data:,R'); o.putT = await S.put('throw', 'data:,T');
        o.getR = await S.get('refuse'); o.getT = await S.get('throw'); o.ids = await S.ids(); o.d2 = await S.durable();
        o.again = await S.put('refuse-later', 'data:,x');
        return o;
      });
      ok(r.put1 === true && r.d1 === true, 'refusing IndexedDB: a stored image, durable');
      ok(r.putR === true && r.putT === true && r.getR === 'data:,R' && r.getT === 'data:,T', 'an image IndexedDB refuses (an aborted transaction, a thrown QuotaExceededError) is kept in memory: put → true, get gives it');
      ok(JSON.stringify(r.ids) === '["ok1","refuse","throw"]' && r.d2 === false, `ids lists it (${JSON.stringify(r.ids)}) and storeImagesDurable() → false while it lives only in memory`);
      const r2 = await page.evaluate(async () => {
        const S = window.__store;
        await S.del('refuse'); await S.del('throw'); await S.del('refuse-later');
        return { d: await S.durable(), ids: await S.ids() };
      });
      ok(r2.d === true && JSON.stringify(r2.ids) === '["ok1"]', 'once those are deleted, durable again');
      await page.reload();
      const r3 = await page.evaluate(async () => ({ ok1: await window.__store.get('ok1'), ids: await window.__store.ids() }));
      ok(r3.ok1 === 'data:,ok' && JSON.stringify(r3.ids) === '["ok1"]', 'after a reload the stored image is there');
      await clean(page, errors, 'refusing IndexedDB');
      await page.close();
    }

    section('4. no IndexedDB: the in-memory fallback');
    for (const [label, breaker] of Object.entries(BREAK)) await memory(browser, label, HTTP, breaker, label === 'open() never answers');
    await memory(browser, 'indexedDB throws (file://)', FILE, BREAK['indexedDB throws when read']);

    section('5. opaque origins');
    {
      const { page, errors } = await openPage(browser, 'data:text/html,<meta charset=utf-8><p>an opaque origin</p>');
      const r = await page.evaluate(async () => {
        const S = window.__store;
        return { origin: window.origin, put: await S.put('x', 'data:,X'), get: await S.get('x'), ids: await S.ids(), durable: await S.durable() };
      });
      ok(r.origin === 'null' && r.put === true && r.get === 'data:,X' && JSON.stringify(r.ids) === '["x"]' && r.durable === false, `a data: URL page (origin ${r.origin}): memory, durable false`);
      await clean(page, errors, 'data: URL page');
      await page.close();
    }
    {
      const { page, errors } = await openPage(browser, HTTP);
      await page.evaluate(() => new Promise(res => { const f = document.createElement('iframe'); f.sandbox = 'allow-scripts'; f.srcdoc = '<p>sandboxed</p>'; f.onload = res; document.body.appendChild(f); }));
      const frame = page.frames().find(f => f !== page.mainFrame());
      if (!(await frame.evaluate(() => !!window.__store))) await frame.evaluate(SPY + MOD);
      const r = await frame.evaluate(async () => {
        const S = window.__store;
        let idb = 'readable';
        try { void indexedDB; } catch (e) { idb = 'throws ' + e.name; }
        return { origin: window.origin, idb, put: await S.put('x', 'data:,X'), get: await S.get('x'), durable: await S.durable(), rejections: window.__rejections || [] };
      });
      ok(r.origin === 'null' && r.put === true && r.get === 'data:,X' && r.durable === false && !r.rejections.length, `a sandboxed iframe (origin ${r.origin}, indexedDB ${r.idb}): memory, durable false`);
      await clean(page, errors, 'sandboxed iframe');
      await page.close();
    }

    section("6. a later Board's database (another origin: localhost)");
    {
      const LOCAL = HTTP.replace('127.0.0.1', 'localhost');
      const { page: A, errors } = await openPage(browser, LOCAL);
      const a1 = await A.evaluate(async () => ({ put: await window.__store.put('img', 'data:,1'), durable: await window.__store.durable() }));
      const B = await browser.newPage();                                  // another tab: a later Board upgrades nib-board to version 2
      await B.goto(LOCAL);
      const v = await B.evaluate(() => new Promise(res => {
        const r = indexedDB.open('nib-board', 2);
        r.onupgradeneeded = () => r.result.createObjectStore('extra');
        r.onsuccess = () => { const n = r.result.version; r.result.close(); res(n); };
        r.onerror = () => res('error ' + r.error); r.onblocked = () => res('blocked');
      }));
      ok(a1.put === true && a1.durable === true && v === 2, `another tab upgrades nib-board to version 2 while this page has it open: ${v === 'blocked' ? 'blocked' : 'not blocked (this page stepped aside)'}`);
      await B.close();
      const a2 = await A.evaluate(async () => ({ get: await window.__store.get('img'), put: await window.__store.put('img2', 'data:,2'), durable: await window.__store.durable(), opens: window.__opens }));
      ok(a2.get === 'data:,1' && a2.put === true && a2.durable === true && a2.opens === 3, `this page then opens it as it now is (version 1 → VersionError → opened without a version) and keeps working (${a2.opens} opens)`);
      const { page: C, errors: e2 } = await openPage(browser, LOCAL);    // a page loaded after the upgrade
      const c = await C.evaluate(async () => ({ get: await window.__store.get('img2'), ids: await window.__store.ids(), durable: await window.__store.durable() }));
      ok(c.get === 'data:,2' && JSON.stringify(c.ids) === '["img","img2"]' && c.durable === true, 'a page opened after the upgrade uses the version 2 database too');
      await clean(A, errors, 'upgraded elsewhere'); await clean(C, e2, 'opened after the upgrade');
      await A.close(); await C.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('  FAIL (threw)', e && e.stack || e); process.exit(1); });
