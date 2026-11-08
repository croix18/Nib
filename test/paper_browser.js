// The Board's backgrounds (src/paper.js) in a real browser: every kind × tone draws and fills the view, the pattern's
// pixels are where they should be and move exactly with a pan, zoom 0.1 … 8 works, lines are crisp at
// devicePixelRatio 1 and 2, the plane's labels stay readable with its axes off screen, timings at 1920 × 1080,
// thumbnails, and a contact sheet of every paper with pen ink on it, to look at.
//   node test/paper_browser.js [sheet.png]       (default test/shots/paper_sheet.png; the thumbnails go beside it)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core'));
const SRC = path.join(__dirname, '..', 'src');
const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
const sheet = path.resolve(process.argv[2] || path.join(out, 'paper_sheet.png'));
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (c) passes++; else fails++; };
const note = m => console.log('  note ' + m);

const src = fs.readFileSync(path.join(SRC, 'paper.js'), 'utf8');
const API = ['PAPER_KINDS', 'PAPER_TONES', 'paperTone', 'drawPaper', 'paperThumb'];
// as build.py wraps src/: one strict-mode function scope, the file's own 'use strict' line removed
const wrapped = "(function (global) {\n'use strict';\n" + src.split("'use strict';\n").join('') + '\nglobal.Paper = { ' + API.join(', ') + ' };\n})(window);\n';

console.log('source');
ok(!/^\s*(import|export)\b/m.test(src), 'no import or export');
const tops = [...src.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
ok(tops.length > 0 && tops.every(n => /^(paper|PAPER_)/.test(n) || n === 'drawPaper'), `every top-level name is paper… or PAPER_… (${tops.length} names)`);
ok(API.every(n => tops.includes(n)), 'the API is declared at the top level: ' + API.join(', '));
{
  const clash = [];
  for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.js') && f !== 'paper.js')) {
    const t = fs.readFileSync(path.join(SRC, f), 'utf8');
    for (const n of tops) if (new RegExp('(?:\\b(?:const|let|var|function|class)\\s+|,\\s*)' + n + '\\b\\s*[=(]').test(t)) clash.push(f + ': ' + n);
  }
  ok(!clash.length, 'no other file in src/ declares any of these names' + (clash.length ? ': ' + clash.join(', ') : ''));
  // the build's concatenation, compiled (not run): a name declared twice is a SyntaxError
  const order = ['core', 'recognize', 'solve', 'neat', 'paper', 'shapes', 'pdf', 'store', 'pad', 'api'].map(n => n + '.js').filter(f => fs.existsSync(path.join(SRC, f)));
  const all = order.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n').split("'use strict';\n").join('');
  try { new vm.Script("(function (global) {\n'use strict';\n" + all + '\n})', { filename: 'nib.js' }); ok(true, 'src/ compiles as one strict-mode scope with paper.js in it (' + order.join(', ') + ')'); }
  catch (e) {
    if (tops.some(n => e.message.includes("'" + n + "'"))) ok(false, 'src/ declares a name of paper.js twice: ' + e.message);
    else note('the rest of src/ does not compile right now (it is being edited): ' + e.message);
  }
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const load = async d => {
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: d });
    await page.goto('file://' + path.join(__dirname, 'paper_page.html'), { waitUntil: 'load' });
    await page.addScriptTag({ content: wrapped });
    await page.evaluate(() => Promise.all([document.fonts.load('500 12px "DM Sans"'), document.fonts.load('600 12px "DM Sans"')]));
  };
  await load(1);
  ok(await page.evaluate(() => document.fonts.check('500 12px "DM Sans"')), 'DM Sans 500 is loaded for the labels');

  // ---------------------------------------------------------------- API
  console.log('API');
  const api = await page.evaluate(() => {
    const t = {}, P = Paper.paperTone;
    for (const [tone, dark] of [['theme', false], ['theme', true], ['white', false], ['cream', false], ['green', false], ['black', false]]) t[tone + (dark ? ' dark' : '')] = P(tone, dark);
    return { kinds: Paper.PAPER_KINDS, tones: Paper.PAPER_TONES, t, frozen: Object.isFrozen(P('white')),
      same: P('white', true) === P('white', false) && P('cream', true) === P('cream', false) && P('green', false) === P('green', true) && P('black', false) === P('black', true),
      unknown: P('nonsense', true) === P('theme', true) && P(undefined, false) === P('theme', false) && P('__proto__', false) === P('theme', false) && P('toString', true) === P('theme', true) };
  });
  ok(api.kinds.map(k => k.kind).join() === 'blank,dots,grid,graph,lined,iso,plane,numberlines' && api.kinds.map(k => k.label).join() === 'Blank,Dots,Grid,Graph paper,Lined,Isometric,Coordinate plane,Number lines', 'PAPER_KINDS: the eight kinds in the picker\'s order, with their labels');
  ok(api.tones.map(k => k.tone).join() === 'theme,white,cream,green,black' && api.tones.map(k => k.label).join() === 'Board,White,Cream,Chalkboard,Black', 'PAPER_TONES: the five tones in order, with their labels');
  const F = ['paper', 'ink', 'line', 'major', 'axis', 'label', 'margin'];
  ok(Object.values(api.t).every(t => F.every(f => /^#[0-9a-f]{6}$/.test(t[f])) && typeof t.dark === 'boolean'), 'paperTone gives paper, ink, line, major, axis, label, margin (#rrggbb) and dark, for every tone');
  ok(api.t.theme.paper === '#fbf8ef' && api.t.theme.ink === '#1b2a4a' && !api.t.theme.dark && api.t['theme dark'].paper === '#101a2e' && api.t['theme dark'].ink === '#f1eadb' && api.t['theme dark'].dark, "'theme' is the Board's own: navy on cream, or cream on navy when the Board is dark");
  ok(api.t.white.paper === '#ffffff' && api.t.white.ink === '#1b2a4a' && !api.t.white.dark && api.t.cream.paper === '#fbf8ef' && api.t.cream.ink === '#1b2a4a' && !api.t.cream.dark && api.same, "white and cream take navy ink; white, cream, chalkboard and black do not change with the Board's theme");
  ok(api.t.green.dark && api.t.green.ink === '#f1eadb' && api.t.black.dark && api.t.black.ink === '#f1eadb' && /^#1[0-9a-f]3[0-9a-f]2[0-9a-f]$/.test(api.t.green.paper) && /^#1[0-9a-f]1[0-9a-f]1[0-9a-f]$/.test(api.t.black.paper), `the chalkboard (${api.t.green.paper}) and black (${api.t.black.paper}) are dark, with cream ink`);
  ok(api.unknown && api.frozen, "an unknown tone (even '__proto__' or 'toString') is the Board's own; the colors are shared and frozen");
  {
    const lum = h => { const n = parseInt(h.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const rep = [], order = Object.entries(api.t).filter(([k]) => /^(theme|theme dark|white|cream|green|black)$/.test(k)).every(([k, t]) => {
      const c = ['line', 'major', 'axis', 'label'].map(f => cr(t.paper, t[f]));
      rep.push(`${k} ${c.map(x => x.toFixed(2)).join('/')}`);
      return c[0] > 1.1 && c[0] < c[1] && c[1] < c[2] && c[2] <= c[3] && cr(t.paper, t.ink) > 9;
    });
    ok(order, 'contrast with the paper rises line < major < axis ≤ label, and the ink is far above them all: ' + rep.join(', '));
  }

  // ---------------------------------------------------------------- every kind × tone
  console.log('every kind × tone');
  const TONES = [['theme', false], ['theme', true], ['white', false], ['cream', false], ['green', false], ['black', false]];
  const every = await page.evaluate(TONES => {
    const res = [];
    for (const { kind } of Paper.PAPER_KINDS) for (const [tone, dark] of TONES) {
      try {
        const v = paint({ kind, tone }, { w: 640, h: 400, z: 1, cx: -100, cy: -60, dark }), d = v.ctx.getImageData(0, 0, 640, 400).data;
        const p = Paper.paperTone(tone, dark).paper;
        let n = 0, opaque = true;
        for (let i = 0; i < d.length; i += 4) { if (hex(d, i) === p) n++; if (d[i + 3] !== 255) opaque = false; }
        res.push({ kind, tone: tone + (dark ? ' dark' : ''), frac: n / (640 * 400), opaque });
      } catch (e) { res.push({ kind, tone, err: String(e) }); }
    }
    return res;
  }, TONES);
  ok(every.length === 48 && every.every(r => !r.err), `all ${every.length} kinds × tones draw without errors` + every.filter(r => r.err).map(r => ` ${r.kind}/${r.tone}: ${r.err}`).join(''));
  ok(every.every(r => r.opaque), 'the paper fills the whole view: every pixel is opaque');
  ok(every.every(r => r.kind === 'blank' ? r.frac === 1 : r.frac > 0.6 && r.frac < 1), 'blank is only paper; every other kind marks the paper and leaves most of it bare (' + every.filter(r => r.tone === 'white').map(r => r.kind + ' ' + Math.round(r.frac * 100) + '%').join(', ') + ')');

  // ---------------------------------------------------------------- where the pattern is
  console.log('the pattern is where it should be (zoom 1, the world origin at view pixel (100, 60))');
  const at = await page.evaluate(() => {
    const T = Paper.paperTone('white'), H = 20 * Math.sqrt(3), r = {};
    const shot = kind => paint({ kind, tone: 'white' }, { w: 640, h: 400, z: 1, cx: -100, cy: -60 }).ctx;
    const px = (ctx, pts) => pts.map(([x, y]) => hex(ctx.getImageData(x, y, 1, 1).data, 0));
    // the darkest pixel in a box, as a fraction of the way from the paper to the label color (1 = fully label)
    const ink = (ctx, x0, y0, x1, y1) => { const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data; let m = 255; for (let i = 0; i < d.length; i += 4) m = Math.min(m, d[i + 1]); return (255 - m) / (255 - parseInt(T.label.slice(3, 5), 16)); };
    r.T = T;
    let c = shot('grid'); r.grid = px(c, [[140, 80], [139, 80], [141, 80], [160, 80], [160, 100], [160, 99], [100, 80], [380, 80]]);
    c = shot('dots'); r.dots = px(c, [[128, 88], [100, 60], [100 + 28 * 5, 60 - 28 * 2], [142, 102], [114, 74]]);
    c = shot('graph'); r.graph = px(c, [[200, 70], [120, 70], [110, 70], [201, 70], [199, 70], [110, 150]]);
    c = shot('lined'); r.lined = px(c, [[300, 100], [300, 80], [300, 60 - 40 * 1], [100, 80], [101, 80], [99, 80]]);
    c = shot('iso'); r.iso = px(c, [[100, 60], [Math.floor(100 + H), 80], [Math.floor(100 + 2 * H), 60], [100, 100], [Math.floor(100 + H / 3), 80], [Math.floor(100 + H), 60]]);
    c = shot('plane'); r.plane = px(c, [[99, 200], [100, 200], [98, 210], [101, 210], [310, 59], [310, 60], [310, 57], [310, 62], [140, 200], [190, 230]]);
    r.planeInk = [ink(c, 132, 64, 149, 78), ink(c, 84, 64, 96, 78), ink(c, 84, 14, 96, 27), ink(c, 144, 82, 156, 96)];   // "1" under x = 1, the "0", "1" left of y = 1, and bare paper in a cell
    c = shot('numberlines'); r.numberlines = px(c, [[310, 160], [310, 158], [310, 161], [140, 154], [140, 167], [140, 150], [141, 154]]);
    r.numberRows = px(c, [[310, 159], [310, 160]]);   // the line is 2 px
    r.numberInk = [ink(c, 132, 170, 149, 183), ink(c, 92, 170, 109, 183), ink(c, 152, 170, 168, 183)];   // "1" under x = 40, "0" under x = 0, nothing between
    return r;
  });
  {
    const { T } = at, P = T.paper, eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    ok(eq(at.grid, [T.line, P, P, P, T.line, P, T.line, T.line]), 'grid: 1 px lines at x = 40k and y = 40k in the line color, paper between (' + at.grid.join(' ') + ')');
    ok(eq(at.dots.slice(0, 3), [T.dot, T.dot, T.dot]) && eq(at.dots.slice(3), [P, P]), 'dots: a dot at (28i, 28j), paper between (' + at.dots.join(' ') + ')');
    ok(eq(at.graph, [T.major, T.line, P, P, P, P]), 'graph: minor lines every 20, a darker major line every 100, 1 px at this zoom (' + at.graph.join(' ') + ')');
    ok(eq(at.lined, [T.rule, P, T.rule, T.margin, P, P]), 'lined: rules every 40, the coral margin line at x = 0 (' + at.lined.join(' ') + ')');
    ok(eq(at.iso, [T.dot, T.dot, T.dot, T.dot, P, P]), 'isometric: lattice points at (0, 0), (20√3, 20), (40√3, 0), (0, 40); paper inside a triangle (' + at.iso.join(' ') + ')');
    ok(eq(at.plane.slice(0, 4), [T.axis, T.axis, P, P]) && eq(at.plane.slice(4, 8), [T.axis, T.axis, P, P]) && at.plane[8] === T.line && at.plane[9] === P, 'plane: both axes 2 px in the axis color through the origin, the unit grid in the line color (' + at.plane.join(' ') + ')');
    ok(at.planeInk[0] > 0.6 && at.planeInk[1] > 0.6 && at.planeInk[2] > 0.6 && at.planeInk[3] === 0, 'plane: a "1" under x = 1, the one "0" below-left of the origin, a "1" left of y = 1 (' + at.planeInk.map(x => x.toFixed(2)).join(' ') + ')');
    ok(eq(at.numberlines, [T.axis, P, P, T.axis, T.axis, P, P]) && eq(at.numberRows, [T.axis, T.axis]) && at.numberInk[0] > 0.6 && at.numberInk[1] > 0.6 && at.numberInk[2] === 0, 'number lines: the 2 px line at y = 100, a tick at x = 40, labels "1" and "0" under their ticks (' + at.numberlines.join(' ') + ')');
  }

  // ---------------------------------------------------------------- panning
  console.log('panning by part of a cell moves the pattern by exactly that much');
  const pan = await page.evaluate(() => {
    const res = [];
    for (const { kind } of Paper.PAPER_KINDS) for (const [z, d, dx, dy] of [[1, 1, 13, 7], [1, 1, -9, 22], [4, 1, 1.75, 0.5], [0.25, 1, 28, 12], [1, 2, 6.5, 3.5], [0.5, 2, 9, -5], [1, 2.25, 4, -8], [0.6, 1.5, 10, 20]]) {
      const W = 420, H = 300, cx = -W / 2 / z + 3, cy = -H / 2 / z + 5;   // the origin near the middle
      const a = paint({ kind, tone: 'cream' }, { w: W, h: H, d, z, cx, cy }), b = paint({ kind, tone: 'cream' }, { w: W, h: H, d, z, cx: cx + dx, cy: cy + dy });
      const sx = Math.round(dx * z * d), sy = Math.round(dy * z * d), w = a.c.width, h = a.c.height, m = 48 * d;   // labels cut by an edge differ: compare inside
      const A = a.ctx.getImageData(0, 0, w, h).data, B = b.ctx.getImageData(0, 0, w, h).data;
      let diff = 0;
      for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) {
        const i = (y * w + x) * 4, j = ((y + sy) * w + x + sx) * 4;
        for (let q = 0; q < 3; q++) diff = Math.max(diff, Math.abs(B[i + q] - A[j + q]));
      }
      res.push({ kind, z, d, dx, dy, diff });
    }
    return res;
  });
  for (const { kind } of await page.evaluate(() => Paper.PAPER_KINDS)) {
    const r = pan.filter(p => p.kind === kind);
    ok(r.every(p => p.diff === 0), `${kind}: the view panned by ${r.map(p => `(${p.dx}, ${p.dy}) at zoom ${p.z}${p.d > 1 ? ' dpr ' + p.d : ''}`).join(', ')} is the same picture moved exactly (largest difference ${Math.max(...r.map(p => p.diff))})`);
  }

  // ---------------------------------------------------------------- zoom
  console.log('zoom 0.1, 0.25, 1, 4, 8');
  const zo = await page.evaluate(() => {
    const res = {}, W = 480, H = 320, T = Paper.paperTone('white');
    for (const z of [0.1, 0.25, 1, 4, 8]) for (const { kind } of Paper.PAPER_KINDS) {
      try {
        const v = paint({ kind, tone: 'white' }, { w: W, h: H, z, cx: -W / 2 / z + 11 / z, cy: -H / 2 / z - 13 / z }), d = v.ctx.getImageData(0, 0, W, H).data;
        let paper = 0, opaque = true;
        for (let i = 0; i < d.length; i += 4) { if (hex(d, i) === T.paper) paper++; if (d[i + 3] !== 255) opaque = false; }
        // the runs of marked pixels along a row that misses the horizontal lines: their widths
        const row = Math.round(H / 2 + 13 + 0.37 * 40 * z) % H, runs = [];
        let n = 0;
        for (let x = 0; x < W; x++) { if (hex(d, (row * W + x) * 4) !== T.paper) n++; else if (n) { runs.push(n); n = 0; } }
        res[kind + ' ' + z] = { paper: paper / (W * H), opaque, runs, cols: [...new Set(Array.from({ length: W }, (_, x) => hex(d, (row * W + x) * 4)))] };
      } catch (e) { res[kind + ' ' + z] = { err: String(e) }; }
    }
    return { res, T };
  });
  {
    const R = zo.res, T = zo.T, ks = Object.keys(R);
    ok(ks.length === 40 && ks.every(k => !R[k].err && R[k].opaque), 'every kind draws at every zoom and fills the view' + ks.filter(k => R[k].err).map(k => ` ${k}: ${R[k].err}`).join(''));
    ok(ks.every(k => R[k].paper > 0.55), 'no zoom turns a paper into mush: most of the view stays bare paper (least ' + ks.map(k => [k, R[k].paper]).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([k, p]) => `${k} ${Math.round(p * 100)}%`).join(', ') + ')');
    ok(['grid', 'dots', 'iso'].every(k => R[k + ' 0.1'].paper === 1) && R['lined 0.1'].runs.join() === '1' && R['lined 0.1'].cols.includes(T.margin), 'at zoom 0.1 the grid, dots, isometric dots and rules have faded out; the margin stays');
    {
      const g = R['graph 0.1'], marks = g.cols.filter(c => c !== T.paper), G = h => parseInt(h.slice(3, 5), 16);
      ok(g.runs.length >= 45 && g.runs.every(n => n === 1) && marks.length === 1 && G(T.paper) > G(marks[0]) && G(marks[0]) > G(T.major),
        `at zoom 0.1 graph paper keeps only its major lines, 10 px apart and lighter as they crowd (${g.runs.length} lines in 480 px, ${marks[0]} between the paper and ${T.major})`);
    }
    ok(R['plane 0.1'].cols.includes(T.axis) && R['numberlines 0.1'].paper < 1, 'at zoom 0.1 the plane keeps its axes and the number lines stay');
    ok(['grid', 'graph', 'plane'].every(k => R[k + ' 4'].runs.length > 0 && R[k + ' 8'].runs.every(n => n === (k === 'plane' ? 2 : 1)) && R[k + ' 4'].runs.every(n => n <= 2)), 'at zoom 4 and 8 lines stay 1 px (the plane\'s axis 2 px): ' + ['grid', 'graph', 'plane'].map(k => `${k} ${R[k + ' 8'].runs.join('/')}`).join(', '));
  }
  // the plane's labels: the step widens as units shrink; pinned to the edge with an axis off screen
  const lab = await page.evaluate(() => {
    const W = 600, H = 400, T = Paper.paperTone('white'), lim = parseInt(T.label.slice(3, 5), 16) + 40;
    // the label ink in a band: [first, last] marked column or row
    const band = (v, x0, y0, x1, y1, vertical) => { const d = v.ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, w = x1 - x0, hits = []; for (let i = 0; i < d.length; i += 4) if (d[i + 1] < lim) { const p = i / 4; hits.push(vertical ? Math.floor(p / w) + y0 : p % w + x0); } return hits.length ? [Math.min(...hits), Math.max(...hits), hits.length] : null; };
    // the labels along the x axis's label row: ink columns grouped (a gap over 3 px splits two labels) → how many, and
    // the narrowest gap between neighbors; the y axis (at x = W/2 in these views) is not a label
    const count = (v, y0, y1) => {
      const d = v.ctx.getImageData(0, y0, W, y1 - y0).data, col = new Array(W).fill(false);
      for (let i = 0; i < d.length; i += 4) if (d[i + 1] < lim && Math.abs((i / 4) % W - W / 2) > 3) col[(i / 4) % W] = true;
      let n = 0, gap = 99, minGap = 99;
      for (let x = 0; x < W; x++) { if (col[x]) { if (gap > 3) { if (n) minGap = Math.min(minGap, gap); n++; } gap = 0; } else gap++; }
      return { n, minGap };
    };
    const res = {};
    for (const z of [0.1, 0.25, 0.5, 1, 4]) { const v = paint({ kind: 'plane', tone: 'white' }, { w: W, h: H, z, cx: -W / 2 / z, cy: -H / 2 / z }); res['z' + z] = count(v, H / 2 + 5, H / 2 + 20); }
    // the labels either side of the origin mirror each other: the first one right of the y axis has its negative
    // twin as far to the left (the "0", below-left of the origin, never pushes it out)
    // Swept finely over zoom, in narrow and wide views with the origin a little off center: where the label step is
    // tightest the twin sits only a few px from the "0", and pixel rounding decides whether they touch.
    const Z = []; for (let z = 0.12; z <= 1.001; z += 0.02) Z.push(+z.toFixed(2));
    res.mirror = [200, 240, 600].flatMap(vw => [0, -7, 3, 11].flatMap(o => Z.map(z => {
      const v = paint({ kind: 'plane', tone: 'white' }, { w: vw, h: H, z, cx: (-vw / 2 + o) / z, cy: -H / 2 / z }), ox = vw / 2 - o;
      const d = v.ctx.getImageData(0, H / 2 + 5, vw, 15).data, col = Array.from({ length: vw }, (_, x) => { for (let y = 0; y < 15; y++) if (d[(y * vw + x) * 4 + 1] < lim) return Math.abs(x - ox) > 3; return false; });
      const groups = [];
      for (let x = 0; x < vw; x++) if (col[x]) { if (groups.length && x - groups[groups.length - 1][1] <= 3) groups[groups.length - 1][1] = x; else groups.push([x, x]); }
      const mid = groups.map(g => (g[0] + g[1]) / 2), right = mid.find(m => m > ox + 2);
      return { vw, o, z, right: right - ox, left: mid.some(m => Math.abs(ox - m - (right - ox)) <= 3) };
    })));
    // the x axis above the view: its labels pinned along the top edge; below: the bottom edge (looked for right of the
    // y axis, which crosses the band)
    let v = paint({ kind: 'plane', tone: 'white' }, { w: W, h: H, z: 1, cx: -W / 2, cy: 200 });
    res.top = band(v, W / 2 + 20, 0, W, 24, true); res.topN = count(v, 0, 24).n;
    v = paint({ kind: 'plane', tone: 'white' }, { w: W, h: H, z: 1, cx: -W / 2, cy: -H - 300 });
    res.bottom = band(v, W / 2 + 20, H - 24, W, H, true); res.bottomN = count(v, H - 24, H).n;
    // the y axis right of the view: its labels pinned along the right edge, right-aligned; left of it: the left edge
    // (looked for below the x axis, which crosses the band)
    v = paint({ kind: 'plane', tone: 'white' }, { w: W, h: H, z: 1, cx: -W - 500, cy: -H / 2 });
    res.right = band(v, W - 40, H / 2 + 20, W, H, false);
    v = paint({ kind: 'plane', tone: 'white' }, { w: W, h: H, z: 1, cx: 500, cy: -H / 2 });
    res.left = band(v, 0, H / 2 + 20, 40, H, false);
    // both off screen: the pinned row and column meet in a corner without a label on a label
    v = paint({ kind: 'plane', tone: 'white' }, { w: W, h: H, z: 1, cx: 300, cy: 300 });
    res.corner = { col: band(v, 0, 0, 40, H, false), row: band(v, 0, 0, W, 24, true) };
    return res;
  });
  ok([0.1, 0.25, 0.5, 1, 4].every(z => lab['z' + z].n >= 3 && lab['z' + z].minGap >= 6), `the x axis's labels thin out as the units get small so they never touch, and never vanish: ${[0.1, 0.25, 0.5, 1, 4].map(z => `zoom ${z}: ${lab['z' + z].n} labels, ${lab['z' + z].minGap} px apart at least`).join('; ')} (600 px view)`);
  {
    const bad = lab.mirror.filter(m => !m.left);
    ok(!bad.length, `the x labels mirror each other about the origin, the "0" between them, in all ${lab.mirror.length} views (zoom 0.12 … 1 in 0.02 steps; 200, 240 and 600 px wide; origin off center)` + bad.slice(0, 6).map(m => ` | missing: ${m.vw} px, offset ${m.o}, zoom ${m.z}, ±${Math.round(m.right)} px`).join(''));
  }
  ok(lab.top && lab.top[0] >= 3 && lab.top[1] <= 18 && lab.topN >= 12 && lab.bottom && lab.bottom[1] <= 397 && lab.bottom[0] >= 380 && lab.bottomN >= 12, `with the x axis off screen its labels are pinned to the top edge (rows ${lab.top}) or the bottom edge (rows ${lab.bottom})`);
  ok(lab.right && lab.right[1] <= 597 && lab.right[1] >= 590 && lab.left && lab.left[0] >= 3 && lab.left[0] <= 8, `with the y axis off screen its labels are pinned to the right edge (columns ${lab.right}) or the left edge (columns ${lab.left})`);
  ok(lab.corner.col && lab.corner.row, 'with both axes off screen both label rows show, pinned to the nearest edges');

  // a fading family is an opaque color, so where its lines cross the pixel is the line's own color, not darker
  const cross = await page.evaluate(() => {
    const v = paint({ kind: 'grid', tone: 'white' }, { w: 200, h: 200, z: 0.2, cx: 0, cy: 0 }), p = (x, y) => hex(v.ctx.getImageData(x, y, 1, 1).data, 0);
    return { line: p(8, 3), crossing: p(8, 8), full: Paper.paperTone('white').line, paper: Paper.paperTone('white').paper };
  });
  ok(cross.line === cross.crossing && cross.line !== cross.full && cross.line !== cross.paper, `a grid fading out at zoom 0.2 is one lighter color, crossings included (line ${cross.line}, crossing ${cross.crossing}, full ${cross.full})`);

  // ---------------------------------------------------------------- crisp at devicePixelRatio 2
  console.log('crisp at devicePixelRatio 2');
  const crisp = await page.evaluate(() => {
    const T = Paper.paperTone('white'), g = paint({ kind: 'grid', tone: 'white' }, { w: 200, h: 100, d: 2, z: 1, cx: 0, cy: 0 }).ctx;
    const p = paint({ kind: 'plane', tone: 'white' }, { w: 200, h: 200, d: 2, z: 1, cx: -100, cy: -100 }).ctx;
    const row = (ctx, xs, y) => xs.map(x => hex(ctx.getImageData(x, y, 1, 1).data, 0));
    return { T, grid: row(g, [77, 78, 79, 80, 81, 82], 50), plane: row(p, [196, 197, 198, 199, 200, 201, 202, 203], 300), two: row(paint({ kind: 'graph', tone: 'white' }, { w: 200, h: 100, d: 2, z: 1, cx: 0, cy: 0 }).ctx, [196, 197, 198, 199, 200, 201, 202], 30) };
  });
  {
    const { T } = crisp, P = T.paper, eq = (a, b) => a.every((x, i) => x === b[i]);
    ok(eq(crisp.grid, [P, P, T.line, T.line, P, P]), 'a 1 px grid line at x = 40 is exactly device columns 79–80, nothing bleeding (' + crisp.grid.join(' ') + ')');
    ok(eq(crisp.two, [P, P, P, T.major, T.major, T.major, P]), 'a 1.5 px major line at x = 100 is exactly 3 device px, 199–201 (' + crisp.two.join(' ') + ')');
    ok(eq(crisp.plane, [P, P, T.axis, T.axis, T.axis, T.axis, P, P]), 'the plane\'s 2 px axis is exactly 4 device px (' + crisp.plane.join(' ') + ')');
  }
  // the tablet's and a Chromebook's ratios: lines are still whole device px, every one the same width
  const frac = await page.evaluate(() => {
    const T = Paper.paperTone('white'), out = {};
    for (const d of [1.5, 2.25]) {
      const v = paint({ kind: 'graph', tone: 'white' }, { w: 300, h: 60, d, z: 1, cx: -7, cy: -11 }), w = v.c.width, y = Math.round(21 * d);   // world y = 10
      const row = v.ctx.getImageData(0, y, w, 1).data, runs = {};
      let n = 0, c = null;
      for (let x = 0; x < w; x++) { const h = hex(row, x * 4); if (h !== T.paper && h === c) n++; else { if (c && c !== T.paper) (runs[c] = runs[c] || []).push(n); n = 1; c = h; } }
      out[d] = { minor: [...new Set(runs[T.line] || [])], major: [...new Set(runs[T.major] || [])], other: Object.keys(runs).filter(k => k !== T.line && k !== T.major) };
    }
    return out;
  });
  ok(frac[1.5].minor.join() === '1' && frac[1.5].major.join() === '2' && frac[2.25].minor.join() === '2' && frac[2.25].major.join() === '3' && !frac[1.5].other.length && !frac[2.25].other.length,
    `at devicePixelRatio 1.5 and 2.25 graph lines are whole device px, all alike, no blended edges (1.5: minor ${frac[1.5].minor}, major ${frac[1.5].major}; 2.25: minor ${frac[2.25].minor}, major ${frac[2.25].major})`);

  // drawPaper leaves the context as it found it: transform, colors, alpha, compositing, font, alignment
  const kept = await page.evaluate(() => {
    const v = view(300, 200, 2, 1.5, -40, -30), ctx = v.ctx;
    ctx.fillStyle = '#123456'; ctx.strokeStyle = '#654321'; ctx.globalAlpha = 0.5; ctx.globalCompositeOperation = 'multiply'; ctx.font = '700 9px serif'; ctx.textAlign = 'end'; ctx.lineWidth = 7;
    const state = () => { const m = ctx.getTransform(); return JSON.stringify([m.a, m.b, m.c, m.d, m.e, m.f, ctx.fillStyle, ctx.strokeStyle, ctx.globalAlpha, ctx.globalCompositeOperation, ctx.font, ctx.textAlign, ctx.textBaseline, ctx.lineWidth]); };
    const before = state();
    for (const { kind } of Paper.PAPER_KINDS) Paper.drawPaper(ctx, { kind, tone: 'green' }, v.rect, 1.5, false);
    return before === state();
  });
  ok(kept, 'drawPaper leaves the context\'s transform, colors, alpha, compositing, font and alignment as they were');

  // ---------------------------------------------------------------- timing
  // ms a draw of the whole view takes: the calls alone, then with the raster (a 1 px read makes the canvas draw)
  const timing = (W, H, d, zooms) => page.evaluate((W, H, d, zooms) => {
    const res = [], c = document.createElement('canvas');
    c.width = W * d; c.height = H * d; document.body.appendChild(c);
    const ctx = c.getContext('2d');
    for (const { kind } of Paper.PAPER_KINDS) for (const z of zooms) {
      const cx = -W / 2 / z + 13, cy = -H / 2 / z + 7, rect = [cx, cy, cx + W / z, cy + H / z];
      const go = () => { ctx.setTransform(d * z, 0, 0, d * z, -cx * d * z, -cy * d * z); Paper.drawPaper(ctx, { kind, tone: 'theme' }, rect, z, false); };
      for (let i = 0; i < 5; i++) { go(); ctx.getImageData(0, 0, 1, 1); }
      const N = 30;
      let t0 = performance.now();
      for (let i = 0; i < N; i++) go();
      const js = (performance.now() - t0) / N;
      ctx.getImageData(0, 0, 1, 1);
      t0 = performance.now();
      for (let i = 0; i < N; i++) { go(); ctx.getImageData(0, 0, 1, 1); }
      res.push({ kind, z, js, full: (performance.now() - t0) / N });
    }
    c.remove();
    return res;
  }, W, H, d, zooms);
  const fmt = x => x.toFixed(2).padStart(5);
  const table = (times, zooms) => {
    console.log('         ' + 'kind'.padEnd(13) + zooms.map(z => ('zoom ' + z).padEnd(20)).join(''));
    for (const { kind } of api.kinds) console.log('         ' + kind.padEnd(13) + zooms.map(z => { const t = times.find(r => r.kind === kind && r.z === z); return `${fmt(t.js)} / ${fmt(t.full)} ms    `; }).join(''));
  };
  console.log('timing: a 1920 × 1080 view at devicePixelRatio 1, ms for the calls / with the raster (headless Chrome, software raster)');
  const Z = [1, 0.1, 0.3, 0.45, 4], times = await timing(1920, 1080, 1, Z);
  table(times, Z);
  const slow = list => list.slice().sort((a, b) => b.full - a.full).slice(0, 2).map(t => `${t.kind} at ${t.z}: ${t.full.toFixed(2)} ms`).join(', ');
  ok(times.filter(t => t.z === 1 || t.z === 0.1).every(t => t.full < 4), 'every kind draws a 1920 × 1080 view in under 4 ms at zoom 1 and 0.1, raster included (slowest ' + slow(times.filter(t => t.z === 1 || t.z === 0.1)) + ')');
  ok(times.every(t => t.full < 6), 'and no zoom in between takes 6 ms (slowest ' + slow(times) + ')');
  console.log('timing, for information: the same view on a 4K panel at devicePixelRatio 2 (3840 × 2160 device px)');
  const Z2 = [1, 0.1, 0.3], times2 = await timing(1920, 1080, 2, Z2);
  table(times2, Z2);

  // ---------------------------------------------------------------- thumbnails
  console.log('thumbnails');
  const thumbs = async () => page.evaluate(() => Paper.PAPER_KINDS.map(({ kind }) => {
    const c = Paper.paperThumb({ kind, tone: 'theme' }, false, 72, 48), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, p = Paper.paperTone('theme').paper;
    let marked = 0;
    for (let i = 0; i < d.length; i += 4) if (hex(d, i) !== p) marked++;
    return { kind, canvas: c instanceof HTMLCanvasElement, w: c.width, h: c.height, cw: c.style.width, ch: c.style.height, marked: marked / (c.width * c.height) };
  }));
  const t1 = await thumbs();
  ok(t1.every(t => t.canvas && t.w === 72 && t.h === 48 && t.cw === '72px' && t.ch === '48px'), 'paperThumb(spec, dark, 72, 48) at devicePixelRatio 1: a 72 × 48 canvas, 72 × 48 CSS px');
  ok(t1.every(t => t.kind === 'blank' ? t.marked === 0 : t.marked > 0.02 && t.marked < 0.5), 'each thumbnail shows its pattern (' + t1.map(t => `${t.kind} ${Math.round(t.marked * 100)}%`).join(', ') + ')');

  // ---------------------------------------------------------------- the contact sheet
  // every kind × tone at zoom 1 (and the plane at 0.3 and 3) with four lines of handwriting in the Board's pens on top,
  // drawn at device ratio d; and the picker's thumbnails at the page's devicePixelRatio
  const strokes = ['linear_002', 'frac_002', 'power_002', 'arith_003'].map(id => rows.find(r => r.id === id).strokes);
  const contact = d => page.evaluate((strokes, d) => {
    const tones = [['theme', false, 'Board'], ['theme', true, 'Board (dark theme)'], ['white', false, 'White'], ['cream', false, 'Cream'], ['green', false, 'Chalkboard'], ['black', false, 'Black']];
    const list = Paper.PAPER_KINDS.map(k => [k.kind, 1, k.label]).concat([['plane', 0.3, 'Coordinate plane, zoom 0.3'], ['plane', 3, 'Coordinate plane, zoom 3']]);
    // the Board's pens (src/pad.js PAD_COLORS) after the paper's own ink: red, blue, green, for light paper and dark
    const pens = [['#d1352b', '#ff7d6e'], ['#1f5fbf', '#7fb0ff'], ['#1d8a4b', '#6fd49c']];
    const TW = 300, TH = 210, G = 12, L = 136, TOP = 34;
    const S = document.createElement('canvas'); S.width = (L + tones.length * (TW + G)) * d; S.height = (TOP + list.length * (TH + G)) * d;
    const s = S.getContext('2d');
    s.scale(d, d); s.fillStyle = '#6d6d6d'; s.fillRect(0, 0, S.width, S.height);
    s.fillStyle = '#fff'; s.font = '600 15px "DM Sans", system-ui, sans-serif'; s.textBaseline = 'middle';
    tones.forEach((t, i) => s.fillText(t[2], L + i * (TW + G), TOP / 2));
    list.forEach(([kind, z, label], r) => {
      const y = TOP + r * (TH + G);
      s.fillStyle = '#fff'; s.font = '600 14px "DM Sans", system-ui, sans-serif';
      label.split(', ').forEach((part, i) => s.fillText(part, 12, y + 18 + i * 18));
      tones.forEach(([tone, dark], i) => {
        // where each kind shows what matters: the origin, the margin, a number line
        let cx = -36, cy = -28;
        if (kind === 'plane') { cx = (z === 3 ? -50 : -TW / 2) / z; cy = (z === 3 ? -150 : -TH / 2) / z; }
        else if (kind === 'numberlines') { cx = -TW / 2; cy = 0; }
        const v = paint({ kind, tone }, { w: TW, h: TH, d, z, cx, cy, dark }), T = Paper.paperTone(tone, dark), k = T.dark ? 1 : 0;
        v.ctx.setTransform(d, 0, 0, d, 0, 0);
        ink(v.ctx, strokes[0], [14, 12, 128, 54], T.ink, 3);
        ink(v.ctx, strokes[1], [170, 14, 110, 66], pens[0][k], 3);
        ink(v.ctx, strokes[2], [22, 122, 104, 58], pens[1][k], 3);
        ink(v.ctx, strokes[3], [160, 136, 124, 50], pens[2][k], 3);
        s.drawImage(v.c, L + i * (TW + G), y, TW, TH);
      });
    });
    const th = document.createElement('canvas'), tw = 72, tg = 10, r = devicePixelRatio;
    th.width = (150 + tones.length * (tw + tg)) * r; th.height = (20 + Paper.PAPER_KINDS.length * (48 + tg)) * r;
    const t = th.getContext('2d');
    t.scale(r, r); t.fillStyle = '#6d6d6d'; t.fillRect(0, 0, th.width, th.height); t.fillStyle = '#fff'; t.font = '600 12px "DM Sans", system-ui, sans-serif'; t.textBaseline = 'middle';
    Paper.PAPER_KINDS.forEach(({ kind, label }, i) => {
      t.fillText(label, 10, 20 + i * (48 + tg) + 24);
      tones.forEach(([tone, dark], j) => t.drawImage(Paper.paperThumb({ kind, tone }, dark, tw, 48), 150 + j * (tw + tg), 20 + i * (48 + tg), tw, 48));
    });
    return { sheet: S.toDataURL('image/png'), thumbs: th.toDataURL('image/png'), size: [S.width, S.height] };
  }, strokes, d);
  const save = (file, url) => { fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64')); return file; };
  const named = suffix => sheet.replace(/\.png$/, '') + suffix + '.png';
  console.log('contact sheet');
  let shots = await contact(1);
  save(sheet, shots.sheet);
  ok(fs.statSync(sheet).size > 50000, `contact sheet, devicePixelRatio 1: ${sheet} (${shots.size.join(' × ')}); thumbnails: ${save(named('_thumbs'), shots.thumbs)}`);

  // ---------------------------------------------------------------- devicePixelRatio 2
  console.log('devicePixelRatio 2');
  await load(2);
  const t2 = await thumbs();
  ok(t2.every(t => t.w === 144 && t.h === 96 && t.cw === '72px' && t.ch === '48px'), 'paperThumb at devicePixelRatio 2: a 144 × 96 canvas shown at 72 × 48 CSS px');
  ok(t2.every(t => t.kind === 'blank' ? t.marked === 0 : t.marked > 0.02 && t.marked < 0.5), 'and each shows its pattern');
  shots = await contact(2);
  note(`contact sheet at devicePixelRatio 2: ${save(named('@2x'), shots.sheet)}; thumbnails: ${save(named('_thumbs@2x'), shots.thumbs)}`);

  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
