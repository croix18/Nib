// Board shapes (src/shapes.js) in a real browser: the contact sheet test/shapes_page.html draws (every kind plain,
// dashed, filled, thin and thick, at zoom 0.5, 1 and 3, navy, red and dark paper, number lines and planes) saved as a
// PNG to look at, with one PNG a section at full size beside it; every kind's drawn pixels inside shapeBounds; no
// errors; and how long shapeDraw takes (a plane -10..10 under 2 ms).
//   node test/shapes_browser.js [sheet.png]        (default test/shots/shapes_sheet.png)
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(require('./data').npm('puppeteer-core'));
const OUT = path.resolve(process.argv[2] || path.join(__dirname, 'shots', 'shapes_sheet.png'));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const png = (file, dataUrl) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

(async () => {
  const browser = await puppeteer.launch({ executablePath: require('./data').needChrome(), headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await require('./data').packagesFor(page);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.setViewport({ width: 1800, height: 1000 });
  await page.goto('file://' + path.join(__dirname, 'shapes_page.html') + '#puppeteer', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  console.log('contact sheet');
  const sheet = await page.evaluate(() => window.drawSheet(window.SECTION_NAMES));
  png(OUT, sheet.png);
  ok(sheet.height > 2000, 'sheet drawn: ' + sheet.width + ' x ' + sheet.height + ' CSS px at 2x -> ' + OUT);
  const names = await page.evaluate(() => window.SECTION_NAMES);
  for (const n of names) {
    const s = await page.evaluate(n => window.drawSheet([n]), n);
    png(OUT.replace(/\.png$/, '_' + n + '.png'), s.png);
  }
  ok(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));

  console.log('drawn pixels stay inside shapeBounds');
  const res = await page.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = 1700; cv.height = 1150;
    const c = cv.getContext('2d', { willReadFrequently: true }), out = [];
    const FONT = '"DM Sans", system-ui, sans-serif';
    const cases = [];
    const kinds = [['line', [[100, 300], [400, 120]]], ['arrow', [[100, 300], [400, 120]]], ['arrow2', [[100, 200], [400, 200]]], ['rect', [[100, 100], [400, 300]]],
      ['ellipse', [[100, 100], [400, 300]]], ['triangle', [[100, 100], [400, 300]]], ['rtriangle', [[100, 100], [400, 300]]], ['poly', [[120, 110], [380, 90], [420, 260], [180, 300]]]];
    for (const [shape, pts] of kinds) for (const st of [{ size: 2 }, { size: 8 }, { size: 3, dash: true }, { size: 8, dash: true, fill: 'rgba(0,0,0,.2)' }]) cases.push([Object.assign({ shape }, st), pts]);
    const nls = [{}, { min: 0, max: 1, step: 0.25, frac: true }, { min: -2, max: 2, step: 0.5, frac: true }, { min: 0, max: 100, step: 10 }];
    for (const opt of nls) for (const len of [260, 600]) cases.push([{ shape: 'numberline', size: 3, opt: Object.assign({ min: -10, max: 10, step: 1, labels: true }, opt) }, [[120, 200], [120 + len, 200]]]);
    const pls = [{}, { xmin: 0, xmax: 10, ymin: 0, ymax: 10 }, { xmin: -5, xmax: 5, ymin: -5, ymax: 5, grid: false }, { xmin: 0, xmax: 1, ymin: 0, ymax: 1, step: 0.25 }, { xmin: -3, xmax: 7, ymin: -2, ymax: 4 }];
    for (const opt of pls) for (const sz of [220, 400]) cases.push([{ shape: 'plane', size: 2.5, opt: Object.assign({ xmin: -10, xmax: 10, ymin: -10, ymax: 10, step: 1, labels: true, grid: true }, opt) }, [[150, 120], [150 + sz, 120 + sz * 0.8]]]);
    for (const [E, pts] of cases) for (const z of [0.5, 1, 2]) {
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
      c.setTransform(z, 0, 0, z, 0, 0);
      shapeDraw(c, Object.assign({ tool: 'shape', color: '#000' }, E), pts, { ink: '#000', paper: '#fff', z, font: FONT });
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let yy = 0; yy < cv.height; yy++) for (let xx = 0; xx < cv.width; xx++) if (d[(yy * cv.width + xx) * 4 + 3] > 12) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
      const b = shapeBounds(E, pts, { z }), px = [x0 / z, y0 / z, (x1 + 1) / z, (y1 + 1) / z], tol = 1.5 / z;
      const outside = Math.max(b[0] - px[0], b[1] - px[1], px[2] - b[2], px[3] - b[3]);
      const slack = Math.max(px[0] - b[0], px[1] - b[1], b[2] - px[2], b[3] - px[3]);
      out.push({ what: E.shape + ' ' + JSON.stringify(E.opt || { size: E.size, dash: E.dash, fill: !!E.fill }) + ' z' + z, outside: outside - tol, slack, clipped: x0 <= 0 || y0 <= 0 || x1 >= cv.width - 1 || y1 >= cv.height - 1 });
    }
    return out;
  });
  const bad = res.filter(r => r.outside > 0 || r.clipped);
  ok(bad.length === 0, res.length + ' drawings (every kind and style, number lines, planes; zoom 0.5, 1, 2) inside their bounds' + (bad.length ? ': ' + bad.slice(0, 4).map(r => r.what + ' by ' + r.outside.toFixed(2)).join('; ') : ''));
  const loose = res.filter(r => r.slack > 12);
  ok(loose.length <= res.length * 0.05, 'bounds fit closely (slack over 12 world units in ' + loose.length + '): ' + loose.slice(0, 3).map(r => r.what + ' ' + r.slack.toFixed(1)).join('; '));

  console.log('timing');
  const t = await page.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = 2400; cv.height = 2000;
    const c = cv.getContext('2d'), FONT = '"DM Sans", system-ui, sans-serif', out = {};
    const time = (name, E, pts, n) => {
      const o = { ink: '#1b2a4a', paper: '#fbf8ef', z: 1, font: FONT };
      c.setTransform(2, 0, 0, 2, 0, 0);
      for (let i = 0; i < 20; i++) shapeDraw(c, E, pts, o);
      c.getImageData(0, 0, 1, 1);
      let t0 = performance.now();
      for (let i = 0; i < n; i++) shapeDraw(c, E, pts, o);
      const issue = (performance.now() - t0) / n;
      t0 = performance.now();
      for (let i = 0; i < n; i++) { shapeDraw(c, E, pts, o); if (i % 10 === 9) c.getImageData(0, 0, 1, 1); }
      c.getImageData(0, 0, 1, 1);
      out[name] = [issue, (performance.now() - t0) / n];
    };
    const plane = { tool: 'shape', shape: 'plane', size: 2.5, opt: { xmin: -10, xmax: 10, ymin: -10, ymax: 10, step: 1, labels: true, grid: true } };
    time('plane -10..10, 400 box', plane, [[50, 50], [450, 450]], 300);
    time('plane -10..10, 800 box', plane, [[50, 50], [850, 850]], 200);
    time('number line -10..10, 600', { tool: 'shape', shape: 'numberline', size: 3, opt: { min: -10, max: 10, step: 1, labels: true } }, [[50, 100], [650, 100]], 300);
    time('number line 0..2 by 1/4, frac', { tool: 'shape', shape: 'numberline', size: 3, opt: { min: 0, max: 2, step: 0.25, labels: true, frac: true } }, [[50, 100], [850, 100]], 300);
    time('dashed filled ellipse', { tool: 'shape', shape: 'ellipse', size: 3, dash: true, fill: 'rgba(0,0,0,.2)' }, [[50, 50], [450, 350]], 500);
    time('arrow2', { tool: 'shape', shape: 'arrow2', size: 3 }, [[50, 50], [450, 350]], 1000);
    time('dashed rect', { tool: 'shape', shape: 'rect', size: 3, dash: true }, [[50, 50], [450, 350]], 1000);
    return out;
  });
  for (const [k, [a, b]] of Object.entries(t)) console.log('    ' + k.padEnd(32) + a.toFixed(3) + ' ms to issue, ' + b.toFixed(3) + ' ms with the canvas flushed');
  ok(t['plane -10..10, 400 box'][1] < 2, 'a plane -10..10 draws in under 2 ms: ' + t['plane -10..10, 400 box'][1].toFixed(3) + ' ms');

  await browser.close();
  console.log(fails ? 'FAILED ' + fails : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
