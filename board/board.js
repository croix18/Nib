(function () {
  'use strict';
  // ================================================================ Nib Board: a canvas for the classroom
  // The board is one <nib-pad infinite>: an endless surface that pans and zooms, with pens, markers, highlighters,
  // shapes, text and pictures over a paper (dots, grid, lined, a coordinate plane, number lines …), one per page. Nib
  // reads what the pen and marker write (math → LaTeX), shows it as written, tidied, in the writer's hand or typeset,
  // and works out answers after "=". Everything is kept in this browser; Export makes a PDF or a picture to post.
  const $ = id => document.getElementById(id);
  const pad = $('pad'), board = $('board'), surface = $('surface');
  const KEY = 'nib-board-v3', OLDKEY = 'nib-board-v1', TKEY = 'nib-train-v1', DKEY = 'nib-drill-v1';
  const K = (window.Nib && window.Nib.canvas) || {};
  const VIEWS = ['ink', 'tidy', 'hand', 'typeset'], RAILS = ['top', 'bottom', 'left', 'right'], THEMES = ['light', 'dark', 'system'];
  const TOOLS = ['select', 'lasso', 'hand', 'pen', 'marker', 'highlighter', 'eraser', 'shape', 'text', 'laser'];
  const SELECTS = ['select', 'lasso'];                      // the tools that select (the pad's select mode)
  const INKS = ['pen', 'marker', 'highlighter'];
  const TNAME = { pen: 'Pen', marker: 'Marker', highlighter: 'Highlighter', shape: 'Shape', text: 'Text', eraser: 'Eraser', image: 'Picture' };
  const COLORS = ['@ink', '@red', '@blue', '@green', '@orange', '@purple', '@gold', '@pink', '@brown', '@gray', '@black'];
  const HLS = ['@hl-yellow', '@hl-green', '@hl-pink', '@hl-blue', '@hl-orange'];
  const CNAME = { '@ink': 'Ink: navy, or cream on a dark paper', '@red': 'Red', '@blue': 'Blue', '@green': 'Green', '@orange': 'Orange', '@purple': 'Purple', '@gold': 'Gold',
    '@pink': 'Pink', '@brown': 'Brown', '@gray': 'Gray', '@black': 'Black', '@hl-yellow': 'Yellow', '@hl-green': 'Green', '@hl-pink': 'Pink', '@hl-blue': 'Blue', '@hl-orange': 'Orange' };
  const SIZES = { pen: [1.5, 2.5, 3.5, 5, 8], marker: [6, 9, 12, 16, 24], highlighter: [14, 20, 28, 40], shape: [1.5, 3, 5, 8], text: [20, 28, 40, 56, 80] };
  const STYLE0 = { pen: { color: '@ink', size: 3.5 }, marker: { color: '@red', size: 12 }, highlighter: { color: '@hl-yellow', size: 24 },
    shape: { kind: 'rect', color: '@ink', size: 3, fill: 'none', dash: false }, text: { color: '@ink', size: 40 } };
  const PAPER0 = { kind: 'dots', tone: 'theme' };
  // the paper's own spacing: shapes snap to it (lined paper: its rules; isometric and blank paper: no snapping)
  const SNAP = { dots: 28, grid: 40, graph: 20, plane: 40, lined: 40, numberlines: 40 };
  const PAPERS = K.paperKinds && K.paperKinds.length ? K.paperKinds : [{ kind: 'blank', label: 'Blank' }, { kind: 'dots', label: 'Dots' }];
  const TONES = K.paperTones && K.paperTones.length ? K.paperTones : [{ tone: 'theme', label: 'Board' }];
  const SHAPES = K.shapeKinds && K.shapeKinds.length ? K.shapeKinds : [{ kind: 'rect', label: 'Rectangle' }];
  const OLD_PENS = { thin: 2.5, medium: 3.5, thick: 5 };    // the Pen setting before 1.6
  const SHEET_WHITE = { kind: 'blank', tone: 'white' };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

  // ---------------------------------------------------------------- what is kept
  // The board survives a reload: its pages, view and settings are kept in this browser (one key; points packed small),
  // pictures in IndexedDB by id. A Board before 1.6 kept its board under nib-board-v1: the first time this one opens, it
  // takes that board over and leaves the old key as it was, so an older Board opened later (every file:// page shares
  // one storage) finds its own board, not one it cannot read and would save over.
  let saved = null, storageOk = true;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null') || JSON.parse(localStorage.getItem(OLDKEY) || 'null'); } catch (e) { storageOk = false; }
  if (!saved || typeof saved !== 'object') saved = {};
  const newer = +saved.v > 3;            // kept by a newer Board: shown as far as this one can, never saved over
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const okColor = c => typeof c === 'string' && (own(K.colors, c) || /^#[0-9a-f]{6}$/i.test(c));
  function okStyle(t, v) {
    const o = Object.assign({}, STYLE0[t]);
    if (v && typeof v === 'object') {
      if (okColor(v.color)) o.color = v.color;
      if (+v.size > 0 && +v.size <= 400) o.size = +v.size;
      if (t === 'shape') {
        if (SHAPES.some(k => k.kind === v.kind)) o.kind = v.kind;
        if (['none', 'tint', 'solid'].includes(v.fill)) o.fill = v.fill;
        o.dash = v.dash === true;
      }
    }
    return o;
  }
  const okPaper = p => (p && typeof p === 'object' && PAPERS.some(k => k.kind === p.kind) ? { kind: p.kind, tone: TONES.some(t => t.tone === p.tone) ? p.tone : 'theme' } : null);
  const styles = {};
  for (const t of Object.keys(STYLE0)) styles[t] = okStyle(t, saved.styles && saved.styles[t]);
  if (!saved.styles && OLD_PENS[saved.pen]) styles.pen.size = OLD_PENS[saved.pen];
  const sx = saved.xp && typeof saved.xp === 'object' ? saved.xp : {};
  const S = {
    view: pick(saved.view, VIEWS, 'ink'),
    solve: bool(saved.solve, true),
    reveal: bool(saved.reveal, true),
    rail: pick(saved.rail, RAILS, 'top'),
    theme: pick(saved.theme, THEMES, 'system'),
    finger: pick(saved.finger, ['writes', 'pans', 'ignored'], 'writes'),   // 'ignored': pen only (a tablet where the hand rests on the glass)
    pinch: bool(saved.pinch, true),
    train: saved.train === true,          // keep writing for training: off until the teacher turns it on
    trainNoted: saved.trainNoted === true,
    ink: pick(saved.ink, INKS, 'pen'),    // the drawing tool last used: the board opens with it
    styles,
    eraser: pick(saved.eraser, ['stroke', 'area'], 'stroke'),
    hold: bool(saved.hold, true), snap: bool(saved.snap, true), pressure: bool(saved.pressure, true), read: bool(saved.read, true), scribble: bool(saved.scribble, true),
    paper: okPaper(saved.paper) || Object.assign({}, PAPER0),            // the paper new pages get
    xp: { what: pick(sx.what, ['page', 'all', 'view'], 'page'), as: pick(sx.as, ['pdf', 'png', 'clip'], 'pdf'), psize: pick(sx.psize, ['letter', 'a4', 'fit'], 'letter'),
      ans: pick(sx.ans, ['shown', 'all', 'none'], 'shown'), xpaper: pick(sx.xpaper, ['on', 'white'], 'on') },
  };
  S.tool = S.ink;
  let prevTool = S.ink;                   // what the eraser goes back to

  // pages: each its own elements, corrections, shown answers, view and paper (a board saved before pages is page 1)
  const arr = v => (Array.isArray(v) ? v : []);
  const blank = () => ({ strokes: [], fixes: [], revealed: [], paper: Object.assign({}, S.paper) });
  // an element's look as kept: only what the pad knows, with values it can use (a color from a file must be a color)
  const okFill = f => typeof f === 'string' && (f === 'tint' || f === 'solid' || okColor(f) || /^@[a-z-]+:(0(\.\d+)?|1(\.0+)?)$/.test(f));
  function okMeta(m) {
    if (!m || typeof m !== 'object') return null;
    const o = {};
    if (['marker', 'highlighter', 'shape', 'text', 'image'].includes(m.k)) o.k = m.k;
    if (okColor(m.c)) o.c = m.c;
    if (+m.s > 0 && +m.s <= 1000) o.s = +m.s;
    if (typeof m.sh === 'string' && /^[a-z0-9]{1,16}$/.test(m.sh)) o.sh = m.sh;
    if (okFill(m.f)) o.f = m.f;
    if (m.d) o.d = 1;
    if (m.o && typeof m.o === 'object') { const q = {}; for (const [k, v] of Object.entries(m.o)) if (/^[a-z]{1,8}$/.test(k) && (typeof v === 'boolean' || (typeof v === 'number' && isFinite(v)))) q[k] = v; o.o = q; }
    if (typeof m.x === 'string') o.x = m.x.slice(0, 5000);
    if (typeof m.im === 'string' && /^[\w-]{1,80}$/.test(m.im)) o.im = m.im;
    return Object.keys(o).length ? o : null;
  }
  // an answer's look as kept (1.6.5): the strokes of its line, the answer, the view, and each symbol as board strokes
  // ({s: [indexes]}), the built-in glyph ({d: 1}) or packed points ({p: [strings]})
  function okLook(L) {
    if (!L || typeof L !== 'object' || !Array.isArray(L.strokes) || !L.strokes.length || !L.strokes.every(Number.isInteger)) return null;
    if (typeof L.answer !== 'string' || L.answer.length > 400 || !L.g || typeof L.g !== 'object' || Array.isArray(L.g)) return null;
    const g = {};
    for (const [label, v] of Object.entries(L.g)) {
      if (label.length > 24 || !v || typeof v !== 'object') continue;
      if (Array.isArray(v.s) && v.s.length && v.s.length <= 12 && v.s.every(Number.isInteger)) g[label] = { s: v.s };
      else if (v.d) g[label] = { d: 1 };
      else if (Array.isArray(v.p) && v.p.length && v.p.length <= 12 && v.p.every(x => typeof x === 'string' && x.length <= 20000)) g[label] = { p: v.p };
    }
    if (!Object.keys(g).length) return null;
    return { strokes: L.strokes, answer: L.answer, view: ['ink', 'tidy', 'hand', 'typeset'].includes(L.view) ? L.view : 'ink', hand: L.hand ? 'h' : '', g };
  }
  function okPage(p, legacyW) {
    if (!p || typeof p !== 'object') return null;
    let strokes = null, press = null;
    if (Array.isArray(p.pk) && K.unpack) {
      const un = p.pk.map(s => (typeof s === 'string' ? K.unpack(s) : []));
      strokes = un.map(s => s.map(q => [q[0], q[1]]));
      if (un.some(s => s.length && s[0].length > 3)) press = un.map(s => (s.length && s[0].length > 3 ? s.map(q => Math.round(q[3] * 100)) : null));
    } else if (Array.isArray(p.strokes)) { strokes = p.strokes; if (Array.isArray(p.press)) press = p.press; }
    if (!strokes) return null;
    const out = { strokes, fixes: arr(p.fixes), revealed: arr(p.revealed), types: arr(p.types), paper: okPaper(p.paper) || Object.assign({}, PAPER0) };
    if (Array.isArray(p.meta)) out.meta = p.meta.map(okMeta);
    else if (legacyW) out.meta = strokes.map(() => ({ s: legacyW }));   // written before pens had sizes: the width it had
    if (press) out.press = press;
    if (p.cam && typeof p.cam === 'object') out.cam = p.cam;
    if (Array.isArray(p.looks)) { const lk = p.looks.map(okLook).filter(Boolean); if (lk.length) out.looks = lk; }
    return out;
  }
  const legacyW = saved.v === 3 ? 0 : (OLD_PENS[saved.pen] || 3.5);
  let pages = Array.isArray(saved.pages) ? saved.pages.map(p => okPage(p, legacyW)).filter(Boolean) : Array.isArray(saved.strokes) ? [okPage(saved, legacyW)].filter(Boolean) : [];
  if (!pages.length) pages = [blank()];
  let cur = Number.isInteger(saved.page) ? clamp(saved.page, 0, pages.length - 1) : 0;
  const snaps = [];                       // each page's undo history while the board is open
  const packed = new WeakMap();           // a page kept → its packed form (only the page on the board changes)
  function packPage(st) {
    let o = packed.get(st);
    if (o) return o;
    o = { fixes: st.fixes, revealed: st.revealed, types: st.types, paper: st.paper };
    if (K.pack) o.pk = st.strokes.map((s, i) => { const pr = st.press && st.press[i]; return K.pack(pr ? s.map((q, j) => [q[0], q[1], 0, (+pr[j] || 0) / 100]) : s, !!pr); });
    else { o.strokes = st.strokes; if (st.press) o.press = st.press; }
    if (st.meta) o.meta = st.meta;
    if (st.cam) o.cam = st.cam;
    if (st.looks) o.looks = st.looks;
    packed.set(st, o);
    return o;
  }
  const settingsOut = () => ({ view: S.view, solve: S.solve, reveal: S.reveal, rail: S.rail, theme: S.theme, finger: S.finger, pinch: S.pinch, train: S.train, trainNoted: S.trainNoted,
    ink: S.ink, styles: S.styles, eraser: S.eraser, hold: S.hold, snap: S.snap, pressure: S.pressure, read: S.read, scribble: S.scribble, paper: S.paper, xp: S.xp });
  // the page on the board as it is now, with its paper
  const here = () => Object.assign(pad.getState(), { paper: pages[cur].paper });
  // a text box still open is part of the page: kept before the page is (it would be lost with a page change or a close)
  const commitText = () => { if (pad.pad && pad.pad.editing) pad.pad._commitText(); };
  // One Board saves at a time: a second tab (or window) of it shows the board and saves nothing, and says so; when the
  // first one closes, the second offers to reload and carry on from what was saved.
  let writer = true, locks = false;
  try {
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      locks = true;
      navigator.locks.request('nib-board', { ifAvailable: true }, lock => {
        if (lock) return new Promise(() => {});          // held while this page is open
        writer = false;
        note('Nib Board is open in another tab or window as well: this one shows the board but saves nothing. Close one of them.', null, null, true);
        navigator.locks.request('nib-board', () => {
          note('The other Nib Board has closed. Reload this one to carry on from what it saved.', () => location.reload(), 'Reload', true);
          return new Promise(() => {});
        });
        return undefined;
      }).catch(() => {});
    }
  } catch (e) { locks = false; }
  let ready = false, saveTimer = null, warned = false;
  function write() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!ready || !writer || newer) return;
    pages[cur] = here();
    try {
      localStorage.setItem(KEY, JSON.stringify(Object.assign({ v: 3, t: Date.now() }, settingsOut(), { page: cur, pages: pages.map(packPage) })));
      warned = false;
    } catch (e) {
      // not saved: said until it is (this browser's storage is shared by every page opened from files, and can fill up)
      if (!warned) { warned = true; note("The board can't be saved in this browser. Export, Save the board keeps it as a file.", () => $('boardsave').click(), 'Save the board', true); }
    }
  }
  // saved half a second after a change, and at once when the page goes or is hidden (with a text box still open in it)
  const persist = () => { if (!ready) return; clearTimeout(saveTimer); saveTimer = setTimeout(write, 500); };
  const flush = () => { commitText(); if (saveTimer) write(); };
  // where the browser has no locks: a second Board saving is at least said, once
  let twice = false;
  window.addEventListener('storage', e => {
    if (locks || e.key !== KEY || !ready || twice) return;
    twice = true;
    note('Nib Board is open in another tab or window as well, and the two save over each other. Close one of them.', null, null, true);
  });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  // the training log: its own key, saved 0.5 s after each record and at once when the page goes
  let trainTimer = null, trainWarned = false;
  function writeTrain() {
    clearTimeout(trainTimer); trainTimer = null;
    if (!pad.pad || !writer) return;
    try {
      if (pad.pad.training.length) localStorage.setItem(TKEY, JSON.stringify({ v: 1, records: pad.pad.training }));
      else localStorage.removeItem(TKEY);
    } catch (e) { if (!trainWarned) { trainWarned = true; note("The writing kept for training can't be stored in this browser. Save training to keep it."); } }
  }
  const persistTrain = () => { clearTimeout(trainTimer); trainTimer = setTimeout(writeTrain, 500); };
  window.addEventListener('pagehide', () => { if (pad.pad) pad.pad.trainFlush(); if (trainTimer) writeTrain(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && trainTimer) writeTrain(); });

  // state the functions below share (declared before any of them runs)
  let fixing = false, fixFor = null, emptyTaps = 0;        // Fix: on, the symbol whose choices are open, empty taps in a row
  let D = null, dCur = null, dTimer = null, dHow = '';     // the drill
  let styleFor = null, popAnchor = null, axisEl = null;     // what the color popover changes, what opened a popover, the axes being edited
  let clip = null, clipMark = '';                           // copied elements, and the text put on the clipboard with them
  let R = null, exporting = false, opened = null, saver = null;
  const imgCache = new Map();                               // picture id → data URL, this session

  // ---------------------------------------------------------------- notes
  let noteAction = null, noteTimer = null;
  function note(text, action, label, stay, brief) {
    $('notetext').textContent = text; $('note').hidden = false;
    noteAction = action || null; $('noteact').hidden = !action; if (action) $('noteact').textContent = label;
    // a note that only tells something goes away by itself; one that asks for something (or holds the LaTeX) stays
    clearTimeout(noteTimer);
    if ((!action && !stay) || brief) noteTimer = setTimeout(() => { if ($('latexbox').hidden && $('notetext').textContent === text) $('note').hidden = true; }, brief ? 8000 : 6000);
  }
  $('noteact').onclick = () => { const a = noteAction; $('note').hidden = true; if (a) a(); };
  $('noteclose').onclick = () => { $('note').hidden = true; $('latexbox').hidden = true; };
  // a note that says what is happening, until it is done
  function busy(text) {
    if (text) { note(text, null, null, true); return; }
    if (/…$/.test($('notetext').textContent)) $('note').hidden = true;
  }

  // ---------------------------------------------------------------- popovers: one at a time, a tap elsewhere closes it
  const POPS = ['settings', 'stylepop', 'shapepop', 'paperpop', 'axispop', 'pagespop', 'exportpop', 'morepop', 'helppop'];
  const OPENERS = { settings: 'gear', stylepop: 'stylebtn', paperpop: 'paperbtn', pagespop: 'pageno', exportpop: 'exportbtn', morepop: 'morebtn' };
  const anyPop = () => POPS.some(id => !$(id).hidden);
  function openPop(id, anchor) {
    closePops(id);
    $(id).hidden = false; popAnchor = anchor || $(OPENERS[id]) || null;
    for (const [p, a] of Object.entries(OPENERS)) $(a).setAttribute('aria-expanded', String(p === id));
    placePop($(id), popAnchor);
  }
  function closePops(except) {
    for (const id of POPS) {
      if (id === except || $(id).hidden) continue;
      $(id).hidden = true;
      if (id === 'settings') { askDelete(false); askForget(false); }
      if (id === 'exportpop') { $('openask').hidden = true; opened = null; }
      if (id === 'axispop') axisEl = null;
    }
    for (const [p, a] of Object.entries(OPENERS)) if (p !== except) $(a).setAttribute('aria-expanded', 'false');
    if (!except) popAnchor = null;
  }
  // next to what opened it, inside the board: beside a side rail, under a top rail, over a bottom one
  function placePop(el, anchor) {
    const Sf = surface.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, m = 8;
    const A = anchor ? anchor.getBoundingClientRect() : null, inRail = !!(anchor && $('rail').contains(anchor));
    let left, top;
    if (!A) { left = (Sf.width - w) / 2; top = m; }
    else if (!inRail) { left = A.left + A.width / 2 - Sf.left - w / 2; top = A.bottom - Sf.top + 8; if (top + h > Sf.height - m) top = A.top - Sf.top - h - 8; }
    else if (S.rail === 'left') { left = m; top = A.top - Sf.top; }
    else if (S.rail === 'right') { left = Sf.width - w - m; top = A.top - Sf.top; }
    else { left = A.left + A.width / 2 - Sf.left - w / 2; top = S.rail === 'top' ? m : Sf.height - h - m; }
    el.style.left = clamp(left, m, Sf.width - w - m) + 'px';
    el.style.top = clamp(top, m, Sf.height - h - m) + 'px';
  }
  document.addEventListener('pointerdown', e => {
    if (!anyPop()) return;
    const t = e.target;
    if (POPS.some(id => !$(id).hidden && $(id).contains(t)) || (popAnchor && popAnchor.contains(t))) return;
    closePops();
    // on the board, the tap that closed it writes nothing
    if (pad.contains(t)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.addEventListener('resize', () => { for (const id of POPS) if (!$(id).hidden) placePop($(id), popAnchor); showSel(); });
  // a segmented choice: mark the one picked
  const segMark = (g, v) => g.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === v)));

  // ---------------------------------------------------------------- views
  function setView(v, quiet) {
    S.view = v; pad.view = v; persist(); closeFix();
    document.querySelectorAll('#views button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.view === v)));
    if (v === 'hand' && !Nib.hand.size && !quiet) note('Your handwriting is not on this computer yet. Open the file you saved from Replicator; until then the board shows your writing tidied.', () => $('file').click(), 'Open handwriting');
    else if (!quiet) $('note').hidden = true;
  }
  document.querySelectorAll('#views button').forEach(b => { b.onclick = () => setView(b.dataset.view); });
  // handwriting arriving from elsewhere (the Replicator in another tab) answers the note asking for it
  window.addEventListener('nib:hand', () => { if (Nib.hand.size && !$('note').hidden && !$('noteact').hidden && noteAction && /Replicator/.test($('notetext').textContent)) $('note').hidden = true; });

  // ---------------------------------------------------------------- the tools
  const modeOf = t => ({ select: 'select', lasso: 'lasso', hand: 'pan', eraser: 'erase', shape: 'shape', text: 'text', laser: 'laser' })[t] || 'draw';
  const colorOut = c => (c && c !== '@ink' ? c : null);
  function themeDark() { if (S.theme !== 'system') return S.theme === 'dark'; try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } }
  // the page's paper colors: {paper, ink, dark}
  function tone() {
    const p = pages[cur].paper;
    if (K.paperTone) { try { return K.paperTone(p.tone, themeDark()); } catch (e) { /* the theme's */ } }
    const cs = getComputedStyle(document.documentElement);
    return { dark: themeDark(), ink: cs.getPropertyValue('--ink').trim(), paper: cs.getPropertyValue('--board').trim() };
  }
  // a named color as it draws on this page's paper
  function shade(c, T) { T = T || tone(); return (K.color && K.color(c, T.dark, T.ink)) || (typeof c === 'string' && c[0] === '#' ? c : T.ink); }
  function setTool(t, quiet) {
    if (!TOOLS.includes(t)) return;
    if (fixing) fixMode(false);
    if (t === 'eraser' && S.tool !== 'eraser') prevTool = S.tool;
    S.tool = t;
    if (INKS.includes(t) && S.ink !== t) { S.ink = t; persist(); }
    closePops();
    applyTool();
    if (!quiet) drillRead();
  }
  // the eraser on (from any tool) or off (back to the tool before it)
  const erase = on => (on ? setTool('eraser') : setTool(prevTool && prevTool !== 'eraser' ? prevTool : S.ink));
  let lastWidth = null;
  function applyTool() {
    const t = S.tool, ink = INKS.includes(t) ? t : S.ink, st = S.styles[ink], sh = S.styles.shape;
    pad.tool = { kind: ink, color: colorOut(st.color), size: st.size };
    pad.shapeTool = { kind: sh.kind, color: colorOut(sh.color), size: sh.size, fill: sh.fill === 'none' ? null : sh.fill, dash: !!sh.dash };
    pad.textTool = { color: colorOut(S.styles.text.color), size: S.styles.text.size };
    // the pen's width is also what answers are written with
    const w = String(S.styles.pen.size);
    if (w !== lastWidth) { lastWidth = w; pad.setAttribute('stroke-width', w); }
    if (!fixing) pad.mode = modeOf(t);
    marksTools();
  }
  // what the color button changes now: the tool's look, or what is selected
  function styleTarget() {
    if (SELECTS.includes(S.tool)) return pad.pad && pad.pad.selected.length ? 'sel' : null;
    return ['pen', 'marker', 'highlighter', 'shape', 'text', 'eraser'].includes(S.tool) ? S.tool : null;
  }
  function marksTools() {
    const T = tone();
    document.querySelectorAll('#toolbar .tool').forEach(b => { const on = b.dataset.tool === S.tool; b.setAttribute('aria-checked', String(on)); b.setAttribute('aria-pressed', String(on)); });
    for (const k of INKS) { const i = document.querySelector(`#toolbar [data-tool="${k}"] .ink`); if (i) i.style.setProperty('--tint', shade(S.styles[k].color, T)); }
    $('shapeicon').setAttribute('href', '#s-' + S.styles.shape.kind);
    const st = styleTarget(), sb = $('stylebtn'), dot = sb.querySelector('.dot');
    sb.disabled = !st;
    let c = null;
    if (st === 'sel') { const cs = lookSel().map(x => x.E).filter(E => E.tool !== 'image').map(E => E.color || '@ink'); c = same(cs); }
    else if (st && st !== 'eraser') c = S.styles[st].color;
    dot.style.setProperty('--tint', st === 'eraser' || !st ? 'transparent' : c ? shade(c, T) : 'conic-gradient(#d1352b, #e8c35a, #1d8a4b, #1f5fbf, #d1352b)');
    if (st === 'eraser' || !st) dot.style.boxShadow = '0 0 0 2px var(--rail), inset 0 0 0 2px var(--muted)'; else dot.style.boxShadow = '';
    sb.title = st === 'eraser' ? 'What the eraser takes' : st === 'sel' ? 'Color and size of what is selected' : 'Color and size';
  }
  document.querySelectorAll('#toolbar .tool').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tool;
    if (t === 'eraser') { erase(S.tool !== 'eraser'); return; }
    if (S.tool === t && !fixing) {                         // tapped again: its choices
      if (t === 'shape') { if ($('shapepop').hidden) openShapes(b); else closePops(); }
      else if (['pen', 'marker', 'highlighter', 'text'].includes(t)) { if ($('stylepop').hidden) openStyle(t, b); else closePops(); }
      return;
    }
    setTool(t);
  }));
  $('stylebtn').onclick = () => { const st = styleTarget(); if (!st) return; if (!$('stylepop').hidden) { closePops(); return; } openStyle(st, $('stylebtn')); };

  // ---------------------------------------------------------------- colors and sizes
  const same = list => (list.length && list.every(v => v === list[0]) ? list[0] : null);
  const lookSel = () => { const P = pad.pad; return P ? P.selected.map(s => ({ s, E: P.lookOf(s) || {} })) : []; };
  function openStyle(target, anchor) {
    styleFor = target;
    const sel = target === 'sel' ? lookSel() : null;
    const kinds = sel ? [...new Set(sel.map(x => x.E.tool || 'pen'))].filter(k => k !== 'image') : [target];
    const one = kinds.length === 1 ? kinds[0] : null;
    $('styletitle').textContent = sel ? (sel.length === 1 ? TNAME[(sel[0].E.tool) || 'pen'] : `${sel.length} things`) : TNAME[target];
    const colors = target !== 'eraser' && kinds.length > 0;
    $('swatches').parentNode.hidden = !colors;
    if (colors) swatches(kinds.every(k => k === 'highlighter') ? HLS : COLORS, sel ? same(sel.filter(x => x.E.tool !== 'image').map(x => x.E.color || '@ink')) : S.styles[target].color);
    const sk = sel ? (one && SIZES[one] ? one : null) : (SIZES[target] ? target : null);
    $('sizerow').hidden = !sk;
    if (sk) sizes(sk, sel ? same(sel.map(x => +x.E.size || null)) : S.styles[target].size);
    const shapes = sel ? kinds.includes('shape') : target === 'shape';
    $('fillrow').hidden = !shapes; $('dashrow').hidden = !shapes;
    if (shapes) {
      const sh = sel ? sel.filter(x => x.E.tool === 'shape').map(x => x.E) : null;
      segMark($('fillrow').querySelector('.seg'), sh ? same(sh.map(E => E.fill || 'none')) : S.styles.shape.fill);
      segMark($('dashrow').querySelector('.seg'), sh ? same(sh.map(E => (E.dash ? 'dashed' : 'solid'))) : S.styles.shape.dash ? 'dashed' : 'solid');
    }
    $('eraserrow').hidden = target !== 'eraser';
    if (target === 'eraser') segMark($('eraserrow').querySelector('.seg'), S.eraser);
    openPop('stylepop', anchor);
  }
  function swatches(list, curC) {
    const box = $('swatches'), T = tone(), custom = curC && !list.includes(curC) && curC[0] === '#' ? curC : null;
    box.textContent = '';
    for (const c of list) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sw'; b.setAttribute('role', 'radio'); b.dataset.c = c;
      b.style.setProperty('--c', shade(c, T)); b.setAttribute('aria-label', CNAME[c] || c); b.title = CNAME[c] || c;
      b.setAttribute('aria-checked', String(c === curC));
      b.onclick = () => pickColor(c);
      box.appendChild(b);
    }
    // any other color: the browser's own picker
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sw custom'; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', 'Another color'); b.title = 'Another color';
    b.setAttribute('aria-checked', String(!!custom));
    if (custom) b.style.background = custom;
    const inp = document.createElement('input');
    inp.type = 'color'; inp.value = custom || '#3a86ff'; inp.tabIndex = -1; inp.setAttribute('aria-label', 'Another color');
    inp.addEventListener('change', () => pickColor(inp.value.toLowerCase()));
    b.appendChild(inp); box.appendChild(b);
  }
  function sizes(kind, curV) {
    const box = $('sizes'), T = tone();
    const col = styleFor === 'sel' ? $('stylebtn').querySelector('.dot').style.getPropertyValue('--tint') || T.ink : shade(S.styles[styleFor].color, T);
    box.textContent = '';
    for (const v of SIZES[kind]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sz' + (kind === 'text' ? ' txt' : ''); b.setAttribute('role', 'radio'); b.dataset.v = v;
      b.setAttribute('aria-checked', String(curV !== null && Math.abs(v - curV) < 1e-6)); b.setAttribute('aria-label', (kind === 'text' ? 'Text size ' : 'Size ') + v);
      const i = document.createElement('span');
      if (kind === 'text') { i.textContent = 'A'; i.style.setProperty('--fs', Math.round(12 + v / 4) + 'px'); i.style.color = col; }
      else if (kind === 'highlighter') { i.style.width = '26px'; i.style.height = Math.round(v * 0.55) + 'px'; i.style.borderRadius = '3px'; i.style.background = col; i.style.opacity = '.75'; }
      else { const d = Math.round(clamp(kind === 'marker' ? v : v * 1.9, 3, 26)); i.style.width = i.style.height = d + 'px'; i.style.background = col; }
      b.appendChild(i);
      b.onclick = () => pickSize(kind, v);
      box.appendChild(b);
    }
  }
  function pickColor(c) {
    if (styleFor === 'sel') { if (pad.pad) pad.pad.restyleSelection({ color: colorOut(c) }); }
    else if (S.styles[styleFor]) { S.styles[styleFor].color = c; applyTool(); persist(); }
    closePops();
  }
  function pickSize(kind, v) {
    if (styleFor === 'sel') { if (pad.pad) pad.pad.restyleSelection(kind === 'text' ? { textSize: v } : { size: v }); }
    else if (S.styles[styleFor]) { S.styles[styleFor].size = v; applyTool(); persist(); }
    $('sizes').querySelectorAll('.sz').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.v === v)));
  }
  // [ and ]: the next size down or up for the tool in hand
  function bumpSize(d) {
    const t = styleTarget();
    if (!t || t === 'sel' || !SIZES[t]) return;
    const L = SIZES[t], v = S.styles[t].size;
    const n = d > 0 ? (L.find(x => x > v + 1e-6) || L[L.length - 1]) : (L.slice().reverse().find(x => x < v - 1e-6) || L[0]);
    if (n !== v) { S.styles[t].size = n; applyTool(); persist(); note(`${TNAME[t]}: size ${n}`, null, null, false, true); }
  }
  $('stylepop').addEventListener('click', e => {
    const b = e.target.closest('.seg button');
    if (!b) return;
    const set = b.parentNode.dataset.set, v = b.dataset.v, P = pad.pad;
    if (set === 'fill') { if (styleFor === 'sel') { if (P) P.restyleSelection({ fill: v === 'none' ? null : v }); } else { S.styles.shape.fill = v; applyTool(); persist(); } }
    else if (set === 'dash') { const d = v === 'dashed'; if (styleFor === 'sel') { if (P) P.restyleSelection({ dash: d }); } else { S.styles.shape.dash = d; applyTool(); persist(); } }
    else if (set === 'eraser') setEraser(v);
    segMark(b.parentNode, v);
  });
  function setEraser(v) { S.eraser = v; applySwitches(); persist(); }

  // ---------------------------------------------------------------- shapes
  function openShapes(anchor) {
    const box = $('kinds');
    box.textContent = '';
    for (const k of SHAPES) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'kb'; b.setAttribute('role', 'radio'); b.dataset.kind = k.kind;
      b.setAttribute('aria-checked', String(k.kind === S.styles.shape.kind));
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      for (const [a, v] of [['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) svg.setAttribute(a, v);
      use.setAttribute('href', '#s-' + k.kind); svg.appendChild(use); b.appendChild(svg);
      const t = document.createElement('span'); t.textContent = k.label; b.appendChild(t);
      b.onclick = () => { S.styles.shape.kind = k.kind; persist(); setTool('shape'); };
      box.appendChild(b);
    }
    openPop('shapepop', anchor);
  }
  // a number line or a coordinate plane just drawn: its numbers can be changed
  pad.addEventListener('nib:shape', e => {
    const d = e.detail || {}, el = d.element;
    if (!el || (d.shape !== 'numberline' && d.shape !== 'plane')) return;
    const E = pad.pad.lookOf(el) || {}, o = E.opt || {};
    const txt = d.shape === 'plane' ? `A coordinate plane, x from ${num(o.xmin)} to ${num(o.xmax)}, y from ${num(o.ymin)} to ${num(o.ymax)}.` : `A number line from ${num(o.min)} to ${num(o.max)}.`;
    note(txt, () => openAxis(el), d.shape === 'plane' ? 'Change the axes' : 'Change the numbers', false, true);
  });
  const num = v => (typeof v === 'number' && isFinite(v) ? String(v).replace('-', '−') : '?');

  // ---------------------------------------------------------------- a number line's or a plane's numbers
  // "1/4", "-3", "0.25" or "2 1/2" → a number (null when it is not one)
  function parseNum(t) {
    const m = /^\s*([−-])?\s*(\d+(?:\.\d+)?)?(?:\s*(\d+)\s*\/\s*(\d+)|\s*\/\s*(\d+(?:\.\d+)?))?\s*$/.exec(String(t || ''));
    if (!m || (!m[2] && !m[3])) return null;
    let v = m[2] ? +m[2] : 0;
    if (m[3]) v += +m[3] / +m[4];
    else if (m[5]) v = v / +m[5];
    if (!isFinite(v)) return null;
    return m[1] ? -v : v;
  }
  const FIELDS = { numberline: [['min', 'From'], ['max', 'To'], ['step', 'Every']], plane: [['xmin', 'x from'], ['xmax', 'x to'], ['ymin', 'y from'], ['ymax', 'y to'], ['step', 'Every']] };
  function openAxis(el) {
    const P = pad.pad, E = P && P.lookOf(el);
    if (!E || E.tool !== 'shape' || !FIELDS[E.shape]) return;
    axisEl = el;
    const plane = E.shape === 'plane', o = Object.assign({}, plane ? K.plane : K.numberLine, E.opt || {});
    $('axistitle').textContent = plane ? 'Coordinate plane' : 'Number line';
    const box = $('axisfields');
    box.textContent = '';
    for (const [k, label] of FIELDS[E.shape]) {
      const l = document.createElement('label'), i = document.createElement('input');
      l.textContent = label; i.type = 'text'; i.autocomplete = 'off'; i.spellcheck = false; i.dataset.k = k; i.value = String(o[k]);
      i.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); axisDone(); } });
      l.appendChild(i); box.appendChild(l);
    }
    $('axislabels').setAttribute('aria-checked', String(o.labels !== false));
    $('axisfrac').hidden = plane; $('axisfrac').setAttribute('aria-checked', String(!!o.frac));
    $('axisgrid').hidden = !plane; $('axisgrid').setAttribute('aria-checked', String(o.grid !== false));
    openPop('axispop', P.selected.includes(el) && !$('selbar').hidden ? $('seledit') : null);
    axisEl = el;
  }
  for (const id of ['axislabels', 'axisfrac', 'axisgrid']) $(id).onclick = () => $(id).setAttribute('aria-checked', String($(id).getAttribute('aria-checked') !== 'true'));
  function axisDone() {
    const P = pad.pad, el = axisEl, E = P && el && P.lookOf(el);
    if (!E) { closePops(); return; }
    const plane = E.shape === 'plane', o = {};
    for (const i of $('axisfields').querySelectorAll('input')) {
      const v = parseNum(i.value);
      if (v === null) { note(`"${i.value}" is not a number.`); i.focus(); return; }
      o[i.dataset.k] = v;
    }
    const lo = plane ? [['xmin', 'xmax'], ['ymin', 'ymax']] : [['min', 'max']];
    for (const [a, b] of lo) if (!(o[a] < o[b])) { note('The first number has to be the smaller one.'); return; }
    const span = Math.max(...lo.map(([a, b]) => o[b] - o[a]));
    if (!(o.step > 0) || span / o.step > 400) { note('That makes too many ticks: make the step bigger.'); return; }
    o.labels = $('axislabels').getAttribute('aria-checked') === 'true';
    if (plane) o.grid = $('axisgrid').getAttribute('aria-checked') === 'true'; else o.frac = $('axisfrac').getAttribute('aria-checked') === 'true';
    // restyled as a selection of one (it stays selected only in Select)
    const keep = P.selection;
    P.selection = new Set([el]);
    P.restyleSelection({ opt: o });
    if (P.mode !== 'select') { P.selection = keep.has(el) ? keep : new Set(); P.redraw(); }
    closePops();
  }
  $('axisok').onclick = axisDone;

  // ---------------------------------------------------------------- answers after "="
  function setSolve(on, quiet) {
    S.solve = on; pad.solve = on; persist(); marks();
    $('solve').setAttribute('aria-pressed', String(on));
    if (!$('latexbox').hidden) $('latexout').value = on ? pad.solved : pad.latex;
    if (!quiet) note(!on ? 'Answers are hidden.' : S.reveal ? 'End a problem with = and tap the gold ? to see its answer. Under an equation, write x = to solve it.' : 'End a problem with = to see its answer. Under an equation, write x = to solve it.');
  }
  function setReveal(on) { S.reveal = on; pad.reveal = on; persist(); marks(); }
  $('solve').onclick = () => setSolve(!S.solve);

  // ---------------------------------------------------------------- settings
  function setRail(r) {
    S.rail = r; board.dataset.rail = r; board.classList.toggle('side', r === 'left' || r === 'right'); persist(); marks();
    for (const id of POPS) if (!$(id).hidden) placePop($(id), popAnchor);
  }
  function setTheme(t) {
    S.theme = t; persist(); marks();
    if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--rail').trim() || '#f3eddc');
    if (ready) marksTools();                 // the pens' colors as they draw on the paper now
  }
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.theme === 'system') setTheme('system'); }); } catch (e) { /* ok */ }
  const attr = (n, v) => { if (v === null) { if (pad.hasAttribute(n)) pad.removeAttribute(n); } else if (pad.getAttribute(n) !== v) pad.setAttribute(n, v); };
  function setFinger(f) {
    S.finger = f;
    attr('pen-only', f === 'ignored' ? '' : null);
    attr('fingers', f === 'pans' ? 'pan' : null);
    persist(); marks(); drillRead();
  }
  function setPinch(on) { S.pinch = on; applySwitches(); persist(); marks(); }
  const SWITCHES = { holdsw: 'hold', scribsw: 'scribble', snapsw: 'snap', pressw: 'pressure', readsw: 'read' };
  for (const [id, k] of Object.entries(SWITCHES)) $(id).onclick = () => { S[k] = !S[k]; applySwitches(); persist(); };
  function applySwitches() {
    attr('hold', S.hold ? null : 'false'); attr('pressure', S.pressure ? null : 'false'); attr('read', S.read ? null : 'false'); attr('scribble', S.scribble ? null : 'false');
    attr('eraser', S.eraser === 'area' ? 'area' : null); attr('pinch', S.pinch ? null : 'false');
    for (const [id, k] of Object.entries(SWITCHES)) $(id).setAttribute('aria-checked', String(S[k]));
    applyPaper();
  }
  function marks() {
    const val = { rail: S.rail, theme: S.theme, finger: S.finger, pinch: S.pinch ? 'on' : 'off', solve: S.solve ? 'on' : 'off', reveal: S.reveal ? 'on' : 'off' };
    document.querySelectorAll('#settings .seg').forEach(g => segMark(g, val[g.dataset.set]));
  }
  const SETTERS = { rail: setRail, theme: setTheme, finger: setFinger, pinch: v => setPinch(v === 'on'), solve: v => setSolve(v === 'on', true), reveal: v => setReveal(v === 'on') };
  document.querySelectorAll('#settings .seg').forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('button'); if (b && b.dataset.v && SETTERS[g.dataset.set]) SETTERS[g.dataset.set](b.dataset.v);
  }));
  function openSettings(on) {
    if (!on) { closePops(); return; }
    marks(); trainLine();
    for (const [id, k] of Object.entries(SWITCHES)) $(id).setAttribute('aria-checked', String(S[k]));
    openPop('settings');
  }
  $('gear').onclick = () => openSettings($('settings').hidden);
  function askDelete(on) {
    $('delask').hidden = !on; $('delrow').hidden = on;
    if (on) $('delq').textContent = pages.length > 1 ? `Delete page ${cur + 1} and everything on it?` : 'Delete everything on this page?';
  }
  $('delpage').onclick = () => askDelete(true);
  $('delno').onclick = () => askDelete(false);
  $('delyes').onclick = () => { openSettings(false); deletePage(); };

  // ---------------------------------------------------------------- paper
  function applyPaper() {
    const p = pages[cur].paper;
    attr('paper', p.kind + ' ' + p.tone);
    const sp = S.snap ? (SNAP[p.kind] || 0) : 0;
    attr('snap', sp ? String(sp) : null);
    marksTools();
  }
  function setPaper(p) {
    pages[cur].paper = { kind: p.kind, tone: p.tone };
    S.paper = { kind: p.kind, tone: p.tone };
    applyPaper(); persist();
    if (!$('paperpop').hidden) fillPaper();
  }
  function fillPaper() {
    const grid = $('papers'), p = pages[cur].paper, dark = themeDark();
    grid.textContent = '';
    for (const k of PAPERS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pb'; b.setAttribute('role', 'radio'); b.dataset.kind = k.kind;
      b.setAttribute('aria-checked', String(k.kind === p.kind));
      if (K.paperThumb) { try { b.appendChild(K.paperThumb({ kind: k.kind, tone: p.tone }, dark, 96, 64)); } catch (e) { /* the name alone */ } }
      const t = document.createElement('span'); t.textContent = k.label; b.appendChild(t);
      b.onclick = () => setPaper({ kind: k.kind, tone: pages[cur].paper.tone });
      grid.appendChild(b);
    }
    const tones = $('tones');
    tones.textContent = '';
    for (const t of TONES) {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.v = t.tone; b.textContent = t.label;
      b.setAttribute('aria-checked', String(t.tone === p.tone));
      b.onclick = () => setPaper({ kind: pages[cur].paper.kind, tone: t.tone });
      tones.appendChild(b);
    }
    $('paperhint').textContent = pages.length > 1 ? `For page ${cur + 1}. New pages take the paper last chosen.` : 'For this page. New pages take the paper last chosen.';
  }
  $('paperbtn').onclick = () => { if (!$('paperpop').hidden) { closePops(); return; } fillPaper(); openPop('paperpop'); };

  // ---------------------------------------------------------------- training: keep the writing, to fine-tune Nib
  const records = () => (pad.pad ? pad.pad.training : []);
  function trainLine() {
    const R0 = records(), n = R0.length, c = R0.filter(r => r.fixed && r.fixed.length).length;
    $('traincount').textContent = `${n} expression${n === 1 ? '' : 's'} kept · ${c} corrected`;
    $('savetrain').disabled = !n; $('forgettrain').disabled = !n;
    if (!n) askForget(false);
    drillLine();
    if (D && D.active && D.pos >= N) $('dsave').disabled = !n;
  }
  function setTrain(on, quiet) {
    S.train = on; pad.train = on; $('train').setAttribute('aria-checked', String(on)); persist();
    if (!on && D && D.active) { stopDrill(); if (!quiet) note('The drill keeps its place while training is off.'); }
    if (on && !S.trainNoted && !quiet) {
      S.trainNoted = true; persist();
      note('Nib keeps what is written on this board — the strokes and how they were read — on this computer only, until you save it. Nothing else is kept.', null, null, true);
    }
  }
  $('train').onclick = () => setTrain(!S.train);
  pad.addEventListener('nib:train', () => { trainLine(); persistTrain(); });
  // scribbled out: a note with Undo, while the scribble is still the last thing done
  let scribStep = null;
  const SCRIB_NOTE = 'Scribbled out.';
  pad.addEventListener('nib:scribble', e => {
    const d = e.detail || {};
    scribStep = d.step || null;
    const what = d.erased ? '' : ' The answer is hidden again.';
    note(SCRIB_NOTE + what, () => { if (pad.pad && scribStep) pad.pad.undoScribble(scribStep); scribStep = null; }, 'Undo', false, true);
  });
  pad.addEventListener('nib:change', () => {
    if (!scribStep || !pad.pad) return;
    const h = pad.pad.history;
    if (h[h.length - 1] !== scribStep) { scribStep = null; if (!$('note').hidden && $('notetext').textContent.indexOf(SCRIB_NOTE) === 0) $('note').hidden = true; }
  });
  function askForget(on) {
    $('forgetask').hidden = !on; $('trainbtns').hidden = on;
    if (on) { const n = records().length; $('forgetq').textContent = `Forget the ${n} expression${n === 1 ? '' : 's'} kept for training?`; }
  }
  $('forgettrain').onclick = () => askForget(true);
  $('forgetno').onclick = () => askForget(false);
  $('forgetyes').onclick = () => {
    if (pad.pad) pad.pad.trainForget();
    askForget(false); writeTrain(); trainLine();
    note('The writing kept for training is forgotten.');
  };
  $('savetrain').onclick = async () => {
    const R0 = records(); if (!R0.length) return;
    const file = { format: 'nib-training', version: 1, exported: new Date().toISOString(), engine: Nib.version, records: R0 };
    const name = `Nib-training-${today()}.json`;
    if (await offer(name, new Blob([JSON.stringify(file)], { type: 'application/json' }))) note(`Saved ${name} (${R0.length} expression${R0.length === 1 ? '' : 's'}).`);
  };

  // ---------------------------------------------------------------- the drill: problems to copy, each kept with what it should say
  // Each prompt is LaTeX (what the writing should read as), with how to write it ('any', 'pen' or 'finger') and an
  // optional note. Progress is kept in this browser (nib-drill-v1) so the drill can be stopped and taken up again.
  const DRILL = { id: 'v1', items: [
    ...['7-1=', '17+71=', '1001-101=', '46\\cdot 9=', '69+96=', '555-55=', '2\\cdot 22+2=', '444\\div 4=',
      '0.5+0.25=', '3.14\\cdot 2=', '4\\cdot 0.4=', '12.5\\%\\cdot 80=', '7.07-0.7=',
      '\\frac{1}{2}+\\frac{1}{3}=', '2\\frac{3}{4}-1\\frac{1}{2}=', '\\frac{2}{3}\\cdot\\frac{9}{4}=', '\\frac{3+5}{2+2}='].map(tex => ({ tex })),
    { tex: '7+\\frac{1}{8}=', note: 'fraction small and a little off-centre' },
    ...['2^{5}-5^{2}=', '3^{-2}=', '(-4)^{2}=', '\\sqrt{144}=', '\\sqrt[3]{64}=', '\\sqrt[3]{1000}=', '|-12|+|7|=', '10^{3}\\cdot 10^{-1}=',
      '4x+4-x=', '2a+3b-a+b=', '5t-7t=', '3(2x-4)=', '(x+1)(x+4)=', '2(x+3)-4(x-1)=', '\\frac{1}{2}x+\\frac{1}{4}x=', 'g+g+g=', '6p-2q+p=',
      '4x-7=21 \\\\ x=', '2(x+3)=14 \\\\ x=', '\\frac{x}{5}+2=6 \\\\ x=', '3x+4=x+10 \\\\ x=', 'x^{2}=64 \\\\ x=', 'x^{2}+6x+8=0 \\\\ x=', '2x+3y=12 \\\\ y=', 'x+y=9 \\\\ x-y=1 \\\\ x=',
      '3x-2<10 \\\\ x<', '-2x+1\\ge 7 \\\\ x\\le', '5\\ne 4',
      '(12)(3)=', '12(3)+1=', '(-3)(-7)=', '1(1+1)='].map(tex => ({ tex })),
    { tex: '144\\cdot 69=', note: 'small' }, { tex: '144\\cdot 69=', note: 'large' }, { tex: '144\\cdot 69=', note: 'fast' },
    { tex: '7+4=', note: 'your usual 4' }, { tex: '7+4=', note: 'a closed 4' },
    ...['7+4=', '13-6=', '2x+5x=', '\\frac{1}{2}+\\frac{1}{4}=', '3(x-2)='].map(tex => ({ tex, how: 'finger' })),
  ].map((it, i) => ({ item: i + 1, tex: it.tex, how: it.how || 'any', note: it.note || null })) };
  const NOTES = { small: 'Write it small', large: 'Write it large', fast: 'Write it fast', 'your usual 4': 'Write your usual 4', 'a closed 4': 'Write a closed 4',
    'fraction small and a little off-centre': 'The fraction small and a little off-center' };
  // two readings are the same problem when they differ only in spacing, · for \cdot, how a fraction or power is
  // braced, \leq for \le and the like, or a final "=" (tools/training_to_jsonl.py does the same)
  function normLine(l) {
    return l.replace(/\\left(?![a-zA-Z])|\\right(?![a-zA-Z])/g, '').replace(/\\[,;:! ]/g, '').replace(/~/g, '').replace(/\s+/g, '')
      .replace(/[·⋅]/g, '\\cdot').replace(/\\[dt]frac(?![a-zA-Z])/g, '\\frac').replace(/\\(le|ge|ne)q(?![a-zA-Z])/g, '\\$1').replace(/\\%/g, '%')
      .replace(/\\frac([^{\\])/g, '\\frac{$1}').replace(/\\frac(\{[^{}]*\})([^{\\])/g, '\\frac$1{$2}').replace(/([\^_])([^{\\])/g, '$1{$2}');
  }
  function normTex(t) {
    const lines = String(t || '').replace(/\\begin\{gathered\}|\\end\{gathered\}/g, '').split('\\\\').map(normLine).filter(Boolean);
    if (lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/=$/, '');
    return lines.join('\\\\');
  }
  // LaTeX as plain text, for a page without KaTeX: fractions a/b, roots √ ∛, powers in superscript digits
  const SUP = { '−': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻', '+': '⁺', '(': '⁽', ')': '⁾', n: 'ⁿ', x: 'ˣ' };
  const OPS = { '\\cdot': '·', '\\times': '×', '\\div': '÷', '\\ge': '≥', '\\le': '≤', '\\ne': '≠', '\\geq': '≥', '\\leq': '≤', '\\neq': '≠', '\\pm': '±', '+': '+', '=': '=', '<': '<', '>': '>', '-': '−' };
  const SYMS = { '\\%': '%', '\\ldots': '…', '\\pi': 'π', '\\infty': '∞', '\\circ': '°' };
  function texLine(src) {
    let i = 0, stacked = false;
    const group = () => {
      while (src[i] === ' ') i++;
      if (src[i] !== '{') return src[i++] || '';
      let d = 0, j = i;
      for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
      const g = src.slice(i + 1, j); i = j + 1; return g;
    };
    const toks = [];                       // {op} or {a: text}
    const atom = a => { const p = toks[toks.length - 1]; if (p && p.a !== undefined) p.a += a; else toks.push({ a }); };
    const simple = t => /^[0-9A-Za-z.]+$/.test(t);
    const wrap = t => (simple(t) ? t : '(' + t + ')');
    while (i < src.length) {
      const c = src[i];
      if (c === ' ' || c === '{' || c === '}') { i++; continue; }
      if (c === '\\') {
        const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i)), cmd = m[0]; i += cmd.length;
        if (cmd === '\\frac') {
          const a = texLine(group()), b = texLine(group()); stacked = true;
          const p = toks[toks.length - 1];
          if (p && p.a !== undefined && /[0-9]$/.test(p.a)) p.a += ' ';      // a mixed number: 2 3/4
          atom(wrap(a.text) + '/' + wrap(b.text));
          if (/^[A-Za-z(]/.test(src.slice(i).trim())) atom(' ');           // ½x: 1/2 x
          continue;
        }
        if (cmd === '\\sqrt') {
          let n = '';
          if (src[i] === '[') { const j = src.indexOf(']', i); n = src.slice(i + 1, j); i = j + 1; }
          const b = texLine(group()); if (b.stacked) stacked = true;
          atom((n === '3' ? '∛' : n === '4' ? '∜' : n ? n + '√' : '√') + wrap(b.text));
          continue;
        }
        if (OPS[cmd]) { toks.push({ op: OPS[cmd] }); continue; }
        if (SYMS[cmd]) { atom(SYMS[cmd]); continue; }
        if (/^\\[,;:! ]$/.test(cmd) || cmd === '\\left' || cmd === '\\right') continue;
        if (/^\\(begin|end)$/.test(cmd)) { group(); continue; }
        atom(cmd.slice(1)); continue;
      }
      if (c === '^' || c === '_') {
        i++; const g = texLine(group()), t = g.text.replace(/\s+/g, '');
        if (c === '^' && [...t].every(ch => SUP[ch])) atom([...t].map(ch => SUP[ch]).join(''));
        else atom(c + wrap(t));
        continue;
      }
      i++;
      if (c === '-') {                     // a minus sign after nothing, an operator or "(" is part of the number
        const p = toks[toks.length - 1];
        if (!p || p.op || /[(|]$/.test(p.a)) { atom('−'); continue; }
      }
      if (OPS[c]) { toks.push({ op: OPS[c] }); continue; }
      atom(c === ',' ? ', ' : c);
    }
    let text = '';
    for (const t of toks) text += t.op ? ' ' + t.op + ' ' : t.a;
    return { text: text.replace(/\s+/g, ' ').trim(), stacked };
  }
  const texLines = t => String(t || '').replace(/\\begin\{gathered\}|\\end\{gathered\}/g, '').split('\\\\').map(l => l.trim()).filter(Boolean);
  const plain = t => texLines(t).map(l => texLine(l).text).join(' / ');
  // KaTeX when the page has it, else plain text in the typeset fonts (the Board's own builds have no KaTeX)
  function showTex(el, tex) {
    el.textContent = '';
    for (const l of texLines(tex)) {
      const d = document.createElement('span'); d.className = 'dl';
      let done = false;
      if (window.katex && typeof window.katex.render === 'function') { try { window.katex.render(l, d, { throwOnError: true, displayMode: false }); done = true; } catch (e) { done = false; } }
      if (!done) {
        // letters in the math italic, as typeset
        const r = texLine(l);
        for (const run of r.text.split(/([A-Za-z]+)/)) {
          if (!run) continue;
          if (/^[A-Za-z]+$/.test(run)) { const v = document.createElement('i'); v.textContent = run; d.appendChild(v); }
          else d.appendChild(document.createTextNode(run));
        }
        if (r.stacked) { const s = document.createElement('span'); s.className = 'stk'; s.textContent = '(stacked)'; d.appendChild(s); }
      }
      el.appendChild(d);
    }
  }
  const N = DRILL.items.length;
  const fresh = () => ({ v: 1, drill: DRILL.id, pos: 0, skipped: [], done: [], fixed: [], active: false });
  try {
    const d = JSON.parse(localStorage.getItem(DKEY) || 'null');
    if (d && d.drill === DRILL.id && Number.isInteger(d.pos)) D = Object.assign(fresh(), d, { pos: Math.max(0, Math.min(N, d.pos)),
      skipped: arr(d.skipped), done: arr(d.done), fixed: arr(d.fixed), active: d.active === true });
  } catch (e) { /* none, or storage blocked */ }
  const saveDrill = () => { if (!writer) return; try { if (D) localStorage.setItem(DKEY, JSON.stringify(D)); else localStorage.removeItem(DKEY); } catch (e) { /* the drill then lasts while the page is open */ } };
  const underway = () => !!(D && D.pos < N && (D.pos > 0 || D.done.length || D.skipped.length));
  function drillLine() {
    const go = $('drillgo'), again = $('drillagain');
    if (underway()) { go.textContent = `Continue the drill · ${D.pos + 1} / ${N}`; again.hidden = false; }
    else { go.textContent = D && D.pos >= N ? 'Start the drill again' : 'Start the drill'; again.hidden = true; }
  }
  function startDrill(over) {
    if (!D || over || D.pos >= N) D = fresh();
    D.active = true; saveDrill();
    openSettings(false);
    commitText();
    pad.trainMeta = null;
    // a new page, unless this one is empty already (before training goes on: what was written with it off stays out)
    if (pad.pad.strokes.length) { pages[cur] = here(); snaps[cur] = pad.pad.snapshot(); pages.push(blank()); goPage(pages.length - 1); }
    if (S.tool !== 'pen' && S.tool !== 'marker') setTool('pen', true);
    if (!S.train) setTrain(true);          // with the first-time note
    try { Nib._internals.typeFontsReady(); } catch (e) { /* the system's math font then */ }
    drillShow();
  }
  function stopDrill() {
    if (!D) return;
    D.active = false; saveDrill();
    if (fixing) fixMode(false);
    pad.trainMeta = null; dCur = null; clearTimeout(dTimer);
    $('drill').hidden = true; $('drill').classList.remove('warn');
    drillLine();
  }
  function drillShow() {
    const bar = $('drill');
    if (!D || !D.active) { bar.hidden = true; return; }
    bar.hidden = false;
    const end = D.pos >= N;
    $('dq').hidden = end; $('dplay').hidden = end; $('dsum').hidden = !end; $('dend').hidden = !end;
    if (end) {
      pad.trainMeta = null; dCur = null; bar.classList.remove('warn');
      const fixedN = D.fixed.length, sk = D.skipped.slice().sort((a, b) => a - b);
      $('dn').textContent = `${N} / ${N}`;
      $('dsum').textContent = `${D.done.length} done, ${sk.length} skipped, ${fixedN} fixed`;
      if (sk.length) { const s = document.createElement('small'); s.textContent = 'Skipped: ' + sk.join(', '); $('dsum').appendChild(s); }
      $('dsave').disabled = !records().length;
      return;
    }
    const it = DRILL.items[D.pos];
    pad.trainMeta = Object.assign({ expect: it.tex, drill: DRILL.id, item: it.item, how: it.how }, it.note ? { note: it.note } : {});
    showTex($('dprompt'), it.tex);
    const lines = texLines(it.tex).length, how = [];
    if (it.how === 'finger') how.push('With your finger');
    if (it.note) how.push(NOTES[it.note] || it.note);
    if (lines > 1) how.push(lines > 2 ? 'Each line under the one before' : 'The first line, then the second under it');
    dHow = how.join(' · '); $('dhow').textContent = dHow;
    $('dn').textContent = `${D.pos + 1} / ${N}`;
    $('dfix').setAttribute('aria-pressed', String(fixing));
    $('dback').disabled = D.pos === 0;
    drillRead();
  }
  // the writing for this prompt: read, and the pen rested for a second
  function drillRead() {
    clearTimeout(dTimer); dTimer = null;
    if (!D || !D.active || D.pos >= N) return;
    const P = pad.pad, el = $('dread'), it = DRILL.items[D.pos], bar = $('drill');
    const say = (txt, state) => { el.textContent = txt; el.dataset.state = state; };
    dCur = null; bar.classList.remove('warn'); $('dhow').textContent = dHow;
    $('dright').disabled = true;
    if (S.tool === 'eraser' || (P && P.mode === 'erase')) { say('Erase is on: the pen rubs out. Tap Erase again to write.', 'wait'); return; }
    if (!fixing && S.tool !== 'pen' && S.tool !== 'marker') { say('Pick the pen to write it.', 'wait'); return; }
    const ink = P ? P.ink : [];
    if (it.how === 'finger' && S.finger !== 'writes' && !ink.length) {
      say(S.finger === 'pans' ? 'A finger is set to move the board in Settings: set it to Writes for this one, or Skip.' : 'A finger is set to do nothing in Settings: set it to Writes for this one, or Skip.', 'wait');
      return;
    }
    if (!ink.length) { say('Write it on the board.', 'wait'); return; }
    if (!P.result || P.ptrs.size || P.resultStrokes.length !== ink.length || P.resultStrokes.some((s, i) => s !== ink[i])) { say('Reading…', 'wait'); return; }
    let last = 0;
    for (const s of ink) { const q = s[s.length - 1]; if (q && q[2] > last) last = q[2]; }
    const rest = last ? 1000 - (performance.now() - last) : 0;
    if (rest > 0) { say('Reading…', 'wait'); dTimer = setTimeout(drillRead, rest + 20); return; }
    // the board's pieces, and the lines each one starts at (answers are numbered by line across the board)
    const parts = [];
    let li = 0;
    for (const p of P.result.parts || [{ strokes: P.resultStrokes, result: P.result }]) {
      const r = p.result;
      if (!r || !r.lines || !r.lines.length || !p.strokes.length) continue;
      parts.push({ strokes: p.strokes, result: r, line: li, n: r.tree.length });
      li += r.tree.length;
    }
    if (!parts.length) { say('Nothing read yet. Write it a little bigger?', 'wait'); return; }
    const want = normTex(it.tex);
    const joined = p => p.result.lines.map(l => l.latex).join(' \\\\ ');
    const newest = p => Math.max(...p.strokes.map(s => (s[s.length - 1] || [])[2] || 0));
    const part = parts.find(p => normTex(joined(p)) === want) || parts.slice().sort((a, b) => newest(b) - newest(a) || b.strokes.length - a.strokes.length)[0];
    const tex = joined(part), match = normTex(tex) === want;
    const ans = pad.answers.filter(a => a.line >= part.line && a.line < part.line + part.n).map(a => plain(a.latex));
    dCur = { strokes: part.strokes, match };
    say('', match ? 'match' : 'miss');
    const b = document.createElement('b'); b.textContent = 'Read: ';
    el.appendChild(b); el.appendChild(document.createTextNode(plain(tex) + (ans.length ? ' → ' + ans.join(', ') : '') + (match ? '' : '  (not what it should be)')));
    // a prompt for the finger, written with a pen or a mouse: said again, in coral (it is still kept)
    const by = it.how === 'finger' ? part.strokes.map(s => P.strokeInfo(s).type).find(t => t && t !== 'touch') : null;
    if (by) { bar.classList.add('warn'); $('dhow').textContent = `${dHow} — that was ${by === 'pen' ? 'the pen' : 'a mouse'}: with your finger, please`; }
    $('dright').disabled = false;
  }
  function drillNext() {
    D.pos++; saveDrill(); dCur = null;
    if (D.pos >= N) note('The drill is done. Save training keeps it as a file.');
    drillShow();
  }
  $('dright').onclick = () => {
    if (!dCur || !pad.pad) return;
    if (fixing) fixMode(false);
    const it = DRILL.items[D.pos], P = pad.pad;
    const rec = P.trainKeep(dCur.strokes);
    if (!rec) { drillRead(); return; }
    P.trainVerify(rec.key, true);
    if (!D.done.includes(rec.key)) D.done.push(rec.key);
    if (rec.fixed && rec.fixed.length && !D.fixed.includes(it.item)) D.fixed.push(it.item);
    D.skipped = D.skipped.filter(k => k !== it.item);
    pad.trainMeta = null;                  // anything else on the page is kept as free writing
    pad.clear();
    drillNext();
  };
  $('dskip').onclick = () => {
    if (!D) return;
    if (fixing) fixMode(false);
    const it = DRILL.items[D.pos];
    if (!D.skipped.includes(it.item)) D.skipped.push(it.item);
    pad.trainMeta = null;
    if (pad.pad) pad.pad.trainIgnore();    // a skipped prompt keeps nothing
    pad.clear();
    drillNext();
  };
  $('dfix').onclick = () => { fixMode(!fixing); };
  $('dundo').onclick = () => { if (fixing) fixMode(false); pad.undo(); };
  // back to the prompt before: what Right kept for it is dropped, a skip is unmarked, and it is written again
  $('dback').onclick = () => {
    if (!D || D.pos === 0) return;
    if (fixing) fixMode(false);
    pad.trainMeta = null;
    if (pad.pad) pad.pad.trainIgnore();           // what is on the board for the current prompt keeps nothing
    pad.clear();
    D.pos--;
    const it = DRILL.items[D.pos], P = pad.pad;
    // the record kept for that prompt, if any: the newest record carrying its item number
    const kept = (P ? P.training : []).filter(r => r.drill === DRILL.id && r.item === it.item).map(r => r.key);
    if (kept.length && P) P.trainDrop(kept);
    D.done = D.done.filter(k => !kept.includes(k));
    D.skipped = D.skipped.filter(k => k !== it.item);
    D.fixed = D.fixed.filter(k => k !== it.item);
    saveDrill(); drillShow();
  };
  $('dstop').onclick = () => { stopDrill(); note(`Stopped at ${D.pos + 1} of ${N}. Settings, Training continues the drill.`); };
  $('dclose').onclick = () => stopDrill();
  $('dagain').onclick = () => startDrill(true);
  $('dsave').onclick = () => $('savetrain').onclick();
  $('drillgo').onclick = () => { if (D && D.active) { openSettings(false); return; } startDrill(false); };
  $('drillagain').onclick = () => startDrill(true);

  // ---------------------------------------------------------------- what is on the board changed
  function tools() {
    const P = pad.pad, n = P ? P.strokes.length : 0;
    $('undo').disabled = !(P && P.canUndo); $('redo').disabled = !(P && P.canRedo);
    $('clear').disabled = !n; $('copy').disabled = !pad.latex; $('selall').disabled = !n;
    const any = !!(pad.result && pad.result.symbols.length);
    $('fix').disabled = !any; if (!any && fixing) fixMode(false);
    $('pageno').textContent = (cur + 1) + ' / ' + pages.length;
    $('pageno').title = `Page ${cur + 1} of ${pages.length}: all the pages`;
    $('prev').disabled = cur === 0; $('next').disabled = cur === pages.length - 1;
  }
  pad.addEventListener('nib:change', () => { closeFix(); tools(); persist(); drillRead(); if (fixing && pad.mode !== 'fix') fixMode(false); });
  pad.addEventListener('change', () => { closeFix(); tools(); persist(); drillRead(); if (!$('latexbox').hidden) $('latexout').value = S.solve ? pad.solved : pad.latex; });

  // ---------------------------------------------------------------- pages
  function goPage(i) {
    if (i < 0 || i >= pages.length || i === cur) return;
    commitText();
    if (fixing) fixMode(false);
    pages[cur] = here(); snaps[cur] = pad.pad.snapshot();
    cur = i;
    applyPaper();
    if (snaps[i]) pad.pad.restore(snaps[i]); else pad.setState(pages[i]);
    tools(); persist(); showSel();
  }
  function newPage() {
    commitText();
    pages[cur] = here(); snaps[cur] = pad.pad.snapshot();
    pages.push(blank()); goPage(pages.length - 1);
    note(`Page ${cur + 1}. The arrows go back to the others.`);
  }
  function deletePage() {
    commitText();
    if (fixing) fixMode(false);
    if (pages.length === 1) { pages = [blank()]; pages[0].paper = Object.assign({}, pages[0].paper); snaps.length = 0; applyPaper(); pad.setState(pages[0]); tools(); persist(); note('The page is empty now.'); return; }
    const gone = cur + 1;
    pages.splice(cur, 1); snaps.splice(cur, 1);
    cur = Math.min(cur, pages.length - 1);
    applyPaper();
    if (snaps[cur]) pad.pad.restore(snaps[cur]); else pad.setState(pages[cur]);
    tools(); persist(); note(`Page ${gone} deleted.`);
  }
  // a copy of this page, after it (its pictures are shared: they are kept by id)
  function dupPage() {
    commitText();
    pages[cur] = here(); snaps[cur] = pad.pad.snapshot();
    const copy = JSON.parse(JSON.stringify(pages[cur]));
    pages.splice(cur + 1, 0, copy); snaps.splice(cur + 1, 0, undefined);
    goPage(cur + 1);
    note(`Page ${cur + 1} is a copy of page ${cur}.`);
  }
  function movePage(d) {
    const j = cur + d;
    if (j < 0 || j >= pages.length) return;
    commitText();
    pages[cur] = here(); snaps[cur] = pad.pad.snapshot();
    [pages[cur], pages[j]] = [pages[j], pages[cur]]; [snaps[cur], snaps[j]] = [snaps[j], snaps[cur]];
    cur = j; tools(); persist();
    if (!$('pagespop').hidden) fillPages();
  }
  $('prev').onclick = () => goPage(cur - 1);
  $('next').onclick = () => goPage(cur + 1);
  $('newpage').onclick = newPage;
  $('pgnew').onclick = () => { closePops(); newPage(); };
  $('pgdup').onclick = () => { closePops(); dupPage(); };
  $('pgleft').onclick = () => movePage(-1);
  $('pgright').onclick = () => movePage(1);
  $('pageno').onclick = () => { if (!$('pagespop').hidden) { closePops(); return; } fillPages(); openPop('pagespop'); };
  // every page, small: the one on the board as it shows, the others as written
  let pagesGen = 0;
  async function fillPages() {
    const gen = ++pagesGen, grid = $('pagegrid');
    pages[cur] = here();
    grid.textContent = '';
    const cells = pages.map((p, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pg'; b.setAttribute('aria-label', 'Page ' + (i + 1));
      if (i === cur) b.setAttribute('aria-current', 'page');
      const cv = document.createElement('canvas'); cv.width = 240; cv.height = 180;
      const t = document.createElement('span'); t.textContent = 'Page ' + (i + 1);
      b.appendChild(cv); b.appendChild(t);
      b.onclick = () => { closePops(); goPage(i); };
      grid.appendChild(b);
      return cv;
    });
    $('pgleft').disabled = cur === 0; $('pgright').disabled = cur === pages.length - 1;
    for (let i = 0; i < cells.length; i++) {
      await frame();
      if (gen !== pagesGen || $('pagespop').hidden) return;
      await withR(() => { if (gen === pagesGen && !$('pagespop').hidden) { try { thumbInto(i, cells[i]); } catch (e) { /* that page stays blank */ } } });
    }
  }
  function thumbInto(i, cv) {
    const el = i === cur ? pad : prepR(pages[i], { view: 'ink', solve: false, paper: pages[i].paper, auto: false });
    const P = el.pad, W = cv.width, H = cv.height;
    let r = P.contentRect(30);
    if (!r) { const v = P.viewRect; r = [v[0], v[1], v[0] + 640, v[1] + 480]; }   // an empty page: its paper
    const w = r[2] - r[0], h = r[3] - r[1];
    if (w / h > W / H) { const nh = w * H / W; r = [r[0], r[1] - (nh - h) / 2, r[2], r[3] + (nh - h) / 2]; }
    else { const nw = h * W / H; r = [r[0] - (nw - w) / 2, r[1], r[2] + (nw - w) / 2, r[3]]; }
    const c = el.exportImage({ rect: r, scale: W / (r[2] - r[0]), answers: 'shown' });
    cv.getContext('2d').drawImage(c, 0, 0, W, H);
  }

  // ---------------------------------------------------------------- fix a misread symbol: tap it, pick what it is
  const SHOW = { '-': '−', '\\times': '×', '\\div': '÷', '\\pm': '±', '\\le': '≤', '\\ge': '≥', '\\ne': '≠',
    '\\cdot': '⋅', '\\pi': 'π', '\\theta': 'θ', '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\lambda': 'λ',
    '\\mu': 'μ', '\\sigma': 'σ', '\\phi': 'ϕ', '\\Delta': 'Δ', '\\sqrt': '√', '\\infty': '∞', '\\rightarrow': '→',
    '\\in': '∈', '\\circ': '°', '\\prime': '′', '\\{': '{', '\\}': '}', '\\ldots': '…', '\\sum': '∑', '\\int': '∫',
    '\\forall': '∀', '\\exists': '∃', '\\lim': 'lim', '\\log': 'log', '\\sin': 'sin', '\\cos': 'cos', '\\tan': 'tan' };
  const shownAs = l => SHOW[l] || l;
  function fixMode(on) {
    fixing = on; emptyTaps = 0; $('fix').setAttribute('aria-pressed', String(on)); $('dfix').setAttribute('aria-pressed', String(on)); closeFix();
    if (on) {
      // Fix is for what the pen wrote: the pen in hand (writing still writes, and leaves Fix)
      if (S.tool !== 'pen' && S.tool !== 'marker') { S.tool = S.ink === 'marker' ? 'marker' : 'pen'; S.ink = S.tool; }
      applyTool();
      pad.mode = 'fix';
      try { Nib._internals.typeFontsReady(); } catch (e) { /* the system's math font then */ }
      note('Tap a symbol to fix how it was read. Just write to carry on.');
    } else {
      if (pad.mode === 'fix') pad.mode = modeOf(S.tool);
      if (/^Tap a symbol/.test($('notetext').textContent)) $('note').hidden = true;
    }
    marksTools();
  }
  function closeFix() { if (!$('fixpop').hidden) { $('fixpop').hidden = true; $('fixpop').textContent = ''; } fixFor = null; }
  // the symbol drawn under a point (as the view shows it: tidied, in your hand, typeset or as written): the smallest
  // one the point is inside, else the closest one within a finger's width (world units)
  function symbolAt(x, y) {
    const P = pad.pad, res = P && P.result;
    if (!res || !res.symbols.length) return null;
    let inside = null, near = null;
    const reach = 12 / P.cam.z;
    for (const sym of res.symbols) {
      const objs = sym.strokes.map(i => P.resultStrokes[i]);
      const it = P.plan && P.plan.items.find(q => q.from.length === objs.length && q.from.every(o => objs.includes(o)));
      const b = it ? it.box : [sym.box.x, sym.box.y, sym.box.x + sym.box.w, sym.box.y + sym.box.h];
      const d = Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
      const area = Math.max(b[2] - b[0], 4) * Math.max(b[3] - b[1], 4);
      if (d === 0) { if (!inside || area < inside.area) inside = { sym, box: b, area }; }
      else if (d <= reach && (!near || d < near.d)) near = { sym, box: b, d };
    }
    return inside || near;
  }
  function openFix(hit) {
    const pop = $('fixpop'), sym = hit.sym, P = pad.pad;
    pop.textContent = '';
    // a dot can be a times dot or a decimal point: offer both
    const cands = sym.candidates.map(c => c[0]);
    const dot = cands.indexOf('.');
    if (dot >= 0 && !cands.includes('\\cdot')) cands.splice(sym.label === '.' ? 0 : dot, 0, '\\cdot');
    const labels = [sym.label].concat(cands.filter(l => l !== sym.label)).slice(0, 6);
    for (const l of labels) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cand'; b.textContent = shownAs(l); b.dataset.label = l;
      b.setAttribute('aria-pressed', String(l === sym.label)); b.setAttribute('aria-label', l === sym.label ? 'Keep ' + l : 'Make it ' + l);
      b.onclick = () => {
        closeFix();                                      // Fix stays on for the next symbol
        if (l === sym.label) return;
        pad.relabel(sym, l);
        note(`Changed to ${shownAs(l)}. Nib will read this shape better from now on.`);
      };
      pop.appendChild(b);
    }
    pop.hidden = false; fixFor = sym;
    // just below the symbol, or above it when there is no room; always inside the board
    const Sf = surface.getBoundingClientRect(), C = P.canvas.getBoundingClientRect();
    const ox = C.left - Sf.left, oy = C.top - Sf.top, w = pop.offsetWidth, h = pop.offsetHeight;
    const a = P.toScreen([hit.box[0], hit.box[1]]), c = P.toScreen([hit.box[2], hit.box[3]]);
    let left = ox + (a[0] + c[0]) / 2 - w / 2, top = oy + c[1] + 12;
    if (top + h > Sf.height - 8) top = oy + a[1] - h - 12;
    pop.style.left = clamp(left, 8, Sf.width - w - 8) + 'px';
    pop.style.top = clamp(top, 8, Sf.height - h - 8) + 'px';
    const alt = pop.querySelector('.cand[aria-pressed="false"]'); (alt || pop.firstChild).focus();
  }
  $('fix').onclick = () => fixMode(!fixing);
  pad.addEventListener('nib:tap', e => {
    if (!fixing) return;
    const hit = symbolAt(e.detail.x, e.detail.y);
    if (!hit) {
      closeFix();
      // empty space twice in a row: done fixing
      if (++emptyTaps >= 2) { fixMode(false); return; }
      note('Tap a symbol to fix how it was read. Tap empty space again to stop.');
      return;
    }
    emptyTaps = 0;
    if (fixFor === hit.sym) { closeFix(); return; }
    $('note').hidden = true;
    openFix(hit);
  });

  // ---------------------------------------------------------------- undo, clear, LaTeX, handwriting
  $('undo').onclick = () => { commitText(); pad.undo(); };
  $('redo').onclick = () => { commitText(); pad.redo(); };
  $('clear').onclick = () => { commitText(); pad.clear(); note(pages.length > 1 ? 'Page cleared. Undo brings it back.' : 'Board cleared. Undo brings it back.'); };
  $('hand').onclick = () => { closePops(); $('file').click(); };
  $('file').onchange = () => {
    const f = $('file').files[0]; $('file').value = '';
    if (!f) return;
    f.text().then(t => {
      let n = 0;
      try { n = Nib.hand.load(t); } catch (e) { note('That file is not handwriting saved from Replicator.'); return; }
      setView('hand', true);
      note(`Your handwriting is ready: ${n} characters${Nib.hand.name ? ' from ' + Nib.hand.name : ''}. It stays in this browser.`);
    });
  };
  let lastPointer = 'mouse';
  document.addEventListener('pointerdown', e => { lastPointer = e.pointerType || 'mouse'; }, true);
  $('copy').onclick = () => {
    closePops();
    const t = S.solve ? pad.solved : pad.latex; if (!t) return;
    const done = () => { $('latexbox').hidden = true; note('LaTeX copied.'); };
    const manual = () => {
      $('latexbox').hidden = false; $('latexout').value = t; $('latexout').focus(); $('latexout').select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      if (ok) { done(); return; }
      note(lastPointer === 'touch' || lastPointer === 'pen' ? 'Long-press the text to copy.' : 'Press Ctrl+C to copy the LaTeX.');
    };
    try { navigator.clipboard.writeText(t).then(done, manual); } catch (e) { manual(); }
  };
  $('morebtn').onclick = () => { if (!$('morepop').hidden) { closePops(); return; } $('morepaste').disabled = !clip; openPop('morepop'); };
  // on a panel or a tablet there is no Ctrl+V: what the selection bar copied is pasted from here (onto any page)
  $('morepaste').onclick = () => { closePops(); pasteClip(); };
  $('morehelp').onclick = () => openPop('helppop', $('morebtn'));
  $('selall').onclick = () => { closePops(); selectAll(); };
  $('moredfit').onclick = () => { closePops(); fitAll(); };

  // ---------------------------------------------------------------- what is selected: a bar of what can be done with it
  function selectAll() { const P = pad.pad; if (!P || !P.strokes.length) return; if (!SELECTS.includes(S.tool)) setTool('select', true); P.selectAll(); }
  function showSel() {
    const P = pad.pad, bar = $('selbar');
    const sel = P && P.mode === 'select' && !P.editing ? P.selected : [];
    if (!sel.length || P.ptrs.size || P.gesture) { bar.hidden = true; return; }
    const looks = sel.map(s => P.lookOf(s) || {}), one = sel.length === 1 ? looks[0] : null;
    const axis = !!(one && one.tool === 'shape' && (one.shape === 'numberline' || one.shape === 'plane'));
    $('seledit').hidden = !(one && (one.tool === 'text' || axis));
    $('seledit').title = one && one.tool === 'text' ? 'Change the text' : axis ? (one.shape === 'plane' ? 'Change the axes' : 'Change the numbers') : '';
    $('seledit').setAttribute('aria-label', $('seledit').title || 'Change it');
    $('selcolor').hidden = looks.every(E => E.tool === 'image');
    const c = same(looks.filter(E => E.tool !== 'image').map(E => E.color || '@ink'));
    $('selcolor').querySelector('.dot').style.setProperty('--tint', c ? shade(c) : 'conic-gradient(#d1352b, #e8c35a, #1d8a4b, #1f5fbf, #d1352b)');
    bar.hidden = false;
    // above the selection, else below it, always inside the board
    const b = P._selBox(sel), a = P.toScreen([b[0], b[1]]), z = P.toScreen([b[2], b[3]]);
    const Sf = surface.getBoundingClientRect(), C = P.canvas.getBoundingClientRect(), ox = C.left - Sf.left, oy = C.top - Sf.top;
    const w = bar.offsetWidth, h = bar.offsetHeight;
    let top = oy + a[1] - h - 14;
    if (top < 8) top = oy + z[1] + 14;
    if (top + h > Sf.height - 8) top = Math.max(8, oy + a[1] + 8);
    bar.style.left = clamp(ox + (a[0] + z[0]) / 2 - w / 2, 8, Sf.width - w - 8) + 'px';
    bar.style.top = clamp(top, 8, Sf.height - h - 8) + 'px';
  }
  pad.addEventListener('nib:select', () => { showSel(); marksTools(); });
  pad.addEventListener('nib:edit', () => showSel());
  // while the selection is being moved the bar steps aside
  pad.addEventListener('pointerdown', () => { if (pad.mode === 'select') $('selbar').hidden = true; });
  document.addEventListener('pointerup', () => { if (pad.mode === 'select') requestAnimationFrame(showSel); });
  $('selcolor').onclick = () => { if (!$('stylepop').hidden && styleFor === 'sel') { closePops(); return; } openStyle('sel', $('selcolor')); };
  $('seledit').onclick = () => {
    const P = pad.pad, s = P && P.selected[0], E = s && P.lookOf(s);
    if (!E) return;
    if (E.tool === 'text') P._editText(s, false); else openAxis(s);
  };
  $('seldup').onclick = () => { if (pad.pad) pad.pad.duplicateSelection(); };
  $('selcopy').onclick = () => { if (copySel(false)) note('Copied. More, Paste what was copied puts it on any page (or Ctrl+V).'); };
  $('selfront').onclick = () => { if (pad.pad) pad.pad.orderSelection(true); };
  $('selback').onclick = () => { if (pad.pad) pad.pad.orderSelection(false); };
  $('seldel').onclick = () => { if (pad.pad) pad.pad.deleteSelection(); };
  $('selpic').onclick = () => saveSelPicture();
  // copied elements paste on any page; the clipboard gets a mark so a paste can tell them from text copied elsewhere
  function copySel(cut) {
    const P = pad.pad, c = P && P.copySelection();
    if (!c) return false;
    clip = c; clipMark = 'Nib Board: ' + c.items.length + ' thing' + (c.items.length === 1 ? '' : 's') + ' copied ' + Date.now().toString(36);
    try { navigator.clipboard.writeText(clipMark).catch(() => { clipMark = null; }); } catch (e) { clipMark = null; }
    if (cut) P.deleteSelection();
    return true;
  }
  function pasteClip() {
    const P = pad.pad;
    if (!P || !clip) return false;
    if (!SELECTS.includes(S.tool)) setTool('select', true);
    for (const it of clip.items) if (it.info && it.info.img) fetchImage(it.info.img, pad);
    P.paste(clip);
    return true;
  }

  // ---------------------------------------------------------------- zoom
  const ZSTEPS = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8];
  function zoomStep(dir) {
    const P = pad.pad; if (!P) return;
    const z = P.cam.z, t = dir > 0 ? ZSTEPS.find(s => s > z * 1.01) : ZSTEPS.slice().reverse().find(s => s < z / 1.01);
    if (t) P.zoomAt(t / z);
  }
  const zoom100 = () => { const P = pad.pad; if (P) P.zoomAt(1 / P.cam.z); };
  function fitAll() { const P = pad.pad; if (!P) return; if (!P.strokes.length) P.setCamera({ x: 0, y: 0, z: 1 }); else P.fitContent(48, 1); }
  $('zin').onclick = () => zoomStep(1);
  $('zout').onclick = () => zoomStep(-1);
  $('zpct').onclick = zoom100;
  $('zfit').onclick = fitAll;
  pad.addEventListener('nib:camera', e => {
    const z = e.detail && e.detail.z;
    if (z) $('zpct').textContent = Math.round(z * 100) + '%';
    closeFix(); showSel(); persist();
  });

  // ---------------------------------------------------------------- pictures: insert, paste, drop; kept in IndexedDB
  pad.addEventListener('nib:image', e => {
    const d = e.detail || {};
    if (!d.id || typeof d.src !== 'string') return;
    imgCache.set(d.id, d.src);
    if (K.images) K.images.put(d.id, d.src).then(() => { if (K.images.durable) K.images.durable().then(ok => { if (!ok) warnImages(); }); });
    persist();
  });
  let imgWarned = false;
  const warnImages = () => { if (!imgWarned) { imgWarned = true; note('Pictures cannot be kept in this browser: they stay until the page is closed. Export, Save the board keeps them in a file.'); } };
  // a picture a pad needs (kept by id): from this session, else from IndexedDB
  function fetchImage(id, el) {
    if (!id) return Promise.resolve(false);
    if (pad.pad && pad.pad.images.has(id) && !pad.pad.images.get(id).bad) return Promise.resolve(true);
    const put = src => { const rec = el.putImage(id, src); if (rec && rec.img) rec.img.addEventListener('load', () => { if (pad.pad) pad.pad.redraw(); }, { once: true }); return true; };
    const have = imgCache.get(id);
    if (have) return Promise.resolve(put(have));
    if (!K.images) return Promise.resolve(false);
    return K.images.get(id).then(src => { if (!src) return false; imgCache.set(id, src); return put(src); }, () => false);
  }
  pad.addEventListener('nib:needimage', e => fetchImage(e.detail && e.detail.id, pad));
  // a file → a data URL no bigger than 1600 px a side (photos as JPEG, the rest as PNG)
  async function readImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('not a picture')); i.src = url; });
      const w0 = img.naturalWidth || 800, h0 = img.naturalHeight || 600, k = Math.min(1, 1600 / Math.max(w0, h0));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return /jpe?g/i.test(file.type) ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  }
  async function addPicture(file, at) {
    if (!file || !/^image\//.test(file.type || '')) return false;
    try {
      const src = await readImage(file);
      if (!SELECTS.includes(S.tool)) setTool('select', true);
      const el = await pad.addImage(src, at ? { at } : {});
      if (!el) { note('That picture could not be opened.'); return false; }
      return true;
    } catch (e) { note('That picture could not be opened.'); return false; }
  }
  $('inspic').onclick = () => { closePops(); $('picfile').click(); };
  $('shapepic').onclick = () => { closePops(); $('picfile').click(); };
  $('picfile').onchange = async () => {
    const fs = [...$('picfile').files].slice(0, 10); $('picfile').value = '';
    for (const f of fs) await addPicture(f);
  };
  const typing = t => !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
  document.addEventListener('paste', e => {
    if (typing(e.target) || !pad.pad) return;
    const dt = e.clipboardData;
    const files = dt ? [...dt.items].filter(i => i.kind === 'file' && /^image\//.test(i.type)).map(i => i.getAsFile()).filter(Boolean) : [];
    if (files.length) { e.preventDefault(); files.slice(0, 10).reduce((p, f) => p.then(() => addPicture(f)), Promise.resolve()); return; }
    const text = dt ? dt.getData('text/plain') : '';
    if (clip && (!text || text === clipMark || clipMark === null)) { e.preventDefault(); pasteClip(); return; }
    if (text && text.trim()) { e.preventDefault(); pasteText(text.trim().slice(0, 2000)); }
  });
  // text from elsewhere: a text box in the middle of the view
  function pasteText(t) {
    const P = pad.pad, v = P.viewRect, st = S.styles.text, x = (v[0] + v[2]) / 2 - 150 / P.cam.z, y = (v[1] + v[3]) / 2 - st.size / 2;
    const s = P.addElement([[x, y], [x + 300 / P.cam.z, y + st.size * 1.3]], Object.assign({ tool: 'text', text: t, size: st.size }, colorOut(st.color) ? { color: st.color } : {}));
    if (!s) return;
    if (P._fitText) { P._fitText(s); P._touched(s); }
    if (!SELECTS.includes(S.tool)) setTool('select', true);
    P.select([s]);
  }
  window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) e.preventDefault(); });
  let dragDepth = 0;
  surface.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('drop').hidden = false; e.preventDefault(); } });
  surface.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  surface.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
  surface.addEventListener('drop', async e => {
    dragDepth = 0; $('drop').hidden = true;
    const all = e.dataTransfer ? [...e.dataTransfer.files] : [];
    if (all.length) e.preventDefault();                    // the browser would open the file in place of the Board
    const board = all.find(f => /\.(nibboard|json)$/i.test(f.name));
    if (board) { openBoardFile(board); return; }
    const fs = all.filter(f => /^image\//.test(f.type));
    if (!fs.length) { if (all.length) note('Only pictures, and boards saved from Nib Board, can be dropped on the board.'); return; }
    if (!pad.pad) return;
    const C = pad.pad.canvas.getBoundingClientRect(), at = pad.pad.toWorld(e.clientX - C.left, e.clientY - C.top);
    for (const f of fs.slice(0, 10)) await addPicture(f, at);
  });

  // ---------------------------------------------------------------- export: a PDF or a picture to post, or the whole board as a file
  // Published on claude.ai the page cannot download by itself: it asks the viewer through the downloads capability.
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  try { if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads').then(d => { saver = d; }, () => {}); } catch (e) { /* not in a viewer */ }
  async function offer(name, blob) {
    if (saver) {
      try { await saver.save({ filename: name, data: blob }); return true; }
      catch (e) {
        const c = e && e.code;
        if (c === 'declined') return false;
        note(c === 'rate_limited' ? 'A save is already waiting for an answer: try again in a moment.' : c === 'too_large' ? 'That file is too big to save from here.' : `That file can't be saved from here${c ? ' (' + c + ')' : ''}.`);
        return false;
      }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  }
  const toBlob = (c, type, q) => new Promise(r => { try { c.toBlob(r, type, q); } catch (e) { r(null); } });
  // a second pad, out of sight, that draws the pages not on the board (for a PDF of them all, and the page thumbnails);
  // it shares the board's pictures
  function renderPad() {
    if (R && R.pad) return R;
    R = document.createElement('nib-pad');
    R.setAttribute('aria-hidden', 'true');
    for (const a of ['separate', 'infinite']) R.setAttribute(a, '');
    R.setAttribute('times', 'false');
    R.style.cssText = 'position:fixed;left:-40000px;top:0;width:1280px;height:960px;visibility:hidden;pointer-events:none';
    document.body.appendChild(R);
    if (R.pad && pad.pad) R.pad.images = pad.pad.images;
    R.addEventListener('nib:needimage', e => fetchImage(e.detail && e.detail.id, R));
    return R;
  }
  // one user of the out-of-sight pad at a time (an export holds it for all its pages; each thumbnail waits its turn)
  let rTurn = Promise.resolve();
  function withR(f) { const run = rTurn.then(f, f); rTurn = run.catch(() => {}); return run; }
  function prepR(st, o) {
    const el = renderPad(), set = (n, v) => { if (v === null) el.removeAttribute(n); else if (el.getAttribute(n) !== v) el.setAttribute(n, v); };
    set('view', o.view); set('solve', o.solve ? '' : null); set('reveal', S.reveal ? '' : null);
    set('stroke-width', String(S.styles.pen.size)); set('auto', o.auto === false ? 'false' : null);
    set('read', S.read ? null : 'false'); set('paper', o.paper ? o.paper.kind + ' ' + o.paper.tone : null);
    set('pressure', S.pressure ? null : 'false');
    // the board's own size, so a page's view and its answers come out as they do on the board
    const w = Math.max(320, Math.round(pad.clientWidth || 1280)) + 'px', h = Math.max(240, Math.round(pad.clientHeight || 960)) + 'px';
    if (el.style.width !== w || el.style.height !== h) { el.style.width = w; el.style.height = h; if (el.pad) el.pad._resize(); }
    el.setState(st);
    return el;
  }
  // the reading caught up with the writing (or ms passed)
  async function readDone(P, ms) {
    const t0 = performance.now();
    for (;;) {
      const ink = P.ink, rs = P.resultStrokes || [];
      const done = !ink.length || (!!P.result && rs.length === ink.length && rs.every((s, k) => s === ink[k]));
      if (done && !P.pending.length && !P.ptrs.size) return true;
      if (performance.now() - t0 > ms) return false;
      await sleep(60);
    }
  }
  async function imagesReady(P, ms) {
    const ids = P.imageIds();
    if (!ids.length) return;
    await Promise.all(ids.map(id => fetchImage(id, P.el)));
    const t0 = performance.now();
    while (ids.some(id => { const r = P.images.get(id); return r && !r.ok && !r.bad; }) && performance.now() - t0 < ms) await sleep(50);
  }
  // the pad that draws page i as the board shows it (an answer key needs its answers worked out)
  async function padFor(i) {
    const key = S.xp.ans === 'all' && !S.solve;
    const el = i === cur && !key ? pad : prepR(i === cur ? here() : pages[i], { view: S.view, solve: S.solve || key, paper: pages[i].paper });
    if (S.read && (S.view !== 'ink' || S.solve || key)) await readDone(el.pad, 20000);
    await imagesReady(el.pad, 5000);
    return el;
  }
  const sheet = () => (S.xp.xpaper === 'white' ? SHEET_WHITE : undefined);
  // the part of a page that goes on a sheet of paper: Letter or A4, turned to suit it, 1/2 inch margins, never bigger
  // than 1.5 times its size on the board, paper filling the sheet; or a sheet the writing's own size
  function sheetFor(rect, psize) {
    const W = rect[2] - rect[0], H = rect[3] - rect[1];
    if (psize === 'fit' || !K.pdfSizes) return { rect, pw: W * 0.75, ph: H * 0.75, place: [0, 0, W * 0.75, H * 0.75] };
    const base = K.pdfSizes[psize] || K.pdfSizes.letter, land = W > H * 1.05;
    const pw = land ? base[1] : base[0], ph = land ? base[0] : base[1], m = 36, aw = pw - 2 * m, ah = ph - 2 * m;
    const k = Math.min(aw / W, ah / H, 1.125), rw = aw / k, rh = ah / k, cx = (rect[0] + rect[2]) / 2;
    return { rect: [cx - rw / 2, rect[1], cx + rw / 2, rect[1] + rh], pw, ph, place: [m, m, aw, ah] };
  }
  // jobs: [{page}] or [{page: cur, rect, only}] → a PDF, one picture (JPEG, about 200 dpi) per sheet
  async function pdfOf(jobs) {
    if (!K.pdf) throw new Error('this build cannot make PDFs');
    const out = [];
    for (let k = 0; k < jobs.length; k++) {
      busy(jobs.length > 1 ? `Making the PDF: page ${k + 1} of ${jobs.length}…` : 'Making the PDF…');
      const j = jobs[k], el = j.only ? pad : await padFor(j.page), P = el.pad;
      if (j.only) { await readDone(P, 8000); await imagesReady(P, 4000); }
      let r = j.rect || P.contentRect(24, { hidden: S.xp.ans === 'all' });
      if (j.only) { const b = P._selBox(j.only); r = [b[0] - 16, b[1] - 16, b[2] + 16, b[3] + 16]; }
      if (!r) r = P.viewRect;                                   // an empty page: its paper as the view shows it
      const L = sheetFor(r, S.xp.psize);
      const scale = clamp(L.place[2] / 72 * 200 / (L.rect[2] - L.rect[0]), 0.25, 4);
      const c = el.exportImage({ rect: L.rect, scale, maxPixels: 3e7, answers: S.xp.ans, sheet: sheet(), only: j.only || undefined });
      const blob = await toBlob(c, 'image/jpeg', 0.9);
      if (!blob) throw new Error('the picture of page ' + (j.page + 1) + ' could not be made');
      out.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), pw: L.pw, ph: L.ph, place: L.place });
      await frame();
    }
    return new Blob([K.pdf(out, { title: 'Nib Board ' + today() })], { type: 'application/pdf' });
  }
  // this page, what is on screen, or what is selected, as a picture at twice its size
  async function pictureOf(what) {
    const P0 = pad.pad;
    if (what === 'sel') {
      await readDone(P0, 8000); await imagesReady(P0, 4000);
      return pad.exportImage({ only: P0.selected, margin: 16, scale: 2, maxPixels: 2.4e7, answers: S.xp.ans, sheet: sheet() });
    }
    const el = await padFor(cur), P = el.pad;
    const rect = what === 'view' ? P0.viewRect : (P.contentRect(40, { hidden: S.xp.ans === 'all' }) || P0.viewRect);
    return el.exportImage({ rect, scale: 2, maxPixels: 2.4e7, answers: S.xp.ans, sheet: sheet() });
  }
  function copyPicture(what) {
    let p;
    try {
      if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') throw new Error('no clipboard');
      const blob = withR(() => pictureOf(what)).then(c => toBlob(c, 'image/png'));
      p = navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch (e) { p = Promise.reject(e); }
    p.then(() => note('Picture copied: paste it into a post, a doc or a slide.'), () => note('This browser would not copy the picture. Export it as a picture instead.'));
  }
  async function doExport() {
    if (exporting) return;
    commitText();
    const what = S.xp.what, as = S.xp.as, P = pad.pad;
    if (what === 'sel' && !(P && P.selected.length)) { note('Select something first (the arrow tool), or export the page.'); return; }
    if (as === 'clip') { closePops(); copyPicture(what === 'all' ? 'page' : what); return; }
    exporting = true; $('exportgo').disabled = true; closePops();
    try {
      let blob, name;
      if (as === 'pdf') {
        pages[cur] = here();
        const jobs = what === 'all' ? pages.map((_, i) => ({ page: i })) : what === 'sel' ? [{ page: cur, only: P.selected }] : what === 'view' ? [{ page: cur, rect: P.viewRect }] : [{ page: cur }];
        blob = await withR(() => pdfOf(jobs));
        name = what === 'all' && pages.length > 1 ? `Nib-board-${today()}.pdf` : what === 'sel' ? `Nib-selection-${today()}.pdf` : `Nib-board-${cur + 1}-${today()}.pdf`;
      } else {
        busy('Making the picture…');
        const c = await withR(() => pictureOf(what === 'all' ? 'page' : what));
        blob = await toBlob(c, 'image/png');
        name = what === 'sel' ? `Nib-selection-${today()}.png` : `Nib-board-${cur + 1}-${today()}.png`;
      }
      busy(null);
      if (!blob) { note('The export could not be made.'); return; }
      if (await offer(name, blob)) note('Saved ' + name + '.');
    } catch (e) { busy(null); note('The export could not be made: ' + ((e && e.message) || e) + '.'); }
    finally { exporting = false; $('exportgo').disabled = false; }
  }
  // the choices, and what each allows: all pages only as a PDF; a page size only for a PDF
  function exportMarks() {
    const P = pad.pad, hasSel = !!(P && P.selected.length);
    if (S.xp.what === 'sel' && !hasSel) S.xp.what = 'page';
    if (S.xp.what === 'all' && S.xp.as !== 'pdf') S.xp.what = 'page';
    for (const g of $('exportpop').querySelectorAll('.seg[data-set]')) segMark(g, S.xp[g.dataset.set]);
    const w = $('exportpop').querySelector('[data-set="what"]');
    w.querySelector('[data-v="all"]').disabled = S.xp.as !== 'pdf';
    w.querySelector('[data-v="sel"]').disabled = !hasSel;
    $('sizerowx').hidden = S.xp.as !== 'pdf';
    $('exportgo').textContent = S.xp.as === 'clip' ? 'Copy the picture' : S.xp.as === 'pdf' ? (S.xp.what === 'all' && pages.length > 1 ? `Export ${pages.length} pages as a PDF` : 'Export as a PDF') : 'Export as a picture';
  }
  $('exportpop').addEventListener('click', e => {
    const b = e.target.closest('.seg button');
    if (!b || b.disabled) return;
    S.xp[b.parentNode.dataset.set] = b.dataset.v; persist(); exportMarks();
  });
  $('exportbtn').onclick = () => { if (!$('exportpop').hidden) { closePops(); return; } $('openask').hidden = true; exportMarks(); openPop('exportpop'); };
  $('exportgo').onclick = () => doExport();
  // what is on screen, as a picture (the Board's "Save image" before 1.6)
  $('saveimg').onclick = async () => {
    closePops(); commitText();
    const c = pad.exportImage({ rect: pad.pad.viewRect, scale: 2, answers: 'shown' });
    const blob = c && await toBlob(c, 'image/png');
    if (!blob) { note('The picture could not be made.'); return; }
    const name = `Nib-board-${cur + 1}-${today()}.png`;
    if (await offer(name, blob)) note('Saved ' + name + '.');
  };
  async function saveSelPicture() {
    const P = pad.pad;
    if (!P || !P.selected.length) return;
    await imagesReady(P, 4000);
    const c = pad.exportImage({ only: P.selected, margin: 16, scale: 2, maxPixels: 2.4e7, answers: 'shown' });
    const blob = c && await toBlob(c, 'image/png');
    if (!blob) { note('The picture could not be made.'); return; }
    const name = `Nib-selection-${today()}.png`;
    if (await offer(name, blob)) note('Saved ' + name + '.');
  }
  // the whole board as a file (.nibboard.json: its pages and pictures), to open on another computer
  function usedImages(list) {
    const ids = new Set();
    for (const p of list) for (const m of arr(p.meta)) if (m && m.im) ids.add(String(m.im));
    return ids;
  }
  $('boardsave').onclick = async () => {
    commitText();
    pages[cur] = here();
    const images = {};
    let lost = 0;
    for (const id of usedImages(pages)) {
      const src = imgCache.get(id) || (K.images ? await K.images.get(id).catch(() => null) : null);
      if (src) images[id] = src; else lost++;
    }
    if (lost) note(`${lost} picture${lost === 1 ? ' is' : 's are'} no longer in this browser and can't go in the file.`);
    const file = { format: 'nib-board', version: 3, saved: new Date().toISOString(), engine: Nib.version, page: cur, pages: pages.map(packPage), images };
    const name = `Nib-board-${today()}.nibboard.json`;
    closePops();
    if (await offer(name, new Blob([JSON.stringify(file)], { type: 'application/json' }))) note(`Saved ${name} (${pages.length} page${pages.length === 1 ? '' : 's'}). Export, Open a board opens it on any computer.`);
  };
  $('boardopen').onclick = () => $('boardfile').click();
  $('boardfile').onchange = () => {
    const f = $('boardfile').files[0]; $('boardfile').value = '';
    if (f) openBoardFile(f);
  };
  function openBoardFile(f) {
    f.text().then(t => {
      let d = null;
      try { d = JSON.parse(t); } catch (e) { d = null; }
      if (!d || d.format !== 'nib-board' || !Array.isArray(d.pages)) { note('That file is not a board saved from Nib Board.'); return; }
      const ps = d.pages.map(p => okPage(p, d.version === 3 ? 0 : 3.5)).filter(Boolean);
      if (!ps.length) { note('That board has no pages in it.'); return; }
      opened = { pages: ps, images: d.images && typeof d.images === 'object' ? d.images : {}, page: Number.isInteger(d.page) ? d.page : 0 };
      const empty = pages.length === 1 && !(pad.pad && pad.pad.strokes.length);
      if (empty) { putBoard('replace'); return; }
      $('openq').textContent = `A board of ${ps.length} page${ps.length === 1 ? '' : 's'}. Put it…`;
      $('openask').hidden = false;
      if ($('exportpop').hidden) { exportMarks(); openPop('exportpop'); }
      placePop($('exportpop'), popAnchor);
    });
  }
  $('openadd').onclick = () => putBoard('add');
  $('openreplace').onclick = () => putBoard('replace');
  $('openno').onclick = () => { opened = null; $('openask').hidden = true; };
  function putBoard(how) {
    const d = opened;
    opened = null; $('openask').hidden = true;
    if (!d) return;
    for (const [id, src] of Object.entries(d.images)) if (typeof src === 'string' && /^data:image\//.test(src) && /^[\w-]{1,80}$/.test(id)) { imgCache.set(id, src); if (K.images) K.images.put(id, src); }
    commitText();
    if (fixing) fixMode(false);
    closePops();
    if (how === 'replace') {
      pages = d.pages; snaps.length = 0; cur = clamp(d.page | 0, 0, pages.length - 1);
      applyPaper(); pad.setState(pages[cur]);
      tools(); persist();
      note(`The board is open: ${pages.length} page${pages.length === 1 ? '' : 's'}.`);
    } else {
      pages[cur] = here(); snaps[cur] = pad.pad.snapshot();
      const at = pages.length;
      pages.push(...d.pages);
      goPage(at);
      note(`Added ${d.pages.length} page${d.pages.length === 1 ? '' : 's'}: now page ${cur + 1} of ${pages.length}.`);
    }
  }

  // ---------------------------------------------------------------- full screen, keys
  const canFull = !!(document.documentElement.requestFullscreen && document.fullscreenEnabled !== false);
  $('full').hidden = !canFull; $('morefull').hidden = !canFull;
  const toggleFull = () => { if (!canFull) return; (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}); };
  $('full').onclick = toggleFull;
  $('morefull').onclick = () => { closePops(); toggleFull(); };
  // a button pressed with a pointer gives the keyboard back to the board (Space then pans, not presses it again)
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b && e.detail > 0 && b.closest('.rail, .zoom, .selbar, .pop')) b.blur(); });
  function escape() {
    if (anyPop()) { closePops(); return; }
    if (!$('fixpop').hidden) { closeFix(); return; }
    if (fixing) { fixMode(false); return; }
    if (pad.pad && pad.pad.selected.length) { pad.pad.clearSelection(); return; }
    if (!$('note').hidden) $('note').hidden = true;
  }
  const KEYTOOLS = { v: 'select', o: 'lasso', h: 'hand', p: 'pen', m: 'marker', i: 'highlighter', r: 'shape', t: 'text', l: 'laser' };
  document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase(), t = e.target, P = pad.pad;
    if (typing(t)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (k === 'z') { e.preventDefault(); commitText(); e.shiftKey ? pad.redo() : pad.undo(); return; }
      if (k === 'y') { e.preventDefault(); commitText(); pad.redo(); return; }
      if (k === 'c' || k === 'x') { if (P && P.selected.length) { e.preventDefault(); copySel(k === 'x'); } return; }
      if (k === 'd') { e.preventDefault(); if (P && P.selected.length) P.duplicateSelection(); return; }
      if (k === 'a') { e.preventDefault(); selectAll(); return; }
      if (k === '0') { e.preventDefault(); zoom100(); return; }
      if (k === '1') { e.preventDefault(); fitAll(); return; }
      if (k === '=' || k === '+') { e.preventDefault(); zoomStep(1); return; }
      if (k === '-') { e.preventDefault(); zoomStep(-1); return; }
      return;                                          // Ctrl+V: the paste event
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (k === 'escape') { escape(); return; }
    if (t && t.tagName === 'BUTTON' && (k === ' ' || k === 'enter')) return;      // a focused button's own key
    if (k === ' ') { e.preventDefault(); if (!e.repeat && P) { P.spacePan = true; P._cursor(); } return; }
    if ((k === 'delete' || k === 'backspace') && P && P.selected.length) { e.preventDefault(); P.deleteSelection(); return; }
    if (k.startsWith('arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1, dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
      if (P && P.selected.length) P.nudgeSelection(dx, dy); else if (P) P.panBy(-dx * 40, -dy * 40);
      return;
    }
    if (KEYTOOLS[k]) { setTool(KEYTOOLS[k]); return; }
    if (k === 'e') erase(S.tool !== 'eraser');
    else if (k === 's') setSolve(!S.solve);
    else if (k === 'x') { if (!$('fix').disabled || fixing) fixMode(!fixing); }
    else if (k === 'f') toggleFull();
    else if (k >= '1' && k <= '4') setView(VIEWS[+k - 1]);
    else if (k === '+' || k === '=') zoomStep(1);
    else if (k === '-') zoomStep(-1);
    else if (k === '[' || k === ']') bumpSize(k === ']' ? 1 : -1);
  });
  document.addEventListener('keyup', e => { if (e.key === ' ' && pad.pad && pad.pad.spacePan) { pad.pad.spacePan = false; pad.pad._cursor(); } });
  window.addEventListener('blur', () => { if (pad.pad && pad.pad.spacePan) { pad.pad.spacePan = false; pad.pad._cursor(); } });
  // a long press is for writing, not for the browser's menu (the LaTeX box keeps its own, to copy from)
  document.addEventListener('contextmenu', e => { if (!typing(e.target)) e.preventDefault(); });

  // ---------------------------------------------------------------- what the panel sends (More, Pointer events; or hold the "Nib." mark)
  const log = [];
  let diagOn = false, diagRaf = 0, pressTimer = null;
  const showDiag = () => {
    diagRaf = 0; if (!diagOn) return;
    $('diag').textContent = 'Pointer events (More, Pointer events closes this)\n' + (log.length ? log.map(r => r.join('  ')).join('\n') : 'Touch or write on the board.');
  };
  const setDiag = on => { diagOn = on; $('diag').hidden = !on; $('morediag').setAttribute('aria-pressed', String(on)); showDiag(); };
  $('morediag').onclick = () => { closePops(); setDiag(!diagOn); };
  const rec = e => {
    const P = pad.pad, onPad = P && e.target === P.canvas;
    log.unshift([e.type.replace('pointer', '').padEnd(6), (e.pointerType || '?').padEnd(5), 'w ' + (+e.width || 0).toFixed(1), 'h ' + (+e.height || 0).toFixed(1),
      'p ' + (+e.pressure || 0).toFixed(2), 'b ' + e.buttons, e.isPrimary ? 'primary' : 'second', e.type === 'pointerdown' && onPad && P ? P.why : '']);
    if (log.length > 14) log.length = 14;
    if (diagOn && !diagRaf) diagRaf = requestAnimationFrame(showDiag);
  };
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) document.addEventListener(t, rec);
  const unpress = () => { clearTimeout(pressTimer); pressTimer = null; };
  $('mark').addEventListener('pointerdown', e => {
    unpress();
    const x = e.clientX, y = e.clientY;
    pressTimer = setTimeout(() => { pressTimer = null; setDiag(!diagOn); }, 600);
    const mv = ev => { if (Math.hypot(ev.clientX - x, ev.clientY - y) > 10) unpress(); };
    $('mark').addEventListener('pointermove', mv);
    const end = () => { unpress(); $('mark').removeEventListener('pointermove', mv); };
    $('mark').addEventListener('pointerup', end, { once: true });
    $('mark').addEventListener('pointercancel', end, { once: true });
    $('mark').addEventListener('pointerleave', end, { once: true });
  });

  // Corrections are remembered as the network's own embeddings of the corrected shapes, so a new network (a
  // retrained Nib) cannot use the ones remembered for the old: they would be ignored and the writer would have to
  // fix the same 1s and 6s again. The training log keeps every corrected symbol's strokes, so the new network is
  // taught them again, once, the first time the Board opens with it.
  function relearn() {
    try {
      const M = JSON.parse(localStorage.getItem('nib-memory-v1') || 'null');
      if (!M || M.model === Nib.memory.model) return 0;          // nothing remembered, or remembered for this network
      let n = 0;
      for (const r of pad.pad.training || []) {
        if (!r.fixed || !r.fixed.length || !Array.isArray(r.strokes)) continue;
        const ink = r.strokes.map(st => st.map(q => [q[0], q[1]])), ref = Nib._internals.refSize(ink);
        for (const f of r.fixed) {
          const g = (f.strokes || []).map(i => ink[i]).filter(Boolean);
          if (g.length && f.label) { Nib.memory.learn(g, f.label === '\\cdot' ? '.' : f.label, ref); n++; }
        }
      }
      return n;
    } catch (e) { return 0; }                                     // storage blocked: nothing to carry over
  }
  // Pictures no page uses any more (deleted, or their page deleted) are let go once the board has opened. Never one
  // this session has met (an undo can bring it back), one the board kept in storage names (another tab of the Board may
  // have saved it since this one opened), or one put in less than a day ago (its id says when; another tab may not have
  // saved its page yet).
  function tidyImages() {
    if (!K.images || !storageOk || !writer) return;               // a second tab of the Board leaves them to the first
    K.images.ids().then(ids => {
      const used = usedImages(pages.map((p, i) => (i === cur && pad.pad ? here() : p)));
      for (const id of imgCache.keys()) used.add(id);
      try { const st = JSON.parse(localStorage.getItem(KEY) || 'null'); if (st && Array.isArray(st.pages)) for (const id of usedImages(st.pages)) used.add(id); } catch (e) { return; }
      const day = Date.now() - 864e5;
      for (const id of ids) {
        const m = /^img-([0-9a-z]+)-/.exec(id), t = m ? parseInt(m[1], 36) : NaN;
        if (!used.has(id) && isFinite(t) && t < day) K.images.delete(id);
      }
    }, () => {});
  }

  // ---------------------------------------------------------------- start
  setRail(S.rail); setTheme(S.theme);
  customElements.whenDefined('nib-pad').then(() => {
    applySwitches(); setFinger(S.finger); applyTool();
    setView(S.view, true); setReveal(S.reveal); setSolve(S.solve, true); setTrain(S.train, true);
    // the training log first, so writing put back on the board is known and not kept twice
    try { const T = JSON.parse(localStorage.getItem(TKEY) || 'null'); if (T && Array.isArray(T.records)) pad.pad.trainLoad(T.records); } catch (e) { /* none, or storage blocked */ }
    relearn();
    trainLine();
    applyPaper();
    pad.setState(pages[cur]);
    ready = true;
    tools();
    $('zpct').textContent = Math.round(pad.pad.cam.z * 100) + '%';
    // a drill under way when the page was closed comes back where it was
    if (D && D.active && !S.train) { D.active = false; saveDrill(); }
    drillLine(); drillShow();
    if (newer) note('This board was saved by a newer Nib Board: it is shown as far as this one can, and nothing here is saved. Open the newer Board.', null, null, true);
    else setTimeout(tidyImages, 4000);
  });
})();
