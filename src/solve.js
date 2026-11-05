// ================================================================== working out what is written before an "="
// A line that ends with "=" is worked out. Numbers are exact (BigInt fractions): whole numbers, decimals, fractions,
// mixed numbers and percents, with + − × ÷, brackets, powers, roots, absolute values and factorials; π and roots that
// do not come out are approximated. Letters stay letters — like terms are combined and brackets multiplied out —
// unless a line above, in the same piece of work, set them ("x = 5"). The answer takes the form the question was
// asked in (decimals give decimals, fractions give fractions, mixed numbers give mixed numbers), and a lone number is
// turned into its other form (3/4 → 0.75, 0.75 → 3/4, 5 1/3 → 16/3, 16/3 → 5 1/3, 75% → 0.75).
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
const Fl = v => (Number.isFinite(v) ? { f: v } : sfail('not a number'));
const isFl = c => c.f !== undefined;
const cval = c => (isFl(c) ? c.f : qnum(c));
const czero = c => (isFl(c) ? Math.abs(c.f) < 1e-12 : c.n === 0n);
const cneg = c => (isFl(c) ? { f: -c.f } : { n: -c.n, d: c.d });
const cadd = (a, b) => (isFl(a) || isFl(b) ? Fl(cval(a) + cval(b)) : Q(a.n * b.d + b.n * a.d, a.d * b.d));
const csub = (a, b) => cadd(a, cneg(b));
const cmul = (a, b) => (isFl(a) || isFl(b) ? Fl(cval(a) * cval(b)) : Q(a.n * b.n, a.d * b.d));
const cdiv = (a, b) => (czero(b) ? sfail('division by zero') : isFl(a) || isFl(b) ? Fl(cval(a) / cval(b)) : Q(a.n * b.d, a.d * b.n));
const cabs = c => (isFl(c) ? { f: Math.abs(c.f) } : { n: c.n < 0n ? -c.n : c.n, d: c.d });
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
  return Fl(Math.pow(qnum(c), 1 / k));
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
function pput(m, k, c) { const prev = m.get(k), v = prev ? cadd(prev, c) : c; if (czero(v)) m.delete(k); else m.set(k, v); }
function padd(a, b) { const out = new Map(a); for (const [k, c] of b) pput(out, k, c); return out; }
function pneg(a) { const out = new Map(); for (const [k, c] of a) out.set(k, cneg(c)); return out; }
function pscale(a, c) { const out = new Map(); if (czero(c)) return out; for (const [k, v] of a) out.set(k, cmul(v, c)); return out; }
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
function pdiv(a, b) {
  const c = pconst(b);
  if (!c) sfail('dividing by letters');
  return pscale(a, cdiv(QONE, c));
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
const SOLVE_OPEN = { '(': ')', '[': ']', '\\{': '\\}' };
const SOLVE_CLOSE = new Set([')', ']', '\\}']);
const SOLVE_VARS = /^[A-Za-z]$|^\\(alpha|beta|gamma|theta|lambda|mu|sigma|phi|Delta)$/;
function tokensOf(row) {
  const out = [];
  const lastNum = () => { const t = out[out.length - 1]; return t && t.t === 'num' && !t.closed ? t : null; };
  for (let i = 0; i < (row || []).length; i++) {
    const u = row[i], nx = row[i + 1];
    if (u.k === 'frac') out.push({ t: 'frac', num: tokensOf(u.num), den: tokensOf(u.den) });
    else if (u.k === 'root') out.push({ t: 'root', body: tokensOf(u.body), idx: u.idx && u.idx.length ? tokensOf(u.idx) : null });
    else if (u.k !== 's') sfail('unknown');
    else {
      const l = u.label, n = lastNum();
      if (/^[0-9]$/.test(l)) { if (n) n.v += l; else out.push({ t: 'num', v: l }); }
      else if (l === '.') {
        if (n && !n.v.includes('.')) n.v += '.';
        else if (!n && nx && nx.k === 's' && /^[0-9]$/.test(nx.label)) out.push({ t: 'num', v: '.' });
        else sfail('a stray point');
      } else if (l === ',') {
        // 1,000: a thousands comma; anything else is not arithmetic
        const d = row.slice(i + 1, i + 4);
        if (n && !n.v.includes('.') && d.length === 3 && d.every(x => x.k === 's' && /^[0-9]$/.test(x.label) && !x.sup && !x.sub) &&
          !(row[i + 4] && row[i + 4].k === 's' && /^[0-9]$/.test(row[i + 4].label))) { /* skip it */ } else sfail('a comma');
      } else if (l === '+' || l === '-') out.push({ t: 'op', v: l });
      else if (l === '\\times' || l === '\\cdot') out.push({ t: 'op', v: '*' });
      else if (l === '\\div') out.push({ t: 'op', v: '÷' });
      else if (l === '/') out.push({ t: 'op', v: '/' });
      else if (SOLVE_REL.has(l)) out.push({ t: 'rel', v: l });
      else if (SOLVE_OPEN[l]) out.push({ t: 'open', v: l });
      else if (SOLVE_CLOSE.has(l)) out.push({ t: 'close', v: l });
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
    if (u.sup) { const t = out[out.length - 1]; if (t && t.t === 'num') t.closed = true; out.push({ t: 'sup', v: tokensOf(u.sup) }); }
  }
  // "3 x 4", "15% x 60", "(2+3) x 4": a lone x before a number, after a number, percent or bracket, is a times sign;
  // "15% of 80": "of" is times
  for (let i = 1; i + 1 < out.length; i++) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    if (b.t === 'var' && (b.v === 'x' || b.v === 'X') && (a.t === 'num' || a.t === 'pct' || a.t === 'close') && c.t === 'num') out[i] = { t: 'op', v: '*' };
    if (b.t === 'var' && b.v === 'o' && c.t === 'var' && c.v === 'f' && (a.t === 'pct' || a.t === 'num')) { out.splice(i, 2, { t: 'op', v: '*' }); }
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
      if (tk && tk.t === 'op' && (tk.v === '*' || tk.v === '/' || tk.v === '÷')) { next(); const b = unary(inAbs); a = tk.v === '*' ? { t: 'mul', a, b } : { t: 'div', a, b, sym: tk.v }; }
      else if (starts(tk, inAbs)) a = { t: 'mul', a, b: power(inAbs), implicit: true };
      else return a;
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
// info gathers how the question was asked: decimals, percents, fractions, mixed numbers, division, negative powers
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
    case 'div': info.div = true; return pdiv(ev(ast.a), ev(ast.b));
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
    case 'pi': info.pi = true; return pc(Fl(Math.PI));
    case 'var': {
      const d = env && env.get(ast.name);
      if (d) { for (const k of ['dec', 'pct', 'frac', 'mixed', 'div', 'negpow', 'pi']) if (d.info[k]) info[k] = true; return d.val; }
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
// k decimal places, rounded half up (exact)
function roundedDigits(q, k) {
  const n = q.n < 0n ? -q.n : q.n, s = 10n ** BigInt(k), v = (2n * n * s + q.d) / (2n * q.d);
  const str = v.toString().padStart(k + 1, '0');
  return { whole: str.slice(0, str.length - k), frac: str.slice(str.length - k), zero: v === 0n };
}
function putInteger(o, n) {
  const s = (n < 0n ? -n : n).toString();
  if (s.length > 24) sfail('too many digits');
  if (n < 0n) o.sym('-');
  o.digits(s);
}
// an exact number in a style: 'dec' (exact, repeating with a bar, or rounded with an ellipsis), 'frac', 'mixed'
function putExact(o, q, style, kind) {
  if (q.d === 1n) { putInteger(o, q.n); kind.v = 'integer'; return; }
  const neg = q.n < 0n, an = neg ? -q.n : q.n;
  if (style === 'dec') {
    const D = decimalParts(q);
    if (D.whole.length > 15) sfail('too many digits');
    if (D.rep === '' && D.pre.length <= 12) { if (neg) o.sym('-'); o.digits(D.whole); o.sym('.'); o.digits(D.pre); kind.v = 'decimal'; return; }
    if (D.rep && D.pre.length <= 6 && D.rep.length <= 6) { if (neg) o.sym('-'); o.digits(D.whole); o.sym('.'); if (D.pre) o.digits(D.pre); o.over(D.rep); kind.v = 'repeating'; return; }
    // four places; a small number gets three significant digits (0.0000224…) instead of rounding to nothing
    let R = roundedDigits(q, 4);
    if (R.zero || /^0+$/.test(R.frac.slice(0, 2)) && R.whole === '0') {
      const lead = ((D.pre + (D.rep || '')).match(/^0*/) || [''])[0].length;
      if (lead > 8) sfail('too small');
      R = roundedDigits(q, lead + 3);
    }
    if (R.whole.length > 15) sfail('too many digits');
    if (neg) o.sym('-'); o.digits(R.whole); o.sym('.'); o.digits(R.frac); o.ellipsis(); kind.v = 'approx'; return;
  }
  if (an.toString().length > 24 || q.d.toString().length > 24) sfail('too many digits');
  if (neg) o.sym('-');
  if (style === 'mixed' && an > q.d) { o.digits((an / q.d).toString()); o.frac((an % q.d).toString(), q.d.toString()); kind.v = 'mixed'; return; }
  o.frac(an.toString(), q.d.toString()); kind.v = 'fraction';
}
function putApprox(o, v, kind) {
  if (!Number.isFinite(v) || Math.abs(v) >= 1e15) sfail('too big');
  const r = Math.round(v);
  if (Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v))) { putInteger(o, BigInt(r)); kind.v = 'integer'; return; }
  const s = Math.abs(v).toFixed(3);
  if (/^0\.000$/.test(s)) sfail('too small');
  if (v < 0) o.sym('-');
  const [w, f] = s.split('.');
  o.digits(w); o.sym('.'); o.digits(f); o.ellipsis(); kind.v = 'approx';
}

// what kind of lone number was written (through a minus sign and brackets), or null when it is a calculation
function literalOf(ast) {
  let a = ast, negs = 0;
  while (a.t === 'neg' || a.t === 'pos' || a.t === 'group') { if (a.t === 'neg') negs++; a = a.a; }
  if (negs > 1) return null;                                          // -(-4): the signs are the working
  if (a.t === 'num') return a.text.includes('.') ? 'dec' : 'int';
  if (a.t === 'mixed') return 'mixed';
  if (a.t === 'frac' && a.a.t === 'num' && a.b.t === 'num' && /^\d+$/.test(a.a.text) && /^\d+$/.test(a.b.text)) {
    return bgcd(BigInt(a.a.text), BigInt(a.b.text)) > 1n ? 'frac-reduce' : 'frac';
  }
  if (a.t === 'pct' && a.a.t === 'num') return 'pct';
  if (a.t === 'var') return 'var';
  if (a.t === 'pi') return 'pi';
  return null;
}
// already as simple as it gets: a sum of terms like 3x^2, -x, 5, no two alike
function simplified(ast) {
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
function putPoly(o, p, info, kind) {
  const keys = [...p.keys()].sort((a, b) => mdeg(b) - mdeg(a) || (a < b ? -1 : a > b ? 1 : 0));
  const style = info.dec || info.pct ? 'dec' : 'frac';
  keys.forEach((k, i) => {
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
// the answer to one expression (the tokens before a trailing "="), or null
function answerOf(tokens, env) {
  const ast = solveParse(tokens);
  const info = {};
  const val = solveEval(ast, env, info);
  const o = new SolveOut(), kind = { v: '' };
  const c = pconst(val);
  if (c) {
    const lit = literalOf(ast);
    if (lit === 'int') return null;
    if (isFl(c)) putApprox(o, c.f, kind);
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
    if (simplified(ast)) return null;
    putPoly(o, val, info, kind);
  }
  return { latex: o.tex, text: o.text, nodes: o.nodes, kind: kind.v, exact: !(c && isFl(c)) && kind.v !== 'approx', value: c ? cval(c) : null };
}

// Every line of a reading (rows of its tree): an answer for each line that ends with "=", null for the others.
// "x = 5" on a line sets x for the lines below it.
function solveRows(rows) {
  const env = new Map();
  return (rows || []).map(row => {
    try {
      const toks = tokensOf(row);
      const rel = [];
      toks.forEach((t, i) => { if (t.t === 'rel') rel.push(i); });
      if (!rel.length) return null;
      const last = toks.length - 1;
      if (toks[last].t === 'rel') {
        if (toks[last].v !== '=' || rel.some(i => toks[i].v !== '=')) return null;
        const from = rel.length > 1 ? rel[rel.length - 2] + 1 : 0;
        return from < last ? answerOf(toks.slice(from, last), env) : null;
      }
      if (rel.length === 1 && rel[0] === 1 && toks[0].t === 'var' && toks[1].v === '=') {
        const info = {}, val = solveEval(solveParse(toks.slice(2)), env, info);
        if (pconst(val)) env.set(toks[0].v, { val, info });
      }
      return null;
    } catch (e) {
      if (e instanceof SolveError || e instanceof RangeError) return null;
      throw e;
    }
  });
}

// ------------------------------------------------------------------ LaTeX -> reading-tree rows (for Nib.solve)
const LATEX_CMD = { times: '\\times', cdot: '\\cdot', div: '\\div', pm: '\\pm', le: '\\le', leq: '\\le', ge: '\\ge', geq: '\\ge',
  ne: '\\ne', neq: '\\ne', pi: '\\pi', theta: '\\theta', alpha: '\\alpha', beta: '\\beta', gamma: '\\gamma', lambda: '\\lambda',
  mu: '\\mu', sigma: '\\sigma', phi: '\\phi', Delta: '\\Delta', '%': '%', '{': '\\{', '}': '\\}', lbrace: '\\{', rbrace: '\\}',
  ast: '\\times', infty: '\\infty', ldots: '\\ldots', rightarrow: '\\rightarrow', to: '\\rightarrow', in: '\\in', circ: '\\circ', prime: '\\prime' };
function latexRows(src) {
  let s = String(src || '').replace(/\\begin\{(gathered|aligned|array)\}(\{[^}]*\})?|\\end\{(gathered|aligned|array)\}/g, '').replace(/&/g, '');
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
      if (i >= s.length || (end && s[i] === end) || (s[i] === ']' && end === ']')) break;
      if (s[i] === '\\' && s[i + 1] === '\\') break;
      let node;
      const c = s[i];
      if (c === '^' || c === '_') {
        i++;
        const g = group(), t = out[out.length - 1];
        if (!t) sfail('script');
        t[c === '^' ? 'sup' : 'sub'] = g;
        if (one) break;
        continue;
      }
      if (c === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
        i += m[0].length;
        const name = m[1];
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') node = { k: 'frac', num: group(), den: group() };
        else if (name === 'sqrt') {
          ws();
          let idx;
          if (s[i] === '[') { i++; idx = row(']'); if (s[i] !== ']') sfail('root'); i++; }
          node = { k: 'root', body: group(), idx };
        } else if (name === 'left' || name === 'right') continue;
        else if (name === ',' || name === ';' || name === ' ' || name === '!' || name === 'quad' || name === 'qquad') continue;
        else if (name === 'overline') { node = { k: 'over', body: group() }; }
        else node = { k: 's', label: LATEX_CMD[name] || '\\' + name };
      } else if (c === '{') { i++; const r = row('}'); if (s[i] !== '}') sfail('braces'); i++; out.push(...r); if (one) break; continue; }
      else { i++; node = { k: 's', label: c === '*' ? '\\times' : c }; }
      out.push(node);
      if (one) break;
    }
    return out;
  }
  const rows = [];
  for (;;) {
    rows.push(row(null));
    if (i >= s.length) break;
    if (s[i] === '\\' && s[i + 1] === '\\') { i += 2; continue; }
    sfail('unexpected ' + s[i]);
  }
  return rows;
}
