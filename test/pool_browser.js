// The worker pool in a real browser (1.8.0; the node side is test/pool_check.js), from file:// with no flags:
//   1. it starts: a worker from the engine's own source, on the kernel; the groups of a full page classified there and
//      on the page's thread give the same bits, also with this thread on the JavaScript path; a group the classifier
//      throws on is answered with nothing and the pool goes on
//   2. the bits of a pooled read: a page of 60 expressions read with the pool as it comes, with two workers, and with
//      this thread on the JavaScript path, against the same page read with the pool off: the same reading and the
//      same bits in every cache entry of every recognizer; and the page's thread is free: of the groups classified in
//      the read, at least 90% in workers
//   3. every fallback: a page whose rule forbids workers, a worker that fails, never answers or answers wrongly in the
//      middle of a read, one that does not start in time, a group that cannot be sent, workers whose classifier
//      fails, poolUse(0), the asking itself failing — each reads what the pool off reads; the one line said
//   4. what happens during a cold read: strokes written below the page (no group asked of the pool twice) and into
//      its expressions (only theirs asked again) — the reading at rest is the cold read's of the final page; the page
//      replaced (the new one does not wait for the old one's groups); read at once by the host, tapped, an option
//      changed, a stroke nudged and put back, moved and undone, the page cleared and brought back, a stroke resized,
//      the smoothing changed (what was asked for the old strokes is taken out of the queue), the pad destroyed; two
//      pads at once
//   5. the pages: the Board opened on a saved page of 60 expressions starts workers and reads it, and says how many it
//      may use — none, once a rule that forbids workers has stopped one; dist/Nib.html and a small pad never start one
// Nothing here is timed: it counts. (Whether a read is worth asking the pool for goes by what a classification costs
// on this thread; where a test reads twice on one page it sets that limit to 0, so the machine's speed decides nothing.)
//   node test/pool_browser.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const T = require('./data'), puppeteer = require(T.npm('puppeteer-core'));
const Nib = require(path.join(__dirname, '..', 'dist', 'nib.js'));
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (c) passes++; else fails++; };
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).map(r => ({ strokes: r.strokes }));
const PAGE = path.join(__dirname, 'pool_page.html'), ENGINE = path.join(__dirname, '..', 'dist', 'nib.js');
// a board pad as the scripted sessions have it (tools/verify/session.js)
const ATTRS = { view: 'ink', settle: '0', delay: '30', separate: '', times: 'false', reveal: '', solve: '', infinite: '', paper: 'dots' };

// ---------------------------------------------------------------- in the page
function pageMain() {
  const I = Nib._internals, X = window.X = {};
  // the page of tools/verify/session.js: N school problems, four to a row, every fifth with a gap in its line
  X.strokes = (rows, N, SEED, dy) => {
    const place = (k, col, row, gap) => {
      const r = rows[(k * 7 + SEED * 13) % rows.length]; let x0 = Infinity, y0 = Infinity, y1 = -Infinity;
      for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      const st = r.strokes.map(s => s.map(p => [(p[0] - x0) * 0.7 + 60 + col * 900, (p[1] - y0) * 0.7 + 400 + row * 260 + (dy || 0)]));
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
  // every recognizer a pad uses, and every group asked of needs() (by recognizer, bucket and key: how often)
  X.seen = new Set(); X.asked = new Map(); X.recId = new WeakMap(); let nrec = 0;
  const id = r => { let k = X.recId.get(r); if (!k) { k = ++nrec; X.recId.set(r, k); } return k; };
  const needs = Nib.Recognizer.prototype.needs;
  Nib.Recognizer.prototype.needs = function (input, options) {
    const n = needs.call(this, input, options);
    X.seen.add(this);
    for (const j of n.jobs) { const k = id(this) + n.bucket + '|' + j.key; X.asked.set(k, (X.asked.get(k) || 0) + 1); }
    return n;
  };
  X.pad = attrs => {
    const el = window.makePad(attrs);
    X.P = el.pad; X.el = el;
    const P = X.P, orig = P._recFor;
    P._recFor = function (f) { const r = orig.call(this, f); X.seen.add(r); return r; };
    X.seen.add(P.rec);
    return !!P;
  };
  X.settled = () => { const P = X.P, ink = P.ink, rs = P.resultStrokes || []; return !P.busy && !!P.result && rs.length === ink.length && rs.every((s, k) => s === ink[k]); };
  X.rest = async () => { for (let i = 0; i < 6000; i++) { await new Promise(r => setTimeout(r, 25)); if (X.settled()) return true; } return false; };
  // what the page reads: everything a user or a host can see of it, numbers at full precision
  X.digest = () => {
    const P = X.P, res = P.result, rs = P.resultStrokes || [], at = new Map(P.ink.map((s, i) => [s, i]));
    return JSON.stringify({ n: P.ink.length, latex: res && res.latex, text: res && res.text, conf: res && res.confidence,
      syms: res && res.symbols.map(s => [s.label, s.strokes.map(i => at.get(rs[i])), s.candidates, s.box]),
      parts: res && res.parts && res.parts.map(p => [p.idx.map(i => at.get(rs[i])), p.result && p.result.latex, p.result && p.result.confidence]),
      answers: (P.answers || []).map(a => [a.line, a.latex, a.kind, a.exact, a.value]), solved: P.solvedLatex(), faults: (P.faults || []).length });
  };
  // every cache entry of every recognizer the pad used, bit for bit, as one number (FNV-1a over the keys and the
  // bytes), in an order that does not depend on how the recognizers were made
  X.cacheHash = () => {
    const enc = new TextEncoder(), sums = [];
    let entries = 0;
    for (const r of X.seen) {
      let h = 0x811c9dc5;
      const eat = b => { for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } };
      for (const k of [...r.cache.keys()].sort()) {
        const e = r.cache.get(k); entries++;
        eat(enc.encode(k)); eat(new Uint8Array(e.buffer, e.byteOffset, e.byteLength)); eat(new Uint8Array(e.hidden.buffer, e.hidden.byteOffset, e.hidden.byteLength));
      }
      if (r.cache.size) sums.push(h.toString(16));
    }
    return entries + ' entries, ' + sums.sort().join('.').length + ':' + sums.sort().reduce((a, s) => (Math.imul(a, 31) + parseInt(s, 16)) >>> 0, 7).toString(16);
  };
  X.result = () => ({ digest: X.digest(), cache: X.cacheHash(), stats: I.poolTest('stats'), workers: Nib.workers, strokes: X.P.ink.length,
    twice: [...X.asked.values()].filter(v => v > 1).length, asked: X.asked.size });
  // a page of N expressions put on a new pad, read as it comes
  X.read = async (rows, N, SEED) => {
    X.pad(X.attrs); I.poolTest('reset');
    X.P.setState({ strokes: X.strokes(rows, N, SEED) });
    const rested = await X.rest();
    return Object.assign({ rested }, X.result());
  };
  // the groups the first loops of a full page would ask for, on fresh recognizers
  X.jobs = (rows, N, SEED) => {
    const ink = X.strokes(rows, N, SEED), jobs = [];
    for (const g of I.clustersOf(ink)) { const n = new Nib.Recognizer().needs(g.map(i => ink[i]), { times: false }); for (const j of n.jobs) jobs.push({ group: j.group, ref: n.ref }); }
    return jobs;
  };
  X.same = (a, b) => {
    if (!a || !b || a.constructor !== b.constructor || a.length !== b.length || !a.hidden || !b.hidden || a.hidden.constructor !== b.hidden.constructor || a.hidden.length !== b.hidden.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    for (let i = 0; i < a.hidden.length; i++) if (!Object.is(a.hidden[i], b.hidden[i])) return false;
    return true;
  };
  // until the pool has answered n groups (the page is being classified, and is far from done)
  X.answered = async n => { for (let i = 0; i < 4000 && I.poolTest('stats').answered < n; i++) await new Promise(r => setTimeout(r, 5)); return I.poolTest('stats'); };
  X.listed = () => [...X.asked.values()].reduce((a, v) => a + v, 0);
  X.ink = () => X.P.ink.map(s => s.map(p => [p[0], p[1]]));
  // a touch that writes nothing: the laser, down and up
  X.tap = (x, y) => {
    const c = X.el.querySelector('canvas'), b = c.getBoundingClientRect();
    const ev = type => c.dispatchEvent(new PointerEvent(type, { pointerId: 61, pointerType: 'touch', isPrimary: true, clientX: b.left + x, clientY: b.top + y, pressure: 0.5, width: 1, height: 1, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    ev('pointerdown'); ev('pointerup');
  };
  // strokes that would each join one of the page's last expressions and move its size by 3 to 14% (within what
  // classRef holds a size through): a copy of one of its own strokes, put to its right, as it is or larger
  X.joiners = (rows, N, SEED, most) => {
    const ink = X.strokes(rows, N, SEED), cl = I.clustersOf(ink), out = [], pageRef = I.refSize(ink);
    for (let c = cl.length - 1; c >= 0 && out.length < most; c--) {
      const g = cl[c].map(i => ink[i]); if (g.length < 4) continue;
      const x1 = Math.max(...g.flat().map(p => p[0])), r0 = I.refSize(g);
      search: for (const s of g) {
        const x0 = Math.min(...s.map(p => p[0])), cy = s[0][1];
        for (const k of [1.0, 1.3, 1.6]) {
          const add = s.map(p => [x1 + 0.4 * pageRef + (p[0] - x0) * k, cy + (p[1] - cy) * k]);
          const all = ink.concat(out.map(o => o.add), [add]), mine = I.clustersOf(all).find(q => q.includes(all.length - 1));
          if (!mine || !mine.includes(cl[c][0])) continue;
          const q = Math.abs(Math.log(I.refSize(mine.filter(i => i < ink.length || i === all.length - 1).map(i => all[i])) / r0));
          if (q > 0.03 && q < 0.14) { out.push({ add, piece: c, moves: q, groups: 0 }); break search; }
        }
      }
    }
    return out;
  };
  // something happens while a page of N expressions is being read cold (the pool has answered 40 of its groups)
  X.during = async (rows, N, what) => {
    X.pad(X.attrs); I.poolTest('reset');
    const P = X.P; let results = 0;
    X.el.addEventListener('nib:result', () => results++);
    P.setState({ strokes: X.strokes(rows, N, 1) });
    const at = await X.answered(40), listedAt = X.listed(), busyAt = P.busy;
    const pick = () => { const s = P.ink[5]; P.select([s]); return s; };
    if (what === 'recognize') P.recognize();
    if (what === 'two workers') I.poolUse(2);
    if (what === 'no pool') I.poolUse(0);
    if (what === 'taps') { P.setMode('laser'); for (let k = 0; k < 4; k++) { X.tap(300 + 40 * k, 300); await new Promise(r => setTimeout(r, 15)); } P.setMode('draw'); }
    if (what === 'symbols') X.el.setAttribute('symbols', 'all');
    if (what === 'smooth') X.el.setAttribute('smooth', '0.03');
    if (what === 'nudge and back') { pick(); P.nudgeSelection(40, 0); P.nudgeSelection(-40, 0); P.clearSelection(); }
    if (what === 'nudge and undo') { pick(); P.nudgeSelection(40, 0); P.undo(); P.clearSelection(); }
    if (what === 'clear and undo') { P.clear(); P.undo(); }
    // (a stroke resized, as the selection's handles resize it: the points changed in place, then the pad's own calls)
    if (what === 'resize') { const q = P.ink[5], x0 = q[0][0], y0 = q[0][1]; for (const p of q) { p[0] = x0 + (p[0] - x0) * 1.6; p[1] = y0 + (p[1] - y0) * 1.6; } P._inkMoved([q], true); P._changed(); }
    if (what === 'destroy') {
      P.destroy();
      for (let i = 0; i < 400 && P._asks.size; i++) await new Promise(r => setTimeout(r, 25));
      await new Promise(r => setTimeout(r, 300));
      const st = I.poolTest('stats');
      return { destroyed: true, at: at.answered, after: st.answered - at.answered, dropped: st.dropped, queued: st.queued, asks: P._asks.size, busy: P.busy, results, dead: st.dead };
    }
    const rested = await X.rest();
    const st = I.poolTest('stats');
    return Object.assign({ rested, at: at.answered, busyAt, results, final: X.ink(), sentAfter: st.sent - at.sent, listedAfter: X.listed() - listedAt }, X.result());
  };
  // a list with a group no classifier can take in its middle (not strokes at all: needs() never lists one)
  X.odd = async (rows, N) => {
    const jobs = X.jobs(rows, N, 1).slice(0, 30).map((j, i) => Object.assign({ i }, j)), got = [];
    jobs.splice(11, 0, { i: -1, group: null, ref: 40 });
    const before = I.poolTest('stats');
    const done = await I.poolRun(jobs, (j, e) => { got.push(j.i); if (!X.same(I.classifyGroup(j.group, j.ref), e)) got.push('differs'); }).done;
    const after = I.poolTest('stats');
    return { done, got: got.join(), want: jobs.filter(j => j.i >= 0).map(j => j.i).join(), failed: after.failed - before.failed, answered: after.answered - before.answered, dead: after.dead, workers: Nib.workers };
  };
  X.identity = async (rows, N, stride) => {
    const jobs = X.jobs(rows, N, 1).map((j, i) => Object.assign({ i }, j)), got = new Array(jobs.length);
    const done = await I.poolRun(jobs, (j, e) => { got[j.i] = e; }).done;
    let diff = 0, diffJs = 0, sub = 0;
    for (const j of jobs) if (!X.same(I.classifyGroup(j.group, j.ref), got[j.i])) diff++;
    I.kernelUse('js');
    for (const j of jobs) if (j.i % stride === 0) { sub++; if (!X.same(I.classifyGroup(j.group, j.ref), got[j.i])) diffJs++; }
    const main = Nib.kernel;
    I.kernelUse('auto');
    return { done, jobs: jobs.length, diff, diffJs, sub, main, workers: Nib.workers, stats: I.poolTest('stats') };
  };
}

// ---------------------------------------------------------------- the driver
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-pool-'));
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, userDataDir: path.join(dir, 'profile'), protocolTimeout: 0, args: ['--no-sandbox'] });   // no flag for file://
  const helper = '(' + pageMain.toString() + ')();';
  const open = async (url, init, pre) => {
    const page = await browser.newPage();
    if (pre) await page.evaluateOnNewDocument(pre);
    await page.setViewport({ width: 1400, height: 900 });
    page.errors = []; page.infos = [];
    page.on('pageerror', e => page.errors.push(String(e.message || e).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'info') page.infos.push(m.text()); if (m.type() === 'error' && !/Content Security Policy|Refused to/.test(m.text())) page.errors.push('console: ' + m.text().slice(0, 200)); });
    await page.goto(url, { waitUntil: 'load' });
    await page.addScriptTag({ content: helper });
    await page.evaluate((attrs, init) => { X.attrs = attrs; if (init) (0, eval)(init); }, ATTRS, init || '');
    return page;
  };
  const file = f => 'file://' + f;
  // a page read in a new page: as it comes, or after a line of script (poolUse, kernelUse, …)
  const readOn = async (url, init, N, SEED) => {
    const page = await open(url, init);
    const r = await page.evaluate((rows, N, SEED) => X.read(rows, N, SEED), rows, N, SEED || 1);
    r.errors = page.errors; r.infos = page.infos;
    await page.close();
    return r;
  };
  const say = r => `${r.strokes} strokes, ${r.cache}; ${r.stats.started} workers started, ${r.stats.answered} groups answered by them, ${r.stats.here} classified here`;
  const N = 60;

  console.log('1. a worker from the engine\'s own source, from file://');
  {
    const page = await open(file(PAGE), 'Nib._internals.poolUse(2)');
    const r = await page.evaluate((rows, N) => X.identity(rows, N, 5), rows, N);
    ok(r.done && r.stats.kernels.length === 2 && r.stats.kernels.every(k => k === 'simd'), `two workers started (${r.stats.started}), both on ${r.stats.kernels.join(' and ')}; Nib.workers ${r.workers}`);
    ok(r.diff === 0 && r.jobs > 600, `the ${r.jobs} groups of a page of ${N} expressions: ${r.diff} differ between the workers and this thread, both on the kernel`);
    ok(r.diffJs === 0 && r.main === 'js' && r.sub > 100, `every 5th (${r.sub}) with this thread on the JavaScript path (${r.main}) and the workers on the kernel: ${r.diffJs} differ`);
    const o = await page.evaluate((rows, N) => X.odd(rows, N), rows, N);
    ok(o.done === true && o.failed === 1 && o.answered === 30 && o.got.split(',').sort().join() === o.want.split(',').sort().join() && !o.dead && o.workers === 2,
      `a group the classifier throws on, among 30: ${o.failed} answered with nothing, the other ${o.answered} as this thread classifies them, the pool goes on (${o.workers} workers)`);
    ok(!page.errors.length && !page.infos.length, 'nothing said, no page error' + (page.errors.length ? ': ' + page.errors[0] : '') + (page.infos.length ? ': ' + page.infos[0] : ''));
    await page.close();
  }

  // how many it may use: every core but one, at most 4, and no more than the device's gigabytes where it says them
  {
    const sizes = [];
    for (const [cores, mem] of [[2, undefined], [1, undefined], [4, undefined], [8, undefined], [16, 8], [8, 2], [8, 1], [8, 0.5]]) {
      const page = await open(file(PAGE), '', `(() => { Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => ${cores} });` +
        (mem === undefined ? `Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => undefined });` : `Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => ${mem} });`) + '})()');
      sizes.push(await page.evaluate(() => Nib._internals.poolSize()));
      await page.close();
    }
    ok(sizes.join() === '1,0,3,4,4,2,1,0', `the size it may use, for 2, 1, 4, 8 cores, 16 cores and 8 GB, 8 cores and 2 GB, 1 GB, 0.5 GB: ${sizes.join(', ')}`);
  }
  {
    // workers with nothing to do are let go (the limit made 0.4 s here), and the next big read starts them again
    // (work: 0 — the second read on this page asks the pool however little a classification costs on this machine)
    const page = await open(file(PAGE), 'Nib._internals.poolUse(2); Nib._internals.poolTest("limits", { idle: 400, work: 0 })');
    const r = await page.evaluate(async (rows, N) => {
      const I = Nib._internals, a = await X.read(rows, N, 1), during = a.workers;
      await new Promise(r => setTimeout(r, 1200));
      const after = Nib.workers, b = await X.read(rows, N, 2);
      return { during, after, again: b.stats.started, answered: b.stats.answered, rested: b.rested };
    }, rows, 20);
    ok(r.during === 2 && r.after === 0 && r.again === 2 && r.answered > 200 && r.rested, `idle workers go: ${r.during} after a read, ${r.after} once idle past the limit, ${r.again} started again by the next read (${r.answered} groups)`);
    await page.close();
  }

  console.log(`2. the bits of a pooled read, a page of ${N} expressions`);
  const ref = await readOn(file(PAGE), 'Nib._internals.poolUse(0)', N);
  ok(ref.rested && ref.stats.started === 0 && ref.stats.here > 600 && !ref.errors.length, `the pool off: read on this thread alone — ${say(ref)}`);
  const auto = await readOn(file(PAGE), '', N);
  ok(auto.rested && auto.digest === ref.digest && auto.cache === ref.cache, `the pool as it comes (${auto.stats.size} worker${auto.stats.size === 1 ? '' : 's'} here): the same reading and the same bits in every entry — ${say(auto)}`);
  const share = auto.stats.answered / (auto.stats.answered + auto.stats.here);
  ok(share >= 0.9, `the page's thread is free: ${(100 * share).toFixed(1)}% of the read's ${auto.stats.answered + auto.stats.here} classifications in workers (at least 90%)`);
  const two = await readOn(file(PAGE), 'Nib._internals.poolUse(2)', N);
  ok(two.rested && two.digest === ref.digest && two.cache === ref.cache && two.stats.started === 2, `two workers: the same reading and bits — ${say(two)}`);
  const js = await readOn(file(PAGE), "Nib._internals.poolUse(2); Nib._internals.kernelUse('js')", N);
  ok(js.rested && js.digest === ref.digest && js.cache === ref.cache && js.stats.kernels.every(k => k === 'simd'), `this thread on the JavaScript path, the workers on ${js.stats.kernels.join(' and ')}: the same reading and bits — ${say(js)}`);
  const big = await readOn(file(PAGE), 'Nib._internals.poolUse(0)', 120), big2 = await readOn(file(PAGE), 'Nib._internals.poolUse(2)', 120);
  ok(big2.rested && big2.digest === big.digest && big2.cache === big.cache, `and a page of 120 expressions, two workers against none: the same reading and bits — ${say(big2)}`);
  // a pad of one expression (separate off) gets the same when its read is big
  const one = Object.assign({}, ATTRS); delete one.separate;
  const oneOff = await readOn(file(PAGE), 'X.attrs = ' + JSON.stringify(one) + '; Nib._internals.poolUse(0)', 20), oneOn = await readOn(file(PAGE), 'X.attrs = ' + JSON.stringify(one), 20);
  ok(oneOn.rested && oneOn.stats.started >= 1 && oneOn.stats.answered > 200 && oneOn.digest === oneOff.digest && oneOn.cache === oneOff.cache,
    `a pad of one expression, 20 problems in it: the same reading and bits with the pool as without — ${say(oneOn)}`);
  ok([auto, two, js, big2, oneOn].every(r => !r.errors.length && !r.infos.length), 'nothing said, no page error');

  console.log('3. where the pool cannot help');
  {
    // a page whose rule forbids workers
    const csp = path.join(dir, 'csp.html');
    fs.writeFileSync(csp, fs.readFileSync(PAGE, 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="worker-src \'none\'">').replace('../dist/nib.js', file(ENGINE)));
    const r = await readOn(file(csp), '', N);
    const said = r.infos.filter(t => /^Nib: reading on the page's own thread only/.test(t));
    ok(r.rested && r.digest === ref.digest && r.cache === ref.cache, `worker-src 'none': read as with the pool off — ${say(r)}`);
    ok(said.length === 1 && r.infos.length === 1 && r.workers === 0 && r.stats.dead && !r.errors.length, `one line said (${JSON.stringify(said[0] || r.infos[0] || '')}), Nib.workers ${r.workers}, no page error${r.errors.length ? ': ' + r.errors[0] : ''}`);
  }
  {
    // the site's rule for the two Nib pages (mrshaffer.org; tools/verify/pages_probe.js), with the engine in the page
    // as the Board carries it: workers start under it, from blob:
    const SITE = "default-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
    const site = path.join(dir, 'site.html');
    fs.writeFileSync(site, fs.readFileSync(PAGE, 'utf8').replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${SITE}">`)
      .replace('<script src="../dist/nib.js"></script>', () => '<script>' + fs.readFileSync(ENGINE, 'utf8').replace(/<\/script/g, '<\\/script') + '</script>'));
    const r = await readOn(file(site), '', N);
    ok(r.rested && r.digest === ref.digest && r.cache === ref.cache && r.stats.answered > 600 && r.stats.kernels.every(k => k === 'simd') && !r.infos.length && !r.errors.length,
      `the site's rule for the Nib pages, the engine inline: workers start (on ${r.stats.kernels.join(', ')}), the same reading and bits — ${say(r)}`);
  }
  // a worker that fails, one that never answers, and one that answers wrongly, in the middle of a read
  for (const [name, what, limits, why] of [['a worker that fails in the middle of the read', 'crash', null, /a worker failed/], ['a pool that never answers (its limit made 1.5 s)', 'mute', { chunk: 1500 }, /did not answer within 1\.5 s/],
    ['a worker that answers with the wrong number of groups', 'garble', null, /wrong shape/]]) {
    const page = await open(file(PAGE), 'Nib._internals.poolUse(2)' + (limits ? '; Nib._internals.poolTest("limits", ' + JSON.stringify(limits) + ')' : ''));
    const r = await page.evaluate(async (rows, N, what) => {
      const I = Nib._internals;
      X.pad(X.attrs); I.poolTest('reset');
      X.P.setState({ strokes: X.strokes(rows, N, 1) });
      const at = (await X.answered(40)).answered;
      I.poolTest(what, 0); I.poolTest(what, 1);
      const rested = await X.rest();
      return Object.assign({ rested, at }, X.result());
    }, rows, N, what);
    ok(r.rested && r.at >= 40 && r.stats.answered < r.asked && r.stats.here > 0 && r.digest === ref.digest && r.cache === ref.cache,
      `${name} (after ${r.at} answers of ${r.asked}): the right reading and bits — ${say(r)}`);
    ok(r.stats.dead && why.test(r.stats.why) && r.workers === 0 && page.infos.length === 1 && !page.errors.length, `the pool is dead (${JSON.stringify(r.stats.why)}), Nib.workers ${r.workers}, one line said, no page error${page.errors.length ? ': ' + page.errors[0] : ''}`);
    await page.close();
  }
  {
    // a worker that is not ready in time (the limit made 1 ms: none can be)
    const r = await readOn(file(PAGE), 'Nib._internals.poolUse(2); Nib._internals.poolTest("limits", { ready: 1 })', N);
    ok(r.rested && r.digest === ref.digest && r.cache === ref.cache && r.stats.dead && /did not start/.test(r.stats.why) && r.stats.answered === 0 && r.infos.length === 1 && !r.errors.length,
      `a worker that does not start in time: the page read on this thread, the right reading and bits, one line said (${JSON.stringify(r.stats.why)}) — ${say(r)}`);
  }
  {
    // what the pool cannot send, and workers whose classifier fails on everything: the pool's end, said once, and
    // the pad reads all the same
    for (const [name, jobs, why, failed] of [['a group that cannot be sent to a worker', '[{ group: [[() => 1]], ref: 40 }]', /could not be sent/, 0],
      ['workers whose classifier throws on eight groups in a row', 'Array.from({ length: 12 }, () => ({ group: null, ref: 40 }))', /classifier fails/, 8]]) {
      const page = await open(file(PAGE), 'Nib._internals.poolUse(1)');
      const r = await page.evaluate(async (rows, N, jobs) => {
        const I = Nib._internals;
        let got = 0;
        const done = await I.poolRun((0, eval)(jobs), () => got++).done, st = I.poolTest('stats'), workers = Nib.workers;
        return Object.assign({ done, got, st, workers }, await X.read(rows, N, 1));
      }, rows, N, jobs);
      ok(r.done === false && r.got === 0 && r.st.dead && why.test(r.st.why) && r.st.failed === failed && r.workers === 0 && page.infos.length === 1 && !page.errors.length,
        `${name}: "not done", the pool is dead (${JSON.stringify(r.st.why)}), one line said, no page error${page.errors.length ? ': ' + page.errors[0] : ''}`);
      ok(r.rested && r.digest === ref.digest && r.cache === ref.cache && r.stats.started === 0, `and a page is read on this thread after it, the right reading and bits — ${say(r)}`);
      await page.close();
    }
  }
  ok(ref.stats.started === 0 && ref.workers === 0 && ref.stats.sent === 0 && !ref.infos.length, `poolUse(0): no worker is ever started (${ref.stats.started}), nothing sent, nothing said`);
  // the asking itself fails (it is an extra): the read's steps begin as they always did
  for (const [name, method] of [['finding what there is to read', '_partKey'], ['listing a piece\'s groups', '_recFor']]) {
    const page = await open(file(PAGE), '');
    const r = await page.evaluate(async (rows, N, method) => {
      const I = Nib._internals;
      X.pad(X.attrs); I.poolTest('reset');
      const P = X.P, orig = P[method];
      let threw = 0, calls = 0;
      P[method] = function () { if (!calls++) { threw++; throw new Error('thrown by the test, in the asking'); } return orig.apply(this, arguments); };
      P.setState({ strokes: X.strokes(rows, N, 1) });
      const rested = await X.rest();
      return Object.assign({ rested, threw, calls }, X.result());
    }, rows, N, method);
    ok(r.rested && r.threw === 1 && r.calls > 60 && r.digest === ref.digest && r.cache === ref.cache && r.stats.sent === 0 && !r.stats.dead && !page.errors.length && !page.infos.length,
      `the asking fails while ${name} (${method} throws once): the page is read on this thread all the same, the same reading and bits, nothing said — ${say(r)}`);
    await page.close();
  }

  console.log('4. during a cold read');
  {
    // strokes written, one at a time, below the page while it is read cold (as a writer starts on the next problem);
    // one worker, however many cores there are here, so that the page is still being classified when they come
    const page = await open(file(PAGE), 'Nib._internals.poolUse(1)');
    const r = await page.evaluate(async (rows, N) => {
      const I = Nib._internals;
      X.pad(X.attrs); I.poolTest('reset');
      const more = X.strokes(rows.slice(300), 2, 3, 16 * 260);
      X.P.setState({ strokes: X.strokes(rows, N, 1) });
      const first = (await X.answered(16)).answered;
      let written = 0, during = 0;
      for (const st of more) {
        const before = I.poolTest('stats');
        if (before.queued > 0) during++;                    // (the pool still has groups of the page to give out)
        X.P.addElement(st); written++;
        // the next stroke when the pool has answered more, or a short pause
        for (let i = 0; i < 40 && I.poolTest('stats').answered === before.answered; i++) await new Promise(r => setTimeout(r, 5));
      }
      const rested = await X.rest();
      return Object.assign({ rested, written, during, first, final: X.ink() }, X.result());
    }, rows, N);
    ok(r.written >= 8 && r.during >= 4 && r.first < 200, `${r.written} strokes written below the page, the first when the pool had answered ${r.first} of its groups, ${r.during} of them with groups of the page still waiting for a worker`);
    ok(r.rested && r.twice === 0, `the page's classification not started over: ${r.asked} groups asked of the pool, ${r.twice} of them twice — ${say(r)}`);
    // the same final page read cold, the pool off
    const page2 = await open(file(PAGE), 'Nib._internals.poolUse(0)');
    const c = await page2.evaluate(async st => { X.pad(X.attrs); X.P.setState({ strokes: st }); await X.rest(); return X.result(); }, r.final);
    ok(r.digest === c.digest, `the reading once the pen rests is the cold read's of the same page (${c.strokes} strokes)`);
    await page.close(); await page2.close();
  }
  {
    // strokes written into three of the page's expressions while it is read cold, each moving its expression's size
    // by a few percent: asked before, such an expression must still be read at the size a cold read gives it
    const page = await open(file(PAGE), 'Nib._internals.poolUse(1)');
    const r = await page.evaluate(async (rows, N) => {
      const I = Nib._internals, add = X.joiners(rows, N, 1, 3), was = I.clustersOf(X.strokes(rows, N, 1)).length;
      X.pad(X.attrs); I.poolTest('reset');
      X.P.setState({ strokes: X.strokes(rows, N, 1) });
      const first = (await X.answered(16)).answered;
      let during = 0;
      for (const a of add) {
        const before = I.poolTest('stats');
        if (X.P._asks.size) during++;
        X.P.addElement(a.add);
        for (let i = 0; i < 40 && I.poolTest('stats').answered === before.answered; i++) await new Promise(r => setTimeout(r, 5));
      }
      const rested = await X.rest();
      return Object.assign({ rested, first, during, moves: add.map(a => (100 * a.moves).toFixed(1) + '%'), was, pieces: I.clustersOf(X.P.ink).length, final: X.ink() }, X.result());
    }, rows, N);
    const page2 = await open(file(PAGE), 'Nib._internals.poolUse(0)');
    const c = await page2.evaluate(async st => { X.pad(X.attrs); X.P.setState({ strokes: st }); await X.rest(); return Object.assign({ pieces: Nib._internals.clustersOf(X.P.ink).length }, X.result()); }, r.final);
    ok(r.moves.length === 3 && r.during === 3 && r.pieces === r.was && c.pieces === r.was, `three strokes written into expressions of the page (their sizes moved by ${r.moves.join(', ')}) while the pool was at work (${r.during}); the page's ${r.was} pieces are still ${r.pieces}`);
    ok(r.rested && r.digest === c.digest, `the reading once the pen rests is the cold read's of the same page, every field (${c.strokes} strokes)`);
    // (an expression whose size moved is listed again at its new size — another bucket of its recognizer's cache)
    ok(r.asked > auto.asked && r.asked - auto.asked < 120 && r.twice === 0 && r.stats.answered >= auto.stats.answered, `only those expressions are listed again: ${r.asked - auto.asked} groups beyond the page's ${auto.asked}, none of the page's twice — ${say(r)}`);
    await page.close(); await page2.close();
  }
  {
    // a page replaced while it is read cold
    const page = await open(file(PAGE), 'Nib._internals.poolUse(2)');
    const r = await page.evaluate(async (rows, N) => {
      const I = Nib._internals;
      X.pad(X.attrs); I.poolTest('reset');
      X.P.setState({ strokes: X.strokes(rows, N, 1) });
      const at = await X.answered(40), askedA = X.listed();
      X.P.setState({ strokes: X.strokes(rows, N, 2) });
      const rested = await X.rest();
      const askedB = X.listed() - askedA;
      return Object.assign({ rested, at, askedA, askedB }, X.result());
    }, rows, N);
    const afterA = r.stats.answered - r.at.answered - r.askedB;
    ok(r.rested && afterA >= 0 && afterA <= 2 * 8 && r.stats.dropped > 0, `replaced after ${r.at.answered} of the first page's ${r.askedA} groups: ${afterA} more of them answered (the chunks the two workers held: at most 16), ${r.stats.dropped} taken out of the queue`);
    const page2 = await open(file(PAGE), 'Nib._internals.poolUse(0)');
    const c = await page2.evaluate(async (rows, N) => { X.pad(X.attrs); X.P.setState({ strokes: X.strokes(rows, N, 2) }); await X.rest(); return X.result(); }, rows, N);
    ok(r.digest === c.digest, 'and the new page reads as it reads cold');
    await page.close(); await page2.close();
  }
  // what a writer or a host does while the page is being read cold: each time the page comes to rest read as the
  // pool off reads its final ink, with one reading announced for it
  {
    const same = [], odd = [];
    for (const what of ['recognize', 'two workers', 'no pool', 'taps', 'nudge and back', 'nudge and undo', 'clear and undo']) {
      const page = await open(file(PAGE), 'Nib._internals.poolUse(1)');
      const r = await page.evaluate((rows, N, what) => X.during(rows, N, what), rows, N, what);
      const fine = r.rested && r.busyAt && r.at >= 40 && r.at < 600 && r.results >= 1 && r.digest === ref.digest && !page.errors.length && !page.infos.length;
      (fine ? same : odd).push(`${what} (after ${r.at} answers: ${r.results} reading${r.results === 1 ? '' : 's'} announced${r.digest === ref.digest ? '' : ', ANOTHER READING'}${page.errors.length ? ', page error: ' + page.errors[0] : ''})`);
      await page.close();
    }
    ok(!odd.length && same.length === 7, `the host reads at once, the pool is given two workers or none, the board is tapped, a stroke is nudged and put back, moved and undone, the page cleared and brought back: read as the pool off reads the page — ${odd.length ? 'NOT: ' + odd.join('; ') : same.join('; ')}`);
    // an option changed, a stroke resized, the smoothing changed: read as the pool off reads that page from the start;
    // for the last two nothing asked before can be used, and what was still queued is not classified
    for (const [what, attr, drops] of [['symbols', { symbols: 'all' }, false], ['resize', null, true], ['smooth', { smooth: '0.03' }, true]]) {
      const page = await open(file(PAGE), 'Nib._internals.poolUse(1)');
      const r = await page.evaluate((rows, N, what) => X.during(rows, N, what), rows, N, what);
      const page2 = await open(file(PAGE), 'X.attrs = ' + JSON.stringify(Object.assign({}, ATTRS, attr || {})) + '; Nib._internals.poolUse(0)');
      const c = await page2.evaluate(async st => { X.pad(X.attrs); X.P.setState({ strokes: st }); await X.rest(); return X.result(); }, r.final);
      ok(r.rested && r.at >= 40 && r.at < 600 && r.digest === c.digest && !page.errors.length && !page.infos.length,
        `${what === 'symbols' ? 'the symbols allowed changed' : what === 'resize' ? 'a stroke resized' : 'the smoothing changed'} after ${r.at} answers: read as the pool off reads that page — ${say(r)}`);
      if (drops) ok(r.stats.dropped > 400 && r.sentAfter <= r.listedAfter, `what was queued for the old strokes is not classified: ${r.stats.dropped} groups taken out of the queue, ${r.sentAfter} sent after it for the ${r.listedAfter} the new read listed`);
      else ok(r.stats.dropped === 0 && r.twice === 0, `and nothing is asked again: the ${r.asked} answers serve the new read (${r.stats.sent} groups sent in all)`);
      await page.close(); await page2.close();
    }
    // the pad destroyed: nothing left waiting, nothing announced, the pool alive
    const page = await open(file(PAGE), 'Nib._internals.poolUse(1)');
    const d = await page.evaluate((rows, N) => X.during(rows, N, 'destroy'), rows, N);
    ok(d.destroyed && d.dropped > 400 && d.after <= 8 && d.queued === 0 && d.asks === 0 && !d.busy && d.results === 0 && !d.dead && !page.errors.length,
      `the pad destroyed after ${d.at} answers: ${d.dropped} groups taken out of the queue, ${d.after} more answered (the chunk the worker held), nothing waiting, nothing announced, no page error`);
    await page.close();
  }
  {
    // two pads on one page, both set at once: one queue, and each reads as it reads alone with the pool off
    const page = await open(file(PAGE), 'Nib._internals.poolUse(2)');
    const r = await page.evaluate(async (rows, N) => {
      const I = Nib._internals; I.poolTest('reset');
      const digest = P => JSON.stringify([P.result.latex, P.result.confidence, P.result.symbols.map(s => [s.label, s.candidates]), P.solvedLatex()]);
      const mk = id => { const el = document.createElement('nib-pad'); el.id = id; for (const k of Object.keys(X.attrs)) el.setAttribute(k, X.attrs[k]); el.style.height = '400px'; document.body.appendChild(el); return el.pad; };
      const A = mk('a'), B = mk('b');
      A.setState({ strokes: X.strokes(rows, N, 1) }); B.setState({ strokes: X.strokes(rows, N, 2) });
      for (let i = 0; i < 6000 && (A.busy || B.busy || !A.result || !B.result); i++) await new Promise(r => setTimeout(r, 25));
      const out = { busy: A.busy || B.busy, a: digest(A), b: digest(B), stats: I.poolTest('stats') };
      I.poolUse(0);
      const alone = [];
      for (const seed of [1, 2]) { const P = mk('c' + seed); P.setState({ strokes: X.strokes(rows, N, seed) }); for (let i = 0; i < 6000 && (P.busy || !P.result); i++) await new Promise(r => setTimeout(r, 25)); alone.push(digest(P)); }
      return Object.assign(out, { alone });
    }, rows, N);
    ok(!r.busy && r.a === r.alone[0] && r.b === r.alone[1] && r.stats.answered > 1200 && !r.stats.dead && !page.errors.length,
      `two pads of ${N} expressions each, set at once: ${r.stats.answered} groups answered through the one queue, and each reads as it reads alone with the pool off`);
    await page.close();
  }

  console.log('5. the pages');
  {
    // the Board opened on a saved page of 60 expressions
    const strokes = await (async () => { const p = await open(file(PAGE), 'Nib._internals.poolUse(0)'); const s = await p.evaluate((rows, N) => X.strokes(rows, N, 1).map(x => x.map(q => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10])), rows, N); await p.close(); return s; })();
    const pk = strokes.map(s => Nib.canvas.pack(s, false));
    const seed = { 'nib-board-v3': JSON.stringify({ v: 3, page: 0, pages: [{ pk, fixes: [], revealed: [], types: [], paper: { kind: 'blank', tone: 'theme' } }] }) };
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
    await page.setViewport({ width: 1400, height: 900 });
    await page.evaluateOnNewDocument(kv => { localStorage.clear(); for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]); }, seed);
    await page.goto(file(path.join(__dirname, '..', 'dist', 'Board.html')), { waitUntil: 'load' });
    await page.waitForFunction(n => { const p = document.getElementById('pad'); return p && p.pad && !p.pad.busy && p.pad.result && p.pad.result.parts && p.pad.strokes.length === n && p.pad.resultStrokes.length === n; }, { timeout: 300000 }, strokes.length);
    const b = await page.evaluate(() => ({ stats: Nib._internals.poolTest('stats'), parts: document.getElementById('pad').pad.result.parts.length, line: document.getElementById('engineline').textContent, size: Nib._internals.poolSize() }));
    ok(b.stats.started >= 1 && b.stats.answered > 500 && b.parts >= N && !errors.length, `the Board on a saved page of ${N} expressions: ${b.stats.started} worker${b.stats.started === 1 ? '' : 's'} started, ${b.stats.answered} groups answered there, ${b.parts} pieces read${errors.length ? '; page error: ' + errors[0] : ''}`);
    ok(b.size >= 1 && b.line === `Nib ${Nib.version} · the fast reader is on · ${b.size} worker thread${b.size === 1 ? '' : 's'}`, `Settings says how many it may use: ${JSON.stringify(b.line)}`);
    await page.close();
    // the same Board under a rule that forbids workers: it reads the page all the same, and Settings, opened after,
    // says there are none
    const none = path.join(dir, 'Board-noworkers.html');
    fs.writeFileSync(none, fs.readFileSync(path.join(__dirname, '..', 'dist', 'Board.html'), 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="worker-src \'none\'">'));
    const page2 = await browser.newPage(), errors2 = [], infos2 = [];
    page2.on('pageerror', e => errors2.push(String(e.message || e).slice(0, 200)));
    page2.on('console', m => { if (m.type() === 'info') infos2.push(m.text()); });
    await page2.setViewport({ width: 1400, height: 900 });
    await page2.evaluateOnNewDocument(kv => { localStorage.clear(); for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]); }, seed);
    await page2.goto(file(none), { waitUntil: 'load' });
    const first = await page2.evaluate(() => document.getElementById('engineline').textContent);
    await page2.waitForFunction(n => { const p = document.getElementById('pad'); return p && p.pad && !p.pad.busy && p.pad.result && p.pad.result.parts && p.pad.strokes.length === n && p.pad.resultStrokes.length === n; }, { timeout: 300000 }, strokes.length);
    const c = await page2.evaluate(() => {
      document.getElementById('gear').click();
      return { stats: Nib._internals.poolTest('stats'), parts: document.getElementById('pad').pad.result.parts.length, line: document.getElementById('engineline').textContent, open: !document.getElementById('settings').hidden };
    });
    ok(c.parts === b.parts && c.stats.dead && c.stats.answered === 0 && c.stats.here > 500 && infos2.filter(t => /^Nib: reading on the page's own thread only/.test(t)).length === 1 && !errors2.length,
      `the Board under worker-src 'none': the page read on its own thread (${c.stats.here} groups, ${c.parts} pieces), one line said${errors2.length ? '; page error: ' + errors2[0] : ''}`);
    ok(/ worker threads?$/.test(first) && !/no worker/.test(first) && c.open && c.line === `Nib ${Nib.version} · the fast reader is on · no worker threads`,
      `Settings before the read: ${JSON.stringify(first)}; opened after it: ${JSON.stringify(c.line)}`);
    await page2.close();
  }
  {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
    await page.goto(file(path.join(__dirname, '..', 'dist', 'Nib.html')), { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 2500));
    const s = await page.evaluate(() => (typeof Nib !== 'undefined' ? { stats: Nib._internals.poolTest('stats'), v: Nib.version } : null));
    ok(s && s.stats.started === 0 && !errors.length, `dist/Nib.html with its sample read: ${s ? s.stats.started : '?'} workers started`);
    await page.close();
    const small = await readOn(file(PAGE), '', 6);
    ok(small.rested && small.stats.started === 0 && small.stats.here > 0, `a pad of 6 expressions (${small.strokes} strokes): ${small.stats.started} workers started, ${small.stats.here} groups classified here`);
  }

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
