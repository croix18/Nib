// Answers after "=": the arithmetic, the form each answer takes, algebra, variables, things that must give no answer,
// limits, answers to real handwriting, and where answers are drawn in every view.
//   node test/solve_check.js
'use strict';
const fs = require('fs'), path = require('path');
const Nib = require(process.env.NIB || path.join(__dirname, '..', 'dist', 'nib.js'));
const I = Nib._internals;
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  FAIL', m); } };
const section = n => console.log(n);
const one = tex => { const r = Nib.solve(tex); return r[r.length - 1]; };
const expect = (tex, want) => {
  let got;
  try { const a = one(tex); got = a ? a.latex : null; } catch (e) { got = 'THREW ' + e.message; }
  ok(got === want, `${tex}  ->  ${got}   (want ${want})`);
};
const table = rows => { for (const [t, w] of rows) expect(t, w); };

section('1. whole numbers and the order of operations');
table([
  ['3+4=', '7'], ['10-15=', '-5'], ['2+3\\times 4=', '14'], ['(2+3)\\times 4=', '20'], ['20\\div 4\\times 5=', '25'],
  ['6\\div 2(1+2)=', '9'], ['2\\cdot 3=', '6'], ['-3-4=', '-7'], ['-3\\times -4=', '12'], ['3--2=', '5'], ['7-(-3)=', '10'],
  ['8\\times 0=', '0'], ['0\\div 5=', '0'], ['[2+3]\\times 2=', '10'], ['\\{1+1\\}\\times 3=', '6'], ['2(3)(4)=', '24'],
  ['2^{3}=', '8'], ['-2^{2}=', '-4'], ['(-2)^{2}=', '4'], ['(-2)^{3}=', '-8'], ['2^{3^{2}}=', '512'], ['10^{6}=', '1000000'],
  ['2^{64}=', '18446744073709551616'], ['5!=', '120'], ['0!=', '1'], ['3!+1=', '7'],
  ['|-7|=', '7'], ['|3-10|=', '7'], ['-|-4|=', '-4'], ['2|-3|=', '6'], ['|2-5|\\times|1-4|=', '9'],
  ['\\sqrt{144}=', '12'], ['\\sqrt[3]{-8}=', '-2'], ['\\sqrt[3]{27}+1=', '4'], ['\\sqrt{0.25}=', '0.5'], ['\\sqrt{\\frac{9}{16}}=', '\\frac{3}{4}'],
  ['3\\sqrt{16}=', '12'], ['\\sqrt{9}\\sqrt{4}=', '6'], ['2^{3}+4=', '12'], ['\\sqrt{81}+2^{3}=', '17'],
  ['((((((((1+1))))))))=', '2'], [Array(200).fill('1').join('+') + '=', '200'],
]);

section('2. decimals: exact, repeating with a bar, long ones rounded');
table([
  ['0.1+0.2=', '0.3'], ['33.40-7.9=', '25.5'], ['1.5\\times 1.5=', '2.25'], ['7.5\\div 2.5=', '3'], ['1\\div 8=', '0.125'],
  ['10\\div 4=', '2.5'], ['10\\div 3=', '3.\\overline{3}'], ['1\\div 6=', '0.1\\overline{6}'], ['1\\div 7=', '0.\\overline{142857}'],
  ['1\\div 17=', '0.0588\\ldots'], ['0.5\\div 3=', '0.1\\overline{6}'], ['2.5-2.5=', '0'], ['0.001\\times 0.001=', '0.000001'],
  ['12.5\\times 4=', '50'], ['.5+.25=', '0.75'], ['100-99.5=', '0.5'], ['2\\div 3=', '0.\\overline{6}'], ['22\\div 7=', '3.\\overline{142857}'],
  ['-1\\div 4=', '-0.25'], ['1.1\\times 1.1=', '1.21'], ['5/2=', '2.5'], ['1/3+1/3=', '0.\\overline{6}'],
  ['1\\div 44650=', '0.0000224\\ldots'], ['0.001\\div 3000=', '0.000000\\overline{3}'], ['1\\div 300=', '0.00\\overline{3}'],
  ['1\\div 1700=', '0.000588\\ldots'], ['2\\div 70001=', '0.0000286\\ldots'],
]);

section('3. fractions and mixed numbers');
table([
  ['\\frac{1}{2}+\\frac{1}{3}=', '\\frac{5}{6}'], ['\\frac{3}{4}\\times\\frac{2}{3}=', '\\frac{1}{2}'], ['\\frac{3}{4}\\div\\frac{1}{2}=', '\\frac{3}{2}'],
  ['\\frac{1}{2}+\\frac{1}{2}=', '1'], ['2\\frac{1}{2}+1\\frac{3}{4}=', '4\\frac{1}{4}'], ['5\\frac{1}{3}-2\\frac{1}{2}=', '2\\frac{5}{6}'],
  ['3\\times\\frac{1}{4}=', '\\frac{3}{4}'], ['-\\frac{1}{2}+\\frac{1}{4}=', '-\\frac{1}{4}'], ['\\frac{1}{2}-1\\frac{1}{2}=', '-1'],
  ['1\\frac{1}{2}-3=', '-1\\frac{1}{2}'], ['\\frac{1}{3}+\\frac{1}{6}=', '\\frac{1}{2}'], ['2^{-2}=', '\\frac{1}{4}'], ['2^{-3}\\times 4=', '\\frac{1}{2}'],
  ['\\frac{2}{3}\\times 6=', '4'], ['\\frac{1}{2}\\times\\frac{1}{2}\\times\\frac{1}{2}=', '\\frac{1}{8}'], ['\\frac{1+2}{3+4}=', '\\frac{3}{7}'],
  ['\\frac{0.5}{2}=', '0.25'], ['\\frac{10}{4}\\times 2=', '5'], ['\\frac{7}{2}+1=', '\\frac{9}{2}'],
]);

section('4. a lone number turned into its other form');
table([
  ['\\frac{2}{4}=', '\\frac{1}{2}'], ['\\frac{8}{4}=', '2'], ['\\frac{3}{4}=', '0.75'], ['\\frac{1}{3}=', '0.\\overline{3}'],
  ['\\frac{16}{3}=', '5\\frac{1}{3}'], ['\\frac{0}{7}=', '0'], ['-\\frac{16}{3}=', '-5\\frac{1}{3}'], ['\\frac{1}{17}=', '0.0588\\ldots'],
  ['\\frac{18}{12}=', '\\frac{3}{2}'], ['5\\frac{1}{3}=', '\\frac{16}{3}'], ['-2\\frac{1}{4}=', '-\\frac{9}{4}'], ['4\\frac{4}{8}=', '\\frac{9}{2}'],
  ['0.75=', '\\frac{3}{4}'], ['0.5=', '\\frac{1}{2}'], ['2.5=', '2\\frac{1}{2}'], ['-0.25=', '-\\frac{1}{4}'], ['4.0=', '4'], ['0.333=', '\\frac{333}{1000}'],
  ['75\\%=', '0.75'], ['5\\%=', '0.05'], ['150\\%=', '1.5'], ['100\\%=', '1'], ['12.5\\%=', '0.125'], ['(0.75)=', '\\frac{3}{4}'],
  ['7=', null], ['-7=', null], ['(7)=', null], ['0=', null], ['\\pi=', '3.142\\ldots'], ['-(-4)=', '4'], ['--4=', '4'], ['-(-(-2))=', '-2'],
  ['(-563)=', null], ['+(-3)=', null],
]);

section('5. percents');
table([
  ['15\\% of 80=', '12'], ['15\\%\\times 80=', '12'], ['20\\%\\times 45=', '9'], ['50\\%+25\\%=', '0.75'], ['10\\%\\times 10\\%=', '0.01'],
  ['200\\times 15\\%=', '30'], ['15\\% x 60=', '9'],
]);

section('6. irrational answers are approximated, never passed off as exact');
table([
  ['\\sqrt{2}=', '1.414\\ldots'], ['2\\pi=', '6.283\\ldots'], ['\\pi\\times 3^{2}=', '28.274\\ldots'], ['\\pi-\\pi=', '0'],
  ['\\sqrt{2}\\times\\sqrt{2}=', '2'], ['\\sqrt{2}+\\sqrt{8}=', '4.243\\ldots'], ['2^{0.5}=', '1.414\\ldots'], ['4^{\\frac{1}{2}}=', '2'],
  ['8^{\\frac{2}{3}}=', '4'], ['(-8)^{\\frac{1}{3}}=', '-2'], ['-\\sqrt{3}=', '-1.732\\ldots'],
]);
ok(one('\\sqrt{2}=').exact === false && one('\\sqrt{4}=').exact === true && one('1\\div 17=').exact === false, 'approximate answers say so (exact: false)');

section('7. letters: like terms combined, brackets multiplied out');
table([
  ['3x+2x=', '5x'], ['2(x+3)-x=', 'x+6'], ['(x+1)^{2}=', 'x^{2}+2x+1'], ['x\\cdot x=', 'x^{2}'], ['x^{2}\\cdot x^{3}=', 'x^{5}'],
  ['(2x)^{2}=', '4x^{2}'], ['3(2a-4)=', '6a-12'], ['-(x-3)=', '-x+3'], ['2x+3y-x+y=', 'x+4y'], ['5-2(x+1)=', '-2x+3'],
  ['x+x+x=', '3x'], ['\\frac{6x+4}{2}=', '3x+2'], ['(6x+4)\\div 2=', '3x+2'], ['0.5x+0.25x=', '0.75x'], ['4(2x-1)+3=', '8x-1'],
  ['x-x=', '0'], ['3x-3x+5=', '5'], ['\\frac{1}{2}x+\\frac{1}{3}x=', '\\frac{5}{6}x'], ['(x+2)(x-2)=', 'x^{2}-4'], ['(x+1)(x+2)=', 'x^{2}+3x+2'],
  ['1x=', 'x'], ['0x+3=', '3'], ['x\\cdot 2=', '2x'], ['x4=', '4x'], ['-x-x=', '-2x'], ['-5a+13a=', '8a'], ['\\theta+\\theta=', '2\\theta'],
  ['\\alpha\\cdot\\alpha=', '\\alpha^{2}'], ['x_{1}+x_{1}=', '2x_{1}'], ['\\frac{x}{2}+\\frac{x}{2}=', 'x'], ['2(x+3)+3(x-1)=', '5x+3'],
]);
section('   already as simple as it gets: no answer');
table([
  ['2x=', null], ['x+1=', null], ['3x^{2}-2x+1=', null], ['-5a+13=', null], ['x=', null], ['\\frac{1}{2}x=', null], ['ab=', null],
  ['-x+3=', null], ['3-x=', null], ['y-2x=', null],
]);
section('   things letters cannot do here: no answer');
table([
  ['\\frac{6}{x}=', null], ['x\\div x=', null], ['x^{-1}=', null], ['x^{0.5}=', null], ['2^{x}=', null], ['\\sqrt{x}=', null], ['|x|=', null],
  ['2\\pi r=', null], ['x!=', null],
]);

section('8. a line "x = 5" sets x for the lines below it');
const lines = (tex, want) => {
  const got = Nib.solve(tex).map(a => (a ? a.latex : null));
  ok(JSON.stringify(got) === JSON.stringify(want), `${tex}  ->  ${JSON.stringify(got)}   (want ${JSON.stringify(want)})`);
};
lines('x=5 \\\\ 2x+1=', [null, '11']);
lines('a=3 \\\\ b=4 \\\\ a^{2}+b^{2}=', [null, null, '25']);
lines('x=2.5 \\\\ 2x=', [null, '5']);
lines('x=2.5 \\\\ 3x=', [null, '7.5']);
lines('x=\\frac{1}{2} \\\\ x+1=', [null, '\\frac{3}{2}']);
lines('y=2x+1 \\\\ y=', [null, null]);
lines('x=3 \\\\ y=2x \\\\ y+1=', [null, null, '7']);
lines('x=1 \\\\ x=2 \\\\ x+1=', [null, null, '3']);
lines('x=0.75 \\\\ x=', [null, '0.75']);
lines('2x+1= \\\\ x=5', [null, null]);
lines('x_{1}=3 \\\\ 2x_{1}=', [null, '6']);
lines('x=4 \\\\ 3x+2x=', [null, '20']);
lines('2x+3=11 \\\\ 2x=8 \\\\ x=4 \\\\ x+1=', [null, null, null, '5']);
lines('x+4=5 \\\\ x+1=', [null, null]);

section('9. no answer where there is nothing sound to say');
table([
  ['5\\div 0=', null], ['\\frac{1}{0}=', null], ['3<4=', null], ['3\\le 4=', null], ['3=4=', null], ['=', null], ['3+=', null],
  ['(3+4=', null], ['3+4)=', null], ['|3=', null], ['3..4=', null], ['(3,4)=', null], ['\\sum 3=', null], ['\\infty=', null],
  ['3\\pm 2=', null], ['\\sqrt{-4}=', null], ['0^{0}=', null], ['0^{-1}=', null], ['(-4)^{0.5}=', null], ['999999999999^{99}=', null],
  ['100!=', null], ['10^{30}=', null], ['\\$5+\\$2=', null], ['\\sin 30=', null], ['3+4<', null], ['3+4', null], ['', null],
  ['\\frac{}{2}=', null], ['2^{}=', null], ['x=5=', null], ['1,23+1=', null], ['3\\cdot=', null], ['\\%=', null], ['!=', null],
  ['3^{10000}=', null], ['10\\div 3^{40}=', null],
]);
table([['1,000+1=', '1001'], ['12,345+1=', '12346'], ['3+4=7+1=', '8'], ['2\\times 3=6\\times 2=', '12'], ['3 x 4=', '12'],
  ['2x4=', '8'], ['(2+3) x 4=', '20']]);
ok(Nib.solve('3+4').length === 1 && Nib.solve('3+4')[0] === null, 'a line without "=" has no answer');
ok(Nib.solve(null).length >= 0 && Nib.solve([]).every(a => a === null), 'no input: nothing, no error');
ok((() => { try { Nib.solve('\\frac{'); Nib.solve('}}}{{{'); Nib.solve('\\\\\\\\'); Nib.solve('^^^'); return true; } catch (e) { return false; } })(), 'garbled LaTeX never throws');

section('10. the answer also comes as text and as what kind of number it is');
const a1 = one('\\frac{16}{3}='), a2 = one('1\\div 3='), a3 = one('3x+2x=');
ok(a1.kind === 'mixed' && a1.text === '5 1/3' && Math.abs(a1.value - 16 / 3) < 1e-12, `mixed: ${JSON.stringify(a1)}`);
ok(a2.kind === 'repeating' && a2.text === '0.(3)', `repeating: ${a2.kind} ${a2.text}`);
ok(a3.kind === 'expression' && a3.text === '5x' && a3.value === null, `expression: ${a3.kind} ${a3.text}`);
ok(one('3+4=').kind === 'integer' && one('0.5+0.25=').kind === 'decimal' && one('\\frac{1}{2}+\\frac{1}{3}=').kind === 'fraction' && one('\\sqrt{2}=').kind === 'approx', 'kinds: integer, decimal, fraction, approx');

section('11. speed: nothing pathological');
let t0 = Date.now();
for (let i = 0; i < 300; i++) one('(x+1)^{24}=');
const tPow = Date.now() - t0;
t0 = Date.now();
for (let i = 0; i < 2000; i++) one('\\frac{1}{3}+\\frac{1}{6}\\times 2.5-\\sqrt{2}=');
const tMix = Date.now() - t0;
ok(tPow < 4000 && tMix < 2000, `big powers and mixed work stay quick (${tPow} ms for 300 × (x+1)^24, ${tMix} ms for 2000 mixed)`);
ok(one('(x+1)^{25}=') === null, 'powers of letters past 24 are refused');

// ------------------------------------------------------------------ handwriting: problems composed from real writers
section('12. real handwriting: problems written, answers erased, read and worked out');
const { compose } = require('./compose.js');
const PROBLEMS = ['3+4=', '12\\times 4=', '56\\div 8=', '\\frac{1}{2}+\\frac{1}{4}=', '2\\frac{1}{2}+1\\frac{1}{4}=', '0.5\\times 6=', '1\\div 3=',
  '2^{3}+1=', '\\sqrt{49}=', '15\\%\\times 80=', '3(x+2)=', '2x+3x=', '\\frac{3}{4}=', '0.25=', '7-10=', '|-6|+2=', '(2+3)\\times 4=', '9\\div 4=',
  '\\frac{16}{3}=', '4.5+2.25='];
let read = 0, right = 0, wrongWhenRead = [];
for (let round = 0; round < 6; round++) for (const p of PROBLEMS) {
  const e = compose(p), res = new Nib.Recognizer().recognize(e.strokes);
  const want = one(p), got = Nib.solve(res)[0];
  const same = res.latex.replace(/\s+/g, '') === p.replace(/\s+/g, '');
  if (same) { read++; if (got && want && got.latex === want.latex) right++; else wrongWhenRead.push(p + ' -> ' + (got ? got.latex : 'none')); }
}
ok(wrongWhenRead.length === 0, `whenever the writing is read right, the answer is right (${right} of ${read} read right${wrongWhenRead.length ? '; wrong: ' + wrongWhenRead.slice(0, 5).join(', ') : ''})`);
ok(read >= 0.75 * 6 * PROBLEMS.length, `most of the ${6 * PROBLEMS.length} problems are read right (${read})`);

// ------------------------------------------------------------------ where answers are drawn
section('13. answers drawn in place: after the "=", on its line, at the writer\'s size');
const rowsS = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const lhs = r => {
  const eq = r.symbols.find(s => s.label === '='), eqx = Math.max(...eq.strokes.flatMap(k => r.strokes[k].map(p => p[0])));
  const keep = new Set(); r.symbols.forEach(s => { const x0 = Math.min(...s.strokes.flatMap(k => r.strokes[k].map(p => p[0]))); if (x0 < eqx || s === eq) s.strokes.forEach(k => keep.add(k)); });
  return r.strokes.filter((_, k) => keep.has(k));
};
let placed = 0, bad = [];
const withEq = rowsS.filter(r => r.symbols.filter(s => s.label === '=').length === 1 && !r.latex.includes('\\\\'));
for (const r of withEq.slice(0, 60)) {
  const st = lhs(r), res = new Nib.Recognizer().recognize(st);
  if (!Nib.solve(res)[0]) continue;
  for (const style of ['tidy', 'hand', 'typeset', 'ink']) {
    const items = style === 'ink' ? inkPlan(st, res) : style === 'typeset' ? Nib.typeset(st, { result: res, solve: true }).items
      : Nib.neaten(st, { style, result: res, solve: true }).items;
    const A = items.filter(it => it.answer), E = items.filter(it => !it.answer);
    const eqIt = style === 'ink' ? null : E.filter(it => it.label === '=').pop();
    const eqBox = style === 'ink' ? inkBox(res.symbols.filter(s => s.label === '=').pop()) : eqIt && eqIt.box;
    if (!A.length || !eqBox) { bad.push(`${r.id} ${style}: no answer drawn`); continue; }
    const ab = A.reduce((b, it) => [Math.min(b[0], it.box[0]), Math.min(b[1], it.box[1]), Math.max(b[2], it.box[2]), Math.max(b[3], it.box[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const eqMid = (eqBox[1] + eqBox[3]) / 2, h = ab[3] - ab[1];
    if (!(ab[0] > eqBox[2])) bad.push(`${r.id} ${style}: starts before the = ends`);
    else if (ab[0] - eqBox[2] > 2.5 * h + 40) bad.push(`${r.id} ${style}: too far from the =`);
    else if (!(ab[1] < eqMid && ab[3] > eqMid - 0.2 * h)) bad.push(`${r.id} ${style}: not on the line of the =`);
    else if (A.some(it => it.parts.some(p => (p.paths || []).some(s => s.some(q => !isFinite(q[0]) || !isFinite(q[1]))))) || ab.some(v => !isFinite(v))) bad.push(`${r.id} ${style}: bad numbers`);
    else placed++;
  }
}
function inkBox(sy) { return sy ? [sy.box.x, sy.box.y, sy.box.x + sy.box.w, sy.box.y + sy.box.h] : null; }
function inkPlan(st, res) {
  const nodes = I.solveRows(res.tree).map(a => a && a.nodes);
  const plan = I.planOf(res, st, I.tidyProvider(), { answers: nodes, answersOnly: true, sample: I.sampleBook(res, st, null) });
  return I.drawablesOf(plan).map(it => I.unlevel(it, plan.t || 0, plan.c0 || 0));
}
ok(bad.length === 0, `every answer sits just after its "=" on that line, in every view (${placed} placed${bad.length ? '; ' + bad.slice(0, 6).join('; ') : ''})`);
ok(placed >= 100, `enough answers checked (${placed})`);

// fractions stack, repeating decimals get their bar, answers are flagged and carry no strokes
{
  const e = compose('\\frac{1}{2}+\\frac{1}{3}='), res = new Nib.Recognizer().recognize(e.strokes);
  const t = Nib.neaten(e.strokes, { result: res, solve: true }), A = t.items.filter(it => it.answer);
  const bar = A.find(it => it.label === '-' && it.parts.some(p => p.t === 'ink' && p.paths.length === 1 && p.paths[0].length === 2));
  const num = A.filter(it => it.label !== '-' && bar && it.box[3] < bar.box[1]), den = A.filter(it => it.label !== '-' && bar && it.box[1] > bar.box[3]);
  ok(res.latex.replace(/\s/g, '') !== '\\frac{1}{2}+\\frac{1}{3}=' || (bar && num.length === 1 && den.length === 1), `a fraction answer is stacked over its bar (${res.latex})`);
  ok(A.every(it => it.src.length === 0) && t.strokes.length === t.items.filter(it => !it.answer).reduce((n, it) => n + it.parts.filter(p => p.t === 'ink').reduce((m, p) => m + p.paths.length, 0), 0), 'answers carry no strokes and are left out of the tidied strokes');
}
{
  const e = compose('1\\div 3='), res = new Nib.Recognizer().recognize(e.strokes);
  if (res.latex.replace(/\s/g, '') === '1\\div3=') {
    for (const style of ['tidy', 'typeset']) {
      const t = style === 'tidy' ? Nib.neaten(e.strokes, { result: res, solve: true }) : Nib.typeset(e.strokes, { result: res, solve: true });
      const A = t.items.filter(it => it.answer), three = A.find(it => it.label === '3'), over = A.find(it => it.label === '-');
      ok(three && over && over.box[3] <= three.box[1] + 1 && over.box[0] <= three.box[0] + 1 && over.box[2] >= three.box[2] - 1, `${style}: 0.3 repeating has its bar over the 3`);
    }
  } else console.log('    (1 ÷ 3 misread this time: ' + res.latex + ')');
}
{
  // without solve, or without a trailing "=", nothing extra is drawn
  const e = compose('3+4='), res = new Nib.Recognizer().recognize(e.strokes);
  ok(!Nib.neaten(e.strokes, { result: res }).items.some(it => it.answer), 'no answers unless asked for');
  const e2 = compose('3+4=7'), r2 = new Nib.Recognizer().recognize(e2.strokes);
  ok(!Nib.neaten(e2.strokes, { result: r2, solve: true }).items.some(it => it.answer), 'a line that already has its answer gets none');
}
{
  // slanted writing: in the ink view the answer follows the slope of the line as written
  const t = 0.12;
  let st, res;
  for (let k = 0; k < 8; k++) {                  // a writer whose 12+30= reads right
    const e = compose('12+30=');
    st = e.strokes.map(s => s.map(p => [p[0], p[1] - t * p[0]]));
    res = new Nib.Recognizer().recognize(st);
    if (res.latex.replace(/\s/g, '') === '12+30=') break;
  }
  if (res.latex.replace(/\s/g, '') === '12+30=') {
    const items = inkPlan(st, res), A = items.filter(it => it.answer);
    const eq = res.symbols.find(s => s.label === '='), eqMid = eq.box.y + eq.box.h / 2;
    const ab = A.reduce((b, it) => [Math.min(b[0], it.box[0]), Math.min(b[1], it.box[1]), Math.max(b[2], it.box[2]), Math.max(b[3], it.box[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const expectMid = eqMid - t * ((ab[0] + ab[2]) / 2 - (eq.box.x + eq.box.w / 2));
    ok(Math.abs((ab[1] + ab[3]) / 2 - expectMid) < 0.45 * (ab[3] - ab[1]), `ink as written: the answer rises with the line (${((ab[1] + ab[3]) / 2).toFixed(1)} vs ${expectMid.toFixed(1)}, skew ${res.skew.toFixed(1)}°)`);
  } else console.log('    (slanted 12+30= misread: ' + res.latex + ')');
}
{
  // glyphs: the writer's own symbols first, the built-in hand for the rest; every built-in glyph is drawable
  const e = compose('2+5='), res = new Nib.Recognizer().recognize(e.strokes);
  const book = I.sampleBook(res, e.strokes, null), two = res.symbols.find(s => s.label === '2');
  ok(!two || book('2') === book('2') && book('2').length === two.strokes.length, "an answer's 2 is the writer's own 2");
  ok('0123456789.-+'.split('').every(ch => { const g = I.DEFAULT_GLYPHS[ch]; return g && g.length && g.every(s => s.length && s.every(p => isFinite(p[0]) && isFinite(p[1]))); }), 'the built-in hand has every digit, the point, minus and plus');
  ok(book('7') === I.DEFAULT_GLYPHS['7'] || res.symbols.some(s => s.label === '7'), 'a digit never written comes from the built-in hand');
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
