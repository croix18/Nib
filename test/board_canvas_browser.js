// Nib Board as a canvas, in a real browser: the tools and their keys, pens, markers and highlighters in colours and
// sizes (and that Nib reads only the pen and marker), shapes (draw-and-hold too, number lines and planes with their
// own numbers), text, select and its bar, copy and paste across pages, the eraser that spares placed things, papers
// per page, zoom and pan, pictures (paste, drop, kept in IndexedDB), what is kept (v3) and older boards, Export (PDF
// sizes and pages, answer keys, plain white, pictures, the clipboard), the board file, the pages overview and the laser.
//   node test/board_canvas_browser.js [page=dist/Board.html]
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core'));
const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

const NibN = require(path.join(__dirname, '..', 'dist', 'nib.js'));
const { compose } = require('./compose.js');
const flat = t => t.replace(/\\begin\{gathered\}|\\end\{gathered\}|\s/g, '');
const findX = tex => { for (let k = 0; k < 40; k++) { const e = compose(tex); if (flat(new NibN.Recognizer().recognize(e.strokes, { times: false }).latex) === flat(tex)) return e; } return null; };

(async () => {
  const page_ = process.argv[2] || path.join(__dirname, '..', 'dist', 'Board.html');
  const url = 'file://' + path.resolve(page_);
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const errors = [];
  const open = async (w, h) => {
    const p = await browser.newPage();
    p.on('pageerror', e => errors.push(String(e)));
    p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|net::/.test(m.text())) errors.push(m.text()); });
    await p.setViewport({ width: w || 1280, height: h || 760 });
    await p.goto(url, { waitUntil: 'load' });
    return p;
  };
  let page = await open();
  await page.evaluate(() => { localStorage.clear(); return new Promise(r => { const q = indexedDB.deleteDatabase('nib-board'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await page.reload({ waitUntil: 'load' }); await wait(600);
  let cdp = await page.target().createCDPSession();
  const box = async () => (await page.$('#pad canvas')).boundingBox();
  // a mouse drag through points (canvas px)
  const drag = async (pts, steps = 6, hold = 0) => {
    const cb = await box();
    await page.mouse.move(cb.x + pts[0][0], cb.y + pts[0][1]); await page.mouse.down();
    for (let k = 1; k < pts.length; k++) await page.mouse.move(cb.x + pts[k][0], cb.y + pts[k][1], { steps });
    if (hold) await wait(hold);
    await page.mouse.up();
  };
  const tap = async (x, y) => { const cb = await box(); await page.mouse.click(cb.x + x, cb.y + y); };
  // writing an expression with the mouse into a region [x, y, w, h] of the canvas (fractions of its size)
  const write = async (r, reg) => {
    const cb = await box();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const k = Math.min(cb.width * reg[2] / (x1 - x0), cb.height * reg[3] / (y1 - y0));
    for (const s of r.strokes) {
      const P = s.map(p => [cb.x + cb.width * reg[0] + (p[0] - x0) * k, cb.y + cb.height * reg[1] + (p[1] - y0) * k]);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: P[0][0], y: P[0][1], button: 'left', clickCount: 1 });
      for (let i = 1; i < P.length; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: P[i][0], y: P[i][1], button: 'left' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P[P.length - 1][0], y: P[P.length - 1][1], button: 'left', clickCount: 1 });
    }
  };
  const read = () => page.waitForFunction(() => { const p = document.getElementById('pad').pad, ink = p.ink; return !p.anim && (!ink.length || (p.result && p.resultStrokes.length === ink.length && p.resultStrokes.every((s, i) => s === ink[i]))); }, { timeout: 30000 }).catch(() => {});
  const P = (f, ...a) => page.evaluate(f, ...a);
  const looks = () => P(() => { const p = document.getElementById('pad').pad; return p.strokes.map(s => Object.assign({ n: s.length }, p.lookOf(s) || {})); });
  const count = () => P(() => document.getElementById('pad').pad.strokes.length);
  const tool = t => page.click(`#toolbar [data-tool="${t}"]`);
  const hidden = id => page.$eval('#' + id, e => e.hidden);
  const esc = async () => { await page.keyboard.press('Escape'); await wait(80); };
  // a tool's colours and sizes open (the tool tapped, and tapped again when it was not in hand)
  // a tool taken up by its key (a second tap on the rail would open its colours instead)
  const use = async t => { await page.keyboard.press({ select: 'v', hand: 'h', pen: 'p', marker: 'm', highlighter: 'i', shape: 'r', text: 't', laser: 'l' }[t]); await wait(40); };
  const shapeKind = async k => { await tool('shape'); await wait(60); if (await hidden('shapepop')) { await tool('shape'); await wait(80); } await page.click(`#kinds [data-kind="${k}"]`); await wait(40); };
  const styleOf = async t => { await tool(t); await wait(60); if (await hidden('stylepop')) { await tool(t); await wait(80); } };
  const clear = async () => { await P(() => { const p = document.getElementById('pad'); p.clear(); p.pad.history = []; p.pad.future = []; p.pad.setCamera({ x: 0, y: 0, z: 1 }); }); await wait(100); };
  // what the page offered to download: {name, type, size, text (latin1)} (a download is an <a download> click here)
  const catchDownloads = () => P(() => { window.__dl = []; window.__aclick = window.__aclick || HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push({ name: this.download, href: this.href }); else window.__aclick.call(this); }; });
  const lastDownload = () => P(async () => {
    const d = window.__dl[window.__dl.length - 1]; if (!d) return null;
    const blob = await (await fetch(d.href)).blob(), u = new Uint8Array(await blob.arrayBuffer());
    let text = ''; for (let i = 0; i < u.length; i += 8192) text += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
    return { name: d.name, type: blob.type, size: u.length, text };
  });
  // the pictures inside a PDF: each JPEG decoded, with its size and a few pixels and colour counts
  const pdfPictures = () => P(async () => {
    const d = window.__dl[window.__dl.length - 1], u = new Uint8Array(await (await fetch(d.href)).arrayBuffer());
    let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
    const out = [], re = /\/Subtype \/Image \/Width (\d+) \/Height (\d+)[^>]*\/Length (\d+) >>\nstream\n/g;
    let m;
    while ((m = re.exec(s))) {
      const at = m.index + m[0].length, bytes = u.slice(at, at + +m[3]);
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
      const D = g.getImageData(0, 0, c.width, c.height).data; let gold = 0, dark = 0;
      for (let i = 0; i < D.length; i += 4) { if (D[i] > 120 && D[i + 1] > 85 && D[i + 2] < 95 && D[i] - D[i + 2] > 70) gold++; if (D[i] < 90 && D[i + 1] < 90 && D[i + 2] < 130) dark++; }
      out.push({ w: bmp.width, h: bmp.height, W: +m[1], H: +m[2], corner: Array.from(g.getImageData(2, 2, 1, 1).data), gold, dark });
    }
    return out;
  });
  const e1 = findX('3+4='), e2 = findX('12+30=');

  console.log('the tools on the rail, and their keys');
  {
    const rail = await P(() => document.getElementById('rail').getBoundingClientRect().height);
    ok(rail < 64, `the tools fit one row on a 1280 px board (${Math.round(rail)} px tall)`);
    const modes = {};
    for (const t of ['select', 'hand', 'pen', 'marker', 'highlighter', 'eraser', 'shape', 'text', 'laser']) {
      await tool(t); await wait(60);
      modes[t] = await P(() => { const p = document.getElementById('pad'); return p.mode + (p.mode === 'draw' ? ':' + p.tool.kind : ''); });
      if (t === 'eraser') { await tool('eraser'); await wait(60); }
    }
    ok(JSON.stringify(modes) === JSON.stringify({ select: 'select', hand: 'pan', pen: 'draw:pen', marker: 'draw:marker', highlighter: 'draw:highlighter', eraser: 'erase', shape: 'shape', text: 'text', laser: 'laser' }),
      'each tool sets what the board does: ' + JSON.stringify(modes));
    const keys = {};
    for (const [k, want] of [['v', 'select'], ['h', 'pan'], ['m', 'draw:marker'], ['i', 'draw:highlighter'], ['r', 'shape'], ['t', 'text'], ['l', 'laser'], ['p', 'draw:pen']]) {
      await page.keyboard.press(k); await wait(40);
      keys[k] = (await P(() => { const p = document.getElementById('pad'); return p.mode + (p.mode === 'draw' ? ':' + p.tool.kind : ''); })) === want;
    }
    ok(Object.values(keys).every(Boolean), 'and their keys: V H M I R T L P ' + JSON.stringify(keys));
    await page.keyboard.press('m'); await page.keyboard.press('e'); await wait(40);
    const er = await P(() => document.getElementById('pad').mode);
    await page.keyboard.press('e'); await wait(40);
    ok(er === 'erase' && await P(() => document.getElementById('pad').tool.kind) === 'marker' && await P(() => document.getElementById('pad').mode) === 'draw', 'E: the eraser, and E again goes back to the marker it was taken from');
    await tool('hand');
    ok(await page.$eval('#stylebtn', b => b.disabled), 'the colour button rests while the hand is in use');
    await tool('pen');
  }

  console.log('pens, markers and highlighters: colours and sizes');
  {
    await tool('pen'); await wait(50);
    ok(!(await hidden('stylepop')), 'the pen tapped again opens its colours and sizes');
    const sw = await P(() => [...document.querySelectorAll('#swatches .sw')].map(b => b.dataset.c || 'custom'));
    ok(sw.length === 12 && sw[0] === '@ink' && sw.includes('@red') && sw[11] === 'custom', `12 colours, the ink first and any colour last (${sw.join(' ')})`);
    await page.click('#swatches [data-c="@blue"]'); await wait(80);
    ok(await hidden('stylepop') && (await P(() => document.getElementById('pad').tool.color)) === '@blue', 'a colour picked: the pen writes in it, and the popover closes');
    const tint = await P(() => getComputedStyle(document.querySelector('[data-tool="pen"] .ink')).backgroundColor);
    ok(tint === 'rgb(31, 95, 191)', 'the pen\'s colour shows under it: ' + tint);
    await styleOf('pen');
    await page.click('#sizes [data-v="5"]'); await wait(50); await esc();
    ok(await P(() => document.getElementById('pad').tool.size) === 5, 'size 5');
    await drag([[100, 120], [180, 160], [240, 120]]);
    let L = await looks();
    ok(L.length === 1 && L[0].color === '@blue' && L[0].size === 5 && !L[0].tool, 'a pen stroke keeps its colour and size: ' + JSON.stringify(L[0]));
    await use('marker'); await drag([[100, 220], [300, 230]]);
    await use('highlighter'); await drag([[90, 120], [300, 125]]);
    L = await looks();
    ok(L[1].tool === 'marker' && L[1].color === '@red' && L[1].size === 12 && L[2].tool === 'highlighter' && L[2].color === '@hl-yellow' && L[2].size === 24,
      'the marker is red and 12 wide, the highlighter yellow and 24 wide: ' + JSON.stringify([L[1], L[2]].map(e => [e.tool, e.color, e.size])));
    // any colour: the browser's picker
    await styleOf('pen');
    await P(() => { const i = document.querySelector('#swatches .custom input'); i.value = '#123456'; i.dispatchEvent(new Event('change')); });
    await wait(50);
    ok(await P(() => document.getElementById('pad').tool.color) === '#123456', 'another colour from the picker: #123456');
    await styleOf('pen'); await page.click('#swatches [data-c="@ink"]'); await wait(50);
    await styleOf('pen'); await page.click('#sizes [data-v="3.5"]'); await esc();
    // [ and ]: the next size
    await page.keyboard.press(']'); await wait(40);
    const up = await P(() => document.getElementById('pad').tool.size);
    await page.keyboard.press('['); await wait(40);
    ok(up === 5 && await P(() => document.getElementById('pad').tool.size) === 3.5, '] and [ step the pen\'s size (3.5 → 5 → 3.5)');
    await clear();
  }

  console.log('what Nib reads: the pen and the marker, not the highlighter or the rest');
  if (e1) {
    await use('marker');
    await write(e1, [0.1, 0.3, 0.25, 0.12]); await wait(600); await read();
    const L1 = await P(() => document.getElementById('pad').latex);
    ok(L1 === '3+4=', 'writing with the marker is read: ' + L1);
    await use('highlighter'); await drag([[100, 250], [500, 260]]);
    await tool('shape'); await drag([[600, 200], [760, 300]]);
    await wait(800); await read();
    ok(await P(() => document.getElementById('pad').latex) === L1, 'a highlighter over it and a box beside it leave the reading as it was');
    await clear(); await use('pen');
  } else ok(false, 'a writer for 3 + 4 =');

  console.log('shapes');
  {
    await tool('shape'); await wait(40);
    if (await hidden('shapepop')) { await tool('shape'); await wait(80); }
    const kinds = await P(() => [...document.querySelectorAll('#kinds .kb')].map(b => b.dataset.kind));
    ok(kinds.length === 11 && kinds.includes('numberline') && kinds.includes('plane'), 'the shapes: ' + kinds.join(' '));
    await page.click('#kinds [data-kind="ellipse"]'); await wait(50);
    ok(await page.$eval('#shapeicon', u => u.getAttribute('href')) === '#s-ellipse' && await P(() => document.getElementById('pad').shapeTool.kind) === 'ellipse', 'the shape picked shows on the rail');
    // its look: colour, fill, dashes
    await page.click('#stylebtn'); await wait(60);
    await page.click('#swatches [data-c="@green"]'); await wait(40);
    await page.click('#stylebtn'); await wait(60);
    await page.click('#fillrow [data-v="tint"]'); await page.click('#dashrow [data-v="dashed"]'); await esc();
    await drag([[100, 100], [300, 220]]);
    let L = await looks();
    ok(L.length === 1 && L[0].tool === 'shape' && L[0].shape === 'ellipse' && L[0].color === '@green' && L[0].fill === 'tint' && L[0].dash === true, 'dragged: a green, lightly filled, dashed ellipse ' + JSON.stringify(L[0]));
    // a tap: one of a standard size
    await shapeKind('rect');
    await tap(500, 160); await wait(80);
    L = await looks();
    const r = await P(() => { const p = document.getElementById('pad').pad, s = p.strokes[1]; return [Math.abs(s[1][0] - s[0][0]), Math.abs(s[1][1] - s[0][1])]; });
    ok(L[1] && L[1].shape === 'rect' && r[0] > 100 && r[1] > 60, `a tap with the shape tool: a box of a standard size (${r.map(Math.round).join(' × ')})`);
    // a number line, and its numbers changed
    await shapeKind('numberline');
    await drag([[100, 330], [600, 330]]); await wait(150);
    const nt = await page.$eval('#notetext', e => e.textContent);
    ok(/A number line from −10 to 10\./.test(nt) && !(await hidden('noteact')), 'a number line drawn: the note says its numbers and offers to change them: ' + nt);
    await page.click('#noteact'); await wait(120);
    ok(!(await hidden('axispop')) && await P(() => document.querySelectorAll('#axisfields input').length) === 3, 'its numbers: from, to, every');
    const fill = async vals => { await P(v => { const I = document.querySelectorAll('#axisfields input'); v.forEach((x, i) => { I[i].value = x; }); }, vals); };
    await fill(['0', 'abc', '1/4']); await page.click('#axisok'); await wait(80);
    ok(!(await hidden('axispop')) && /"abc" is not a number/.test(await page.$eval('#notetext', e => e.textContent)), 'something that is not a number is refused, and said');
    await fill(['0', '2', '1/4']); await page.click('#axisfrac'); await page.click('#axisok'); await wait(100);
    L = await looks();
    const nl = L.find(e => e.shape === 'numberline');
    ok(await hidden('axispop') && nl && nl.opt.min === 0 && nl.opt.max === 2 && nl.opt.step === 0.25 && nl.opt.frac === true, 'from 0 to 2 every ¼, as fractions: ' + JSON.stringify(nl && nl.opt));
    await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control'); await wait(80);
    ok((await looks()).find(e => e.shape === 'numberline').opt.max === 10, 'Undo takes the change back');
    // a plane, by its own kind
    await shapeKind('plane');
    await drag([[750, 120], [1000, 370]]); await wait(100);
    ok((await looks()).some(e => e.shape === 'plane' && e.opt && e.opt.xmin === -10), 'a coordinate plane, −10 to 10 both ways');
    await page.screenshot({ path: path.join(out, 'board-canvas-shapes.png') });
    await clear();
    // draw and hold: a circle drawn with the pen and held still becomes a circle
    await use('pen');
    const C = [], cx = 300, cy = 300;
    for (let a = 0; a <= 360; a += 15) C.push([cx + 80 * Math.cos(a * Math.PI / 180), cy + 80 * Math.sin(a * Math.PI / 180)]);
    await drag(C, 3, 900);
    L = await looks();
    ok(L.length === 1 && L[0].tool === 'shape' && L[0].shape === 'ellipse', 'a circle drawn with the pen and held still for a moment becomes a clean one: ' + JSON.stringify(L[0] && [L[0].tool, L[0].shape]));
    await clear();
    // shapes snap to the paper's grid (dots: every 28)
    await shapeKind('rect');
    await drag([[103, 101], [251, 197]]);
    const sn = await P(() => document.getElementById('pad').pad.strokes[0].flat());
    ok(sn.every(v => Math.abs(v / 28 - Math.round(v / 28)) < 1e-6), 'on dotted paper a box snaps to the dots (every 28): ' + sn.map(Math.round).join(','));
    await clear(); await use('pen');
  }

  console.log('text');
  {
    await use('text'); await tap(200, 200); await wait(150);
    ok(await P(() => !!document.querySelector('#pad textarea')), 'a tap with the text tool opens a text box');
    await page.keyboard.type('Homework: page 12'); await esc(); await wait(100);
    const L = await looks();
    ok(L.length === 1 && L[0].tool === 'text' && L[0].text === 'Homework: page 12', 'Escape keeps it: ' + JSON.stringify(L[0] && L[0].text));
    await use('select'); await tap(230, 215); await wait(150);
    ok(!(await hidden('selbar')) && !(await hidden('seledit')), 'tapped with Select: the bar offers to change the text');
    await page.click('#seledit'); await wait(150);
    ok(await P(() => { const t = document.querySelector('#pad textarea'); return !!t && t.value === 'Homework: page 12'; }), 'and opens it again to change');
    await esc(); await clear(); await use('pen');
  }

  console.log('select, its bar, copy and paste');
  {
    await use('pen');
    await drag([[100, 150], [200, 200]]); await drag([[100, 250], [200, 300]]);
    await shapeKind('rect'); await drag([[300, 150], [420, 260]]);
    await use('select'); await drag([[60, 100], [460, 340]], 4); await wait(150);
    const sel = await P(() => document.getElementById('pad').pad.selected.length);
    const bar = await P(() => { const b = document.getElementById('selbar').getBoundingClientRect(), c = document.querySelector('#pad canvas').getBoundingClientRect(); return { top: b.top - c.top, bottom: b.bottom - c.top, hidden: document.getElementById('selbar').hidden }; });
    ok(sel === 3 && !bar.hidden && bar.bottom <= 150, `a box around three things selects them, and the bar sits above them (${JSON.stringify(bar)})`);
    await page.click('#selcolor'); await wait(80);
    ok(!(await hidden('stylepop')) && await page.$eval('#styletitle', e => e.textContent) === '3 things', 'its colour button opens the colours for what is selected');
    await page.click('#swatches [data-c="@purple"]'); await wait(80);
    ok((await looks()).every(e => e.color === '@purple'), 'all three turn purple');
    await page.click('#seldup'); await wait(80);
    ok(await count() === 6 && await P(() => document.getElementById('pad').pad.selected.length) === 3, 'Duplicate: three more, selected');
    await page.keyboard.press('Delete'); await wait(80);
    ok(await count() === 3, 'Delete takes them away');
    // nudge with the arrows
    await P(() => document.getElementById('pad').pad.selectAll()); await wait(50);
    const x0 = await P(() => document.getElementById('pad').pad.strokes[0][0][0]);
    await page.keyboard.press('ArrowRight'); await page.keyboard.down('Shift'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift');
    ok(Math.abs(await P(() => document.getElementById('pad').pad.strokes[0][0][0]) - x0 - 11) < 1e-6, 'the arrow keys nudge what is selected (1 px, 10 with Shift)');
    // Ctrl+C here, Ctrl+V on another page
    await P(() => { window.__clipText = null; navigator.clipboard.writeText = t => { window.__clipText = t; return Promise.resolve(); }; });
    await page.keyboard.down('Control'); await page.keyboard.press('KeyC'); await page.keyboard.up('Control'); await wait(50);
    const mark = await P(() => window.__clipText);
    ok(/^Nib Board: 3 things copied/.test(mark || ''), 'Ctrl+C copies them (the clipboard gets a mark: ' + mark + ')');
    await page.click('#newpage'); await wait(250);
    await P(m => { const dt = new DataTransfer(); dt.setData('text/plain', m); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, mark);
    await wait(150);
    ok(await count() === 3 && (await looks()).every(e => e.color === '@purple') && await P(() => document.getElementById('pad').mode) === 'select', 'Ctrl+V on page 2 puts them there, selected');
    // text from elsewhere becomes a text box
    await P(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'Exit ticket'); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await wait(150);
    ok((await looks()).some(e => e.tool === 'text' && e.text === 'Exit ticket'), 'text pasted from elsewhere becomes a text box');
    await page.click('#gear'); await wait(100); await page.click('#delpage'); await page.click('#delyes'); await wait(300);
    await clear(); await use('pen');
  }

  console.log('the eraser takes what was drawn and spares what was placed');
  {
    // a text box, a plane and a picture, with pen strokes across them
    await P(() => { const p = document.getElementById('pad').pad;
      p.addElement([[100, 100], [400, 160]], { tool: 'text', text: 'Plot these points', size: 40 });
      p.addElement([[500, 100], [800, 400]], { tool: 'shape', shape: 'plane', opt: { xmin: -5, xmax: 5, ymin: -5, ymax: 5, step: 1, labels: true, grid: true }, size: 3 });
      p.addElement([[120, 300], [320, 300]], { tool: 'shape', shape: 'line', size: 3 }); });
    const pic = await P(() => { const c = document.createElement('canvas'); c.width = 80; c.height = 60; const g = c.getContext('2d'); g.fillStyle = '#2050c0'; g.fillRect(0, 0, 80, 60); return c.toDataURL('image/png'); });
    await P(src => document.getElementById('pad').addImage(src, { at: [250, 450] }), pic); await wait(200);
    await use('pen');
    await drag([[90, 130], [850, 130]]); await drag([[200, 450], [300, 450]]); await drag([[650, 200], [650, 300]]);
    const n0 = await count();
    await tool('eraser');
    await drag([[90, 130], [850, 130]], 30); await drag([[180, 450], [320, 450]], 20); await drag([[650, 190], [650, 310]], 20); await drag([[220, 300], [220, 300.5]], 2);
    const kinds = (await looks()).map(e => e.tool === 'shape' ? e.shape : e.tool || 'pen');
    ok(n0 === 7 && JSON.stringify(kinds.sort()) === JSON.stringify(['image', 'plane', 'text']), `the eraser takes the pen strokes and the line, and leaves the text, the plane and the picture (left: ${kinds.join(', ')})`);
    // only where it rubs
    await clear();
    await use('pen'); await drag([[100, 400], [500, 400]], 20);
    await tool('eraser'); await page.click('#stylebtn'); await wait(80);
    ok(!(await hidden('stylepop')) && !(await hidden('eraserrow')), 'with the eraser, the colour button asks what it takes');
    await page.click('#eraserrow [data-v="area"]'); await esc();
    await drag([[300, 380], [300, 420]], 10);
    ok(await count() === 2 && await P(() => document.getElementById('pad').getAttribute('eraser')) === 'area', 'set to "only where it rubs", it cuts a stroke in two');
    await page.click('#stylebtn'); await page.click('#eraserrow [data-v="stroke"]'); await esc();
    await tool('eraser'); await clear();
  }

  console.log('paper');
  {
    await page.click('#paperbtn'); await wait(250);
    const th = await P(() => [...document.querySelectorAll('#papers .pb')].map(b => [b.dataset.kind, !!b.querySelector('canvas')]));
    ok(th.length === 8 && th.every(t => t[1]), 'eight papers, each with a picture of it: ' + th.map(t => t[0]).join(' '));
    const tones = await P(() => [...document.querySelectorAll('#tones button')].map(b => b.dataset.v));
    ok(JSON.stringify(tones) === JSON.stringify(['theme', 'white', 'cream', 'green', 'black']), 'and five colours: ' + tones.join(' '));
    await page.click('#papers [data-kind="lined"]'); await wait(80); await page.click('#tones [data-v="green"]'); await wait(120);
    const a = await P(() => ({ paper: document.getElementById('pad').getAttribute('paper'), snap: document.getElementById('pad').getAttribute('snap') }));
    ok(a.paper === 'lined green' && a.snap === '40', 'lined chalkboard: the board draws it, and shapes snap to its rules (40): ' + JSON.stringify(a));
    await esc();
    const px = await P(() => { const c = document.querySelector('#pad canvas'), d = window.devicePixelRatio || 1; return Array.from(c.getContext('2d').getImageData(Math.round(300 * d), Math.round(219 * d), 1, 1).data); });
    ok(px.join() === '31,61,47,255', 'the board is chalkboard green between the rules: ' + px.join());
    await styleOf('pen');
    const red = await P(() => getComputedStyle(document.querySelector('#swatches [data-c="@red"]')).getPropertyValue('--c').trim());
    ok(red === '#ff7d6e', 'on the chalkboard the red is the lighter one that reads on it: ' + red);
    await esc();
    await page.click('#newpage'); await wait(200);
    ok(await P(() => document.getElementById('pad').getAttribute('paper')) === 'lined green', 'a new page takes the paper last chosen');
    await page.click('#paperbtn'); await wait(150); await page.click('#papers [data-kind="graph"]'); await page.click('#tones [data-v="white"]'); await esc();
    await page.click('#prev'); await wait(200);
    ok(await P(() => document.getElementById('pad').getAttribute('paper')) === 'lined green', 'each page keeps its own (page 1: lined chalkboard)');
    await page.click('#next'); await wait(200);
    ok(await P(() => document.getElementById('pad').getAttribute('paper')) === 'graph white', '(page 2: graph paper, white)');
    await page.click('#gear'); await wait(100); await page.click('#snapsw'); await wait(50);
    ok(await P(() => !document.getElementById('pad').hasAttribute('snap')), 'Settings: shapes stop snapping when asked');
    await page.click('#snapsw'); await page.click('#delpage'); await page.click('#delyes'); await wait(300);
    await page.click('#paperbtn'); await wait(150); await page.click('#papers [data-kind="dots"]'); await page.click('#tones [data-v="theme"]'); await esc();
  }

  console.log('zoom and pan');
  {
    const z = () => P(() => document.getElementById('pad').pad.cam.z), label = () => page.$eval('#zpct', e => e.textContent);
    await page.click('#zin'); await wait(150);
    ok(Math.abs(await z() - 1.1) < 1e-9 && await label() === '110%', '+ zooms in a step (110%)');
    await page.click('#zout'); await page.click('#zout'); await wait(150);
    ok(Math.abs(await z() - 0.9) < 1e-9 && await label() === '90%', '− zooms out (90%)');
    await page.click('#zpct'); await wait(150);
    ok(await z() === 1 && await label() === '100%', 'the percentage goes back to 100%');
    const cb = await box();
    await page.mouse.move(cb.x + 400, cb.y + 300);
    await page.keyboard.down('Control'); await page.mouse.wheel({ deltaY: -200 }); await page.keyboard.up('Control'); await wait(250);
    ok(await z() > 1.3 && /^\d+%$/.test(await label()) && await label() !== '100%', `Ctrl + wheel (a trackpad pinch) zooms about the pointer (${await label()})`);
    await page.keyboard.down('Control'); await page.keyboard.press('Digit0'); await page.keyboard.up('Control'); await wait(100);
    ok(await z() === 1, 'Ctrl+0: 100%');
    // pan: space + drag, the hand, the arrow keys
    const cam = () => P(() => { const c = document.getElementById('pad').pad.cam; return [Math.round(c.x), Math.round(c.y)]; });
    const c0 = await cam();
    await page.keyboard.down('Space'); await drag([[400, 300], [300, 250]]); await page.keyboard.up('Space');
    const c1 = await cam();
    ok(c1[0] - c0[0] === 100 && c1[1] - c0[1] === 50 && await count() === 0, 'space + drag moves the board and writes nothing (' + c1.join(',') + ')');
    await use('hand'); await drag([[300, 250], [400, 300]]);
    ok(JSON.stringify(await cam()) === JSON.stringify(c0), 'the hand moves it back');
    await use('pen'); await page.keyboard.press('ArrowRight'); await wait(50);
    ok((await cam())[0] - c0[0] === 40, 'an arrow key with nothing selected moves the board');
    await page.keyboard.press('ArrowLeft');
    // two fingers together: pinch and pan, nothing written
    const T = (a, b) => [{ x: cb.x + a[0], y: cb.y + a[1], id: 1 }, { x: cb.x + b[0], y: cb.y + b[1], id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: T([500, 300], [600, 300]) });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: T([500 - 10 * i, 300], [600 + 10 * i, 300]) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(250);
    ok(await z() > 1.5 && await count() === 0, `two fingers spread apart zoom in (${Math.round(await z() * 100)}%) and write nothing`);
    // everything in view
    await use('pen'); await drag([[100, 100], [200, 150]]);
    await P(() => document.getElementById('pad').pad.setCamera({ x: 3000, y: 2000, z: 1 })); await wait(100);
    await page.click('#zfit'); await wait(150);
    const fit = await P(() => { const p = document.getElementById('pad').pad, b = p.contentRect(0), v = p.viewRect; return b[0] >= v[0] && b[2] <= v[2] && b[1] >= v[1] && b[3] <= v[3] && p.cam.z === 1; });
    ok(fit, 'Show everything brings the writing back into view (at 100%, not closer)');
    await clear();
  }

  console.log('pictures: paste, drop, kept');
  {
    const png = await P(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 150; const g = c.getContext('2d'); g.fillStyle = '#2050c0'; g.fillRect(0, 0, 200, 150); g.fillStyle = '#e02020'; g.fillRect(50, 40, 100, 70); return c.toDataURL('image/png'); });
    await P(src => fetch(src).then(r => r.blob()).then(b => { const dt = new DataTransfer(); dt.items.add(new File([b], 'shot.png', { type: 'image/png' })); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }), png);
    await page.waitForFunction(() => document.getElementById('pad').pad.strokes.length === 1, { timeout: 5000 }).catch(() => {});
    await wait(300);
    const L = await looks();
    ok(L.length === 1 && L[0].tool === 'image' && L[0].img && await P(() => document.getElementById('pad').mode) === 'select', 'a picture pasted goes on the board, selected, to move or size');
    const ids = await P(() => Nib.canvas.images.ids());
    ok(ids.includes(L[0].img), 'and is kept in this browser (IndexedDB) by its id');
    // dropped where it lands
    const cb = await box();
    await P(([src, x, y]) => fetch(src).then(r => r.blob()).then(b => { const dt = new DataTransfer(); dt.items.add(new File([b], 'drop.png', { type: 'image/png' }));
      document.getElementById('surface').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true })); }), [png, cb.x + 900, cb.y + 450]);
    await page.waitForFunction(() => document.getElementById('pad').pad.strokes.length === 2, { timeout: 5000 }).catch(() => {});
    const at = await P(() => { const s = document.getElementById('pad').pad.strokes[1]; return [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2]; });
    ok(Math.abs(at[0] - 900) < 1 && Math.abs(at[1] - 450) < 1, 'a picture dropped on the board is centred where it was dropped');
    await P(() => document.getElementById('pad').pad.clearSelection());
    await wait(900);
    await page.reload({ waitUntil: 'load' }); await wait(1200);
    cdp = await page.target().createCDPSession();
    const px = await P(() => { const p = document.getElementById('pad').pad, s = p.strokes[0], c = p.canvas, d = p.dpr; const q = p.toScreen([(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2]); return Array.from(c.getContext('2d').getImageData(Math.round(q[0] * d), Math.round(q[1] * d), 1, 1).data); });
    ok(px[0] > 200 && px[1] < 60 && px[2] < 60, 'after a reload the picture is back on the board (its red middle: ' + px.join() + ')');
    // a picture from two days ago that no page uses, and today's two taken off the page
    const oldId = await P(src => { const id = 'img-' + (Date.now() - 2 * 864e5).toString(36) + '-old'; return Nib.canvas.images.put(id, src).then(() => id); }, png);
    await clear(); await wait(900);
    await page.reload({ waitUntil: 'load' }); await wait(5000);
    cdp = await page.target().createCDPSession();
    const left = await P(() => Nib.canvas.images.ids());
    ok(!left.includes(oldId) && left.length === 2, `a picture no page uses is let go when the board opens; today's are kept a day, in case another tab of the Board has them (${left.length} left)`);
  }

  console.log('what is kept: compact, and older boards');
  if (e1) {
    await use('pen'); await write(e1, [0.1, 0.2, 0.25, 0.12]);
    await shapeKind('arrow'); await drag([[500, 300], [700, 300]]);
    await use('pen'); await wait(900);
    const st = await P(() => { const s = JSON.parse(localStorage.getItem('nib-board-v1')), p = s.pages[s.page]; return { v: s.v, pk: p.pk, meta: p.meta, paper: p.paper, cam: p.cam, len: localStorage.getItem('nib-board-v1').length, pts: document.getElementById('pad').pad.strokes.reduce((n, s) => n + s.length, 0) }; });
    ok(st.v === 3 && Array.isArray(st.pk) && st.pk.every(x => typeof x === 'string' && /^[AB]/.test(x)) && st.paper && st.paper.kind === 'dots' && st.cam && st.cam.z === 1,
      'kept as version 3: each element\'s points packed in a short string, the page\'s paper and view');
    ok(st.meta && st.meta[st.meta.length - 1] && st.meta[st.meta.length - 1].sh === 'arrow', 'with each element\'s look (the arrow: ' + JSON.stringify(st.meta && st.meta[st.meta.length - 1]) + ')');
    const before = await P(() => document.getElementById('pad').latex);
    await page.reload({ waitUntil: 'load' }); await wait(800); await read();
    cdp = await page.target().createCDPSession();
    const L = await looks();
    ok(await P(() => document.getElementById('pad').latex) === before && L[L.length - 1].shape === 'arrow', 'after a reload: the same writing, read the same, and the arrow');
    // a board kept before 1.6 (version 2, strokes as arrays, the thick pen)
    const pts = await P(() => document.getElementById('pad').getState().strokes);
    await wait(900);                                       // the board's own save after its reading, out of the way
    await P(s => localStorage.setItem('nib-board-v1', JSON.stringify({ v: 2, view: 'ink', solve: true, pen: 'thick', page: 0, pages: [{ strokes: s, fixes: [], revealed: [] }] })), pts.slice(0, -1));
    await page.reload({ waitUntil: 'load' }); await wait(800); await read();
    cdp = await page.target().createCDPSession();
    const L2 = await looks();
    const L2x = await P(() => document.getElementById('pad').latex), t2 = await P(() => document.getElementById('pad').tool.size);
    ok(L2.length === pts.length - 1 && L2.every(e => e.size === 5) && L2x === before && t2 === 5,
      'a board kept by an older Board opens as it was: its strokes as thick as they were written (5), the pen still thick ' + JSON.stringify({ n: L2.length, of: pts.length - 1, sizes: [...new Set(L2.map(e => e.size))], latex: L2x, before, pen: t2 }));
    await clear(); await wait(700);
  }

  console.log('export');
  await catchDownloads();
  {
    // page 1: something written, solved; page 2: a little; page 3: nothing
    if (e2) { await use('pen'); await write(e2, [0.1, 0.3, 0.3, 0.14]); await wait(800); await read(); }
    const exp = async (o, go) => {
      if (await hidden('exportpop')) { await page.click('#exportbtn'); await wait(120); }
      for (const [k, v] of Object.entries(o)) { await page.click(`#exportpop [data-set="${k}"] [data-v="${v}"]`); await wait(30); }
      if (go !== false) { await page.click('#exportgo'); await page.waitForFunction(n => window.__dl.length > n, { timeout: 30000 }, await P(() => window.__dl.length)).catch(() => {}); await wait(150); }
    };
    await exp({ what: 'page', as: 'pdf', psize: 'letter', ans: 'shown', xpaper: 'on' });
    let d = await lastDownload();
    ok(d && /^Nib-board-1-\d{4}-\d{2}-\d{2}\.pdf$/.test(d.name) && d.type === 'application/pdf' && d.text.startsWith('%PDF-1.4'), 'Export, This page, PDF: a PDF named Nib-board-1-<date>.pdf: ' + (d && d.name));
    ok(d && /\/MediaBox \[0 0 792 612\]/.test(d.text) && /\/Count 1 /.test(d.text) && /\/Title \(Nib Board \d{4}-\d{2}-\d{2}\)/.test(d.text), 'one Letter page, turned to suit the writing (landscape), titled');
    let pics = await pdfPictures();
    ok(pics.length === 1 && pics[0].w === pics[0].W && pics[0].w >= 1900 && pics[0].dark > 300 && pics[0].gold === 0, `its picture: ${pics[0] && pics[0].w} × ${pics[0] && pics[0].h} px (about 200 dpi), the writing in it, no answer shown (they wait behind their chips)`);
    await exp({ ans: 'all' });
    pics = await pdfPictures();
    ok(pics[0] && pics[0].gold > 150, `Answers: All (a key) writes every answer in (${pics[0] && pics[0].gold} gold pixels)`);
    await exp({ psize: 'a4', ans: 'none' });
    d = await lastDownload();
    ok(d && /\/MediaBox \[0 0 841\.89 595\.28\]/.test(d.text), 'A4 (landscape)');
    await exp({ psize: 'fit', xpaper: 'white' });
    d = await lastDownload(); pics = await pdfPictures();
    const mb = d && /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(d.text);
    ok(mb && +mb[1] < 792 && +mb[2] < 400 && pics[0].corner.slice(0, 3).every(v => v >= 250), `The writing's size: a page just around it (${mb && mb[1]} × ${mb && mb[2]} pt), on plain white`);
    // three pages, all of them
    await page.keyboard.press('Escape');
    await page.click('#newpage'); await wait(200); await use('pen'); await drag([[200, 200], [400, 260]]);
    await page.click('#newpage'); await wait(200);
    await exp({ what: 'all', psize: 'letter', xpaper: 'on' });
    d = await lastDownload(); pics = await pdfPictures();
    ok(d && /\/Count 3 /.test(d.text) && pics.length === 3 && /^Nib-board-\d{4}-\d{2}-\d{2}\.pdf$/.test(d.name), `All pages: one PDF of 3 pages (${d && d.name})`);
    // a picture
    await exp({ as: 'png' }, false);
    ok(await page.$eval('#exportpop [data-set="what"] [data-v="all"]', b => b.disabled) && await page.$eval('#exportpop [data-set="what"] [data-v="page"]', b => b.getAttribute('aria-checked')) === 'true' && await hidden('sizerowx'),
      'as a picture: one page at a time, and no paper size to choose');
    await page.click('#exportgo'); await wait(1200);
    d = await lastDownload();
    ok(d && d.type === 'image/png' && /^Nib-board-3-/.test(d.name), 'Picture: a PNG of the page on the board: ' + (d && d.name));
    await page.keyboard.press('Escape');
    await page.click('#prev'); await wait(300);
    // what is selected
    await use('select'); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await wait(100);
    await exp({ what: 'sel', as: 'png' });
    d = await lastDownload();
    const dim = await P(async () => { const d = window.__dl[window.__dl.length - 1], b = await createImageBitmap(await (await fetch(d.href)).blob()); return [b.width, b.height]; });
    ok(d && /^Nib-selection-/.test(d.name) && dim[0] < 900, `What is selected: just that, as a picture (${dim.join(' × ')})`);
    // copy the picture
    await P(() => { window.__wrote = null; navigator.clipboard.write = items => { window.__wrote = items.map(i => i.types.join()).join(); return Promise.resolve(); }; });
    await exp({ what: 'page', as: 'clip' }, false);
    await page.click('#exportgo'); await wait(1200);
    ok(await P(() => window.__wrote) === 'image/png' && /Picture copied/.test(await page.$eval('#notetext', e => e.textContent)), 'Copy picture puts a PNG on the clipboard, to paste into a post');
    await exp({ as: 'pdf', what: 'page' }, false); await page.keyboard.press('Escape');
    await use('pen');
  }

  console.log('the whole board as a file');
  {
    const n = await P(() => document.querySelectorAll('#pagegrid .pg').length);
    const pagesBefore = await page.$eval('#pageno', e => e.textContent);
    await page.click('#exportbtn'); await wait(120); await page.click('#boardsave'); await wait(600);
    const d = await lastDownload();
    const file = d && JSON.parse(d.text);
    ok(file && /^Nib-board-\d{4}-\d{2}-\d{2}\.nibboard$/.test(d.name) && file.format === 'nib-board' && file.version === 3 && file.pages.length === 3, `Save the board: ${d && d.name}, its ${file && file.pages.length} pages`);
    const fp = path.join(out, 'test-board.nibboard'); fs.writeFileSync(fp, d.text, 'latin1');
    // on another computer: a fresh browser profile
    const ctx = await browser.createBrowserContext();
    const p2 = await ctx.newPage(); p2.on('pageerror', e => errors.push(String(e)));
    await p2.setViewport({ width: 1280, height: 760 }); await p2.goto(url, { waitUntil: 'load' }); await wait(700);
    await p2.click('#exportbtn'); await wait(120);
    const [fc] = await Promise.all([p2.waitForFileChooser(), p2.click('#boardopen')]);
    await fc.accept([fp]); await wait(900);
    const got = await p2.evaluate(() => ({ pageno: document.getElementById('pageno').textContent, latex: document.getElementById('pad').latex, n: document.getElementById('pad').pad.strokes.length }));
    ok(got.pageno === '1 / 3' && got.n > 0, `opened on an empty board it is the board: ${got.pageno}, ${got.n} strokes on page 1`);
    // opened again, onto a board with writing: it asks
    await p2.click('#exportbtn'); await wait(120);
    const [fc2] = await Promise.all([p2.waitForFileChooser(), p2.click('#boardopen')]);
    await fc2.accept([fp]); await wait(500);
    ok(!(await p2.$eval('#openask', e => e.hidden)) && /A board of 3 pages/.test(await p2.$eval('#openq', e => e.textContent)), 'opened onto a board with writing, it asks where to put it');
    await p2.click('#openadd'); await wait(500);
    ok(await p2.$eval('#pageno', e => e.textContent) === '4 / 6', 'After these pages: added, and its first page shown (4 / 6)');
    await ctx.close();
    void n; void pagesBefore;
  }

  console.log('the pages, side by side');
  {
    await page.click('#prev'); await wait(300);
    await page.click('#pageno'); await wait(900);
    const th = await P(() => [...document.querySelectorAll('#pagegrid .pg')].map(b => ({ cur: b.getAttribute('aria-current') === 'page', ink: (() => { const c = b.querySelector('canvas'), D = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < D.length; i += 4) if (D[i] < 90 && D[i + 2] < 130) n++; return n; })() })));
    ok(th.length === 3 && th[0].cur && th[0].ink > 20 && th[1].ink > 5 && th[2].ink === 0, 'the page number opens every page small, the one on the board marked: ' + JSON.stringify(th));
    await page.click('#pgdup'); await wait(300);
    ok(await page.$eval('#pageno', e => e.textContent) === '2 / 4' && await count() > 0, 'Duplicate this page: a copy after it, shown');
    await page.click('#pageno'); await wait(200); await page.click('#pgleft'); await wait(150);
    ok(await page.$eval('#pageno', e => e.textContent) === '1 / 4', 'Move it left: it is page 1 now');
    await page.click('#pagegrid .pg:nth-child(4)'); await wait(300);
    ok(await page.$eval('#pageno', e => e.textContent) === '4 / 4' && await hidden('pagespop'), 'tapping a page goes to it');
  }

  console.log('the laser pointer');
  {
    const n0 = await count();
    await page.keyboard.press('l'); await drag([[300, 300], [500, 400]], 10);
    ok(await count() === n0 && await P(() => document.getElementById('pad').mode) === 'laser', 'L: the laser points and keeps nothing');
    await page.keyboard.press('p');
  }

  await page.screenshot({ path: path.join(out, 'board-canvas-end.png') });
  await browser.close();
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
