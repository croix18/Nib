// Nib's regression suite: fast checks that must pass before a build ships.  node test/check.js [--full]
//   1. API shape              2. bad and odd input never throws, never hangs, always gives valid LaTeX
//   3. scale / position invariance, slanted lines   4. determinism   5. options and corrections   6. memory
//   7. accuracy floor on the composed school set (every 7th expression; --full: all 700)
// LaTeX validity uses KaTeX when it can be required (npm i katex); otherwise that check is skipped.
'use strict';
const fs = require('fs'), path = require('path');
const Nib = require(process.env.NIB || path.join(__dirname, '..', 'dist', 'nib.js'));
let katex = null;
for (const p of ['katex', path.join(__dirname, '..', 'demo', 'node_modules', 'katex')]) { try { katex = require(p); break; } catch (e) { /* next */ } }
const FULL = process.argv.includes('--full');
const FLOOR = { exact: 0.87, tokenErr: 0.035 };  // 1.1 scores 0.893 / 0.022 on all 700 (1.0: 0.867 / 0.031)

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log('  FAIL', msg); } };
const section = name => console.log(name);
const valid = latex => { if (!katex) return true; try { katex.renderToString(latex, { throwOnError: true, strict: false }); return true; } catch (e) { return false; } };
const tokens = res => [].concat(...res.lines.map((l, i) => (i ? ['\\\\'] : []).concat(l.tokens)));
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(12345);
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const sample = rows.filter((r, i) => i % 7 === 0);

// ------------------------------------------------------------------ 1. API
section('1. API');
ok(typeof Nib.version === 'string' && /^\d+\.\d+\.\d+$/.test(Nib.version), 'version string');
for (const f of ['recognize', 'recognizeAsync', 'classify', 'classes', 'attach']) ok(typeof Nib[f] === 'function', 'Nib.' + f);
ok(typeof Nib.Recognizer === 'function' && typeof Nib.Pad === 'function', 'Recognizer and Pad classes');
ok(Array.isArray(Nib.symbolSets) && ['school', 'all', 'numbers'].every(s => Nib.symbolSets.includes(s)), 'symbol sets');
ok(Nib.classes().length >= 100 && !Nib.classes().includes('junk'), 'class list');
const r0 = Nib.recognize(rows[0].strokes);
for (const k of ['latex', 'text', 'lines', 'symbols', 'tree', 'confidence', 'skew', 'ms']) ok(k in r0, 'result has ' + k);
ok(r0.symbols.every(s => s.box && Array.isArray(s.strokes) && Array.isArray(s.candidates)), 'symbol entries');

// ------------------------------------------------------------------ 2. bad and odd input
section('2. bad and odd input');
const empty = x => { try { const r = Nib.recognize(x); return r.latex === '' && r.lines.length === 0; } catch (e) { return false; } };
ok(empty(undefined) && empty(null) && empty([]) && empty([[]]) && empty([[], []]), 'nothing to read gives an empty result');
ok(empty([[[NaN, 1], [Infinity, 2]]]) && empty([[['a', 'b']]]) && empty([{ points: [] }]) && empty([null, undefined, 5, 'x']), 'non-numeric points are ignored');
const noThrow = (name, input, opts) => {
  let r; const t0 = Date.now();
  try { r = Nib.recognize(input, opts); } catch (e) { ok(false, name + ' threw ' + e.message); return null; }
  ok(Date.now() - t0 < 60000, name + ' finished in time (' + (Date.now() - t0) + ' ms)');
  ok(valid(r.latex), name + ' gave valid LaTeX: ' + r.latex);
  return r;
};
noThrow('a single dot', [[[5, 5]]]);
noThrow('a stroke of identical points', [[[3, 3], [3, 3], [3, 3]]]);
noThrow('one huge stroke', [Array.from({ length: 10000 }, (_, i) => [i * 0.5, 50 + 40 * Math.sin(i / 30)])]);
noThrow('{x, y} objects and {points}', [{ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }, [{ x: 10, y: 0 }, { x: 0, y: 10 }]]);
const scribble = n => Array.from({ length: n }, () => { const x = rnd() * 800, y = rnd() * 300, k = 2 + Math.floor(rnd() * 30); let a = rnd() * 6;
  return Array.from({ length: k }, (_, i) => { a += (rnd() - 0.5); return [x + i * 3 * Math.cos(a), y + i * 3 * Math.sin(a)]; }); });
let badLatex = 0;
for (let t = 0; t < 40; t++) { const r = Nib.recognize(scribble(1 + Math.floor(rnd() * 25)), { symbols: ['school', 'all', 'numbers'][t % 3] }); if (!valid(r.latex)) { badLatex++; if (badLatex < 4) console.log('    invalid:', r.latex); } }
ok(badLatex === 0, `random scribbles always give valid LaTeX (${badLatex} invalid of 40)`);
noThrow('300 random strokes', scribble(300));

// ------------------------------------------------------------------ 3. invariance
section('3. scale and position');
let variant = 0;
for (const r of sample.slice(0, 25)) {
  const base = Nib.recognize(r.strokes).latex;
  const tf = (k, dx, dy) => r.strokes.map(s => s.map(p => [p[0] * k + dx, p[1] * k + dy]));
  for (const [k, dx, dy] of [[0.01, 0, 0], [100, 0, 0], [1, -1e5, 3e4]]) if (new Nib.Recognizer().recognize(tf(k, dx, dy)).latex !== base) variant++;
}
ok(variant === 0, `same reading at 1/100 and 100x size and far from the origin (${variant} differences)`);

section('3b. writing that runs uphill or downhill');
// the whole line turned 8 degrees, or drifting 8 degrees with each symbol upright: most readings must not change
let kept = 0, tried = 0, skewSeen = 0;
for (const r of sample.slice(0, 40)) {
  const base = Nib.recognize(r.strokes).latex;
  const all = r.strokes.flat(), cx = all.reduce((t, p) => t + p[0], 0) / all.length;
  for (const sgn of [1, -1]) {
    const a = sgn * 8 * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    const turned = r.strokes.map(st => st.map(p => [p[0] * c - p[1] * sn, p[0] * sn + p[1] * c]));
    const drifted = r.strokes.map(st => st.slice());
    for (const sym of r.symbols) {
      let x0 = Infinity, x1 = -Infinity; for (const k of sym.strokes) for (const p of r.strokes[k]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
      for (const k of sym.strokes) drifted[k] = r.strokes[k].map(p => [p[0], p[1] + Math.tan(a) * ((x0 + x1) / 2 - cx)]);
    }
    for (const v of [turned, drifted]) {
      const res = new Nib.Recognizer().recognize(v);
      tried++; if (res.latex === base) kept++;
      if (Math.abs(Math.abs(res.skew) - 8) < 3) skewSeen++;
      ok(typeof res.skew === 'number' && isFinite(res.skew), 'the result reports the slope it removed');
    }
  }
}
console.log(`  slanted 8 degrees: ${kept} of ${tried} read as when level; slope measured within 3 degrees in ${skewSeen}`);
ok(kept / tried >= 0.8, `slanted writing reads the same as level writing (${kept} of ${tried})`);
ok(skewSeen / tried >= 0.6, `the slope is measured to within 3 degrees (${skewSeen} of ${tried})`);
const lvl = sample.slice(0, 40).filter(r => Nib.recognize(r.strokes).skew !== 0).length;
ok(lvl <= 2, `level writing is left alone (${lvl} of 40 straightened)`);
const off = Nib.recognize(sample[3].strokes.map(st => st.map(p => [p[0] + 0.15 * p[1], p[1] + 0.15 * p[0]])), { deskew: 0 });
ok(off.skew === 0, 'deskew: 0 turns the straightening off');

section('3c. a stroke added to an earlier symbol at the very end');
// cross the t last, finish the + or the 4 after the next number: the reading should not change
let lateKept = 0, lateTried = 0;
for (const r of rows.filter((x, i) => i % 5 === 2)) {
  const multi = r.symbols.filter(sym => sym.strokes.length > 1 && /^[0-9a-zA-Z+$%]$|^\\(pi|times|div|pm|ne|le|ge)$/.test(sym.label));
  if (!multi.length) continue;
  const sym = multi[lateTried % multi.length], moved = sym.strokes[sym.strokes.length - 1];
  if (moved === r.strokes.length - 1) continue;
  const late = r.strokes.filter((_, i) => i !== moved).concat([r.strokes[moved]]);
  lateTried++;
  if (new Nib.Recognizer().recognize(late).latex === new Nib.Recognizer().recognize(r.strokes).latex) lateKept++;
  if (lateTried >= 60) break;
}
console.log(`  late strokes: ${lateKept} of ${lateTried} read as when written in order`);
ok(lateKept / lateTried >= 0.8, `late strokes are joined back (${lateKept} of ${lateTried})`);
// a decimal point written last stays a decimal point beside its digit; a dot written last above a stem makes an i
const deci = [[[0, 0], [0, 40]], [[20, 2], [40, 0], [40, 20], [20, 20], [20, 40], [40, 40]], [[60, 0], [60, 40]], [[49, 39], [50, 40]]];
ok(Nib.recognize(deci).latex.includes('.'), 'a decimal point added last stays a decimal point: ' + Nib.recognize(deci).latex);

// ------------------------------------------------------------------ 4. determinism
section('4. determinism');
let differ = 0;
for (const r of sample.slice(0, 25)) if (new Nib.Recognizer().recognize(r.strokes).latex !== new Nib.Recognizer().recognize(r.strokes).latex) differ++;
ok(differ === 0, 'two fresh recognizers agree');
const inc = new Nib.Recognizer(), r5 = sample[5];
let last = null; for (let k = 1; k <= r5.strokes.length; k++) last = inc.recognize(r5.strokes.slice(0, k));
ok(last.latex === new Nib.Recognizer().recognize(r5.strokes).latex, 'stroke-by-stroke reading ends where a single read does');

// ------------------------------------------------------------------ 5. options and corrections
section('5. options and corrections');
const plain = Nib.recognize(rows[0].strokes, { symbols: 'numbers' });
ok(plain.symbols.every(s => /^[0-9.,+\-=/%$()]$|^\\(times|div|cdot)$/.test(s.label) || s.label === ':'), 'numbers set only gives numeric symbols');
let threw = false; try { Nib.recognize(rows[0].strokes, { symbols: 'nonsense' }); } catch (e) { threw = true; }
ok(threw, 'an unknown symbol set is an error');
const sym = r0.symbols[0], alt = sym.candidates[1] ? sym.candidates[1][0] : 'x';
const fixedR = Nib.recognize(rows[0].strokes, { fix: [{ strokes: sym.strokes, label: alt }] });
ok(fixedR.symbols.some(s => s.label === alt && s.fixed), 'a fixed symbol keeps the label it was given');
ok(Nib.recognize(rows[0].strokes, { fix: [{ strokes: [0, 99], label: 'x' }] }).latex.length > 0, 'a fix naming missing strokes is ignored');

// ------------------------------------------------------------------ 6. memory
section('6. memory');
Nib.memory.clear();
ok(Nib.memory.size === 0, 'memory clears');
Nib.memory.learn(rows[1].strokes.slice(0, 1), 'x'); Nib.memory.learn([], 'y'); Nib.memory.learn([[[NaN, NaN]]], 'z');
ok(Nib.memory.size === 1, 'learning ignores empty ink');
Nib.memory.clear();

// ------------------------------------------------------------------ 7. accuracy floor
section(`7. accuracy on the composed school set (${FULL ? 'all ' + rows.length : sample.length + ' expressions'})`);
function lev(a, b) { let prev = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[b.length]; }
const canon = t => t.map(x => x === '\\cdot' ? '.' : x);
let exact = 0, ed = 0, len = 0, invalid = 0;
const R = new Nib.Recognizer(), t0 = Date.now();
for (const r of FULL ? rows : sample) {
  const res = R.recognize(r.strokes);
  const p = canon(tokens(res)), g = canon(r.gt);
  if (p.length === g.length && p.every((t, i) => t === g[i])) exact++;
  ed += lev(p, g); len += g.length;
  if (!valid(res.latex)) invalid++;
}
const n = (FULL ? rows : sample).length;
console.log(`  exact ${(100 * exact / n).toFixed(1)}%  token error ${(100 * ed / len).toFixed(1)}%  ${((Date.now() - t0) / n).toFixed(0)} ms each`);
ok(exact / n >= FLOOR.exact - (FULL ? 0 : 0.05), `exact-match floor ${FLOOR.exact} (sample allows 5 points of noise)`);
ok(ed / len <= FLOOR.tokenErr + (FULL ? 0 : 0.02), `token-error ceiling ${FLOOR.tokenErr}`);
ok(invalid === 0, `every output is valid LaTeX (${invalid} invalid)`);

console.log(`\n${passes} passed, ${fails} failed${katex ? '' : ' (KaTeX not found: LaTeX validity not checked)'}`);
process.exit(fails ? 1 : 0);
