// The worker pool's prototype (docs/plans/worker-pool.md): the parts of the design that can be tried against the
// released engine without changing it. Nothing here ships; when the pool is built these become Recognizer.needs and
// Recognizer.fill, the engine's own worker and src/pool.js, and this folder goes.
//   node:  const proto = require('./lib.js')(Nib)          a page: NibPoolProto(Nib)
'use strict';
(function (root, make) {
  if (typeof module !== 'undefined' && module.exports) module.exports = make; else root.NibPoolProto = make;
})(typeof self !== 'undefined' ? self : globalThis, function (Nib) {
  const now = () => (typeof performance !== 'undefined' ? performance : Date).now();

  // needs: the stroke groups Recognizer.warmup's first loop would classify now — every candidate group of the
  // segmentation that is not in the recognizer's cache — without classifying them. From outside the engine: the
  // warm-up is run with an oracle (it then ends after its first loop: recognize.js, "if (opts.oracle) return") and
  // with the recognizer's probs shadowed for the call, so each group it would have classified is noted instead.
  // It is the engine's own enumeration, not a copy of it. What it leaves in the recognizer is what the warm-up has
  // left by then: the strokes' ids, the size reference (classRef) and the join model's cache.
  //   → [{ g: the strokes of the group, ref: the size they are classified at, k: the cache key }]
  function needs(rec, input, options) {
    const jobs = [];
    rec.probs = function (group, ref, key) { jobs.push({ g: group, ref, k: key + '|' + Math.round(Math.log(ref) * 40) }); return null; };
    try { const it = rec.warmup(input, Object.assign({}, options, { oracle: () => [] })); while (!it.next().done); }
    finally { delete rec.probs; }
    return jobs;
  }
  // fill: a classification put where probs would have put it (the same key, the same rule for a full cache), never
  // over one that is there. e: what classifyGroup returns — the probabilities, with .hidden
  function fill(rec, k, e) {
    if (rec.cache.has(k)) return false;
    if (rec.cache.size > rec.max) rec.cache.clear();
    rec.cache.set(k, e);
    return true;
  }
  // an entry as it comes back from a worker: {p: Float64Array, h: Float32Array} → the probabilities with .hidden
  function entry(o) { const z = o.p; z.hidden = o.h; return z; }

  // What runs in a worker after the engine: answers {id, jobs: [{g, ref}]} with each job's classifyGroup, the typed
  // arrays transferred. ({use}: which classifier, for the comparisons; {quit}: stop answering, to try the fallback.)
  function workerMain() {
    const I = self.Nib._internals;
    let quiet = false;
    self.onmessage = function (e) {
      const d = e.data;
      if (d.use) { I.kernelUse(d.use); self.postMessage({ id: d.id, kernel: self.Nib.kernel }); return; }
      if (d.quit) { quiet = true; return; }
      if (quiet) return;
      const t0 = performance.now(), out = [], tr = [];
      for (const j of d.jobs) {
        const z = I.classifyGroup(j.g, j.ref), h = z.hidden.slice();      // (a copy: the engine may keep its buffer)
        out.push({ p: z, h }); tr.push(z.buffer, h.buffer);
      }
      self.postMessage({ id: d.id, out, ms: performance.now() - t0 }, tr);
    };
    self.postMessage({ ready: true, version: self.Nib.version, kernel: self.Nib.kernel, hasDocument: typeof document !== 'undefined',
      hasElement: typeof customElements !== 'undefined', cores: self.navigator && self.navigator.hardwareConcurrency });
  }
  // the text a worker is started from: the engine's own source (its wrapper function, as text), then the above
  function workerSource(engineSource) {
    return 'self.__nibWorker = 1;\n(' + engineSource + ')(self);\n(' + workerMain.toString() + ')();\n';
  }

  // A pool of n workers started from that text through a Blob URL. start() → each worker's first message and how long
  // it took; run(jobs) → a Promise of {out, stats}: the jobs cut into chunks that idle workers take from one queue.
  // A page only (Worker, Blob, URL).
  function makePool(n, source, opts) {
    const chunkSize = (opts && opts.chunk) || 8;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const workers = [], queue = [], waiting = new Map();
    let seq = 0;
    const stats = { postMs: 0, backMs: 0, workerMs: 0, chunks: 0, jobs: 0 };
    const pump = () => {
      for (const w of workers) {
        if (!w.ready || w.busy || !queue.length) continue;
        const c = queue.shift(); w.busy = c;
        const t = now(); w.w.postMessage({ id: c.id, jobs: c.jobs }); stats.postMs += now() - t;
      }
    };
    const start = () => Promise.all(Array.from({ length: n }, (_, i) => new Promise((resolve, reject) => {
      const t0 = now();
      let w;
      try { w = new Worker(url); } catch (err) { reject(new Error('new Worker threw: ' + err.message)); return; }
      const me = { w, ready: false, busy: null, i };
      workers.push(me);
      const timer = setTimeout(() => reject(new Error('worker ' + i + ' did not say it was ready in 20 s')), 20000);
      w.onerror = e => { clearTimeout(timer); reject(new Error('worker error event: ' + (e.message || '(no message)'))); };
      w.onmessage = e => {
        const d = e.data, t = now();
        if (d.ready) { clearTimeout(timer); me.ready = true; resolve(Object.assign({ startMs: t - t0 }, d)); pump(); return; }
        if (d.kernel !== undefined && !d.out) { const f = waiting.get(d.id); waiting.delete(d.id); if (f) f(d.kernel); return; }
        const c = me.busy; me.busy = null;
        stats.workerMs += d.ms; stats.chunks++; stats.jobs += d.out.length;
        c.done(d.out);
        stats.backMs += now() - t;
        pump();
      };
    })));
    const run = (jobs, each) => new Promise(resolve => {
      const out = new Array(jobs.length);
      let left = jobs.length;
      if (!left) { resolve(out); return; }
      for (let a = 0; a < jobs.length; a += chunkSize) {
        const at = a, part = jobs.slice(a, a + chunkSize);
        queue.push({ id: ++seq, jobs: part.map(j => ({ g: j.g, ref: j.ref })), done: res => {
          for (let i = 0; i < res.length; i++) { out[at + i] = entry(res[i]); if (each) each(jobs[at + i], out[at + i]); }
          left -= res.length; if (!left) resolve(out);
        } });
      }
      pump();
    });
    // every worker told which classifier to use ('js' | 'simd' | 'auto') → what each then runs
    const use = mode => Promise.all(workers.map(w => new Promise(resolve => { const id = ++seq; waiting.set(id, resolve); w.w.postMessage({ id, use: mode }); })));
    const stop = () => { for (const w of workers) w.w.terminate(); URL.revokeObjectURL(url); };
    return { start, run, use, stop, stats, workers };
  }

  // bytes of a classification, to compare two of them bit for bit
  function same(a, b) {
    if (!a || !b || a.length !== b.length || !a.hidden || !b.hidden || a.hidden.length !== b.hidden.length) return false;
    if (a.constructor !== b.constructor || a.hidden.constructor !== b.hidden.constructor) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    for (let i = 0; i < a.hidden.length; i++) if (!Object.is(a.hidden[i], b.hidden[i])) return false;
    return true;
  }
  return { needs, fill, entry, workerSource, makePool, same };
});
