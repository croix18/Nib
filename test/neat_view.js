// Contact sheet of the in-place views: for each expression, the ink as written, then tidy, my handwriting (a hand
// built from another writer's CROHME symbols, placed in Replicator boxes) and typeset, each drawn over a faint
// copy of the original ink. Writes test/shots/neat-<n>.png.
//   node test/neat_view.js [ids or categories...]
'use strict';
const fs = require('fs'), path = require('path');
const puppeteer = require(require('./data').npm('puppeteer-core'));
const { need } = require('./data');
const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });

const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const args = process.argv.slice(2);
let pick = args.length ? rows.filter(r => args.includes(r.id) || args.includes(r.cat)) : [];
if (!pick.length) { const cats = {}; for (const r of rows) if (!cats[r.cat] || cats[r.cat].length < 2) (cats[r.cat] = cats[r.cat] || []).push(r); pick = [].concat(...Object.values(cats)); }

// a hand: one sample per character from the 2019 test writers, placed on the Replicator's guides
function makeHand() {
  const t = fs.readFileSync(need('test.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const pool = {};
  for (const r of t) for (const s of r.symbols) (pool[s.label] = pool[s.label] || []).push(s.strokes.map(k => r.strokes[k]));
  const G = { cap: 0.2, x: 0.376, base: 0.76, desc: 0.944 };
  const L = { '×': '\\times', '÷': '\\div', '±': '\\pm', '≠': '\\neq', '≤': '\\leq', '≥': '\\geq', 'π': '\\pi', 'θ': '\\theta', '√': '\\sqrt', '∞': '\\infty' };
  const glyphs = {};
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-=()<>/.,%$|[]'.split('').concat(Object.keys(L));
  for (const ch of chars) {
    const list = pool[L[ch] || ch]; if (!list) continue;
    const st = list[Math.min(5, list.length - 1)];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    let top = G.cap, bot = G.base;
    if (/[a-z]/.test(ch) && !/[bdfhklt]/.test(ch)) top = G.x;
    if (/[gjpqy]/.test(ch)) { top = G.x; bot = G.desc; }
    if ('.,'.includes(ch)) { top = G.base - 0.05; bot = G.base + (ch === ',' ? 0.08 : 0); }
    if ('-+=×÷<>≤≥≠±'.includes(ch)) { top = G.x - 0.03; bot = G.base - 0.1; }
    if ('()[]|/'.includes(ch)) { top = G.cap - 0.04; bot = G.base + 0.15; }
    if (ch === '√') { top = G.cap - 0.05; bot = G.base + 0.05; }
    const k = Math.min((bot - top) / Math.max(y1 - y0, 1e-9), 0.8 / Math.max(x1 - x0, 1e-9));
    glyphs[ch] = st.map(s => s.map(p => [0.1 + (p[0] - x0) * k, top + (p[1] - y0) * k]));
  }
  return { name: 'Test hand', glyphs };
}

(async () => {
  const hand = makeHand();
  const browser = await puppeteer.launch({ executablePath: require('./data').needChrome(), headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setContent('<body style="margin:0;background:#fffdf7"></body>');
  await page.addScriptTag({ path: process.env.NIB || path.join(__dirname, '..', 'dist', 'nib.js') });
  const per = 6;
  for (let b = 0; b * per < pick.length; b++) {
    const batch = pick.slice(b * per, (b + 1) * per);
    const H = await page.evaluate(async (batch, hand) => {
      const I = Nib._internals;
      await I.typeFontsReady();
      document.body.innerHTML = '';
      const W = 300, Hh = 170, cols = ['ink', 'tidy', 'hand', 'typeset'];
      const c = document.createElement('canvas'); c.width = W * cols.length * 2; c.height = Hh * batch.length * 2; c.style.width = W * cols.length + 'px';
      document.body.appendChild(c);
      const ctx = c.getContext('2d'); ctx.scale(2, 2);
      ctx.fillStyle = '#fffdf7'; ctx.fillRect(0, 0, W * cols.length, Hh * batch.length);
      batch.forEach((r, ri) => {
        const res = Nib.recognize(r.strokes);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
        const k = Math.min((W - 40) / (x1 - x0), (Hh - 50) / (y1 - y0));
        cols.forEach((col, ci) => {
          ctx.save();
          ctx.translate(ci * W + 20, ri * Hh + 30);
          ctx.strokeStyle = '#e7dcc2'; ctx.strokeRect(-18, -28, W - 4, Hh - 4);
          ctx.fillStyle = '#5d6678'; ctx.font = '10px sans-serif'; ctx.fillText(col === 'ink' ? r.latex : col, -14, -16);
          ctx.scale(k, k); ctx.translate(-x0, -y0);
          const raw = { ink: col === 'ink' ? '#1b2a4a' : 'rgba(27,42,74,.12)', width: 2.2 / k };
          for (const s of r.strokes) { ctx.strokeStyle = raw.ink; ctx.lineWidth = raw.width; ctx.lineCap = 'round'; ctx.beginPath(); s.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); }
          if (col !== 'ink') {
            const o = col === 'typeset' ? Nib.typeset(r.strokes, { result: res }) : Nib.neaten(r.strokes, { result: res, style: col, hand });
            I.drawItems(ctx, o.items, { ink: '#1b2a4a', width: 2.2 / k });
          }
          ctx.restore();
        });
      });
      return Hh * batch.length;
    }, batch, hand);
    const file = path.join(out, `neat-${b + 1}.png`);
    await (await page.$('canvas')).screenshot({ path: file });
    console.log('wrote', file, batch.map(r => r.id).join(' '));
  }
  await browser.close();
  if (errors.length) console.log('errors:', errors);
})();
