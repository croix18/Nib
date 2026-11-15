// The worker pool's prototype in Chrome (docs/plans/worker-pool.md), against the released engine in dist/, unchanged
// but for its wrapper function being given a name in a copy (what build.py will do), so that the engine can hand its
// own source to a worker. It tries what the design rests on and measures what the plan needs numbers for:
//   start     a worker started from a Blob URL with the engine's own source, from file:// with no flags: the engine
//             loads there (no document, no custom element), which classifier it runs, how long starting takes, what
//             a worker costs in memory
//   identity  every stroke group a full page's read would hand the pool, classified in a worker and on this thread:
//             the same bits; with this thread on the JavaScript path and the workers on the kernel, and the other way
//   read      a board of N expressions read cold three ways, each on a new page: as today (the pad's own read, in
//             slices), at once (recognize()), and with the caches filled by 1 and by 2 workers before the same read —
//             the same reading and the same bits in every cache entry, how many classifications the pool takes and
//             how many stay on this thread, and the times
//   rules     the same over http under a Content-Security-Policy: the site's rule for the Nib pages, the same with
//             workers forbidden, a rule without WebAssembly, a rule without blob: — does the pool start, and how does
//             it show when it cannot
//   node tools/pool/proto.js [expressions = 120] [start,identity,read,rules = all of them]
// Timings: run it alone, on a machine doing nothing else. Exit 1 when something that must hold does not.
'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const puppeteer = require(T.npm('puppeteer-core'));
const EXPRS = +(process.argv[2] || 120);
const WHAT = (process.argv[3] || 'start,identity,read,rules').split(',');
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').map(JSON.parse).map(r => ({ strokes: r.strokes }));

// the engine with its wrapper named, and a way to its source: the one change build.py will make
const SRC = fs.readFileSync(REPO + '/dist/nib.js', 'utf8'), HEAD = "(function (global) {\n'use strict';\n";
if (SRC.split(HEAD).length !== 2) { console.log('dist/nib.js does not begin as build.py writes it'); process.exit(1); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nibpool-'));
fs.writeFileSync(path.join(dir, 'nib-probe.js'), SRC.replace(HEAD, "(function NibEngine(global) {\n'use strict';\nglobal.__nibSource = function () { return NibEngine.toString(); };\n"));
fs.copyFileSync(path.join(__dirname, 'lib.js'), path.join(dir, 'lib.js'));
fs.writeFileSync(path.join(dir, 'page.js'), '(' + pageMain.toString() + ')();\n');
const html = (rule, attrs) => `<!doctype html><meta charset="utf-8">${rule ? `<meta http-equiv="Content-Security-Policy" content="${rule}">` : ''}
<style>html,body{margin:0;height:100%}nib-pad{display:block;width:1400px;height:900px}</style>
<nib-pad id="pad" view="ink" settle="0" delay="30" separate times="false" reveal solve infinite paper="dots" ${attrs}></nib-pad>
<script src="nib-probe.js"></script><script src="lib.js"></script><script src="page.js"></script>`;
fs.writeFileSync(path.join(dir, 'still.html'), html(null, 'auto="false"'));      // a pad that reads only when asked
fs.writeFileSync(path.join(dir, 'auto.html'), html(null, ''));                   // a pad that reads by itself, as the Board's

// ---------------------------------------------------------------- in the page
function pageMain() {
  const L = NibPoolProto(Nib), I = Nib._internals, el = document.getElementById('pad'), X = window.X = {};
  const now = () => performance.now();
  X.ready = async () => { for (let i = 0; i < 300 && !el.pad; i++) await new Promise(r => setTimeout(r, 20)); X.P = el.pad; return { nib: Nib.version, kernel: Nib.kernel, cores: navigator.hardwareConcurrency }; };
  // the page of tools/verify/session.js: N school problems, four to a row, every fifth with a gap in its line
  X.strokes = (rows, N, SEED) => {
    const place = (k, col, row, gap) => {
      const r = rows[(k * 7 + SEED * 13) % rows.length]; let x0 = Infinity, y0 = Infinity, y1 = -Infinity;
      for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      const st = r.strokes.map(s => s.map(p => [(p[0] - x0) * 0.7 + 60 + col * 900, (p[1] - y0) * 0.7 + 400 + row * 260]));
      if (gap && st.length > 3) {
        const bx = st.map(s => [Math.min(...s.map(p => p[0])), Math.max(...s.map(p => p[0]))]);
        const order = bx.map((b, i) => i).sort((a, b) => bx[a][0] - bx[b][0]);
        let cut = -1, best = -Infinity, reach = bx[order[0]][1];
        for (let q = 1; q < order.length; q++) { const g = bx[order[q]][0] - reach; if (g > best) { best = g; cut = q; } reach = Math.max(reach, bx[order[q]][1]); }
        const H = (y1 - y0) * 0.7, right = new Set(order.slice(cut));
        st.forEach((s, i) => { if (right.has(i)) for (const p of s) p[0] += 1.3 * H; });
      }
      return st;
    };
    const all = []; for (let i = 0; i < N; i++) all.push(...place(i, i % 4, Math.floor(i / 4), i % 5 === 4));
    return all;
  };
  X.load = (rows, N, SEED) => { X.P.setState({ strokes: X.strokes(rows, N, SEED) }); return X.P.ink.length; };
  // every recognizer the pad uses from now on, in the order it first asks for them
  X.watch = () => { const P = X.P, seen = X.seen = new Set(), orig = P._recFor; P._recFor = function (f) { const r = orig.call(this, f); seen.add(r); return r; }; };
  X.classified = () => { let n = 0; for (const r of X.seen) n += r.classified || 0; return n; };
  // what the page reads: everything a user or a host can see of it, numbers at full precision
  X.digest = () => {
    const P = X.P, res = P.result, rs = P.resultStrokes || [], at = new Map(P.ink.map((s, i) => [s, i]));
    return JSON.stringify({ n: P.ink.length, latex: res && res.latex, text: res && res.text, conf: res && res.confidence,
      syms: res && res.symbols.map(s => [s.label, s.strokes.map(i => at.get(rs[i])), s.candidates, s.box]),
      parts: res && res.parts && res.parts.map(p => [p.idx.map(i => at.get(rs[i])), p.result && p.result.latex, p.result && p.result.confidence]),
      answers: (P.answers || []).map(a => [a.line, a.latex, a.kind, a.exact, a.value]), solved: P.solvedLatex(), faults: (P.faults || []).length });
  };
  // every cache entry of every recognizer, bit for bit, as one number (FNV-1a over the keys and the bytes)
  X.cacheHash = () => {
    let h = 0x811c9dc5, entries = 0;
    const eat = b => { for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } };
    const enc = new TextEncoder();
    for (const r of X.seen) for (const k of [...r.cache.keys()].sort()) {
      const e = r.cache.get(k); entries++;
      eat(enc.encode(k)); eat(new Uint8Array(e.buffer, e.byteOffset, e.byteLength)); eat(new Uint8Array(e.hidden.buffer, e.hidden.byteOffset, e.hidden.byteLength));
    }
    return entries + ' entries, ' + h.toString(16);
  };
  const done = () => ({ classified: X.classified(), recs: X.seen.size, digest: X.digest(), cache: X.cacheHash(), strokes: X.P.ink.length });
  // at once, on this thread
  X.atOnce = () => { X.watch(); const t0 = now(); X.P.recognize(); return Object.assign({ ms: now() - t0 }, done()); };
  // as today: the pad's own read of a page just loaded, in slices (a pad that reads by itself)
  X.asToday = (rows, N, SEED) => new Promise(resolve => {
    X.watch();
    const P = X.P, st = X.strokes(rows, N, SEED);
    // how long this thread is held: the first hold is the browser drawing the page (not the read), told apart
    let beat = now(), gap = 0, first = -1; const hb = setInterval(() => { const t = now(); if (first < 0) first = t - beat; else gap = Math.max(gap, t - beat); beat = t; }, 4);
    const t0 = now();
    el.addEventListener('nib:result', function on(e) {
      if (!P.result || (P.resultStrokes || []).length !== P.ink.length) return;
      el.removeEventListener('nib:result', on); clearInterval(hb);
      resolve(Object.assign({ ms: now() - t0, drawMs: first, readMs: e.detail && e.detail.ms, longestHold: gap }, done()));
    });
    P.setState({ strokes: st });
  });
  // the groups the page's read would hand the pool: needs() for every cluster, on the recognizer the pad keeps for it
  X.plan = () => {
    const P = X.P, ro = P._ropts(), jobs = [], t0 = now(), groups = I.clustersOf(P.ink);
    for (const g of groups) {
      const st = g.map(i => P.ink[i]), rec = P._recFor(st[0]);
      for (const j of L.needs(rec, st, Object.assign({}, ro, { fix: P._fixFor(st) }))) { j.rec = rec; jobs.push(j); }
    }
    return { jobs, groups, ms: now() - t0 };
  };
  X.startPool = async (n, chunk) => {
    const t0 = now(), src = L.workerSource(window.__nibSource()), srcMs = now() - t0;
    X.pool = L.makePool(n, src, { chunk });
    const workers = await X.pool.start();
    return { srcMs, srcChars: src.length, wallMs: now() - t0, workers };
  };
  // the caches filled by the pool, then the read as it is. (rounds: also hand the pool the groups joinOperands puts
  // together, round by round, as the pad's read finds them — the read is done here by hand to learn them, then by the pad.)
  X.pooled = async (rounds, split) => {
    X.watch();
    const P = X.P, pool = X.pool, out = {};
    let beat = now(), gap = 0; const hb = setInterval(() => { const t = now(); gap = Math.max(gap, t - beat); beat = t; }, 4);
    const T0 = now();
    const plan = X.plan(); out.planMs = plan.ms; out.jobs = plan.jobs.length; out.clusters = plan.groups.length;
    beat = now(); gap = 0;
    let t = now();
    await pool.run(plan.jobs, (j, e) => L.fill(j.rec, j.k, e));
    out.runMs = now() - t; out.longestHoldDuringRun = gap;
    // what the clusters' warm-ups still classify on this thread (the groups their rehearsals ask for)
    t = now();
    const ro = P._ropts(), optsOf = st => Object.assign({}, ro, { fix: P._fixFor(st) });
    if (split || rounds) for (const g of plan.groups) { const st = g.map(i => P.ink[i]), it = P._recFor(st[0]).warmup(st, optsOf(st)); while (!it.next().done); }
    out.warmMs = now() - t; out.leftClusters = split || rounds ? X.classified() : null;
    out.joinJobs = 0; out.joinRunMs = 0; out.joinPlanMs = 0; out.rounds = 0;
    if (rounds) {
      t = now();
      let parts = plan.groups.map(g => { const st = g.map(i => P.ink[i]); return { idx: g, strokes: st, result: P._recFor(st[0]).recognize(st, optsOf(st)) }; });
      out.partsMs = now() - t;
      for (let round = 0; round < 8; round++) {
        const joined = I.joinOperands(parts);
        if (!joined) break;
        out.rounds++;
        const old = new Map(parts.map(p => [p.idx, p])), fresh = joined.filter(g => !old.has(g)), jobs = [];
        t = now();
        for (const g of fresh) { const st = g.map(i => P.ink[i]), rec = P._recFor(st[0]); for (const j of L.needs(rec, st, optsOf(st))) { j.rec = rec; jobs.push(j); } }
        out.joinPlanMs += now() - t; out.joinJobs += jobs.length;
        t = now(); await pool.run(jobs, (j, e) => L.fill(j.rec, j.k, e)); out.joinRunMs += now() - t;
        parts = joined.map(g => { if (old.has(g)) return old.get(g); const st = g.map(i => P.ink[i]), rec = P._recFor(st[0]), it = rec.warmup(st, optsOf(st)); while (!it.next().done); return { idx: g, strokes: st, result: rec.recognize(st, optsOf(st)) }; });
      }
      out.leftBeforeRead = X.classified();
    }
    t = now(); P.recognize(); out.readMs = now() - t;
    out.left = X.classified(); out.leftJoins = out.left - (out.leftClusters || 0);
    out.ms = now() - T0;
    clearInterval(hb);
    out.stats = Object.assign({}, pool.stats);
    return Object.assign(out, done());
  };
  // every group of the plan classified in the workers and here: the same bits?
  X.identity = async stride => {
    X.watch();
    const jobs = X.plan().jobs, pool = X.pool;
    const got = await pool.run(jobs);                    // (nothing is filled in: the recognizers stay cold)
    const workerMs = pool.stats.workerMs;
    const t0 = now(), mine = jobs.map(j => I.classifyGroup(j.g, j.ref)), mainMs = now() - t0;
    let diff = 0; for (let i = 0; i < jobs.length; i++) if (!L.same(mine[i], got[i])) diff++;
    const sub = jobs.filter((j, i) => i % stride === 0), subGot = got.filter((e, i) => i % stride === 0);
    I.kernelUse('js');
    let diffMainJs = 0; const tj = now(); sub.forEach((j, i) => { if (!L.same(I.classifyGroup(j.g, j.ref), subGot[i])) diffMainJs++; }); const mainJsMs = now() - tj;
    const mainJs = Nib.kernel;
    I.kernelUse('auto');
    const workersJs = await pool.use('js'), gotJs = await pool.run(sub);
    let diffWorkerJs = 0; sub.forEach((j, i) => { if (!L.same(mine[jobs.indexOf(j)], gotJs[i])) diffWorkerJs++; });
    const workersBack = await pool.use('auto');
    const e = mine[0];
    return { jobs: jobs.length, diff, mainMs, workerMs, sub: sub.length, mainJs, diffMainJs, mainJsMs, workersJs, diffWorkerJs, workersBack, main: Nib.kernel,
      entry: `${e.constructor.name}(${e.length}) with .hidden ${e.hidden.constructor.name}(${e.hidden.length})`, points: jobs.reduce((n, j) => n + j.g.reduce((m, s) => m + s.length, 0), 0) };
  };
}

// ---------------------------------------------------------------- the driver
let bad = 0;
const say = (ok, line) => { if (ok === false) bad++; console.log((ok === null ? '     ' : ok ? 'ok   ' : 'FAIL ') + line); };
const ms = v => (v >= 100 ? Math.round(v) : v.toFixed(1)) + ' ms';
const wait = t => new Promise(r => setTimeout(r, t));

(async () => {
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, userDataDir: path.join(dir, 'profile'), protocolTimeout: 0, args: ['--no-sandbox'] });   // no flag for file://
  console.log(`Chrome ${await browser.version()}, node ${process.version}, ${os.cpus().length} cores; ${EXPRS} expressions; engine ${(SRC.length / 1e6).toFixed(2)} MB`);
  const open = async (url, name) => {
    const page = await browser.newPage(); await page.setViewport({ width: 1400, height: 900 });
    page.errors = []; page.said = [];
    page.on('pageerror', e => page.errors.push(e.message));
    page.on('console', m => page.said.push(m.type() + ': ' + m.text()));
    await page.goto(url, { waitUntil: 'load' });
    page.info = await page.evaluate(() => (window.X ? X.ready() : null));
    return page;
  };
  const file = name => 'file://' + path.join(dir, name);

  if (WHAT.includes('start')) {
    console.log('\n— start: a worker from the engine\'s own source, from file:// with no flags');
    const page = await open(file('still.html'));
    say(page.info && page.info.kernel === 'simd', `the page: Nib ${page.info.nib}, classifier ${page.info.kernel}, hardwareConcurrency ${page.info.cores}`);
    // what the engine says its source is, against the file: the wrapper function, whole
    const probe = fs.readFileSync(path.join(dir, 'nib-probe.js'), 'utf8'), want = probe.slice(probe.indexOf('function NibEngine(global)'), probe.lastIndexOf("})(typeof window") + 1);
    const src = await page.evaluate(() => window.__nibSource());
    say(src === want, `the engine's own source through Function.toString(): ${src.length} characters, ${src === want ? 'the wrapper function exactly as the file has it' : 'NOT what the file has'} (the file: ${SRC.length} with its banner)`);
    let st = null, err = null;
    try { st = await page.evaluate(() => X.startPool(2, 8)); } catch (e) { err = e.message; }
    say(!!st, st ? `two workers started in ${ms(st.wallMs)} (the source put together in ${ms(st.srcMs)}; each ready after ${st.workers.map(w => ms(w.startMs)).join(' and ')})` : 'the workers did not start: ' + err);
    if (st) {
      const w = st.workers[0];
      say(w.version === page.info.nib && w.kernel === 'simd' && !w.hasDocument && !w.hasElement, `in a worker: Nib ${w.version}, classifier ${w.kernel}, document ${w.hasDocument ? 'there' : 'not there'}, the custom element ${w.hasElement ? 'defined' : 'not defined'}, hardwareConcurrency ${w.cores}`);
      // a second pool in the same page: the workers' start when the source is already compiled once
      const again = await page.evaluate(async () => { const L = NibPoolProto(Nib), t0 = performance.now(), p = L.makePool(1, L.workerSource(window.__nibSource())); const w = await p.start(); p.stop(); return { ms: performance.now() - t0, each: w[0].startMs }; });
      say(null, `a worker started again in the same page: ${ms(again.each)}`);
      // what four more workers cost the process the page lives in, once each has classified
      try {
        const cdp = await browser.target().createCDPSession();
        const rss = async () => { const { processInfo } = await cdp.send('SystemInfo.getProcessInfo'); let kb = 0; for (const p of processInfo) if (p.type === 'renderer') { try { kb += +require('child_process').execSync('ps -o rss= -p ' + p.id).toString().trim() || 0; } catch (e) { /* gone */ } } return kb / 1024; };
        await page.evaluate((rows, N) => X.load(rows, N, 1), rows, 12);
        await page.evaluate(async () => { const jobs = X.plan().jobs; await X.pool.run(jobs); });
        await wait(1500); const before = await rss();
        await page.evaluate(async () => { const L = NibPoolProto(Nib), p = window.__four = L.makePool(4, L.workerSource(window.__nibSource()), { chunk: 4 }); await p.start(); const jobs = X.plan().jobs; await p.run(jobs); return p.stats.chunks; });
        await wait(1500); const after = await rss();
        say(null, `four more workers, each having classified: the page's process grows by ${(after - before).toFixed(0)} MB (${((after - before) / 4).toFixed(1)} MB a worker)`);
      } catch (e) { say(null, 'the memory of the workers could not be measured here: ' + e.message.slice(0, 100)); }
      try {
        const heaps = [];
        for (const w of page.workers()) { try { const h = await w.client.send('Runtime.getHeapUsage'); heaps.push(h.usedSize); } catch (e) { /* a worker that has gone */ } }
        say(null, heaps.length ? `a worker's JavaScript heap: ${heaps.map(h => (h / 1048576).toFixed(1) + ' MB').join(', ')} (the kernel's own memory, 3 MB, comes on top once it has classified)` : 'a worker\'s heap could not be read here');
      } catch (e) { say(null, 'a worker\'s heap could not be read here: ' + e.message.slice(0, 80)); }
    }
    say(page.errors.length === 0, `no page error${page.errors.length ? ': ' + page.errors[0] : ''}`);
    await page.close();
  }

  if (WHAT.includes('identity')) {
    console.log('\n— identity: the groups of a full page, classified in two workers and on the page\'s thread');
    const page = await open(file('still.html'));
    await page.evaluate((rows, N) => X.load(rows, N, 1), rows, EXPRS);
    await page.evaluate(() => X.startPool(2, 8));
    const r = await page.evaluate(() => X.identity(5));
    say(r.diff === 0, `${r.jobs} groups (${r.points} points): ${r.diff} differ between a worker and this thread, both on the kernel — an entry is a ${r.entry}`);
    say(r.diffMainJs === 0 && r.mainJs === 'js', `every 5th (${r.sub}) with this thread on the JavaScript path (${r.mainJs}) and the workers on the kernel: ${r.diffMainJs} differ`);
    say(r.diffWorkerJs === 0 && r.workersJs.every(k => k === 'js') && r.workersBack.every(k => k === 'simd'), `and with the workers on the JavaScript path (${r.workersJs.join(', ')}) and this thread on the kernel (${r.main}): ${r.diffWorkerJs} differ`);
    say(null, `one group costs ${(r.mainMs / r.jobs).toFixed(2)} ms on this thread and ${(r.workerMs / r.jobs).toFixed(2)} ms in a worker (two of them at work on ${os.cpus().length} cores); on the JavaScript path ${(r.mainJsMs / r.sub).toFixed(1)} ms`);
    say(page.errors.length === 0, `no page error${page.errors.length ? ': ' + page.errors[0] : ''}`);
    await page.close();
  }

  if (WHAT.includes('read')) {
    console.log(`\n— read: a board of ${EXPRS} expressions, cold, each way on a new page (three times each; the middle one)`);
    let errors = 0;
    const one = async (auto, f) => {
      const page = await open(file(auto ? 'auto.html' : 'still.html'));
      const r = await f(page);
      errors += page.errors.length; if (page.errors.length) console.log('     page error: ' + page.errors[0]);
      await page.close(); await wait(400);
      return r;
    };
    const mid = (rs, k) => rs.map(r => r[k]).sort((a, b) => a - b)[rs.length >> 1];
    const loadStill = page => page.evaluate((rows, N) => X.load(rows, N, 1), rows, EXPRS);
    const pooledRun = (n, rounds, split) => one(false, async page => {
      await loadStill(page);
      const st = await page.evaluate(n => X.startPool(n, 8), n);
      const r = await page.evaluate((rounds, split) => X.pooled(rounds, split), rounds, split);
      r.startMs = st.wallMs;
      return r;
    });
    const today = [], once = [], pool1 = [], pool2 = [];
    for (let k = 0; k < 3; k++) {
      today.push(await one(true, page => page.evaluate((rows, N) => X.asToday(rows, N, 1), rows, EXPRS)));
      once.push(await one(false, async page => { await loadStill(page); return page.evaluate(() => X.atOnce()); }));
      pool1.push(await pooledRun(1, false, false));
      pool2.push(await pooledRun(2, false, false));
    }
    const ref = once[0], all = today.concat(once, pool1, pool2);
    say(null, `${ref.strokes} strokes in ${ref.recs} recognizers; a cold read classifies ${ref.classified} groups (${(ref.classified / ref.strokes).toFixed(2)} a stroke)`);
    say(all.every(r => r.digest === ref.digest && r.cache === ref.cache), `the same reading and the same bits in every cache entry, all ${all.length} runs: ${all.every(r => r.digest === ref.digest && r.cache === ref.cache) ? 'yes' : 'NO'} (${ref.cache})`);
    say(null, `as today (the pad's read, in slices): ${ms(mid(today, 'readMs'))} (${today.map(r => Math.round(r.readMs)).join(', ')}); all ${today[0].classified} groups classified on this thread, which is held ${ms(mid(today, 'longestHold'))} at the longest (after the browser has drawn the page, which holds it ${ms(mid(today, 'drawMs'))})`);
    say(null, `at once (recognize()): ${ms(mid(once, 'ms'))} (${once.map(r => Math.round(r.ms)).join(', ')}), this thread held for all of it`);
    for (const [n, rs] of [[1, pool1], [2, pool2]]) {
      const r = rs[0];
      say(null, `${n} worker${n > 1 ? 's' : ''}: ${ms(mid(rs, 'ms'))} (${rs.map(r => Math.round(r.ms)).join(', ')}) = plan ${ms(mid(rs, 'planMs'))} + pool ${ms(mid(rs, 'runMs'))} + the read ${ms(mid(rs, 'readMs'))}; the pool took ${r.jobs} groups (${(100 * r.jobs / ref.classified).toFixed(1)}%), ${r.left} stayed on this thread`);
      say(null, `     the workers computed for ${ms(mid(rs.map(r => r.stats), 'workerMs'))} in ${r.stats.chunks} chunks; this thread spent ${ms(mid(rs.map(r => r.stats), 'postMs'))} posting and ${ms(mid(rs.map(r => r.stats), 'backMs'))} taking answers, and was held ${ms(mid(rs, 'longestHoldDuringRun'))} at the longest while the pool ran; starting the workers took ${ms(mid(rs, 'startMs'))} (not counted above)`);
    }
    // what is left on this thread, by kind; and the joined groups handed to the pool as well
    const split = await pooledRun(2, false, true);
    say(split.digest === ref.digest && split.cache === ref.cache, `what stays on this thread: ${split.leftClusters} groups in the clusters' rehearsals and ${split.leftJoins} in the groups joinOperands puts together (of ${ref.classified})`);
    const rounds = await pooledRun(2, true, true);
    say(rounds.digest === ref.digest && rounds.cache === ref.cache, `the joined groups handed to the pool too, round by round: ${rounds.joinJobs} more groups in ${rounds.rounds} round${rounds.rounds === 1 ? '' : 's'} (planned in ${ms(rounds.joinPlanMs)}, pooled in ${ms(rounds.joinRunMs)}); ${rounds.left} then stay on this thread; the same reading and bits: ${rounds.digest === ref.digest && rounds.cache === ref.cache ? 'yes' : 'NO'}`);
    say(errors === 0, `no page error`);
  }

  if (WHAT.includes('rules')) {
    console.log('\n— rules: the same page over http, under a Content-Security-Policy');
    const SITE = "default-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
    const cases = [
      ['no rule', null, true, 'simd'],
      ["the site's rule for the two Nib pages", SITE, true, 'simd'],
      ["that rule with workers forbidden (worker-src 'none')", SITE + "; worker-src 'none'", false, 'simd'],
      ["the site's rule for its other pages (no WebAssembly)", SITE.replace(" 'wasm-unsafe-eval'", ''), true, 'js'],
      ['a rule without blob:', SITE.replace(' blob:', ''), false, 'simd'],
    ];
    cases.forEach((c, i) => fs.writeFileSync(path.join(dir, `rule${i}.html`), html(c[1], 'auto="false"')));
    const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
    const server = http.createServer((req, res) => {
      const f = path.join(dir, path.basename(req.url.split('?')[0]));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port + '/';
    for (let i = 0; i < cases.length; i++) {
      const [name, rule, starts, kernel] = cases[i];
      const page = await open(base + `rule${i}.html`);
      await page.evaluate((rows, N) => X.load(rows, N, 1), rows, 12);
      const r = await page.evaluate(async () => {
        const t0 = performance.now();
        try { const st = await X.startPool(1, 8); const id = await X.identity(3); return { started: true, ms: performance.now() - t0, worker: st.workers[0].kernel, jobs: id.jobs, diff: id.diff + id.diffMainJs + id.diffWorkerJs }; }
        catch (e) { return { started: false, ms: performance.now() - t0, why: e.message }; }
      });
      const refused = page.said.filter(t => /Content Security Policy|Refused to/.test(t)).map(t => t.replace(/\s+/g, ' ').slice(0, 150));
      const ok = r.started === starts && page.info.kernel === kernel && (!r.started || (r.diff === 0 && r.worker === kernel)) && page.errors.length === 0;
      say(ok, `${name}: this thread on ${page.info.kernel}; ` + (r.started ? `a worker started, on ${r.worker}; ${r.jobs} groups, ${r.diff} differ` : `no worker — ${r.why}, known after ${ms(r.ms)}`) +
        (refused.length ? ` | the browser said: ${refused[0]}` : '') + (page.errors.length ? ' | page error: ' + page.errors[0] : ''));
      await page.close();
    }
    server.close();
  }

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? `\n${bad} did not hold` : '\nall of it holds');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('the prototype stopped: ' + (e && e.stack || e)); process.exit(1); });
