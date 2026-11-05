// ================================================================== public API
let DEFAULT_R = null;
function defaultRecognizer() { if (!DEFAULT_R) DEFAULT_R = new Recognizer(); return DEFAULT_R; }

Recognizer.prototype.classify = function (strokes, options) {
  const { strokes: s } = normStrokes(strokes);
  if (!s.length) return [];
  const opts = Object.assign({}, DEFAULTS, options || {});
  const ref = opts.ref || refSize(s), mask = allowedMask(opts.symbols), M = model();
  const p = this.probs(s, ref, 'c' + Math.random());
  let tot = 0; for (let c = 0; c < p.length; c++) if (mask[c] && c !== M.junk) tot += p[c];
  const list = [];
  for (let c = 0; c < p.length; c++) if (mask[c] && c !== M.junk) list.push([M.cls[c], p[c] / tot]);
  return list.sort((a, b) => b[1] - a[1]).slice(0, opts.top || 6);
};

// the same reading, done a few milliseconds at a time so a page stays responsive (resolves with the result)
Recognizer.prototype.recognizeAsync = function (strokes, options) {
  const it = this.warmup(strokes, options);
  return new Promise(resolve => {
    const step = () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 14) if (it.next().done) { resolve(this.recognize(strokes, options)); return; }
      setTimeout(step, 0);
    };
    step();
  });
};

const Nib = {
  version: '__VERSION__',
  recognize(strokes, options) { return defaultRecognizer().recognize(strokes, options); },
  recognizeAsync(strokes, options) { return defaultRecognizer().recognizeAsync(strokes, options); },
  classify(strokes, options) { return defaultRecognizer().classify(strokes, options); },
  Recognizer,
  symbolSets: Object.keys(PRESETS),
  memory: {
    // teach one symbol: strokes of the symbol, its label, optionally the size reference of its expression
    learn(strokes, label, ref) { const s = normStrokes(strokes).strokes; if (!s.length) return; memLearn(classifyGroup(s, ref || refSize(s)).hidden, label); },
    clear() { MEM.items = []; MEM.version++; memSave(); },
    get size() { return memLoad().length; },
  },
  classes() { return model().cls.filter(c => c !== 'junk'); },
  // In place: the writing laid out again where it was written, as the writer's own strokes tidied up ('tidy'),
  // in the writer's Replicator handwriting ('hand') or typeset ('typeset'). Returns {items, strokes, latex, ...}.
  neaten(strokes, options) { const o = options || {}; return inPlace(strokes, o.style === 'hand' ? 'hand' : 'tidy', o); },
  typeset(strokes, options) { return inPlace(strokes, 'typeset', options); },
  // the answer to each line that ends with "=" (null for the other lines): from LaTeX, strokes or a reading
  solve(input, options) {
    let rows;
    if (typeof input === 'string') {
      try { rows = latexRows(input); } catch (e) { if (e instanceof SolveError) return [null]; throw e; }
    } else if (input && input.tree) rows = input.tree;
    else { const r = defaultRecognizer().recognize(input || [], options); rows = r ? r.tree : []; }
    return solveRows(rows).map(a => a && { latex: a.latex, text: a.text, kind: a.kind, exact: a.exact, value: a.value });
  },
  hand: {
    // data: the Replicator's saved handwriting ({glyphs: {char: strokes}}), as an object or its JSON text
    load(data) { const n = handSet(typeof data === 'string' ? JSON.parse(data) : data); handNotify(); return n; },
    clear() { HAND.glyphs = null; HAND.name = ''; HAND.loaded = true; HAND.version = (HAND.version || 0) + 1; try { localStorage.removeItem(HAND_KEY); } catch (e) { /* ok */ } handNotify(); },
    get size() { const g = handLoad(); return g ? Object.keys(g).length : 0; },
    get name() { handLoad(); return HAND.name || ''; },
    has(label) { const g = handLoad(); const ch = HAND_CHAR[label] || label; return !!(g && g[ch]); },
  },
  _internals: { rasterize, convFeatures, fcProbs, onlineFeatures, onlineBranch, classifyGroup, mlp, joinFeatures, relFeatures, refSize, rowTokens, model, sbox, allowedMask, smoothPath, skewOf, lateOrder, inkDist, planOf, drawablesOf, pathsOf, tidyProvider, handProvider, typeProvider, typeMetrics, inkOf, NEAT, HAND, drawItems, typeFontsReady, solveRows, latexRows, tokensOf, solveParse, answerOf, DEFAULT_GLYPHS, sampleBook, unlevel },
};
if (typeof Pad !== 'undefined') { Nib.Pad = Pad; Nib.attach = (el, o) => new Pad(el, o); }
if (typeof module !== 'undefined' && module.exports) module.exports = Nib;
global.Nib = Nib;
