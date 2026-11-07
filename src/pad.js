// ================================================================== writing pad
const PAD_DEFAULTS = {
  ink: null,            // stroke colour; default: the element's CSS --nib-ink, else its text colour
  width: 3,             // stroke width in CSS px
  auto: true,           // recognise automatically after the pen rests
  delay: 450,           // ms of rest before recognising
  settle: 0,            // ms of rest before read ink changes into its tidy / handwritten / typeset form (the answers do not wait)
  penOnly: false,       // ignore touch and mouse (stylus-only boards)
  boxes: false,         // draw recognised symbol boxes over the ink
  smooth: 0,            // smooth shaky ink along its path before reading (sigma as a share of the writing size)
  view: 'ink',          // how read ink is shown: 'ink' as written, 'tidy', 'hand' (the writer's Replicator handwriting), 'typeset'
  motion: true,         // animate ink into its tidy / handwritten / typeset form (off when the reader asks for less motion)
  hand: null,           // handwriting for view 'hand' (the Replicator's saved data); default: whatever Nib.hand holds
  separate: false,      // a board: writing in different places is read as separate expressions
  solve: false,         // work out lines that end with "=" and write the answer after the "=" (in --nib-answer)
  reveal: false,        // with solve: each answer waits behind a gold "?" chip until the chip is tapped
  fit: false,           // when the pad is resized and the ink no longer fits, shrink and move it in (undoable)
  times: true,          // × can be a times sign; false: every cross is the letter x (multiply with · or brackets)
  train: false,         // keep each piece of writing read (strokes, reading, corrections) in pad.training, for fine-tuning
  symbols: 'school', lines: true, degrees: true,
  onResult: null,       // (result, pad) => void
  onChange: null,       // (pad) => void, after every stroke / undo / clear
};

// Writing in different places on a board: strokes near each other belong together — neighbours on a line (within
// 1.5 writing heights across, 0.6 up or down) or stacked (fractions, steps of working: within 1.6 heights down and
// overlapping across). Returns groups of stroke indices in reading order.
function clustersOf(strokes) {
  const n = strokes.length;
  if (!n) return [];
  const boxes = strokes.map(sbox), ref = refSize(strokes);
  const up = Array.from({ length: n }, (_, i) => i);
  const find = i => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = boxes[i], b = boxes[j];
    const gx = Math.max(0, b[0] - a[2], a[0] - b[2]), gy = Math.max(0, b[1] - a[3], a[1] - b[3]);
    if ((gx <= 1.5 * ref && gy <= 0.6 * ref) || (gx <= 0.3 * ref && gy <= 1.6 * ref)) { const ri = find(i), rj = find(j); if (ri !== rj) up[Math.max(ri, rj)] = Math.min(ri, rj); }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  const list = [...groups.values()].map(g => { let b = boxes[g[0]]; for (const i of g) b = ubox(b, boxes[i]); return { g, b }; });
  // reading order: rows of groups that share some height, left to right within a row
  list.sort((p, q) => p.b[1] - q.b[1]);
  const rows = [];
  for (const it of list) {
    const row = rows.find(r => it.b[1] < r.y1 && it.b[3] > r.y0);
    if (row) { row.items.push(it); row.y0 = Math.min(row.y0, it.b[1]); row.y1 = Math.max(row.y1, it.b[3]); }
    else rows.push({ y0: it.b[1], y1: it.b[3], items: [it] });
  }
  return [].concat(...rows.map(r => r.items.sort((p, q) => p.b[0] - q.b[0]).map(it => it.g)));
}
// one reading made of several (each part's stroke indices mapped back to the whole board's)
function joinParts(parts) {
  const remap = (row, m) => row.map(u => {
    const o = Object.assign({}, u, { strokes: (u.strokes || []).map(m) });
    for (const k of ['num', 'den', 'body', 'idx', 'sup', 'sub']) if (u[k]) o[k] = remap(u[k], m);
    return o;
  });
  const lines = [], symbols = [], tree = [];
  let conf = 1, ms = 0;
  for (const p of parts) {
    const r = p.result, m = i => p.idx[i];
    if (!r || !r.lines.length) continue;
    lines.push(...r.lines); tree.push(...r.tree.map(row => remap(row, m)));
    symbols.push(...r.symbols.map(sy => Object.assign({}, sy, { strokes: sy.strokes.map(m) })));
    conf = Math.min(conf, r.confidence); ms += r.ms || 0;
  }
  return {
    latex: lines.length > 1 ? '\\begin{gathered}' + lines.map(l => l.latex).join(' \\\\ ') + '\\end{gathered}' : lines.length ? lines[0].latex : '',
    text: lines.map(l => l.text).join('\n'), lines, symbols, tree, confidence: lines.length ? conf : 0, skew: 0, ms, parts,
  };
}

class Pad {
  constructor(el, options) {
    this.el = el;
    this.o = Object.assign({}, PAD_DEFAULTS, options || {});
    this.strokes = [];
    this.history = []; this.future = [];
    this.fixes = [];
    this.result = null; this.resultStrokes = [];
    this.rec = new Recognizer();
    this.mode = 'draw';
    const c = this.canvas = document.createElement('canvas');
    c.setAttribute('part', 'canvas');
    c.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;user-select:none;-webkit-user-select:none;';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(c);
    this.ctx = c.getContext('2d');
    this.ptrs = new Map();          // pointerId -> the stroke (or erase) that pointer is making right now
    this.penUntil = 0;              // touch is ignored until then (a pen is down, or was a moment ago)
    this.why = '';                  // what the last pointerdown did (for a diagnostic overlay)
    this.revealed = new Set();      // answers shown by a tap on their chip (keys: the line's strokes and the answer)
    this.timer = null; this.gen = 0; this._raf = 0;
    this.plan = null; this.anim = null; this.sid = new WeakMap(); this.nsid = 1;
    this.parts = new Map(); this.recs = new WeakMap(); this.optsVersion = 0;
    this._handChanged = () => { if (this.o.view === 'hand' || this.o.solve) this._replan(true); };
    this.answers = [];
    this.info = new WeakMap();      // stroke -> {type, width}: the pointer that wrote it
    this.training = []; this._trainIdx = new Map(); this._trainBytes = new Map(); this._trainSkip = new Set();
    this._seen = new Map(); this._trainTimer = null; this._hashes = new WeakMap(); this._answered = new WeakMap();
    this.trainMeta = null;          // a plain object whose fields go into every training record made while it is set (a drill's prompt)
    if (typeof window !== 'undefined') window.addEventListener('nib:hand', this._handChanged);
    this._down = this._down.bind(this); this._move = this._move.bind(this); this._up = this._up.bind(this);
    c.addEventListener('pointerdown', this._down);
    c.addEventListener('pointermove', this._move);
    c.addEventListener('pointerup', this._up);
    c.addEventListener('pointercancel', this._up);
    c.addEventListener('lostpointercapture', this._up);     // capture lost without a pointerup: finish the stroke
    c.addEventListener('contextmenu', e => e.preventDefault());
    this._theme = () => this.redraw();
    try { this.mq = matchMedia('(prefers-color-scheme: dark)'); this.mq.addEventListener('change', this._theme); } catch (e) { this.mq = null; }
    this.mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(this._theme) : null;
    if (this.mo) this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this._resize()) : null;
    if (this.ro) this.ro.observe(c); else window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  setOptions(o) {
    const before = this.o.view, hb = this.o.hand, sb = !!this.o.solve, rb = !!this.o.reveal, rk = this._readKey(), tb = !!this.o.train;
    Object.assign(this.o, o || {});
    if (!!this.o.train !== tb) { if (this.o.train) this._trainSee(); else { clearTimeout(this._trainTimer); this._trainTimer = null; this._seen.clear(); } }
    if (!['ink', 'tidy', 'hand', 'typeset'].includes(this.o.view)) this.o.view = 'ink';
    // only options that change the reading read the ink again; a view, colour or pen width just redraws
    const reread = this._readKey() !== rk;
    if (reread) { this.optsVersion++; this.parts.clear(); }
    if (this.o.view !== before || this.o.hand !== hb || !!this.o.solve !== sb || !!this.o.reveal !== rb) this._replan(true); else this.redraw();
    if (this.strokes.length && this.o.auto && (reread || (this.resultStrokes || []).length !== this.strokes.length)) this._schedule(0);
  }
  _readKey() {
    const skip = new Set(['view', 'motion', 'hand', 'ink', 'width', 'boxes', 'penOnly', 'delay', 'settle', 'auto', 'solve', 'reveal', 'fit', 'train', 'onResult', 'onChange']);
    return JSON.stringify(Object.keys(this.o).filter(k => !skip.has(k) && typeof this.o[k] !== 'function').sort().map(k => [k, this.o[k]]));
  }

  // ---------------------------------------------------------------- input
  _pt(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, Math.round(e.timeStamp)]; }
  // Several pointers at once (two students at the board): each makes its own stroke, in the mode it started in.
  // A pen wins over touch: touch is ignored while a pen is down and for a second after its last event, a wide
  // contact (a palm) never draws, and a touch stroke only just begun is dropped when a pen comes down.
  get active() { return this.ptrs.size ? this.ptrs.keys().next().value : null; }
  get cur() { for (const P of this.ptrs.values()) if (P.cur) return P.cur; return null; }
  _contact(e) { const w = Math.max(+e.width || 0, +e.height || 0); return w > 1 && isFinite(w) ? w : 0; }   // 0: not known
  // what wrote a finished stroke (a stroke, or its index): {type: 'pen' | 'touch' | 'mouse' | null, width: contact px or null}
  strokeInfo(s) {
    if (typeof s === 'number') s = this.strokes[s];
    const i = s && this.info.get(s);
    return { type: i ? i.type : null, width: i ? i.width : null };
  }
  _wide(e) { return (+e.width || 0) >= 28 || (+e.height || 0) >= 28; }   // 0 or 1: the browser does not say
  _young(P, now) { return now - P.t0 < 350 || (P.cur ? P.cur.length : 0) < 6; }
  _down(e) {
    const now = performance.now(), type = e.pointerType, touch = type === 'touch';
    // a pointer that has gone quiet for 1.5 s lost its pointerup somewhere: finish it and take the new one
    for (const P of [...this.ptrs.values()]) if (now - P.last > 1500 || P.id === e.pointerId) this._finish(P, null);
    if (type === 'pen') {
      this.penUntil = now + 1000;
      for (const P of [...this.ptrs.values()]) if (P.type === 'touch' && this._young(P, now)) this._drop(P);  // the palm landed first
    }
    if (touch) {
      if (this.o.penOnly) { this.why = 'ignored: pen only'; return; }
      if (now < this.penUntil || [...this.ptrs.values()].some(P => P.type === 'pen')) { this.why = 'ignored: pen in use'; return; }
      if (this._wide(e) && this.mode !== 'erase') { this.why = 'ignored: palm'; return; }   // with Erase on, a hand rubs out
    }
    if (type === 'mouse' && e.button !== 0) { this.why = 'ignored: button'; return; }
    e.preventDefault();
    const eraser = type === 'pen' && ((e.buttons & 32) !== 0 || e.button === 5);    // the pen turned round
    const P = { id: e.pointerId, type, mode: eraser || this.mode === 'erase' ? 'erase' : 'draw', eraser, t0: now, last: now, cur: null, erased: [], hid: [], at: null, r: 0, base: 0, chip: null, w: this._contact(e) };
    this.ptrs.set(e.pointerId, P);
    this.why = P.mode + (eraser ? ' (eraser end)' : '');
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
    clearTimeout(this.timer); this.gen++;
    const p = this._pt(e);
    if (P.mode === 'erase') { P.base = this._eraseBase(p); this._eraseAt(P, p, e); return; }
    P.chip = this._chipAt(p);
    P.cur = [p];
    if (this.plan && (P.chip || this.plan.items.some(it => it.answer))) { this.redraw(); return; }   // writing over an answer hides it
    this._ink();
    this.ctx.beginPath(); this.ctx.arc(p[0], p[1], this.o.width / 2, 0, Math.PI * 2); this.ctx.fill();
  }
  _move(e) {
    const now = performance.now();
    if (e.pointerType === 'pen') this.penUntil = now + 1000;
    const P = this.ptrs.get(e.pointerId);
    if (!P) return;
    e.preventDefault();
    P.last = now;
    P.w = Math.max(P.w, this._contact(e));
    if (P.type === 'touch' && P.mode === 'draw' && this._wide(e) && this._young(P, now)) { this._drop(P); return; }  // a palm settling
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = this._pt(ev);
      if (P.mode === 'erase') { this._eraseAt(P, p, ev); continue; }
      const q = P.cur[P.cur.length - 1];
      if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) < 0.75) continue;
      P.cur.push(p);
      this._seg(P.cur);
    }
  }
  _up(e) {
    if (e.pointerType === 'pen') this.penUntil = performance.now() + 1000;
    const P = this.ptrs.get(e.pointerId);
    if (P) this._finish(P, e);
  }
  // a pointer's stroke is done (e: its pointerup / pointercancel, or null when its up was lost)
  _finish(P, e) {
    this.ptrs.delete(P.id);
    try { if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(P.id)) this.canvas.releasePointerCapture(P.id); } catch (_) { /* ok */ }
    if (P.mode === 'erase') {
      P.at = null;
      if (P.erased.length || P.hid.length) { this._push(Object.assign({ erase: P.erased }, P.hid.length ? { hide: P.hid } : {})); this._changed(); }
      else this.redraw();                                  // the eraser's ring goes
      return;
    }
    const s = P.cur;
    if (e && e.type === 'pointercancel' && s && s.length < 3) { this.redraw(); return; }   // a cancelled tap
    // a tap on an answer's chip (up within 10 px and 400 ms of the down, inside the chip) shows that answer
    if (P.chip && e && e.type === 'pointerup' && s && s.length) {
      const q = this._pt(e);
      if (Math.hypot(q[0] - s[0][0], q[1] - s[0][1]) <= 10 && performance.now() - P.t0 <= 400 && this._inChip(P.chip, q)) { this._reveal(P.chip.key); return; }
    }
    if (!s || !s.length) return;
    // a finger's tap while a pen is in use (within the last 30 s) is the heel of the hand, not a decimal point
    if (P.type === 'touch' && this.penUntil && performance.now() - (this.penUntil - 1000) < 30000) {
      const b = sbox(s.map(q => [q[0], q[1]]));
      if (Math.max(b[2] - b[0], b[3] - b[1]) < 6) { this.why = 'ignored: tap beside the pen'; this.redraw(); return; }
    }
    this.info.set(s, { type: ['pen', 'touch', 'mouse'].includes(P.type) ? P.type : null, width: P.w > 1 ? Math.round(P.w * 10) / 10 : null });
    this.strokes.push(s);
    this._push({ add: s });
    this._changed();
  }
  // a stroke that should never have been (a palm under a pen): gone, and whatever it erased is back
  _drop(P) {
    this.ptrs.delete(P.id);
    try { if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(P.id)) this.canvas.releasePointerCapture(P.id); } catch (_) { /* ok */ }
    for (const x of P.erased.slice().reverse()) this.strokes.splice(x.i, 0, x.s);
    for (const k of P.hid) this.revealed.add(k);
    if (P.hid.length) this._syncHidden();
    this.redraw();
  }
  _push(h) { this.history.push(h); if (this.history.length > 500) this.history.splice(0, this.history.length - 500); this.future = []; }
  // the eraser's size: at least 14 px, a fifth of the writing near it (or of all of it), half a finger's contact
  _eraseBase(p) {
    const m = 150, near = this.strokes.filter(s => { const b = sbox(s); return p[0] > b[0] - m && p[0] < b[2] + m && p[1] > b[1] - m && p[1] < b[3] + m; });
    const pool = near.length ? near : this.strokes;
    return Math.max(14, pool.length ? 0.2 * refSize(pool) : 0);
  }
  _eraseAt(P, p, e) {
    const w = e ? Math.max(+e.width || 0, +e.height || 0) : 0;
    const r = P.r = Math.max(P.base || 14, w > 1 ? w / 2 : 0);
    P.at = p;
    let hit = false;
    // in a tidy, handwritten or typeset view the eraser takes away what it touches as shown
    if (this.plan) {
      const live = new Set(this.strokes);
      let fresh = null;
      for (const it of this.plan.items) {
        if (it.answer) {
          // an answer shown by a tap goes back behind its chip
          if (!it.hidden && it.revealKey && this.revealed.has(it.revealKey) && itemNear(it, p, r)) {
            if (!fresh) fresh = this._fresh();
            if (!this._answerShown(it, live, fresh)) continue;
            this.revealed.delete(it.revealKey); P.hid.push(it.revealKey); this._syncHidden(); hit = true;
          }
          continue;
        }
        if (!it.from.every(s => live.has(s)) || !itemNear(it, p, r)) continue;
        for (const s of it.from) { const i = this.strokes.indexOf(s); if (i >= 0) { P.erased.push({ i, s }); this.strokes.splice(i, 1); live.delete(s); hit = true; } }
      }
    }
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (strokeNear(this.strokes[i], p, r)) { P.erased.push({ i, s: this.strokes[i] }); this.strokes.splice(i, 1); hit = true; }
    }
    if (hit) this.redraw(); else this._frame();            // the ring follows the eraser
  }
  _frame() {
    if (this._raf || typeof requestAnimationFrame === 'undefined') return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.redraw(); });
  }
  // ---------------------------------------------------------------- answers behind chips
  _chipAt(p) {
    const ch = this.plan && this.plan.chips;
    if (!ch || !ch.length) return null;
    const live = new Set(this.strokes), fresh = this._fresh();
    let best = null, bd = Infinity;
    for (const c of ch) {
      if (!this._answerShown(c.item, live, fresh)) continue;
      const d = Math.hypot(p[0] - c.cx, p[1] - c.cy);
      if (this._inChip(c, p) && d < bd) { best = c; bd = d; }
    }
    return best;
  }
  // inside the chip, or within a fingertip of it (a target of at least 44 px)
  _inChip(c, p) { return Math.hypot(p[0] - c.cx, p[1] - c.cy) <= Math.max(c.r, 22); }
  _reveal(key) {
    this.revealed.add(key);
    const items = this.plan ? this.plan.items.filter(it => it.answer && it.revealKey === key) : [];
    const chip = this.plan && this.plan.chips ? this.plan.chips.find(c => c.key === key) : null;
    this._syncHidden();
    this._push({ reveal: [key] });
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (items.length && this.o.motion && !reduce) {
      const box = chip ? [chip.cx - chip.r, chip.cy - chip.r, chip.cx + chip.r, chip.cy + chip.r] : null;
      this._animate(new Map(items.map(it => [it, { parts: [], box: box || it.box }])), []);
    }
    this._changed();
  }
  // which answers wait behind a chip (solve and reveal on, not tapped yet), and their chips
  _syncHidden() {
    if (!this.plan) return;
    const on = !!(this.o.solve && this.o.reveal);
    for (const it of this.plan.items) if (it.answer) it.hidden = on && !this.revealed.has(it.revealKey);
    this.plan.chips = this._chips(this.plan.items);
  }
  // one chip per hidden answer: a gold dot the height of the writing's x-height, where the answer would start
  _chips(items) {
    const out = [], seen = new Set();
    for (const it of items) {
      if (!it.answer || !it.hidden || !it.group || seen.has(it.revealKey)) continue;
      seen.add(it.revealKey);
      const g = it.group, r = Math.max(7, 0.24 * (it.em || (g[3] - g[1]) / 0.7));
      out.push({ key: it.revealKey, item: it, r, cx: g[0] + r, cy: Math.min(g[3] - r, Math.max(g[1] + r, (g[1] + g[3]) / 2)) });
    }
    return out;
  }
  // new writing not read yet, and strokes being written (a tap on a chip is not writing)
  _fresh() {
    const read = new Set(this.resultStrokes || []), out = this.strokes.filter(s => !read.has(s));
    for (const P of this.ptrs.values()) {
      if (!P.cur) continue;
      if (P.chip) { const b = sbox(P.cur); if (b[2] - b[0] <= 10 && b[3] - b[1] <= 10) continue; }
      out.push(P.cur);
    }
    return out.map(s => sbox(s));
  }

  // ---------------------------------------------------------------- drawing
  _ink() {
    const cs = getComputedStyle(this.el);
    const ink = this.o.ink || cs.getPropertyValue('--nib-ink').trim() || cs.color || '#1b2a4a';
    const ctx = this.ctx;
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = this.o.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }
  _seg(s) {
    const n = s.length, ctx = this.ctx;
    if (n < 2) return;
    ctx.beginPath();
    if (n === 2) { ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo(s[1][0], s[1][1]); }
    else {
      const a = s[n - 3], b = s[n - 2], c = s[n - 1];
      ctx.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      ctx.quadraticCurveTo(b[0], b[1], (b[0] + c[0]) / 2, (b[1] + c[1]) / 2);
    }
    ctx.stroke();
  }
  _stroke(s) {
    const ctx = this.ctx;
    if (s.length === 1) { ctx.beginPath(); ctx.arc(s[0][0], s[0][1], this.o.width / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < s.length - 1; i++) ctx.quadraticCurveTo(s[i][0], s[i][1], (s[i][0] + s[i + 1][0]) / 2, (s[i][1] + s[i + 1][1]) / 2);
    ctx.lineTo(s[s.length - 1][0], s[s.length - 1][1]);
    ctx.stroke();
  }
  _answerInk() {
    const cs = getComputedStyle(this.el);
    return cs.getPropertyValue('--nib-answer').trim() || '#b08a1e';
  }
  // an answer is hidden while its "=" is gone, or while new writing (not read yet) reaches into it
  _answerShown(it, live, fresh) {
    if (!it.eqFrom.every(s => live.has(s))) return false;
    if (!fresh.length) return true;
    const b = it.group, m = 0.25 * (b[3] - b[1]) + 6;
    return !fresh.some(f => f[0] < b[2] + m && f[2] > b[0] - m && f[1] < b[3] + m && f[3] > b[1] - m);
  }
  redraw() {
    const c = this.canvas, ctx = this.ctx, d = this.dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.setTransform(d, 0, 0, d, 0, 0);
    this._paint(false);
  }
  // everything on the pad, on this.ctx (already scaled); image: true leaves out what is only for the writer at the
  // board (chips, the eraser's ring, boxes)
  _paint(image) {
    const ctx = this.ctx;
    this._ink();
    const ink = ctx.strokeStyle, live = new Set(this.strokes), shown = new Set();
    const A = this.anim, e = A ? A.e : 1;
    let ans = null, fresh = null;
    const answerSetup = () => {
      if (ans) return;
      ans = this._answerInk();
      fresh = this._fresh();
    };
    // the read ink in its view; strokes still moving into it are drawn by the animation
    if (this.plan) for (const it of this.plan.items) {
      if (it.answer) {
        if (it.hidden) continue;
        answerSetup();
        if (!this._answerShown(it, live, fresh)) continue;
        const was = A && A.from.get(it);
        if (was && e < 1) morphDraw(ctx, was, it, e, ans, this.o.width);
        else drawItems(ctx, [it], { ink: ans, width: this.o.width });
        continue;
      }
      if (!it.from.every(s => live.has(s))) continue;
      for (const s of it.from) shown.add(s);
      const was = A && A.from.get(it);
      if (was && e < 1) morphDraw(ctx, was, it, e, ink, this.o.width);
      else drawItems(ctx, [it], { ink, width: this.o.width });
    }
    // views being left behind (back to ink, or symbols that no longer exist) fade out
    if (A && e < 1) for (const g of A.leaving) {
      if (g.answer) { if (g.hidden) continue; answerSetup(); if (this._answerShown(g, live, fresh)) drawItems(ctx, [g], { ink: ans, width: this.o.width, alpha: 1 - e }); continue; }
      if (!g.from.every(s => live.has(s))) continue;
      const raw = rawVisual(g.from.filter(s => !shown.has(s)));
      if (raw.parts[0].paths.length) { morphDraw(ctx, g, raw, e, ink, this.o.width); for (const s of g.from) shown.add(s); }
    }
    // answers waiting for a tap: a gold chip with a "?" where each would start
    if (!image && this.plan && this.plan.chips && this.plan.chips.length) {
      answerSetup();
      const paper = getComputedStyle(this.el).getPropertyValue('--nib-paper').trim() || '#ffffff';
      ctx.save();
      for (const ch of this.plan.chips) {
        if (!this._answerShown(ch.item, live, fresh)) continue;
        ctx.globalAlpha = 1; ctx.fillStyle = ans;
        ctx.beginPath(); ctx.arc(ch.cx, ch.cy, ch.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = paper; ctx.font = `700 ${Math.round(ch.r * 1.35)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', ch.cx, ch.cy + ch.r * 0.06);
      }
      ctx.restore();
    }
    this._ink();
    for (const s of this.strokes) if (!shown.has(s)) this._stroke(s);
    for (const P of this.ptrs.values()) if (P.cur && !(image && P.chip)) this._stroke(P.cur);
    if (!image) {
      // the eraser: a faint ring where it is
      for (const P of this.ptrs.values()) {
        if (P.mode !== 'erase' || !P.at) continue;
        ctx.save(); ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5; ctx.strokeStyle = ink;
        ctx.beginPath(); ctx.arc(P.at[0], P.at[1], P.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      if (this.o.boxes && this.result) this._boxes();
    }
  }
  // The board as a picture: the ink as the view shows it (answers that are showing included), at `scale` times its
  // size in CSS px, on `background` with an optional dot grid ({color, spacing, offset, radius}). Returns a canvas.
  image(o) {
    o = o || {};
    const k = o.scale || 2, d = this.dpr || 1, W = this.canvas.width / d, H = this.canvas.height / d;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
    const ctx = c.getContext('2d');
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (o.background) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, W, H); }
    if (o.dots && o.dots.color) {
      const g = o.dots, sp = g.spacing || 28, r = g.radius || 1.3;
      ctx.fillStyle = g.color;
      for (let y = (g.offset || 0) % sp; y <= H; y += sp) for (let x = (g.offset || 0) % sp; x <= W; x += sp) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    }
    const keep = { ctx: this.ctx, anim: this.anim };
    this.ctx = ctx; this.anim = null;
    try { this._paint(true); } finally { this.ctx = keep.ctx; this.anim = keep.anim; }
    return c;
  }
  // Lays the latest reading out in the pad's view and starts the animation from what was on screen.
  _replan(animate) {
    const old = this.plan, style = this.o.view;
    const res = this.result, at = this.resultStrokes || [];
    let plan = null;
    const reveal = !!(this.o.solve && this.o.reveal);
    this.answers = []; this._answered = new WeakMap();
    if (res && res.tree && res.tree.length && at.length && (style !== 'ink' || this.o.solve)) {
      const items = [];
      let li = 0, sample = null;
      if (this.o.solve) {
        // an answer is written with the clearest of each symbol anywhere on the board, then the Replicator hand
        let hand = null;
        try { hand = this.o.hand ? handClean(handOf(this.o.hand)) : handLoad(); } catch (err) { hand = null; }
        sample = sampleBook(res, at, hand && Object.keys(hand).length ? hand : null);
      }
      const R = refSize(at), done = [];
      // writing still fresh is left as written: it changes into its view once the writer has rested
      const settle = style !== 'ink' ? Math.max(0, +this.o.settle || 0) : 0, now = performance.now();
      let holdUntil = 0;
      for (const part of res.parts || [{ strokes: at, result: res }]) {
        let fresh = false;
        if (settle) {
          let end = 0;
          for (const s of part.strokes) { const q = s[s.length - 1]; if (q && q.length > 2 && q[2] > end) end = q[2]; }
          if (end > 0 && end > now - settle) { fresh = true; holdUntil = Math.max(holdUntil, end + settle); }   // (restored strokes carry no time)
        }
        const pr = part.result;
        if (!pr || !pr.lines || !pr.lines.length) continue;
        // answers belong to the expression they are in: "x = 5" sets x for the lines below it, here only; an "x ="
        // may also solve an equation in the writing just above it (within four writing heights, overlapping across)
        let answers = null;
        if (this.o.solve) {
          const box = part.strokes.map(sbox).reduce(ubox);
          const rowBox = row => {
            const bs = [];
            const walk = r => { for (const u of r) { for (const k of u.strokes || []) if (part.strokes[k]) bs.push(sbox(part.strokes[k])); for (const key of ['num', 'den', 'body', 'idx', 'sup', 'sub']) if (u[key]) walk(u[key]); } };
            walk(row);
            return bs.length ? bs.reduce(ubox) : null;
          };
          const lab = u => (u && u.k === 's' ? u.label : '');
          const rows = pr.tree.slice(), fb = rowBox(rows[0]);
          // writing carried on past a gap on the same line is one problem: "13.999 +      2 + 7 =" (the writing to its
          // left ends with a sign, or this begins with one)
          const startsOp = ['+', '\\times', '\\div', '\\cdot', '='].includes(lab(rows[0][0]));
          let left = null;
          for (const d of done) {
            if (!fb || !d.lastBox || !(d.endsOp || startsOp)) continue;
            const ov = Math.min(d.lastBox[3], fb[3]) - Math.max(d.lastBox[1], fb[1]), gx = fb[0] - d.lastBox[2];
            if (ov > 0.4 * Math.min(d.lastBox[3] - d.lastBox[1], fb[3] - fb[1]) && gx > -0.5 * R && gx <= 6 * R && (!left || gx < left.gx)) left = { d, gx };
          }
          if (left) rows[0] = left.d.lastRow.concat(rows[0]);
          let above = null, gap = Infinity;
          for (const d of done) {
            const gy = box[1] - d.box[3], gx = Math.max(0, d.box[0] - box[2], box[0] - d.box[2]);
            if (gy > -0.5 * R && gy <= 4 * R && gx <= R && gy < gap) { above = d; gap = gy; }
          }
          try { answers = solveRows(rows, this.o, above && above.eqs); } catch (err) { answers = null; }
          const lastRow = rows[rows.length - 1];
          done.push({ box, eqs: (answers && answers.eqs) || [], lastRow, lastBox: rowBox(pr.tree[pr.tree.length - 1]),
            endsOp: ['+', '-', '\\times', '\\div', '\\cdot', '\\pm'].includes(lab(lastRow[lastRow.length - 1])) });
        }
        this._answered.set(pr, !!(answers && answers.some(Boolean)));
        if (answers) answers.forEach((a, k) => { if (a) this.answers.push({ line: li + k, latex: a.latex, text: a.text, kind: a.kind, exact: a.exact, value: a.value }); });
        li += pr.tree.length;
        if (style === 'ink' && !(answers && answers.some(Boolean))) continue;
        let out = null;
        try { out = inPlace(part.strokes, style, { result: pr, hand: this.o.hand || undefined, answers: answers ? answers.map(a => a && a.nodes) : null, sample }); } catch (err) { out = null; }
        if (!out) continue;
        const groups = new Map();
        // an answer shown by a tap stays shown while its line (its strokes) and the answer itself are the same
        const rowSids = pr.tree.map(row => {
          const ids = [];
          const walk = r => { for (const u of r) { for (const k of u.strokes || []) if (part.strokes[k]) ids.push(this._sid(part.strokes[k])); for (const key of ['num', 'den', 'body', 'idx', 'sup', 'sub']) if (u[key]) walk(u[key]); } };
          walk(row);
          return ids;
        });
        for (const it of out.items) {
          if (fresh) continue;                             // nothing of a fresh part moves yet, its answer included
          if (it.answer) {
            it.from = []; it.eqFrom = (it.eq || []).map(i => part.strokes[i]).filter(Boolean);
            if (!it.eqFrom.length) continue;
            const eqSid = this._sid(it.eqFrom[0]), k = rowSids.findIndex(ids => ids.includes(eqSid));
            const a = k >= 0 && answers ? answers[k] : null;
            it.revealKey = (k >= 0 ? rowSids[k].slice().sort((x, y) => x - y).join(',') : it.eqFrom.map(s => this._sid(s)).join(',')) + '|' + (a ? a.latex : '');
            it.em = out.em;
            it.hidden = reveal && !this.revealed.has(it.revealKey);
            it.id = 'ans:' + it.eqFrom.map(s => this._sid(s)).join(',') + ':' + it.key;
            const g = it.eqFrom.map(s => this._sid(s)).join(','), b = groups.get(g);
            groups.set(g, b ? [Math.min(b[0], it.box[0]), Math.min(b[1], it.box[1]), Math.max(b[2], it.box[2]), Math.max(b[3], it.box[3])] : it.box.slice());
            it.groupKey = g; items.push(it);
          } else {
            it.from = it.src.map(i => part.strokes[i]).filter(Boolean);
            if (!it.from.length) continue;
            it.id = it.from.map(s => this._sid(s)).join(',') + '|' + it.label;
            items.push(it);
          }
        }
        for (const it of items) if (it.answer && groups.has(it.groupKey)) it.group = groups.get(it.groupKey);
      }
      this._fitAnswers(items);
      plan = { style, items, chips: this._chips(items) };
      clearTimeout(this.settleTimer);
      if (holdUntil) this.settleTimer = setTimeout(() => { if (this.result === res) this._replan(true); }, holdUntil - now + 30);
      if (style === 'typeset') typeFontsReady().then(ok => { if (ok && this.plan === plan) this.redraw(); });
    }
    this.plan = plan && plan.items.length ? plan : style === 'ink' ? null : plan;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || !this.o.motion || reduce) { this.anim = null; this.redraw(); return; }
    // where each item comes from: the same symbol in the old view, or the ink as written
    const before = new Map(old ? old.items.map(it => [it.id, it]) : []);
    const from = new Map(), used = new Set();
    if (this.plan) for (const it of this.plan.items) {
      if (it.answer) {                                    // an answer glides from where it was, or fades in
        const was = before.get(it.id);
        if (was) used.add(was);
        if (was && !(was.hidden && !it.hidden)) from.set(it, was); else from.set(it, { parts: [], box: it.box });
        continue;
      }
      const was = before.get(it.id) || (old && old.items.find(o => !o.answer && o.from.length === it.from.length && o.from.every(s => it.from.includes(s))));
      if (was) { from.set(it, was); used.add(was); }
      else from.set(it, rawVisual(it.from));
    }
    const leaving = old ? old.items.filter(o => !used.has(o)) : [];
    if (!from.size && !leaving.length) { this.anim = null; this.redraw(); return; }
    this._animate(from, leaving);
  }
  _animate(from, leaving) {
    const A = this.anim = { t0: performance.now(), dur: 260, from, leaving, e: 0 };
    const tick = now => {
      if (this.anim !== A) return;
      const t = Math.min(1, (now - A.t0) / A.dur);
      A.e = 1 - Math.pow(1 - t, 3);
      this.redraw();
      if (t < 1) requestAnimationFrame(tick); else { this.anim = null; this.redraw(); }
    };
    requestAnimationFrame(tick);
  }
  // An answer that would run off the right edge of the board: squeezed to fit after its "=", or, when that would make
  // it smaller than 0.6 of the writing, written at full size under its line, ending at the edge (where there is room
  // below; otherwise squeezed anyway, to no less than 0.35).
  _fitAnswers(items) {
    const d = this.dpr || 1, W = this.canvas.width / d, H = this.canvas.height / d, m = 10;
    if (W < 4 * m) return;
    const groups = new Map();
    for (const it of items) if (it.answer && it.group) { if (!groups.has(it.groupKey)) groups.set(it.groupKey, []); groups.get(it.groupKey).push(it); }
    for (const list of groups.values()) {
      const b = list[0].group, w = b[2] - b[0], h = b[3] - b[1];
      if (b[2] <= W - m || w <= 0) continue;
      let k = (W - m - b[0]) / w, dx = 0, dy = 0;
      if (k < 0.6 && w <= W - 2 * m && b[3] + 1.4 * h <= H - m) { k = 1; dx = W - m - b[2]; dy = 1.35 * h; }
      else k = Math.max(0.35, k);
      const ox = b[0], oy = b[3], X = x => ox + (x - ox) * k + dx, Y = y => oy + (y - oy) * k + dy;
      for (const it of list) {
        it.parts = mapParts(it.parts, X, Y, k);
        if (it.em) it.em *= k;
        it.box = [X(it.box[0]), Y(it.box[1]), X(it.box[2]), Y(it.box[3])];
        it.group = [X(b[0]), Y(b[1]), X(b[2]), Y(b[3])];
      }
    }
  }
  _sid(s) { let id = this.sid.get(s); if (!id) { id = this.nsid++; this.sid.set(s, id); } return id; }
  _boxes() {
    const ctx = this.ctx, cs = getComputedStyle(this.el);
    const col = cs.getPropertyValue('--nib-box').trim() || 'rgba(201,162,39,.85)';
    ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'bottom';
    if (this.plan && this.plan.style !== 'ink') {
      const live = new Set(this.strokes);
      for (const it of this.plan.items) {
        if (it.answer || !it.from.every(st => live.has(st))) continue;
        const b = it.box; ctx.strokeRect(b[0] - 3, b[1] - 3, b[2] - b[0] + 6, b[3] - b[1] + 6); ctx.fillText(it.label, b[0] - 3, b[1] - 4);
      }
    } else for (const s of this.result.symbols) {
      const b = s.box; ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6); ctx.fillText(s.label, b.x - 3, b.y - 4);
    }
    ctx.restore();
  }
  _resize() {
    const c = this.canvas, r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    const changed = c.width !== w || c.height !== h;
    if (changed) { c.width = w; c.height = h; }
    this.dpr = d;
    // a board turned or made smaller: the ink is brought back in (once, undoable)
    if (changed && this.o.fit && this._fit(r.width, r.height)) return;
    // answers near an edge are fitted to the board's size: lay them out again for the new one
    if (changed && this.answers && this.answers.length && this.result) this._replan(false);
    this.redraw();
  }
  // When the ink no longer fits the pad, it is scaled (never up) about its top-left corner and moved so it all sits
  // at least 16 px inside, as one undoable step; corrections stay with their strokes (the strokes are the same
  // objects, moved), and what is on screen moves at once while the reading catches up.
  _fit(W, H) {
    if (this.ptrs.size || !this.strokes.length || W < 120 || H < 120) return false;
    const b = this.strokes.map(sbox).reduce(ubox), m = 16, tol = 8;
    if (b[0] >= -tol && b[1] >= -tol && b[2] <= W + tol && b[3] <= H + tol) return false;
    const bw = Math.max(b[2] - b[0], 1e-6), bh = Math.max(b[3] - b[1], 1e-6);
    const k = Math.min(1, (W - 2 * m) / bw, (H - 2 * m) / bh);
    if (!(k > 0)) return false;
    const x0 = Math.max(m, Math.min(b[0], W - m - bw * k)), y0 = Math.max(m, Math.min(b[1], H - m - bh * k));
    const t = [b[0], b[1], x0, y0, k];
    const move = this.strokes.map(s => [s, s.map(p => p.slice()), s.map(p => { const q = p.slice(); q[0] = x0 + (p[0] - b[0]) * k; q[1] = y0 + (p[1] - b[1]) * k; return q; })]);
    const h = { move, t };
    this._apply(h, false);
    this._push(h);
    this._changed();
    return true;
  }
  // the view moved with the ink: t = [ax, ay, bx, by, k] maps x to bx + (x - ax)·k (back: the other way)
  _movePlan(t, back) {
    if (!this.plan) return;
    const [ax, ay, bx, by, k0] = t, k = back ? 1 / k0 : k0;
    const X = back ? (x => ax + (x - bx) * k) : (x => bx + (x - ax) * k), Y = back ? (y => ay + (y - by) * k) : (y => by + (y - ay) * k);
    const B = b => [X(b[0]), Y(b[1]), X(b[2]), Y(b[3])];
    for (const it of this.plan.items) {
      it.parts = mapParts(it.parts, X, Y, k); it.box = B(it.box);
      if (it.group) it.group = B(it.group);
      if (it.em) it.em *= k;
    }
    this.plan.chips = this._chips(this.plan.items);
    this.anim = null;
  }

  // ---------------------------------------------------------------- state
  _changed() {
    this.redraw();
    if (this.o.onChange) this.o.onChange(this);
    this.el.dispatchEvent(new CustomEvent('nib:change', { detail: this, bubbles: true }));
    if (!this.strokes.length) { clearTimeout(this.timer); this.gen++; this._emit(null); return; }  // nothing left to read
    if (this.o.auto) this._schedule(this.o.delay);
  }
  // Read the ink without freezing the page: classify the new stroke groups a few milliseconds at a time,
  // then run the (cheap) final pass. New ink cancels a read in progress.
  _schedule(ms) {
    clearTimeout(this.timer);
    const gen = ++this.gen;
    this.timer = setTimeout(() => {
      const it = this._warm(this._ropts()), start = performance.now();
      const step = () => {
        if (gen !== this.gen) return;
        const t0 = performance.now();
        while (performance.now() - t0 < 14) if (it.next().done) { this.recognize(start); return; }
        this.timer = setTimeout(step, 0);
      };
      step();
    }, ms);
  }
  _emit(res) {
    this.result = res;
    this.resultStrokes = res ? this.strokes.slice() : [];
    this._replan(true);
    if (this.o.train) this._trainSee();
    if (this.o.boxes) this.redraw();
    if (this.o.onResult) this.o.onResult(res, this);
    this.el.dispatchEvent(new CustomEvent('nib:result', { detail: res, bubbles: true }));
  }
  recognize(start) {
    clearTimeout(this.timer); this.gen++;
    if (!this.strokes.length) { this._emit(null); return null; }
    let res;
    if (this.o.separate) res = this._readParts(this._ropts());
    else res = this.rec.recognize(this.strokes, Object.assign(this._ropts(), { fix: this._fixFor(this.strokes) }));
    if (typeof start === 'number') res.ms = Math.round(performance.now() - start); // the whole read, not just its last pass
    this._emit(res);
    return res;
  }
  // the recogniser's options (the pad's own)
  _ropts() { const o = Object.assign({}, this.o); o.smooth = +o.smooth > 0 ? +o.smooth : 0; return o; }
  // the classifier work for the next read, one stroke group per step (newest ink first)
  *_warm(ro) {
    if (!this.o.separate) { yield* this.rec.warmup(this.strokes, Object.assign({}, ro, { fix: this._fixFor(this.strokes) })); return; }
    for (const g of clustersOf(this.strokes)) {
      const st = g.map(i => this.strokes[i]);
      if (!this._partCached(st, ro)) yield* this._recFor(st[0]).warmup(st, Object.assign({}, ro, { fix: this._fixFor(st) }));
    }
  }
  // the corrections that apply to these strokes, as indices into them
  _fixFor(st) {
    return this.fixes.filter(f => f.strokes.every(x => st.includes(x))).map(f => ({ strokes: f.strokes.map(x => st.indexOf(x)), label: f.label }));
  }
  // A board: each group of writing is read on its own (and kept while it does not change), then put together.
  _readParts(ro) {
    const parts = [];
    for (const g of clustersOf(this.strokes)) {
      const st = g.map(i => this.strokes[i]);
      const key = this._partKey(st, ro);
      let res = this.parts.get(key);
      if (!res) {
        res = this._recFor(st[0]).recognize(st, Object.assign({}, ro, { fix: this._fixFor(st) }));
        if (this.parts.size > 300) this.parts.clear();
        this.parts.set(key, res);
      }
      parts.push({ idx: g, strokes: st, result: res });
    }
    return joinParts(parts);
  }
  _partKey(st, ro) {
    const fx = this.fixes.filter(f => f.strokes.every(x => st.includes(x))).map(f => f.strokes.map(x => this._sid(x)).join('.') + '=' + f.label).join(';');
    return st.map(x => this._sid(x)).join(',') + '|' + fx + '|' + this.optsVersion + '|' + MEM.version;
  }
  _partCached(st, ro) { return this.parts.has(this._partKey(st, ro)); }
  _recFor(first) { let r = this.recs.get(first); if (!r) { r = new Recognizer(); this.recs.set(first, r); } return r; }
  // re-label one recognised symbol (from result.symbols[i].candidates) and re-run
  // the reading's LaTeX with the answers written in after their "="
  solvedLatex() {
    const res = this.result;
    if (!res) return '';
    if (!this.answers.length) return res.latex;
    const by = new Map(this.answers.map(a => [a.line, a.latex]));
    const lines = res.lines.map((l, i) => l.latex + (by.get(i) || ''));
    return lines.length > 1 ? '\\begin{gathered}' + lines.join(' \\\\ ') + '\\end{gathered}' : lines[0] || '';
  }
  relabel(symbol, label) {
    // the symbol's strokes as they were read (its indices are into the ink of that reading), still on the pad
    const at = this.resultStrokes && this.resultStrokes.length ? this.resultStrokes : this.strokes;
    const ss = symbol.strokes.map(i => at[i]).filter(s => s && this.strokes.includes(s));
    if (!ss.length) return this.result;
    this.fixes = this.fixes.filter(f => !f.strokes.some(s => ss.includes(s)));
    this.fixes.push({ strokes: ss, label });
    this.parts.clear();
    // remember the shape so the same writer's next one reads right (stays in this browser)
    if (this.o.learn !== false && this.o.memory !== false) {
      try {
        const ref = refSize(normStrokes(this.strokes).strokes), sm = this._ropts().smooth;
        let g = normStrokes(ss).strokes;
        if (sm > 0) g = g.map(st => smoothPath(st, sm * ref));
        memLearn(classifyGroup(g, ref).hidden, label === '\\cdot' ? '.' : label);   // a dot is a dot; where it sits says which
      } catch (e) { /* ok */ }
    }
    const res = this.recognize();
    // a correction is the most useful thing to keep: the piece it is in is kept (again) at once, with it
    if (this.o.train) for (const p of this._trainParts()) if (p.strokes.some(s => ss.includes(s))) { const k = this._trainKey(p.strokes); this._trainSkip.delete(k); this._trainRecord(p, k); }
    return res;
  }
  // one step of history, done (back = false) or undone (back = true)
  _apply(h, back) {
    if (h.add) {
      if (back) { const i = this.strokes.lastIndexOf(h.add); if (i >= 0) this.strokes.splice(i, 1); }
      else this.strokes.push(h.add);
    }
    if (h.erase) {
      if (back) for (const e of h.erase.slice().reverse()) this.strokes.splice(e.i, 0, e.s);
      else for (const e of h.erase) { const i = this.strokes.indexOf(e.s); if (i >= 0) this.strokes.splice(i, 1); }
    }
    if (h.clear) {                                        // Clear also takes the corrections and the shown answers
      if (back) { this.fixes = h.fixes.slice(); this.revealed = new Set(h.revealed); }
      else { this.fixes = []; this.revealed = new Set(); }
    }
    if (h.hide) for (const k of h.hide) { if (back) this.revealed.add(k); else this.revealed.delete(k); }
    if (h.reveal) for (const k of h.reveal) { if (back) this.revealed.delete(k); else this.revealed.add(k); }
    if (h.move) {
      for (const [s, was, now] of h.move) { const src = back ? was : now; s.length = 0; for (const p of src) s.push(p.slice()); }
      this.parts.clear(); this._hashes = new WeakMap();
      this._movePlan(h.t, back);
    }
    if (h.hide || h.reveal || h.clear) this._syncHidden();
  }
  undo() {
    const h = this.history.pop(); if (!h) return;
    this._apply(h, true);
    this.future.push(h); this._changed();
  }
  redo() {
    const h = this.future.pop(); if (!h) return;
    this._apply(h, false);
    this.history.push(h); this._changed();
  }
  clear() {
    if (!this.strokes.length) return;
    this.trainFlush();
    const h = { erase: this.strokes.map((s, i) => ({ i, s })).reverse(), clear: true, fixes: this.fixes.slice(), revealed: [...this.revealed] };
    this._apply(h, false);
    this._push(h); this._changed();
  }
  get canUndo() { return this.history.length > 0; }
  get canRedo() { return this.future.length > 0; }
  getStrokes() { return this.strokes.map(s => s.map(p => p.slice())); }
  // [[x, y, t?], ...] or {x, y, t?} points, or {points} strokes; a stroke with no usable point is null
  _cleanStrokes(strokes) {
    const pt = p => (Array.isArray(p) ? [+p[0], +p[1], +p[2] || 0] : p && typeof p === 'object' ? [+p.x, +p.y, +p.t || 0] : null);
    return (Array.isArray(strokes) ? strokes : [])
      .map(s => (Array.isArray(s) ? s : s && Array.isArray(s.points) ? s.points : []).map(pt).filter(p => p && isFinite(p[0]) && isFinite(p[1])))
      .map(s => (s.length ? s : null));
  }
  setStrokes(strokes) {
    this._dropAll(); this.trainFlush();
    this.strokes = this._cleanStrokes(strokes).filter(Boolean);
    this.history = []; this.future = []; this.fixes = []; this.revealed = new Set(); this._changed();
    if (this.strokes.length && this.o.auto) this._schedule(0);   // no need to wait for a pen to rest
  }
  _dropAll() { for (const P of [...this.ptrs.values()]) this._drop(P); }
  // Everything that makes up the pad's page, to keep: the strokes (x, y to 0.1 px), the corrections (as indices
  // into the strokes) and the answers shown by a tap (the strokes of their line, and the answer).
  getState() {
    const idx = new Map(this.strokes.map((s, i) => [s, i])), bySid = new Map(this.strokes.map((s, i) => [String(this._sid(s)), i]));
    const strokes = this.strokes.map(s => s.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]));
    const fixes = this.fixes.filter(f => f.strokes.length && f.strokes.every(s => idx.has(s))).map(f => ({ strokes: f.strokes.map(s => idx.get(s)), label: f.label }));
    const revealed = [];
    for (const key of this.revealed) {
      const cut = key.indexOf('|'), ids = key.slice(0, cut).split(',').filter(Boolean).map(x => bySid.get(x));
      if (ids.length && ids.every(i => i !== undefined)) revealed.push({ strokes: ids, answer: key.slice(cut + 1) });
    }
    return { strokes, fixes, revealed, types: this.strokes.map(s => this.strokeInfo(s).type) };
  }
  setState(st) {
    st = st || {};
    this._dropAll(); this.trainFlush();
    const all = this._cleanStrokes(st.strokes), at = i => (Number.isInteger(i) && all[i]) || null;
    const types = Array.isArray(st.types) ? st.types : [];
    all.forEach((s, i) => { if (s && ['pen', 'touch', 'mouse'].includes(types[i])) this.info.set(s, { type: types[i], width: null }); });
    this.strokes = all.filter(Boolean);
    this.fixes = (Array.isArray(st.fixes) ? st.fixes : []).map(f => f && Array.isArray(f.strokes) && typeof f.label === 'string' ? { strokes: f.strokes.map(at), label: f.label } : null)
      .filter(f => f && f.strokes.length && f.strokes.every(Boolean));
    this.revealed = new Set((Array.isArray(st.revealed) ? st.revealed : []).map(r => {
      const ss = r && Array.isArray(r.strokes) ? r.strokes.map(at) : [];
      return ss.length && ss.every(Boolean) ? ss.map(s => this._sid(s)).sort((x, y) => x - y).join(',') + '|' + (r.answer || '') : null;
    }).filter(Boolean));
    this.history = []; this.future = []; this.parts.clear();
    if (!this._fitHere()) this._changed();
    if (this.strokes.length && this.o.auto) this._schedule(0);
  }
  // a page put back on a pad smaller than the one it was written on (fit on): brought in, as for a resize
  _fitHere() {
    if (!this.o.fit) return false;
    const r = this.canvas.getBoundingClientRect();
    return this._fit(r.width, r.height);
  }
  // the page as it is right now, history and all (for a page that is put away and taken out again)
  snapshot() { return { strokes: this.strokes.slice(), fixes: this.fixes.slice(), revealed: new Set(this.revealed), history: this.history.slice(), future: this.future.slice() }; }
  restore(snap) {
    this._dropAll(); this.trainFlush();
    this.strokes = snap.strokes.slice(); this.fixes = snap.fixes.slice(); this.revealed = new Set(snap.revealed);
    this.history = snap.history.slice(); this.future = snap.future.slice();
    if (!this._fitHere()) this._changed();
    if (this.strokes.length && this.o.auto) this._schedule(0);
  }
  // ---------------------------------------------------------------- the training log (train on)
  // Each piece of writing (a part of the board: one expression) that has been read and then left alone for 4 s, or
  // that is on a page being left, is kept once in this.training as a record (see docs/HANDOFF.md, "Training log").
  // Its key is its strokes' ids: a hash of each stroke's points at 0.1 px, so the same writing has the same key
  // after a reload or on a page taken out again; keeping the same key again replaces the record (a later Fix).
  _sidHash(s) {
    let h = this._hashes.get(s);
    if (h) return h;
    let a = 0x811c9dc5;
    for (const p of s) for (const v of [Math.round(p[0] * 10), Math.round(p[1] * 10)]) { a ^= v & 0xffff; a = Math.imul(a, 16777619); a ^= (v >>> 16) & 0xffff; a = Math.imul(a, 16777619); }
    h = (a >>> 0).toString(36) + '.' + s.length;
    this._hashes.set(s, h);
    return h;
  }
  _trainKey(st) { return st.map(s => this._sidHash(s)).sort().join(','); }
  // the pieces of the latest reading (a pad that is not a board is one piece)
  _trainParts() {
    const res = this.result;
    if (!res) return [];
    return (res.parts || [{ strokes: this.resultStrokes || [], result: res }]).filter(p => p.result && p.result.lines && p.result.lines.length && p.strokes.length);
  }
  _trainDone(k) { return this._trainIdx.has(k) || this._trainSkip.has(k); }
  // new writing (not read yet, or being written) close enough to join this piece
  _trainReached(st, fresh) {
    if (!fresh.length) return false;
    const b = st.map(sbox).reduce(ubox), R = refSize(st), mx = 1.6 * R, my = 1.7 * R;
    return fresh.some(f => f[0] < b[2] + mx && f[2] > b[0] - mx && f[1] < b[3] + my && f[3] > b[1] - my);
  }
  // a reading arrived: each piece is timed from when it was first read as it is now
  _trainSee() {
    const now = Date.now(), keep = new Map();
    for (const p of this._trainParts()) { const k = this._trainKey(p.strokes); keep.set(k, this._seen.has(k) ? this._seen.get(k) : now); }
    this._seen = keep;
    this._trainTick();
  }
  _trainTick() {
    clearTimeout(this._trainTimer); this._trainTimer = null;
    if (!this.o.train) return;
    const now = Date.now(), live = new Set(this.strokes), fresh = this._fresh();
    let wait = Infinity;
    for (const p of this._trainParts()) {
      const k = this._trainKey(p.strokes), at = this._seen.get(k);
      if (at === undefined || this._trainDone(k)) continue;
      if (now - at < 4000) { wait = Math.min(wait, at + 4000 - now); continue; }
      if (!p.strokes.every(s => live.has(s))) continue;                    // erased in: the next reading times it again
      if (this._trainReached(p.strokes, fresh)) { wait = Math.min(wait, 1000); continue; }   // being added to
      this._trainRecord(p, k);
    }
    if (wait < Infinity) this._trainTimer = setTimeout(() => this._trainTick(), wait + 20);
  }
  // the page is being left (another page, Clear, deleted, the tab closed): keep every piece read on it now
  trainFlush() {
    if (!this.o.train) return 0;
    const live = new Set(this.strokes), fresh = this._fresh();
    let n = 0;
    for (const p of this._trainParts()) {
      const k = this._trainKey(p.strokes);
      if (this._trainDone(k) || !p.strokes.every(s => live.has(s)) || this._trainReached(p.strokes, fresh)) continue;
      this._trainRecord(p, k); n++;
    }
    return n;
  }
  _trainRecord(p, key) {
    const st = p.strokes, r = p.result, r1 = v => Math.round(v * 10) / 10;
    let x0 = Infinity, y0 = Infinity, t0 = Infinity;
    for (const s of st) for (const q of s) { if (q[0] < x0) x0 = q[0]; if (q[1] < y0) y0 = q[1]; if ((q[2] || 0) < t0) t0 = q[2] || 0; }
    const d = this.dpr || 1;
    const rec = {
      key, t: Date.now(), w: Math.round(this.canvas.width / d), h: Math.round(this.canvas.height / d), view: this.o.view,
      strokes: st.map(s => s.map(q => [r1(q[0] - x0), r1(q[1] - y0), Math.round((q[2] || 0) - t0)])),
      types: st.map(s => this.strokeInfo(s).type),
      latex: r.latex,
      symbols: r.symbols.map(sy => ({ label: sy.label, strokes: sy.strokes.slice() })),
      fixed: this.fixes.filter(f => f.strokes.length && f.strokes.every(x => st.includes(x))).map(f => ({ strokes: f.strokes.map(x => st.indexOf(x)), label: f.label })),
      answered: !!this._answered.get(r),
      confidence: Math.round((r.confidence || 0) * 1000) / 1000,
    };
    // what the writer meant to write (a drill's prompt): its fields are copied in, never over the record's own
    const meta = this.trainMeta;
    if (meta && typeof meta === 'object') for (const k of Object.keys(meta)) if (!(k in rec) && meta[k] !== undefined && typeof meta[k] !== 'function') rec[k] = meta[k];
    this._trainPut(rec);
    this.el.dispatchEvent(new CustomEvent('nib:train', { detail: rec, bubbles: true }));
    return rec;
  }
  // newest last; the same key replaces; at most 3,000 records and about 4 MB, the oldest go first
  _trainPut(rec) {
    if (this._trainIdx.has(rec.key)) { const i = this.training.indexOf(this._trainIdx.get(rec.key)); if (i >= 0) this.training.splice(i, 1); }
    this.training.push(rec); this._trainIdx.set(rec.key, rec);
    let size = 0;
    try { size = JSON.stringify(rec).length; } catch (e) { size = 0; }
    this._trainBytes.set(rec.key, size);
    let total = 0; for (const v of this._trainBytes.values()) total += v;
    while (this.training.length > 1 && (this.training.length > 3000 || total > 4e6)) {
      const old = this.training.shift();
      total -= this._trainBytes.get(old.key) || 0; this._trainIdx.delete(old.key); this._trainBytes.delete(old.key);
    }
  }
  // put back a saved log (records as kept before, oldest first); returns how many were taken
  trainLoad(records) {
    let n = 0;
    for (const rec of Array.isArray(records) ? records : []) {
      if (!rec || typeof rec !== 'object' || typeof rec.key !== 'string' || !Array.isArray(rec.strokes) || !rec.strokes.length) continue;
      this._trainPut(rec); n++;
    }
    return n;
  }
  // keep the piece of the latest reading made of these strokes now (again, if it was kept before: the record is
  // replaced), whether or not train is on; returns the record, or null when no piece read is made of them
  trainKeep(strokes) {
    if (!Array.isArray(strokes) || !strokes.length) return null;
    const k = this._trainKey(strokes);
    const p = this._trainParts().find(q => this._trainKey(q.strokes) === k);
    if (!p) return null;
    this._trainSkip.delete(k);
    return this._trainRecord(p, k);
  }
  // mark the record with this key as checked by the writer (verified true) or not (false); sends nib:train again
  trainVerify(key, verified) {
    const rec = this._trainIdx.get(key);
    if (!rec) return null;
    rec.verified = !!verified;
    try { this._trainBytes.set(key, JSON.stringify(rec).length); } catch (e) { /* ok */ }
    this.el.dispatchEvent(new CustomEvent('nib:train', { detail: rec, bubbles: true }));
    return rec;
  }
  // the writing on the page now is not kept: records already made of it go, and it is not kept again unless it
  // changes (a drill's Skip); returns how many records went (nib:train is sent with {removed: [keys]})
  trainIgnore() {
    const removed = [];
    clearTimeout(this._trainTimer); this._trainTimer = null;
    for (const p of this._trainParts()) {
      const k = this._trainKey(p.strokes);
      this._trainSkip.add(k);
      const rec = this._trainIdx.get(k);
      if (rec) { const i = this.training.indexOf(rec); if (i >= 0) this.training.splice(i, 1); this._trainIdx.delete(k); this._trainBytes.delete(k); removed.push(k); }
    }
    if (removed.length) this.el.dispatchEvent(new CustomEvent('nib:train', { detail: { removed }, bubbles: true }));
    return removed.length;
  }
  // forget the log; what is on the page now is not kept again unless it changes
  trainForget() {
    this.training.length = 0; this._trainIdx.clear(); this._trainBytes.clear();
    clearTimeout(this._trainTimer); this._trainTimer = null;
    for (const p of this._trainParts()) this._trainSkip.add(this._trainKey(p.strokes));
  }
  destroy() {
    clearTimeout(this.timer); clearTimeout(this._trainTimer); this.gen++; this.anim = null; this.ptrs.clear();
    if (this._raf) cancelAnimationFrame(this._raf);
    if (typeof window !== 'undefined') window.removeEventListener('nib:hand', this._handChanged);
    if (this.ro) this.ro.disconnect();
    if (this.mo) this.mo.disconnect();
    if (this.mq) this.mq.removeEventListener('change', this._theme);
    this.canvas.remove();
  }
}

// <nib-pad symbols="school" delay="450" ink="#1b2a4a" stroke-width="3" boxes></nib-pad>
if (typeof customElements !== 'undefined' && typeof HTMLElement !== 'undefined' && !customElements.get('nib-pad')) {
  class NibPad extends HTMLElement {
    static get observedAttributes() { return ['symbols', 'ink', 'stroke-width', 'delay', 'settle', 'auto', 'boxes', 'pen-only', 'lines', 'degrees', 'smooth', 'view', 'motion', 'separate', 'solve', 'times', 'reveal', 'fit', 'train']; }
    _opts() {
      const a = n => this.getAttribute(n), has = n => this.hasAttribute(n);
      const sym = a('symbols');
      return {
        symbols: sym ? (sym.includes(',') ? sym.split(',').map(x => x.trim()) : sym) : 'school',
        ink: a('ink') || null,
        width: has('stroke-width') ? +a('stroke-width') : 3,
        delay: has('delay') ? +a('delay') : 450,
        settle: has('settle') ? +a('settle') : 0,
        auto: a('auto') !== 'false',
        boxes: has('boxes'),
        penOnly: has('pen-only'),
        lines: a('lines') !== 'false',
        degrees: a('degrees') !== 'false',
        smooth: has('smooth') && +a('smooth') > 0 ? +a('smooth') : 0,
        view: ['tidy', 'hand', 'typeset'].includes(a('view')) ? a('view') : 'ink',
        motion: a('motion') !== 'false',
        separate: has('separate') && a('separate') !== 'false',
        solve: has('solve') && a('solve') !== 'false',
        times: a('times') !== 'false',
        reveal: has('reveal') && a('reveal') !== 'false',
        fit: has('fit') && a('fit') !== 'false',
        train: has('train') && a('train') !== 'false',
      };
    }
    connectedCallback() {
      clearTimeout(this._gone);
      if (this.pad) return;
      if (!this.style.display) this.style.display = 'block';
      if (this.getBoundingClientRect().height < 4 && !this.style.height) this.style.height = '220px';
      this.pad = new Pad(this, Object.assign(this._opts(), {
        onResult: r => this.dispatchEvent(new CustomEvent('change', { detail: r, bubbles: true })),
      }));
      if (this._meta) this.pad.trainMeta = this._meta;
      if (this._saved) { this.pad.setStrokes(this._saved); this._saved = null; }
    }
    // moved within the page: keep everything; removed for good: release the canvas and observers (ink is kept
    // in case the same element is put back later)
    disconnectedCallback() {
      clearTimeout(this._gone);
      this._gone = setTimeout(() => {
        if (this.isConnected || !this.pad) return;
        this._saved = this.pad.getStrokes(); this.pad.destroy(); this.pad = null;
      }, 0);
    }
    attributeChangedCallback() { if (this.pad) this.pad.setOptions(this._opts()); }
    get result() { return this.pad ? this.pad.result : null; }
    get latex() { return this.pad && this.pad.result ? this.pad.result.latex : ''; }
    get text() { return this.pad && this.pad.result ? this.pad.result.text : ''; }
    get strokes() { return this.pad ? this.pad.getStrokes() : []; }
    set strokes(v) { if (this.pad) this.pad.setStrokes(v); }
    get view() { return this.pad ? this.pad.o.view : (this.getAttribute('view') || 'ink'); }
    set view(v) { this.setAttribute('view', ['tidy', 'hand', 'typeset'].includes(v) ? v : 'ink'); }
    // what the view shows: [{label, box, parts}] in the pad's coordinates (parts as drawn: ink paths, text, rules);
    // answers are marked answer, and hidden while they wait behind their chip
    get shown() { return this.pad && this.pad.plan ? this.pad.plan.items.map(it => Object.assign({ label: it.label, box: it.box.slice(), parts: it.parts }, it.answer ? { answer: true } : {}, it.hidden ? { hidden: true } : {})) : []; }
    // with solve on: [{line, latex, text, kind, exact, value}] for each line that ends with "=", and the LaTeX with them in
    get solve() { return this.pad ? !!this.pad.o.solve : this.hasAttribute('solve') && this.getAttribute('solve') !== 'false'; }
    set solve(v) { if (v) this.setAttribute('solve', ''); else this.removeAttribute('solve'); }
    get answers() { return this.pad ? this.pad.answers.map(a => Object.assign({}, a)) : []; }
    get solved() { return this.pad ? this.pad.solvedLatex() : ''; }
    toImage(type) { return this.pad ? this.pad.canvas.toDataURL(type || 'image/png') : ''; }
    // the board as a picture at 2x (or o.scale), on o.background with o.dots: a canvas (see Pad.image)
    image(o) { return this.pad ? this.pad.image(o) : null; }
    // the page to keep ({strokes, fixes, revealed}) and to put back
    getState() { return this.pad ? this.pad.getState() : { strokes: this._saved || [], fixes: [], revealed: [] }; }
    setState(st) { if (this.pad) this.pad.setState(st); else this._saved = st && st.strokes; }
    get reveal() { return this.pad ? !!this.pad.o.reveal : this.hasAttribute('reveal') && this.getAttribute('reveal') !== 'false'; }
    set reveal(v) { if (v) this.setAttribute('reveal', ''); else this.removeAttribute('reveal'); }
    // the training log (with the train attribute): [{key, t, w, h, view, strokes, types, latex, symbols, fixed, answered, confidence}]
    get training() { return this.pad ? this.pad.training : []; }
    get train() { return this.pad ? !!this.pad.o.train : this.hasAttribute('train') && this.getAttribute('train') !== 'false'; }
    set train(v) { if (v) this.setAttribute('train', ''); else this.removeAttribute('train'); }
    // fields copied into every training record made while it is set ({expect, drill, item, how}), or null
    get trainMeta() { return this.pad ? this.pad.trainMeta : (this._meta || null); }
    set trainMeta(v) { const m = v && typeof v === 'object' ? Object.assign({}, v) : null; this._meta = m; if (this.pad) this.pad.trainMeta = m; }
    trainVerify(key, verified) { return this.pad ? this.pad.trainVerify(key, verified) : null; }
    strokeInfo(s) { return this.pad ? this.pad.strokeInfo(s) : { type: null, width: null }; }
    get mode() { return this.pad ? this.pad.mode : 'draw'; }
    set mode(v) { if (this.pad) this.pad.mode = v === 'erase' ? 'erase' : 'draw'; }
    recognize() { return this.pad && this.pad.recognize(); }
    relabel(sym, label) { return this.pad && this.pad.relabel(sym, label); }
    undo() { if (this.pad) this.pad.undo(); }
    redo() { if (this.pad) this.pad.redo(); }
    clear() { if (this.pad) this.pad.clear(); }
  }
  customElements.define('nib-pad', NibPad);
}
