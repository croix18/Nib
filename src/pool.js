// ================================================================== the worker pool (1.8.0)
// A big read's classifications in worker threads, on every core but one. The pool classifies ahead of a read:
// Recognizer.needs lists what a warm-up's first loop would classify (and changes nothing a read can see),
// Recognizer.fill keeps each answer beside the cache, and the read then runs as it always has and takes an answer
// where it would otherwise call the classifier — only for the same strokes at the same size. A classification
// depends on the strokes of the group and the size they are classified at and on nothing else, and a worker is this
// same engine, so it gives the same bits. See docs/HANDOFF.md, The worker pool (1.8.0).
// The engine is its own worker: build.py names its wrapper function (NibEngine), so the engine can read its own source
// and start a worker from it through a Blob URL — one file still, which works from file:// and offline. Every way the
// pool can fail ends in one place: the caller is told "not done" and classifies on the page's thread, as before.
// Nothing here runs when the engine starts: the pool is made the first time a read asks it for something.
const POOL_CHUNK = 8;               // groups to a message: posting costs little, and idle workers take the next chunk
const POOL_READY_MS = 4000;         // a worker that has not said it is ready by then is not going to be
const POOL_CHUNK_MS = 5000;         // nor one that has not answered a chunk — 8 groups, some 10 ms on the kernel and a
                                    // tenth of a second on the JavaScript path — by then: the board waits no longer
                                    // than this for a worker that has gone quiet (a device asleep through it, and
                                    // the pool declared dead by mistake, costs only speed)
const POOL_NULLS = 8;               // so many groups in a row that workers' classifiers threw on: not odd groups, a fault
const POOL_IDLE_MS = 30000;         // a worker with nothing to do for that long is let go, and started again when needed
// What is worth asking the pool for: a list that would take this thread that long to classify itself (poolWorth).
// Under it a worker's start (60 to 95 ms on a two-core laptop, more on slow hardware) and the round trip cost more
// than they give. A classification is taken to cost POOL_COST_MS until this thread has made one.
const POOL_WORK_MS = 150, POOL_COST_MS = 1.2;
const POOL = {
  use: 'auto',                      // poolUse: 'auto', or how many workers (0: none)
  dead: false,                      // once a failure has been seen, for the page's life: never tried again
  url: null, workers: [], queue: [], seq: 0, nulls: 0,
  limits: { ready: POOL_READY_MS, chunk: POOL_CHUNK_MS, idle: POOL_IDLE_MS, work: POOL_WORK_MS },
  cost: 0,                          // what a classification costs on this thread, in ms (a running mean; 0: none seen yet)
  // counted, for the tests: workers started, chunks and groups sent, groups answered with a classification, groups a
  // worker's classifier threw on (answered with null), groups taken out of the queue, groups classified on this
  // thread (Recognizer.probs), what each worker said its classifier was
  stats: { started: 0, chunks: 0, sent: 0, answered: 0, failed: 0, dropped: 0, here: 0, kernels: [], why: '' },
};

// Can this page run workers made from the engine's own source at all? (Not in node, not in a worker of the pool
// itself, not where the engine's wrapper has no name: a copy of the engine put together some other way.)
function poolCan() {
  return typeof Worker === 'function' && typeof Blob === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' &&
    typeof NibEngine === 'function' && !(typeof self !== 'undefined' && self.__nibWorker === 1);
}
// How many workers the pool may use: every core but one, at most 4 — none on a single core, where a worker would
// only take the page's thread's turns; and no more than the gigabytes of memory the browser says the device has (a
// worker costs about 34 MB: its own copy of the engine and the model, the kernel's memory and a heap), so a device
// that says under 1 GB gets none. A browser that does not say how many cores there are is taken to have two.
function poolSize() {
  if (POOL.dead || !poolCan()) return 0;
  if (POOL.use !== 'auto') return POOL.use;
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const cores = nav && nav.hardwareConcurrency > 0 ? Math.floor(nav.hardwareConcurrency) : 2;
  let n = Math.max(0, Math.min(4, cores - 1));
  const mem = nav && nav.deviceMemory;
  if (typeof mem === 'number' && isFinite(mem)) n = Math.min(n, Math.max(0, Math.floor(mem)));
  return n;
}
// how many workers are running now (Nib.workers)
function poolWorkers() { return POOL.workers.length; }
// For the tests: 0 turns the pool off, a number sets how many workers, 'auto' puts it back. The workers there are
// let go (a chunk one held is put back at the head of the queue); a pool that has died stays dead.
function poolUse(n) {
  if (!(n === 'auto' || (typeof n === 'number' && n >= 0 && n <= 16 && Math.floor(n) === n))) throw new Error("Nib: poolUse takes 0, a number of workers up to 16, or 'auto'");
  POOL.use = n;
  for (const me of POOL.workers) poolLetGo(me, true);
  POOL.workers = [];
  if (!poolSize()) poolEnd(POOL.queue.splice(0), false);
  else poolPump();
  return poolSize();
}
// What a classification costs here: the running mean of the ones this thread has made (Recognizer.probs tells the
// pool each one), by which a pad judges whether a read is worth asking the pool for (poolWorth)
function poolNote(ms) {
  POOL.stats.here++;
  if (ms >= 0 && ms < 1000) POOL.cost = POOL.cost ? 0.9 * POOL.cost + 0.1 * ms : ms;
}
// Is a list of n groups worth asking the pool for? Only how the reading is come by depends on this, and on the
// machine through it: what is read does not.
function poolWorth(n) { return n > 0 && n * (POOL.cost || POOL_COST_MS) >= POOL.limits.work; }

// Ask for jobs ([{group, ref, …}]: the strokes of each group and the size to classify them at; other fields are the
// caller's) to be classified. each(job, entry) is called for every answer as it comes (entry: what classifyGroup
// returns, the probabilities with .hidden; a group a worker's classifier threw on has no answer, and no call).
// Returns {done, drop}: done is a Promise of true once every job has been answered or dropped, or of false — "not
// done" — when the pool cannot run or has died, and then what has not been answered never will be; drop(test) takes
// out of the queue the jobs for which test(job) is true that no worker holds yet (a chunk a worker holds is
// finished).
function poolRun(jobs, each) {
  const req = { left: 0, each, over: false, resolve: null };
  req.done = new Promise(resolve => { req.resolve = resolve; });
  const handle = { done: req.done, drop: test => poolDrop(req, test) };
  if (!jobs.length) { poolOver(req, true); return handle; }
  if (!poolSize()) { poolOver(req, false); return handle; }
  for (let a = 0; a < jobs.length; a += POOL_CHUNK) { POOL.queue.push({ id: ++POOL.seq, req, jobs: jobs.slice(a, a + POOL_CHUNK) }); req.left++; }
  poolPump();
  return handle;
}
function poolOver(req, answered) {
  if (req.over) return;
  req.over = true;
  req.resolve(answered);
}
function poolDrop(req, test) {
  if (req.over) return;
  for (let i = POOL.queue.length - 1; i >= 0; i--) {
    const c = POOL.queue[i];
    if (c.req !== req) continue;
    const keep = c.jobs.filter(j => !test(j));
    POOL.stats.dropped += c.jobs.length - keep.length;
    if (keep.length) c.jobs = keep;
    else { POOL.queue.splice(i, 1); req.left--; }
  }
  if (!req.left) poolOver(req, true);
}
// chunks that will not be answered: their requests are "not done"
function poolEnd(chunks, answered) { for (const c of chunks) poolOver(c.req, answered); }

// The pool is dead for the page's life: every worker let go, every request "not done", said once. Never retried — a
// pool declared dead by mistake (a device that slept through a limit) costs only speed until the page is opened again.
function poolDie(why) {
  if (POOL.dead) return;
  POOL.dead = true; POOL.stats.why = why;
  const held = [];
  for (const me of POOL.workers) { if (me.held) held.push(me.held); poolLetGo(me, false); }
  POOL.workers = [];
  poolEnd(held.concat(POOL.queue.splice(0)), false);
  if (POOL.url) { try { URL.revokeObjectURL(POOL.url); } catch (e) { /* gone with the page */ } POOL.url = null; }
  try { console.info('Nib: reading on the page\'s own thread only (' + why + ')'); } catch (e) { /* no console */ }
}
// a worker terminated and its timers cleared; requeue: the chunk it held goes back to the head of the queue
function poolLetGo(me, requeue) {
  clearTimeout(me.timer); clearTimeout(me.idle); me.gone = true;
  if (requeue && me.held) POOL.queue.unshift(me.held);
  me.held = null;
  try { me.w.terminate(); } catch (e) { /* already gone */ }
}

function poolStart() {
  try {
    if (!POOL.url) POOL.url = URL.createObjectURL(new Blob(['self.__nibWorker = 1;\n(' + NibEngine.toString() + ')(self);\n'], { type: 'text/javascript' }));
  } catch (e) { poolDie('its source cannot be made into a worker: ' + (e && e.message || e)); return; }
  let w;
  try { w = new Worker(POOL.url); } catch (e) { poolDie('a worker cannot be started here: ' + (e && e.message || e)); return; }
  const me = { w, ready: false, held: null, gone: false, idle: null, timer: null };
  POOL.workers.push(me); POOL.stats.started++;
  // a worker this page's rule forbids does not throw in Chrome: it fires error a moment later
  me.timer = setTimeout(() => poolDie('a worker did not start within ' + POOL.limits.ready / 1000 + ' s'), POOL.limits.ready);
  w.onerror = e => { if (e && e.preventDefault) e.preventDefault(); if (!me.gone) poolDie('a worker failed' + (e && e.message ? ': ' + e.message : '')); };
  w.onmessageerror = () => { if (!me.gone) poolDie('an answer could not be read'); };
  w.onmessage = e => { if (!me.gone) poolHeard(me, e.data); };
}
// what a worker said: that it is ready, or the answer to the chunk it holds — anything else, and the pool is dead
function poolHeard(me, d) {
  if (!me.ready) {
    if (!(d && d.ready === 1 && d.version === Nib.version)) { poolDie('a worker said something else than that it is ready'); return; }
    clearTimeout(me.timer); me.ready = true; POOL.stats.kernels = POOL.stats.kernels.slice(-15).concat(d.kernel);
    poolPump();
    return;
  }
  const c = me.held, M = model(), H = M.L.f1.co;
  let fine = !!(c && d && d.id === c.id && Array.isArray(d.out) && d.out.length === c.jobs.length);
  // (null: the worker's classifier threw on that group — that group's fault, not the pool's: nothing is kept for
  // it, and the read meets the same failure on this thread, where it is said)
  for (let i = 0; fine && i < d.out.length; i++) {
    const o = d.out[i];
    fine = o === null || !!(o && o.p instanceof Float64Array && o.p.length === M.C && o.h instanceof Float32Array && o.h.length === H);
  }
  if (!fine) { poolDie('an answer of the wrong shape'); return; }
  clearTimeout(me.timer); me.held = null;
  for (let i = 0; i < d.out.length; i++) {
    const o = d.out[i];
    if (!o) { POOL.stats.failed++; POOL.nulls++; continue; }
    POOL.stats.answered++; POOL.nulls = 0;
    if (c.req.over) continue;
    const e = o.p; e.hidden = o.h;
    // (what the caller does with an answer is its own: a fault there leaves that group to be classified here)
    try { c.req.each(c.jobs[i], e); } catch (err) { /* classified on this thread by the read instead */ }
  }
  if (!c.req.over && !--c.req.left) poolOver(c.req, true);
  // (workers that can classify nothing are no use: every read would pay for the asking and then classify here anyway)
  if (POOL.nulls >= POOL_NULLS) { poolDie('the workers\' classifier fails'); return; }
  poolPump();
}
// give chunks to the workers that are ready and idle, starting workers up to the size while there is work; a worker
// with nothing left to do waits POOL_IDLE_MS and goes
function poolPump() {
  if (POOL.dead) return;
  const want = poolSize();
  while (POOL.queue.length && POOL.workers.length < want) { poolStart(); if (POOL.dead) return; }
  for (const me of POOL.workers) {
    if (!me.ready || me.held) continue;
    if (!POOL.queue.length) { if (!me.idle) me.idle = setTimeout(() => poolIdle(me), POOL.limits.idle); continue; }
    clearTimeout(me.idle); me.idle = null;
    const c = me.held = POOL.queue.shift();
    try { me.w.postMessage({ id: c.id, jobs: c.jobs.map(j => ({ g: j.group, ref: j.ref })) }); }
    catch (e) { poolDie('a group could not be sent: ' + (e && e.message || e)); return; }
    POOL.stats.chunks++; POOL.stats.sent += c.jobs.length;
    me.timer = setTimeout(() => poolDie('a worker did not answer within ' + POOL.limits.chunk / 1000 + ' s'), POOL.limits.chunk);
  }
}
function poolIdle(me) {
  me.idle = null;
  if (me.gone || me.held) return;
  poolLetGo(me, false);
  POOL.workers = POOL.workers.filter(x => x !== me);
}

// For the tests (Nib._internals.poolTest): 'stats' (a copy of the counts), 'reset' (the counts from zero),
// 'limits' ({ready, chunk, idle, work} in ms: shorter limits, to try them; work: 0 has every planned read ask the
// pool, whatever a classification costs on the machine the test runs on), 'crash' (worker i throws when it is next
// given a chunk: a worker that fails in the middle of a read), 'mute' (worker i never answers again), 'garble'
// (worker i answers its next chunk with the wrong number of groups), 'ready' (how many workers have said they are
// ready)
function poolTest(what, arg) {
  if (what === 'stats') return JSON.parse(JSON.stringify(Object.assign({ workers: POOL.workers.length, dead: POOL.dead, size: poolSize(), queued: POOL.queue.length, cost: POOL.cost }, POOL.stats)));
  if (what === 'reset') { Object.assign(POOL.stats, { started: 0, chunks: 0, sent: 0, answered: 0, failed: 0, dropped: 0, here: 0, kernels: [] }); return true; }
  if (what === 'limits') { Object.assign(POOL.limits, arg || {}); return Object.assign({}, POOL.limits); }
  if (what === 'ready') return POOL.workers.filter(me => me.ready).length;
  if (what === 'crash' || what === 'mute' || what === 'garble') {
    const me = POOL.workers[arg || 0];
    if (!me) return false;
    me.w.postMessage({ test: what });
    return true;
  }
  throw new Error('Nib: poolTest takes stats, reset, limits, ready, crash, mute or garble');
}

// The engine started as a worker of the pool: it answers {id, jobs: [{g, ref}]} with {id, out: [{p, h}]}, each job's
// classifyGroup(g, ref) — the probabilities and the hidden vector, their buffers handed over, not copied — or null
// for a group the classifier throws on (the page's thread then meets that failure itself, in the read, where it is
// said: one odd group is not the pool's end). It defines no element and reads no storage (nothing at the engine's
// start does), and does nothing else.
function poolWorkerMain() {
  let mute = false, crash = false, garble = false;
  // (a typed array shares its buffer with nothing here today; were it ever a view, it goes as a copy)
  const own = a => (a.byteOffset || a.byteLength !== a.buffer.byteLength ? a.slice() : a);
  self.onmessage = e => {
    const d = e.data;
    if (d && d.test) { if (d.test === 'mute') mute = true; else if (d.test === 'crash') crash = true; else if (d.test === 'garble') garble = true; return; }
    if (mute) return;
    if (crash) throw new Error('Nib: a worker of the pool stopped (asked to, by a test)');
    if (garble) { self.postMessage({ id: d.id, out: [] }); return; }
    const out = [], tr = [];
    for (const j of d.jobs) {
      let p, h;
      try { const z = classifyGroup(j.g, j.ref); p = own(z); h = own(z.hidden); } catch (err) { out.push(null); continue; }
      out.push({ p, h }); tr.push(p.buffer, h.buffer);
    }
    self.postMessage({ id: d.id, out }, tr);
  };
  self.postMessage({ ready: 1, version: Nib.version, kernel: Nib.kernel });
}
