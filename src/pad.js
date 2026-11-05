// ================================================================== writing pad
const PAD_DEFAULTS = {
  ink: null,            // stroke colour; default: the element's CSS --nib-ink, else its text colour
  width: 3,             // stroke width in CSS px
  auto: true,           // recognise automatically after the pen rests
  delay: 450,           // ms of rest before recognising
  penOnly: false,       // ignore touch and mouse (stylus-only boards)
  boxes: false,         // draw recognised symbol boxes over the ink
  smooth: 0,            // smooth shaky ink along its path before reading (sigma as a share of the writing size)
  view: 'ink',          // how read ink is shown: 'ink' as written, 'tidy', 'hand' (the writer's Replicator handwriting), 'typeset'
  motion: true,         // animate ink into its tidy / handwritten / typeset form (off when the reader asks for less motion)
  hand: null,           // handwriting for view 'hand' (the Replicator's saved data); default: whatever Nib.hand holds
  separate: false,      // a board: writing in different places is read as separate expressions
  solve: false,         // work out lines that end with "=" and write the answer after the "=" (in --nib-answer)
  times: true,          // × can be a times sign; false: every cross is the letter x (multiply with · or brackets)
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
    this.active = null; this.sawPen = false; this.timer = null; this.gen = 0;
    this.plan = null; this.anim = null; this.sid = new WeakMap(); this.nsid = 1;
    this.parts = new Map(); this.recs = new WeakMap(); this.optsVersion = 0;
    this._handChanged = () => { if (this.o.view === 'hand' || this.o.solve) this._replan(true); };
    this.answers = [];
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
    const before = this.o.view, hb = this.o.hand, sb = !!this.o.solve, rk = this._readKey();
    Object.assign(this.o, o || {});
    if (!['ink', 'tidy', 'hand', 'typeset'].includes(this.o.view)) this.o.view = 'ink';
    // only options that change the reading read the ink again; a view, colour or pen width just redraws
    const reread = this._readKey() !== rk;
    if (reread) { this.optsVersion++; this.parts.clear(); }
    if (this.o.view !== before || this.o.hand !== hb || !!this.o.solve !== sb) this._replan(true); else this.redraw();
    if (this.strokes.length && this.o.auto && (reread || (this.resultStrokes || []).length !== this.strokes.length)) this._schedule(0);
  }
  _readKey() {
    const skip = new Set(['view', 'motion', 'hand', 'ink', 'width', 'boxes', 'penOnly', 'delay', 'auto', 'solve', 'onResult', 'onChange']);
    return JSON.stringify(Object.keys(this.o).filter(k => !skip.has(k) && typeof this.o[k] !== 'function').sort().map(k => [k, this.o[k]]));
  }

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
    if (this.plan && this.plan.items.some(it => it.answer)) { this.redraw(); return; }   // writing over an answer hides it
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
    if (e.type === 'pointercancel' && this.cur && this.cur.length < 3) { this.cur = null; this.redraw(); return; } // a cancelled tap
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
    // in a tidy, handwritten or typeset view the eraser takes away what it touches as shown
    if (this.plan) {
      const live = new Set(this.strokes);
      for (const it of this.plan.items) {
        if (!it.from.every(s => live.has(s)) || !itemNear(it, p, r)) continue;
        for (const s of it.from) { const i = this.strokes.indexOf(s); if (i >= 0) { this.erased.push({ i, s }); this.strokes.splice(i, 1); live.delete(s); } }
      }
    }
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
    this._ink();
    const ink = ctx.strokeStyle, live = new Set(this.strokes), shown = new Set();
    const A = this.anim, e = A ? A.e : 1;
    let ans = null, fresh = null;
    const answerSetup = () => {
      if (ans) return;
      ans = this._answerInk();
      const read = new Set(this.resultStrokes || []);
      fresh = this.strokes.filter(s => !read.has(s)).concat(this.cur ? [this.cur] : []).map(s => sbox(s.map(q => [q[0], q[1]])));
    };
    // the read ink in its view; strokes still moving into it are drawn by the animation
    if (this.plan) for (const it of this.plan.items) {
      if (it.answer) {
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
      if (g.answer) { answerSetup(); if (this._answerShown(g, live, fresh)) drawItems(ctx, [g], { ink: ans, width: this.o.width, alpha: 1 - e }); continue; }
      if (!g.from.every(s => live.has(s))) continue;
      const raw = rawVisual(g.from.filter(s => !shown.has(s)));
      if (raw.parts[0].paths.length) { morphDraw(ctx, g, raw, e, ink, this.o.width); for (const s of g.from) shown.add(s); }
    }
    this._ink();
    for (const s of this.strokes) if (!shown.has(s)) this._stroke(s);
    if (this.cur) this._stroke(this.cur);
    if (this.o.boxes && this.result) this._boxes();
  }
  // Lays the latest reading out in the pad's view and starts the animation from what was on screen.
  _replan(animate) {
    const old = this.plan, style = this.o.view;
    const res = this.result, at = this.resultStrokes || [];
    let plan = null;
    this.answers = [];
    if (res && res.tree && res.tree.length && at.length && (style !== 'ink' || this.o.solve)) {
      const items = [];
      let li = 0, sample = null;
      if (this.o.solve) {
        // an answer is written with the clearest of each symbol anywhere on the board, then the Replicator hand
        let hand = null;
        try { hand = this.o.hand ? handClean(this.o.hand.glyphs || this.o.hand) : handLoad(); } catch (err) { hand = null; }
        sample = sampleBook(res, at, hand && Object.keys(hand).length ? hand : null);
      }
      const R = refSize(at), done = [];
      for (const part of res.parts || [{ strokes: at, result: res }]) {
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
        if (answers) answers.forEach((a, k) => { if (a) this.answers.push({ line: li + k, latex: a.latex, text: a.text, kind: a.kind, exact: a.exact, value: a.value }); });
        li += pr.tree.length;
        if (style === 'ink' && !(answers && answers.some(Boolean))) continue;
        let out = null;
        try { out = inPlace(part.strokes, style, { result: pr, hand: this.o.hand || undefined, answers: answers ? answers.map(a => a && a.nodes) : null, sample }); } catch (err) { out = null; }
        if (!out) continue;
        const groups = new Map();
        for (const it of out.items) {
          if (it.answer) {
            it.from = []; it.eqFrom = (it.eq || []).map(i => part.strokes[i]).filter(Boolean);
            if (!it.eqFrom.length) continue;
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
      plan = { style, items };
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
        if (was) { from.set(it, was); used.add(was); } else from.set(it, { parts: [], box: it.box });
        continue;
      }
      const was = before.get(it.id) || (old && old.items.find(o => !o.answer && o.from.length === it.from.length && o.from.every(s => it.from.includes(s))));
      if (was) { from.set(it, was); used.add(was); }
      else from.set(it, rawVisual(it.from));
    }
    const leaving = old ? old.items.filter(o => !used.has(o)) : [];
    if (!from.size && !leaving.length) { this.anim = null; this.redraw(); return; }
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
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.dpr = d;
    this.redraw();
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
    // [[x, y, t?], ...] or {x, y, t?} points, or {points} strokes; anything that is not a point is dropped
    const pt = p => (Array.isArray(p) ? [+p[0], +p[1], +p[2] || 0] : p && typeof p === 'object' ? [+p.x, +p.y, +p.t || 0] : null);
    this.strokes = (Array.isArray(strokes) ? strokes : [])
      .map(s => (Array.isArray(s) ? s : s && Array.isArray(s.points) ? s.points : []).map(pt).filter(p => p && isFinite(p[0]) && isFinite(p[1])))
      .filter(s => s.length);
    this.history = []; this.future = []; this.fixes = []; this._changed();
    if (this.strokes.length && this.o.auto) this._schedule(0);   // no need to wait for a pen to rest
  }
  destroy() {
    clearTimeout(this.timer); this.gen++; this.anim = null;
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
    static get observedAttributes() { return ['symbols', 'ink', 'stroke-width', 'delay', 'auto', 'boxes', 'pen-only', 'lines', 'degrees', 'smooth', 'view', 'motion', 'separate', 'solve', 'times']; }
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
        smooth: has('smooth') && +a('smooth') > 0 ? +a('smooth') : 0,
        view: ['tidy', 'hand', 'typeset'].includes(a('view')) ? a('view') : 'ink',
        motion: a('motion') !== 'false',
        separate: has('separate') && a('separate') !== 'false',
        solve: has('solve') && a('solve') !== 'false',
        times: a('times') !== 'false',
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
    // what the view shows: [{label, box, parts}] in the pad's coordinates (parts as drawn: ink paths, text, rules)
    get shown() { return this.pad && this.pad.plan ? this.pad.plan.items.map(it => Object.assign({ label: it.label, box: it.box.slice(), parts: it.parts }, it.answer ? { answer: true } : {})) : []; }
    // with solve on: [{line, latex, text, kind, exact, value}] for each line that ends with "=", and the LaTeX with them in
    get solve() { return this.pad ? !!this.pad.o.solve : this.hasAttribute('solve') && this.getAttribute('solve') !== 'false'; }
    set solve(v) { if (v) this.setAttribute('solve', ''); else this.removeAttribute('solve'); }
    get answers() { return this.pad ? this.pad.answers.map(a => Object.assign({}, a)) : []; }
    get solved() { return this.pad ? this.pad.solvedLatex() : ''; }
    toImage(type) { return this.pad ? this.pad.canvas.toDataURL(type || 'image/png') : ''; }
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
