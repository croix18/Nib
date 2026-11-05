// ================================================================== working out what is written before an "="
// A line that ends with "=" is worked out. Numbers are exact (BigInt fractions): whole numbers, decimals, fractions,
// mixed numbers and percents, with + − × · ÷ /, brackets, powers, roots, absolute values and factorials; π and roots
// that do not come out are approximated, and their digits are cut (never rounded up) before the "…". Letters stay
// letters — like terms are combined, brackets multiplied out, a term divided by a term — unless a line above, in the
// same piece of work, gave them a value ("x = 5"). The answer takes the form the question was asked in (decimals give
// decimals, fractions give fractions, mixed numbers give mixed numbers), and a lone number is turned into its other
// form (3/4 → 0.75, 0.75 → 3/4, 5 1/3 → 16/3, 16/3 → 5 1/3, 75% → 0.75).
// Equations: "x =" (or "x <", "x ≥", …) on the line under an equation or inequality solves the nearest one above with
// x in it: one-step to multi-step, letters on both sides, fractions and decimals, x² = p and x³ = q, inequalities
// (answered only when the sign written is the right one), and two or three equations together.
// Anything that could be read two ways, or is not maths (units, words), gets no answer rather than a guess.
// Each answer is LaTeX, plain text and reading-tree nodes, so it can be drawn like writing.

class SolveError extends Error {}
const sfail = why => { throw new SolveError(why); };

// ------------------------------------------------------------------ numbers: exact {n, d} (BigInt, d > 0, lowest
// terms) or approximate {f}
const SOLVE_BITS = 4096;
function bgcd(a, b) { if (a < 0n) a = -a; if (b < 0n) b = -b; while (b) { const t = a % b; a = b; b = t; } return a; }
function bbits(a) { if (a < 0n) a = -a; return a === 0n ? 0 : a.toString(16).length * 4; }
function Q(n, d) {
  if (d === undefined) d = 1n;
  if (d === 0n) sfail('division by zero');
  if (d < 0n) { n = -n; d = -d; }
  const g = bgcd(n, d);
  if (g > 1n) { n /= g; d /= g; }
  if (bbits(n) > SOLVE_BITS || bbits(d) > SOLVE_BITS) sfail('too big');
  return { n, d };
}
const QZERO = { n: 0n, d: 1n }, QONE = { n: 1n, d: 1n };
function qnum(q) {
  let n = q.n, d = q.d;
  const sh = Math.max(bbits(n), bbits(d)) - 1000;
  if (sh > 0) { n >>= BigInt(sh); d >>= BigInt(sh); if (d === 0n) return n < 0n ? -Infinity : Infinity; }
  return Number(n) / Number(d);
}
// An approximate result within rounding error of a whole number, or of a fraction with a denominator up to 1000, is
// that number exactly: √2·√2 = 2, π ÷ π = 1, √3·√3 ÷ 2 = 1.5. (π itself and roots that do not come out never are.)
function snapQ(v) {
  const a = Math.abs(v), s = v < 0 ? -1 : 1;
  if (a < 9e15) {
    const r = Math.round(a);
    if (Math.abs(a - r) <= 1e-13 * a) return Q(BigInt(s * r));     // (never a small number to zero: π × 10⁻²⁰)
  }
  if (a < 1e9) {
    let h0 = 1, h1 = 0, k0 = 0, k1 = 1, x = a;                   // continued-fraction convergents h/k
    for (let it = 0; it < 40; it++) {
      const ai = Math.floor(x), h2 = ai * h0 + h1, k2 = ai * k0 + k1;
      if (k2 > 1000) break;
      h1 = h0; h0 = h2; k1 = k0; k0 = k2;
      if (h0 && Math.abs(a - h0 / k0) <= 1e-13 * a) return Q(BigInt(s * h0), BigInt(k0));
      const fr = x - ai;
      if (!(fr > 0)) break;
      x = 1 / fr;
    }
  }
  return null;
}
const Fraw = v => (Number.isFinite(v) ? { f: v } : sfail('not a number'));
const Fl = v => (Number.isFinite(v) ? snapQ(v) || { f: v } : sfail('not a number'));
const isFl = c => c.f !== undefined;
const cval = c => (isFl(c) ? c.f : qnum(c));
const czero = c => (isFl(c) ? c.f === 0 : c.n === 0n);
const csign = c => (isFl(c) ? Math.sign(c.f) : c.n > 0n ? 1 : c.n < 0n ? -1 : 0);
const cneg = c => (isFl(c) ? { f: -c.f } : { n: -c.n, d: c.d });
function cadd(a, b) {
  if (!isFl(a) && !isFl(b)) return Q(a.n * b.d + b.n * a.d, a.d * b.d);
  const x = cval(a), y = cval(b), s = x + y;
  // two nearly equal approximations cancelling leave only rounding error: zero or not cannot be told (π − 3.14159265358979)
  if (s !== 0 && Math.abs(s) <= 1e-10 * Math.max(Math.abs(x), Math.abs(y))) sfail('lost to rounding');
  return Fl(s);
}
const csub = (a, b) => cadd(a, cneg(b));
const cmul = (a, b) => (isFl(a) || isFl(b) ? Fl(cval(a) * cval(b)) : Q(a.n * b.n, a.d * b.d));
const cdiv = (a, b) => (czero(b) ? sfail('division by zero') : isFl(a) || isFl(b) ? Fl(cval(a) / cval(b)) : Q(a.n * b.d, a.d * b.n));
const cabs = c => (isFl(c) ? { f: Math.abs(c.f) } : { n: c.n < 0n ? -c.n : c.n, d: c.d });
function csame(a, b) {
  if (!isFl(a) && !isFl(b)) return a.n === b.n && a.d === b.d;
  const x = cval(a), y = cval(b);
  return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
}
// floor of the k-th root of n >= 0
function iroot(n, k) {
  if (n < 2n) return n;
  const K = BigInt(k);
  let x = 1n << BigInt(Math.ceil(bbits(n) / k) + 1);
  for (;;) { const y = ((K - 1n) * x + n / x ** (K - 1n)) / K; if (y >= x) break; x = y; }
  while (x ** K > n) x--;
  while ((x + 1n) ** K <= n) x++;
  return x;
}
function croot(c, k) {
  if (!(k >= 2 && k <= 64)) sfail('root');
  if (isFl(c)) { if (c.f < 0 && k % 2 === 0) sfail('a root of a negative number'); return Fl(Math.sign(c.f) * Math.pow(Math.abs(c.f), 1 / k)); }
  if (c.n < 0n) { if (k % 2 === 0) sfail('a root of a negative number'); return cneg(croot(cneg(c), k)); }
  const K = BigInt(k), rn = iroot(c.n, k), rd = iroot(c.d, k);
  if (rn ** K === c.n && rd ** K === c.d) return Q(rn, rd);
  return Fraw(Math.pow(qnum(c), 1 / k));                        // does not come out: never snapped to a neat number
}
function cpow(b, e) {
  if (isFl(b) || isFl(e)) {
    const x = cval(b), y = cval(e);
    if (x === 0 && y <= 0) sfail('zero to that power');
    if (x < 0 && !Number.isInteger(y)) sfail('a root of a negative number');
    return Fl(Math.pow(x, y));
  }
  if (e.d === 1n) {
    let k = e.n;
    if (b.n === 0n) return k > 0n ? QZERO : sfail('zero to that power');
    if (b.d === 1n && (b.n === 1n || b.n === -1n)) return b.n === 1n || k % 2n === 0n ? QONE : Q(-1n);
    if (k < 0n) { b = Q(b.d, b.n); k = -k; }
    if (k * BigInt(Math.max(bbits(b.n), bbits(b.d), 1)) > BigInt(SOLVE_BITS)) sfail('too big');
    return Q(b.n ** k, b.d ** k);
  }
  if (e.d > 64n || e.n > 4096n || e.n < -4096n) return Fl(Math.pow(cval(b), cval(e)));
  return cpow(croot(b, Number(e.d)), { n: e.n, d: 1n });
}
function cfact(c) {
  if (isFl(c) || c.d !== 1n || c.n < 0n || c.n > 200n) sfail('factorial');
  let r = 1n; for (let i = 2n; i <= c.n; i++) r *= i;
  return Q(r);
}
// "12.50" -> 25/2
function qOfText(t) {
  const [a, b = ''] = t.split('.');
  if (!/^\d*$/.test(a) || !/^\d*$/.test(b) || !(a + b).length) sfail('number');
  return Q(BigInt((a || '0') + b), 10n ** BigInt(b.length));
}

// ------------------------------------------------------------------ polynomials: Map(monomial key -> coefficient)
// A key lists letters with powers in order, "x^2*y"; "" is the number part.
function mkey(m) {
  return [...m.entries()].filter(([, e]) => e).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([v, e]) => (e === 1 ? v : v + '^' + e)).join('*');
}
function mparse(k) {
  const m = new Map();
  if (k) for (const f of k.split('*')) { const i = f.lastIndexOf('^'); if (i < 0) m.set(f, 1); else m.set(f.slice(0, i), +f.slice(i + 1)); }
  return m;
}
const mdeg = k => { let t = 0; for (const e of mparse(k).values()) t += e; return t; };
const pc = c => new Map(czero(c) ? [] : [['', c]]);
const pv = name => new Map([[name, QONE]]);
const pconst = p => (p.size === 0 ? QZERO : p.size === 1 && p.has('') ? p.get('') : null);
function pvars(p) { const s = new Set(); for (const k of p.keys()) for (const v of mparse(k).keys()) s.add(v); return s; }
function pput(m, k, c) { const prev = m.get(k), v = prev ? cadd(prev, c) : c; if (czero(v)) m.delete(k); else m.set(k, v); }
function padd(a, b) { const out = new Map(a); for (const [k, c] of b) pput(out, k, c); return out; }
function pneg(a) { const out = new Map(); for (const [k, c] of a) out.set(k, cneg(c)); return out; }
function pscale(a, c) { const out = new Map(); if (czero(c)) return out; for (const [k, v] of a) out.set(k, cmul(v, c)); return out; }
function psame(a, b) { if (a.size !== b.size) return false; for (const [k, c] of a) if (!b.has(k) || !csame(c, b.get(k))) return false; return true; }
function pmul(a, b) {
  const out = new Map();
  for (const [ka, ca] of a) for (const [kb, cb] of b) {
    const m = mparse(ka);
    for (const [v, e] of mparse(kb)) m.set(v, (m.get(v) || 0) + e);
    pput(out, mkey(m), cmul(ca, cb));
  }
  if (out.size > 64) sfail('too long');
  for (const k of out.keys()) if (mdeg(k) > 24) sfail('too high a power');
  return out;
}
// by a number, or by one term when every term of a divides by it: 6x² ÷ 3x = 2x, (6x² + 3x) ÷ 3x = 2x + 1
function pdiv(a, b) {
  const c = pconst(b);
  if (c) return pscale(a, cdiv(QONE, c));
  if (b.size !== 1) sfail('dividing by letters');
  const [[kb, cb]] = [...b], mb = mparse(kb), out = new Map();
  for (const [ka, ca] of a) {
    const m = mparse(ka);
    for (const [v, e] of mb) { const r = (m.get(v) || 0) - e; if (r < 0) sfail('dividing by letters'); m.set(v, r); }
    pput(out, mkey(m), cdiv(ca, cb));
  }
  return out;
}
function ppow(a, e) {
  const k = pconst(e);
  if (!k) sfail('a power with letters');
  const b = pconst(a);
  if (b) return pc(cpow(b, k));
  if (isFl(k) || k.d !== 1n || k.n < 0n || k.n > 24n) sfail('that power of letters');
  let out = pc(QONE);
  for (let i = 0n; i < k.n; i++) out = pmul(out, a);
  return out;
}

// ------------------------------------------------------------------ a reading row -> tokens
// {t: 'num', v: '12.5'} {t: 'op', v: '+' | '-' | '*' | '/' | '÷'} {t: 'rel', v} {t: 'open' | 'close', v} {t: 'bar'}
// {t: 'var', v} {t: 'pi'} {t: 'frac', num, den} {t: 'root', body, idx} {t: 'sup', v} {t: 'pct'} {t: 'fact'}
const SOLVE_REL = new Set(['=', '<', '>', '\\le', '\\ge', '\\ne', '\\rightarrow', '\\in']);
const SOLVE_ASK = new Set(['=', '<', '>', '\\le', '\\ge']);           // what an answer can follow
const SOLVE_OPEN = { '(': ')', '[': ']', '\\{': '\\}' };
const SOLVE_CLOSE = new Set([')', ']', '\\}']);
const SOLVE_VARS = /^[A-Za-z]$|^\\(alpha|beta|gamma|theta|lambda|mu|sigma|phi|Delta)$/;
// units and words are not letters to multiply: 1m + 50cm, 3ft × 4ft, GCF(12, 18)
const SOLVE_WORDS = new Set(['cm', 'mm', 'km', 'ft', 'yd', 'mi', 'in', 'kg', 'mg', 'lb', 'lbs', 'oz', 'ml', 'mL', 'hr', 'hrs',
  'min', 'sec', 'gal', 'qt', 'pt', 'mph', 'GCF', 'GCD', 'LCM', 'LCD', 'gcf', 'gcd', 'lcm', 'lcd', 'max', 'sin', 'cos', 'tan',
  'log', 'ln', 'sq', 'deg', 'pi', 'and', 'is', 'of']);
// options.times === false: × is never a times sign, so every x is the letter x (multiply with · or brackets)
function tokensOf(row, options) {
  const out = [], opens = [];                                         // opens: is each open bracket right after a letter?
  const lastNum = () => { const t = out[out.length - 1]; return t && t.t === 'num' && !t.closed ? t : null; };
  for (let i = 0; i < (row || []).length; i++) {
    const u = row[i], nx = row[i + 1];
    if (u.k === 'frac') out.push({ t: 'frac', num: tokensOf(u.num, options), den: tokensOf(u.den, options) });
    else if (u.k === 'root') out.push({ t: 'root', body: tokensOf(u.body, options), idx: u.idx && u.idx.length ? tokensOf(u.idx, options) : null });
    else if (u.k !== 's') sfail('unknown');
    else {
      const l = u.label, n = lastNum();
      if (/^[0-9]$/.test(l)) { if (n) n.v += l; else out.push({ t: 'num', v: l }); }
      else if (l === '.') {
        if (n && !n.v.includes('.')) n.v += '.';
        else if (!n && nx && nx.k === 's' && /^[0-9]$/.test(nx.label)) out.push({ t: 'num', v: '.' });
        else sfail('a stray point');
      } else if (l === ',') {
        // 1,000: a thousands comma; anything else is not arithmetic, nor is a list in brackets after a letter (f(2,300))
        if (opens.length && opens[opens.length - 1]) sfail('a list');
        const d = row.slice(i + 1, i + 4);
        if (n && !n.v.includes('.') && d.length === 3 && d.every(x => x.k === 's' && /^[0-9]$/.test(x.label) && !x.sup && !x.sub) &&
          !(row[i + 4] && row[i + 4].k === 's' && /^[0-9]$/.test(row[i + 4].label))) { /* skip it */ } else sfail('a comma');
      } else if (l === '+' || l === '-') out.push({ t: 'op', v: l });
      else if (l === '\\times' || l === '\\cdot') out.push({ t: 'op', v: '*' });
      else if (l === '\\div') out.push({ t: 'op', v: '÷' });
      else if (l === '/') out.push({ t: 'op', v: '/' });
      else if (SOLVE_REL.has(l)) out.push({ t: 'rel', v: l });
      else if (SOLVE_OPEN[l]) { const t = out[out.length - 1]; opens.push(!!t && t.t === 'var'); out.push({ t: 'open', v: l }); }
      else if (SOLVE_CLOSE.has(l)) { opens.pop(); out.push({ t: 'close', v: l }); }
      else if (l === '|') out.push({ t: 'bar' });
      else if (l === '!') out.push({ t: 'fact' });
      else if (l === '%') out.push({ t: 'pct' });
      else if (l === '\\pi') out.push({ t: 'pi' });
      else if (SOLVE_VARS.test(l)) {
        let v = l;
        if (u.sub) {
          const s = u.sub.map(x => (x.k === 's' && /^[0-9A-Za-z]$/.test(x.label) && !x.sup && !x.sub ? x.label : sfail('subscript'))).join('');
          v += '_' + (s.length === 1 ? s : '{' + s + '}');
        }
        out.push({ t: 'var', v });
      } else sfail('cannot work out ' + l);
    }
    if (u.sub && !(u.k === 's' && SOLVE_VARS.test(u.label))) sfail('subscript');
    if (u.sup) { const t = out[out.length - 1]; if (t && t.t === 'num') t.closed = true; out.push({ t: 'sup', v: tokensOf(u.sup, options) }); }
  }
  let bars = 0;
  for (const t of out) if (t.t === 'bar' && ++bars % 2 === 0) t.shut = true;
  // what a times sign or "of" can follow: a number, percent, closing bracket, fraction, power, root or factorial
  const ends = t => t && (t.t === 'num' || t.t === 'pct' || t.t === 'close' || t.t === 'frac' || t.t === 'root' || t.t === 'sup' || t.t === 'fact' || t.shut);
  const times = !options || options.times !== false;
  for (let i = 1; i + 1 < out.length; i++) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    // where a cross can be a times sign: "3 x 4", "15% x 60", "(2+3) x 4", "2/3 x 6" — a lone x between one of those
    // and a number or fraction (a number never comes straight after a letter in algebra)
    if (times && b.t === 'var' && (b.v === 'x' || b.v === 'X') && ends(a) && (c.t === 'num' || c.t === 'frac')) out[i] = { t: 'op', v: '*' };
    // "15% of 80", "3/4 of 20"; and with the o read as a zero, "15% 0f 80"
    else if (b.t === 'var' && b.v === 'o' && c.t === 'var' && c.v === 'f' && ends(a)) out.splice(i, 2, { t: 'op', v: '*' });
    else if (b.t === 'num' && b.v === '0' && c.t === 'var' && c.v === 'f' && ends(a) && a.t !== 'num') out.splice(i, 2, { t: 'op', v: '*' });
  }
  for (let i = 0; i < out.length;) {
    if (out[i].t !== 'var') { i++; continue; }
    let w = '';
    while (i < out.length && out[i].t === 'var') w += out[i++].v;
    if (SOLVE_WORDS.has(w)) sfail('a word or unit: ' + w);
  }
  return out;
}

// ------------------------------------------------------------------ tokens -> expression tree
function solveParse(tokens) {
  let i = 0;
  const peek = () => tokens[i], next = () => tokens[i++];
  const intLit = l => l && l.length === 1 && l[0].t === 'num' && /^\d+$/.test(l[0].v);
  const starts = (tk, inAbs) => tk && (tk.t === 'num' || tk.t === 'var' || tk.t === 'pi' || tk.t === 'open' || tk.t === 'frac' || tk.t === 'root' || (tk.t === 'bar' && !inAbs));
  const sub = list => (list && list.length ? solveParse(list) : sfail('empty'));
  function expr(inAbs) {
    let a = term(inAbs);
    for (let tk = peek(); tk && tk.t === 'op' && (tk.v === '+' || tk.v === '-'); tk = peek()) {
      next(); a = { t: tk.v === '+' ? 'add' : 'sub', a, b: term(inAbs) };
    }
    return a;
  }
  function term(inAbs) {
    let a = unary(inAbs);
    for (;;) {
      const tk = peek();
      if (tk && tk.t === 'op' && (tk.v === '*' || tk.v === '/' || tk.v === '÷')) {
        next();
        if (tk.v === '*') { a = { t: 'mul', a, b: unary(inAbs) }; continue; }
        // a term with letters after ÷ is divided by as a whole: 6x ÷ 3x = 2, C ÷ 2π
        let b = unary(inAbs);
        while (peek() && (peek().t === 'var' || peek().t === 'pi')) b = { t: 'mul', a: b, b: power(inAbs), implicit: true };
        a = { t: 'div', a, b, sym: tk.v };
      } else if (starts(tk, inAbs)) {
        // a number straight after anything but an operation (x4, (2)3, 15%80, ½ 0) is not how maths is written
        if (tk.t === 'num' || tk.t === 'frac') sfail('a number straight after');
        a = { t: 'mul', a, b: power(inAbs), implicit: true };
      } else return a;
    }
  }
  function unary(inAbs) {
    const tk = peek();
    if (tk && tk.t === 'op' && (tk.v === '-' || tk.v === '+')) { next(); const a = unary(inAbs); return tk.v === '-' ? { t: 'neg', a } : { t: 'pos', a }; }
    return power(inAbs);
  }
  function power(inAbs) {
    let a = atom(inAbs);
    for (;;) {
      const tk = peek();
      if (tk && tk.t === 'sup') { next(); a = { t: 'pow', a, b: sub(tk.v) }; }
      else if (tk && tk.t === 'fact') { next(); a = { t: 'fact', a }; }
      else if (tk && tk.t === 'pct') { next(); a = { t: 'pct', a }; }
      else return a;
    }
  }
  function atom(inAbs) {
    const tk = next();
    if (!tk) sfail('incomplete');
    if (tk.t === 'num') {
      const f = peek();                               // 5 1/3: a whole number with a fraction of whole numbers after it
      if (/^\d+$/.test(tk.v) && f && f.t === 'frac' && intLit(f.num) && intLit(f.den)) { next(); return { t: 'mixed', whole: tk.v, num: f.num[0].v, den: f.den[0].v }; }
      return { t: 'num', text: tk.v };
    }
    if (tk.t === 'var') return { t: 'var', name: tk.v };
    if (tk.t === 'pi') return { t: 'pi' };
    if (tk.t === 'frac') return { t: 'frac', a: sub(tk.num), b: sub(tk.den) };
    if (tk.t === 'root') return { t: 'root', a: sub(tk.body), idx: tk.idx ? sub(tk.idx) : null };
    if (tk.t === 'open') {
      const a = expr(false), c = next();
      if (!c || c.t !== 'close' || SOLVE_OPEN[tk.v] !== c.v) sfail('brackets');
      return { t: 'group', a };
    }
    if (tk.t === 'bar') { const a = expr(true), c = next(); if (!c || c.t !== 'bar') sfail('bars'); return { t: 'abs', a }; }
    return sfail('unexpected ' + tk.t);
  }
  const ast = expr(false);
  if (i !== tokens.length) sfail('left over');
  return ast;
}

// ------------------------------------------------------------------ evaluation
// info gathers how the question was asked: decimals, percents, fractions (stacked or with a slash), mixed numbers,
// division, negative powers, π, and whether a given value was put in for a letter
function solveEval(ast, env, info) {
  const ev = a => solveEval(a, env, info);
  switch (ast.t) {
    case 'num': if (ast.text.includes('.')) info.dec = true; return pc(qOfText(ast.text));
    case 'mixed': info.frac = info.mixed = true; return pc(cadd(Q(BigInt(ast.whole)), Q(BigInt(ast.num), BigInt(ast.den))));
    case 'frac': info.frac = true; return pdiv(ev(ast.a), ev(ast.b));
    case 'neg': return pneg(ev(ast.a));
    case 'pos': case 'group': return ev(ast.a);
    case 'add': return padd(ev(ast.a), ev(ast.b));
    case 'sub': return padd(ev(ast.a), pneg(ev(ast.b)));
    case 'mul': return pmul(ev(ast.a), ev(ast.b));
    case 'div': if (ast.sym === '/') info.frac = true; else info.div = true; return pdiv(ev(ast.a), ev(ast.b));
    case 'pow': {
      const e = ev(ast.b), k = pconst(e);
      if (k && !isFl(k) && k.n < 0n) info.negpow = true;
      return ppow(ev(ast.a), e);
    }
    case 'root': {
      const c = pconst(ev(ast.a));
      if (!c) sfail('a root of letters');
      let k = 2;
      if (ast.idx) { const ic = pconst(ev(ast.idx)); if (!ic || isFl(ic) || ic.d !== 1n || ic.n < 2n || ic.n > 64n) sfail('root'); k = Number(ic.n); }
      return pc(croot(c, k));
    }
    case 'abs': { const c = pconst(ev(ast.a)); if (!c) sfail('letters inside bars'); return pc(cabs(c)); }
    case 'fact': { const c = pconst(ev(ast.a)); if (!c) sfail('letters'); return pc(cfact(c)); }
    case 'pct': info.pct = true; return pscale(ev(ast.a), Q(1n, 100n));
    case 'pi': info.pi = true; return pc(Fraw(Math.PI));
    case 'var': {
      const d = env && env.get(ast.name);
      if (d) { info.subst = true; for (const k of ['dec', 'pct', 'frac', 'mixed', 'div', 'negpow', 'pi']) if (d.info[k]) info[k] = true; return d.val; }
      return pv(ast.name);
    }
  }
  return sfail('unknown');
}

// ------------------------------------------------------------------ answers: LaTeX, text and reading-tree nodes
function SolveOut() { this.tex = ''; this.text = ''; this.nodes = []; }
SolveOut.prototype.sym = function (label, tex, text) {
  this.nodes.push({ k: 's', label });
  tex = tex === undefined ? label : tex;
  if (/\\[A-Za-z]+$/.test(this.tex) && /^[A-Za-z0-9]/.test(tex)) this.tex += ' ';
  this.tex += tex; this.text += text === undefined ? label : text;
};
SolveOut.prototype.digits = function (s) { for (const ch of s) this.sym(ch); };
const digitNodes = s => [...s].map(ch => ({ k: 's', label: ch }));
SolveOut.prototype.frac = function (n, d) {
  this.nodes.push({ k: 'frac', num: digitNodes(n), den: digitNodes(d) });
  this.tex += '\\frac{' + n + '}{' + d + '}'; this.text += (this.text && /[0-9]$/.test(this.text) ? ' ' : '') + n + '/' + d;
};
SolveOut.prototype.over = function (s) { this.nodes.push({ k: 'over', body: digitNodes(s) }); this.tex += '\\overline{' + s + '}'; this.text += '(' + s + ')'; };
SolveOut.prototype.ellipsis = function () { for (let i = 0; i < 3; i++) this.nodes.push({ k: 's', label: '.' }); this.tex += '\\ldots'; this.text += '...'; };
SolveOut.prototype.letter = function (name, power) {
  const m = /^(.*?)_(?:\{(.*)\}|(.))$/.exec(name), label = m ? m[1] : name, sub = m ? m[2] || m[3] : null;
  const n = { k: 's', label };
  if (sub) n.sub = digitNodes(sub);
  if (power > 1) n.sup = digitNodes(String(power));
  this.nodes.push(n);
  if (/\\[A-Za-z]+$/.test(this.tex) && /^[A-Za-z0-9]/.test(label)) this.tex += ' ';
  this.tex += label + (sub ? '_{' + sub + '}' : '') + (power > 1 ? '^{' + power + '}' : '');
  this.text += label.replace(/^\\/, '') + (sub ? '_' + sub : '') + (power > 1 ? '^' + power : '');
};

// a decimal's digits: whole part, the digits before any repeat, the repeating digits ('' when it ends; null when
// the repeat is too long to find)
function decimalParts(q) {
  let n = q.n < 0n ? -q.n : q.n;
  const d = q.d, whole = (n / d).toString();
  let r = n % d;
  const digits = [], seen = new Map();
  while (r !== 0n && !seen.has(r) && digits.length < 40) { seen.set(r, digits.length); r *= 10n; digits.push(String(r / d)); r %= d; }
  if (r === 0n) return { whole, pre: digits.join(''), rep: '' };
  if (seen.has(r)) { const k = seen.get(r); return { whole, pre: digits.slice(0, k).join(''), rep: digits.slice(k).join('') }; }
  return { whole, pre: digits.join(''), rep: null };
}
// k decimal places of |q|, cut off (never rounded up): what is shown before "…" is always how the number starts
function cutDigits(q, k) {
  const n = q.n < 0n ? -q.n : q.n, v = n * 10n ** BigInt(k) / q.d;
  const str = v.toString().padStart(k + 1, '0');
  return { whole: str.slice(0, str.length - k), frac: str.slice(str.length - k) };
}
// a double as the exact fraction it is (every double is a whole number times a power of two)
function qOfDouble(x) {
  let d = 1n;
  while (!Number.isInteger(x)) { x *= 2; d *= 2n; }
  return { n: BigInt(x), d };
}
function putInteger(o, n) {
  const s = (n < 0n ? -n : n).toString();
  if (s.length > 24) sfail('too many digits');
  if (n < 0n) o.sym('-');
  o.digits(s);
}
// an exact number in a style: 'dec' (exact, repeating with a bar, or cut with an ellipsis), 'frac', 'mixed'
function putExact(o, q, style, kind) {
  if (q.d === 1n) { putInteger(o, q.n); kind.v = 'integer'; return; }
  const neg = q.n < 0n, an = neg ? -q.n : q.n;
  if (style === 'dec') {
    const D = decimalParts(q);
    if (D.whole.length > 15) sfail('too many digits');
    if (D.rep === '' && D.pre.length <= 12) { if (neg) o.sym('-'); o.digits(D.whole); o.sym('.'); o.digits(D.pre); kind.v = 'decimal'; return; }
    if (D.rep && D.pre.length <= 6 && D.rep.length <= 6) { if (neg) o.sym('-'); o.digits(D.whole); o.sym('.'); if (D.pre) o.digits(D.pre); o.over(D.rep); kind.v = 'repeating'; return; }
    // four places; a small number keeps three significant digits (0.0000223…) instead of cutting to nothing
    let R = cutDigits(q, 4);
    if (R.whole === '0' && R.frac.startsWith('00')) {
      const lead = ((D.pre + (D.rep || '')).match(/^0*/) || [''])[0].length;
      if (lead > 8) sfail('too small');
      R = cutDigits(q, lead + 3);
    }
    if (neg) o.sym('-'); o.digits(R.whole); o.sym('.'); o.digits(R.frac); o.ellipsis(); kind.v = 'approx'; return;
  }
  if (an.toString().length > 24 || q.d.toString().length > 24) sfail('too many digits');
  if (neg) o.sym('-');
  if (style === 'mixed' && an > q.d) { o.digits((an / q.d).toString()); o.frac((an % q.d).toString(), q.d.toString()); kind.v = 'mixed'; return; }
  o.frac(an.toString(), q.d.toString()); kind.v = 'fraction';
}
// an approximation: three decimal places (fewer for a number so big a double cannot hold them), three significant
// digits for a small one, cut and followed by "…"
function putApprox(o, v, kind) {
  if (!Number.isFinite(v)) sfail('not a number');
  const a = Math.abs(v);
  if (a >= 1e15) sfail('too big');
  const q = qOfDouble(a);
  let places = Math.min(3, 15 - String(Math.floor(a)).length);
  if (a < 1) {
    const lead = (cutDigits(q, 20).frac.match(/^0*/) || [''])[0].length;
    if (lead > 12) sfail('too small');
    places = lead + 3;
  }
  const R = cutDigits(q, places);
  if (v < 0) o.sym('-');
  o.digits(R.whole);
  if (places > 0) { o.sym('.'); o.digits(R.frac); }
  o.ellipsis(); kind.v = 'approx';
}

// what kind of lone number was written (through a minus sign and brackets), or null when it is a calculation
function literalOf(ast) {
  let a = ast, negs = 0;
  while (a.t === 'neg' || a.t === 'pos' || a.t === 'group') { if (a.t === 'neg') negs++; a = a.a; }
  // a fraction of whole numbers, stacked or with a slash, a sign on top or underneath: 3/4, -3/4, \frac{-3}{4}
  const whole = x => { let s = 0; while (x.t === 'neg' || x.t === 'pos') { if (x.t === 'neg') s++; x = x.a; } return x.t === 'num' && /^\d+$/.test(x.text) ? { text: x.text, negs: s } : null; };
  if (a.t === 'frac' || (a.t === 'div' && a.sym === '/')) {
    const n = whole(a.a), d = whole(a.b);
    if (n && d) {
      if (negs + n.negs + d.negs > 1) return null;                   // -(-3)/4: the signs are the working
      return bgcd(BigInt(n.text), BigInt(d.text)) > 1n ? 'frac-reduce' : 'frac';
    }
  }
  if (negs > 1) return null;                                          // -(-4): the signs are the working
  if (a.t === 'num') return a.text.includes('.') ? 'dec' : 'int';
  if (a.t === 'mixed') return 'mixed';
  if (a.t === 'pct' && a.a.t === 'num') return 'pct';
  if (a.t === 'var') return 'var';
  if (a.t === 'pi') return 'pi';
  return null;
}
// already as simple as it gets: a sum of terms like 3x^2, -x, 5, no two alike; or one such sum over a whole number
// with nothing to cancel, (x + 1)/2
function simplified(ast, how) {
  if (how.signs || how.subst) return false;                           // x + -3, or a value to put in
  while (ast.t === 'group') ast = ast.a;                              // (5x): brackets round it all change nothing
  if (ast.t === 'frac' && ast.b.t === 'num' && /^\d+$/.test(ast.b.text) && BigInt(ast.b.text) > 1n && simplified(ast.a, how)) {
    let g = BigInt(ast.b.text);
    try {
      for (const c of solveEval(ast.a, null, {}).values()) { if (isFl(c) || c.d !== 1n) return false; g = bgcd(g, c.n); }
    } catch (e) { if (e instanceof SolveError) return false; throw e; }
    return g === 1n;
  }
  const terms = [];
  const flat = (a, sign) => {
    if (a.t === 'add') { flat(a.a, sign); flat(a.b, sign); }
    else if (a.t === 'sub') { flat(a.a, sign); flat(a.b, -sign); }
    else terms.push(a);
  };
  flat(ast, 1);
  const keys = new Set();
  for (let t of terms) {
    if (t.t === 'neg') t = t.a;
    const factors = [];
    const unmul = a => { if (a.t === 'mul' && a.implicit) { unmul(a.a); unmul(a.b); } else factors.push(a); };
    unmul(t);
    if (factors[0].t === 'neg') factors[0] = factors[0].a;              // -5a: the sign is on the 5
    let k = 0;
    if (factors[0].t === 'num' || (factors[0].t === 'frac' && literalOf(factors[0]) === 'frac')) {
      const z = factors[0].t === 'num' && /^0*\.?0*$/.test(factors[0].text), u = factors[0].t === 'num' && /^0*1(\.0*)?$/.test(factors[0].text);
      if (factors.length > 1 && (z || u)) return false;                // 1x, 0x
      if (factors.length === 1 && z && terms.length > 1) return false;  // x + 0
      k = 1;
    }
    const vars = new Map();
    for (const f of factors.slice(k)) {
      let name, e = 1;
      if (f.t === 'var') name = f.name;
      else if (f.t === 'pow' && f.a.t === 'var' && f.b.t === 'num' && /^\d+$/.test(f.b.text) && +f.b.text >= 2) { name = f.a.name; e = +f.b.text; }
      else return false;
      if (vars.has(name)) return false;
      vars.set(name, e);
    }
    if (k === 0 && !vars.size) return false;
    const key = mkey(vars);
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}
// standard form: highest power first; terms of the same degree by their letters in alphabetical order (a² − 2ab + b²)
function polyOrder(p) {
  const vars = [...pvars(p)].sort();
  return [...p.keys()].sort((a, b) => {
    const d = mdeg(b) - mdeg(a);
    if (d) return d;
    const ma = mparse(a), mb = mparse(b);
    for (const v of vars) { const x = ma.get(v) || 0, y = mb.get(v) || 0; if (x !== y) return y - x; }
    return 0;
  });
}
function putPoly(o, p, info, kind) {
  const style = info.dec || info.pct ? 'dec' : 'frac';
  polyOrder(p).forEach((k, i) => {
    let c = p.get(k);
    if (isFl(c)) sfail('approximate letters');
    const neg = c.n < 0n;
    if (neg) c = cneg(c);
    if (i) o.sym(neg ? '-' : '+'); else if (neg) o.sym('-');
    const one = c.n === 1n && c.d === 1n;
    if (!k || !one) {
      const sub = { v: '' };
      if (style === 'dec' && c.d !== 1n) {
        const D = decimalParts(c);
        if (!(D.rep === '' && D.pre.length <= 12) && !(D.rep && D.pre.length <= 6 && D.rep.length <= 6)) putExact(o, c, 'frac', sub);
        else putExact(o, c, 'dec', sub);
      } else putExact(o, c, 'frac', sub);
    }
    for (const [v, e] of mparse(k)) o.letter(v, e);
  });
  kind.v = 'expression';
}
// how percents were used: 'sum' (15% + 5%: the answer is a percent), 'times100' (3/4 × 100%: a percent too), 'mixed'
// (80 + 15%: a percent of what? no answer), or null
function percentForm(ast) {
  const terms = [];
  const flat = a => { if (a.t === 'add' || a.t === 'sub') { flat(a.a); flat(a.b); } else terms.push(a); };
  flat(ast);
  const isPct = a => { while (a.t === 'neg' || a.t === 'pos' || a.t === 'group') a = a.a; return a.t === 'pct'; };
  const p = terms.filter(isPct).length;
  if (terms.length > 1 && p) return p === terms.length ? 'sum' : 'mixed';
  let t = ast;
  while (t.t === 'group') t = t.a;
  if (t.t === 'mul' && t.b.t === 'pct' && t.b.a.t === 'num' && /^100(\.0*)?$/.test(t.b.a.text)) return 'times100';
  return null;
}
const answerFrom = (o, kind, c) => ({ latex: o.tex, text: o.text, nodes: o.nodes, kind: kind.v, exact: !(c && isFl(c)) && kind.v !== 'approx', value: c ? cval(c) : null });
// the answer to one expression (the tokens before a trailing "="), or null. A value that ended the working of an
// equation above (2x + 3 = 11, then x = 4) is put in only when there is nothing else to do: x + 1 = gives 5, and
// 3x + 2x = gives 5x
function answerOf(tokens, env) {
  const hard = env && [...env.values()].some(d => d.soft) ? new Map([...env].filter(([, d]) => !d.soft)) : env;
  const a = answerWith(tokens, hard);
  return a === null && hard !== env ? answerWith(tokens, env) : a;
}
function answerWith(tokens, env) {
  const ast = solveParse(tokens);
  const info = {};
  const val = solveEval(ast, env, info);
  const o = new SolveOut(), kind = { v: '' };
  const c = pconst(val), pf = percentForm(ast);
  if (pf === 'mixed') sfail('a percent of what');
  if (c) {
    const lit = literalOf(ast);
    if (lit === 'int') return null;
    if (pf) {
      const c100 = cmul(c, Q(100n));
      if (isFl(c100)) putApprox(o, c100.f, kind); else putExact(o, c100, info.frac && !info.dec ? 'mixed' : 'dec', kind);
      o.sym('%', '\\%', '%');
      const a = answerFrom(o, kind, c);
      a.kind = 'percent';
      return a;
    } else if (isFl(c)) putApprox(o, c.f, kind);
    else if (lit === 'dec') putExact(o, c, 'mixed', kind);
    else if (lit === 'pct') putExact(o, c, 'dec', kind);
    else if (lit === 'mixed' || lit === 'frac-reduce') putExact(o, c, 'frac', kind);
    else if (lit === 'frac') putExact(o, c, (c.n < 0n ? -c.n : c.n) > c.d ? 'mixed' : 'dec', kind);
    else {
      let style = 'frac';
      if (info.dec || info.pct) style = 'dec';
      else if (info.frac) style = info.mixed ? 'mixed' : 'frac';
      else if (info.div && !info.negpow) style = 'dec';
      putExact(o, c, style, kind);
    }
  } else {
    // two signs in a row (x + -3) are working to do; so is a letter with a value given above
    const signs = tokens.some((t, i) => t.t === 'op' && tokens[i + 1] && tokens[i + 1].t === 'op' && (tokens[i + 1].v === '+' || tokens[i + 1].v === '-'));
    if (simplified(ast, { signs, subst: info.subst })) return null;
    putPoly(o, val, info, kind);
  }
  return answerFrom(o, kind, c);
}

// ------------------------------------------------------------------ equations
const SOLVE_FLIP = { '<': '>', '>': '<', '\\le': '\\ge', '\\ge': '\\le' };
// a solution: the value in the form the equation was written in (decimals give decimals; otherwise fractions, mixed
// numbers when it had them); pm: "±" in front (x² = 49)
function valueAnswer(c, info, pm) {
  const o = new SolveOut(), kind = { v: '' };
  if (pm) o.sym('\\pm', '\\pm', '±');
  if (isFl(c)) putApprox(o, c.f, kind);
  else putExact(o, c, info.dec || info.pct ? 'dec' : info.mixed ? 'mixed' : 'frac', kind);
  const a = answerFrom(o, kind, c);
  if (pm) a.kind = 'plusminus';
  return a;
}
// P (everything moved to one side) as a sum of numbers times single letters, or null
function linearOf(P) {
  const coef = new Map();
  let c0 = QZERO;
  for (const [k, c] of P) {
    if (isFl(c)) return null;
    if (!k) { c0 = c; continue; }
    const m = mparse(k);
    if (m.size !== 1 || [...m.values()][0] !== 1) return null;
    coef.set(k, c);
  }
  return { coef, c0 };
}
// exact elimination: rank of the chosen equations, and the values when there are as many as unknowns
function eliminate(lins, U) {
  const A = lins.map(l => U.map(u => l.coef.get(u) || QZERO).concat([cneg(l.c0)]));
  let rank = 0;
  const where = [];
  for (let col = 0; col < U.length && rank < A.length; col++) {
    const piv = A.findIndex((r, i) => i >= rank && !czero(r[col]));
    if (piv < 0) continue;
    [A[rank], A[piv]] = [A[piv], A[rank]];
    const inv = cdiv(QONE, A[rank][col]);
    A[rank] = A[rank].map(x => cmul(x, inv));
    for (let r = 0; r < A.length; r++) {
      if (r === rank || czero(A[r][col])) continue;
      const f = A[r][col];
      A[r] = A[r].map((x, k) => csub(x, cmul(f, A[rank][k])));
    }
    where[col] = rank++;
  }
  return { rank, value: u => { const col = U.indexOf(u), r = where[col]; return r === undefined ? null : A[r][U.length]; } };
}
// one letter: a·x + b = 0, or a·xⁿ + b = 0 for n = 2, 3
function solveOne(v, E) {
  const P = E.P, keys = [...P.keys()];
  if (keys.every(k => k === '' || k === v) && P.has(v)) return valueAnswer(cdiv(cneg(P.get('') || QZERO), P.get(v)), E.info);
  for (const n of [2, 3]) {
    const kn = v + '^' + n;
    if (!(P.has(kn) && keys.every(k => k === '' || k === kn))) continue;
    const q = cdiv(cneg(P.get('') || QZERO), P.get(kn));
    if (n === 3) return valueAnswer(croot(q, 3), E.info);
    if (csign(q) < 0) return null;                                    // no number squared is negative
    if (czero(q)) return valueAnswer(QZERO, E.info);
    return valueAnswer(croot(q, 2), E.info, true);
  }
  return null;                                                        // x + 1 = x + 2, x² + 5x + 6 = 0: no answer here
}
// "v =" or "v <" ... under equations: the nearest one above with v in it, with the nearest others that pin down its
// other letters (those just above it first: the problem as set, before any working below it)
function solveFor(v, ask, eqs) {
  let k = eqs.length - 1;
  while (k >= 0 && !eqs[k].vars.has(v)) k--;
  if (k < 0) return undefined;
  const E = eqs[k];
  if (E.rel !== '=') {
    if (E.vars.size !== 1 || !SOLVE_FLIP[E.rel] || !SOLVE_FLIP[ask]) return null;
    const P = E.P;
    if (!P.has(v) || ![...P.keys()].every(x => x === '' || x === v)) return null;
    const a = P.get(v), rel = csign(a) < 0 ? SOLVE_FLIP[E.rel] : E.rel;
    // the number only when the sign written is the right one: deciding which way it points is the lesson
    return ask === rel ? valueAnswer(cdiv(cneg(P.get('') || QZERO), a), E.info) : null;
  }
  if (ask !== '=') return null;
  if (E.vars.size === 1) return solveOne(v, E);
  let U = [...E.vars].sort();
  const lin = linearOf(E.P);
  if (U.length > 3 || !lin) return null;
  const chosen = [lin], info = Object.assign({}, E.info);
  const order = [];
  for (let i = k - 1; i >= 0; i--) order.push(eqs[i]);
  for (let i = k + 1; i < eqs.length; i++) order.push(eqs[i]);
  // up to three letters in all; an equation is taken when it says something the others do not
  for (const C of order) {
    if (chosen.length === U.length) break;
    const l = C.rel === '=' && linearOf(C.P);
    if (!l) continue;
    const W = [...new Set([...U, ...C.vars])].sort();
    if (W.length > 3 || eliminate(chosen.concat([l]), W).rank !== chosen.length + 1) continue;
    chosen.push(l); U = W; Object.assign(info, C.info);
  }
  if (chosen.length < U.length) return null;
  const x = eliminate(chosen, U).value(v);
  return x ? valueAnswer(x, info) : null;
}
// every part of a chain must agree with the last before it is worked out: 2(3 + 4) = 2 · 7 = has an answer,
// 3 + 4 = 9 + 1 = does not
function chainAgrees(toks, rel, env) {
  const parts = [];
  let s = 0;
  for (const i of rel) { parts.push(toks.slice(s, i)); s = i + 1; }
  const vals = parts.map(p => { try { return p.length ? solveEval(solveParse(p), env, {}) : null; } catch (e) { if (e instanceof SolveError) return null; throw e; } });
  const last = vals[vals.length - 1];
  if (!last) return true;
  const cl = pconst(last);
  for (const p of vals.slice(0, -1)) {
    if (!p) continue;
    const c = pconst(p);
    if (c && cl ? !csame(c, cl) : !c && !cl && !psame(p, last)) return false;
  }
  return true;
}

// Every line of a reading (rows of its tree): an answer for each line that ends with "=" (or with x and a sign under
// an equation), null for the others. "x = 5" on a line gives x for the lines below it (only where there is nothing
// else to do when it ends the working of an equation in x on the line just above), until an equation below it that
// x = 5 does not satisfy makes x an unknown again.
// options.times === false: × is never a times sign (see tokensOf). above: the equations of the writing just above
// (the .eqs of its solveRows), for an "x =" written further down than its equation. The result carries this
// writing's own equations as .eqs.
function solveRows(rows, options, above) {
  const env = new Map(), kinds = [];
  const eqs = (above || []).map(e => Object.assign({}, e, { line: -Infinity }));
  const out = (rows || []).map((row, line) => {
    kinds[line] = null;
    try {
      const toks = tokensOf(row, options);
      const rel = [];
      toks.forEach((t, i) => { if (t.t === 'rel') rel.push(i); });
      if (!rel.length) return null;
      const last = toks.length - 1;
      if (toks[last].t === 'rel') {
        kinds[line] = 'ask';
        const ask = toks[last].v;
        if (!SOLVE_ASK.has(ask)) return null;
        const from = rel.length > 1 ? rel[rel.length - 2] + 1 : 0, seg = toks.slice(from, last);
        if (rel.length === 1 && seg.length === 1 && seg[0].t === 'var') {
          const s = solveFor(seg[0].v, ask, eqs);
          if (s !== undefined) return s;
        }
        if (ask !== '=' || rel.some(i => toks[i].v !== '=') || !seg.length) return null;
        if (rel.length > 1 && !chainAgrees(toks, rel, env)) return null;
        return answerOf(seg, env);
      }
      // an equation or inequality: kept for "x =" below it
      if (rel.length !== 1 || rel[0] === 0 || !SOLVE_ASK.has(toks[rel[0]].v)) return null;
      const r = toks[rel[0]].v, L = toks.slice(0, rel[0]), R = toks.slice(rel[0] + 1);
      const info = {}, lp = solveEval(solveParse(L), null, info), rp = solveEval(solveParse(R), null, info);
      const vars = new Set([...pvars(lp), ...pvars(rp)]), P = padd(lp, pneg(rp));
      let given = null;
      if (r === '=' && L.length === 1 && L[0].t === 'var') {
        try { const gi = {}, gv = solveEval(solveParse(R), env, gi); if (pconst(gv)) given = { val: gv, info: gi }; } catch (e) { if (!(e instanceof SolveError)) throw e; }
      }
      if (given) {
        const v = L[0].v, prev = eqs[eqs.length - 1];
        const solving = kinds[line - 1] === 'eq' && prev && prev.line === line - 1 && prev.vars.has(v);
        env.set(v, solving ? Object.assign(given, { soft: true }) : given);
        kinds[line] = 'given';
      } else {
        kinds[line] = 'eq';
        // an equation the given values do not satisfy starts a new problem: its letters are unknowns again
        if (r === '=' && [...vars].some(x => env.has(x))) {
          let holds = true;
          try { const c = pconst(solveEval(solveParse(L), env, {})), d = pconst(solveEval(solveParse(R), env, {})); holds = !(c && d) || csame(c, d); } catch (e) { if (!(e instanceof SolveError)) throw e; }
          if (!holds) for (const x of vars) env.delete(x);
        }
      }
      if (vars.size) eqs.push({ rel: r, P, vars, info, line });
      return null;
    } catch (e) {
      if (e instanceof SolveError || e instanceof RangeError) return null;
      throw e;
    }
  });
  Object.defineProperty(out, 'eqs', { value: eqs.filter(e => e.line !== -Infinity) });
  return out;
}

// ------------------------------------------------------------------ LaTeX -> reading-tree rows (for Nib.solve)
const LATEX_CMD = { times: '\\times', cdot: '\\cdot', div: '\\div', pm: '\\pm', le: '\\le', leq: '\\le', ge: '\\ge', geq: '\\ge',
  leqslant: '\\le', geqslant: '\\ge', lt: '<', gt: '>',
  ne: '\\ne', neq: '\\ne', pi: '\\pi', theta: '\\theta', alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', lambda: '\\lambda',
  mu: '\\mu', sigma: '\\sigma', phi: '\\phi', Delta: '\\Delta', '%': '%', '{': '\\{', '}': '\\}', lbrace: '\\{', rbrace: '\\}',
  ast: '\\times', infty: '\\infty', ldots: '\\ldots', rightarrow: '\\rightarrow', to: '\\rightarrow', in: '\\in', circ: '\\circ', prime: '\\prime' };
// each line on its own, so one that cannot be read leaves the others: [row, ...] (a row that cannot be read is
// [{k: 'bad'}], which has no answer)
function latexRows(src) {
  const s = String(src == null ? '' : src).replace(/\\begin\{(gathered|aligned|array|gather\*?|align\*?)\}(\{[^}]*\})?|\\end\{(gathered|aligned|array|gather\*?|align\*?)\}/g, '').replace(/&/g, '');
  return s.split(/\\\\/).map(part => {
    try { return latexRow(part); } catch (e) { if (e instanceof SolveError || e instanceof RangeError) return [{ k: 'bad' }]; throw e; }
  });
}
function latexRow(s) {
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  function group() {
    ws();
    if (s[i] === '{') { i++; const r = row('}'); if (s[i] !== '}') sfail('braces'); i++; return r; }
    return row(null, true);
  }
  function row(end, one) {
    const out = [];
    for (;;) {
      ws();
      if (i >= s.length || (end && s[i] === end)) break;
      let node;
      const c = s[i];
      if (c === '^' || c === '_') {
        i++;
        const g = group(), t = out[out.length - 1], key = c === '^' ? 'sup' : 'sub';
        if (!t) sfail('script');
        if (t[key]) sfail('two scripts');                       // 2^3^2: TeX will not have it, nor will we guess
        t[key] = g;
        if (one) break;
        continue;
      }
      if (c === '\\') {
        const m = /^\\([A-Za-z]+|[\s\S])?/.exec(s.slice(i));
        if (!m[1]) sfail('a lone backslash');
        i += m[0].length;
        const name = m[1];
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') node = { k: 'frac', num: group(), den: group() };
        else if (name === 'sqrt') {
          ws();
          let idx;
          if (s[i] === '[') { i++; idx = row(']'); if (s[i] !== ']') sfail('root'); i++; }
          node = { k: 'root', body: group(), idx };
        } else if (name === 'left' || name === 'right') continue;
        else if (name === ',' || name === ';' || name === ' ' || name === '!' || name === 'quad' || name === 'qquad' || /^\s$/.test(name)) continue;
        else if (name === 'overline') { node = { k: 'over', body: group() }; }
        else node = { k: 's', label: LATEX_CMD[name] || '\\' + name };
      } else if (c === '{') { i++; const r = row('}'); if (s[i] !== '}') sfail('braces'); i++; out.push(...r); if (one) break; continue; }
      else { i++; node = { k: 's', label: c === '*' ? '\\times' : c }; }
      out.push(node);
      if (one) break;
    }
    return out;
  }
  const r = row(null);
  if (i < s.length) sfail('unexpected ' + s[i]);
  return r;
}
