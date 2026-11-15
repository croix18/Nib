// The Board opened with bad data already in this browser's storage: every case must start with no page error, read
// new writing, save, and come back after a reload. node board_boot.js [filter] [workers=4]
'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(T.npm('puppeteer-core'));
const BOARD = 'file://' + (process.env.BOARD || REPO + '/dist/Board.html');
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const byId = id => rows.find(r => r.id === id);
const wait = ms => new Promise(r => setTimeout(r, ms));
const Nib = require(REPO + '/dist/nib.js');
const K = Nib.canvas;
const sample = byId('arith_003');                       // what each case writes
const packOf = strokes => strokes.map(s => K.pack(s.map(p => [p[0] + 300, p[1] + 500]), false));
const goodPk = packOf(byId('arith_000').strokes);
const J = JSON.stringify;
const board = o => ({ 'nib-board-v3': typeof o === 'string' ? o : J(Object.assign({ v: 3, page: 0 }, o)) });
const page1 = extra => board({ pages: [Object.assign({ pk: goodPk, fixes: [], revealed: [], types: [], paper: { kind: 'dots', tone: 'theme' } }, extra)] });
const vec = (n, f) => Array.from({ length: n }, (_, i) => f(i));

const CASES = {
  'clean (nothing saved)': {},
  'a good saved board': page1({}),
  // ---- the board key itself
  'board: not JSON': board('not json at all'), 'board: cut-off JSON': board('{"v":3,"pages":[{"pk":["0ab'), 'board: empty string': board(''), 'board: null': board('null'), 'board: array': board('[]'), 'board: number': board('5'),
  'board: string': board('"hello"'), 'board: true': board('true'), 'board: {}': board('{}'), 'board: v only': board('{"v":3}'), 'board: pages null': board({ pages: null }), 'board: pages {}': board({ pages: {} }), 'board: pages string': board({ pages: 'x' }),
  'board: pages [null,5,"x",[]]': board({ pages: [null, 5, 'x', []] }), 'board: pages [{}]': board({ pages: [{}] }), 'board: pk null': board({ pages: [{ pk: null }] }), 'board: pk odd members': board({ pages: [{ pk: [null, 5, {}, 'zzz', '', '0', '1', [], true] }] }),
  'board: pk garbage strings': board({ pages: [{ pk: ['0!!!!', '1\u0000\u0001', '0' + 'v'.repeat(50000), 'undefined', 'NaN', '0vvvvvvv', '1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', '😀😀😀'] }] }),
  'board: v 4 (newer)': board({ v: 4, pages: [{ pk: goodPk, future: { a: 1 } }], unknown: [1, 2, 3] }), 'board: v -1': board({ v: -1, pages: [{ pk: goodPk }] }), 'board: v "3"': board({ v: '3', pages: [{ pk: goodPk }] }), 'board: v null': board({ v: null, pages: [{ pk: goodPk }] }),
  'board: page index -1': board({ page: -1, pages: [{ pk: goodPk }] }), 'board: page index 99': board({ page: 99, pages: [{ pk: goodPk }] }), 'board: page index 1.5': board({ page: 1.5, pages: [{ pk: goodPk }, { pk: goodPk }] }), 'board: page index "x"': board({ page: 'x', pages: [{ pk: goodPk }] }),
  'board: 400 blank pages': board({ pages: vec(400, () => ({ pk: [] })) }), 'board: 60 written pages': board({ page: 59, pages: vec(60, () => ({ pk: goodPk })) }),
  // ---- unpacked strokes (the form before packing, and what a hand-made file has)
  'strokes: string': board({ pages: [{ strokes: 'x' }] }), 'strokes: [null]': board({ pages: [{ strokes: [null] }] }), 'strokes: [[null]]': board({ pages: [{ strokes: [[null]] }] }), 'strokes: null points': board({ pages: [{ strokes: [[[null, null], [1, 1]], [[5, 5], [null, 9]]] }] }),
  'strokes: strings': board({ pages: [{ strokes: [[['a', 'b'], ['c', 'd']]] }] }), 'strokes: numeric strings': board({ pages: [{ strokes: [[['10', '20'], ['30', '40'], ['50', '20']]] }] }), 'strokes: 1e308': board({ pages: [{ strokes: [[[1e308, 1e308], [-1e308, -1e308]], [[0, 0], [10, 10]]] }] }),
  'strokes: 1e15 away': board({ pages: [{ strokes: byId('arith_000').strokes.map(s => s.map(p => [p[0] + 1e15, p[1] - 1e15])) }] }), 'strokes: 1e9 away': board({ pages: [{ strokes: byId('arith_000').strokes.map(s => s.map(p => [p[0] + 1e9, p[1] - 1e9])) }] }),
  'strokes: objects': board({ pages: [{ strokes: [[{ x: 1, y: 2 }, { x: 30, y: 40 }]] }] }), 'strokes: one point each': board({ pages: [{ strokes: [[[5, 5]], [[9, 9]], [[]], []] }] }), 'strokes: too deep': board({ pages: [{ strokes: [[[[1, 2], [3, 4]]]] }] }),
  'strokes: numbers': board({ pages: [{ strokes: [1, 2, 3] }] }), 'strokes: booleans': board({ pages: [{ strokes: [[[true, false], [false, true]]] }] }), 'strokes: 3000 strokes': board({ pages: [{ strokes: vec(3000, i => [[i % 60 * 20, Math.floor(i / 60) * 20], [i % 60 * 20 + 8, Math.floor(i / 60) * 20 + 6]]) }] }),
  'strokes: one stroke of 300,000 points': board({ pages: [{ strokes: [vec(300000, i => [i % 700, (i * 7) % 400])] }] }),
  // ---- looks, per element
  'meta: string': page1({ meta: 'x' }), 'meta: odd members': page1({ meta: [5, 'a', null, [], { k: 'zzz' }, { k: 5 }, { c: '@nope' }, { c: 5 }, { s: 1e9 }, { s: -1 }, { s: 'big' }, { f: '@red:5' }, { o: 'x' }] }),
  'meta: image with no picture': page1({ meta: [{ k: 'image', im: 'missing-id' }, { k: 'image' }, { k: 'image', im: 5 }, { k: 'image', im: '../../etc' }] }), 'meta: text odd': page1({ meta: [{ k: 'text' }, { k: 'text', x: 5 }, { k: 'text', x: '' }, { k: 'text', x: 'x'.repeat(20000) }, { k: 'text', x: '<img src=x onerror=alert(1)>', s: 40 }, { k: 'text', x: '\u0000\n\n\n', s: 400 }] }),
  'meta: shapes odd': page1({ meta: [{ k: 'shape' }, { k: 'shape', sh: 'nope' }, { k: 'shape', sh: 'numberline', o: { min: 5, max: -5, step: 0 } }, { k: 'shape', sh: 'numberline', o: { min: -1e9, max: 1e9, step: 1e-9 } }, { k: 'shape', sh: 'plane', o: { xmin: 0, xmax: 0, ymin: 0, ymax: 0, step: 0 } }, { k: 'shape', sh: 'plane', o: { min: -1e12, max: 1e12, step: 1e-12, labels: true } }, { k: 'shape', sh: 'rect', f: 'solid', d: 1 }, { k: 'shape', sh: 'ellipse', f: '@red:0.5' }, { k: 'shape', sh: 'triangle' }, { k: 'shape', sh: 'arrow2' }] }),
  'meta: every tool on the same strokes': page1({ meta: [{ k: 'marker', s: 400 }, { k: 'highlighter', s: 1000 }, { k: 'marker', c: '#12345' }, { k: 'highlighter', c: 'url(javascript:1)' }, { k: 'marker', c: '@ink', s: 0.0001 }] }),
  'meta longer than strokes': page1({ meta: vec(500, () => ({ k: 'marker' })) }),
  'press: string': page1({ press: 'x' }), 'press: wrong lengths': board({ pages: [{ strokes: byId('arith_000').strokes, press: [[1, 2, 3], 'x', null, [NaN], vec(5000, () => 50)] }] }), 'press: strings': board({ pages: [{ strokes: [[[1, 1], [20, 20], [40, 10]]], press: [['a', 'b', 'c']] }] }),
  'press: out of range': board({ pages: [{ strokes: [[[1, 1], [20, 20], [40, 10]]], press: [[-500, 1e9, null]] }] }),
  'fixes: string': page1({ fixes: 'x' }), 'fixes: odd members': page1({ fixes: [null, 5, 'x', {}, { strokes: 'x' }, { strokes: [0], label: 5 }, { strokes: [99], label: '7' }, { strokes: [-1], label: '7' }, { strokes: [0.5], label: '7' }, { strokes: [], label: '7' }, { strokes: [0, 0, 0, 0, 0, 0, 0], label: '7' }] }),
  'fixes: labels that are not symbols': page1({ fixes: [{ strokes: [0], label: '__proto__' }, { strokes: [1], label: 'constructor' }, { strokes: [2], label: '\\notaclass' }, { strokes: [3], label: '' }, { strokes: [4], label: 'junk' }, { strokes: [5], label: 'x'.repeat(5000) }] }),
  'fixes: every stroke fixed to the same thing': page1({ fixes: vec(goodPk.length, i => ({ strokes: [i], label: '\\sqrt' })) }), 'fixes: overlapping': page1({ fixes: [{ strokes: [0, 1], label: '4' }, { strokes: [1, 2], label: '5' }, { strokes: [0, 2], label: '+' }, { strokes: vec(goodPk.length, i => i), label: '8' }] }),
  'revealed: string': page1({ revealed: 'x' }), 'revealed: odd members': page1({ revealed: [null, 5, {}, { strokes: 'x' }, { strokes: [0], answer: 5 }, { strokes: [99] }, { strokes: [0, 1, 2], answer: 'x'.repeat(5000) }, { strokes: [0], answer: { a: 1 } }] }),
  'looks: string': page1({ looks: 'x' }), 'looks: odd members': page1({ looks: [null, 5, {}, { strokes: [0], answer: '5', g: { 5: { s: [99] } } }, { strokes: [0], answer: '5', g: { 5: { p: ['zzz', '0!!', ''] } } }, { strokes: [0, 1], answer: '12', view: 'nope', g: { 1: { d: 1 }, 2: { d: 1 }, __proto__: { d: 1 } } }, { strokes: [0], answer: '7', g: { 7: { p: ['0' + 'v'.repeat(19000)] } } }] }),
  'types: odd': page1({ types: ['pen', 5, null, 'zzz', {}, 'touch', 'mouse', 'eraser'] }), 'types: string': page1({ types: 'pen' }),
  'cam: NaN (null)': page1({ cam: { x: null, y: null, z: null } }), 'cam: huge': page1({ cam: { x: 1e308, y: -1e308, z: 1e9 } }), 'cam: z 0': page1({ cam: { x: 0, y: 0, z: 0 } }), 'cam: z negative': page1({ cam: { x: 0, y: 0, z: -3 } }), 'cam: string': page1({ cam: 'x' }), 'cam: array': page1({ cam: [1, 2, 3] }),
  'cam: strings inside': page1({ cam: { x: 'a', y: 'b', z: 'c' } }), 'cam: far away': page1({ cam: { x: 1e12, y: 1e12, z: 1 } }), 'cam: z tiny': page1({ cam: { x: 0, y: 0, z: 1e-12 } }),
  'paper: odd': page1({ paper: { kind: 'nope', tone: 5 } }), 'paper: string': page1({ paper: 'grid' }), 'paper: every kind then garbage tone': board({ pages: ['blank', 'dots', 'grid', 'graph', 'lined', 'iso', 'plane', 'numberlines'].map(kind => ({ pk: goodPk, paper: { kind, tone: '__proto__' } })) }),
  // ---- settings
  'settings: all wrong types': board({ view: 5, solve: 'yes', reveal: null, rail: 'middle', theme: {}, finger: [], pinch: 'x', train: 'true', ink: 'crayon', styles: 'x', eraser: 5, hold: 1, snap: 0, pressure: 'no', read: null, scribble: [], paper: 5, xp: 'x', pages: [{ pk: goodPk }] }),
  'settings: styles odd': board({ styles: { pen: { color: 'red', size: -5 }, marker: { color: '@red', size: 1e9 }, highlighter: null, shape: { kind: 'nope', fill: 5, dash: 'x' }, text: { size: 'huge' }, __proto__: { polluted: 1 }, extra: {} }, pages: [{ pk: goodPk }] }),
  'settings: view hand, no hand': board({ view: 'hand', pages: [{ pk: goodPk }] }), 'settings: view typeset': board({ view: 'typeset', pages: [{ pk: goodPk }] }), 'settings: read off, solve on': board({ read: false, solve: true, pages: [{ pk: goodPk }] }),
  // ---- the board before pages (nib-board-v1)
  'v1 only: good': { 'nib-board-v1': J({ strokes: byId('arith_000').strokes, pen: 'thin', view: 'tidy' }) }, 'v1 only: garbage': { 'nib-board-v1': 'garbage' }, 'v1 only: odd': { 'nib-board-v1': J({ strokes: 'x', pen: 5, fixes: 'y' }) },
  'v1 good, v3 not JSON': { 'nib-board-v1': J({ strokes: byId('arith_000').strokes }), 'nib-board-v3': '{{{' }, 'v3 "null", v1 good': { 'nib-board-v1': J({ strokes: byId('arith_000').strokes }), 'nib-board-v3': 'null' },
  // ---- memory of corrections
  'memory: not JSON': Object.assign(page1({}), { 'nib-memory-v1': 'x' }), 'memory: {}': Object.assign(page1({}), { 'nib-memory-v1': '{}' }), 'memory: items string': Object.assign(page1({}), { 'nib-memory-v1': J({ model: 'd74ed302a03a', items: 'x' }) }),
  'memory: odd items': Object.assign(page1({}), { 'nib-memory-v1': J({ model: 'd74ed302a03a', items: [{ l: '7', v: [1, 2, 3] }, { l: '7', v: [] }, { l: 5, v: vec(192, () => 0.07) }, { l: 'zzz', v: vec(192, () => 0.07) }, { l: '__proto__', v: vec(192, () => 0.07) }, { l: '7', v: vec(192, () => null) }, { l: '3', v: vec(192, () => 0) }, { l: '3', v: vec(192, () => 1e30) }, { l: '8', v: vec(5000, () => 0.01) }] }) }),
  'memory: null item': Object.assign(page1({}), { 'nib-memory-v1': J({ model: 'd74ed302a03a', items: [null, { l: '7' }, { v: [1] }, 5, 'x'] }) }), 'memory: v a string': Object.assign(page1({}), { 'nib-memory-v1': J({ model: 'd74ed302a03a', items: [{ l: '7', v: 'abcdef' }, { l: '7', v: { length: 192 } }] }) }),
  'memory: 5000 items': Object.assign(page1({}), { 'nib-memory-v1': J({ model: 'd74ed302a03a', items: vec(5000, i => ({ l: String(i % 10), v: vec(192, j => Math.round(Math.sin(i * 31 + j) * 100) / 1000) })) }) }),
  'memory: every symbol pulled to 8': Object.assign(page1({}), { 'nib-memory-v1': J({ model: 'd74ed302a03a', items: vec(300, i => ({ l: '8', v: vec(192, j => Math.round(Math.sin(i + j * 0.37) * 1000) / 1000) })) }) }),
  'memory: another model': Object.assign(page1({}), { 'nib-memory-v1': J({ model: 'someothermodel', items: [{ l: '7', v: [1] }] }) }),
  // ---- the saved hand
  'hand: not JSON': Object.assign(page1({ }), { 'nib-hand-v1': 'x' }), 'hand: glyphs odd': Object.assign(board({ view: 'hand', pages: [{ pk: goodPk }] }), { 'nib-hand-v1': J({ name: 'Bad', saved: 1, glyphs: { 0: null, 1: 5, 2: 'x', 3: [], 4: [[]], 5: [[[]]], 6: [[[null, null], [1, 1]]], 7: [[['a', 'b']]], 8: [[[1e308, 1e308], [0, 0]]], 9: [[[0.5, 0.5]]], '+': [[[0.5, 0.5], [0.5, 0.5]]], '-': [[[0, 0.5], [1e-320, 0.5]]], '=': [[{ x: 0, y: 0 }, { x: 1, y: 1 }]], '.': [[[0.2, 0.2], [0.8, 0.8]]] } }) }),
  'hand: flat glyphs': Object.assign(board({ view: 'hand', pages: [{ pk: goodPk }] }), { 'nib-hand-v1': J({ name: 'Flat', saved: 1, glyphs: Object.fromEntries('0123456789+-=.x()'.split('').map(c => [c, [[[0.1, 0.5], [0.9, 0.5]]]])) }) }),
  'hand: dots for glyphs': Object.assign(board({ view: 'hand', pages: [{ pk: goodPk }] }), { 'nib-hand-v1': J({ name: 'Dots', saved: 1, glyphs: Object.fromEntries('0123456789+-=.x()'.split('').map(c => [c, [[[0.5, 0.5], [0.5, 0.5]]]])) }) }),
  'hand: huge coordinates': Object.assign(board({ view: 'hand', pages: [{ pk: goodPk }] }), { 'nib-hand-v1': J({ name: 'Huge', saved: 1, glyphs: Object.fromEntries('0123456789+-=.x()'.split('').map(c => [c, [[[0, 0], [1e300, 1e300]], [[-1e300, 5], [3, 1e300]]]])) }) }),
  'hand: metrics odd': Object.assign(board({ view: 'hand', pages: [{ pk: goodPk }] }), { 'nib-hand-v1': J({ name: 5, saved: 'yesterday', cap: null, x: 'a', base: 0, desc: 0, avg: 'x', useSamples: 5, glyphs: Object.fromEntries('0123456789+-=.x()'.split('').map(c => [c, [[[0.2, 0.2], [0.5, 0.8], [0.8, 0.2]]]])) }) }),
  'hand: the Replicator key odd': Object.assign(board({ view: 'hand', pages: [{ pk: goodPk }] }), { 'replicator-v1': J({ saved: 9e15, glyphs: { 7: 'x' }, avg: { 7: [[[null]]] }, boxes: 'x', samples: { 7: [null] } }) }),
  'hand: a good hand, 10,000 point glyphs': Object.assign(board({ view: 'hand', pages: [{ pk: goodPk }] }), { 'nib-hand-v1': J({ name: 'Long', saved: 1, glyphs: Object.fromEntries('0123456789+-=.x()'.split('').map(c => [c, [vec(10000, i => [0.5 + 0.4 * Math.cos(i / 50), 0.5 + 0.4 * Math.sin(i / 37)])]])) }) }),
  // ---- the training log and the drill
  'train: not JSON': Object.assign(board({ train: true, pages: [{ pk: goodPk }] }), { 'nib-train-v1': 'x' }), 'train: records string': Object.assign(board({ train: true, pages: [{ pk: goodPk }] }), { 'nib-train-v1': J({ v: 1, records: 'x' }) }),
  'train: odd records': Object.assign(board({ train: true, pages: [{ pk: goodPk }] }), { 'nib-train-v1': J({ v: 1, records: [null, 5, 'x', {}, { key: 5 }, { key: 'a', strokes: 'x' }, { key: 'b', strokes: [[[1, 2]]], symbols: 'x', fixed: 5, t: 'now', latex: 5 }, { key: 'b', strokes: [[[1, 2]]] }, { key: '__proto__', strokes: [] }] }) }),
  'train: 3500 records': Object.assign(board({ train: true, pages: [{ pk: goodPk }] }), { 'nib-train-v1': J({ v: 1, records: vec(3500, i => ({ key: 'k' + i, t: i, w: 800, h: 600, view: 'ink', strokes: [[[1, 2], [3, 4]]], types: ['pen'], latex: '1', symbols: [], fixed: [], answered: false, confidence: 0.9 })) }) }),
  'drill: not JSON': Object.assign(page1({}), { 'nib-drill-v1': 'x' }), 'drill: odd': Object.assign(page1({}), { 'nib-drill-v1': J({ v: 1, drill: 'v1', pos: 3, skipped: 'x', done: 5, fixed: null, active: true }) }), 'drill: active past the end': Object.assign(page1({}), { 'nib-drill-v1': J({ v: 1, drill: 'v1', pos: 99999, active: true, done: vec(5000, i => i) }) }),
  'drill: active at 0': Object.assign(page1({}), { 'nib-drill-v1': J({ v: 1, drill: 'v1', pos: 0, active: true }) }), 'drill: odd members': Object.assign(page1({}), { 'nib-drill-v1': J({ v: 1, drill: 'v1', pos: 2, active: true, skipped: [null, 'x', -1, 1e9, {}], done: [[], 'y'], fixed: [{ a: 1 }] }) }),
  // ---- everything at once
  'everything garbage': { 'nib-board-v3': '{', 'nib-board-v1': '[', 'nib-memory-v1': '!', 'nib-hand-v1': '?', 'replicator-v1': '#', 'nib-train-v1': '$', 'nib-drill-v1': '%' },
  'other tools\' keys present': Object.assign(page1({}), { 'deckhand-state': 'x'.repeat(100000), 'tally': '{"a":1}', '': 'empty key', 'nib-board-v2': 'never existed', 'nib-board-v4': J({ v: 4, pages: [] }) }),
};

async function runCase(browser, name, kv) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push('page error: ' + String(e.message).slice(0, 200) + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' | ').replace(/file:\/\/\S+Board\.html/g, 'Board.html').slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  const net = [];
  await page.setRequestInterception(true);
  page.on('request', r => { const u = r.url(); if (!/^(file|data|blob|about):/.test(u)) net.push(u.slice(0, 120)); r.continue().catch(() => {}); });
  await page.setViewport({ width: 1200, height: 800 });
  await page.evaluateOnNewDocument(kv => {
    try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); for (const k of Object.keys(kv)) localStorage.setItem(k, kv[k]); sessionStorage.setItem('seeded', '1'); } } catch (e) { window.__seedError = String(e); }
    window.__rej = []; window.addEventListener('unhandledrejection', e => window.__rej.push(String(e.reason).slice(0, 200)));
  }, kv);
  const R = { name, errors, net, notes: [] };
  const t0 = Date.now();
  try {
    await page.goto(BOARD, { waitUntil: 'load', timeout: 60000 });
    await wait(900);
    R.bootMs = Date.now() - t0;
    const st0 = await page.evaluate(() => { const p = document.getElementById('pad'); return { seedError: window.__seedError || null, pad: !!(p && p.pad), n: p && p.pad ? p.pad.strokes.length : -1, note: document.getElementById('note') && !document.getElementById('note').hidden ? document.getElementById('notetext').textContent : '', pages: document.getElementById('pagenum') ? document.getElementById('pagenum').textContent : '' }; });
    R.st0 = st0;
    if (!st0.pad) { R.dead = 'no pad after load'; return R; }
    // is the page still alive (a frame comes, the toolbar answers)?
    const alive = await Promise.race([page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))), wait(8000).then(() => false)]);
    if (!alive) { R.dead = 'no animation frame within 8 s after load'; return R; }
    // write something new, far from what is there, with the mouse
    const box = await (await page.$('#pad canvas')).boundingBox();
    const cdp = await page.createCDPSession();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of sample.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const k = Math.min(box.width * 0.3 / (x1 - x0), box.height * 0.2 / (y1 - y0));
    await page.keyboard.press('p').catch(() => {});
    for (const s of sample.strokes) {
      const P = s.map(p => [box.x + box.width * 0.55 + (p[0] - x0) * k, box.y + box.height * 0.12 + (p[1] - y0) * k]);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P[0][0], y: P[0][1], button: 'left', clickCount: 1 });
      for (let i = 1; i < P.length; i += 2) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: P[i][0], y: P[i][1], button: 'left' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P[P.length - 1][0], y: P[P.length - 1][1], button: 'left', clickCount: 1 });
    }
    // read: every stroke that is read (text, shapes and pictures are not) has its reading — or reading is off
    await page.waitForFunction(() => { const P = document.getElementById('pad').pad; return !!P && (!P.o.read || (!!P.result && (P.resultStrokes || []).length === P.ink.length)); }, { timeout: 45000 }).catch(() => { R.notes.push('reading did not settle in 45 s'); });
    await wait(900);
    const st1 = await page.evaluate(() => { const p = document.getElementById('pad'); const parts = p.pad.result && p.pad.result.parts ? p.pad.result.parts.map(q => q.result && q.result.latex) : null; let saved = null, perr = null; try { saved = JSON.parse(localStorage.getItem('nib-board-v3')); } catch (e) { perr = String(e); }
      return { n: p.pad.strokes.length, parts, latex: p.latex, savedOk: !!(saved && Array.isArray(saved.pages)), perr, savedV: saved && saved.v, nSavedPages: saved && saved.pages && saved.pages.length, cur: saved && saved.page, nSaved: saved && saved.pages && saved.pages[saved.page] && (saved.pages[saved.page].pk || saved.pages[saved.page].strokes || []).length, rej: window.__rej, note: !document.getElementById('note').hidden ? document.getElementById('notetext').textContent : '' }; });
    R.st1 = st1;
    R.wrote = st1.n - st0.n;
    R.readNew = !!(st1.parts && st1.parts.some(l => l && /5|2|\+|=|\d/.test(l)));
    // reload: what was saved comes back
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await wait(900);
    const st2 = await page.evaluate(() => { const p = document.getElementById('pad'); return { pad: !!(p && p.pad), n: p && p.pad ? p.pad.strokes.length : -1, rej: window.__rej }; });
    R.st2 = st2;
  } catch (e) { R.crash = String(e.message).slice(0, 300); }
  finally { await page.close().catch(() => {}); }
  return R;
}

(async () => {
  const filter = process.argv[2] && process.argv[2] !== '-' ? new RegExp(process.argv[2]) : null, W = +process.argv[3] || 4;
  const names = Object.keys(CASES).filter(n => !filter || filter.test(n));
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: W }, async (_, w) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nibboot-'));
    const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, userDataDir: dir, args: ['--no-sandbox', '--allow-file-access-from-files'] });
    while (next < names.length) { const name = names[next++]; results.push(await runCase(browser, name, CASES[name])); }
    await browser.close(); fs.rmSync(dir, { recursive: true, force: true });
  }));
  fs.writeFileSync(path.join(os.tmpdir(), 'nib-fuzz-boot.json'), JSON.stringify(results, null, 1));
  let bad = 0;
  for (const name of names) {
    const r = results.find(x => x.name === name);
    const newer = /newer/.test(name);
    const problems = [];
    if (r.crash) problems.push('probe crashed: ' + r.crash);
    if (r.dead) problems.push('DEAD: ' + r.dead);
    if (r.errors.length) problems.push(r.errors.length + ' error(s): ' + r.errors.slice(0, 2).join(' ;; '));
    if (r.net.length) problems.push('network: ' + r.net.slice(0, 3).join(', '));
    if (r.st0 && r.st0.seedError) problems.push('seed failed: ' + r.st0.seedError);
    if (r.st1) {
      if (r.wrote !== sample.strokes.length) problems.push(`wrote ${r.wrote} of ${sample.strokes.length} strokes`);
      if (!r.readNew && !/read off/.test(name)) problems.push('new writing not read: ' + JSON.stringify(r.st1.parts).slice(0, 120));
      if (!newer && !r.st1.savedOk) problems.push('not saved: ' + (r.st1.perr || 'no pages'));
      if (!newer && r.st1.savedOk && r.st1.nSaved !== r.st1.n) problems.push(`saved ${r.st1.nSaved} strokes, board has ${r.st1.n}`);
      if (r.st1.rej && r.st1.rej.length) problems.push('unhandled rejection: ' + r.st1.rej[0]);
    }
    if (r.st2 && r.st1 && !newer && r.st2.n !== r.st1.n) problems.push(`after reload ${r.st2.n} strokes, before ${r.st1.n}`);
    if (r.bootMs > 6000) problems.push('slow start: ' + r.bootMs + ' ms');
    r.notes.forEach(n => problems.push(n));
    if (problems.length) bad++;
    console.log((problems.length ? 'FAIL ' : 'ok   ') + name.padEnd(46) + ' boot ' + String(r.bootMs).padStart(5) + ' ms  had ' + String(r.st0 ? r.st0.n : '?').padStart(4) + (r.st0 && r.st0.note ? '  note: "' + r.st0.note.slice(0, 70) + '"' : '') + (problems.length ? '\n        → ' + problems.join('\n        → ') : ''));
  }
  console.log(`\n${names.length - bad} of ${names.length} cases clean`);
})();
