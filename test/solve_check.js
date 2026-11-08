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
  ['-1\\div 4=', '-0.25'], ['1.1\\times 1.1=', '1.21'], ['5/2=', '2\\frac{1}{2}'], ['1/3+1/3=', '\\frac{2}{3}'], ['16/3=', '5\\frac{1}{3}'], ['10/4=', '\\frac{5}{2}'],
  ['1\\div 44650=', '0.0000223\\ldots'], ['0.001\\div 3000=', '0.000000\\overline{3}'], ['1\\div 300=', '0.00\\overline{3}'],
  ['1\\div 1700=', '0.000588\\ldots'], ['2\\div 70001=', '0.0000285\\ldots'], ['3\\div 17=', '0.1764\\ldots'], ['0.99999999999999\\times 1=', '0.9999\\ldots'],
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
  ['7=', null], ['-7=', null], ['(7)=', null], ['0=', null], ['\\pi=', '3.141\\ldots'], ['-(-4)=', '4'], ['--4=', '4'], ['-(-(-2))=', '-2'],
  ['(-563)=', null], ['+(-3)=', null],
]);

section('5. percents');
table([
  ['15\\% of 80=', '12'], ['15\\%\\times 80=', '12'], ['20\\%\\times 45=', '9'], ['50\\%+25\\%=', '75\\%'], ['80+15\\%=', null], ['\\frac{20}{80}\\times 100\\%=', '25\\%'], ['0.125\\times 100\\%=', '12.5\\%'], ['\\frac{1}{3}\\times 100\\%=', '33\\frac{1}{3}\\%'], ['10\\%\\times 10\\%=', '0.01'],
  ['200\\times 15\\%=', '30'], ['15\\% x 60=', '9'],
]);

section('6. irrational answers are approximated, never passed off as exact');
table([
  ['\\sqrt{2}=', '1.414\\ldots'], ['2\\pi=', '6.283\\ldots'], ['\\pi\\times 3^{2}=', '28.274\\ldots'], ['\\pi-\\pi=', '0'],
  ['\\sqrt{2}\\times\\sqrt{2}=', '2'], ['\\sqrt{2}+\\sqrt{8}=', '4.242\\ldots'], ['2^{0.5}=', '1.414\\ldots'], ['4^{\\frac{1}{2}}=', '2'],
  ['8^{\\frac{2}{3}}=', '4'], ['(-8)^{\\frac{1}{3}}=', '-2'], ['-\\sqrt{3}=', '-1.732\\ldots'],
]);
ok(one('\\sqrt{2}=').exact === false && one('\\sqrt{4}=').exact === true && one('1\\div 17=').exact === false, 'approximate answers say so (exact: false)');

section('7. letters: like terms combined, brackets multiplied out');
table([
  ['3x+2x=', '5x'], ['2(x+3)-x=', 'x+6'], ['(x+1)^{2}=', 'x^{2}+2x+1'], ['x\\cdot x=', 'x^{2}'], ['x^{2}\\cdot x^{3}=', 'x^{5}'],
  ['(2x)^{2}=', '4x^{2}'], ['3(2a-4)=', '6a-12'], ['-(x-3)=', '-x+3'], ['2x+3y-x+y=', 'x+4y'], ['5-2(x+1)=', '-2x+3'],
  ['x+x+x=', '3x'], ['\\frac{6x+4}{2}=', '3x+2'], ['(6x+4)\\div 2=', '3x+2'], ['0.5x+0.25x=', '0.75x'], ['4(2x-1)+3=', '8x-1'],
  ['x-x=', '0'], ['3x-3x+5=', '5'], ['\\frac{1}{2}x+\\frac{1}{3}x=', '\\frac{5}{6}x'], ['(x+2)(x-2)=', 'x^{2}-4'], ['(x+1)(x+2)=', 'x^{2}+3x+2'],
  ['1x=', 'x'], ['0x+3=', '3'], ['x\\cdot 2=', '2x'], ['x4=', null], ['-x-x=', '-2x'], ['-5a+13a=', '8a'], ['\\theta+\\theta=', '2\\theta'],
  ['\\alpha\\cdot\\alpha=', '\\alpha^{2}'], ['x_{1}+x_{1}=', '2x_{1}'], ['\\frac{x}{2}+\\frac{x}{2}=', 'x'], ['2(x+3)+3(x-1)=', '5x+3'],
]);
section('   already as simple as it gets: no answer');
table([
  ['2x=', null], ['x+1=', null], ['3x^{2}-2x+1=', null], ['-5a+13=', null], ['x=', null], ['\\frac{1}{2}x=', null], ['ab=', null],
  ['-x+3=', null], ['3-x=', null], ['y-2x=', null],
]);
section('   things letters cannot do here: no answer');
table([
  ['\\frac{6}{x}=', null], ['x\\div x=', '1'], ['x^{-1}=', null], ['x^{0.5}=', null], ['2^{x}=', null], ['\\sqrt{x}=', null], ['|x|=', null],
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
table([['1,000+1=', '1001'], ['12,345+1=', '12346'], ['3+4=7+1=', null], ['2\\times 3=6\\times 2=', null], ['2(3+4)=2\\cdot 7=', '14'], ['3+4=7=', null], ['3 x 4=', '12'],
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
for (const r of withEq.slice(0, 90)) {
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
  // x² = 49, then x =: the ± answer is drawn after the "=" of the second line in every view
  let e = null, res = null;
  for (let k = 0; k < 30 && !e; k++) { const c = compose('x^{2}=49 \\\\ x='), r = new Nib.Recognizer().recognize(c.strokes, { times: false }); if (r.latex.replace(/\s/g, '') === '\\begin{gathered}x^{2}=49\\\\x=\\end{gathered}') { e = c; res = r; } }
  if (e) {
    for (const style of ['tidy', 'hand', 'typeset']) {
      const t = style === 'typeset' ? Nib.typeset(e.strokes, { result: res, solve: true, times: false }) : Nib.neaten(e.strokes, { style, result: res, solve: true, times: false });
      const A = t.items.filter(it => it.answer), pm = A.find(it => it.label === '\\pm'), seven = A.find(it => it.label === '7');
      ok(pm && seven && pm.box[2] <= seven.box[0] + 1 && A.every(it => it.parts.length), `${style}: x = ±7 is drawn, ± before the 7`);
    }
  } else console.log('    (no writer read x² = 49 / x = right; skipped)');
}
{
  // glyphs: the writer's own symbols first, the built-in hand for the rest; every built-in glyph is drawable
  const e = compose('2+5='), res = new Nib.Recognizer().recognize(e.strokes);
  const book = I.sampleBook(res, e.strokes, null), two = res.symbols.find(s => s.label === '2');
  ok(!two || book('2') === book('2') && book('2').length === two.strokes.length, "an answer's 2 is the writer's own 2");
  ok('0123456789.-+'.split('').concat(['\\pm']).every(ch => { const g = I.DEFAULT_GLYPHS[ch]; return g && g.length && g.every(s => s.length && s.every(p => isFinite(p[0]) && isFinite(p[1]))); }), 'the built-in hand has every digit, the point, minus, plus and ±');
  ok(I.DEFAULT_GLYPHS['\\pm'].length === 3, '± is a plus over a bar');
  ok(book('7') === I.DEFAULT_GLYPHS['7'] || res.symbols.some(s => s.label === '7'), 'a digit never written comes from the built-in hand');
}


// ------------------------------------------------------------------ equations: "x =" under an equation solves it
section('14. equations: write the equation, then "x =" on the line below');
const sol = (tex, want, opts) => {
  let got;
  try { const r = Nib.solve(tex, opts); got = r[r.length - 1]; got = got ? got.latex : null; } catch (e) { got = 'THREW ' + e.message; }
  ok(got === want, `${tex}  ->  ${got}   (want ${want})`);
};
for (const [t, w] of [
  ['x+5=12 \\\\ x=', '7'], ['x-3=-8 \\\\ x=', '-5'], ['4x=28 \\\\ x=', '7'], ['\\frac{x}{3}=5 \\\\ x=', '15'], ['x\\div 4=3 \\\\ x=', '12'],
  ['2x+3=11 \\\\ x=', '4'], ['-4x+1=-7 \\\\ x=', '2'], ['3x-7=-1 \\\\ x=', '2'], ['5-2x=11 \\\\ x=', '-3'], ['-x=4 \\\\ x=', '-4'],
  ['3(x-2)=2x+5 \\\\ x=', '11'], ['2(x+1)=3(x-1) \\\\ x=', '5'], ['5x-2=3x+8 \\\\ x=', '5'], ['7=2x+1 \\\\ x=', '3'], ['x=x\\cdot 2-6 \\\\ x=', '6'],
  ['3x=2 \\\\ x=', '\\frac{2}{3}'], ['4x=6 \\\\ x=', '\\frac{3}{2}'], ['-6x=4 \\\\ x=', '-\\frac{2}{3}'], ['\\frac{2}{3}x=4 \\\\ x=', '6'],
  ['x+\\frac{1}{2}=\\frac{3}{4} \\\\ x=', '\\frac{1}{4}'], ['1\\frac{1}{2}x=6 \\\\ x=', '4'], ['2x=1\\frac{1}{2} \\\\ x=', '\\frac{3}{4}'],
  ['2x=7\\frac{1}{2} \\\\ x=', '3\\frac{3}{4}'], ['0.5x+1.2=3.7 \\\\ x=', '5'], ['0.2x=1 \\\\ x=', '5'], ['3x=1.6 \\\\ x=', '0.5\\overline{3}'],
  ['1.5x-0.25=2 \\\\ x=', '1.5'], ['\\frac{x}{2}+3=7 \\\\ x=', '8'], ['\\frac{x+4}{3}=5 \\\\ x=', '11'], ['25\\%x=20 \\\\ x=', '80'],
  ['x^{2}=49 \\\\ x=', '\\pm 7'], ['x^{2}=\\frac{9}{16} \\\\ x=', '\\pm\\frac{3}{4}'], ['x^{2}=2.25 \\\\ x=', '\\pm 1.5'], ['2x^{2}=50 \\\\ x=', '\\pm 5'],
  ['x^{2}+1=50 \\\\ x=', '\\pm 7'], ['x^{2}=50 \\\\ x=', '\\pm 7.071\\ldots'], ['x^{2}=0 \\\\ x=', '0'], ['x^{3}=-8 \\\\ x=', '-2'], ['x^{3}=64 \\\\ x=', '4'],
  ['x^{3}=10 \\\\ x=', '2.154\\ldots'], ['x^{2}=-4 \\\\ x=', null], ['x+1=x+2 \\\\ x=', null], ['2x=2x \\\\ x=', null], ['x^{2}+5x+6=0 \\\\ x=', '-3,\\;-2'],
  ['\\pi x=10 \\\\ x=', '3.183\\ldots'], ['a+3=10 \\\\ a=', '7'], ['3n=12 \\\\ n=', '4'],
  // the nearest equation with the letter in it, and the working under it
  ['2x+3=11 \\\\ 2x=8 \\\\ x=', '4'], ['2x+3=11 \\\\ 5x-1=9 \\\\ x=', null], ['3x=12 \\\\ x=4 \\\\ y+2=7 \\\\ y=', '5'],
  ['2x+3=11 \\\\ x', null], ['x=', null], ['2x+3 \\\\ x=', null],
  // two or three letters: the equations that pin them down
  ['x+y=10 \\\\ x-y=2 \\\\ x=', '6'], ['x+y=10 \\\\ x-y=2 \\\\ y=', '4'], ['y=2x+1 \\\\ x=3 \\\\ y=', '7'], ['2x+y=7 \\\\ y=3 \\\\ x=', '2'],
  ['x+y=10 \\\\ x-y=2 \\\\ x=6 \\\\ y=', '4'], ['a+b+c=6 \\\\ a-b=1 \\\\ c=2 \\\\ a=', '\\frac{5}{2}'], ['x+y=10 \\\\ y=', '-x+10'], ['x+y=1 \\\\ 2x+2y=2 \\\\ x=', '-y+1'],
  ['y=2x+1 \\\\ y=', null], ['xy=6 \\\\ x=2 \\\\ y=', '3'],
  // inequalities: the number only when the sign written is the right one
  ['2x+3<11 \\\\ x<', '4'], ['2x+3<11 \\\\ x>', null], ['2x+3<11 \\\\ x=', null], ['-3x\\ge 12 \\\\ x\\le', '-4'], ['-3x\\ge 12 \\\\ x\\ge', null],
  ['11>2x+3 \\\\ x<', '4'], ['\\frac{x}{-2}>3 \\\\ x<', '-6'], ['x-5\\le 2 \\\\ x\\le', '7'], ['4x>2 \\\\ x>', '\\frac{1}{2}'], ['x+y<3 \\\\ x<', null],
  ['2x+3=11 \\\\ x<', null],
]) sol(t, w);
// what "x = 4" under the working of an equation does to the lines below
lines('2x+3=11 \\\\ x=4 \\\\ 3x+2x=', [null, null, '5x']);
lines('2x+3=11 \\\\ x=4 \\\\ 2x+3=', [null, null, '11']);
lines('x=4 \\\\ 5x-1=9 \\\\ 3x+2x=', [null, null, '5x']);
lines('x=4 \\\\ 2x+3=11 \\\\ x+1=', [null, null, '5']);
lines('x=3 \\\\ 2x+y=', [null, 'y+6']);
lines('x=2 \\\\ xy+y=', [null, '3y']);
{
  // an "x =" written further down than its equation (a separate piece of writing on a board) solves the one just above
  const up = I.solveRows(I.latexRows('2x+3=11 \\\\ 2x=8')), down = I.solveRows(I.latexRows('x='), {}, up.eqs);
  ok(up.eqs.length === 2 && down[0] && down[0].latex === '4', `x = under a separate piece of writing solves its equation (${down[0] && down[0].latex})`);
  const own = I.solveRows(I.latexRows('3x=6 \\\\ x='), {}, up.eqs);
  ok(own[1] && own[1].latex === '2', 'its own equation comes first');
  ok(I.solveRows(I.latexRows('x='), {}, []).every(a => a === null) && I.solveRows(I.latexRows('x=')).eqs.length === 0, 'nothing above: no answer');
}
ok(Nib.solve('x^{2}=49 \\\\ x=')[1].kind === 'plusminus' && Nib.solve('x^{2}=49 \\\\ x=')[1].text === '±7' && Nib.solve('2x+3=11 \\\\ x=')[1].kind === 'integer', 'a solution says what kind of number it is (±7: plusminus)');

section('15. what the review found: no guesses, no false digits, no crashes');
table([
  // ÷ takes a term with letters as a whole; dividing by letters has no answer
  ['6x\\div 3x=', '2'], ['6x/3x=', '2'], ['12a\\div 4a=', '3'], ['1\\div 2x=', null], ['8\\div 2x=', null], ['6x^{2}\\div 3x=', '2x'],
  ['(6x^{2}+3x)\\div 3x=', '2x+1'], ['\\frac{6x}{3x}=', '2'], ['12\\div 4\\pi=', '0.954\\ldots'], ['6\\div 2(1+2)=', '9'],
  // a number straight after a letter, bracket, power, percent or fraction is not how maths is written
  ['15\\%0880=', null], ['15\\%0+80=', null], ['15\\%0180=', null], ['x4=', null], ['(2)3=', null], ['2^{3}4=', null], ['\\frac{1}{2}3=', null],
  ['x\\frac{1}{2}=', null], ['2.5\\frac{1}{2}=', null],
  // "of" (and "0f", an o read as a zero)
  ['15\\%0f80=', '12'], ['\\frac{1}{2}0f10=', '5'], ['\\frac{3}{4} of 20=', '15'], ['1\\frac{1}{2} of 10=', '15'], ['(1+1) of 3=', '6'],
  // a cross between a number, fraction, power, root or bar and a number or fraction can be a times sign
  ['\\frac{2}{3} x 6=', '4'], ['3 x \\frac{1}{4}=', '\\frac{3}{4}'], ['2\\frac{1}{2} x 4=', '10'], ['2^{3} x 4=', '32'], ['\\sqrt{9} x 4=', '12'], ['|-3| x 4=', '12'],
  ['2x(3)=', '6x'], ['4x(2+3)=', '20x'],
  // units and words
  ['1m+50cm=', null], ['3ft\\times 4ft=', null], ['GCF(36,120)=', null], ['LCM(15,100)=', null], ['6CF(36,120)=', null], ['f(2,300)=', null], ['2(1,000)=', '2000'], ['5m+3m=', '8m'], ['2abc+abc=', '3abc'],
  // approximations: cut, never rounded up; never a false whole number or a false zero
  ['\\pi=', '3.141\\ldots'], ['\\sqrt{7}=', '2.645\\ldots'], ['r=3 \\\\ 2\\pi r=', '18.849\\ldots'], ['\\pi\\times 10^{9}=', '3141592653.589\\ldots'],
  ['\\pi\\times 659^{2}=', '1364333.999\\ldots'], ['\\sqrt{900000001}=', '30000.000\\ldots'], ['\\pi\\times 10^{-10}=', '0.000000000314\\ldots'],
  ['\\pi-3.141=', '0.000592\\ldots'], ['\\pi-3.14=', '0.00159\\ldots'], ['\\pi-3.14159265358979=', null], ['\\sqrt{2}-1.4142135623731=', null],
  ['\\sqrt{3}\\times\\sqrt{3}\\div 2=', '1.5'], ['\\pi\\div\\pi=', '1'], ['\\pi\\times 10^{-20}=', null],
  // powers
  ['2^3^2=', null], ['2^{3}^{2}=', null], ['(-1)^{2025}=', '-1'], ['(-1)^{2026}=', '1'], ['1^{99999}=', '1'], ['0^{5000}=', '0'],
  // already simplest, or not
  ['x+-3=', 'x-3'], ['2x--3=', '2x+3'], ['5--2x=', '2x+5'], ['\\frac{x+1}{2}=', null], ['\\frac{3x}{4}=', null], ['\\frac{2x+4}{2}=', 'x+2'],
  ['\\frac{-3}{4}=', '-0.75'], ['\\frac{3}{-4}=', '-0.75'], ['-\\frac{-3}{4}=', '\\frac{3}{4}'],
  // standard form with several letters
  ['(5x)=', null], ['((x+1))=', null], ['-(x+1)=', '-x-1'], ['2(x)=', '2x'],
  ['(a-b)^{2}=', 'a^{2}-2ab+b^{2}'], ['(x+y)^{2}=', 'x^{2}+2xy+y^{2}'], ['x(x+y)=', 'x^{2}+xy'], ['3y+2x-5+x=', '3x+3y-5'],
  // percents
  ['15\\%+5\\%=', '20\\%'], ['80+15\\%=', null], ['x+5\\%=', null], ['25\\%-75\\%=', '-50\\%'],
]);
ok((() => { try { for (const t of ['3+4=\\', '\\', '\\\n', '\\ ', '{'.repeat(20000), '\\sqrt{'.repeat(5000), 42, undefined, null, {}, [[]], '\\left(', '^{', '_']) Nib.solve(t); return true; } catch (e) { console.log('   ', e.message); return false; } })(), 'nothing throws: lone backslashes, deep nesting, numbers, objects');
ok(JSON.stringify(Nib.solve('3+4= \\\\ {2+2= \\\\ 5+5=').map(a => a && a.latex)) === '["7",null,"10"]', 'a line that cannot be read leaves the lines around it');
ok(JSON.stringify(Nib.solve(42)) === '[null]' && JSON.stringify(Nib.solve({})) === '[]', 'a number is read as LaTeX; an object that is not a reading has no lines');
{
  let wrongCut = 0;
  for (let n = 1; n <= 400; n++) for (const d of [7, 13, 17, 19, 23, 29, 31, 37, 41, 43, 97]) {
    const a = one(`${n}\\div ${d}=`);
    if (!a || !/ldots/.test(a.latex)) continue;
    const m = /^(\d+)\.(\d+)\\ldots$/.exec(a.latex), shown = m && +(m[1] + '.' + m[2]);
    if (!m || !(shown <= n / d + 1e-12 && n / d < shown + Math.pow(10, -m[2].length) + 1e-12)) wrongCut++;
  }
  ok(wrongCut === 0, `long decimals are cut, never rounded up (${wrongCut} wrong)`);
}

section('16. x is a letter (times: false): multiply with a dot or brackets');
const X = { times: false };
for (const [t, w] of [
  ['3x4=', null], ['4x2+3x2=', null], ['3 x \\frac{1}{4}=', null], ['(2+3) x 4=', null], ['15\\% x 60=', null],
  ['2x(x+5)=', '2x^{2}+10x'], ['x\\cdot x=', 'x^{2}'], ['(x+2)(x-3)=', 'x^{2}-x-6'], ['6x\\cdot 2=', '12x'], ['121\\cdot 21=', '2541'],
  ['(121)(21)=', '2541'], ['12(3)=', '36'], ['-3(2x-4)=', '-6x+12'], ['5x-2(x+1)=', '3x-2'], ['2\\cdot x+5x=', '7x'], ['3\\times 4=', '12'],
  ['x^{2}\\cdot x^{3}=', 'x^{5}'], ['2x\\cdot 3x=', '6x^{2}'], ['(2x)(3x)=', '6x^{2}'], ['x(x-1)(x+1)=', 'x^{3}-x'],
  ['2x+3=11 \\\\ x=', '4'], ['3(x+2)=x+10 \\\\ x=', '2'],
]) sol(t, w, X);
ok(Nib.solve('3 x 4=')[0] && Nib.solve('3 x 4=')[0].latex === '12', 'by default a cross between numbers is still a times sign');


section('17. what the second review found: a slip in the working, lines that cannot be read, formulas, fractions with x underneath');
for (const [t, w] of [
  // a line with x in it that cannot be worked out stands in the way; so does working that does not agree with itself
  ['5x=20 \\\\ \\frac{12}{x}=4 \\\\ x=', null], ['5x=20 \\\\ |x|=5 \\\\ x=', null], ['5x=20 \\\\ \\sqrt{x}=4 \\\\ x=', null], ['5x=20 \\\\ 2^{x}=8 \\\\ x=', null],
  ['5x=20 \\\\ 3x=4+5=9 \\\\ x=', null], ['5x=20 \\\\ -3<2x+1<7 \\\\ x<', null], ['2x+3=11 \\\\ 2x=14 \\\\ x=', null], ['-3x\\ge 12 \\\\ 3x\\ge -12 \\\\ x\\ge', null],
  ['-3x\\ge 12 \\\\ 3x\\ge -12 \\\\ x\\le', null], ['-2x+5<11 \\\\ 2x<-6 \\\\ x<', null], ['-3x\\ge 12 \\\\ x\\le -4 \\\\ x\\le', '-4'], ['2x+3=11 \\\\ x=4 \\\\ x=', '4'],
  ['2x+3=11 \\\\ x=5 \\\\ x=', null], ['2x+3<11 \\\\ x=4 \\\\ x<', '4'], ['x=4 \\\\ 2x+3=11 \\\\ x=', '4'], ['2x+3=11 \\\\ x=4 \\\\ \\frac{12}{x}=4 \\\\ x=', '3'],
  // fractions with x underneath: proportions; a value that would divide by zero is no answer
  ['\\frac{12}{x}=4 \\\\ x=', '3'], ['\\frac{3}{x}=\\frac{6}{10} \\\\ x=', '5'], ['\\frac{x}{4}=\\frac{5}{2} \\\\ x=', '10'], ['\\frac{x+1}{x-1}=3 \\\\ x=', '2'],
  ['12\\div 3x=2 \\\\ x=', '2'], ['\\frac{2}{x}=0 \\\\ x=', null], ['\\frac{6x}{3x}+x=2 \\\\ x=', null], ['\\frac{x^{2}}{x}=0 \\\\ x=', null], ['x\\div x+x=1 \\\\ x=', null],
  ['\\frac{1}{x}<2 \\\\ x>', null], ['\\frac{x}{2}<3 \\\\ x<', '6'],
  // formulas with values given below them
  ['d=rt \\\\ r=60 \\\\ t=2 \\\\ rt=', '120'], ['P=2l+2w \\\\ l=5 \\\\ w=3 \\\\ 2l+2w=', '16'], ['I=prt \\\\ p=100 \\\\ r=0.05 \\\\ t=2 \\\\ prt=', '10'],
  ['A=\\frac{1}{2}bh \\\\ b=6 \\\\ h=4 \\\\ \\frac{1}{2}bh=', '12'], ['A=lw \\\\ l=5 \\\\ w=3 \\\\ A=', '15'], ['d=rt \\\\ r=60 \\\\ t=2 \\\\ d=', '120'],
  ['x+y=10 \\\\ x-y=2 \\\\ x=5 \\\\ y=', null], ['x+y=10 \\\\ x-y=2 \\\\ x=6 \\\\ y=', '4'], ['x+y=10 \\\\ 5x=1 \\\\ y=', '\\frac{49}{5}'],
  // a contradiction is not a new value; percents of what
  ['x=3 \\\\ x=x+1 \\\\ x+2=', null], ['x=3 \\\\ x=2x \\\\ x+1=', null], ['x+15\\%=80 \\\\ x=', null], ['x=80+15\\% \\\\ x=', null], ['x-20\\%=40 \\\\ x=', null],
  ['20\\%x=40 \\\\ x=', '200'], ['x+15\\%x=92 \\\\ x=', '80'],
  // 2/3x is two thirds of x; f(2) is function notation
  ['2/3x=4 \\\\ x=', '6'], ['x=4 \\\\ 2/3x=', '\\frac{8}{3}'], ['1/2x+1/2x=', 'x'], ['-2/3x=4 \\\\ x=', '-6'], ['2/3^{2}=', '\\frac{2}{9}'], ['f(2)=', null],
  ['f(x)=2x+3 \\\\ f(2)=', null], ['3(2)=', '6'], ['x(x+1)=', 'x^{2}+x'], ['\\pi(2)=', '6.283\\ldots'],
  // chains, approximations, forms
  ['1\\div 0=2+3=', null], ['\\sqrt{-4}=2+3=', null], ['3+=2+3=', null], ['3+4=x+2x=', null], ['\\pi=3.141592654=', null], ['A=lw=3\\cdot 4=', '12'],
  ['\\pi\\times 10^{11}=', '314159265358.979\\ldots'], ['\\sqrt{2}\\times 10^{12}=', '1414213562373.09\\ldots'], ['\\frac{\\pi\\cdot 7^{2}}{\\pi\\cdot 50^{2}}=', '\\frac{49}{2500}'],
  ['\\pi\\cdot 7^{2}\\div(\\pi\\cdot 50^{2})=', '0.0196'], ['\\sqrt{3}\\times\\frac{\\sqrt{3}}{2500}=', '\\frac{3}{2500}'], ['\\pi-3.141592653589793=', null],
  ['\\sqrt{2}-1.4142135623730951=', null], ['2\\pi-\\pi-\\pi=', '0'], ['x=10\\div 4 \\\\ x=', '2.5'], ['(15\\%+5\\%)=', '20\\%'],
]) sol(t, w, X);


section('18. what the board showed: misreadings that must not become answers');
ok(Nib.solve({ tree: [[{ k: 's', label: '7' }, { k: 's', label: '+' }, { k: 's', label: '-', doubt: true }, { k: 's', label: '1', doubt: true }, { k: 's', label: '2' }, { k: 's', label: '=' }]] })[0] === null,
  'a reading with two symbols stacked but read side by side (½ read as −12) gets no answer');
for (const [t, w] of [['5++2x=', null], ['3++4=', null], ['x+-3=', 'x-3'], ['+5+2=', '7'], ['(+3)+2=', '5']]) sol(t, w, X);
{
  // a fraction whose bar the reader missed: the 1 and the 2 stacked are never read as 12
  const { compose } = require('./compose.js');
  let tried = 0, answered = [];
  for (let k = 0; k < 12; k++) {
    const e = compose('7+\\frac{1}{2}='), bar = e.symbols.find(s => s.label === '-');
    if (!bar) continue;
    const st = e.strokes.filter((_, i) => !bar.strokes.includes(i)), r = new Nib.Recognizer().recognize(st, X), a = Nib.solve(r, X)[0];
    tried++;
    // (what is left may still make a ½: a 1 written with a foot long enough to be a bar is read 1 over 2 again)
    if (a && !(r.latex === '7+\\frac{1}{2}=' && a.latex === '\\frac{15}{2}')) answered.push(r.latex + ' = ' + a.latex);
  }
  ok(tried >= 8 && answered.length === 0, `½ with its bar taken away is never answered as anything but 7½ (${tried} writers${answered.length ? '; answered: ' + answered.join(', ') : ''})`);
}
{
  // a times dot between two fractions is a times dot, not a minus
  const { compose } = require('./compose.js');
  let n = 0, minus = 0;
  for (let k = 0; k < 16; k++) {
    const e = compose('\\frac{2}{3}\\cdot\\frac{3}{4}='), r = new Nib.Recognizer().recognize(e.strokes, X);
    if (!/\\frac\{2\}\{3\}.*\\frac\{3\}\{4\}/.test(r.latex)) continue;
    n++;
    if (/\\frac\{2\}\{3\}-\\frac\{3\}\{4\}/.test(r.latex)) minus++;
  }
  ok(n >= 8 && minus === 0, `a dot between fractions is read as times (${minus} of ${n} read as minus)`);
}

section('19. a real board: the strokes of Croix\'s screenshot of 4 Nov, piece by piece (the Board itself: test/board_browser.js)');
{
  const F = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'board_2026-11-04.json'), 'utf8'));
  // the problems the Board finds on it (its own clustering), each read on its own
  const pieces = Nib._internals.clustersOf(F.strokes).map(g => g.map(i => F.strokes[i]));
  const read = pieces.map(st => { const r = new Nib.Recognizer().recognize(st, X), a = Nib.solve(r, X); return { latex: r.latex, answer: a.map(x => x && x.latex) }; });
  const has = (tex, ans) => read.some(p => p.latex === tex && p.answer.length === 1 && p.answer[0] === ans);
  for (const [tex, ans] of [['7+7=', '14'], ['13+4=', '17'], ['7+\\frac{1}{2}=', '\\frac{15}{2}'], ['\\sqrt{14}=', '3.741\\ldots'], ['3.741^{2}=', '13.995081'], ['5x+2x=', '7x']])
    ok(has(tex, ans), `${tex} ${ans}  (read: ${read.filter(p => p.answer.some(Boolean) || /=$/.test(p.latex)).map(p => p.latex + (p.answer[0] ? ' ' + p.answer[0] : '')).join(', ')})`.slice(0, 400));
  ok(read.filter(p => p.latex === '14^{2}=' && p.answer[0] === '196').length === 2 && read.filter(p => p.latex === '7-7=' && p.answer[0] === '0').length === 2, 'both 14² = 196 and both 7 − 7 = 0');
  const bad = read.filter(p => p.answer.some(a => a === '9' || a === '-5' || a === '2x+5' || a === '5'));
  ok(bad.length === 0, 'none of the wrong answers that board showed (or 5 for 7 + ½) comes back' + (bad.length ? ': ' + bad.map(p => p.latex + ' ' + p.answer).join(', ') : ''));
}
{
  // ½ written lopsided: the 2 running out past the end of a short bar, the 1 high over its left end
  const { compose } = require('./compose.js');
  const shift = (e, pick, dx, dy) => { const ix = new Set(pick.strokes); return e.strokes.map((s, i) => ix.has(i) ? s.map(p => [p[0] + dx, p[1] + dy]) : s); };
  const box = (e, sy) => { let b = [Infinity, Infinity, -Infinity, -Infinity]; for (const i of sy.strokes) for (const p of e.strokes[i]) b = [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])]; return b; };
  let tried = 0, right = 0; const other = [], worse = [];
  const answers = st => { const r = new Nib.Recognizer().recognize(st, X); return { latex: r.latex, a: Nib.solve(r, X).filter(Boolean).map(x => x.latex) }; };
  for (let k = 0; k < 30 && tried < 16; k++) {
    const e = compose('7+\\frac{1}{2}=');
    const bar = e.symbols.find(s => s.label === '-'), one = e.symbols.find(s => s.label === '1'), two = e.symbols.find(s => s.label === '2');
    if (!bar || !one || !two) continue;
    const bb = box(e, bar), w = bb[2] - bb[0], b1 = box(e, one), b2 = box(e, two), h1 = b1[3] - b1[1];
    if (new Nib.Recognizer().recognize(e.strokes, X).latex !== '7+\\frac{1}{2}=') continue;     // writers read right as written
    tried++;
    // as on that board: the 1 over the left end of the bar, its own height above it; the 2 under the right half and
    // past the end
    const lift = (bb[1] - 0.9 * h1) - b1[3];
    let st = shift(e, two, (bb[0] + 0.55 * w) - b2[0], 0);
    st = shift({ strokes: st }, one, (bb[0] + 0.05 * w) - b1[0], lift);
    const r = answers(st);
    if (r.latex === '7+\\frac{1}{2}=' && r.a.length === 1 && r.a[0] === '\\frac{15}{2}') right++;
    else if (r.a.length) other.push(r.latex + ' ' + r.a.join(', '));
    // further still, the 2 nearly off the end of the bar: whatever is read, no answer but 15/2
    let st2 = shift(e, two, (bb[2] - 0.12 * (b2[2] - b2[0])) - b2[0], 0);
    st2 = shift({ strokes: st2 }, one, (bb[0] + 0.05 * w) - b1[0], lift);
    const r2 = answers(st2);
    if (r2.a.some(x => x !== '\\frac{15}{2}')) worse.push(r2.latex + ' ' + r2.a.join(', '));
  }
  ok(tried >= 10 && right >= 0.75 * tried, `a lopsided ½ is still ½: 7 + ½ = 15/2 for ${right} of ${tried} writers`);
  ok(other.length === 0, 'and no other answer' + (other.length ? ': ' + other.join('; ') : ''));
  ok(worse.length === 0, 'a ½ too lopsided to read is never answered as something else (7 + −2 = 5)' + (worse.length ? ': ' + worse.join('; ') : ''));
  // a minus is not a fraction bar for what sits beside it, nor for writing on the lines above and below
  sol('7-12=', '-5', X);
}

section('20. Algebra 1: quadratics, rearranging formulas, slope, repeating decimals, the Pythagorean theorem, scientific notation');
for (const [t, w] of [
  // quadratics with "x =" under them: rational roots smallest first, a repeated root once, roots that are not
  // rational in simplest radical form, no real roots no answer
  ['x^{2}+5x+6=0 \\\\ x=', '-3,\\;-2'], ['x^{2}=-5x-6 \\\\ x=', '-3,\\;-2'], ['2x^{2}=8x \\\\ x=', '0,\\;4'], ['x(x-3)=10 \\\\ x=', '-2,\\;5'],
  ['(x+1)(x-2)=4 \\\\ x=', '-2,\\;3'], ['x^{2}-4x+4=0 \\\\ x=', '2'], ['x^{2}+3x+1=0 \\\\ x=', '\\frac{-3\\pm\\sqrt{5}}{2}'],
  ['x^{2}+4x+2=0 \\\\ x=', '-2\\pm\\sqrt{2}'], ['x^{2}-2x-11=0 \\\\ x=', '1\\pm 2\\sqrt{3}'], ['2x^{2}+2x-1=0 \\\\ x=', '\\frac{-1\\pm\\sqrt{3}}{2}'],
  ['x^{2}+x-1=0 \\\\ x=', '\\frac{-1\\pm\\sqrt{5}}{2}'], ['3x^{2}-2x-2=0 \\\\ x=', '\\frac{1\\pm\\sqrt{7}}{3}'],
  ['x^{2}+2x+5=0 \\\\ x=', null], ['x^{2}+x+1=0 \\\\ x=', null], ['2x^{2}+x-1=0 \\\\ x=', '-1,\\;\\frac{1}{2}'], ['4x^{2}-1=0 \\\\ x=', '\\pm\\frac{1}{2}'],
  ['x^{2}-0.5x-0.5=0 \\\\ x=', '-0.5,\\;1'], ['0.5x^{2}+x-4=0 \\\\ x=', '-4,\\;2'], ['\\frac{1}{2}x^{2}-\\frac{1}{2}=0 \\\\ x=', '\\pm 1'],
  ['x^{2}+6x=-9 \\\\ x=', '-3'], ['m^{2}-m=6 \\\\ m=', '-2,\\;3'], ['x+\\frac{6}{x}=5 \\\\ x=', '2,\\;3'], ['\\frac{x^{2}-1}{x-1}=0 \\\\ x=', null],
  // the working under it must agree, and two different quadratics are not one
  ['x^{2}+5x+6=0 \\\\ (x+2)(x+3)=0 \\\\ x=', '-3,\\;-2'], ['x^{2}+5x+6=0 \\\\ (x+2)(x-3)=0 \\\\ x=', null],
  // still no answer: an inequality, a cube, a quadratic with no "x =" under it, π in it
  ['x^{2}+5x+6<0 \\\\ x<', null], ['x^{3}+x=2 \\\\ x=', null], ['x^{2}+5x+6=', null], ['x^{2}+\\pi x=0 \\\\ x=', null],
  // x² = p as before: ± and a decimal when it does not come out
  ['x^{2}=49 \\\\ x=', '\\pm 7'], ['x^{2}=50 \\\\ x=', '\\pm 7.071\\ldots'],
  // rearranging: the asked letter to the first power, never underneath; a number to divide by gives a polynomial, letters
  // a single fraction
  ['2x+3y=12 \\\\ y=', '-\\frac{2}{3}x+4'], ['y-3=2(x-1) \\\\ y=', '2x+1'], ['A=lw \\\\ w=', '\\frac{A}{l}'], ['P=2l+2w \\\\ l=', '\\frac{1}{2}P-w'],
  ['d=rt \\\\ t=', '\\frac{d}{r}'], ['y=mx+b \\\\ x=', '\\frac{y-b}{m}'], ['y=mx+b \\\\ b=', '-mx+y'], ['A=\\frac{1}{2}bh \\\\ h=', '\\frac{2A}{b}'],
  ['I=prt \\\\ r=', '\\frac{I}{pt}'], ['A=\\frac{1}{2}(b_{1}+b_{2})h \\\\ h=', '\\frac{2A}{b_{1}+b_{2}}'], ['y=2x+1 \\\\ x=', '\\frac{1}{2}y-\\frac{1}{2}'],
  ['x+y=10 \\\\ y=', '-x+10'], ['3x-y=7 \\\\ y=', '3x-7'], ['0.5x+y=2 \\\\ y=', '-0.5x+2'], ['xy=6 \\\\ y=', '\\frac{6}{x}'],
  ['A=lw \\\\ l=5 \\\\ w=', '\\frac{1}{5}A'], ['A=lw \\\\ l=5 \\\\ A=', null],
  // working that rearranges step by step must agree; equations side by side that disagree are a system, not working
  ['2x+3y=12 \\\\ 3y=-2x+12 \\\\ y=', '-\\frac{2}{3}x+4'], ['2x+3y=12 \\\\ 3y=-2x+10 \\\\ y=', null], ['xy=6 \\\\ x+y=5 \\\\ y=', null],
  ['x+y=1 \\\\ 2x+2y=2 \\\\ x=', '-y+1'], ['x+y=10 \\\\ x-y=2 \\\\ y=', '4'], ['x+y+z=6 \\\\ x-z=2 \\\\ y=', null],
  // no answer: already solved for it, squared, underneath, nothing else to write it with, a bottom that might cancel
  ['y=2x+1 \\\\ y=', null], ['x^{2}+y^{2}=25 \\\\ y=', null], ['A=\\pi r^{2} \\\\ r=', null], ['\\frac{1}{x}+y=2 \\\\ x=', null], ['xy=0 \\\\ y=', null],
  ['(a+b)y=a^{2}-b^{2} \\\\ y=', null], ['ay+by=a+b \\\\ y=', null], ['C=2\\pi r \\\\ r=', null], ['x+y<3 \\\\ x<', null],
  // slope: the formula, point-slope, slope-intercept with x given, subscripted letters given above
  ['m=\\frac{5-1}{3-1} \\\\ m=', '2'], ['y=\\frac{1}{2}x+3 \\\\ x=4 \\\\ y=', '5'], ['y=-\\frac{2}{3}x+4 \\\\ x=6 \\\\ y=', '0'],
  ['x_{1}=1 \\\\ y_{1}=3 \\\\ x_{2}=4 \\\\ y_{2}=9 \\\\ m=\\frac{y_{2}-y_{1}}{x_{2}-x_{1}} \\\\ m=', '2'],
  ['x_{1}=1 \\\\ y_{1}=3 \\\\ x_{2}=4 \\\\ y_{2}=9 \\\\ \\frac{y_{2}-y_{1}}{x_{2}-x_{1}}=', '2'], ['x_{1}=-2 \\\\ y_{1}=1 \\\\ x_{2}=4 \\\\ y_{2}=-3 \\\\ \\frac{y_{2}-y_{1}}{x_{2}-x_{1}}=', '-\\frac{2}{3}'],
  ['y_{1}=3 \\\\ y_{2}=9 \\\\ y_{2}-y_{1}=', '6'],
  // the Pythagorean theorem: c² = 25 says c = ±5, so that is the answer; √25 is 5
  ['a^{2}+b^{2}=c^{2} \\\\ a=3 \\\\ b=4 \\\\ c=', '\\pm 5'], ['c^{2}=25 \\\\ c=', '\\pm 5'], ['\\sqrt{25}=', '5'], ['a=3 \\\\ b=4 \\\\ \\sqrt{a^{2}+b^{2}}=', '5'],
  ['a^{2}+b^{2}=c^{2} \\\\ a=5 \\\\ c=13 \\\\ b=', '\\pm 12'],
]) sol(t, w, X);
// repeating decimals (a bar over the digits that repeat) and scientific notation, × a times sign as usual
table([
  ['0.\\overline{3}=', '\\frac{1}{3}'], ['0.1\\overline{6}=', '\\frac{1}{6}'], ['2.\\overline{45}=', '2\\frac{5}{11}'], ['0.\\overline{9}=', '1'],
  ['.\\overline{6}=', '\\frac{2}{3}'], ['-0.\\overline{3}=', '-\\frac{1}{3}'], ['0.\\overline{142857}=', '\\frac{1}{7}'], ['1.2\\overline{3}=', '1\\frac{7}{30}'],
  ['0.\\overline{3}+0.\\overline{3}=', '0.\\overline{6}'], ['0.\\overline{3}\\times 3=', '1'], ['\\overline{3}=', null], ['3\\overline{3}=', null],
  ['0.\\overline{x}=', null], ['0.\\overline{3}4=', null],
  ['3.2\\times 10^{4}=', '32000'], ['(3\\times 10^{4})(2\\times 10^{3})=', '60000000'], ['\\frac{6\\times 10^{5}}{3\\times 10^{2}}=', '2000'],
  ['4.5\\times 10^{-3}=', '0.0045'], ['(3\\cdot 10^{4})(2\\cdot 10^{3})=', '60000000'], ['(2.5\\times 10^{3})\\times(4\\times 10^{-5})=', '0.1'],
]);
lines('0.\\overline{3}=\\frac{1}{3} \\\\ 0.\\overline{6}=', [null, '\\frac{2}{3}']);
{
  const q = Nib.solve('x^{2}+5x+6=0 \\\\ x=')[1], r = Nib.solve('x^{2}+3x+1=0 \\\\ x=')[1], l = Nib.solve('y=mx+b \\\\ x=')[1];
  ok(q.kind === 'roots' && q.text === '-3, -2' && q.exact && r.kind === 'radical' && r.text === '(-3±√5)/2' && r.exact && l.kind === 'expression' && l.text === '(y-b)/m',
    `the kinds and text of the new answers (${q.kind} ${q.text}; ${r.kind} ${r.text}; ${l.kind} ${l.text})`);
  ok(Nib.solve('x^{2}+5x+6=0 \\\\ x=', X)[1].latex === '-3,\\;-2' && Nib.solve('0.\\overline{3}=')[0].kind === 'fraction', 'the same with x a letter; a repeating decimal is a fraction');
}
{
  // written by hand: whenever the writing is read right, the answer is the one for the LaTeX
  const strip = s => s.replace(/\s+/g, '').replace(/^\\begin\{gathered\}|\\end\{gathered\}$/g, '');
  const HW = ['x^{2}+5x+6=0 \\\\ x=', 'x^{2}-4x+4=0 \\\\ x=', 'x^{2}+3x+1=0 \\\\ x=', 'x(x-3)=10 \\\\ x=', '2x+3y=12 \\\\ y=', 'y-3=2(x-1) \\\\ y=', 'd=rt \\\\ t=', 'A=lw \\\\ w='];
  let read = 0, wrong = [];
  for (const p of HW) for (let k = 0; k < 6; k++) {
    const e = compose(p), r = new Nib.Recognizer().recognize(e.strokes, X), a = Nib.solve(r, X).pop(), want = Nib.solve(p, X).pop();
    if (strip(r.latex) !== strip(p)) continue;
    read++;
    if (!a || !want || a.latex !== want.latex) wrong.push(p + ' -> ' + (a ? a.latex : 'none'));
  }
  ok(wrong.length === 0 && read >= 0.6 * 6 * HW.length, `quadratics and rearranging by hand: right whenever read right (${read} of ${6 * HW.length} read right${wrong.length ? '; wrong: ' + wrong.join(', ') : ''})`);
}
{
  // the new answers drawn in every view: a radical over a number with ± in a fraction, a list with a comma, letters
  ok([',', ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'].every(ch => { const g = I.DEFAULT_GLYPHS[ch]; return g && g.length && g.every(s => s.length >= 2 && s.every(p => isFinite(p[0]) && isFinite(p[1]))); }),
    'the built-in hand has a comma and every letter');
  const inkX = (st, res) => {
    const plan = I.planOf(res, st, I.tidyProvider(), { answers: I.solveRows(res.tree, X).map(a => a && a.nodes), answersOnly: true, sample: I.sampleBook(res, st, null) });
    return I.drawablesOf(plan).map(it => I.unlevel(it, plan.t || 0, plan.c0 || 0));
  };
  const drawn = (p, need) => {
    for (let k = 0; k < 30; k++) {
      const e = compose(p), res = new Nib.Recognizer().recognize(e.strokes, X);
      if (res.latex.replace(/\s/g, '') !== '\\begin{gathered}' + p.replace(/\s/g, '') + '\\end{gathered}') continue;
      for (const style of ['tidy', 'hand', 'typeset', 'ink']) {
        const items = style === 'ink' ? inkX(e.strokes, res)
          : style === 'typeset' ? Nib.typeset(e.strokes, { result: res, solve: true, times: false }).items : Nib.neaten(e.strokes, { style, result: res, solve: true, times: false }).items;
        const A = items.filter(it => it.answer), eq = items.filter(it => !it.answer && it.label === '=').pop();
        const fine = A.length && A.every(it => it.parts.length && it.box.every(isFinite)) && need.every(l => A.some(it => it.label === l)) && (!eq || A.every(it => it.box[0] > eq.box[2] - 1));
        ok(fine, `${style}: ${p} is drawn after its "=" with ${need.join(' ')} (${A.map(it => it.label).join(' ')})`);
      }
      return;
    }
    console.log(`    (no writer read ${p} right; skipped)`);
  };
  drawn('x^{2}+3x+1=0 \\\\ x=', ['\\pm', '\\sqrt', '-', '3', '5', '2']);
  drawn('x^{2}+5x+6=0 \\\\ x=', [',', '-', '3', '2']);
  drawn('2x+3y=12 \\\\ y=', ['-', 'x', '4']);
  // a letter the board has no clear instance of comes from the built-in hand: the answer is still drawn
  const e = compose('y='), res = new Nib.Recognizer().recognize(e.strokes, X);
  const nodes = I.solveRows(I.latexRows('2x+3y=12 \\\\ y=')).map(a => a && a.nodes)[1], rad = I.solveRows(I.latexRows('x^{2}+3x+1=0 \\\\ x=')).map(a => a && a.nodes)[1];
  if (res.latex.replace(/\s/g, '') === 'y=') {
    for (const [nm, ns] of [['-2/3 x + 4', nodes], ['(-3 ± √5)/2', rad]]) for (const style of ['tidy', 'hand', 'typeset']) {
      const opts = { result: res, answers: [ns], sample: l => I.DEFAULT_GLYPHS[l] || null };
      const t = style === 'typeset' ? Nib.typeset(e.strokes, opts) : Nib.neaten(e.strokes, Object.assign({ style }, opts)), A = t.items.filter(it => it.answer);
      ok(A.length >= 5 && A.every(it => it.parts.length && it.box.every(isFinite)), `${style}: ${nm} drawn with only the built-in hand (${A.map(it => it.label).join(' ')})`);
    }
  } else console.log('    (y= misread: ' + res.latex + ')');
}

section('21. the first training file (Croix, tablet, 7 Nov): his open 4s, dots written as tiny rings, 111 in a cube root');
{
  const T = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'training_2026-11-07.json'), 'utf8'));
  const rd = i => { const r = T.records[i], res = new Nib.Recognizer().recognize(r.strokes.map(s => s.map(p => [p[0], p[1]])), X); return { latex: res.latex, answer: Nib.solve(res, X).map(a => a && a.latex) }; };
  for (const [i, tex, ans] of [[14, '37(17x)-4+2=', '629x-2'], [20, '7+4=', '11'], [27, '144\\cdot 69=', '9936'], [28, '144\\cdot 69=', '9936'], [30, '144\\cdot 69=', '9936'], [31, '4+2=', '6']]) {
    const r = rd(i); ok(r.latex === tex && r.answer[0] === ans, `#${i}: ${tex} ${ans}  (read ${r.latex} ${r.answer[0]})`);
  }
  ok(rd(25).latex === '144', `#25: 144 written with open 4s (read ${rd(25).latex})`);
  ok(rd(2).latex === '\\sqrt[3]{111}' && rd(5).latex === '\\sqrt[3]{111}', `#2, #5: the cube root of 111 (read ${rd(2).latex}, ${rd(5).latex})`);
  ok(rd(26).latex === '\\cdot 49=' || rd(26).latex === '\\cdot 69=', `#26: a dot written as a tiny ring is a times dot (read ${rd(26).latex})`);
  // every record that was read right stays right
  let same = 0, n = 0;
  for (const [i, r] of T.records.entries()) { if (r.strokes.length < 4 || [2, 5, 14, 20, 25, 26, 27, 28].includes(i)) continue; n++; if (rd(i).latex === r.latex) same++; }
  ok(same === n, `the ${n} records read right on the tablet still read the same (${same})`);
  // the open 4 and the tiny ring with composed writers: nothing lost
  const { compose } = require('./compose.js');
  const cnt = (tex, N) => { let k = 0; for (let i = 0; i < N; i++) if (new Nib.Recognizer().recognize(compose(tex).strokes, X).latex === tex) k++; return k; };
  const c4 = cnt('14+4=', 40), c0 = cnt('10\\cdot 2=', 40), c1 = cnt('|1|=', 40), c2 = cnt('111=', 40);
  ok(c4 >= 36, `14 + 4 = still reads for ${c4} of 40 writers`);
  ok(c0 >= 34, `10 · 2 = (a real 0 next to a dot) reads for ${c0} of 40 writers`);
  ok(c1 >= 30 && c2 >= 34, `|1| reads for ${c1} of 40 and 111 for ${c2} of 40`);
}

section('22. the second training file (the drill, 7 Nov): verified prompts read right; 2·22+2= is one piece of writing, not three');
{
  const T = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'training_2026-11-07b.json'), 'utf8'));
  const pts = r => r.strokes.map(s => s.map(p => [p[0], p[1]]));
  const rd = i => new Nib.Recognizer().recognize(pts(T.records[i]), X).latex;
  // a prompt he had to Fix on the tablet (items 2 and 4: a 1 read as a bracket, his 6 — a long slanted stem with a
  // small loop — read as a 4) was right there only with the browser's memory of the fix: those read raw here for the record
  const fixedItems = new Set(T.records.filter(r => r.fixed.length).map(r => r.item));
  for (const [i, r] of T.records.entries()) if (r.verified && !fixedItems.has(r.item)) ok(rd(i) === r.expect, `#${i} (prompt ${r.item}): ${r.expect}  (read ${rd(i)})`);
  for (const [i, r] of T.records.entries()) if (r.verified && fixedItems.has(r.item)) console.log(`    (#${i}, prompt ${r.item}, right after a Fix on the tablet: ${r.expect}, reads raw as ${rd(i)})`);
  // item 7 as he wrote it: the final record (2·22+2, the = undone) with the = put back where it was (from the "2=" piece)
  const main = pts(T.records[68]), eq = pts(T.records[67]).slice(1).map(s => s.map(p => [p[0] + 299, p[1] + 18]));
  const all = main.concat(eq);
  // the Board's way: pieces by nearness, each read, then pieces ending or beginning in an operator joined and read again
  const pieces = strokes => {
    let groups = I.clustersOf(strokes);
    const read = gs => gs.map(g => { const st = g.map(i => strokes[i]); return { idx: g, strokes: st, result: new Nib.Recognizer().recognize(st, X) }; });
    let parts = read(groups);
    for (let k = 0; k < 8; k++) { const j = I.joinOperands(parts); if (!j) break; parts = read(j); }
    return parts;
  };
  const g0 = I.clustersOf(all), p1 = pieces(all);
  ok(g0.length === 3, `by nearness alone his 2 · 22 + 2 = falls into ${g0.length} pieces (${g0.map(g => g.length).join('+')})`);
  ok(p1.length === 1 && p1[0].result.latex === '2\\cdot 22+2=' && Nib.solve(p1[0].result, X)[0].latex === '46', `joined on its operators it is one: ${p1.map(p => p.result.latex).join(' | ')} → ${p1.length === 1 ? Nib.solve(p1[0].result, X)[0].latex : ''}`);
  // what must still come apart: whole problems side by side (a trailing = does not join), and a problem under another
  const h = 68, twice = all.concat(all.map(s => s.map(p => [p[0] + 403 + 1.2 * h, p[1]])));
  const p2 = pieces(twice);
  ok(p2.length === 2 && p2.every(p => p.result.latex === '2\\cdot 22+2='), `two copies side by side stay two problems (${p2.map(p => p.result.latex).join(' | ')})`);
  const r1 = pts(T.records[57]), r1w = Math.max(...r1.flat().map(p => p[0]));         // 7 − 1 = beside it
  const beside = all.concat(r1.map(s => s.map(p => [p[0] + 403 + 1.2 * h, p[1] + 10])));
  ok(pieces(beside).length === 2, `7 − 1 = beside it stays a problem of its own (${pieces(beside).map(p => p.result.latex).join(' | ')})`);
  const under = all.concat(all.map(s => s.map(p => [p[0], p[1] + 2.2 * h])));
  ok(pieces(under).length === 2, `a copy 2.2 heights under it is another piece (${pieces(under).length})`);
  // the first training file's spaced writing: 3√121  +  4  = in four pieces joins into one line
  const T1 = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'training_2026-11-07.json'), 'utf8'));
  const spaced = [];
  { let x = 0; for (const i of [5, 6, 7, 8]) { const st = pts(T1.records[i]); if (!st) continue; const w = Math.max(...st.flat().map(p => p[0])); spaced.push(...st.map(s => s.map(p => [p[0] + x, p[1] + (i === 5 ? 0 : 20)]))); x += w + 45; } }
  const p3 = pieces(spaced);
  ok(p3.length === 1 && /\+4=$/.test(p3[0].result.latex), `3√121 + 4 = written in four spaced pieces is one line: ${p3.map(p => p.result.latex).join(' | ')}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
