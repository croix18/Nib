// A file that carries Nib, opened from file:// as a teacher opens it: which Nib is inside, which classifier it runs,
// whether it reads, and (Nib 1.8.0 and later) whether the worker pool's workers start from the file's own copy of
// the engine and give this thread's bits. For a file the engine was just put into (Deckhand.html after
// tools/vendor_nib.py, the pages in dist/) before it is pushed.
//   node tools/verify/file_probe.js <file.html> [more files]         exit 1 on a page error, no Nib, a wrong reading,
//                                                                    or a pool that cannot start or differs
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
    const r = await page.evaluate(async () => {
      if (!window.Nib) return null;
      const S = [[[0, 0], [0, 40]], [[20, 20], [50, 20]], [[35, 5], [35, 35]], [[70, 2], [90, 0], [92, 18], [72, 40], [95, 40]]];
      const out = { nib: Nib.version, kernel: Nib.kernel, read: Nib.recognize(S, { times: false }).latex, pool: null };
      const I = Nib._internals;
      if (I && I.poolRun && Nib.Recognizer) {
        const need = new Nib.Recognizer().needs(S, { times: false }), got = new Map();
        const done = await Promise.race([I.poolRun(need.jobs.map(j => ({ group: j.group, ref: need.ref, key: j.key })), (j, e) => got.set(j.key, e)).done, new Promise(res => setTimeout(() => res('late'), 10000))]);
        let differ = 0;
        for (const j of need.jobs) { const e = got.get(j.key), z = I.classifyGroup(j.group, need.ref); if (!e || e.length !== z.length || e.some((v, k) => !Object.is(v, z[k])) || e.hidden.some((v, k) => !Object.is(v, z.hidden[k]))) differ++; }
        const st = I.poolTest('stats');
        out.pool = { done, asked: need.jobs.length, differ, started: st.started, kernels: st.kernels, dead: st.dead, why: st.why };
      }
      return out;
    });
    const P = r && r.pool, poolOk = !P || (P.done === true && P.differ === 0 && !P.dead && P.started > 0);
    const ok = !!r && r.read === '1+2' && errors.length === 0 && poolOk;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${f}: ` + (r ? `Nib ${r.nib}, classifier ${r.kernel}, reads ${r.read}` +
      (P ? (P.done === true && !P.dead ? `, ${P.started} worker${P.started === 1 ? '' : 's'} from the file's own engine (${P.kernels.join(', ')}): ${P.asked} groups, ${P.differ} differ` : `, no worker (${P.dead ? P.why : 'asked: ' + P.done})`) : ', no pool in this Nib') : 'no Nib in the page') +
      (errors.length ? ' | page errors: ' + errors.slice(0, 2).join(' ; ') : '') + (said.length ? ' | it said: ' + said.join(' ; ') : ''));
    await page.close();
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
