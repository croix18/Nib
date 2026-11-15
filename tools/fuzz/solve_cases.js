// Adversarial and random input for Nib.solve (LaTeX strings and odd values). Nothing may throw or hang, and what comes
// back is an array of null | {latex: string, text: string, ...}.
'use strict';
module.exports = function (Nib) {
  const C = [];
  const okShape = out => {
    if (!Array.isArray(out)) return 'not an array';
    for (const a of out) {
      if (a === null) continue;
      if (typeof a !== 'object' || typeof a.latex !== 'string' || typeof a.text !== 'string') return 'row is not null or {latex, text}';
      if (/NaN|Infinity|undefined|\[object/.test(a.latex + a.text)) return 'answer shows NaN/Infinity/undefined';
      if (a.latex.length > 400) return 'answer is ' + a.latex.length + ' characters long';
    }
    return null;
  };
  const S = (name, input, opt) => C.push({ name: 'solve ' + name, run: () => Nib.solve(input, opt), check: okShape });
  const rep = (s, n) => s.repeat(n);

  // ---- towers, powers, factorials, roots, division
  for (const s of ['9^9^9=', '9^{9^{9}}=', '9^{9^{9^{9}}}=', '2^{100000}=', '2^{10^{9}}=', '10^{10^{10}}=', '2^{2^{2^{2^{2}}}}=', '(2^{4000})^{4000}=', '2^{4096}=', '2^{4095}=', '3^{2600}=',
    '(-2)^{0.5}=', '0^0=', '0^{-1}=', '(1/3)^{4000}=', '2^{-100000}=', '1.0000001^{10^{9}}=', '(2^{2000})(2^{2000})(2^{2000})=', '99999999999999999999^{99}=', '2^{0.5}=', '2^{1/3}=', '(-8)^{1/3}=',
    '10^{-400}=', '10^{400}=', '10^{308}+10^{308}=', '0.1^{400}=', '2^{3^{4^{5}}}=', '7^{7^{7}}=', '(9^9)^9=', '9^{(9^9)}=',
    '100000!=', '9999!=', '201!=', '200!=', '170!=', '25!=', '20!!=', '(3!)!=', '(3!)!!=', '((3!)!)!=', '(-1)!=', '0.5!=', '0!=', '200!\\times 200!=', '200!^{200}=', '200!/199!=', 'x!=',
    '1/0=', '0/0=', '1\\div 0=', '\\frac{1}{0}=', '\\frac{0}{0}=', '1/7=', '1/9999999967=', '1\\div 9999999967=', '1/3^{200}=', '1\\div 3^{2000}=', '1\\div 7^{1400}=', '\\frac{1}{97}=', '\\frac{1}{9973}=',
    '\\frac{22}{7}=', '1\\div 999983=', '1 \\div 99999999999999999999999999999999999989 =', '355\\div 113=',
    '\\sqrt{-1}=', '\\sqrt[0]{2}=', '\\sqrt[1]{2}=', '\\sqrt[3]{-8}=', '\\sqrt[1000000]{2}=', '\\sqrt[64]{2}=', '\\sqrt[65]{2}=', '\\sqrt{10^{400}}=', '\\sqrt{10^{4000}}=', '\\sqrt[3]{10^{3999}}=', '\\sqrt{2^{4094}}=',
    '\\sqrt{0}=', '\\sqrt{}=', '\\sqrt[]{4}=', '\\sqrt[2.5]{4}=', '\\sqrt[-2]{4}=', '\\sqrt[x]{4}=', '\\sqrt{x}=', '\\sqrt{x^2}=', '\\sqrt{\\sqrt{\\sqrt{\\sqrt{\\sqrt{65536}}}}}=', '\\sqrt{2}\\sqrt{2}=', '\\sqrt{2}^{4000}=',
    '\\pi^{1000}=', '\\pi^{\\pi^{\\pi^{\\pi}}}=', '\\pi\\div 0=', '\\pi-\\pi=', '\\pi!=', '\\sqrt{\\pi}=', '10^{300}\\pi\\times 10^{300}=', '\\pi\\times 10^{308}\\times 10=',
    '|{-5}|=', '||=', '|||=', '|x|=', '|-|=', '|1|2|3|=', '-|-|-1||=',
    '50%=', '50%%=', '%=', '10^{1000}%=', '15% \\text{ of } 80=', '0%=', '-50%+50%=', '100%\\div 0%=', '\\frac{1}{3}%=', '15%+5=', '15%\\times 15%\\times 15%=',
    '0.\\overline{3}=', '0.\\overline{9}=', '0.\\overline{0}=', '\\overline{3}=', '0.\\overline{}=', '0.\\overline{123456789012}=', '0.\\overline{1234567890123}=', '1.2\\overline{3}4=', '0.\\overline{3}\\overline{3}=', '.\\overline{3}=',
    '1,000+1=', '1,00+1=', '1,000,000,000,000=', '1,,000=', ',=', '1.2.3=', '.=', '..=', '1.=', '.5=', '0.0000000000000000000000001=', '5 1/3=', '5\\frac{1}{3}=', '5\\frac{1}{0}=', '1/2/3/4=', '2/3x=', '6\\div 2(1+2)=',
    '3 x 4=', '3x4=', 'xx=', 'x\\times x=', 'x^x=', 'x^{-1}=', 'x^{0.5}=', 'x^{25}=', 'x^{24}=', 'x^{24}x=', '(x^{24})^{24}=', 'x^{10^9}=', '(x+1)^{24}=', '(x+1)^{25}=', '(x+y)^{24}=', '(x+y+z)^{24}=', '(a+b+c+d+e+f+g+h)^{24}=',
    '(a+b+c+d+e+f+g+h)^{3}=', '(a+b)(c+d)(e+f)(g+h)(i+j)(k+l)(m+n)=', '(a+b)(c+d)(e+f)(g+h)(i+j)(k+l)(m+n)(o+p)(q+r)(s+t)(u+v)(w+x)(y+z)=', '(x+1)^{24}(x-1)^{24}=', '(x+1)^{12}(x-1)^{12}=', '((x+1)^{2})^{12}=',
    '6x\\div 3x=', '6x\\div 0x=', 'x\\div x=', 'x\\div 0=', '0\\div x=', '(x^2-1)\\div (x-1)=', 'x_1+x_2=', 'x_{12}+x_{12}=', 'x_{}=', 'x_x=', 'x_{1_{2_{3}}}=', 'f(2)=', 'f(x)=', 'A=lw=3\\cdot 4=',
    '2(3+4)=2\\cdot 7=', '3+4=9+1=', '1\\div 0=2+3=', '3+4=x+2x=', '====', '=', '==', '1=', '=1', '1==', '1=2=3=4=5=6=7=8=9=', '1<2<3<', '1<', '<', '\\le', '1\\le 2\\ge 3=', '1\\ne 2=', '1\\rightarrow 2=', '1\\in 2=',
    '', ' ', '\\', '\\\\', '\\\\\\', '\\\\\\\\', '{', '}', '{}', '{{}}', '}{', '^', '_', '^^', '__', '^_', '1^', '1_', '1^^2', '1^{2}^{3}=', '1^2^3=', '\\frac', '\\frac{', '\\frac{1}', '\\frac{1}{', '\\frac{}{}=', '\\frac{1}{2}{3}=',
    '\\sqrt', '\\sqrt[', '\\sqrt[3', '\\sqrt[3]', '\\sqrt{', '\\left(1+2\\right)=', '\\left(\\right)=', '\\begin{array}1\\end{array}=', '\\text{cm}=', '3\\text{ cm}+2\\text{ cm}=', '3cm+2cm=', '5km\\div 2h=', '\\unknowncommand{1}=',
    '\\' + rep('a', 5000) + '=', '\\times', '\\times\\times\\times=', '+', '-', '--', '---1=', '+-+-+-1=', '1+-2=', '1++2=', '1-+2=', '1--2=', '-(-(-(-1)))=', '\\pm 1=', '1\\pm 2=', '\\pm=', '()=', '(())=', ')(=', '(=', ')=', '[1+2)=', '(1+2]=', '\\{1+2\\}=', '\\{1+2)=',
    '１+２=', '1＋2=', '١+٢=', '1​+2=', '1\u0000+2=', '\u0000', '\ud800=', '😀=', '1+😀=', 'π=', '√4=', '½=', '2²=', '3×4=', '3·4=', '3÷4=', '−5=', '3 − 5 =', '1\t+\n2\r=', '1+2=\n3+4=', 'NaN=', 'Infinity=', 'undefined=', 'null=', '1e5=', '1E5=', '0x10=', '1_000=', '0b11=', '1n=',
    '\\infty=', '\\infty-\\infty=', '1/\\infty=', '\\theta+\\theta=', '\\alpha\\beta\\gamma=', '\\Delta x=', '\\sum 1=', '\\int x=', '\\forall x=', '\\exists x=', '\\ldots=', '1+\\ldots+9=', '\\circ=', '90^\\circ=', "x'=", "x''=", '$5+$3=', '$=', '5$=', '3:4=', '1:2:3=', '!=', '!!=', '1!!!!!!!!!!!!=', '?=',
    'x=5\\\\ x+1=', 'x=y\\\\ y=x\\\\ x+y=', 'x=x+1\\\\ x=', 'x=x\\\\ x=', 'x=1\\\\ x=2\\\\ x=', 'x=\\\\ x=', 'x=1/0\\\\ x+1=', 'x=2^{4000}\\\\ x^{24}=', 'x=2^{4000}\\\\ y=x^{2}\\\\ z=y^{2}\\\\ z=',
    'x^2=4\\\\ x=', 'x^2=-4\\\\ x=', 'x^2=10^{30}\\\\ x=', 'x^2+x=10^{11}\\\\ x=', 'x^2=99999999977\\\\ x=', 'x^2=9999999967\\\\ x=', 'x^{24}=1\\\\ x=', 'x^3=8\\\\ x=', '2x+3=7\\\\ x=', '0x=0\\\\ x=', '0x=1\\\\ x=', 'x+y=1\\\\ x-y=1\\\\ x=',
    'x+y=1\\\\ x+y=2\\\\ x=', 'x+y+z=1\\\\ x-y=2\\\\ z=3\\\\ x=', 'a+b+c+d+e=1\\\\ a-b=2\\\\ b-c=3\\\\ c-d=4\\\\ d-e=5\\\\ a=', 'x<5\\\\ x=', '2x<10\\\\ x<', '-2x<10\\\\ x', '|x|=5\\\\ x=', 'x/0=1\\\\ x=', 'x=\\sqrt{-1}\\\\ x=',
    'y=2x+1\\\\ x=3\\\\ y=', 'y=mx+b\\\\ m=2\\\\ b=1\\\\ x=3\\\\ y=', 'C=2\\pi r\\\\ r=3\\\\ C=', 'A=\\pi r^2\\\\ r=10^{200}\\\\ A=', 'x^2-5x+6=0\\\\ x=', 'x^2-2=0\\\\ x=', '10^{10}x^2-1=0\\\\ x=', 'x^2-10^{10}x+1=0\\\\ x=', 'x^2+10^{6}x+1=0\\\\ x=',
  ]) S(JSON.stringify(s), s);

  // ---- size and depth
  S('5000 deep brackets', rep('(', 5000) + '1' + rep(')', 5000) + '=');
  S('100000 deep brackets', rep('(', 100000) + '1' + rep(')', 100000) + '=');
  S('5000 open brackets, none closed', rep('(', 5000) + '1=');
  S('3000 nested fractions', rep('\\frac{1}{', 3000) + '1' + rep('}', 3000) + '=');
  S('3000 nested roots', rep('\\sqrt{', 3000) + '2' + rep('}', 3000) + '=');
  S('20000 nested braces', rep('{', 20000) + '1' + rep('}', 20000) + '=');
  S('3000 nested powers', '2' + rep('^{2', 3000) + rep('}', 3000) + '=');
  S('3000 nested bars', rep('|', 3000) + '1' + rep('|', 3000) + '=');
  S('20000 terms sum', rep('1+', 20000) + '1=');
  S('20000 terms product', rep('2\\times ', 20000) + '2=');
  S('2000 factors of x', rep('x', 2000) + '=');
  S('5000 minus signs', rep('-', 5000) + '1=');
  S('100000 digits', rep('9', 100000) + '=');
  S('100000 digits + 1', rep('9', 100000) + '+1=');
  S('1300 digits squared', rep('9', 1300) + '\\times ' + rep('9', 1300) + '=');
  S('100000 decimal places', '0.' + rep('0', 100000) + '1=');
  S('1000000 characters of 1+', rep('1+', 500000) + '=');
  S('2000 lines', rep('1+1=\\\\ ', 2000));
  S('500 lines each defining the next letter', Array.from({ length: 500 }, (_, i) => `x_{${i + 1}}=x_{${i}}+1`).join('\\\\ ') + '\\\\ x_{499}=');
  S('26 letters chained and doubled', 'a=2\\\\ ' + 'bcdefghijklmnopqrstuvwxyz'.split('').map((c, i) => `${c}=${'abcdefghijklmnopqrstuvwxyz'[i]}^{2}`).join('\\\\ ') + '\\\\ z=');
  S('40 equations in 40 unknowns', Array.from({ length: 40 }, (_, i) => Array.from({ length: 40 }, (_, j) => `${(i * 7 + j * 3) % 11 + 1}x_{${j}}`).join('+') + `=${i + 1}`).join('\\\\ ') + '\\\\ x_{0}=');
  S('12 equations in 12 letters', 'abcdefghijkl'.split('').map((c, i) => 'abcdefghijkl'.split('').map((d, j) => `${(i * 5 + j * 3) % 7 + 1}${d}`).join('+') + `=${i + 1}`).join('\\\\ ') + '\\\\ a=');
  S('long repeating decimal 1/(10^40-1)', '1\\div ' + rep('9', 40) + '=');
  S('prime near 2^61 as a denominator', '1\\div 2305843009213693951=');
  S('big over big', rep('9', 1200) + '\\div ' + rep('7', 1199) + '=');
  S('200 nested mixed', rep('(1+\\frac{1}{', 200) + '1' + rep('})', 200) + '=');
  S('continued fraction 400 deep', rep('1+\\frac{1}{', 400) + '2' + rep('}', 400) + '=');
  S('power chain of fractions', rep('(', 60) + '\\frac{3}{2}' + rep(')^{2}', 60) + '=');
  S('sum of 300 unit fractions', Array.from({ length: 300 }, (_, i) => `\\frac{1}{${i + 2}}`).join('+') + '=');
  S('sum of 2000 unit fractions', Array.from({ length: 2000 }, (_, i) => `\\frac{1}{${i + 2}}`).join('+') + '=');
  S('product of 300 primes-ish', Array.from({ length: 300 }, (_, i) => String(1000003 + 2 * i)).join('\\times ') + '=');

  // ---- odd values
  const odd = [undefined, null, 0, -0, 1, -1, NaN, Infinity, -Infinity, 1e308, 5e-324, 0.1, 123456789012345680000, true, false, {}, [], [[]], [null], [undefined], [1, 2, 3], ['1+1='], [['1']], { tree: null }, { tree: [] },
    { tree: [null] }, { tree: [[]] }, { tree: [[null]] }, { tree: {} }, { tree: 'x' }, { tree: [[{ k: 's' }]] }, { tree: [[{ k: 's', label: '1' }, { k: 's', label: '=' }]] }, { tree: [[{ k: 'frac' }, { k: 's', label: '=' }]] },
    { tree: [[{ k: 'frac', num: null, den: null }, { k: 's', label: '=' }]] }, { tree: [[{ k: 'sqrt' }, { k: 's', label: '=' }]] }, { tree: [[{ k: 's', label: '2', sup: 'x' }, { k: 's', label: '=' }]] },
    { tree: [[{ k: 's', label: '2', sup: [{ k: 's', label: '2', sup: [{}] }] }, { k: 's', label: '=' }]] }, { tree: [[{ k: 'zzz', label: 5 }, { k: 's', label: '=' }]] }, { tree: [[{ k: 's', label: 5 }, { k: 's', label: '=' }]] },
    { tree: [[{ k: 's', label: '' }, { k: 's', label: '=' }]] }, { tree: [[{ k: 's', label: '=' }]] }, { tree: [[{ k: 's', label: '\\frac' }, { k: 's', label: '=' }]] }, { tree: [[{ k: 's', label: '__proto__' }, { k: 's', label: '=' }]] },
    { tree: [[{ k: 's', label: 'constructor' }, { k: 's', label: '=' }]] }, { tree: [[{ k: 's', label: 'x', sub: [{ k: 's', label: '__proto__' }] }, { k: 's', label: '=' }]] }, new Date(), /x/, () => '1+1=', Symbol.iterator, 10n, new Map(), new Set([1]), new Float32Array(4), Object.create(null), '__proto__', 'constructor=', 'toString=', 'hasOwnProperty=', '__proto__=1\\\\ __proto__='];
  odd.forEach((v, i) => C.push({ name: 'solve odd value #' + i + ' ' + (() => { try { return JSON.stringify(v) || String(v); } catch (e) { return typeof v; } })(), run: () => Nib.solve(v), check: okShape }));
  for (const o of [null, 0, 'x', [], { times: 0 }, { times: 'no' }, { symbols: 5 }, { unknown: 1 }, Object.create(null)]) S('options ' + JSON.stringify(o), '3x4=', o);
  // a tree that refers to itself
  C.push({ name: 'solve cyclic tree', run: () => { const n = { k: 's', label: '2' }; n.sup = [n]; return Nib.solve({ tree: [[n, { k: 's', label: '=' }]] }); }, check: okShape });
  C.push({ name: 'solve tree 5000 deep in sup', run: () => { let n = { k: 's', label: '2' }; for (let i = 0; i < 5000; i++) n = { k: 's', label: '2', sup: [n] }; return Nib.solve({ tree: [[n, { k: 's', label: '=' }]] }); }, check: okShape });

  // ---- random token soup (seeded)
  let seed = 20261114;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const T = ['0', '1', '2', '3', '7', '9', '9', '9', '10', '99', '0.5', '.', ',', '+', '-', '\\times ', '\\cdot ', '\\div ', '/', '=', '=', '<', '>', '\\le ', '\\ge ', '(', ')', '[', ']', '|', '!', '%', '^', '^{', '_{', '{', '}', '}', '\\frac{', '}{', '\\sqrt{', '\\sqrt[',
    ']{', 'x', 'y', 'a', 'x', '\\pi ', '\\overline{', '\\\\ ', ' ', '\\pm ', '$', ':', '\\theta ', '-', '^{-', '^{9', '^{99}', '!', '!'];
  for (let i = 0; i < 6000; i++) {
    const n = 1 + Math.floor(rnd() * (i % 10 === 0 ? 120 : 24));
    let s = ''; for (let j = 0; j < n; j++) s += pick(T);
    if (rnd() < 0.6) s += '=';
    S('random #' + i + ' ' + JSON.stringify(s), s);
  }
  // well-formed random arithmetic with big pieces
  const num = () => (rnd() < 0.2 ? String(Math.floor(rnd() * 1e15)) : rnd() < 0.3 ? (rnd() * 100).toFixed(Math.floor(rnd() * 6)) : String(Math.floor(rnd() * 30)));
  const ex = d => {
    const r = rnd();
    if (d <= 0 || r < 0.25) return rnd() < 0.15 ? pick(['x', 'y', '\\pi ']) : num();
    if (r < 0.45) return ex(d - 1) + pick(['+', '-', '\\times ', '\\div ', '\\cdot ']) + ex(d - 1);
    if (r < 0.55) return '(' + ex(d - 1) + ')';
    if (r < 0.67) return '\\frac{' + ex(d - 1) + '}{' + ex(d - 1) + '}';
    if (r < 0.77) return '(' + ex(d - 1) + ')^{' + pick(['2', '3', '9', '24', '99', '-2', '0', '0.5', '1/2', ex(d - 2)]) + '}';
    if (r < 0.85) return '\\sqrt' + (rnd() < 0.3 ? '[' + pick(['3', '2', '5', '64']) + ']' : '') + '{' + ex(d - 1) + '}';
    if (r < 0.9) return '|' + ex(d - 1) + '|';
    if (r < 0.95) return ex(d - 1) + '!';
    return ex(d - 1) + '%';
  };
  for (let i = 0; i < 4000; i++) { const s = ex(2 + Math.floor(rnd() * 5)) + '='; S('formed #' + i + ' ' + JSON.stringify(s.length > 200 ? s.slice(0, 200) + '…' : s), s); }
  return C;
};
