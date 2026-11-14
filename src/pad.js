// ================================================================== writing pad
const PAD_DEFAULTS = {
  ink: null,            // stroke color; default: the element's CSS --nib-ink, else its text color
  width: 3,             // stroke width in CSS px
  auto: true,           // recognize automatically after the pen rests
  delay: 450,           // ms of rest before recognizing
  settle: 0,            // ms of rest before read ink changes into its tidy / handwritten / typeset form (the answers do not wait)
  penOnly: false,       // ignore touch and mouse (stylus-only boards)
  boxes: false,         // draw recognized symbol boxes over the ink
  smooth: 0,            // smooth shaky ink along its path before reading (sigma as a share of the writing size)
  view: 'ink',          // how read ink is shown: 'ink' as written, 'tidy', 'hand' (the writer's Replicator handwriting), 'typeset'
  motion: true,         // animate ink into its tidy / handwritten / typeset form (off when the reader asks for less motion)
  hand: null,           // handwriting for view 'hand' (the Replicator's saved data); default: whatever Nib.hand holds
  separate: false,      // a board: writing in different places is read as separate expressions
  solve: false,         // work out lines that end with "=" and write the answer after the "=" (in --nib-answer)
  reveal: false,        // with solve: each answer is drawn blurred (its length shows, not what it says) until it is tapped
  fit: false,           // when the pad is resized and the ink no longer fits, shrink and move it in (undoable)
  times: true,          // × can be a times sign; false: every cross is the letter x (multiply with · or brackets)
  train: false,         // keep each piece of writing read (strokes, reading, corrections) in pad.training, for fine-tuning
  // a canvas (the Board): an endless surface that pans and zooms, with pens, markers, highlighters, shapes, text and
  // pictures (see "canvas" below); off, the pad is the plain writing box other tools embed
  infinite: false,      // pan and zoom (wheel, ctrl+wheel or a trackpad pinch, two fingers, the hand tool, space + drag)
  paper: null,          // {kind, tone}: the background drawn under everything (drawPaper), or null for none
  fingers: 'write',     // with infinite: 'write' (a finger writes), 'pan' (a finger moves the board: the pen writes) or 'ignore'
  pinch: true,          // with infinite: two fingers put down together pan and zoom (a second student's finger far away still writes)
  pressure: true,       // a pen's line follows its pressure (when the pen reports one)
  palm: true,           // the hand's rules: a touch 28 px or more across is a palm and never draws, touch waits for a
                        // second after the pen, a brief touch just before the pen is the hand, a finger's tap beside the
                        // pen the heel of it. false: none of them, every touch writes (a panel that reports fingers that
                        // wide — an IR frame may — or a stylus as a pen; a tool that never rejected palms)
  single: false,        // one pointer writes at a time: another put down while one is writing is ignored (a pen still
                        // takes over from a touch)
  eraser: 'stroke',     // 'stroke': the eraser takes whole strokes; 'area': it rubs out only where it passes
  snap: 0,              // shapes snap to a grid of this spacing (world units; 0: no snapping)
  hold: true,           // draw a line, circle, rectangle or triangle and hold the pen still: it becomes that shape
  read: true,           // Nib reads the pen and marker writing (false: a plain whiteboard)
  scribble: true,       // a pen or marker scribbled back and forth over writing rubs it out (scribble.js), as one step
                        // of Undo; over nothing it is ink like any other stroke
  // embedding (another tool's drawing surface over or under the pad)
  page: null,           // [W, H]: a fixed page of W × H world units, always shown whole and centred; nothing pans or zooms it
  layer: null,          // 'answers': draw only the answers (the strokes are the host's own, given with syncStrokes)
  symbols: 'school', lines: true, degrees: true,
  onResult: null,       // (result, pad) => void
  onChange: null,       // (pad) => void, after every stroke / undo / clear
};

// Writing in different places on a board: strokes near each other belong together — neighbors on a line (within
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
// Pieces of writing that belong together but were left apart by the spaces between them. A line of working that only
// asks ("x =", "y <") under a piece is joined to that piece (an equation, or two of them), however far the writer
// dropped it (within 2.5 line heights). Pieces of one line left apart by the spaces in it: a piece whose reading ends in + − · × ÷ < > ≤ ≥ ≠ ±
// (not =: "7 − 1 =" is whole, and the problem beside it is another) is joined to the piece to its right on the same
// row; a piece whose reading begins with an operator (= included) is joined to the piece to its left. Within 2.5
// writing heights across, sharing half the smaller height. Returns the new groups (in the order of the pieces) or
// null when there is nothing to join.
const ASKS = /^\s*[a-zA-Z]\s*(?:=|<|>|\\(?:le|ge|ne|leq|geq|neq)(?![a-zA-Z]))\s*$/;
const OP_END = /(?:\\(?:cdot|times|div|le|ge|ne|pm|leq|geq|neq)|[+\-<>·×÷])\s*$/, OP_START = /^\s*(?:\\(?:cdot|times|div|le|ge|ne|pm|leq|geq|neq)(?![a-zA-Z])|[+<>=·×÷])/;
function joinOperands(parts) {
  if (parts.length < 2) return null;
  const P = parts.map(p => {
    const r = p.result, lines = r && r.lines ? r.lines : [];
    const last = lines.length ? lines[lines.length - 1].latex : '', first = lines.length ? lines[0].latex : '';
    return { box: p.strokes.map(sbox).reduce(ubox), n: Math.max(lines.length, 1), ends: lines.length === 1 && OP_END.test(last), begins: lines.length === 1 && OP_START.test(first) && !/^\s*-/.test(first),
      asks: lines.length === 1 && ASKS.test(first) };
  });
  const h = b => Math.max(b[3] - b[1], 1), order = P.map((_, i) => i).sort((a, b) => P[a].box[0] - P[b].box[0]);
  // "x =" (a letter and a relation, nothing after) under a piece of writing asks about it: joined to the nearest piece
  // above it (within 2.5 line heights, overlapping it or within a height to the side), however the two were spaced
  for (let i = 0; i < P.length; i++) {
    const A = P[i];
    if (!A.asks) continue;
    let best = -1, gap = Infinity;
    for (let j = 0; j < P.length; j++) {
      if (j === i) continue;
      const B = P[j], lh = h(B.box) / B.n, gy = A.box[1] - B.box[3];
      if (gy < -0.3 * Math.min(h(A.box), lh)) continue;                                      // not above it
      const side = Math.max(0, B.box[0] - A.box[2], A.box[0] - B.box[2]);
      if (side > Math.max(h(A.box), lh) || gy > 2.5 * Math.max(h(A.box), lh)) continue;
      if (gy < gap) { gap = gy; best = j; }
    }
    if (best < 0) continue;
    const merged = parts[best].idx.concat(parts[i].idx).sort((a, b) => a - b);
    return parts.map((p, q) => (q === best ? merged : q === i ? null : p.idx)).filter(Boolean);
  }
  for (let k = 0; k < order.length; k++) {
    const i = order[k], A = P[i];
    // the nearest piece to the right on A's row
    let best = -1, gap = Infinity;
    for (let m = 0; m < order.length; m++) {
      const j = order[m]; if (j === i) continue;
      const B = P[j];
      const gx = B.box[0] - A.box[2], ov = Math.min(A.box[3], B.box[3]) - Math.max(A.box[1], B.box[1]);
      if (gx < -0.2 * h(A.box) || ov < 0.5 * Math.min(h(A.box), h(B.box))) continue;
      if (gx < gap) { gap = gx; best = j; }
    }
    if (best < 0) continue;
    const B = P[best], H = Math.max(h(A.box), h(B.box));
    if (gap > 2.5 * H || !(A.ends || B.begins)) continue;
    const merged = parts[i].idx.concat(parts[best].idx).sort((a, b) => a - b);
    return parts.map((p, q) => (q === i ? merged : q === best ? null : p.idx)).filter(Boolean);
  }
  return null;
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
  parts.forEach((p, k) => {
    const r = p.result, m = i => p.idx[i];
    if (!r || !r.lines.length) return;
    lines.push(...r.lines); tree.push(...r.tree.map(row => remap(row, m)));
    symbols.push(...r.symbols.map(sy => Object.assign({}, sy, { strokes: sy.strokes.map(m), part: k })));   // part: its index in parts
    conf = Math.min(conf, r.confidence); ms += r.ms || 0;
  });
  return {
    latex: lines.length > 1 ? '\\begin{gathered}' + lines.map(l => l.latex).join(' \\\\ ') + '\\end{gathered}' : lines.length ? lines[0].latex : '',
    text: lines.map(l => l.text).join('\n'), lines, symbols, tree, confidence: lines.length ? conf : 0, skew: 0, ms, parts,
  };
}

// ================================================================== canvas: colors, elements
// Colors are named so they can read on any paper: '@red' is a deep red on cream or white paper and a lighter one on a
// chalkboard or a dark board. A plain CSS color is used as it is. null is the paper's own ink (navy, or cream on dark).
const PAD_COLORS = {
  '@ink': [null, null], '@black': ['#16181d', '#f5f3ee'], '@red': ['#d1352b', '#ff7d6e'], '@blue': ['#1f5fbf', '#7fb0ff'],
  '@green': ['#1d8a4b', '#6fd49c'], '@orange': ['#e0750f', '#ffb15c'], '@purple': ['#7a3db4', '#c79dff'],
  '@gold': ['#a37c12', '#e8c35a'], '@pink': ['#d23f7e', '#ff90c0'], '@brown': ['#8a5a2b', '#d9a774'], '@gray': ['#6b7280', '#b6bcc8'],
  // highlighters: the same on any paper (they are see-through)
  '@hl-yellow': ['#ffe14d', '#ffe14d'], '@hl-green': ['#7ee08a', '#7ee08a'], '@hl-pink': ['#ff8ccf', '#ff8ccf'],
  '@hl-blue': ['#7cc8ff', '#7cc8ff'], '@hl-orange': ['#ffb347', '#ffb347'],
};
function padColor(c, dark, ink) {
  if (!c || c === '@ink') return ink;
  const k = PAD_COLORS[c];
  return k ? (k[dark ? 1 : 0] || ink) : c;
}
// a shape's fill: 'tint' (its own color, see-through), 'solid' (its own color), '@red:0.25' (a named color at that
// opacity) or a CSS color
function padFill(f, dark, col) {
  if (!f || f === 'none') return null;
  if (f === 'tint' || f === 'solid') return padAlpha(col, f === 'tint' ? (dark ? 0.28 : 0.18) : 1);
  const m = /^(@[a-z-]+):([\d.]+)$/.exec(f);
  if (m) return padAlpha(padColor(m[1], dark, col), +m[2]);
  return padColor(f, dark, col);
}
// a #rgb / #rrggbb color at an opacity
function padAlpha(c, a) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
  if (!m || a >= 1) return c;
  const h = m[1].length === 3 ? m[1].replace(/./g, ch => ch + ch) : m[1];
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
// how light a CSS color is (0 black … 1 white); unknown colors count as light
function padLum(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color || '').trim());
  let r, g, b;
  if (m) { const h = m[1].length === 3 ? m[1].replace(/./g, ch => ch + ch) : m[1]; r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16); }
  else { const n = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(String(color || '')); if (!n) return 1; r = +n[1]; g = +n[2]; b = +n[3]; }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
const PAD_ZMIN = 0.1, PAD_ZMAX = 8;
// Does this browser's canvas blur (ctx.filter)? Without it a hidden answer is smeared instead: never drawn sharp.
let PAD_BLUR = null;
let PAD_BLUR_EM = 0.12;      // how far out of focus a hidden answer is: its blur, as a share of the writing's em
function padBlurOK() {
  if (PAD_BLUR !== null) return PAD_BLUR;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 9;
    const g = c.getContext('2d'); g.filter = 'blur(2px)'; g.fillStyle = '#000'; g.fillRect(4, 4, 1, 1);
    PAD_BLUR = g.getImageData(1, 4, 1, 1).data[3] > 0;
  } catch (e) { PAD_BLUR = false; }
  return PAD_BLUR;
}
function padSnap(p, spacing) { return spacing > 0 && typeof shapeSnap === 'function' ? shapeSnap(p, spacing) : p; }
const PAD_FONT = '"DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
// is world point p inside polygon poly ([[x, y], ...])?
function padInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) inside = !inside;
  }
  return inside;
}
// the parts of a stroke outside a circle (the area eraser): runs of points, cut where they cross it
function padCut(s, c, r) {
  const out = [], r2 = r * r, outside = q => (q[0] - c[0]) * (q[0] - c[0]) + (q[1] - c[1]) * (q[1] - c[1]) > r2;
  let run = [];
  const edge = (a, b) => {            // where segment a→b crosses the circle (a inside, b outside or the other way)
    const dx = b[0] - a[0], dy = b[1] - a[1], fx = a[0] - c[0], fy = a[1] - c[1];
    const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r2;
    const disc = Math.max(0, B * B - 4 * A * C), sq = Math.sqrt(disc);
    let t = A ? (-B - sq) / (2 * A) : 0;
    if (t < 0 || t > 1) t = A ? (-B + sq) / (2 * A) : 0;
    t = Math.max(0, Math.min(1, t));
    const q = a.slice(); q[0] = a[0] + dx * t; q[1] = a[1] + dy * t;
    if (a.length > 3 && b.length > 3) q[3] = a[3] + (b[3] - a[3]) * t;
    return q;
  };
  for (let i = 0; i < s.length; i++) {
    const q = s[i], o = outside(q), prev = s[i - 1];
    if (o) {
      if (prev && !outside(prev)) run.push(edge(prev, q));
      run.push(q);
    } else if (run.length) {
      if (prev) run.push(edge(prev, q));
      out.push(run); run = [];
    }
  }
  if (run.length) out.push(run);
  return out.filter(p => p.length > 1 || s.length === 1);
}

class Pad {
  constructor(el, options) {
    this.el = el;
    this.o = Object.assign({}, PAD_DEFAULTS, options || {});
    if (this.o.page) this.o.infinite = true;             // a page is a world under a camera the pad keeps itself
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
    this.penSeen = -1e9;            // when the pen was last heard from (a pen session: within 30 s)
    this.pending = [];              // brief touch strokes waiting 1.5 s to see whether the pen follows (a hand brushing the board)
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
    // the canvas (see "canvas" below)
    this.cam = { x: 0, y: 0, z: 1 };                         // world point (x, y) is at the canvas's top-left; z: zoom
    this.tool = { kind: 'pen', color: null, size: null };    // what draw mode writes with: 'pen' | 'marker' | 'highlighter'
    this.shapeTool = { kind: 'rect', color: null, size: 3, fill: null, dash: false };
    this.textTool = { color: null, size: 32 };
    this.images = new Map();        // image id -> {src, img, ok}: the pictures on any page
    this.selection = new Set();     // elements selected (select mode)
    this.lasers = [];               // laser trails fading out
    this._bb = new WeakMap(); this._paths = new WeakMap();   // per element: its bounds, its drawing (dropped when it changes)
    this._bbz = new WeakMap();      // the zoom a number line's or a plane's bounds were worked out for
    this._looks = new Map();        // an answer (its line, its value, the view) → {sids, answer, view, hand, glyphs: label →
                                    // {pts, src}}: the symbols it was first drawn with, kept (_replan's sampleFor; saved)
    this._lifted = new WeakMap();   // a pen or marker stroke → when it went down and up, by what, in what pen (a scribble
                                    // broken in two is put back together: _scribbleJoin)
    this.touches = new Map();       // touch pointerId -> {x, y, t} on screen: for two-finger gestures
    this.gesture = null;            // a pan or pinch under way
    this.spacePan = false;          // the space bar is down: a drag pans
    this.lassoOnly = false;         // select mode from the lasso tool: a drag always draws a lasso, wherever it starts
    this.editing = null;            // the text box being written in
    if (typeof window !== 'undefined') window.addEventListener('nib:hand', this._handChanged);
    this._down = this._down.bind(this); this._move = this._move.bind(this); this._up = this._up.bind(this);
    c.addEventListener('pointerdown', this._down);
    c.addEventListener('pointermove', this._move);
    c.addEventListener('pointerup', this._up);
    c.addEventListener('pointercancel', this._up);
    c.addEventListener('lostpointercapture', this._up);     // capture lost without a pointerup: finish the stroke
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => this._wheel(e), { passive: false });
    c.addEventListener('dblclick', e => this._dbl(e));
    this._theme = () => this.redraw();
    this._fonts = () => { if (this.canvas.isConnected) { this._bb = new WeakMap(); this._paths = new WeakMap(); this.redraw(); } };
    try { if (document.fonts) { document.fonts.ready.then(this._fonts); document.fonts.addEventListener('loadingdone', this._fonts); } } catch (e) { /* no font events */ }
    try { this.mq = matchMedia('(prefers-color-scheme: dark)'); this.mq.addEventListener('change', this._theme); } catch (e) { this.mq = null; }
    this.mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(this._theme) : null;
    if (this.mo) this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    // no ResizeObserver, or one that refuses (a host page can break it): the window's resize does instead
    try { this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this._resize()) : null; } catch (e) { this.ro = null; }
    if (this.ro) this.ro.observe(c); else window.addEventListener('resize', () => this._resize());
    this._resize();
  }

  setOptions(o) {
    const before = this.o.view, hb = this.o.hand, sb = !!this.o.solve, rb = !!this.o.reveal, rk = this._readKey(), tb = !!this.o.train;
    const pageB = JSON.stringify(this.o.page);
    Object.assign(this.o, o || {});
    if (this.o.page) this.o.infinite = true;
    if (JSON.stringify(this.o.page) !== pageB && this.o.page && this._pageCam()) this._camMoved(true);
    if (!!this.o.train !== tb) { if (this.o.train) this._trainSee(); else { clearTimeout(this._trainTimer); this._trainTimer = null; this._seen.clear(); } }
    if (!['ink', 'tidy', 'hand', 'typeset'].includes(this.o.view)) this.o.view = 'ink';
    // only options that change the reading read the ink again; a view, color or pen width just redraws
    const reread = this._readKey() !== rk;
    if (reread) { this.optsVersion++; this.parts.clear(); }
    if (!this.o.infinite && (this.cam.x || this.cam.y || this.cam.z !== 1)) this.cam = { x: 0, y: 0, z: 1 };
    if (this.o.view !== before || this.o.hand !== hb || !!this.o.solve !== sb || !!this.o.reveal !== rb) this._replan(true); else this.redraw();
    const ink = this.ink;
    if (reread && !ink.length && this.result) { this._emit(null); return; }   // reading turned off, or nothing left to read
    if (ink.length && this.o.auto && (reread || (this.resultStrokes || []).length !== ink.length)) this._schedule(0);
  }
  _readKey() {
    const skip = new Set(['view', 'motion', 'hand', 'ink', 'width', 'boxes', 'penOnly', 'delay', 'settle', 'auto', 'solve', 'reveal', 'fit', 'train', 'onResult', 'onChange',
      'infinite', 'paper', 'fingers', 'pinch', 'pressure', 'eraser', 'snap', 'hold', 'page', 'layer', 'palm', 'single', 'scribble']);
    return JSON.stringify(Object.keys(this.o).filter(k => !skip.has(k) && typeof this.o[k] !== 'function').sort().map(k => [k, this.o[k]]));
  }

  // ---------------------------------------------------------------- input
  // a pointer event's place on the board, in world units (and its time; a pen's pressure when it gives one)
  _pt(e) {
    const r = this.canvas.getBoundingClientRect(), z = this.cam.z;
    const p = [this.cam.x + (e.clientX - r.left) / z, this.cam.y + (e.clientY - r.top) / z, Math.round(e.timeStamp)];
    if (e.pointerType === 'pen' && typeof e.pressure === 'number' && e.pressure > 0) p.push(Math.round(Math.min(1, e.pressure) * 100) / 100);
    return p;
  }
  _spt(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }   // on screen
  // Several pointers at once (two students at the board): each makes its own stroke, in the mode it started in.
  // A pen wins over touch: touch is ignored while a pen is down and for a second after its last event, a wide
  // contact (a palm) never draws, and a touch stroke only just begun is dropped when a pen comes down.
  get active() { return this.ptrs.size ? this.ptrs.keys().next().value : null; }
  get cur() { for (const P of this.ptrs.values()) if (P.cur && P.mode === 'draw') return P.cur; return null; }
  _contact(e) { const w = Math.max(+e.width || 0, +e.height || 0); return w > 1 && isFinite(w) ? w : 0; }   // 0: not known
  // what wrote a finished stroke (a stroke, or its index): {type: 'pen' | 'touch' | 'mouse' | null, width: contact px or null}
  strokeInfo(s) {
    if (typeof s === 'number') s = this.strokes[s];
    const i = s && this.info.get(s);
    return { type: i ? i.type || null : null, width: i ? i.width || null : null };
  }
  _wide(e) { return this.o.palm !== false && ((+e.width || 0) >= 28 || (+e.height || 0) >= 28); }   // 0 or 1: the browser does not say
  _young(P, now) { return now - P.t0 < 350 || (P.cur ? P.cur.length : 0) < 6; }
  _still(P) { if (!P.cur || P.mode !== 'draw') return false; const b = sbox(P.cur); return Math.max(b[2] - b[0], b[3] - b[1]) < 12 / this.cam.z; }
  _capture(e) { try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ } }
  _down(e) {
    if (this.o.layer) return;                            // a layer takes no input (its host does)
    const now = performance.now(), type = e.pointerType, touch = type === 'touch';
    // a pointer that has gone quiet for 1.5 s lost its pointerup somewhere: finish it and take the new one
    for (const P of [...this.ptrs.values()]) if (now - P.last > 1500 || P.id === e.pointerId) this._finish(P, null);
    // palm false: none of the pen-and-palm rules below — every touch writes, as on a board with no pen
    const palm = this.o.palm !== false;
    // one at a time (o.single): a second pointer while one writes is not writing — unless a pen comes to a touch
    if (this.o.single && this.ptrs.size && !(palm && type === 'pen' && [...this.ptrs.values()].every(P => P.type === 'touch'))) { this.why = 'ignored: one at a time'; return; }
    if (this.editing) this._commitText();                 // a tap on the board ends the text being written
    if (type === 'pen' && palm) {
      this.penUntil = now + 1000; this.penSeen = now;
      this._brushed();                                    // brief touches just before the pen were the hand
      // the palm landed first: a touch only just begun, or one resting (hardly moved however long it has been down)
      for (const P of [...this.ptrs.values()]) if (P.type === 'touch' && (this._young(P, now) || this._still(P))) this._drop(P);
    }
    if (touch) {
      if (this.o.penOnly || this.o.fingers === 'ignore') { this.why = 'ignored: pen only'; return; }
      if (palm && (now < this.penUntil || [...this.ptrs.values()].some(P => P.type === 'pen'))) { this.why = 'ignored: pen in use'; return; }
      if (this._wide(e) && this.mode !== 'erase') { this.why = 'ignored: palm'; return; }   // with Erase on, a hand rubs out
      for (const [id, T] of this.touches) if (now - (T.m || T.t) > 1500) this.touches.delete(id);   // fingers whose pointerup was lost
      const sp = this._spt(e); this.touches.set(e.pointerId, { x: sp[0], y: sp[1], t: now, m: now });
    }
    // panning and zooming: the hand tool, space or the middle button with a mouse, fingers set to move the board, two fingers
    if (this.o.infinite && this._gestureDown(e, now)) return;
    if (type === 'mouse' && e.button !== 0) { this.why = 'ignored: button'; return; }
    e.preventDefault();
    const eraser = type === 'pen' && ((e.buttons & 32) !== 0 || e.button === 5);    // the pen turned round
    const m = this.mode;
    // mode 'fix': a tap is sent on as nib:tap (the Board's Fix picks the symbol under it); writing still writes
    const mode = eraser || m === 'erase' ? 'erase' : ['select', 'shape', 'text', 'laser'].includes(m) ? m : 'draw';
    const P = { id: e.pointerId, type, mode, eraser, fix: m === 'fix' && !eraser, t0: now, last: now, cur: null, erased: [], ops: [], hid: [], at: null, r: 0, base: 0, chip: null, w: this._contact(e),
      tool: Object.assign({}, this.tool) };
    this.ptrs.set(e.pointerId, P);
    this.why = P.mode + (eraser ? ' (eraser end)' : '');
    this._capture(e);
    clearTimeout(this.timer); this.gen++;
    const p = this._pt(e);
    if (P.mode === 'erase') { P.base = this._eraseBase(p); this._eraseAt(P, p, e); return; }
    if (P.mode === 'select') { this._selectDown(P, p, e); return; }
    if (P.mode === 'shape') { P.a = padSnap(p, this.o.snap); P.prev = null; this._frame(); return; }
    if (P.mode === 'text' || P.mode === 'laser') { P.cur = [p]; if (P.mode === 'laser') this._laserLoop(); return; }
    P.chip = this._chipAt(p);
    P.cur = [p]; P.stillAt = p;
    this._holdTimer(P);
    if (this.plan && (P.chip || this.plan.items.some(it => it.answer))) { this.redraw(); return; }   // writing over an answer hides it
    if (this._live(P)) this._seg(P); else this._frame();
  }
  _move(e) {
    const now = performance.now();
    if (e.pointerType === 'pen') { this.penUntil = now + 1000; this.penSeen = now; if (this.pending.length) this._brushed(); }
    const T = this.touches.get(e.pointerId);
    if (T) { const sp = this._spt(e); T.x = sp[0]; T.y = sp[1]; T.m = now; }
    if (this.gesture && this._gestureMove(e)) return;
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
      if (P.mode === 'select') { this._selectMove(P, p); continue; }
      if (P.mode === 'shape') { P.b = p; continue; }
      if (P.mode === 'text') continue;
      const q = P.cur[P.cur.length - 1];
      if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) < 0.75 / this.cam.z) continue;
      P.cur.push(p);
      if (P.mode === 'laser') continue;
      if (P.snap) {
        // held still, it turned into a shape; the hand moving on means it was writing after all (a pause mid-stroke):
        // it goes on as ink, all of it, as if the hold had never happened
        if (Math.hypot(p[0] - P.snapAt[0], p[1] - P.snapAt[1]) * this.cam.z <= 6) continue;
        P.snap = null; P.snapAt = null; this.why = 'draw (moved on after a hold)'; this.redraw();
      }
      // still for a moment at the end of a line, circle or box: it may become that shape
      if (Math.hypot(p[0] - P.stillAt[0], p[1] - P.stillAt[1]) * this.cam.z > 3) { P.stillAt = p; this._holdTimer(P); }
      if (this._live(P)) this._seg(P);
    }
    if (P.mode === 'shape' && P.b && typeof shapeFromDrag === 'function') { P.prev = shapeFromDrag(this.shapeTool.kind, P.a, P.b, { snap: this.o.snap, angle: true, z: this.cam.z }); this._frame(); }
    else if (P.mode === 'laser' || (P.mode === 'draw' && !this._live(P))) this._frame();
  }
  _up(e) {
    if (e.pointerType === 'pen') { this.penUntil = performance.now() + 1000; this.penSeen = performance.now(); }
    this.touches.delete(e.pointerId);
    if (this.gesture && this._gestureUp(e)) return;
    const P = this.ptrs.get(e.pointerId);
    if (P) this._finish(P, e);
  }
  // ---------------------------------------------------------------- panning and zooming
  // A drag that moves the board: the hand tool, a mouse's middle button or space + drag, or a finger when fingers move
  // the board. Two fingers put down together (within 0.3 s and a hand's width of each other) pan and zoom; the first
  // finger's stroke, if it had begun, is taken back. Fingers in a gesture never write, even after one lifts.
  _gestureDown(e, now) {
    const type = e.pointerType, touch = type === 'touch', sp = this._spt(e);
    // a gesture whose fingers have been quiet for 1.5 s lost a pointerup somewhere, and a pen ends a gesture of fingers:
    // neither may keep the board from listening
    if (this.gesture && (now - (this.gesture.last || 0) > 1500 || (type === 'pen' && this.gesture.touch))) { this.gesture = null; this._cursor(); this._camMoved(true); }
    if (this.o.page) return false;                       // a page: fingers write, two of them too
    const G = this.gesture;
    if (G) {
      G.last = now;
      if (touch && G.touch && G.ids.length === 1) { G.ids.push(e.pointerId); this._gestureStart(G.ids, true); }
      e.preventDefault(); this._capture(e);
      return true;
    }
    const pan = (type === 'mouse' && (e.button === 1 || (e.button === 0 && (this.spacePan || this.mode === 'pan'))))
      || (type !== 'mouse' && this.mode === 'pan') || (touch && this.o.fingers === 'pan');
    if (pan) {
      e.preventDefault(); this._capture(e);
      this.gesture = { ids: [e.pointerId], touch, kind: 'pan', cam0: Object.assign({}, this.cam), s0: sp, cur: sp, last: now };
      if (touch) this._gestureStart([e.pointerId], true);
      this.why = 'pan';
      this.canvas.style.cursor = 'grabbing';
      return true;
    }
    if (touch && this.o.pinch && this.touches.size === 2) {
      const [oid, o] = [...this.touches.entries()].find(([id]) => id !== e.pointerId) || [];
      const other = oid !== undefined ? this.ptrs.get(oid) : null;
      if (o && Math.hypot(o.x - sp[0], o.y - sp[1]) < 420 && now - o.t < 300) {
        if (other) this._drop(other);                     // whatever the first finger began (a stroke, a lasso, a shape, a move) is taken back
        e.preventDefault(); this._capture(e);
        this.gesture = { ids: [oid, e.pointerId], touch: true, last: now };
        this._gestureStart(this.gesture.ids, true);
        this.why = 'pinch';
        return true;
      }
    }
    return false;
  }
  // (re)start from where the fingers are now: the camera, their middle and their distance
  _gestureStart(ids, touch) {
    const G = this.gesture;
    const pts = ids.map(id => this.touches.get(id)).filter(Boolean);
    if (!G || !pts.length) return;
    const mid = [pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length];
    G.kind = pts.length > 1 ? 'pinch' : 'pan';
    G.cam0 = Object.assign({}, this.cam); G.mid0 = mid; G.s0 = mid; G.cur = mid;
    G.d0 = pts.length > 1 ? Math.max(20, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) : 0;
  }
  _gestureMove(e) {
    const G = this.gesture;
    if (!G || !G.ids.includes(e.pointerId)) return false;
    e.preventDefault();
    G.last = performance.now();
    if (G.touch) {
      const pts = G.ids.map(id => this.touches.get(id)).filter(Boolean);
      if (!pts.length) return true;
      const mid = [pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length];
      const c0 = G.cam0;
      let z = c0.z;
      if (G.kind === 'pinch' && pts.length > 1) z = Math.max(PAD_ZMIN, Math.min(PAD_ZMAX, c0.z * Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / G.d0));
      // the world point that was under the fingers' middle stays under it
      const wx = c0.x + G.mid0[0] / c0.z, wy = c0.y + G.mid0[1] / c0.z;
      this.cam = { x: wx - mid[0] / z, y: wy - mid[1] / z, z };
    } else {
      const sp = this._spt(e);
      this.cam = { x: G.cam0.x - (sp[0] - G.s0[0]) / G.cam0.z, y: G.cam0.y - (sp[1] - G.s0[1]) / G.cam0.z, z: G.cam0.z };
    }
    this._camMoved();
    return true;
  }
  _gestureUp(e) {
    const G = this.gesture;
    if (!G || !G.ids.includes(e.pointerId)) return false;
    try { if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ok */ }
    G.ids = G.ids.filter(id => id !== e.pointerId);
    // one finger of two lifted: the other goes on panning (it never writes)
    if (G.ids.length && G.touch) this._gestureStart(G.ids, true);
    else { this.gesture = null; this._cursor(); this._camMoved(true); }
    return true;
  }
  _wheel(e) {
    if (!this.o.infinite || this.o.page) return;
    e.preventDefault();
    const s = this._spt(e);
    // a trackpad pinch arrives as ctrl + wheel
    if (e.ctrlKey || e.metaKey) { this.zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), s[0], s[1]); return; }
    const k = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? this.canvas.clientHeight : 1;
    let dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    this.panBy(-dx, -dy);
  }
  // the camera: world point (x, y) at the canvas's top-left, z screen px per world unit
  setCamera(c) {
    if (!c || this.o.page) return;
    const z = Math.max(PAD_ZMIN, Math.min(PAD_ZMAX, +c.z || 1));
    this.cam = { x: isFinite(+c.x) ? +c.x : 0, y: isFinite(+c.y) ? +c.y : 0, z };
    this._camMoved(true);
  }
  getCamera() { return Object.assign({}, this.cam); }
  panBy(dx, dy) { if (!this.o.infinite || this.o.page) return; this.cam = { x: this.cam.x - dx / this.cam.z, y: this.cam.y - dy / this.cam.z, z: this.cam.z }; this._camMoved(); }
  // zoom by f about a point on screen (default: the middle), keeping what is under it where it is
  zoomAt(f, sx, sy) {
    if (!this.o.infinite || this.o.page) return;
    const W = this.canvas.width / (this.dpr || 1), H = this.canvas.height / (this.dpr || 1);
    if (sx === undefined) { sx = W / 2; sy = H / 2; }
    const z0 = this.cam.z, z1 = Math.max(PAD_ZMIN, Math.min(PAD_ZMAX, z0 * f));
    if (z1 === z0) return;
    const wx = this.cam.x + sx / z0, wy = this.cam.y + sy / z0;
    this.cam = { x: wx - sx / z1, y: wy - sy / z1, z: z1 };
    this._camMoved();
  }
  zoomTo(z) { this.zoomAt(z / this.cam.z); }
  // everything on the page in view, with a margin of m screen px (no closer than 100% unless it does not fit)
  fitContent(m, most) {
    if (this.o.page) return;
    const b = this.contentRect(0);
    const W = this.canvas.width / (this.dpr || 1), H = this.canvas.height / (this.dpr || 1);
    if (!b) { this.setCamera({ x: 0, y: 0, z: 1 }); return; }
    m = m === undefined ? 48 : m;
    const z = Math.max(PAD_ZMIN, Math.min(most || 1, (W - 2 * m) / Math.max(b[2] - b[0], 1), (H - 2 * m) / Math.max(b[3] - b[1], 1)));
    this.setCamera({ x: (b[0] + b[2]) / 2 - W / 2 / z, y: (b[1] + b[3]) / 2 - H / 2 / z, z });
  }
  // The view the writer chose: a world rectangle and a zoom. A resize (a tablet turned, a window made smaller) keeps
  // everything that was in sight of it in sight, from the same top-left corner, zoomed out only as far as it must be;
  // made bigger again, the zoom the writer chose comes back. Panning or zooming makes the view on screen the chosen one.
  _keepView() { if (this.canvas.width > 1) this._want = { r: this.viewRect, z: this.cam.z }; }
  _fitView() {
    const w = this._want, d = this.dpr || 1, W = this.canvas.width / d, H = this.canvas.height / d;
    if (!w || W < 2 || H < 2) return false;
    // how far right and down the writing in the chosen view reaches (nothing there: the zoom stays)
    let ex = w.r[0], ey = w.r[1];
    for (const s of this.strokes) {
      const b = this._bounds(s);
      if (b[2] < w.r[0] || b[0] > w.r[2] || b[3] < w.r[1] || b[1] > w.r[3]) continue;
      ex = Math.max(ex, Math.min(b[2], w.r[2])); ey = Math.max(ey, Math.min(b[3], w.r[3]));
    }
    const m = 8 / w.z, rw = Math.min(w.r[2] - w.r[0], ex - w.r[0] + m), rh = Math.min(w.r[3] - w.r[1], ey - w.r[1] + m);
    const z = Math.max(PAD_ZMIN, Math.min(PAD_ZMAX, w.z, ex > w.r[0] ? W / rw : Infinity, ey > w.r[1] ? H / rh : Infinity));
    if (z === this.cam.z && w.r[0] === this.cam.x && w.r[1] === this.cam.y) return false;
    this.cam = { x: w.r[0], y: w.r[1], z };
    return true;
  }
  _camQuiet(f) { this._quietCam = true; try { f(); } finally { this._quietCam = false; } }
  // a fixed page (o.page = [W, H]): shown whole and centred, as big as the element allows — and with it any ink written
  // beyond its edges (in a frame of another shape the margins are written on too), about the page's middle, so a
  // smaller frame never cuts writing off. Only on a resize or a state put back: nothing moves while writing.
  _pageCam() {
    const P = this.o.page, d = this.dpr || 1, W = this.canvas.width / d, H = this.canvas.height / d;
    if (!P || W < 2 || H < 2) return false;
    const cx = P[0] / 2, cy = P[1] / 2;
    let hx = cx, hy = cy;
    for (const s of this.strokes) { const b = this._bounds(s); hx = Math.max(hx, cx - b[0] + 6, b[2] - cx + 6); hy = Math.max(hy, cy - b[1] + 6, b[3] - cy + 6); }
    const z = Math.max(PAD_ZMIN, Math.min(PAD_ZMAX, W / (2 * hx), H / (2 * hy)));
    const cam = { x: cx - W / z / 2, y: cy - H / z / 2, z };
    if (Math.abs(cam.x - this.cam.x) < 1e-9 && Math.abs(cam.y - this.cam.y) < 1e-9 && cam.z === this.cam.z) return false;
    this.cam = cam;
    return true;
  }
  get viewRect() { const d = this.dpr || 1, z = this.cam.z; return [this.cam.x, this.cam.y, this.cam.x + this.canvas.width / d / z, this.cam.y + this.canvas.height / d / z]; }
  toScreen(p) { return [(p[0] - this.cam.x) * this.cam.z, (p[1] - this.cam.y) * this.cam.z]; }
  toWorld(sx, sy) { return [this.cam.x + sx / this.cam.z, this.cam.y + sy / this.cam.z]; }
  // the camera moved: draw at the next frame, move the text box with it, and tell the page (at most every 100 ms; at
  // once when done)
  _camMoved(done) {
    if (!this._quietCam) this._keepView();
    this._frame(); this._placeEditor();
    clearTimeout(this._camTimer);
    const fire = () => this.el.dispatchEvent(new CustomEvent('nib:camera', { detail: this.getCamera(), bubbles: true }));
    if (done) fire(); else this._camTimer = setTimeout(fire, 100);
  }
  _cursor() {
    const m = this.mode;
    this.canvas.style.cursor = this.spacePan || m === 'pan' ? 'grab' : m === 'select' ? (this.lassoOnly ? 'crosshair' : 'default') : m === 'text' ? 'text' : m === 'laser' ? 'none' : 'crosshair';
  }
  // ---------------------------------------------------------------- a pointer is lifted
  // a pointer's stroke is done (e: its pointerup / pointercancel, or null when its up was lost)
  _finish(P, e) {
    this.ptrs.delete(P.id);
    clearTimeout(P.hold);
    try { if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(P.id)) this.canvas.releasePointerCapture(P.id); } catch (_) { /* ok */ }
    if (P.mode === 'erase') {
      P.at = null;
      if (P.ops.length) { this._push(Object.assign({ ops: P.ops }, P.hid.length ? { hide: P.hid } : {})); this._changed(); }
      else if (P.erased.length || P.hid.length) { this._push(Object.assign({ erase: P.erased }, P.hid.length ? { hide: P.hid } : {})); this._changed(); }
      else this.redraw();                                  // the eraser's ring goes
      return;
    }
    if (P.mode === 'select') { this._selectUp(P, e); return; }
    if (P.mode === 'shape') { this._shapeUp(P, e); return; }
    if (P.mode === 'laser') { if (P.cur && P.cur.length) this.lasers.push({ pts: P.cur, end: performance.now() }); this._laserLoop(); return; }
    if (P.mode === 'text') {
      if (P.type === 'touch' && this.o.palm !== false && performance.now() - this.penSeen < 3000) { this.why = 'ignored: tap beside the pen'; return; }   // the heel of the hand
      if (e && e.type === 'pointerup' && P.cur) this._textAt(P.cur[0]);
      return;
    }
    const s = P.cur;
    if (e && e.type === 'pointercancel' && s && s.length < 3) { this.redraw(); return; }   // a canceled tap
    // a tap on an answer's chip (up within 10 px and 400 ms of the down, inside the chip) shows that answer
    if (P.chip && e && e.type === 'pointerup' && s && s.length) {
      const q = this._pt(e);
      if (Math.hypot(q[0] - s[0][0], q[1] - s[0][1]) * this.cam.z <= 10 && performance.now() - P.t0 <= 400 && this._inChip(P.chip, q)) { this._reveal(P.chip.key); return; }
    }
    if (!s || !s.length) return;
    const b = sbox(s.map(q => [q[0], q[1]])), span = Math.max(b[2] - b[0], b[3] - b[1]) * this.cam.z;
    // Fix on: a tap (within 10 px, 400 ms) points at a symbol and writes nothing; anything longer is writing
    if (P.fix && span < 10 && performance.now() - P.t0 <= 400) {
      this.why = 'tap (fix)'; this.redraw();
      this.el.dispatchEvent(new CustomEvent('nib:tap', { detail: { x: s[0][0], y: s[0][1], pointerType: P.type }, bubbles: true }));
      return;
    }
    const now = performance.now(), penSession = this.o.palm !== false && now - this.penSeen < 30000;
    // a finger's tap while a pen is in use (within the last 30 s) is the heel of the hand, not a decimal point
    if (P.type === 'touch' && penSession && span < 6) { this.why = 'ignored: tap beside the pen'; this.redraw(); return; }
    const info = { type: ['pen', 'touch', 'mouse'].includes(P.type) ? P.type : null, width: P.w > 1 ? Math.round(P.w * 10) / 10 : null };
    const T = P.tool || {};
    let el = s;
    if (P.snap) {
      // drawn and held: the shape it was, in the pen's color and width
      el = P.snap.pts.map(q => [q[0], q[1]]);
      if (T.kind === 'highlighter') Object.assign(info, { tool: 'highlighter', size: T.size || 22 });
      else Object.assign(info, { tool: 'shape', shape: P.snap.shape, size: T.size || this.o.width * (T.kind === 'marker' ? 3 : 1) });
      if (T.color) info.color = T.color;
    } else {
      if (T.kind && T.kind !== 'pen') info.tool = T.kind;
      if (T.color) info.color = T.color;
      if (T.size) info.size = T.size;
    }
    this.info.set(el, info);
    if (P.fix && this.mode === 'fix') this.mode = 'draw';   // written with Fix on: the writer is writing again
    // a brief touch (under 400 ms) while the pen is the writer's instrument may be the hand brushing the board on its
    // way down: it waits 1.5 s, shown as ink, and goes if the pen follows; a finger writing on its own waits nothing
    if (P.type === 'touch' && penSession && !P.fix && now - P.t0 < 400) {
      this.why = 'touch: waiting for the pen';
      this.pending.push({ s: el, timer: setTimeout(() => this._commit(el), 1500) });
      this.redraw();
      return;
    }
    // scribbled out: a pen or marker gone back and forth over writing rubs out what it lies over, and is not kept — on its
    // own, or with the strokes it broke off from a moment ago (a pen that left the glass at a turn, a touch frame that lost
    // a fast finger)
    const scribbly = !P.snap && this.o.scribble !== false && (!T.kind || T.kind === 'pen' || T.kind === 'marker');
    if (scribbly && (this._scribbleOut(el, info) || this._scribbleJoin(el, info, P, T))) return;
    if (scribbly) this._lifted.set(el, { t0: P.t0, t1: now, type: P.type, kind: T.kind || 'pen', color: T.color || null, size: T.size || null });
    this.strokes.push(el);
    this._push({ add: el });
    this._changed();
  }
  // a brief touch stroke the pen did not follow: ink after all
  _commit(s) {
    const i = this.pending.findIndex(q => q.s === s);
    if (i < 0) return;
    this.pending.splice(i, 1);
    this.strokes.push(s);
    this._push({ add: s });
    this._changed();
  }
  // the pen came: whatever brief touches were waiting were the hand
  _brushed() {
    if (!this.pending.length) return;
    for (const q of this.pending) clearTimeout(q.timer);
    this.pending = [];
    this.why = 'dropped: the hand before the pen';
    this.redraw();
  }
  // a stroke that should never have been (a palm under a pen): gone, and whatever it erased is back
  _drop(P) {
    this.ptrs.delete(P.id);
    clearTimeout(P.hold);
    try { if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(P.id)) this.canvas.releasePointerCapture(P.id); } catch (_) { /* ok */ }
    for (let k = P.ops.length - 1; k >= 0; k--) {            // the area eraser's cuts, undone
      const o = P.ops[k];
      if (o.ins !== undefined) { const i = this.strokes.indexOf(o.s); if (i >= 0) this.strokes.splice(i, 1); }
      else this.strokes.splice(Math.min(o.rm, this.strokes.length), 0, o.s);
    }
    for (const x of P.erased.slice().reverse()) this.strokes.splice(x.i, 0, x.s);
    if (P.mode === 'select' && P.op && P.op.orig) { for (const [s, was] of P.op.orig) { s.length = 0; for (const q of was) s.push(q.slice()); this._touched(s); } this._planTo(P.op.items, x => x, y => y, 1); }
    for (const k of P.hid) this.revealed.add(k);
    if (P.hid.length) this._syncHidden();
    this.redraw();
  }
  _push(h) { this.history.push(h); if (this.history.length > 500) this.history.splice(0, this.history.length - 500); this.future = []; }
  // the eraser's size: at least 14 px, a fifth of the writing near it (or of all of it), half a finger's contact
  _eraseBase(p) {
    const m = 150 / this.cam.z, all = this.ink.length ? this.ink : this.strokes;
    const near = all.filter(s => { const b = sbox(s); return p[0] > b[0] - m && p[0] < b[2] + m && p[1] > b[1] - m && p[1] < b[3] + m; });
    const pool = near.length ? near : all;
    return Math.max(14 / this.cam.z, pool.length ? 0.2 * refSize(pool) : 0);
  }
  _eraseAt(P, p, e) {
    const w = e ? Math.max(+e.width || 0, +e.height || 0) : 0;
    const r = P.r = Math.max(P.base || 14 / this.cam.z, w > 1 ? w / 2 / this.cam.z : 0);
    P.at = p;
    let hit = false;
    // in a tidy, handwritten or typeset view the eraser takes away what it touches as shown
    if (this.plan) {
      const live = new Set(this.strokes);
      let fresh = null;
      for (const it of this.plan.items) {
        if (it.answer) {
          // an answer shown by a tap goes back out of focus, waiting for a tap
          if (!it.hidden && it.revealKey && this.revealed.has(it.revealKey) && itemNear(it, p, r)) {
            if (!fresh) fresh = this._fresh();
            if (!this._answerShown(it, live, fresh)) continue;
            this.revealed.delete(it.revealKey); P.hid.push(it.revealKey); this._syncHidden(); hit = true;
          }
          continue;
        }
        if (!it.from.every(s => live.has(s)) || !itemNear(it, p, r)) continue;
        for (const s of it.from) {
          const i = this.strokes.indexOf(s);
          if (i < 0) continue;
          if (this.o.eraser === 'area') P.ops.push({ rm: i, s }); else P.erased.push({ i, s });
          this.strokes.splice(i, 1); live.delete(s); hit = true;
        }
      }
    }
    const area = this.o.eraser === 'area';
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      if (!this._erasable(s, p, r)) continue;
      const t = this._tool(s);
      if (area && (t === 'pen' || t === 'marker' || t === 'highlighter')) {
        // rub out only where the eraser passed: the stroke is cut into what is left of it
        const bits = padCut(s, p, r + (t === 'pen' ? 0 : this._size(s) / 2));
        const E = this.info.get(s);
        P.ops.push({ rm: i, s }); this.strokes.splice(i, 1);
        bits.forEach((b, k) => { if (E) this.info.set(b, Object.assign({}, E)); this.strokes.splice(i + k, 0, b); P.ops.push({ ins: i + k, s: b }); });
        hit = true;
        continue;
      }
      if (area) { P.ops.push({ rm: i, s }); this.strokes.splice(i, 1); hit = true; continue; }
      P.erased.push({ i, s }); this.strokes.splice(i, 1); hit = true;
    }
    if (hit) { this._dropDead(); this.redraw(); } else this._frame();            // the ring follows the eraser
  }
  // ---------------------------------------------------------------- scribbled out
  // A stroke s (look E) just finished: if it is a scribble over writing (scribble.js), what it lies over goes — as one
  // step of Undo — and the scribble is not kept; a shown answer under it goes back out of focus. In a tidy, handwritten
  // or typeset view what it lies over is what that view shows. Pens, markers and shapes go; highlighters, text,
  // pictures, number lines and coordinate planes stay (as for the eraser). False when it rubs out nothing: it is ink.
  // `pieces`: strokes already on the board that are the first part of this scribble (_scribbleJoin) — never what it lies
  // over; they go with it.
  _scribbleOut(s, E, pieces) {
    if (typeof scribbleOf !== 'function' || this.o.layer) return false;
    const z = this.cam.z, sc = scribbleOf(s, z);
    if (!sc) return false;
    const piece = new Set(pieces || []);
    const live = new Set(this.strokes.filter(st => !piece.has(st))), units = [], shown = new Set();
    const lookOf = st => this.info.get(st) || {};
    const takes = st => { const L = lookOf(st), t = L.tool || 'pen'; return t === 'pen' || t === 'marker' || (t === 'shape' && L.shape !== 'numberline' && L.shape !== 'plane'); };
    const boxGrid = b => { const out = []; for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) out.push([b[0] + (b[2] - b[0]) * (j % 2 ? 4 - i : i) / 4, b[1] + (b[3] - b[1]) * j / 4]); return out; };
    const shownPaths = it => {
      const out = [];
      for (const part of it.parts || []) {
        if ((part.t === 'ink' || part.t === 'line') && part.paths) { for (const q of part.paths) if (q.length) out.push(q); }
        else if (it.box) out.push(boxGrid(it.box));
      }
      return out;
    };
    // what a view shows in place of the strokes it read
    if (this.plan && this.plan.style !== 'ink') {
      this.plan.items.forEach((it, k) => {
        if (it.answer || !it.from.length || !it.from.every(st => live.has(st))) return;
        for (const st of it.from) shown.add(st);
        if (!it.from.every(takes)) return;
        for (const q of shownPaths(it)) units.push({ pts: q, group: 'v' + k, from: it.from });
      });
    }
    // the strokes as they are, a symbol's strokes together (as the last reading grouped them)
    const sym = new Map();
    if (this.result && this.result.symbols && this.resultStrokes) this.result.symbols.forEach((y, k) => { for (const i of y.strokes || []) { const st = this.resultStrokes[i]; if (st) sym.set(st, k); } });
    this.strokes.forEach((st, k) => {
      if (shown.has(st) || piece.has(st)) return;
      const L = lookOf(st), t = L.tool || 'pen';
      if (t === 'shape') {
        // a shape by its outline; a number line or a plane stays, and is a line to what is drawn on it
        const outl = typeof shapeOutline === 'function' ? shapeOutline(L, st) : [st];
        const closed = ['rect', 'square', 'ellipse', 'circle', 'triangle', 'rtriangle', 'poly'].includes(L.shape);
        for (const q of outl) if (q.length) units.push({ pts: q, group: 'e' + k, closed, fixed: !takes(st), from: [st] });
      } else if (t === 'pen' || t === 'marker') units.push({ pts: st, group: sym.has(st) ? 's' + sym.get(st) : null, from: [st] });
    });
    const er = scribbleErase(sc, units, z);
    const take = new Set();
    for (const k of er.erase) for (const st of units[k].from) if (takes(st)) take.add(st);
    // an answer shown by a tap, under the scribble: back out of focus (the eraser does the same)
    const hid = [];
    if (this.plan) for (const it of this.plan.items) {
      if (!it.answer || it.hidden || !it.revealKey || !this.revealed.has(it.revealKey) || hid.includes(it.revealKey)) continue;
      let got = 0, of = 0;
      for (const q of shownPaths(it)) { const c = scribbleCovers(sc, q, z); got += c.got; of += c.of; }
      if (of && got / of >= 0.5) hid.push(it.revealKey);
    }
    this.why = 'scribble: ' + er.why + (take.size ? ' (' + take.size + ')' : '') + (piece.size ? ' (joined ' + (piece.size + 1) + ')' : '');
    if (!take.size && !hid.length) return false;
    // the pieces it broke into go, and the steps that kept them (they are the last strokes and the last steps:
    // _scribbleJoin), so one Undo puts back the board as it was before the scribble began
    // (they fade with it: s is all of them)
    for (const p of [...piece].reverse()) {
      const i = this.strokes.lastIndexOf(p);
      if (i >= 0) this.strokes.splice(i, 1);
      const H = this.history[this.history.length - 1];
      if (H && H.add === p) this.history.pop();
    }
    // one step: the strokes taken, from the end (so Undo puts each back where it was), and the answers hidden
    const erased = [];
    for (let i = this.strokes.length - 1; i >= 0; i--) if (take.has(this.strokes[i])) { erased.push({ i, s: this.strokes[i] }); this.strokes.splice(i, 1); }
    for (const k of hid) this.revealed.delete(k);
    if (hid.length) this._syncHidden();
    const h = Object.assign({ erase: erased, scribble: true }, hid.length ? { hide: hid } : {});
    this._push(h);
    // what went fades away with the scribble, so it is seen to go
    this._fade = { list: erased.map(x => ({ s: x.s, E: this.info.get(x.s) })).concat([{ s, E: Object.assign({ tool: 'pen' }, E && E.tool ? { tool: E.tool } : {}, E && E.color ? { color: E.color } : {}, E && E.size ? { size: E.size } : {}) }]),
      t0: typeof performance !== 'undefined' ? performance.now() : 0, ms: 320 };
    this._dropDead();
    this._changed();
    this.el.dispatchEvent(new CustomEvent('nib:scribble', { detail: { erased: erased.length, hidden: hid.length, step: h, joined: piece.size }, bubbles: true }));
    return true;
  }
  // A scribble the board heard as several strokes — a pen that left the glass for a moment at a turn, a touch frame that
  // lost a fast finger: the strokes just before this one, each lifted at most 150 ms before the next went down, and
  // where it went down (no farther than the pen could go in that moment), with the same pen and nothing done between,
  // are tried with it as one stroke — the longest chain first, three pieces before it at most. False: it is ink.
  _scribbleJoin(el, E, P, T) {
    if (typeof scribbleOf !== 'function' || this.o.layer || !el.length) return false;
    const z = this.cam.z, chain = [];
    let next = el, down = P.t0, k = this.strokes.length - 1, h = this.history.length - 1;
    while (chain.length < 3 && k >= 0 && h >= 0) {
      const st = this.strokes[k], L = this._lifted.get(st), H = this.history[h];
      if (!L || !H || H.add !== st || L.type !== P.type || L.kind !== (T.kind || 'pen') || L.color !== (T.color || null) || L.size !== (T.size || null)) break;
      const gap = down - L.t1;
      if (!(gap >= 0 && gap <= 150)) break;
      const a = st[st.length - 1], b = next[0], v = scrLen(st) / Math.max(L.t1 - L.t0, 1);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > Math.min(80 / z, Math.max(24 / z, 2 * v * gap))) break;
      chain.unshift(st); next = st; down = L.t0; k--; h--;
    }
    for (let n = chain.length; n >= 1; n--) {
      const pieces = chain.slice(chain.length - n);
      if (this._scribbleOut([].concat(...pieces, el), E, pieces)) return true;
    }
    return false;
  }
  // Undo the scribble that `step` (a nib:scribble event's detail.step) was, if nothing has been done since
  undoScribble(step) {
    if (!step || this.history[this.history.length - 1] !== step) return false;
    this.undo();
    return true;
  }
  _frame() {
    if (this._raf || typeof requestAnimationFrame === 'undefined') return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.redraw(); });
  }
  // ---------------------------------------------------------------- answers waiting for a tap
  // A hidden answer is drawn blurred, where it goes: its "chip" (the name kept from the gold "?" dot of 1.6.2) is the tap
  // target over it — the answer's box, at least a fingertip (44 px) each way. A tap there shows it.
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
  _inChip(c, p) {
    const b = c.box, z = this.cam.z, ex = Math.max(0, (44 / z - (b[2] - b[0])) / 2), ey = Math.max(0, (44 / z - (b[3] - b[1])) / 2), m = 6 / z;
    return p[0] >= b[0] - ex - m && p[0] <= b[2] + ex + m && p[1] >= b[1] - ey - m && p[1] <= b[3] + ey + m;
  }
  _reveal(key) {
    this.revealed.add(key);
    this._syncHidden();
    this._push({ reveal: [key] });
    // it comes into focus: the blur eases away (at once when the reader asks for less motion)
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.o.motion && !reduce) this._focusing = { key, t0: performance.now(), ms: 320 };
    this._changed();
    if (this._focusing) this._frame();
  }
  // which answers wait for a tap (solve and reveal on, not tapped yet), and their tap targets
  _syncHidden() {
    if (!this.plan) return;
    const on = !!(this.o.solve && this.o.reveal);
    for (const it of this.plan.items) if (it.answer) it.hidden = on && !this.revealed.has(it.revealKey);
    this.plan.chips = this._chips(this.plan.items);
  }
  // one target per hidden answer: the box of everything it writes (cx, cy its middle, r half its diagonal)
  _chips(items) {
    const by = new Map();
    for (const it of items) {
      if (!it.answer || !it.hidden || !it.group) continue;
      const c = by.get(it.revealKey);
      if (c) c.box = ubox(c.box, it.box || it.group);
      else by.set(it.revealKey, { key: it.revealKey, item: it, box: (it.box || it.group).slice() });
    }
    return [...by.values()].map(c => Object.assign(c, { cx: (c.box[0] + c.box[2]) / 2, cy: (c.box[1] + c.box[3]) / 2, r: Math.hypot(c.box[2] - c.box[0], c.box[3] - c.box[1]) / 2 }));
  }
  // An answer drawn out of focus: its length shows, not what it says. ctx.filter where the canvas has it (the blur
  // scaled to the page: an eighth of the writing's em, the strokes drawn three times as heavy so the blur keeps their
  // shape, on screen or in a picture of the board), else a smear of copies.
  _drawBlurred(ctx, it, ink, k) {
    const g = it.group || it.box, em = it.em || (g ? (g[3] - g[1]) / 0.7 : 20), r = PAD_BLUR_EM * em * (k === undefined ? 1 : k);
    if (r <= 0.02 * em) { drawItems(ctx, [it], { ink, width: this.o.width }); return; }
    const t = ctx.getTransform ? ctx.getTransform() : { a: 1 }, dev = Math.max(0.5, r * Math.hypot(t.a, t.b || 0));
    ctx.save();
    if (padBlurOK()) {
      ctx.filter = `blur(${dev.toFixed(1)}px)`;
      drawItems(ctx, [it], { ink, width: this.o.width * 3.0, alpha: 0.95 });
    } else {
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2, d = r * (i % 2 ? 1 : 0.55);
        ctx.save(); ctx.translate(Math.cos(a) * d, Math.sin(a) * d);
        drawItems(ctx, [it], { ink, width: this.o.width * 2.2, alpha: 0.16 });
        ctx.restore();
      }
    }
    ctx.restore();
  }
  // new writing not read yet, and strokes being written (a tap on a chip is not writing)
  _fresh() {
    const read = new Set(this.resultStrokes || []), out = this.ink.filter(s => !read.has(s));
    for (const P of this.ptrs.values()) {
      if (!P.cur || P.mode !== 'draw' || P.snap || (P.tool && P.tool.kind === 'highlighter')) continue;
      if (P.chip) { const b = sbox(P.cur); if ((b[2] - b[0]) * this.cam.z <= 10 && (b[3] - b[1]) * this.cam.z <= 10) continue; }
      out.push(P.cur);
    }
    return out.map(s => sbox(s));
  }

  // ---------------------------------------------------------------- drawing
  // the paper's ink (navy, or cream on a dark paper) and whether the paper is dark; kept for the strokes drawn between frames
  _ink() {
    const cs = getComputedStyle(this.el);
    const themeDark = padLum(cs.getPropertyValue('--nib-paper').trim() || '#ffffff') < 0.45;
    let ink = this.o.ink || cs.getPropertyValue('--nib-ink').trim() || cs.color || '#1b2a4a', dark = themeDark;
    this._paperC = cs.getPropertyValue('--nib-paper').trim() || '#ffffff';
    if (this.o.paper && typeof paperTone === 'function') {
      try { const t = paperTone(this.o.paper.tone || 'theme', themeDark); dark = !!t.dark; if (!this.o.ink) ink = t.ink; this._paperC = t.paper; } catch (e) { /* the theme's */ }
    }
    this._inkC = ink; this._darkP = dark; this._themeDark = themeDark;
    const ctx = this.ctx;
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = this.o.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  }
  _tool(s) { const E = this.info.get(s); return (E && E.tool) || 'pen'; }
  // the width a stroke is drawn with (world units)
  _size(s) {
    const E = this.info.get(s), t = (E && E.tool) || 'pen';
    if (E && +E.size > 0) return +E.size;
    return t === 'highlighter' ? 22 : t === 'marker' ? 3 * this.o.width : t === 'shape' ? 3 : t === 'text' ? 32 : this.o.width;
  }
  _toolWidth(T) { return +T.size > 0 ? +T.size : T.kind === 'highlighter' ? 22 : T.kind === 'marker' ? 3 * this.o.width : this.o.width; }
  // a line's width at a point: the pen's pressure (0.5 is the line's own width) when it reports one
  _pw(q, w) { return this.o.pressure && q.length > 3 ? w * (0.45 + 1.1 * Math.max(0.05, Math.min(1, q[3]))) : w; }
  // an element's points or look changed: its bounds and drawing are made again
  _touched(s) { this._bb.delete(s); this._paths.delete(s); }
  // everything drawn of an element, in world units (for culling, selection, export)
  _bounds(s) {
    let b = this._bb.get(s);
    const E = this.info.get(s), t = (E && E.tool) || 'pen';
    // a number line's or a plane's labels never go under 12 screen px: zoomed out, they reach further than at 100%
    const zl = t === 'shape' && E && (E.shape === 'numberline' || E.shape === 'plane') ? Math.min(1, this.cam.z) : 1;
    if (b && b.n === s.length && (zl === 1 || this._bbz.get(s) === zl)) return b;
    if (t === 'shape' && typeof shapeBounds === 'function') { try { b = shapeBounds(E, s, { z: zl }); } catch (e) { b = null; } }
    else b = null;
    if (zl !== 1) this._bbz.set(s, zl);
    if (!b) {
      b = sbox(s);
      const m = t === 'text' || t === 'image' ? 0 : this._size(s) * (t === 'pen' && this.o.pressure ? 0.8 : 0.5) + 1;
      b = [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
    }
    b.n = s.length;
    this._bb.set(s, b);
    return b;
  }
  // Does the eraser at p (radius r) take this element? It rubs out what was drawn: pen, marker and highlighter strokes,
  // and shapes where it touches their outline (not inside a filled one). Text, pictures, number lines and coordinate
  // planes are placed things that writing goes on: they stay (Select and Delete take them away).
  _erasable(s, p, r) {
    const E = this.info.get(s), t = (E && E.tool) || 'pen';
    if (t === 'pen' || t === 'marker' || t === 'highlighter') return this._hit(s, p, r);
    if (t !== 'shape' || !E || E.shape === 'numberline' || E.shape === 'plane') return false;
    const b = this._bounds(s);
    if (p[0] < b[0] - r || p[0] > b[2] + r || p[1] < b[1] - r || p[1] > b[3] + r) return false;
    return typeof shapeHit === 'function' ? !!shapeHit(E.fill ? Object.assign({}, E, { fill: null }) : E, s, p, r, { z: this.cam.z }) : strokeNear(s, p, r);
  }
  // is world point p within r of what an element shows?
  _hit(s, p, r) {
    const b = this._bounds(s);
    if (p[0] < b[0] - r || p[0] > b[2] + r || p[1] < b[1] - r || p[1] > b[3] + r) return false;
    const E = this.info.get(s), t = (E && E.tool) || 'pen';
    if (t === 'shape') return typeof shapeHit === 'function' ? !!shapeHit(E, s, p, r, { z: this.cam.z }) : strokeNear(s, p, r);
    if (t === 'text' || t === 'image') return true;      // anywhere in its box
    return strokeNear(s, p, r + (t === 'pen' ? 0 : this._size(s) / 2));
  }
  // the latest piece of the stroke being written, drawn at once (the rest of the board is not touched)
  _live(P) { const k = P.tool && P.tool.kind; return P.mode === 'draw' && !P.snap && k !== 'highlighter'; }
  _seg(P) {
    const s = P.cur, n = s.length, ctx = this.ctx, T = P.tool || {};
    if (!n) return;
    const col = padColor(T.color, this._darkP, this._inkC || '#1b2a4a'), w = this._toolWidth(T);
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const pen = !T.kind || T.kind === 'pen';
    if (n === 1) { ctx.beginPath(); ctx.arc(s[0][0], s[0][1], (pen ? this._pw(s[0], w) : w) / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
    ctx.lineWidth = pen ? (this._pw(s[n - 2], w) + this._pw(s[n - 1], w)) / 2 : w;
    ctx.beginPath();
    if (n === 2) { ctx.moveTo(s[0][0], s[0][1]); ctx.lineTo((s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2); }
    else {
      const a = s[n - 3], b = s[n - 2], c = s[n - 1];
      ctx.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      ctx.quadraticCurveTo(b[0], b[1], (b[0] + c[0]) / 2, (b[1] + c[1]) / 2);
    }
    ctx.stroke();
    ctx.restore();
  }
  // a stroke as one smooth path (made once, then kept)
  // (each cached drawing is good for as many points as it was made from: a stroke being written grows under it — the
  // highlighter, drawn whole on every move, stayed the dot it was at its first frame; 1.6.4, Croix at the Promethean
  // board: "The highlighter broke. It made a dot and didn't track.")
  _path(s) {
    let P = this._paths.get(s);
    if (P && P.k === 'path' && P.n === s.length) return P.path;
    const path = new Path2D();
    path.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < s.length - 1; i++) path.quadraticCurveTo(s[i][0], s[i][1], (s[i][0] + s[i + 1][0]) / 2, (s[i][1] + s[i + 1][1]) / 2);
    path.lineTo(s[s.length - 1][0], s[s.length - 1][1]);
    this._paths.set(s, { k: 'path', path, n: s.length });
    return path;
  }
  // a pen stroke whose width follows its pressure: pieces of the same width (to a quarter px) share one path
  _varPaths(s, w) {
    let P = this._paths.get(s);
    if (P && P.k === 'var' && P.w === w && P.n === s.length) return P.groups;
    const groups = [], n = s.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let cur = null;
    const piece = (from, ctrl, to, ww) => {
      const q = Math.max(0.25, Math.round(ww * 4) / 4);
      if (!cur || cur.w !== q) { cur = { w: q, path: new Path2D() }; groups.push(cur); }
      cur.path.moveTo(from[0], from[1]);
      if (ctrl) cur.path.quadraticCurveTo(ctrl[0], ctrl[1], to[0], to[1]); else cur.path.lineTo(to[0], to[1]);
    };
    piece(s[0], null, mid(s[0], s[1]), (this._pw(s[0], w) + this._pw(s[1], w)) / 2);
    for (let i = 1; i < n - 1; i++) piece(mid(s[i - 1], s[i]), s[i], mid(s[i], s[i + 1]), this._pw(s[i], w));
    piece(mid(s[n - 2], s[n - 1]), null, s[n - 1], (this._pw(s[n - 2], w) + this._pw(s[n - 1], w)) / 2);
    this._paths.set(s, { k: 'var', w, groups, n: s.length });
    return groups;
  }
  // draw one element (E: its look; drawn as a stroke of that look when it is a stroke)
  _drawEl(s, E) {
    E = E || this.info.get(s) || {};
    const t = E.tool || 'pen', ctx = this.ctx;
    const col = padColor(E.color, this._darkP, this._inkC || '#1b2a4a');
    if (t === 'shape') {
      const F = Object.assign({}, E, { color: col });
      if (E.fill) F.fill = padFill(E.fill, this._darkP, col); else delete F.fill;
      if (typeof shapeDraw === 'function') { try { shapeDraw(ctx, F, s, { ink: col, paper: this._paperC, z: this.cam.z, font: PAD_FONT }); } catch (e) { /* a shape it cannot draw */ } }
      return;
    }
    if (t === 'text') { this._drawText(s, E, col); return; }
    if (t === 'image') { this._drawImage(s, E); return; }
    if (!s.length) return;
    const w = +E.size > 0 ? +E.size : t === 'highlighter' ? 22 : t === 'marker' ? 3 * this.o.width : this.o.width;
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = w;
    if (t === 'highlighter') {
      // see-through, and on light paper it darkens what is under it the way a real highlighter does
      ctx.globalAlpha = this._darkP ? 0.36 : 0.55;
      if (!this._darkP) ctx.globalCompositeOperation = 'multiply';
    }
    if (s.length === 1) { ctx.beginPath(); ctx.arc(s[0][0], s[0][1], (t === 'pen' ? this._pw(s[0], w) : w) / 2, 0, Math.PI * 2); ctx.fill(); }
    else if (t === 'pen' && this.o.pressure && s[0].length > 3) for (const g of this._varPaths(s, w)) { ctx.lineWidth = g.w; ctx.stroke(g.path); }
    else ctx.stroke(this._path(s));
    ctx.restore();
  }
  // a text box: its lines at its size, scaled with its box when the box was made bigger or smaller
  _textScale(s, E) {
    const lines = String(E.text || '').split('\n').length || 1, natural = lines * 1.25 * (+E.size || 32);
    const h = Math.abs(s[1][1] - s[0][1]);
    return h > 0 && natural > 0 ? h / natural : 1;
  }
  _drawText(s, E, col) {
    if (this.editing && this.editing.el === s) return;     // the text box shows it while it is being written
    const ctx = this.ctx, k = this._textScale(s, E), size = (+E.size || 32) * k, lh = 1.25 * size;
    const x = Math.min(s[0][0], s[1][0]), y = Math.min(s[0][1], s[1][1]);
    ctx.save(); ctx.fillStyle = col; ctx.font = `500 ${size}px ${PAD_FONT}`; ctx.textBaseline = 'top';
    String(E.text || '').split('\n').forEach((l, i) => ctx.fillText(l, x, y + i * lh + 0.12 * size));
    ctx.restore();
  }
  // the box a text needs at its size, from its top-left corner
  _fitText(s) {
    const E = this.info.get(s), ctx = this.ctx, size = +E.size || 32, lines = String(E.text || '').split('\n');
    ctx.save(); ctx.font = `500 ${size}px ${PAD_FONT}`;
    const w = Math.max(size * 0.5, ...lines.map(l => ctx.measureText(l).width));
    ctx.restore();
    const x = Math.min(s[0][0], s[1][0]), y = Math.min(s[0][1], s[1][1]);
    s.length = 0; s.push([x, y], [x + w, y + lines.length * 1.25 * size]);
    this._touched(s);
  }
  _drawImage(s, E) {
    const ctx = this.ctx, im = this.images.get(E.img);
    const x = Math.min(s[0][0], s[1][0]), y = Math.min(s[0][1], s[1][1]), w = Math.abs(s[1][0] - s[0][0]), h = Math.abs(s[1][1] - s[0][1]);
    if (im && im.ok) { ctx.drawImage(im.img, x, y, w, h); return; }
    if (!im) this._needImage(E.img);
    // not here yet (or lost): a quiet frame where it goes
    ctx.save(); ctx.fillStyle = 'rgba(127,127,127,.12)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(127,127,127,.5)'; ctx.lineWidth = 1 / this.cam.z; ctx.setLineDash([6 / this.cam.z, 4 / this.cam.z]); ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
  _answerInk() {
    const cs = getComputedStyle(this.el);
    // on a paper darker or lighter than the board's theme, the theme's gold may not read: the paper's own gold then
    if (this._darkP !== undefined && this._darkP !== this._themeDark) return PAD_COLORS['@gold'][this._darkP ? 1 : 0];
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
    const c = this.canvas, ctx = this.ctx, d = this.dpr || 1, z = this.cam.z;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(d * z, 0, 0, d * z, -this.cam.x * d * z, -this.cam.y * d * z);
    this._paint(false);
  }
  // Everything on the pad, on this.ctx (already in world units). image: true leaves out what is only for the writer at
  // the board (chips, the eraser's ring, the selection, the laser); X: {rect, paper, answers: 'shown' | 'all' | 'none',
  // only: a Set of elements} when exporting.
  _paint(image, X) {
    const ctx = this.ctx;
    this._ink();
    const ink = this._inkC, live = new Set(this.strokes), shown = new Set();
    const A = this.anim, e = A ? A.e : 1, view = (X && X.rect) || this.viewRect, only = X && X.only;
    const answers = (X && X.answers) || 'shown';
    let ans = null, fresh = null;
    const answerSetup = () => {
      if (ans) return;
      ans = this._answerInk();
      fresh = this._fresh();
    };
    const layer = this.o.layer === 'answers';            // only the answers (the strokes are the host's)
    // the paper, under everything
    if (this.o.paper && !layer && (!X || X.paper !== false) && typeof drawPaper === 'function') {
      try { drawPaper(ctx, this.o.paper, view, this.cam.z, this._themeDark); } catch (err) { /* no paper then */ }
    }
    // which read ink its view draws (tidied, in the writer's hand, typeset), and which is changing back to ink
    const items = this.plan && !only ? this.plan.items : [];
    for (const it of items) if (!it.answer && it.from.every(s => live.has(s))) for (const s of it.from) shown.add(s);
    const leaving = [];
    if (A && e < 1 && !only) for (const g of A.leaving) {
      if (g.answer || !g.from.every(s => live.has(s))) continue;
      const rest = g.from.filter(s => !shown.has(s));
      if (rest.length) { leaving.push({ g, rest }); for (const s of rest) shown.add(s); }
    }
    // pictures, then highlighters, then everything else in the order it was made (what is out of view is skipped)
    const vis = s => { const b = this._bounds(s); return b[2] >= view[0] && b[0] <= view[2] && b[3] >= view[1] && b[1] <= view[3]; };
    for (let pass = 0; pass < 3 && !layer; pass++) for (const s of this.strokes) {
      if (only && !only.has(s)) continue;
      const t = this._tool(s), k = t === 'image' ? 0 : t === 'highlighter' ? 1 : 2;
      if (k !== pass || shown.has(s) || !vis(s)) continue;
      this._drawEl(s);
    }
    // the read ink in its view; strokes still moving into it are drawn by the animation
    const colOf = it => padColor((this.info.get(it.from[0]) || {}).color, this._darkP, ink), widthOf = it => (it.from[0] ? this._size(it.from[0]) : this.o.width);
    const F = this._focusing, fk = F ? Math.max(0, 1 - (performance.now() - F.t0) / F.ms) : 0;
    for (const it of items) {
      if (it.answer) {
        if (answers === 'none') continue;
        answerSetup();
        if (!this._answerShown(it, live, fresh)) continue;
        // waiting for a tap: out of focus at the board; a picture of the board leaves it out (no one can tap a picture,
        // and a blur is no lock), and an answer key (answers 'all') draws it sharp
        if (it.hidden && !(image && answers === 'all')) { if (!image) this._drawBlurred(ctx, it, ans); continue; }
        // just tapped: the blur eases away
        if (F && fk > 0 && !image && it.revealKey === F.key) { this._drawBlurred(ctx, it, ans, fk * fk); continue; }
        const was = A && A.from.get(it);
        if (was && e < 1) morphDraw(ctx, was, it, e, ans, this.o.width);
        else drawItems(ctx, [it], { ink: ans, width: this.o.width });
        continue;
      }
      if (layer || !it.from.every(s => live.has(s))) continue;
      const was = A && A.from.get(it);
      if (was && e < 1) morphDraw(ctx, was, it, e, colOf(it), widthOf(it));
      else drawItems(ctx, [it], { ink: colOf(it), width: widthOf(it) });
    }
    // views being left behind (back to ink, or symbols that no longer exist) fade out
    if (A && e < 1 && !only) {
      for (const g of A.leaving) {
        if (!g.answer || g.hidden || answers === 'none') continue;
        answerSetup(); if (this._answerShown(g, live, fresh)) drawItems(ctx, [g], { ink: ans, width: this.o.width, alpha: 1 - e });
      }
      for (const { g, rest } of leaving) {
        const raw = rawVisual(rest);
        if (raw.parts[0].paths.length) morphDraw(ctx, g, raw, e, colOf(g), widthOf(g));
      }
    }
    if (F && !image) { if (fk > 0) this._frame(); else this._focusing = null; }     // the next frame of an answer coming into focus
    if (image || layer) return;
    // what is being made right now: strokes (in their pen), shapes being dragged out, brief touches waiting for the pen
    for (const P of this.ptrs.values()) {
      if (P.mode === 'draw' && P.cur) {
        const T = P.tool || {};
        if (P.snap) { this._drawEl(P.snap.pts, Object.assign({ tool: T.kind === 'highlighter' ? 'highlighter' : 'shape', shape: P.snap.shape, size: this._toolWidth(T) }, T.color ? { color: T.color } : {})); continue; }
        this._drawEl(P.cur, Object.assign({ tool: T.kind || 'pen', size: this._toolWidth(T) }, T.color ? { color: T.color } : {}));
      } else if (P.mode === 'shape' && P.prev) {
        const S = this.shapeTool;
        const axes = P.prev.shape === 'numberline' || P.prev.shape === 'plane';
        this._drawEl(P.prev.pts, Object.assign({ tool: 'shape', shape: P.prev.shape, size: S.size || 3, opt: P.prev.opt }, S.color ? { color: S.color } : {}, S.fill && !axes ? { fill: S.fill } : {}, S.dash && !axes ? { dash: true } : {}));
      }
    }
    for (const q of this.pending) this._drawEl(q.s);       // brief touches waiting to see whether the pen follows
    // what a scribble just rubbed out, and the scribble, fading away
    const G = this._fade;
    if (G) {
      const k = 1 - (performance.now() - G.t0) / G.ms;
      if (k > 0) { ctx.save(); ctx.globalAlpha = 0.6 * k * k; for (const g of G.list) this._drawEl(g.s, g.E); ctx.restore(); this._frame(); }
      else this._fade = null;
    }
    // the eraser: a faint ring where it is
    for (const P of this.ptrs.values()) {
      if (P.mode !== 'erase' || !P.at) continue;
      ctx.save(); ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5 / this.cam.z; ctx.strokeStyle = ink;
      ctx.beginPath(); ctx.arc(P.at[0], P.at[1], P.r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    this._drawSel();
    this._drawLasers();
    if (this.o.boxes && this.result) this._boxes();
  }
  // The board as a picture: the ink as the view shows it (answers that are showing included), at `scale` times its
  // size in CSS px, on `background` with an optional dot grid ({color, spacing, offset, radius}). Returns a canvas.
  image(o) {
    o = o || {};
    const k = o.scale || 2, d = this.dpr || 1, W = this.canvas.width / d, H = this.canvas.height / d, z = this.cam.z;
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
    ctx.setTransform(k * z, 0, 0, k * z, -this.cam.x * k * z, -this.cam.y * k * z);
    const keep = { ctx: this.ctx, anim: this.anim };
    this.ctx = ctx; this.anim = null;
    try { this._paint(true, { paper: !(o.background || o.dots) }); } finally { this.ctx = keep.ctx; this.anim = keep.anim; }
    return c;
  }
  // everything on the page, in world units (with m around it; o.hidden: answers still waiting for a tap too), or null
  contentRect(m, o) {
    let b = null;
    for (const s of this.strokes) { const q = this._bounds(s); b = b ? ubox(b, q) : q.slice(); }
    if (this.plan) for (const it of this.plan.items) if (it.answer && (!it.hidden || (o && o.hidden)) && it.box) b = b ? ubox(b, it.box) : it.box.slice();
    if (!b) return null;
    m = m || 0;
    return [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
  }
  // A picture of part of the board: o.rect (world; default everything on it, with o.margin around), at o.scale canvas px
  // per world unit (default 2; smaller when the picture would pass o.maxPixels or 16,000 px a side), on its paper (o.paper
  // false: on o.background or clear; o.sheet: on this paper instead of the page's, {kind, tone}, or null for none), answers
  // as shown, all of them (an answer key) or none, o.only: just these elements.
  exportImage(o) {
    o = o || {};
    const sel = o.only ? new Set(o.only) : null;
    let rect = o.rect;
    if (!rect && sel) { let b = null; for (const s of sel) { const q = this._bounds(s); b = b ? ubox(b, q) : q.slice(); } const m = o.margin === undefined ? 16 : o.margin; rect = b && [b[0] - m, b[1] - m, b[2] + m, b[3] + m]; }
    if (!rect) rect = this.contentRect(o.margin === undefined ? 40 : o.margin, { hidden: o.answers === 'all' }) || this.viewRect;
    const W = Math.max(1, rect[2] - rect[0]), H = Math.max(1, rect[3] - rect[1]);
    let k = o.scale || 2;
    const most = o.maxPixels || 4e7;
    if (W * k * H * k > most) k = Math.sqrt(most / (W * H));
    k = Math.min(k, 16000 / W, 16000 / H);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
    const ctx = c.getContext('2d');
    if (o.background && (o.paper === false || !this.o.paper)) { ctx.fillStyle = o.background; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.setTransform(k, 0, 0, k, -rect[0] * k, -rect[1] * k);
    const keep = { ctx: this.ctx, anim: this.anim, cam: this.cam, paper: this.o.paper };
    // drawn as the board looks at 100% (paper lines, labels and the like at their size there), k times as many pixels
    this.ctx = ctx; this.anim = null; this.cam = { x: rect[0], y: rect[1], z: o.look || 1 };
    if (o.sheet !== undefined) this.o.paper = o.sheet;
    try { this._paint(true, { rect, paper: o.paper !== false, answers: o.answers || 'shown', only: sel }); }
    finally { this.ctx = keep.ctx; this.anim = keep.anim; this.cam = keep.cam; this.o.paper = keep.paper; this._ink(); }
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
        // an answer is written with the writer's own symbols: the problem's own first, then the board's equations (the
        // most typical of each, see sampleBook), then the Replicator hand, then the built-in one
        let hand = null;
        try { hand = this.o.hand ? handClean(handOf(this.o.hand)) : handLoad(); } catch (err) { hand = null; }
        sample = sampleBook(res, at, hand && Object.keys(hand).length ? hand : null);
      }
      const R = refSize(at), done = [], used = new Set();
      // writing still fresh is left as written: it changes into its view once the writer has rested
      const settle = style !== 'ink' ? Math.max(0, +this.o.settle || 0) : 0, now = performance.now();
      let holdUntil = 0;
      for (const part of res.parts || [{ strokes: at, result: res }]) {
        const near = sample && res.parts ? sample.near(res.parts.indexOf(part)) : sample;
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
        // an answer shown by a tap stays shown while its line (its strokes) and the answer itself are the same
        const rowSids = pr.tree.map(row => {
          const ids = [];
          const walk = r => { for (const u of r) { for (const k of u.strokes || []) if (part.strokes[k]) ids.push(this._sid(part.strokes[k])); for (const key of ['num', 'den', 'body', 'idx', 'sup', 'sub']) if (u[key]) walk(u[key]); } };
          walk(row);
          return ids;
        });
        // an answer keeps the look it was first drawn with (1.6.5, Croix: "I like that nib adapts as I go, but I don't
        // like it to constantly update the previous answers"): each symbol of it is taken from the board's writing once,
        // and kept while its line and the answer itself are the same, in this view — what Nib learns after shows in the
        // answers that come after
        const sampleFor = k => {
          const a = answers && answers[k];
          if (!a || !near) return null;
          const sids = rowSids[k].slice().sort((x, y) => x - y), hand = this.o.hand ? 'h' : '';
          const key = sids.join(',') + '|' + a.latex + '|' + style + '|' + hand;
          let L = this._looks.get(key);
          if (!L) { L = { sids, answer: a.latex, view: style, hand, glyphs: new Map() }; this._looks.set(key, L); }
          used.add(key);
          return label => {
            if (!L.glyphs.has(label)) {
              const v = near(label);
              L.glyphs.set(label, { pts: v ? v.map(s => s.map(q => [q[0], q[1]])) : v, src: v && sample && sample.srcOf ? sample.srcOf(v) : null, dflt: !!v && v === DEFAULT_GLYPHS[label] });
            }
            return L.glyphs.get(label).pts;
          };
        };
        try { out = inPlace(part.strokes, style, { result: pr, hand: this.o.hand || undefined, answers: answers ? answers.map(a => a && a.nodes) : null, sample: near, sampleFor }); } catch (err) { out = null; }
        if (!out) continue;
        const groups = new Map();
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
      if (this._looks.size > 400) for (const key of [...this._looks.keys()]) if (!used.has(key)) this._looks.delete(key);
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
  // An answer that would run off the right edge of the board (on an endless board: of the view, as the writer sees it
  // when it is worked out): squeezed to fit after its "=", or, when that would make it smaller than 0.6 of the writing,
  // written at full size under its line, ending at the edge (where there is room below; otherwise squeezed anyway, to
  // no less than 0.35).
  _fitAnswers(items) {
    const v = this.viewRect, m = 10 / this.cam.z, X1 = v[2], Y1 = v[3];
    if (X1 - v[0] < 4 * m) return;
    const groups = new Map();
    for (const it of items) if (it.answer && it.group) { if (!groups.has(it.groupKey)) groups.set(it.groupKey, []); groups.get(it.groupKey).push(it); }
    for (const list of groups.values()) {
      const b = list[0].group, w = b[2] - b[0], h = b[3] - b[1];
      if (b[2] <= X1 - m || w <= 0 || b[0] >= X1 - m) continue;      // it ends in sight, or begins out of it
      let k = (X1 - m - b[0]) / w, dx = 0, dy = 0;
      if (k < 0.6 && w <= X1 - v[0] - 2 * m && b[3] + 1.4 * h <= Y1 - m) { k = 1; dx = X1 - m - b[2]; dy = 1.35 * h; }
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
    // the view on screen until now is the one to keep when the writer has not moved the board yet
    if (changed && this.o.infinite && this._sized && !this._want) this._want = { r: this.viewRect, z: this.cam.z };
    if (changed) { c.width = w; c.height = h; }
    this.dpr = d;
    if (r.width >= 2 && r.height >= 2) this._sized = true;
    if (changed && this.o.infinite) this._camQuiet(() => { if (this.o.page ? this._pageCam() : this._fitView()) this._camMoved(true); });
    // a board turned or made smaller: the ink is brought back in (once, undoable)
    if (changed && this.o.fit && !this.o.infinite && this._fit(r.width, r.height)) return;
    // answers near an edge are fitted to the board's size: lay them out again for the new one
    if (changed && this.answers && this.answers.length && this.result) this._replan(false);
    this.redraw();
  }
  // When the ink no longer fits the pad, it is scaled (never up) about its top-left corner and moved so it all sits
  // at least 16 px inside, as one undoable step; corrections stay with their strokes (the strokes are the same
  // objects, moved), and what is on screen moves at once while the reading catches up.
  _fit(W, H) {
    if (this.o.infinite || this.ptrs.size || !this.strokes.length || W < 120 || H < 120) return false;
    const b = this.strokes.map(sbox).reduce(ubox), m = 16, tol = 8;
    if (b[0] >= -tol && b[1] >= -tol && b[2] <= W + tol && b[3] <= H + tol) return false;
    const bw = Math.max(b[2] - b[0], 1e-6), bh = Math.max(b[3] - b[1], 1e-6);
    const k = Math.min(1, (W - 2 * m) / bw, (H - 2 * m) / bh);
    if (!(k > 0)) return false;
    const x0 = Math.max(m, Math.min(b[0], W - m - bw * k)), y0 = Math.max(m, Math.min(b[1], H - m - bh * k));
    const t = [b[0], b[1], x0, y0, k];
    for (const s of this.strokes) this._sidHash(s);     // the training log knows this writing by where it was written: keep that name through the move
    const move = this.strokes.map(s => [s, s.map(p => p.slice()), s.map(p => { const q = p.slice(); q[0] = x0 + (p[0] - b[0]) * k; q[1] = y0 + (p[1] - b[1]) * k; return q; })]);
    const h = { move, t };
    this._apply(h, false);
    this._push(h);
    this._changed();
    return true;
  }
  // the view moved with the ink: t = [ax, ay, bx, by, k] maps x to bx + (x - ax)·k (back: the other way)
  // the view's items drawn from these elements (and the answers after their "="), kept as they are now, to move with them
  _planOf(set) {
    if (!this.plan) return [];
    return this.plan.items.filter(it => (it.from.length && it.from.every(s => set.has(s))) || (it.answer && it.eqFrom && it.eqFrom.length && it.eqFrom.every(s => set.has(s))))
      .map(it => ({ it, parts: it.parts, box: it.box.slice(), group: it.group ? it.group.slice() : null, em: it.em }));
  }
  // those items, mapped from where they were kept by x → X(x), y → Y(y) (k: how much sizes change)
  _planTo(kept, X, Y, k) {
    if (!kept || !kept.length || !this.plan) return;
    for (const v of kept) {
      const it = v.it;
      it.parts = mapParts(v.parts, X, Y, k); it.box = [X(v.box[0]), Y(v.box[1]), X(v.box[2]), Y(v.box[3])];
      if (v.group) it.group = [X(v.group[0]), Y(v.group[1]), X(v.group[2]), Y(v.group[3])];
      if (v.em) it.em = v.em * k;
    }
    this.plan.chips = this._chips(this.plan.items);
    this.anim = null;
  }
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

  // ---------------------------------------------------------------- canvas tools
  // ---- draw and hold: a line, circle, box or triangle held still at its end becomes that shape
  _holdTimer(P) {
    clearTimeout(P.hold);
    if (!this.o.hold || P.mode !== 'draw' || P.fix || P.snap || P.chip || typeof shapeRecognize !== 'function') return;
    P.hold = setTimeout(() => {
      if (this.ptrs.get(P.id) !== P || P.snap || !P.cur || P.cur.length < 6) return;
      const b = sbox(P.cur), big = Math.max(b[2] - b[0], b[3] - b[1]);
      let r = null;
      try { r = shapeRecognize(P.cur, { z: this.cam.z }); } catch (e) { r = null; }
      if (!r || !r.pts || (P.tool.kind === 'highlighter' && r.shape !== 'line')) return;
      // Only something bigger than the writing is meant as a shape: a 1, a 0 or a fraction bar held still a moment
      // stays writing (and is read). A line at least 80 px on screen and 4 times the board's typical stroke, anything
      // else 48 px and 2.5 times (with fewer than three strokes of writing on the board, the pixel sizes alone).
      const ink = this.ink, line = r.shape === 'line' || r.shape === 'arrow';
      const ref = ink.length >= 3 ? refSize(ink) : 0;
      if (big * this.cam.z < (line ? 80 : 48) || big < (line ? 4 : 2.5) * ref) return;
      P.snap = r; P.snapAt = P.cur[P.cur.length - 1]; this.why = 'shape: ' + r.shape;
      this.redraw();
    }, 600);
  }
  // ---- shapes dragged out with the shape tool (a tap makes one of a standard size)
  _shapeUp(P, e) {
    let prev = P.prev;
    // a finger's tap within 3 s of the pen is the heel of the hand (a finger placing a shape or text later is a finger)
    if (!prev && P.type === 'touch' && this.o.palm !== false && performance.now() - this.penSeen < 3000) { this.why = 'ignored: tap beside the pen'; this.redraw(); return; }
    if (!prev && e && e.type === 'pointerup' && typeof shapeFromDrag === 'function') prev = shapeFromDrag(this.shapeTool.kind, P.a, P.a, { snap: this.o.snap, angle: true, z: this.cam.z });
    if (!prev || !prev.pts || !prev.pts.length) { this.redraw(); return; }
    const S = this.shapeTool, s = prev.pts.map(q => [q[0], q[1]]);
    const info = { type: ['pen', 'touch', 'mouse'].includes(P.type) ? P.type : null, width: null, tool: 'shape', shape: prev.shape, size: +S.size > 0 ? +S.size : 3 };
    if (S.color) info.color = S.color;
    // a number line or a plane is a placed thing to write on: it takes the color and width, not a fill or dashes
    const axes = prev.shape === 'numberline' || prev.shape === 'plane';
    if (S.fill && !axes) info.fill = S.fill;
    if (S.dash && !axes) info.dash = true;
    if (prev.opt) info.opt = Object.assign({}, prev.opt);
    this.info.set(s, info);
    this.strokes.push(s); this._push({ add: s });
    this._changed();
    this.el.dispatchEvent(new CustomEvent('nib:shape', { detail: { shape: prev.shape, element: s }, bubbles: true }));
  }
  // ---- the laser pointer: a bright trail that fades, never kept
  _laserLoop() {
    if (this._laserRaf || typeof requestAnimationFrame === 'undefined') return;
    const tick = () => {
      this._laserRaf = 0;
      const now = performance.now();
      this.lasers = this.lasers.filter(L => now - L.end < 700);
      const on = [...this.ptrs.values()].some(P => P.mode === 'laser');
      this.redraw();
      if (on || this.lasers.length) this._laserRaf = requestAnimationFrame(tick);
    };
    this._laserRaf = requestAnimationFrame(tick);
  }
  _drawLasers() {
    const trails = [];
    for (const P of this.ptrs.values()) if (P.mode === 'laser' && P.cur) trails.push({ pts: P.cur, end: 0 });
    trails.push(...this.lasers);
    if (!trails.length) return;
    const ctx = this.ctx, z = this.cam.z, now = performance.now();
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const L of trails) {
      const fade = L.end ? Math.max(0, 1 - (now - L.end) / 700) : 1;
      // the last 0.8 s of the trail, fainter towards its tail
      const pts = L.pts.filter(q => now - q[2] < 800 || q === L.pts[L.pts.length - 1]);
      for (let i = 1; i < pts.length; i++) {
        const a = Math.max(0, 1 - (now - pts[i][2]) / 800) * fade;
        if (a <= 0) continue;
        ctx.strokeStyle = `rgba(255,59,48,${0.22 * a})`; ctx.lineWidth = 14 / z;
        ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
        ctx.strokeStyle = `rgba(255,59,48,${a})`; ctx.lineWidth = 4 / z;
        ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
      }
      const tip = L.pts[L.pts.length - 1];
      if (tip && fade > 0) {
        ctx.fillStyle = `rgba(255,59,48,${0.3 * fade})`; ctx.beginPath(); ctx.arc(tip[0], tip[1], 11 / z, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,90,80,${fade})`; ctx.beginPath(); ctx.arc(tip[0], tip[1], 5 / z, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  // ---- select: a lasso (pen, finger) or a box (mouse) picks elements; drag them, or a handle to make them bigger or smaller
  _liveSel() { if (!this.selection.size) return []; const live = new Set(this.strokes); return [...this.selection].filter(s => live.has(s)); }
  _setSel(list) {
    const before = this.selection.size;
    this.selection = new Set(list || []);
    if (before || this.selection.size) this._selChanged();
  }
  _dropDead() { if (this.selection.size) { const n = this.selection.size, live = this._liveSel(); if (live.length !== n) { this.selection = new Set(live); this._selChanged(); } } }
  _selChanged() {
    const sel = this._liveSel(), b = sel.length ? this._selBox(sel) : null;
    const box = b ? [...this.toScreen([b[0], b[1]]), ...this.toScreen([b[2], b[3]])] : null;
    this.el.dispatchEvent(new CustomEvent('nib:select', { detail: { count: sel.length, box, kinds: [...new Set(sel.map(s => this._tool(s)))] }, bubbles: true }));
  }
  get selected() { return this._liveSel(); }
  // The selection's frame: 18 screen px off what it holds and never under 96 px a side, so its handles sit clear of the
  // writing and a short stroke still has room inside to drag — Deckhand 7.60.1's lasso frame, made for Croix's panel
  // ("I have trouble grabbing a corner to move, increase or decrease a selected item").
  _selBox(sel) {
    let b = null;
    for (const s of sel) { const q = this._bounds(s); b = b ? ubox(b, q) : q.slice(); }
    const z = this.cam.z, m = 18 / z, mn = 96 / z;
    const w = Math.max(b[2] - b[0] + 2 * m, mn), h = Math.max(b[3] - b[1] + 2 * m, mn), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  }
  // the 8 handles of a selection box, on screen
  _handles(b) {
    const [x0, y0] = this.toScreen([b[0], b[1]]), [x1, y1] = this.toScreen([b[2], b[3]]), xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
    return { nw: [x0, y0], n: [xm, y0], ne: [x1, y0], e: [x1, ym], se: [x1, y1], s: [xm, y1], sw: [x0, y1], w: [x0, ym] };
  }
  _handleAt(b, sp, touch) {
    const H = this._handles(b), r = touch ? 22 : 14;          // a fingertip's grab (44 px) on a panel
    let best = null, bd = Infinity;
    for (const k in H) { const d = Math.hypot(H[k][0] - sp[0], H[k][1] - sp[1]); if (d <= r && d < bd) { best = k; bd = d; } }
    return best;
  }
  // the topmost element at a point (objects: only shapes, text and pictures, which can be picked up and dragged at once)
  elementAt(p, objects) {
    const r = (objects ? 12 : 8) / this.cam.z;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i], t = this._tool(s);
      if (objects && t !== 'shape' && t !== 'text' && t !== 'image') continue;
      if (this._hit(s, p, r)) return s;
    }
    return null;
  }
  _selectDown(P, p, e) {
    P.p0 = p;
    const sel = this._liveSel(), sp = this.toScreen(p);
    if (sel.length) {
      const b = this._selBox(sel), h = this._handleAt(b, sp, P.type !== 'mouse');
      if (h) { P.op = { kind: 'scale', h, b0: b, orig: sel.map(s => [s, s.map(q => q.slice())]), items: this._planOf(new Set(sel)) }; return; }
      // inside the frame, or a near miss just outside it (16 px), moves it
      const nm = 16 / this.cam.z;
      if (p[0] >= b[0] - nm && p[0] <= b[2] + nm && p[1] >= b[1] - nm && p[1] <= b[3] + nm) { P.op = { kind: 'move', orig: sel.map(s => [s, s.map(q => q.slice())]), items: this._planOf(new Set(sel)) }; return; }
    }
    // the lasso tool: a loop drawn round what to select, starting anywhere (on writing too); a tap still picks one thing
    let hit = this.lassoOnly ? null : this.elementAt(p, true);
    if (hit && !this.selection.has(hit)) {
      const t = this._tool(hit), E = this.info.get(hit) || {};
      if (t === 'image' || (t === 'shape' && (E.shape === 'plane' || E.shape === 'numberline'))) {
        const b = this._bounds(hit), m = 14 / this.cam.z;
        if (p[0] - b[0] > m && b[2] - p[0] > m && p[1] - b[1] > m && b[3] - p[1] > m) hit = null;
      }
    }
    if (hit) {
      P.tapped = this.selection.size === 1 && this.selection.has(hit) ? hit : null;
      this._setSel([hit]);
      P.op = { kind: 'move', orig: [[hit, hit.map(q => q.slice())]] };
      this.redraw();
      return;
    }
    P.lasso = [p]; P.box = P.type === 'mouse' && !this.lassoOnly;
    if (this.selection.size) { this._setSel([]); this.redraw(); }
  }
  _selectMove(P, p) {
    if (P.op) {
      const O = P.op;
      // a hand that hardly moved has not moved anything (a tap)
      if (!O.moved && Math.hypot(p[0] - P.p0[0], p[1] - P.p0[1]) * this.cam.z < 3) return;
      if (O.kind === 'move') {
        const dx = p[0] - P.p0[0], dy = p[1] - P.p0[1];
        for (const [s, was] of O.orig) { for (let i = 0; i < s.length; i++) { s[i][0] = was[i][0] + dx; s[i][1] = was[i][1] + dy; } this._touched(s); }
        this._planTo(O.items, x => x + dx, y => y + dy, 1);
      } else {
        const b = O.b0, h = O.h, W = Math.max(b[2] - b[0], 1e-6), H = Math.max(b[3] - b[1], 1e-6);
        const ax = h.includes('w') ? b[2] : b[0], ay = h.includes('n') ? b[3] : b[1];
        let kx = h.includes('e') ? (p[0] - b[0]) / W : h.includes('w') ? (b[2] - p[0]) / W : 1;
        let ky = h.includes('s') ? (p[1] - b[1]) / H : h.includes('n') ? (b[3] - p[1]) / H : 1;
        kx = Math.max(0.05, kx); ky = Math.max(0.05, ky);
        if (h.length === 2) kx = ky = Math.max(kx, ky);     // a corner keeps the proportions
        for (const [s, was] of O.orig) {
          const t = this._tool(s);
          // text and pictures keep their shape from a side handle too
          const kxx = (t === 'text' || t === 'image') && h.length === 1 ? (h === 'e' || h === 'w' ? kx : ky) : kx;
          const kyy = (t === 'text' || t === 'image') && h.length === 1 ? kxx : ky;
          for (let i = 0; i < s.length; i++) { s[i][0] = ax + (was[i][0] - ax) * kxx; s[i][1] = ay + (was[i][1] - ay) * kyy; }
          this._touched(s);
        }
        this._planTo(O.items, x => ax + (x - ax) * kx, y => ay + (y - ay) * ky, Math.sqrt(kx * ky));
      }
      O.moved = true;
      this._frame();
      return;
    }
    if (P.lasso) { P.lasso.push(p); this._frame(); }
  }
  _selectUp(P, e) {
    if (P.op) {
      const O = P.op;
      if (!O.moved) {
        // a tap on a text that was already selected: write in it
        if (P.tapped && this._tool(P.tapped) === 'text' && e && e.type === 'pointerup') { this._editText(P.tapped, false); return; }
        // a tap inside a group: just what is under it (or nothing)
        if (O.orig.length > 1 && e && e.type === 'pointerup') { const hit = this.elementAt(P.p0); this._setSel(hit ? [hit] : []); }
        this.redraw(); this._selChanged(); return;
      }
      const h = { move: null, t: null }, rs = [];
      // a text made bigger or smaller: its size follows its box, and the box fits its text again
      for (const [s] of O.orig) {
        const E = this.info.get(s);
        if (!E || E.tool !== 'text') continue;
        const k = this._textScale(s, E);
        if (Math.abs(k - 1) < 1e-3) continue;
        const now = Object.assign({}, E, { size: Math.max(4, Math.round(E.size * k * 10) / 10) });
        this.info.set(s, now); rs.push([s, E, now]); this._fitText(s);
      }
      h.move = O.orig.map(([s, was]) => [s, was, s.map(q => q.slice())]);
      if (rs.length) h.restyle = rs;
      this._inkMoved(O.orig.map(([s]) => s), O.kind === 'scale');
      this._push(h);
      this._changed();
      this._selChanged();
      return;
    }
    if (!P.lasso) return;
    const L = P.lasso, b = sbox(L);
    P.lasso = null;
    if (Math.max(b[2] - b[0], b[3] - b[1]) * this.cam.z < 8) { const hit = this.elementAt(P.p0); this._setSel(hit ? [hit] : []); }
    else {
      const poly = P.box ? [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] : L;
      this._setSel(this.strokes.filter(s => this._inLasso(s, poly)));
    }
    this.redraw();
  }
  // in the lasso: most of a stroke's points, the middle of a shape or text, or all of a picture, number line or plane
  // (things writing goes on: a lasso round the writing on one leaves it where it is)
  _inLasso(s, poly) {
    const t = this._tool(s), E = this.info.get(s) || {};
    if (t === 'image' || (t === 'shape' && (E.shape === 'plane' || E.shape === 'numberline'))) {
      const b = this._bounds(s);
      return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].every(q => padInPoly(q, poly));
    }
    if (t === 'shape' || t === 'text') { const b = this._bounds(s); return padInPoly([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], poly); }
    let n = 0;
    for (const q of s) if (padInPoly(q, poly)) n++;
    return n >= Math.max(1, 0.6 * s.length);
  }
  _drawSel() {
    const ctx = this.ctx, z = this.cam.z;
    for (const P of this.ptrs.values()) {
      if (P.mode !== 'select' || !P.lasso || P.lasso.length < 2) continue;
      ctx.save(); ctx.strokeStyle = 'rgba(201,162,39,.95)'; ctx.fillStyle = 'rgba(201,162,39,.08)'; ctx.lineWidth = 1.5 / z; ctx.setLineDash([5 / z, 4 / z]);
      ctx.beginPath();
      if (P.box) { const b = sbox(P.lasso); ctx.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]); }
      else { ctx.moveTo(P.lasso[0][0], P.lasso[0][1]); for (const q of P.lasso) ctx.lineTo(q[0], q[1]); ctx.closePath(); }
      ctx.fill(); ctx.stroke(); ctx.restore();
    }
    const sel = this._liveSel();
    if (!sel.length) return;
    const b = this._selBox(sel);
    ctx.save();
    ctx.strokeStyle = 'rgba(201,162,39,.95)'; ctx.lineWidth = 1.5 / z; ctx.setLineDash([6 / z, 4 / z]);
    ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    ctx.setLineDash([]);
    // each element of a group, faintly
    if (sel.length > 1) { ctx.strokeStyle = 'rgba(201,162,39,.35)'; ctx.lineWidth = 1 / z; for (const s of sel) { const q = this._bounds(s); ctx.strokeRect(q[0], q[1], q[2] - q[0], q[3] - q[1]); } }
    const H = this._handles(b), hs = 11 / z;                  // 22 px handles, finger-sized
    ctx.fillStyle = this._paperC || '#ffffff'; ctx.strokeStyle = 'rgba(201,162,39,1)'; ctx.lineWidth = 1.5 / z;
    for (const k in H) {
      const w = this.toWorld(H[k][0], H[k][1]);
      ctx.beginPath(); ctx.rect(w[0] - hs, w[1] - hs, 2 * hs, 2 * hs); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  // ink that moved is read again where it is (made bigger or smaller: classified again too)
  _inkMoved(list, scaled) {
    if (!list.some(s => this._isInk(s))) return;
    this.parts.clear();
    if (scaled) { this.recs = new WeakMap(); this.rec = new Recognizer(); }
  }
  // what pointers do: 'draw' (this.tool), 'erase', 'fix', 'select', 'pan', 'shape' (this.shapeTool), 'text' (this.textTool), 'laser'
  setMode(m) {
    const lasso = m === 'lasso';                          // select mode in which a drag always draws a lasso
    if (lasso) m = 'select';
    m = ['draw', 'erase', 'fix', 'select', 'pan', 'shape', 'text', 'laser'].includes(m) ? m : 'draw';
    if (this.editing && m !== 'text' && m !== 'select') this._commitText();
    if (m !== 'select' && this.selection.size) this._setSel([]);
    this.mode = m; this.lassoOnly = lasso;
    this._cursor();
    this.redraw();
  }
  select(list) { this._setSel((list || []).filter(s => this.strokes.includes(s))); this.redraw(); }
  selectAll() { this._setSel(this.strokes.slice()); this.redraw(); }
  clearSelection() { if (this.selection.size) { this._setSel([]); this.redraw(); } }
  // take the selection away (one undoable step); returns how many went
  deleteSelection() {
    if (!this.selection.size) return 0;
    const erase = [];
    for (let i = this.strokes.length - 1; i >= 0; i--) if (this.selection.has(this.strokes[i])) { erase.push({ i, s: this.strokes[i] }); this.strokes.splice(i, 1); }
    this._setSel([]);
    if (!erase.length) return 0;
    this._push({ erase }); this._changed();
    return erase.length;
  }
  // the selection as data to paste later (on this page or another): {v, items: [{pts, info}], box}
  copySelection() {
    const sel = this._liveSel();
    if (!sel.length) return null;
    const items = sel.map(s => ({ pts: s.map(q => q.slice()), info: Object.assign({}, this.info.get(s) || {}) }));
    const clip = { v: 1, items, box: this._selBox(sel) };
    this._clip = clip;
    return clip;
  }
  // put copied elements on the board (one undoable step), centered on world point at (default: offset from where they were
  // copied, or the middle of the view when that is out of sight); they come selected
  paste(clip, at) {
    clip = clip || this._clip;
    if (!clip || !Array.isArray(clip.items) || !clip.items.length) return [];
    const b = clip.box || [0, 0, 0, 0], v = this.viewRect;
    let dx, dy;
    if (at) { dx = at[0] - (b[0] + b[2]) / 2; dy = at[1] - (b[1] + b[3]) / 2; }
    else {
      dx = dy = 24 / this.cam.z;
      const cx = (b[0] + b[2]) / 2 + dx, cy = (b[1] + b[3]) / 2 + dy;
      if (cx < v[0] || cx > v[2] || cy < v[1] || cy > v[3]) { dx = (v[0] + v[2]) / 2 - (b[0] + b[2]) / 2; dy = (v[1] + v[3]) / 2 - (b[1] + b[3]) / 2; }
    }
    const ops = [], made = [];
    for (const it of clip.items) {
      if (!Array.isArray(it.pts) || !it.pts.length) continue;
      const s = it.pts.map(q => { const c = q.slice(); c[0] += dx; c[1] += dy; return c; });
      const E = Object.assign({}, it.info || {});
      if (E.tool === 'image' && E.img && !this.images.has(E.img)) this._needImage(E.img);
      this.info.set(s, E);
      ops.push({ ins: this.strokes.length, s }); this.strokes.push(s); made.push(s);
    }
    if (!made.length) return [];
    this._push({ ops });
    this._setSel(made);
    this._changed();
    return made;
  }
  duplicateSelection() { const c = this.copySelection(); return c ? this.paste(c) : []; }
  // a new look for what is selected: {color, size, fill, dash} (what applies to each element; one undoable step)
  restyleSelection(f) {
    const sel = this._liveSel(), rs = [];
    for (const s of sel) {
      const E = this.info.get(s) || {}, t = E.tool || 'pen', now = Object.assign({}, E);
      if ('color' in f && t !== 'image') { if (f.color) now.color = f.color; else delete now.color; }
      if ('size' in f && +f.size > 0 && t !== 'image' && t !== 'text') now.size = +f.size;
      if ('textSize' in f && +f.textSize > 0 && t === 'text') now.size = +f.textSize;
      if ('fill' in f && t === 'shape') { if (f.fill) now.fill = f.fill; else delete now.fill; }
      if ('dash' in f && t === 'shape') { if (f.dash) now.dash = true; else delete now.dash; }
      if ('opt' in f && f.opt && t === 'shape' && (E.shape === 'numberline' || E.shape === 'plane')) now.opt = Object.assign({}, E.opt || {}, f.opt);
      if (JSON.stringify(now) === JSON.stringify(E)) continue;
      rs.push([s, this.info.get(s), now]);
    }
    if (!rs.length) return 0;
    const h = { restyle: rs };
    // a text with a new size: its box fits it again
    const mv = [];
    for (const [s, , now] of rs) { this.info.set(s, now); this._touched(s); if (now.tool === 'text') { const was = s.map(q => q.slice()); this._fitText(s); mv.push([s, was, s.map(q => q.slice())]); } }
    if (mv.length) { h.move = mv; h.t = null; }
    this._push(h); this._changed(); this._selChanged();
    return rs.length;
  }
  // to the front or the back of everything (one undoable step)
  orderSelection(front) {
    const sel = this._liveSel();
    if (!sel.length) return;
    const keep = this.strokes.filter(s => this.selection.has(s)), ops = [];
    for (let i = this.strokes.length - 1; i >= 0; i--) if (this.selection.has(this.strokes[i])) { ops.push({ rm: i, s: this.strokes[i] }); this.strokes.splice(i, 1); }
    keep.forEach((s, k) => { const at = front ? this.strokes.length : k; this.strokes.splice(at, 0, s); ops.push({ ins: at, s }); });
    this._push({ ops }); this._changed();
  }
  // move what is selected by (dx, dy) screen px (the arrow keys)
  nudgeSelection(dx, dy) {
    const sel = this._liveSel();
    if (!sel.length) return;
    const wx = dx / this.cam.z, wy = dy / this.cam.z, move = [], items = this._planOf(new Set(sel));
    this._planTo(items, x => x + wx, y => y + wy, 1);
    for (const s of sel) { const was = s.map(q => q.slice()); for (const q of s) { q[0] += wx; q[1] += wy; } this._touched(s); move.push([s, was, s.map(q => q.slice())]); }
    this._inkMoved(sel, false);
    this._push({ move, t: null }); this._changed(); this._selChanged();
  }
  // ---- text: a tap with the text tool starts a text box (or opens the one tapped); a tap elsewhere ends it
  _textAt(p) {
    const hit = this.elementAt(p, true);
    if (hit && this._tool(hit) === 'text') { this._editText(hit, false); return; }
    const T = this.textTool, size = +T.size > 0 ? +T.size : 32;
    const s = [[p[0], p[1] - 0.6 * size], [p[0] + size, p[1] + 0.65 * size]];
    const info = { type: null, width: null, tool: 'text', size, text: '' };
    if (T.color) info.color = T.color;
    this.info.set(s, info);
    this._editText(s, true);
  }
  _dbl(e) {
    if (this.mode !== 'select' && this.mode !== 'text') return;
    const hit = this.elementAt(this._pt(e), true);
    if (hit && this._tool(hit) === 'text') this._editText(hit, false);
  }
  _editText(s, isNew) {
    this._commitText();
    if (typeof document === 'undefined') return;
    const E = this.info.get(s);
    const ta = document.createElement('textarea');
    ta.value = E.text || ''; ta.setAttribute('aria-label', 'Text'); ta.setAttribute('part', 'text'); ta.wrap = 'off'; ta.spellcheck = true;
    ta.style.cssText = 'position:absolute;z-index:3;margin:0;box-sizing:content-box;padding:2px 6px;border:1.5px dashed rgba(201,162,39,.95);border-radius:6px;'
      + 'background:transparent;resize:none;overflow:hidden;outline:none;white-space:pre;line-height:1.25;font-weight:500;min-width:2ch;';
    this.el.appendChild(ta);
    this.editing = { el: s, ta, isNew };
    ta.addEventListener('input', () => this._placeEditor());
    ta.addEventListener('keydown', ev => {
      ev.stopPropagation();                                 // the Board's keys (E, S, 1 … 4) are letters here
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); this._commitText(); }
    });
    ta.addEventListener('blur', () => setTimeout(() => { if (this.editing && this.editing.ta === ta && document.activeElement !== ta) this._commitText(); }, 120));
    this._placeEditor();
    this.redraw();
    try { ta.focus({ preventScroll: true }); } catch (err) { ta.focus(); }
    this.el.dispatchEvent(new CustomEvent('nib:edit', { detail: { editing: true }, bubbles: true }));
  }
  _placeEditor() {
    const ed = this.editing;
    if (!ed) return;
    const s = ed.el, E = this.info.get(s), z = this.cam.z, ta = ed.ta;
    const k = ed.isNew ? 1 : this._textScale(s, E), size = (+E.size || 32) * k * z;
    const x = Math.min(s[0][0], s[1][0]), y = Math.min(s[0][1], s[1][1]), sc = this.toScreen([x, y]);
    ta.style.left = (sc[0] - 7.5) + 'px'; ta.style.top = (sc[1] - 3.5) + 'px';
    ta.style.fontFamily = PAD_FONT; ta.style.fontSize = size + 'px';
    ta.style.color = padColor(E.color, this._darkP, this._inkC || '#1b2a4a');
    const lines = ta.value.split('\n'), ctx = this.ctx;
    ctx.save(); ctx.font = `500 ${size}px ${PAD_FONT}`;
    const w = Math.max(size * 0.6, ...lines.map(l => ctx.measureText(l).width));
    ctx.restore();
    ta.style.width = Math.ceil(w + size * 0.5) + 'px'; ta.style.height = Math.ceil(lines.length * 1.25 * size) + 'px';
  }
  // the text box is done: kept (a new one added, a changed one changed: one undoable step), or gone when it is empty
  _commitText() {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const { el: s, ta, isNew } = ed, E = this.info.get(s);
    const text = ta.value.replace(/[\s ]+$/, '');
    ta.remove();
    if (isNew) {
      if (text.trim()) {
        this.info.set(s, Object.assign({}, E, { text })); this._fitText(s);
        this.strokes.push(s); this._push({ add: s }); this._setSel([]); this._changed();
      } else this.redraw();
    } else {
      const i = this.strokes.indexOf(s);
      if (i < 0) this.redraw();
      else if (!text.trim()) { this.strokes.splice(i, 1); this._push({ erase: [{ i, s }] }); this._dropDead(); this._changed(); }
      else if (text !== E.text) {
        const was = s.map(q => q.slice()), now = Object.assign({}, E, { text });
        // keep its look (a box made bigger or smaller keeps its size)
        now.size = Math.max(4, Math.round((+E.size || 32) * this._textScale(s, E) * 10) / 10);
        this.info.set(s, now); this._fitText(s);
        this._push({ restyle: [[s, E, now]], move: [[s, was, s.map(q => q.slice())]], t: null }); this._changed();
      } else this.redraw();
    }
    this.el.dispatchEvent(new CustomEvent('nib:edit', { detail: { editing: false }, bubbles: true }));
  }
  // ---- pictures: kept by id (the page that holds the pad stores them; nib:needimage asks for one it does not have)
  putImage(id, src) {
    if (!id || !src || typeof Image === 'undefined') return null;
    const have = this.images.get(id);
    if (have && have.src === src) return have;
    const rec = { src, img: new Image(), ok: false, bad: false };
    rec.img.onload = () => { rec.ok = true; this._frame(); };
    rec.img.onerror = () => { rec.bad = true; this._frame(); };
    rec.img.src = src;
    this.images.set(id, rec);
    return rec;
  }
  _needImage(id) {
    if (!id) return;
    if (!this._asked) this._asked = new Set();
    if (this._asked.has(id)) return;
    this._asked.add(id);
    this.el.dispatchEvent(new CustomEvent('nib:needimage', { detail: { id }, bubbles: true }));
  }
  // a picture (a data: URL) on the board: in the middle of the view (or at o.at), at most 70% of it; one undoable step;
  // it comes selected; resolves to the element (nib:image {id, src} is sent so the page can keep the picture)
  async addImage(src, o) {
    o = o || {};
    const id = o.id || ('img-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8));
    const rec = this.putImage(id, src);
    if (!rec) return null;
    if (!rec.ok && !rec.bad) await new Promise(res => { rec.img.addEventListener('load', res, { once: true }); rec.img.addEventListener('error', res, { once: true }); });
    if (rec.bad) { this.images.delete(id); return null; }
    const v = this.viewRect, vw = v[2] - v[0], vh = v[3] - v[1];
    const iw = rec.img.naturalWidth || 400, ih = rec.img.naturalHeight || 300, k = Math.min(1 / (o.dpr || 1), 0.7 * vw / iw, 0.7 * vh / ih);
    const w = iw * k, h = ih * k, c = o.at || [(v[0] + v[2]) / 2, (v[1] + v[3]) / 2];
    const s = [[c[0] - w / 2, c[1] - h / 2], [c[0] + w / 2, c[1] + h / 2]];
    this.info.set(s, { type: null, width: null, tool: 'image', img: id });
    this.strokes.push(s); this._push({ add: s });
    this._setSel([s]);
    this._changed();
    this.el.dispatchEvent(new CustomEvent('nib:image', { detail: { id, src }, bubbles: true }));
    return s;
  }
  // the ids of the pictures on the page now
  imageIds() { const out = new Set(); for (const s of this.strokes) { const E = this.info.get(s); if (E && E.tool === 'image' && E.img) out.add(E.img); } return [...out]; }
  // an element made in code: points (world) and its look ({tool, color, size, shape, ...}); one undoable step
  addElement(pts, look) {
    if (!Array.isArray(pts) || !pts.length) return null;
    const s = pts.map(q => [+q[0], +q[1]]);
    this.info.set(s, Object.assign({ type: null, width: null }, look || {}));
    this.strokes.push(s); this._push({ add: s }); this._changed();
    return s;
  }
  // an element's look (a copy), or null
  lookOf(s) { const E = this.info.get(s); return E ? Object.assign({}, E) : null; }
  // ---------------------------------------------------------------- state
  _changed() {
    this._dropDead();
    this.redraw();
    if (this.o.onChange) this.o.onChange(this);
    this.el.dispatchEvent(new CustomEvent('nib:change', { detail: this, bubbles: true }));
    if (!this.ink.length) { clearTimeout(this.timer); this.gen++; if (this.result || this.plan) this._emit(null); return; }  // nothing left to read
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
    this.resultStrokes = res ? this.ink : [];
    this._replan(true);
    if (this.o.train) this._trainSee();
    if (this.o.boxes) this.redraw();
    if (this.o.onResult) this.o.onResult(res, this);
    this.el.dispatchEvent(new CustomEvent('nib:result', { detail: res, bubbles: true }));
  }
  recognize(start) {
    clearTimeout(this.timer); this.gen++;
    const ink = this.ink;
    if (!ink.length) { this._emit(null); return null; }
    let res;
    if (this.o.separate) res = this._readParts(this._ropts());
    else res = this.rec.recognize(ink, Object.assign(this._ropts(), { fix: this._fixFor(ink) }));
    if (typeof start === 'number') res.ms = Math.round(performance.now() - start); // the whole read, not just its last pass
    this._emit(res);
    return res;
  }
  // the recognizer's options (the pad's own)
  _ropts() { const o = Object.assign({}, this.o); o.smooth = +o.smooth > 0 ? +o.smooth : 0; return o; }
  // the classifier work for the next read, one stroke group per step (newest ink first)
  *_warm(ro) {
    const ink = this.ink;
    if (!this.o.separate) { yield* this.rec.warmup(ink, Object.assign({}, ro, { fix: this._fixFor(ink) })); return; }
    for (const g of clustersOf(ink)) {
      const st = g.map(i => ink[i]);
      if (!this._partCached(st, ro)) yield* this._recFor(st[0]).warmup(st, Object.assign({}, ro, { fix: this._fixFor(st) }));
    }
  }
  // the corrections that apply to these strokes, as indices into them
  _fixFor(st) {
    return this.fixes.filter(f => f.strokes.every(x => st.includes(x))).map(f => ({ strokes: f.strokes.map(x => st.indexOf(x)), label: f.label }));
  }
  // A board: each group of writing is read on its own (and kept while it does not change), then put together.
  _readParts(ro) {
    const ink = this.ink;
    const read = groups => groups.map(g => {
      const st = g.map(i => ink[i]);
      const key = this._partKey(st, ro);
      let res = this.parts.get(key);
      if (!res) {
        res = this._recFor(st[0]).recognize(st, Object.assign({}, ro, { fix: this._fixFor(st) }));
        if (this.parts.size > 300) this.parts.clear();
        this.parts.set(key, res);
      }
      return { idx: g, strokes: st, result: res };
    });
    let parts = read(clustersOf(ink));
    // a piece that ends in an operator, or begins with one, continues the writing beside it: "2 ·  22 +  2 =" written
    // with spaces (as a prompt shows it) is one expression, not three; read again as one (at most a few rounds)
    for (let round = 0; round < 8; round++) {
      const joined = joinOperands(parts);
      if (!joined) break;
      parts = read(joined);
    }
    return joinParts(parts);
  }
  _partKey(st, ro) {
    const fx = this.fixes.filter(f => f.strokes.every(x => st.includes(x))).map(f => f.strokes.map(x => this._sid(x)).join('.') + '=' + f.label).join(';');
    return st.map(x => this._sid(x)).join(',') + '|' + fx + '|' + this.optsVersion + '|' + MEM.version;
  }
  _partCached(st, ro) { return this.parts.has(this._partKey(st, ro)); }
  _recFor(first) { let r = this.recs.get(first); if (!r) { r = new Recognizer(); this.recs.set(first, r); } return r; }
  // re-label one recognized symbol (from result.symbols[i].candidates) and re-run
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
        const ref = refSize(normStrokes(this.ink).strokes), sm = this._ropts().smooth;
        let g = normStrokes(ss).strokes;
        if (sm > 0) g = g.map(st => smoothPath(st, sm * ref));
        memLearn(classifyGroup(g, ref).hidden, label === '\\cdot' ? '.' : label);   // a dot is a dot; where it sits says which
      } catch (e) { /* ok */ }
    }
    const res = this.recognize();
    // the page changed (a host keeping it keeps the fix)
    if (this.o.onChange) this.o.onChange(this);
    this.el.dispatchEvent(new CustomEvent('nib:change', { detail: this, bubbles: true }));
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
    if (h.ops) {                                          // elements taken out and put in (the area eraser, paste, order)
      if (back) for (let k = h.ops.length - 1; k >= 0; k--) {
        const o = h.ops[k];
        if (o.ins !== undefined) { const i = this.strokes.indexOf(o.s); if (i >= 0) this.strokes.splice(i, 1); }
        else this.strokes.splice(Math.min(o.rm, this.strokes.length), 0, o.s);
      }
      else for (const o of h.ops) {
        if (o.ins !== undefined) this.strokes.splice(Math.min(o.ins, this.strokes.length), 0, o.s);
        else { const i = this.strokes.indexOf(o.s); if (i >= 0) this.strokes.splice(i, 1); }
      }
    }
    if (h.restyle) for (const [s, was, now] of h.restyle) { this.info.set(s, back ? was : now); this._touched(s); }
    if (h.move) {
      for (const [s, was, now] of h.move) { const src = back ? was : now; s.length = 0; for (const p of src) s.push(p.slice()); this._touched(s); }
      this.parts.clear();                                 // the strokes keep their training-log names (this._hashes): moved writing is the same writing
      if (h.t) this._movePlan(h.t, back);
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
    for (const q of this.pending) clearTimeout(q.timer); this.pending = [];
    if (this.editing) this._commitText();
    this.lasers = [];
    if (this.selection.size) this._setSel([]);
    if (!this.strokes.length) { this.redraw(); return; }
    this.trainFlush();
    const h = { erase: this.strokes.map((s, i) => ({ i, s })).reverse(), clear: true, fixes: this.fixes.slice(), revealed: [...this.revealed] };
    this._apply(h, false);
    this._push(h); this._changed();
  }
  get canUndo() { return this.history.length > 0; }
  // the writing Nib reads: pen and marker strokes (not highlighters, shapes, text or pictures); none when read is off
  _isInk(s) { const E = this.info.get(s), t = E && E.tool; return !t || t === 'pen' || t === 'marker'; }
  get ink() { return this.o.read === false ? [] : this.strokes.filter(s => this._isInk(s)); }
  get canRedo() { return this.future.length > 0; }
  // every element's points as [x, y, t] (a pen's pressure, kept as a fourth number inside, is left out)
  getStrokes() { return this.strokes.map(s => s.map(p => p.slice(0, 3))); }
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
    this.history = []; this.future = []; this.fixes = []; this.revealed = new Set(); this.selection = new Set(); this._changed();
    if (this.ink.length && this.o.auto) this._schedule(0);   // no need to wait for a pen to rest
  }
  // A host's own strokes (arrays of [x, y] points, world units), to read: kept in step without starting over —
  // a stroke the host gives again as the same array is the same stroke (its corrections, and an answer shown by a tap
  // on its line, stay), one no longer given goes. No history (the host has its own). `moved`: [[array, was], …] for
  // strokes the host moved or resized as new arrays — each is still the stroke it was, at its new place (so an answer
  // shown on a line that was dragged somewhere stays shown). Returns whether anything changed.
  syncStrokes(list, moved) {
    if (!this._hostMap) { this._hostMap = new WeakMap(); this._hostSrc = new WeakMap(); }
    const shifted = [];
    let scaled = false;
    // a stroke's points come from one host array at a time: given another array of it (a move, or the host's Undo of
    // one giving back the array it had), its points are that array's again — in place, so the stroke stays itself
    const take = (st, h) => {
      const pts = this._cleanStrokes([h])[0];
      this._hostSrc.set(st, h);
      if (!pts) return;
      if (pts.length === st.length && pts.every((p, i) => p[0] === st[i][0] && p[1] === st[i][1])) return;   // only recolored
      const a = sbox(st), b = sbox(pts);
      if (Math.abs((a[2] - a[0]) - (b[2] - b[0])) > 0.5 || Math.abs((a[3] - a[1]) - (b[3] - b[1])) > 0.5) scaled = true;
      st.length = 0; for (const p of pts) st.push(p);
      this._touched(st); shifted.push(st);
    };
    for (const [nu, was] of moved || []) {
      const st = Array.isArray(nu) && this._hostMap.get(was);
      if (!st || this._hostMap.has(nu)) continue;
      this._hostMap.set(nu, st); take(st, nu);
    }
    const next = [];
    for (const h of list || []) {
      if (!Array.isArray(h) || !h.length) continue;
      let st = this._hostMap.get(h);
      if (!st) { st = this._cleanStrokes([h])[0]; if (!st) continue; this._hostMap.set(h, st); this._hostSrc.set(st, h); }
      else if (this._hostSrc.get(st) !== h) take(st, h);
      next.push(st);
    }
    // read again where it is now (made bigger or smaller: classified again too, as the pad's own moves are)
    if (shifted.length) this._inkMoved(shifted, scaled);
    if (!shifted.length && next.length === this.strokes.length && next.every((st, i) => st === this.strokes[i])) return false;
    for (const P of [...this.ptrs.values()]) this._drop(P);
    this.strokes = next;
    this.selection = new Set();
    this._changed();
    return true;
  }
  // The answer under a point on screen (clientX, clientY): {key, hidden, box (client px)}, or null. A hidden one is
  // found anywhere on its tap target (at least a fingertip); a shown one on its own box.
  answerAt(cx, cy) {
    if (!this.plan) return null;
    const r = this.canvas.getBoundingClientRect(), p = this.toWorld(cx - r.left, cy - r.top);
    const out = (key, box, hidden) => { const a = this.toScreen([box[0], box[1]]), b = this.toScreen([box[2], box[3]]); return { key, hidden, box: [a[0] + r.left, a[1] + r.top, b[0] + r.left, b[1] + r.top] }; };
    const c = this._chipAt(p);
    if (c) return out(c.key, c.box, true);
    const live = new Set(this.strokes), fresh = this._fresh(), m = 6 / this.cam.z;
    for (const it of this.plan.items) {
      if (!it.answer || it.hidden || !this._answerShown(it, live, fresh)) continue;
      const b = it.box || it.group;
      if (p[0] >= b[0] - m && p[0] <= b[2] + m && p[1] >= b[1] - m && p[1] <= b[3] + m) return out(it.revealKey, b, false);
    }
    return null;
  }
  // show an answer waiting for a tap (as a tap on it would), or hide a shown one again
  showAnswer(key) { if (key && !this.revealed.has(key)) this._reveal(key); }
  hideAnswer(key) { if (key && this.revealed.delete(key)) { this._syncHidden(); this._changed(); } }
  // The last reading's symbols, each as the strokes it was read from — a host's own arrays when they came through
  // syncStrokes (a tool with its own ink groups its strokes by them: Deckhand's scribble-out takes a symbol whole)
  symbolStrokes() {
    const res = this.result, at = this.resultStrokes || [];
    if (!res || !res.symbols) return [];
    return res.symbols.map(y => (y.strokes || []).map(i => { const st = at[i]; return st && this._hostSrc ? this._hostSrc.get(st) || st : st; }).filter(Boolean));
  }
  // the symbol read under a world point (as the view draws it): the smallest one the point is inside, else the nearest
  // within a fingertip — {sym, box} or null (a Fix tool's tap: then relabel(sym, label))
  symbolAt(x, y) {
    const res = this.result;
    if (!res || !res.symbols || !res.symbols.length) return null;
    let inside = null, near = null;
    const reach = 12 / this.cam.z;
    for (const sym of res.symbols) {
      const objs = sym.strokes.map(i => this.resultStrokes[i]);
      const it = this.plan && this.plan.items.find(q => q.from.length === objs.length && q.from.every(o => objs.includes(o)));
      const b = it ? it.box : [sym.box.x, sym.box.y, sym.box.x + sym.box.w, sym.box.y + sym.box.h];
      const d = Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
      const area = Math.max(b[2] - b[0], 4) * Math.max(b[3] - b[1], 4);
      if (d === 0) { if (!inside || area < inside.area) inside = { sym, box: b, area }; }
      else if (d <= reach && (!near || d < near.d)) near = { sym, box: b, d };
    }
    return inside || near;
  }
  _dropAll() { for (const P of [...this.ptrs.values()]) this._drop(P); for (const q of this.pending) clearTimeout(q.timer); this.pending = []; if (this.editing) this._commitText(); this.gesture = null; }
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
    const out = { strokes, fixes, revealed, types: this.strokes.map(s => this.strokeInfo(s).type) };
    // each answer's look (1.6.5): its symbols as the board's strokes they were taken from, or their points (from the
    // Replicator hand), or the built-in glyph — so an answer is drawn the same when the board is opened again
    const looks = [];
    for (const L of this._looks.values()) {
      const rows = L.sids.map(x => bySid.get(String(x)));
      if (!rows.length || rows.some(i => i === undefined) || !L.glyphs.size) continue;
      const g = {};
      for (const [label, v] of L.glyphs) {
        if (!v.pts) continue;
        const si = v.src && v.src.length ? v.src.map(s => idx.get(s)) : null;
        g[label] = si && si.every(i => i !== undefined) ? { s: si } : v.dflt ? { d: 1 } : { p: v.pts.map(s => storePack(s, false)) };
      }
      looks.push({ strokes: rows, answer: L.answer, view: L.view, hand: L.hand, g });
    }
    if (looks.length) out.looks = looks;
    // each element's look when it is not a plain pen stroke, and a pen's pressure (0 … 100) when it gave one
    const meta = this.strokes.map(s => {
      const E = this.info.get(s);
      if (!E) return null;
      const m = {};
      if (E.tool && E.tool !== 'pen') m.k = E.tool;
      if (E.color) m.c = E.color;
      if (+E.size > 0) m.s = Math.round(E.size * 100) / 100;
      if (E.shape) m.sh = E.shape;
      if (E.fill) m.f = E.fill;
      if (E.dash) m.d = 1;
      if (E.opt) m.o = E.opt;
      if (typeof E.text === 'string') m.x = E.text;
      if (E.img) m.im = E.img;
      return Object.keys(m).length ? m : null;
    });
    if (meta.some(Boolean)) out.meta = meta;
    const press = this.strokes.map(s => (s.length && s[0].length > 3 ? s.map(q => Math.round((q.length > 3 ? q[3] : 0.5) * 100)) : null));
    if (press.some(Boolean)) out.press = press;
    if (this.o.infinite && !this.o.page) {
      const w = this._want || { r: this.viewRect, z: this.cam.z }, r1 = n => Math.round(n * 10) / 10;
      out.cam = { x: r1(w.r[0]), y: r1(w.r[1]), z: Math.round(w.z * 1000) / 1000, w: Math.round((w.r[2] - w.r[0]) * w.z), h: Math.round((w.r[3] - w.r[1]) * w.z) };
    }
    return out;
  }
  // o.steps: the strokes put back can be undone one by one, last first (as if just written), rather than not at all
  setState(st, o) {
    st = st || {};
    this._dropAll(); this.trainFlush();
    const all = this._cleanStrokes(st.strokes), at = i => (Number.isInteger(i) && all[i]) || null;
    const types = Array.isArray(st.types) ? st.types : [], meta = Array.isArray(st.meta) ? st.meta : [], press = Array.isArray(st.press) ? st.press : [];
    all.forEach((s, i) => {
      if (!s) return;
      const E = { type: ['pen', 'touch', 'mouse'].includes(types[i]) ? types[i] : null, width: null }, m = meta[i];
      if (m && typeof m === 'object') {
        if (typeof m.k === 'string') E.tool = m.k;
        if (typeof m.c === 'string') E.color = m.c;
        if (+m.s > 0) E.size = +m.s;
        if (typeof m.sh === 'string') E.shape = m.sh;
        if (typeof m.f === 'string') E.fill = m.f;
        if (m.d) E.dash = true;
        if (m.o && typeof m.o === 'object') E.opt = Object.assign({}, m.o);
        if (typeof m.x === 'string') E.text = m.x;
        if (m.im) E.img = String(m.im);
      }
      if (E.type || Object.keys(E).length > 2) this.info.set(s, E);
      const pr = press[i];
      if (Array.isArray(pr) && pr.length === s.length) s.forEach((q, j) => { q[3] = Math.max(0, Math.min(1, (+pr[j] || 0) / 100)); });
    });
    this.strokes = all.filter(Boolean);
    this.selection = new Set(); this.lasers = [];
    if (this.o.infinite && !this.o.page) this._putView(st.cam);
    this.fixes = (Array.isArray(st.fixes) ? st.fixes : []).map(f => f && Array.isArray(f.strokes) && typeof f.label === 'string' ? { strokes: f.strokes.map(at), label: f.label } : null)
      .filter(f => f && f.strokes.length && f.strokes.every(Boolean));
    this.revealed = new Set((Array.isArray(st.revealed) ? st.revealed : []).map(r => {
      const ss = r && Array.isArray(r.strokes) ? r.strokes.map(at) : [];
      return ss.length && ss.every(Boolean) ? ss.map(s => this._sid(s)).sort((x, y) => x - y).join(',') + '|' + (r.answer || '') : null;
    }).filter(Boolean));
    this._looks = new Map();
    for (const L of Array.isArray(st.looks) ? st.looks : []) {
      const rows = L && Array.isArray(L.strokes) ? L.strokes.map(at) : [];
      if (!rows.length || !rows.every(Boolean) || typeof L.answer !== 'string' || !L.g || typeof L.g !== 'object') continue;
      const sids = rows.map(s => this._sid(s)).sort((x, y) => x - y), view = typeof L.view === 'string' ? L.view : 'ink', hand = L.hand ? 'h' : '';
      const glyphs = new Map();
      for (const [label, v] of Object.entries(L.g)) {
        let pts = null, src = null, dflt = false;
        if (v && Array.isArray(v.s)) { const ss = v.s.map(at); if (ss.length && ss.every(Boolean)) { src = ss; pts = ss.map(s => s.map(q => [q[0], q[1]])); } }
        else if (v && v.d && DEFAULT_GLYPHS[label]) { pts = DEFAULT_GLYPHS[label]; dflt = true; }
        else if (v && Array.isArray(v.p)) { try { pts = v.p.map(x => storeUnpack(String(x)).map(q => [q[0], q[1]])).filter(s => s.length); } catch (e) { pts = null; } }
        if (pts && pts.length) glyphs.set(label, { pts, src, dflt });
      }
      if (glyphs.size) this._looks.set(sids.join(',') + '|' + L.answer + '|' + view + '|' + hand, { sids, answer: L.answer, view, hand, glyphs });
    }
    this.history = o && o.steps ? this.strokes.slice(-500).map(s => ({ add: s })) : []; this.future = []; this.parts.clear();
    if (this.o.page) this._pageCam();                     // a page with writing in its margins shows it
    if (!this._fitHere()) this._changed();
    if (this.ink.length && this.o.auto) this._schedule(0);
    this._camQuiet(() => this._camMoved(true));
  }
  // a page's view put back ({x, y, z, w, h}: the top-left, the zoom, and the size of the screen it was chosen on), fitted
  // to this screen as a resize would be
  _putView(c) {
    const d = this.dpr || 1, W = this.canvas.width / d, H = this.canvas.height / d;
    const ok = c && isFinite(+c.x) && isFinite(+c.y) && +c.z > 0;
    const z = ok ? Math.max(PAD_ZMIN, Math.min(PAD_ZMAX, +c.z)) : 1, x = ok ? +c.x : 0, y = ok ? +c.y : 0;
    const w = ok && +c.w > 0 ? +c.w : W, h = ok && +c.h > 0 ? +c.h : H;
    this.cam = { x, y, z };
    this._want = { r: [x, y, x + w / z, y + h / z], z };
    this._fitView();
  }
  // a page put back on a pad smaller than the one it was written on (fit on): brought in, as for a resize
  _fitHere() {
    if (!this.o.fit) return false;
    const r = this.canvas.getBoundingClientRect();
    return this._fit(r.width, r.height);
  }
  // the page as it is right now, history and all (for a page that is put away and taken out again)
  snapshot() { return { strokes: this.strokes.slice(), fixes: this.fixes.slice(), revealed: new Set(this.revealed), history: this.history.slice(), future: this.future.slice(), cam: Object.assign({}, this.cam), want: this._want ? { r: this._want.r.slice(), z: this._want.z } : null }; }
  restore(snap) {
    this._dropAll(); this.trainFlush();
    this.strokes = snap.strokes.slice(); this.fixes = snap.fixes.slice(); this.revealed = new Set(snap.revealed);
    this.history = snap.history.slice(); this.future = snap.future.slice();
    this.selection = new Set(); this.lasers = [];
    if (this.o.infinite && snap.cam) { this.cam = Object.assign({}, snap.cam); this._want = snap.want ? { r: snap.want.r.slice(), z: snap.want.z } : null; this._fitView(); }
    if (!this._fitHere()) this._changed();
    if (this.ink.length && this.o.auto) this._schedule(0);
    this._camQuiet(() => this._camMoved(true));
  }
  // ---------------------------------------------------------------- the training log (train on)
  // Each piece of writing (a part of the board: one expression) that has been read and then left alone for 4 s, or
  // that is on a page being left, is kept once in this.training as a record (see docs/HANDOFF.md, "Training log").
  // Its key is its strokes' ids: a hash of each stroke's points at 0.1 px, so the same writing has the same key
  // after a reload or on a page taken out again; keeping the same key again replaces the record (a later Fix).
  // Writing moved in by fit keeps the ids it had (see _fit), so it is not kept twice at two sizes.
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
      types: st.map(s => this.strokeInfo(s).type), widths: st.map(s => this.strokeInfo(s).width),
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
  // drop given records from the log (a drill step taken back)
  trainDrop(keys) {
    const removed = [];
    for (const k of keys || []) {
      const rec = this._trainIdx.get(k);
      if (!rec) continue;
      const i = this.training.indexOf(rec); if (i >= 0) this.training.splice(i, 1);
      this._trainIdx.delete(k); this._trainBytes.delete(k); removed.push(k);
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
    clearTimeout(this.timer); clearTimeout(this._trainTimer); clearTimeout(this._camTimer); this.gen++; this.anim = null; this.ptrs.clear(); for (const q of this.pending) clearTimeout(q.timer); this.pending = [];
    if (this.editing) { this.editing.ta.remove(); this.editing = null; }
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._laserRaf) cancelAnimationFrame(this._laserRaf);
    if (typeof window !== 'undefined') window.removeEventListener('nib:hand', this._handChanged);
    if (this.ro) this.ro.disconnect();
    if (this.mo) this.mo.disconnect();
    if (this.mq) this.mq.removeEventListener('change', this._theme);
    try { if (document.fonts) document.fonts.removeEventListener('loadingdone', this._fonts); } catch (e) { /* ok */ }
    this.canvas.remove();
  }
}

// <nib-pad symbols="school" delay="450" ink="#1b2a4a" stroke-width="3" boxes></nib-pad>
if (typeof customElements !== 'undefined' && typeof HTMLElement !== 'undefined' && !customElements.get('nib-pad')) {
  class NibPad extends HTMLElement {
    static get observedAttributes() { return ['symbols', 'ink', 'stroke-width', 'delay', 'settle', 'auto', 'boxes', 'pen-only', 'lines', 'degrees', 'smooth', 'view', 'motion', 'separate', 'solve', 'times', 'reveal', 'fit', 'train',
      'infinite', 'paper', 'fingers', 'pinch', 'pressure', 'eraser', 'snap', 'hold', 'read', 'page', 'draw', 'palm', 'single', 'scribble']; }
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
        infinite: has('infinite') && a('infinite') !== 'false',
        // paper="grid" or paper="plane white": a background, and its tone
        paper: (() => { const v = (a('paper') || '').trim().split(/\s+/); return v[0] && v[0] !== 'none' ? { kind: v[0], tone: v[1] || 'theme' } : null; })(),
        fingers: ['pan', 'ignore'].includes(a('fingers')) ? a('fingers') : 'write',
        pinch: a('pinch') !== 'false',
        pressure: a('pressure') !== 'false',
        eraser: a('eraser') === 'area' ? 'area' : 'stroke',
        snap: has('snap') && +a('snap') > 0 ? +a('snap') : 0,
        hold: a('hold') !== 'false',
        read: a('read') !== 'false',
        // page="1280 960": a fixed page, shown whole (nothing pans or zooms it); draw="answers": only the answers
        page: (() => { const v = (a('page') || '').trim().split(/[\s,x]+/).map(Number); return v.length === 2 && v[0] > 0 && v[1] > 0 ? v : null; })(),
        layer: a('draw') === 'answers' ? 'answers' : null,
        palm: a('palm') !== 'false',
        scribble: a('scribble') !== 'false',
        single: has('single') && a('single') !== 'false',
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
      if (this.hasAttribute('keep')) return;               // keep: the host takes it out to put it back (all of it lives on)
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
    // answers are marked answer, and hidden while they wait for a tap
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
    setState(st, o) { if (this.pad) this.pad.setState(st, o); else this._saved = st && st.strokes; }
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
    trainDrop(keys) { return this.pad ? this.pad.trainDrop(keys) : 0; }
    strokeInfo(s) { return this.pad ? this.pad.strokeInfo(s) : { type: null, width: null }; }
    get mode() { return this.pad ? this.pad.mode : 'draw'; }
    // 'draw' | 'erase' | 'fix' (a tap is sent on as nib:tap {x, y, pointerType} instead of writing a dot; writing still
    // writes) | 'select' | 'lasso' (select, a drag always a lasso; mode then reads 'select') | 'pan' | 'shape' | 'text' |
    // 'laser' (see Pad.setMode)
    set mode(v) { if (this.pad) this.pad.setMode(v); }
    // the canvas: what draw mode writes with ({kind: 'pen' | 'marker' | 'highlighter', color, size}), the shape and text tools
    get tool() { return this.pad ? Object.assign({}, this.pad.tool) : null; }
    set tool(v) { if (this.pad && v) this.pad.tool = Object.assign({ kind: 'pen', color: null, size: null }, v); }
    get shapeTool() { return this.pad ? Object.assign({}, this.pad.shapeTool) : null; }
    set shapeTool(v) { if (this.pad && v) this.pad.shapeTool = Object.assign({}, this.pad.shapeTool, v); }
    get textTool() { return this.pad ? Object.assign({}, this.pad.textTool) : null; }
    set textTool(v) { if (this.pad && v) this.pad.textTool = Object.assign({}, this.pad.textTool, v); }
    exportImage(o) { return this.pad ? this.pad.exportImage(o) : null; }
    addImage(src, o) { return this.pad ? this.pad.addImage(src, o) : Promise.resolve(null); }
    putImage(id, src) { return this.pad ? this.pad.putImage(id, src) : null; }
    get camera() { return this.pad ? this.pad.getCamera() : { x: 0, y: 0, z: 1 }; }
    set camera(c) { if (this.pad) this.pad.setCamera(c); }
    zoomTo(z) { if (this.pad) this.pad.zoomTo(z); }
    fitContent(m) { if (this.pad) this.pad.fitContent(m); }
    recognize() { return this.pad && this.pad.recognize(); }
    relabel(sym, label) { return this.pad && this.pad.relabel(sym, label); }
    undo() { if (this.pad) this.pad.undo(); }
    redo() { if (this.pad) this.pad.redo(); }
    clear() { if (this.pad) this.pad.clear(); }
  }
  customElements.define('nib-pad', NibPad);
}
