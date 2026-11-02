// ================================================================== writing pad
const PAD_DEFAULTS = {
  ink: null,            // stroke colour; default: the element's CSS --nib-ink, else its text colour
  width: 3,             // stroke width in CSS px
  auto: true,           // recognise automatically after the pen rests
  delay: 450,           // ms of rest before recognising
  penOnly: false,       // ignore touch and mouse (stylus-only boards)
  boxes: false,         // draw recognised symbol boxes over the ink
  symbols: 'school', lines: true, degrees: true,
  onResult: null,       // (result, pad) => void
  onChange: null,       // (pad) => void, after every stroke / undo / clear
};

class Pad {
  constructor(el, options) {
    this.el = el;
    this.o = Object.assign({}, PAD_DEFAULTS, options || {});
    this.strokes = [];
    this.history = []; this.future = [];
    this.fixes = [];
    this.result = null;
    this.rec = new Recognizer();
    this.mode = 'draw';
    const c = this.canvas = document.createElement('canvas');
    c.setAttribute('part', 'canvas');
    c.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;user-select:none;-webkit-user-select:none;';
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(c);
    this.ctx = c.getContext('2d');
    this.active = null; this.sawPen = false; this.timer = null; this.gen = 0;
    this._down = this._down.bind(this); this._move = this._move.bind(this); this._up = this._up.bind(this);
    c.addEventListener('pointerdown', this._down);
    c.addEventListener('pointermove', this._move);
    c.addEventListener('pointerup', this._up);
    c.addEventListener('pointercancel', this._up);
    c.addEventListener('contextmenu', e => e.preventDefault());
    this._theme = () => this.redraw();
    try { this.mq = matchMedia('(prefers-color-scheme: dark)'); this.mq.addEventListener('change', this._theme); } catch (e) { this.mq = null; }
    this.mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(this._theme) : null;
    if (this.mo) this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this._resize()) : null;
    if (this.ro) this.ro.observe(c); else window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  setOptions(o) { Object.assign(this.o, o || {}); this.redraw(); if (this.strokes.length) this._schedule(0); }

  // ---------------------------------------------------------------- input
  _pt(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, Math.round(e.timeStamp)]; }
  _down(e) {
    if (this.active !== null) return;
    if (e.pointerType === 'pen') this.sawPen = true;
    if ((this.o.penOnly || this.sawPen) && e.pointerType === 'touch') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.active = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
    clearTimeout(this.timer); this.gen++;
    if (this.mode === 'erase') { this.erased = []; this._eraseAt(this._pt(e)); return; }
    this.cur = [this._pt(e)];
    this._ink();
    const p = this.cur[0];
    this.ctx.beginPath(); this.ctx.arc(p[0], p[1], this.o.width / 2, 0, Math.PI * 2); this.ctx.fill();
  }
  _move(e) {
    if (e.pointerId !== this.active) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = this._pt(ev);
      if (this.mode === 'erase') { this._eraseAt(p); continue; }
      const q = this.cur[this.cur.length - 1];
      if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) < 0.75) continue;
      this.cur.push(p);
      this._seg(this.cur);
    }
  }
  _up(e) {
    if (e.pointerId !== this.active) return;
    this.active = null;
    if (this.mode === 'erase') {
      if (this.erased.length) { this.history.push({ erase: this.erased }); this.future = []; this._changed(); }
      return;
    }
    const s = this.cur; this.cur = null;
    if (!s || !s.length) return;
    this.strokes.push(s);
    this.history.push({ add: s }); this.future = [];
    this._changed();
  }
  _eraseAt(p) {
    const r = Math.max(10, this.o.width * 4);
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      if (this.strokes[i].some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < r)) {
        this.erased.push({ i, s: this.strokes[i] });
        this.strokes.splice(i, 1);
        this.redraw();
      }
    }
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
  redraw() {
    const c = this.canvas, ctx = this.ctx, d = this.dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.setTransform(d, 0, 0, d, 0, 0);
    this._ink();
    for (const s of this.strokes) this._stroke(s);
    if (this.cur) this._stroke(this.cur);
    if (this.o.boxes && this.result) this._boxes();
  }
  _boxes() {
    const ctx = this.ctx, cs = getComputedStyle(this.el);
    const col = cs.getPropertyValue('--nib-box').trim() || 'rgba(201,162,39,.85)';
    ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'bottom';
    for (const s of this.result.symbols) {
      const b = s.box; ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6); ctx.fillText(s.label, b.x - 3, b.y - 4);
    }
    ctx.restore();
  }
  _resize() {
    const c = this.canvas, r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.dpr = d;
    this.redraw();
  }

  // ---------------------------------------------------------------- state
  _changed() {
    this.redraw();
    if (this.o.onChange) this.o.onChange(this);
    this.el.dispatchEvent(new CustomEvent('nib:change', { detail: this, bubbles: true }));
    if (!this.strokes.length) { this._emit(null); return; }
    if (this.o.auto) this._schedule(this.o.delay);
  }
  // Read the ink without freezing the page: classify the new stroke groups a few milliseconds at a time,
  // then run the (cheap) final pass. New ink cancels a read in progress.
  _schedule(ms) {
    clearTimeout(this.timer);
    const gen = ++this.gen;
    this.timer = setTimeout(() => {
      const it = this.rec.warmup(this.strokes, this.o), start = performance.now();
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
    if (this.o.boxes) this.redraw();
    if (this.o.onResult) this.o.onResult(res, this);
    this.el.dispatchEvent(new CustomEvent('nib:result', { detail: res, bubbles: true }));
  }
  recognize(start) {
    clearTimeout(this.timer); this.gen++;
    if (!this.strokes.length) { this._emit(null); return null; }
    const fix = this.fixes.map(f => ({ strokes: f.strokes.map(s => this.strokes.indexOf(s)), label: f.label }))
      .filter(f => f.strokes.every(i => i >= 0));
    const res = this.rec.recognize(this.strokes, Object.assign({}, this.o, { fix }));
    if (typeof start === 'number') res.ms = Math.round(performance.now() - start); // the whole read, not just its last pass
    this._emit(res);
    return res;
  }
  // re-label one recognised symbol (from result.symbols[i].candidates) and re-run
  relabel(symbol, label) {
    const ss = symbol.strokes.map(i => this.strokes[i]);
    this.fixes = this.fixes.filter(f => !f.strokes.some(s => ss.includes(s)));
    this.fixes.push({ strokes: ss, label });
    // remember the shape so the same writer's next one reads right (stays in this browser)
    if (this.o.learn !== false && this.o.memory !== false) {
      try { memLearn(classifyGroup(normStrokes(ss).strokes, refSize(normStrokes(this.strokes).strokes)).hidden, label); } catch (e) { /* ok */ }
    }
    return this.recognize();
  }
  undo() {
    const h = this.history.pop(); if (!h) return;
    if (h.add) { const i = this.strokes.lastIndexOf(h.add); if (i >= 0) this.strokes.splice(i, 1); }
    else for (const e of h.erase.slice().reverse()) this.strokes.splice(e.i, 0, e.s);
    this.future.push(h); this._changed();
  }
  redo() {
    const h = this.future.pop(); if (!h) return;
    if (h.add) this.strokes.push(h.add);
    else for (const e of h.erase) { const i = this.strokes.indexOf(e.s); if (i >= 0) this.strokes.splice(i, 1); }
    this.history.push(h); this._changed();
  }
  clear() {
    if (!this.strokes.length) return;
    this.history.push({ erase: this.strokes.map((s, i) => ({ i, s })).reverse() }); this.future = [];
    this.strokes = []; this.fixes = []; this._changed();
  }
  get canUndo() { return this.history.length > 0; }
  get canRedo() { return this.future.length > 0; }
  getStrokes() { return this.strokes.map(s => s.map(p => p.slice())); }
  setStrokes(strokes) {
    this.strokes = (strokes || []).map(s => s.map(p => Array.isArray(p) ? p.slice() : [p.x, p.y, p.t || 0]));
    this.history = []; this.future = []; this.fixes = []; this._changed();
    if (this.strokes.length && this.o.auto) this._schedule(0);   // no need to wait for a pen to rest
  }
  destroy() {
    clearTimeout(this.timer); this.gen++;
    if (this.ro) this.ro.disconnect();
    if (this.mo) this.mo.disconnect();
    if (this.mq) this.mq.removeEventListener('change', this._theme);
    this.canvas.remove();
  }
}

// <nib-pad symbols="school" delay="450" ink="#1b2a4a" stroke-width="3" boxes></nib-pad>
if (typeof customElements !== 'undefined' && typeof HTMLElement !== 'undefined' && !customElements.get('nib-pad')) {
  class NibPad extends HTMLElement {
    static get observedAttributes() { return ['symbols', 'ink', 'stroke-width', 'delay', 'auto', 'boxes', 'pen-only', 'lines', 'degrees']; }
    _opts() {
      const a = n => this.getAttribute(n), has = n => this.hasAttribute(n);
      const sym = a('symbols');
      return {
        symbols: sym ? (sym.includes(',') ? sym.split(',').map(x => x.trim()) : sym) : 'school',
        ink: a('ink') || null,
        width: has('stroke-width') ? +a('stroke-width') : 3,
        delay: has('delay') ? +a('delay') : 450,
        auto: a('auto') !== 'false',
        boxes: has('boxes'),
        penOnly: has('pen-only'),
        lines: a('lines') !== 'false',
        degrees: a('degrees') !== 'false',
      };
    }
    connectedCallback() {
      if (this.pad) return;
      if (!this.style.display) this.style.display = 'block';
      if (this.getBoundingClientRect().height < 4 && !this.style.height) this.style.height = '220px';
      this.pad = new Pad(this, Object.assign(this._opts(), {
        onResult: r => this.dispatchEvent(new CustomEvent('change', { detail: r, bubbles: true })),
      }));
    }
    attributeChangedCallback() { if (this.pad) this.pad.setOptions(this._opts()); }
    get result() { return this.pad ? this.pad.result : null; }
    get latex() { return this.pad && this.pad.result ? this.pad.result.latex : ''; }
    get text() { return this.pad && this.pad.result ? this.pad.result.text : ''; }
    get strokes() { return this.pad ? this.pad.getStrokes() : []; }
    set strokes(v) { if (this.pad) this.pad.setStrokes(v); }
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
