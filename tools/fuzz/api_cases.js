// Odd and hostile input for the rest of the public API: recognize, classify, neaten, typeset, hand, memory, canvas
// parts (pack/unpack, pdf, shapes, colors, papers), scribble. Nothing may throw or hang.
'use strict';
const REPO = require('path').join(__dirname, '..', '..');   // the repository
const fs = require('fs'), path = require('path');
module.exports = function (Nib) {
  const C = [];
  const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').slice(0, 60).map(JSON.parse);
  const good = rows[3].strokes, good2 = rows[17].strokes;
  const finite = (o, depth = 0) => {                      // no NaN / Infinity anywhere in a result
    if (depth > 12 || o === null || o === undefined) return true;
    if (typeof o === 'number') return Number.isFinite(o);
    if (typeof o === 'string') return !/NaN|undefined|\[object/.test(o);
    if (Array.isArray(o)) return o.every(x => finite(x, depth + 1));
    if (typeof o === 'object') return Object.keys(o).every(k => finite(o[k], depth + 1));
    return true;
  };
  const recShape = r => {
    if (r === null || r === undefined) return null;         // nothing read is a fine answer for nothing written
    if (typeof r !== 'object' || typeof r.latex !== 'string') return 'no latex string';
    if (!Array.isArray(r.lines)) return 'no lines';
    if (!finite({ latex: r.latex, text: r.text, confidence: r.confidence, symbols: (r.symbols || []).map(s => [s.box, s.label]) })) return 'NaN/Infinity/undefined in the result';
    return null;
  };
  const R = (name, strokes, opt) => C.push({ name: 'recognize ' + name, run: () => Nib.recognize(strokes, opt), check: recShape });
  const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n }, (_, i) => [x0 + (x1 - x0) * i / (n - 1), y0 + (y1 - y0) * i / (n - 1)]);
  const circle = (cx, cy, r, n = 24) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);

  // ---- shapes of input
  const odd = { 'undefined': undefined, 'null': null, 'number': 42, 'string': 'abc', 'true': true, 'object': {}, 'empty': [], 'one empty stroke': [[]], 'empty point': [[[]]], 'one point': [[[5, 5]]], 'one number point': [[[5]]],
    'three numbers a point': [[[1, 2, 3], [4, 5, 6], [7, 8, 9]]], 'flat numbers': [1, 2, 3, 4], 'stroke of numbers': [[1, 2, 3, 4]], 'NaN point': [[[NaN, NaN], [1, 1]]], 'all NaN': [[[NaN, NaN], [NaN, NaN]]],
    'Infinity': [[[Infinity, 0], [0, 0], [10, 10]]], '-Infinity': [[[0, 0], [-Infinity, -Infinity]]], 'strings': [[['a', 'b'], ['c', 'd']]], 'numeric strings': [[['1', '2'], ['30', '40'], ['50', '10']]], 'nulls': [[null, null]],
    'null stroke': [null, line(0, 0, 10, 10)], 'undefined stroke': [undefined], 'holes': [, line(0, 0, 10, 10), , ], 'objects xy': [[{ x: 1, y: 2 }, { x: 30, y: 40 }]], 'objects missing y': [[{ x: 1 }, { x: 30 }]],
    'objects NaN': [[{ x: NaN, y: 2 }, { x: 30, y: 40 }]], 'points objects': [{ points: line(0, 0, 30, 30) }], 'points null': [{ points: null }], 'points string': [{ points: 'xyz' }], 'points nested': [{ points: { points: [] } }],
    '1e308': [[[1e308, 1e308], [-1e308, -1e308]]], '1e300 line': [line(0, 0, 1e300, 1e300)], '1e15 offset': good.map(s => s.map(p => [p[0] + 1e15, p[1] + 1e15])), '1e9 offset': good.map(s => s.map(p => [p[0] + 1e9, p[1] - 1e9])),
    'tiny 1e-9': good.map(s => s.map(p => [p[0] * 1e-9, p[1] * 1e-9])), 'tiny 1e-300': good.map(s => s.map(p => [p[0] * 1e-300, p[1] * 1e-300])), 'huge 1e12': good.map(s => s.map(p => [p[0] * 1e12, p[1] * 1e12])),
    'negative': good.map(s => s.map(p => [-p[0], -p[1]])), 'flat (all y equal)': good.map(s => s.map(p => [p[0], 7])), 'a pillar (all x equal)': good.map(s => s.map(p => [7, p[1]])), 'one spot': good.map(s => s.map(() => [3, 3])),
    'Float32Array points': good.map(s => s.map(p => Float32Array.from(p))), 'Float64Array strokes': [Float64Array.from([1, 2, 30, 40, 50, 10])], 'frozen': Object.freeze(good.map(s => Object.freeze(s.map(p => Object.freeze(p.slice()))))),
    'extra fields on points': good.map(s => s.map(p => [p[0], p[1], 0.5, Date.now(), 'pen'])), 'points with t and pressure objects': good.map(s => s.map(p => ({ x: p[0], y: p[1], t: 1, p: 0.5 }))),
    'mixed formats': [good[0], { points: good[1] || good[0] }, (good[2] || good[0]).map(p => ({ x: p[0], y: p[1] }))], 'duplicates only': [Array.from({ length: 500 }, () => [10, 10])],
    'same stroke 40 times': Array.from({ length: 40 }, () => good[0]), 'the same array object twice': [good[0], good[0]], 'a Set': new Set(good), 'a Map': new Map(), 'arguments-like': { length: 1, 0: line(0, 0, 9, 9) }, 'a Date': new Date(), 'a function': () => good,
    'BigInt points': [[[1n, 2n], [30n, 40n]]], 'booleans': [[[true, false], [false, true]]], 'nested too deep': [[[[1, 2], [3, 4]]]], 'a stroke that is a string': ['abc'], 'a stroke that is a number': [5], 'negative zero': [[[-0, -0], [-0, 5]]] };
  for (const k of Object.keys(odd)) R(k, odd[k]);
  for (const k of ['undefined', 'null', 'string', 'empty', 'NaN point', 'Infinity', 'strings', 'objects NaN', '1e308', 'one spot', 'nulls']) {
    C.push({ name: 'classify ' + k, run: () => Nib.classify(odd[k]), check: o => (Array.isArray(o) && finite(o) ? null : 'not a finite list') });
    C.push({ name: 'neaten ' + k, run: () => Nib.neaten(odd[k]), check: o => (finite({ l: o && o.latex, s: o && o.strokes }) ? null : 'NaN in neaten') });
    C.push({ name: 'neaten hand ' + k, run: () => Nib.neaten(odd[k], { style: 'hand' }), check: o => (finite({ l: o && o.latex, s: o && o.strokes }) ? null : 'NaN in neaten hand') });
    C.push({ name: 'typeset ' + k, run: () => Nib.typeset(odd[k]), check: o => (finite({ l: o && o.latex, i: o && o.items && o.items.map(i => i.box) }) ? null : 'NaN in typeset') });
    C.push({ name: 'solve strokes ' + k, run: () => Nib.solve(odd[k]) });
  }
  // ---- size
  R('one stroke of 200,000 points', [Array.from({ length: 200000 }, (_, i) => [i % 500, (i * 7) % 300])]);
  R('a 50,000 point spiral', [Array.from({ length: 50000 }, (_, i) => [200 + i / 300 * Math.cos(i / 40), 200 + i / 300 * Math.sin(i / 40)])]);
  R('600 dots', Array.from({ length: 600 }, (_, i) => [[i % 30 * 20, Math.floor(i / 30) * 20], [i % 30 * 20 + 1, Math.floor(i / 30) * 20 + 1]]));
  R('400 short dashes in a row', Array.from({ length: 400 }, (_, i) => line(i * 14, 50, i * 14 + 9, 50, 5)));
  R('300 dashes stacked (fraction bars)', Array.from({ length: 300 }, (_, i) => line(0, i * 12, 200, i * 12, 8)));
  R('200 nested root-like checks', Array.from({ length: 200 }, (_, i) => [[i * 3, 60], [i * 3 + 4, 80], [i * 3 + 10, 10 + i / 10], [900, 10 + i / 10]]));
  R('120 concentric circles', Array.from({ length: 120 }, (_, i) => circle(300, 300, 5 + i * 2)));
  R('250 tall bars side by side', Array.from({ length: 250 }, (_, i) => line(i * 9, 0, i * 9, 60, 6)));
  R('the school expression 12 times across', [].concat(...Array.from({ length: 12 }, (_, k) => good.map(s => s.map(p => [p[0] + k * 420, p[1]])))));
  R('the school expression 30 lines down', [].concat(...Array.from({ length: 30 }, (_, k) => good2.map(s => s.map(p => [p[0], p[1] + k * 130])))));
  R('everything on top of itself 25 times', [].concat(...Array.from({ length: 25 }, () => good)));
  // ---- options
  for (const o of [null, 0, 'x', [], { symbols: 'nope' }, { symbols: 5 }, { symbols: null }, { symbols: ['1', '2'] }, { symbols: [] }, { symbols: {} }, { ref: NaN }, { ref: 0 }, { ref: -5 }, { ref: Infinity }, { ref: 'big' }, { smooth: 1e9 }, { smooth: -1 }, { smooth: NaN },
    { top: -1 }, { top: 1e9 }, { top: NaN }, { times: 'x' }, { times: null }, { prior: NaN }, { prior: 1e9 }, { prior: -1e9 }, { lm: Infinity }, { lm: NaN }, { lm: -100 }, { wJunk: NaN }, { wClass: Infinity }, { degrees: 5 }, { skew: NaN }, { lines: 'no' },
    { __proto__: null }, { constructor: 5 }, { toString: null }, { hasOwnProperty: 1 }, JSON.parse('{"__proto__": {"polluted": true}}')]) {
    R('options ' + (() => { try { return JSON.stringify(o); } catch (e) { return String(o); } })(), good, o);
  }
  C.push({ name: 'prototype not polluted', run: () => ({}).polluted, check: v => (v === undefined ? null : 'Object.prototype was polluted') });
  // still right after all that
  C.push({ name: 'a good expression still reads the same', run: () => [Nib.recognize(good).latex, new Nib.Recognizer().recognize(good).latex, rows[3].latex], check: o => (o[0] === o[1] ? null : 'the shared recognizer was left in a bad state: ' + o[0] + ' vs ' + o[1]) });

  // ---- recognizeAsync settles
  C.push({ name: 'recognizeAsync returns a promise for odd input', run: () => [undefined, null, 'abc', [[]], [[[NaN, 1]]]].map(v => { const p = Nib.recognizeAsync(v); return p && typeof p.then === 'function'; }), check: o => (o.every(Boolean) ? null : 'not a promise: ' + o) });

  // ---- the saved hand (a Replicator file)
  const H = (name, data) => C.push({ name: 'hand.load ' + name, run: () => { let n, e = null; try { n = Nib.hand.load(data); } catch (x) { e = String(x.message).slice(0, 80); } const out = [Nib.neaten(good, { style: 'hand' }), Nib.neaten(good2, { style: 'hand' })]; return { n, loadThrew: e, size: Nib.hand.size, name: Nib.hand.name, ok: out.every(o => o && typeof o.latex === 'string'), fin: finite(out.map(o => o.strokes)) }; },
    check: o => (!o.ok ? 'neaten in hand failed after loading' : !o.fin ? 'NaN in strokes drawn from this hand' : typeof o.size !== 'number' || typeof o.name !== 'string' ? 'hand.size/name wrong type' : null) });
  const glyph = [[[0.1, 0.2], [0.5, 0.8], [0.9, 0.2]]];
  const hands = { 'null': null, 'undefined': undefined, 'number': 5, 'string not json': 'hello', 'empty json': '{}', 'json null': 'null', 'json array': '[]', 'json number': '7', 'no glyphs': { name: 'x' }, 'glyphs null': { glyphs: null }, 'glyphs array': { glyphs: [] },
    'glyphs string': { glyphs: 'abc' }, 'glyph null': { glyphs: { 7: null, 3: null } }, 'glyph number': { glyphs: { 7: 5, 3: 'x' } }, 'glyph empty': { glyphs: { 7: [], 3: [[]], 4: [[[]]] } }, 'glyph NaN': { glyphs: { 7: [[[NaN, NaN], [1, 1]]], 3: [[[null, null]]] } },
    'glyph Infinity': { glyphs: { 7: [[[Infinity, 0], [0, -Infinity]]], 3: [[[1e308, 1e308], [0, 0]]] } }, 'glyph one point': { glyphs: { 7: [[[0.5, 0.5]]], 3: [[[0.5, 0.5]]], '=': [[[0.5, 0.5]]], '+': [[[0.5, 0.5]]] } },
    'glyph strings': { glyphs: { 7: [[['a', 'b']]], 3: 'zzz', '=': [['x']] } }, 'glyph objects': { glyphs: { 7: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]], 3: [{ points: [[0, 0], [1, 1]] }] } }, 'glyph huge': { glyphs: { 7: [Array.from({ length: 100000 }, (_, i) => [i % 2, i % 3])] } },
    'name object': { name: { a: 1 }, glyphs: { 7: glyph } }, 'name long': { name: 'x'.repeat(100000), glyphs: { 7: glyph } }, 'name html': { name: '<img src=x onerror=alert(1)>', glyphs: { 7: glyph } }, 'proto key': JSON.parse('{"glyphs": {"__proto__": [[[0,0],[1,1]]], "constructor": [[[0,0],[1,1]]], "7": [[[0,0],[1,1]]]}}'),
    'proto pollution': JSON.parse('{"__proto__": {"polluted": 1}, "glyphs": {"__proto__": {"polluted": 1}}}'), 'metrics garbage': { glyphs: { 7: glyph, 3: glyph, '=': glyph }, cap: NaN, x: 'a', base: null, desc: Infinity, avg: { w: NaN } }, 'metrics zero': { glyphs: { 7: glyph, 3: glyph }, cap: 0, x: 0, base: 0, desc: 0 },
    'metrics equal': { glyphs: { 7: glyph, 3: glyph, 4: glyph, 0: glyph }, cap: 0.5, x: 0.5, base: 0.5, desc: 0.5 }, 'every key a glyph, flat': { glyphs: Object.fromEntries('0123456789+-=x()'.split('').map(c => [c, [[[0, 0.5], [1, 0.5]]]])) },
    'every key a glyph, a dot': { glyphs: Object.fromEntries('0123456789+-=x()'.split('').map(c => [c, [[[0.5, 0.5], [0.5, 0.5]]]])) }, 'saved date garbage': { saved: 'yesterday', glyphs: { 7: glyph } }, 'v wrong': { v: 99, glyphs: { 7: glyph } } };
  for (const k of Object.keys(hands)) H(k, hands[k]);
  C.push({ name: 'hand.clear then neaten', run: () => { Nib.hand.clear(); return [Nib.hand.size, Nib.hand.name, Nib.hand.has('7'), Nib.neaten(good, { style: 'hand' }).latex]; }, check: o => (o[0] === 0 && o[1] === '' && o[2] === false && typeof o[3] === 'string' ? null : 'hand not cleared: ' + JSON.stringify(o)) });
  C.push({ name: 'prototype not polluted (hand)', run: () => ({}).polluted, check: v => (v === undefined ? null : 'Object.prototype was polluted') });

  // ---- memory
  for (const [k, a] of Object.entries({ 'nothing': [], 'null strokes': [null, '7'], 'no label': [good.slice(0, 1)], 'label number': [good.slice(0, 1), 7], 'label object': [good.slice(0, 1), {}], 'label unknown': [good.slice(0, 1), 'zzz'], 'label proto': [good.slice(0, 1), '__proto__'],
    'label junk': [good.slice(0, 1), 'junk'], 'ref NaN': [good.slice(0, 1), '7', NaN], 'ref 0': [good.slice(0, 1), '7', 0], 'ref negative': [good.slice(0, 1), '7', -3], 'ref string': [good.slice(0, 1), '7', 'x'], 'NaN strokes': [[[[NaN, NaN]]], '7'], 'good': [good.slice(0, 1), '7'] })) {
    C.push({ name: 'memory.learn ' + k, run: () => { Nib.memory.learn(...a); const r = Nib.recognize(good); return { size: Nib.memory.size, latex: r && r.latex }; }, check: o => (typeof o.size === 'number' && typeof o.latex === 'string' && !/NaN|undefined/.test(o.latex) ? null : 'memory left recognition broken') });
  }
  C.push({ name: 'memory.learn 600 times stays within its cap', run: () => { for (let i = 0; i < 600; i++) Nib.memory.learn([rows[i % rows.length].strokes[0]], String(i % 10)); return Nib.memory.size; }, check: n => (n <= 400 ? null : 'memory grew to ' + n) });
  C.push({ name: 'memory.clear', run: () => { Nib.memory.clear(); return [Nib.memory.size, Nib.recognize(good).latex]; }, check: o => (o[0] === 0 && typeof o[1] === 'string' ? null : 'not cleared') });

  // ---- canvas parts
  const K = Nib.canvas;
  const packs = [undefined, null, 5, 'x', {}, [], [[]], [[1]], [[NaN, NaN]], [[Infinity, 1], [2, 3]], [[1e12, 1e12], [0, 0]], [[-1e12, 5], [1e12, 5]], [[2147483648, 0], [0, 0]], [[214748364.9, 0], [0, 0]], [[0, 0], [1e308, 0]], [['a', 'b']], [{ x: 1, y: 2 }], [[1, 2, NaN]], [[1, 2, 5]], [[1, 2, -1]],
    [[0.04, 0.04], [0.05, 0.05], [0.06, 0.06]], [[1, 2], null, [3, 4]], [[-0, -0]], Array.from({ length: 100000 }, (_, i) => [i * 0.37, Math.sin(i) * 500])];
  packs.forEach((p, i) => {
    for (const wp of [false, true]) C.push({ name: `pack #${i} pressure=${wp} ${(() => { try { return JSON.stringify(p).slice(0, 60); } catch (e) { return typeof p; } })()}`, run: () => { const s = K.pack(p, wp); const back = K.unpack(s); return { s: typeof s === 'string' ? s.slice(0, 40) : s, n: back && back.length, fin: finite(back) }; },
      check: o => (typeof o.s !== 'string' ? 'pack did not give a string' : /undefined|NaN/.test(o.s) ? 'pack wrote undefined/NaN into the string' : !o.fin ? 'unpack gave NaN/Infinity' : null) });
  });
  // round trip of real strokes, and of far-away strokes
  for (const [name, off] of [['near', 0], ['1e5 away', 1e5], ['1e7 away', 1e7], ['2e8 away', 2e8], ['1e9 away', 1e9], ['-1e9 away', -1e9], ['1e12 away', 1e12]]) {
    C.push({ name: 'pack/unpack round trip ' + name, run: () => { let worst = 0, n = 0; for (const s of good) { const pts = s.map(p => [p[0] + off, p[1] - off]); const back = K.unpack(K.pack(pts, false)); n += back.length === pts.length ? 0 : 1; for (let i = 0; i < Math.min(back.length, pts.length); i++) worst = Math.max(worst, Math.abs(back[i][0] - pts[i][0]), Math.abs(back[i][1] - pts[i][1])); } return { worst, n }; },
      check: o => (o.n ? 'point counts changed' : o.worst > 0.11 ? 'points moved by ' + o.worst : null) });
  }
  const garbage = ['', ' ', '0', '1', '2', '9', 'z', '0z', '1zzzzzzzzzzzzzzzzzzzz', '0' + 'v'.repeat(100000), '1' + 'v'.repeat(999), '!!!!', '0\u0000\u0001', '0😀', '0-1-2', '0 1 2 3', 'undefined', 'null', '[1,2]', '0' + 'a'.repeat(7), '1' + '0'.repeat(50), '00', '10', '0v', '0vv', '0vvvvvvvvv0'];
  for (const g of garbage.concat([undefined, null, 5, {}, [], true])) C.push({ name: 'unpack ' + (typeof g === 'string' ? JSON.stringify(g.slice(0, 30)) : String(g)), run: () => K.unpack(g), check: o => (!Array.isArray(o) ? 'not an array' : !finite(o) ? 'NaN/Infinity out of unpack' : o.length > 200000 ? 'absurd length ' + o.length : null) });
  let seed = 7; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const AB = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_.,;:!/+=';
  for (let i = 0; i < 3000; i++) { let s = rnd() < 0.8 ? (rnd() < 0.5 ? '0' : '1') : ''; const n = Math.floor(rnd() * 60); for (let j = 0; j < n; j++) s += AB[Math.floor(rnd() * (rnd() < 0.8 ? 32 : AB.length))]; C.push({ name: 'unpack random ' + JSON.stringify(s), run: () => K.unpack(s), check: o => (!Array.isArray(o) ? 'not an array' : !finite(o) ? 'NaN/Infinity out of unpack' : null) }); }
  // a real packed stroke, cut short or with one character changed, never gives NaN
  const real = K.pack(good[0], false);
  for (let i = 0; i < Math.min(real.length, 120); i++) {
    C.push({ name: 'unpack truncated at ' + i, run: () => K.unpack(real.slice(0, i)), check: o => (Array.isArray(o) && finite(o) ? null : 'NaN/not array') });
    C.push({ name: 'unpack one char changed at ' + i, run: () => K.unpack(real.slice(0, i) + 'Z' + real.slice(i + 1)), check: o => (Array.isArray(o) && finite(o) ? null : 'NaN/not array') });
  }

  // colors, papers
  for (const c of [undefined, null, 5, '', '@red', '@nope', '@', 'red', '#fff', '#ffffff', '#ggg', 'rgb(1,2,3)', 'rgba(1,2,3,0.5)', 'hsl(1 2% 3%)', 'url(x)', 'expression(alert(1))', '@__proto__', '@constructor', '@toString', {}, [], 'x'.repeat(10000)]) {
    for (const dark of [false, true]) C.push({ name: `color ${String(c).slice(0, 30)} dark=${dark}`, run: () => K.color(c, dark, '#123456'), check: o => (o === undefined || o === null || typeof o === 'string' ? null : 'color is a ' + typeof o + ': ' + JSON.stringify(o)) });
  }
  for (const t of [undefined, null, 5, 'theme', 'white', 'cream', 'green', 'black', 'nope', '__proto__', 'constructor', {}]) for (const dark of [false, true, 'x']) C.push({ name: `paperTone ${String(t)} dark=${dark}`, run: () => K.paperTone(t, dark), check: o => (o && typeof o.paper === 'string' && typeof o.ink === 'string' ? null : 'no paper/ink colors: ' + JSON.stringify(o)) });

  // shapes
  const pt = (x, y) => [x, y];
  for (const kind of [undefined, null, 5, 'line', 'arrow', 'arrow2', 'rect', 'square', 'ellipse', 'circle', 'triangle', 'rtriangle', 'numberline', 'plane', 'nope', '__proto__', 'constructor', {}]) {
    for (const [nm, a, b] of [['normal', pt(0, 0), pt(100, 60)], ['tap', pt(5, 5), pt(5, 5)], ['NaN', pt(NaN, 0), pt(1, 1)], ['Infinity', pt(0, 0), pt(Infinity, Infinity)], ['huge', pt(-1e12, -1e12), pt(1e12, 1e12)], ['reversed', pt(100, 60), pt(0, 0)], ['undefined', undefined, undefined], ['strings', ['a', 'b'], ['c', 'd']], ['objects', { x: 0, y: 0 }, { x: 9, y: 9 }]]) {
      for (const opt of [undefined, null, {}, { snap: 40 }, { snap: NaN }, { snap: -1 }, { angle: NaN }, { z: 0 }, { z: NaN }, { z: -1 }, { opt: { min: 5, max: -5 } }, { opt: { min: NaN, max: NaN, step: 0 } }, { opt: { min: -1e9, max: 1e9, step: 1e-9 } }, { opt: 'x' }])
        C.push({ name: `shapeFromDrag ${String(kind)} ${nm} ${JSON.stringify(opt)}`, run: () => K.shapeFromDrag(kind, a, b, opt), check: o => (o === null || o === undefined || typeof o === 'object' ? null : 'odd result') });
    }
  }

  // pdf
  const jpeg = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xFF, 0xC0, 0, 11, 8, 0, 10, 0, 10, 1, 1, 0x11, 0, 0xFF, 0xD9]);
  const pages = { 'undefined': undefined, 'null': null, 'empty': [], 'null page': [null], 'empty page': [{}], 'no jpeg': [{ pw: 612, ph: 792 }], 'jpeg string': [{ jpeg: 'abc', pw: 612, ph: 792 }], 'jpeg empty': [{ jpeg: new Uint8Array(0), pw: 612, ph: 792 }], 'jpeg not a jpeg': [{ jpeg: Uint8Array.from([1, 2, 3, 4, 5]), pw: 612, ph: 792 }],
    'jpeg cut short': [{ jpeg: jpeg.slice(0, 12), pw: 612, ph: 792 }], 'sizes NaN': [{ jpeg, pw: NaN, ph: NaN }], 'sizes zero': [{ jpeg, pw: 0, ph: 0 }], 'sizes negative': [{ jpeg, pw: -612, ph: -792 }], 'sizes huge': [{ jpeg, pw: 1e12, ph: 1e12 }], 'sizes strings': [{ jpeg, pw: '612', ph: '792' }],
    'place garbage': [{ jpeg, pw: 612, ph: 792, place: 'x' }], 'place NaN': [{ jpeg, pw: 612, ph: 792, place: { x: NaN, y: NaN, w: NaN, h: NaN } }], 'good': [{ jpeg, pw: 612, ph: 792 }], '300 pages': Array.from({ length: 300 }, () => ({ jpeg, pw: 612, ph: 792 })) };
  for (const k of Object.keys(pages)) for (const meta of [undefined, null, {}, { title: '(((' }, { title: ') /JS (app.alert(1)) /X (' }, { title: '\\'.repeat(9) }, { title: 'x'.repeat(100000) }, { title: 'π × ÷ 😀' }, { title: { a: 1 } }, { title: 5, date: 'x' }, { date: new Date(NaN) }, { title: '\u0000\n\r)' }])
    C.push({ name: `pdf ${k} meta=${String(JSON.stringify(meta)).slice(0, 40)}`, run: () => { const o = K.pdf(pages[k], meta); return o && { len: o.length || o.byteLength || o.size, head: o instanceof Uint8Array ? String.fromCharCode(...o.slice(0, 5)) : typeof o }; }, check: o => (o === null || o === undefined || (o.head === '%PDF-') ? null : 'not a PDF: ' + JSON.stringify(o)) });
  for (const a of [[], [undefined], [null, null], [NaN, NaN, NaN, NaN], [0, 0, 0, 0], [612, 792, 0, 0], [-1, -1, 612, 792], [1e12, 1, 612, 792], ['a', 'b', 'c', 'd']]) C.push({ name: 'pdfFit ' + JSON.stringify(a), run: () => K.pdfFit(...a), check: o => (finite(o) ? null : 'NaN from pdfFit: ' + JSON.stringify(o)) });

  // scribble
  const zig = Array.from({ length: 9 }, (_, i) => [i % 2 ? 100 : 0, i * 6]).reduce((acc, p, i, a) => (i ? acc.concat(line(a[i - 1][0], a[i - 1][1], p[0], p[1], 8)) : [p]), []);
  for (const [k, pts] of Object.entries({ 'undefined': undefined, 'null': null, 'empty': [], 'one point': [[1, 1]], 'NaN': [[NaN, NaN], [1, 1], [2, 2]], 'Infinity': [[0, 0], [Infinity, 0], [0, 5]], 'strings': [['a', 'b'], ['c', 'd']], 'huge': Array.from({ length: 200000 }, (_, i) => [i % 2 * 100, i * 0.01]), 'a real zig-zag': zig, 'same point 5000 times': Array.from({ length: 5000 }, () => [3, 3]), '1e12 scale': zig.map(p => [p[0] * 1e12, p[1] * 1e12]), '1e-12 scale': zig.map(p => [p[0] * 1e-12, p[1] * 1e-12]) })) {
    for (const z of [undefined, 1, 0, -1, NaN, Infinity, 1e-9, 'x']) C.push({ name: `scribble.of ${k} z=${z}`, run: () => { const s = Nib.scribble.of(pts, z); const items = good.map(p => ({ pts: p })).concat([{ pts: null }, { pts: [] }, {}, null, { pts: [[NaN, NaN]] }, { pts: zig, group: 'g', closed: true, fixed: true }]); return s ? { erase: Nib.scribble.erase(s, items, z), covers: Nib.scribble.covers(s, good[0], z) } : null; }, check: o => (o === null || (o.erase && Array.isArray(o.erase.erase) && (!!o.covers && typeof o.covers === 'object' && finite(o.covers))) ? null : 'odd scribble result: ' + JSON.stringify(o).slice(0, 200)) });
  }
  for (const s of [undefined, null, {}, 5, 'x', { hull: null }, { pts: [] }]) C.push({ name: 'scribble.erase with a scribble that is ' + JSON.stringify(s), run: () => [Nib.scribble.erase(s, [{ pts: good[0] }], 1), Nib.scribble.covers(s, good[0], 1)] });

  C.push({ name: 'after everything: a good expression reads as it did at the start', run: () => { Nib.memory.clear(); Nib.hand.clear(); return [Nib.recognize(good).latex, new Nib.Recognizer().recognize(good).latex]; }, check: o => (o[0] === o[1] ? null : 'state left behind: ' + o.join(' vs ')) });
  return C;
};
