// A full page, already read: where does the time of one more stroke go? (CPU profile of the main thread)
// usage: node prof_live.js [count=120] [BOARD=path]   → top functions by self time and by total time
'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(T.npm('puppeteer-core'));
const BOARD = 'file://' + (process.env.BOARD || REPO + '/dist/Board.html');
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const Nib = require(process.env.ENGINE || REPO + '/dist/nib.js'), K = Nib.canvas;
(async () => {
  const count = +(process.argv[2] || 120);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nibprof-'));
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, userDataDir: dir, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pk = [];
  for (let i = 0; i < count; i++) { const r = rows[(i * 7) % rows.length], col = i % 4, row = Math.floor(i / 4); let x0 = Infinity, y0 = Infinity; for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); }
    for (const s of r.strokes) pk.push(K.pack(s.map(p => [(p[0] - x0) * 0.7 + 60 + col * 900, (p[1] - y0) * 0.7 + 400 + row * 260]), false)); }
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument(kv => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]); sessionStorage.setItem('seeded', '1'); } }, { 'nib-board-v3': JSON.stringify({ v: 3, page: 0, pages: [{ pk, fixes: [], revealed: [], types: [], paper: { kind: 'dots', tone: 'theme' } }] }) });
  await page.goto(BOARD, { waitUntil: 'load' });
  const t0 = Date.now();
  await page.waitForFunction(() => { const p = document.getElementById('pad'); return p.pad && p.pad.result && p.pad.result.parts && p.pad.strokes.length === p.pad.resultStrokes.length; }, { timeout: 900000 });
  console.log(`cold read of ${count} expressions: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const c = await page.createCDPSession();
  await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 100 }); await c.send('Profiler.start');
  const r = await page.evaluate(async () => {
    const P = document.getElementById('pad').pad, el = document.querySelector('#pad canvas'), b = el.getBoundingClientRect();
    const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'pen', isPrimary: true, clientX: x, clientY: y, pressure: 0.5, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    const results = []; document.getElementById('pad').addEventListener('nib:result', () => results.push(performance.now()));
    const base = [[[0, 0], [0, 60]], [[40, 30], [80, 30]], [[60, 10], [60, 50]], [[120, 5], [145, -2], [155, 15], [125, 58], [160, 58]]];
    let n = 0;
    for (let rep = 0; rep < 5; rep++) for (const s0 of base) {
      const s = s0.map(q => [300 + rep * 190 + q[0], 120 + q[1]]);
      const before = results.length;
      ev('pointerdown', b.left + s[0][0], b.top + s[0][1]);
      for (let i = 1; i < s.length; i++) { for (let k = 1; k <= 6; k++) ev('pointermove', b.left + s[i - 1][0] + (s[i][0] - s[i - 1][0]) * k / 6, b.top + s[i - 1][1] + (s[i][1] - s[i - 1][1]) * k / 6); await new Promise(r => requestAnimationFrame(r)); }
      ev('pointerup', b.left + s[s.length - 1][0], b.top + s[s.length - 1][1]);
      const t1 = performance.now();
      while (results.length === before && performance.now() - t1 < 20000) await new Promise(r => setTimeout(r, 20));
      await new Promise(r => setTimeout(r, 350)); n++;
    }
    return { n, parts: P.result.parts.length, strokes: P.strokes.length };
  });
  const { profile } = await c.send('Profiler.stop');
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const self = new Map(), dt = profile.timeDeltas, samples = profile.samples;
  for (let i = 0; i < samples.length; i++) self.set(samples[i], (self.get(samples[i]) || 0) + dt[i]);
  const name = n => (n.callFrame.functionName || '(anonymous)') + (n.callFrame.url ? ':' + (n.callFrame.lineNumber + 1) : '');
  const selfByName = new Map(), totalByName = new Map();
  const walk = (n, stack) => {
    const nm = name(n), st = self.get(n.id) || 0;
    selfByName.set(nm, (selfByName.get(nm) || 0) + st);
    let tot = st;
    const fresh = !stack.has(nm); if (fresh) stack.add(nm);
    for (const id of n.children || []) tot += walk(byId.get(id), stack);
    if (fresh) { stack.delete(nm); totalByName.set(nm, (totalByName.get(nm) || 0) + tot); }
    return tot;
  };
  const all = walk(profile.nodes[0], new Set());
  const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([nm, us]) => `${(us / 1000 / r.n).toFixed(2).padStart(8)} ms/stroke  ${nm}`).join('\n');
  console.log(`${r.n} strokes written on a page of ${r.parts} parts, ${r.strokes} strokes; profile ${(all / 1000).toFixed(0)} ms in all${errors.length ? ' ERR ' + errors[0] : ''}`);
  console.log('--- self time\n' + top(selfByName, +(process.env.TOP || 28)));
  console.log('--- total time (inclusive)\n' + top(totalByName, +(process.env.TOP || 40)));
  await browser.close(); fs.rmSync(dir, { recursive: true, force: true });
})();
