// Builds Replicator fonts from real handwriting (CROHME test-set symbols placed in the boxes) and from awkward
// input, writes them to test/shots/fonts/, and reads each back with opentype.js. test/font_check.py then
// validates the same files with fontTools.
//   node test/font_check.js
'use strict';
const fs = require('fs'), path = require('path');
const R = require(path.join(__dirname, '..', 'replicator', 'core.js'));
const opentype = require(path.join(__dirname, '..', 'demo', 'node_modules', 'opentype.js'));
const D = process.env.NIB_DATA || path.join(__dirname, '..', 'training', 'scratch', 'data') + '/';
const OUT = path.join(__dirname, 'shots', 'fonts');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); fails++; } };

// handwriting: one sample of each character from the 2019 test writers, fitted to the guides
const rows = fs.readFileSync(D + 'test.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const pool = {};
for (const r of rows) for (const s of r.symbols) (pool[s.label] = pool[s.label] || []).push(s.strokes.map(k => r.strokes[k]));
const LABEL = { '×': '\\times', '÷': '\\div', '±': '\\pm', '≠': '\\neq', '≤': '\\leq', '≥': '\\geq', 'π': '\\pi', 'θ': '\\theta', '√': '\\sqrt', '∞': '\\infty' };
const G = R.GUIDE_FRAC;
function place(ch, st) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  let top = G.cap, bot = G.base;
  if (/[a-z]/.test(ch) && !/[bdfhklt]/.test(ch)) top = G.x;
  if (/[gjpqy]/.test(ch)) { top = G.x; bot = G.desc; }
  if ('.,'.includes(ch)) { top = G.base - 0.06; bot = G.base + (ch === ',' ? 0.08 : 0); }
  if ('-+=×÷'.includes(ch)) { top = G.x - 0.05; bot = G.base - 0.12; }
  const k = Math.min((bot - top) / Math.max(y1 - y0, 1e-9), 0.75 / Math.max(x1 - x0, 1e-9));
  return st.map(s => s.map(p => [0.12 + (p[0] - x0) * k, top + (p[1] - y0) * k]));
}
const glyphs = {};
for (const sec of R.SECTIONS) for (const ch of sec.chars) {
  const lab = pool[LABEL[ch] || ch] || pool[ch];
  if (lab) glyphs[ch] = place(ch, lab[Math.min(2, lab.length - 1)]);
}
const written = Object.keys(glyphs);

function check(name, gl, opts, expect) {
  const t0 = Date.now();
  const res = R.buildFont(gl, opts);
  const ms = Date.now() - t0;
  const file = path.join(OUT, name + '.ttf');
  fs.writeFileSync(file, Buffer.from(res.bytes));
  let f = null;
  try { f = opentype.parse(res.bytes.buffer.slice(res.bytes.byteOffset, res.bytes.byteOffset + res.bytes.length)); } catch (e) { ok(false, name + ': opentype.js cannot read it: ' + e.message); return res; }
  ok(f.outlinesFormat === 'truetype', name + ': TrueType outlines');
  ok(f.unitsPerEm === 1000, name + ': 1000 units per em');
  ok(f.glyphs.length === res.built.length + 2, `${name}: ${f.glyphs.length} glyphs for ${res.built.length} characters`);
  for (const ch of res.built) {
    const g = f.charToGlyph(ch);
    if (!g || g.index === 0) { ok(false, `${name}: "${ch}" is not mapped`); continue; }
    const b = g.getBoundingBox();
    ok(g.advanceWidth > 0 && b.x2 > b.x1 && b.y2 > b.y1, `${name}: "${ch}" has ink and width`);
    ok(b.x1 >= -1 && b.x2 <= g.advanceWidth + 1, `${name}: "${ch}" sits inside its advance (${b.x1}..${b.x2} of ${g.advanceWidth})`);
  }
  ok(f.charToGlyph(' ').advanceWidth > 0 && f.charToGlyph(' ').index === f.charToGlyph(' ').index, name + ': space and no-break space');
  if (res.built.includes('-')) ok(f.charToGlyph('−').index === f.charToGlyph('-').index, name + ': the minus sign uses the hyphen drawing');
  if (expect) expect(res, f);
  console.log(`  ${name.padEnd(16)} ${res.built.length} characters, ${(res.bytes.length / 1024).toFixed(1)} KB, ${ms} ms`);
  return res;
}

console.log('fonts');
check('handwriting', glyphs, { name: 'My Handwriting' }, (res) => ok(res.built.length === written.length, `every written character is in the font (${res.built.length}/${written.length})`));
check('heavy', glyphs, { name: 'Heavy', weight: 150, spacing: 0, smoothing: 6 });
check('light', glyphs, { name: 'Light', weight: 40, spacing: 140, smoothing: 0, tidy: false });
check('empty', {}, { name: 'Nothing Yet' }, (res) => ok(res.built.length === 0 && res.missing.length === R.SECTIONS.reduce((n, s) => n + s.chars.length, 0), 'an empty sheet still makes a valid font'));
// awkward ink: a single tap, a stroke of one point, ink far outside the box, a huge scribble, junk values
const scribble = []; for (let i = 0; i < 6000; i++) scribble.push([0.5 + 0.4 * Math.cos(i / 9) * Math.sin(i / 1300), 0.5 + 0.4 * Math.sin(i / 7)]);
check('awkward', {
  '.': [[[0.4, 0.75]]],
  'i': [[[0.4, 0.42], [0.4, 0.75]], [[0.4, 0.3]]],
  'W': [[[-0.6, -0.4], [0.3, 1.7], [0.6, 0.2], [1.2, 1.6], [1.6, -0.5]]],
  'O': [scribble],
  'x': [[[0.2, 0.4], [NaN, 0.5], [0.8, 0.75]]],
  'y': 'not strokes', 'z': [[]], 'q': [[['a', 'b']]],
}, { name: 'Awkward' }, (res) => {
  ok(['.', 'i', 'W', 'O'].every(c => res.built.includes(c)), 'taps, single points, out-of-box ink and long strokes all become glyphs: ' + res.built.join(''));
  ok(!res.built.includes('y') && !res.built.includes('z') && !res.built.includes('q'), 'junk input is skipped, not drawn');
});
check('names', { A: glyphs.A }, { name: '  Mr. Shaffer’s écriture 🖊️ that is far too long for a font name  ' }, (res, f) => {
  ok(f.names.fontFamily.en.length <= 31, 'family name is cut to 31 characters: ' + f.names.fontFamily.en);
  ok(/^[\x21-\x7e]+$/.test(f.names.postScriptName.en) && f.names.postScriptName.en.length <= 63, 'PostScript name is plain ASCII: ' + f.names.postScriptName.en);
});
check('symbols-name', { A: glyphs.A }, { name: '!!!' }, (res, f) => ok(f.names.postScriptName.en === 'Handwriting-Regular', 'a name with no letters still gets a PostScript name'));
// the same input always gives the same font (apart from the dates in it)
const a = R.buildFont(glyphs, { name: 'Same', date: 0 }).bytes, b = R.buildFont(glyphs, { name: 'Same', date: 0 }).bytes;
ok(a.length === b.length && a.every((v, i) => v === b[i]), 'building twice gives identical bytes');
// the outline cache gives the same font as a fresh build
const cache = new Map();
R.buildFont(glyphs, { name: 'Same', date: 0, cache });
const c = R.buildFont(glyphs, { name: 'Same', date: 0, cache }).bytes;
ok(c.length === a.length && c.every((v, i) => v === a[i]), 'a cached rebuild gives identical bytes');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
