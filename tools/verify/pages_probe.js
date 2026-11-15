// Pages that carry Nib, served over http as a site serves them: which classifier runs under each page's own rule
// (its Content-Security-Policy), what the Board's Settings says, whether a rule was broken, and a reading.
// A page with a rule is also tried with 'wasm-unsafe-eval' taken out of it: the control, which must fall back to
// JavaScript — so the check would notice a rule that stops the kernel.
//   node tools/verify/pages_probe.js <folder the site serves> [/path/ ...]
//   e.g. for mrshaffer.org:  node tools/verify/pages_probe.js ../mrshaffer-site/public
//        (default paths: /teacher/nib/board/ /teacher/nib/replicator/ /teacher/deckhand/)
// Exit 1 when a page does not run the kernel, does not read, breaks its rule or throws.
'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const fs = require('fs'), path = require('path'), http = require('http');
const puppeteer = require(T.npm('puppeteer-core'));
const ROOT = path.resolve(process.argv[2] || '.');
const PATHS = process.argv.slice(3).length ? process.argv.slice(3) : ['/teacher/nib/board/', '/teacher/nib/replicator/', '/teacher/deckhand/'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml' };
const extra = new Map();                                  // pages served from memory (the controls)
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (extra.has(p)) { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(extra.get(p)); }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const list = [];
  for (const p of PATHS) {
    const f = path.join(ROOT, p, p.endsWith('/') ? 'index.html' : '');
    if (!fs.existsSync(f)) { console.log(`     ${p}: not in ${ROOT}`); continue; }
    list.push([p, p, 'simd']);
    const html = fs.readFileSync(f, 'utf8');
    if (/Content-Security-Policy" content="[^"]*'wasm-unsafe-eval'/.test(html)) { extra.set('/control' + p, html.replace(/ ?'wasm-unsafe-eval'/, '')); list.push([p + " without 'wasm-unsafe-eval' (the control)", '/control' + p, 'js']); }
  }
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, args: ['--no-sandbox'] });
  let bad = 0;
  for (const [name, url, want] of list) {
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
    const errors = [], broken = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { const t = m.text(); if (/Content Security Policy|Refused to/.test(t)) broken.push(t.slice(0, 160)); });
    await page.goto(base + url, { waitUntil: 'load' }); await new Promise(r => setTimeout(r, 1500));
    const r = await page.evaluate(() => ({
      nib: window.Nib ? Nib.version : null, kernel: window.Nib ? Nib.kernel : null,
      line: (document.getElementById('engineline') || {}).textContent || null,
      csp: (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || null,
      read: window.Nib ? Nib.recognize([[[0, 0], [0, 40]], [[20, 20], [50, 20]], [[35, 5], [35, 35]], [[70, 2], [90, 0], [92, 18], [72, 40], [95, 40]]], { times: false }).latex : null }));
    const ok = r.kernel === want && r.read === '1+2' && errors.length === 0 && (want === 'js' || broken.length === 0);
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: Nib ${r.nib}, kernel ${r.kernel}, reads ${r.read}` + (r.line ? `, Settings: "${r.line}"` : '') + `, rule ${r.csp ? JSON.stringify(r.csp) : 'none'}` +
      (errors.length ? ' | page errors: ' + errors.join(' ; ') : '') + (want !== 'js' && broken.length ? ' | rule broken: ' + broken[0] : ''));
    await page.close();
  }
  await browser.close(); server.close();
  if (!list.length) { console.log('no page to try'); process.exit(2); }
  process.exit(bad ? 1 : 0);
})();
