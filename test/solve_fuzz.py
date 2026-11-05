"""Random arithmetic, checked against Python's own exact fractions: every answer Nib gives must have exactly the
value Python works out (or, when Nib marks it approximate, be within rounding of it).

    python3 test/solve_fuzz.py [count=3000] [seed=7]

Nib's answers are read back from their LaTeX (integers, decimals, repeating decimals with a bar, fractions, mixed
numbers), so the form is checked too: whatever it says must mean the right number."""
import json, random, re, subprocess, sys, os
from fractions import Fraction as F

N = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
rnd = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 7)
HERE = os.path.dirname(os.path.abspath(__file__))


def leaf():
    k = rnd.random()
    if k < 0.35:
        v = rnd.choice([rnd.randint(0, 12), rnd.randint(10, 99), rnd.randint(100, 999)])
        return str(v), F(v), 'int'
    if k < 0.55:
        w, d = rnd.randint(0, 40), rnd.choice(['5', '25', '75', '1', '2', '05', '125', '4', '6'])
        return f'{w}.{d}', F(f'{w}.{d}'), 'dec'
    if k < 0.75:
        b = rnd.randint(2, 12); a = rnd.randint(1, 15)
        return f'\\frac{{{a}}}{{{b}}}', F(a, b), 'frac'
    if k < 0.88:
        b = rnd.randint(2, 9); a = rnd.randint(1, b - 1); w = rnd.randint(1, 9)
        return f'{w}\\frac{{{a}}}{{{b}}}', w + F(a, b), 'mixed'
    v = rnd.choice([5, 10, 12.5, 15, 20, 25, 50, 75, 100, 150])
    return f'{v}\\%', F(str(v)) / 100, 'pct'


def expr(depth):
    """returns (latex, value, kind) where kind tells how it must be wrapped to be used as a factor"""
    if depth <= 0 or rnd.random() < 0.3:
        return leaf()
    op = rnd.choice(['+', '-', '*', '/', '^', 'paren', 'abs', 'neg'])
    if op in '+-':
        a, va, _ = expr(depth - 1); b, vb, kb = expr(depth - 1)
        if kb == 'neg' or b.startswith('-') or (op == '-' and kb == 'sum'): b = '(' + b + ')'
        return f'{a}{op}{b}', (va + vb if op == '+' else va - vb), 'sum'
    if op in '*/':
        a, va, ka = expr(depth - 1); b, vb, kb = expr(depth - 1)
        if ka == 'sum': a = '(' + a + ')'
        if kb in ('sum', 'prod', 'neg') or b.startswith('-'): b = '(' + b + ')'
        if op == '/':
            if vb == 0: return leaf()
            return f'{a}\\div {b}', va / vb, 'prod'
        sym = rnd.choice(['\\times ', '\\cdot '])
        return f'{a}{sym}{b}', va * vb, 'prod'
    if op == '^':
        a, va, ka = expr(depth - 1)
        k = rnd.randint(0, 3)
        if va == 0 and k == 0: return leaf()
        if abs(va.numerator) > 10**6 or va.denominator > 10**6: return leaf()
        base = a if ka == 'int' and not a.startswith('-') else '(' + a + ')'
        return f'{base}^{{{k}}}', va ** k, 'pow'
    if op == 'paren':
        a, va, _ = expr(depth - 1)
        return f'({a})', va, 'paren'
    if op == 'abs':
        a, va, _ = expr(depth - 1)
        return f'|{a}|', abs(va), 'paren'
    a, va, ka = expr(depth - 1)
    if ka in ('sum',) or a.startswith('-'): a = '(' + a + ')'
    return f'-{a}', -va, 'neg'


def value_of(tex):
    """the number an answer's LaTeX means (exact), or None for approximations"""
    t = tex.replace(' ', '')
    neg = t.startswith('-')
    if neg: t = t[1:]
    m = re.fullmatch(r'(\d+)\\frac\{(\d+)\}\{(\d+)\}', t)
    if m: v = int(m[1]) + F(int(m[2]), int(m[3]))
    elif re.fullmatch(r'\\frac\{(\d+)\}\{(\d+)\}', t):
        m = re.fullmatch(r'\\frac\{(\d+)\}\{(\d+)\}', t); v = F(int(m[1]), int(m[2]))
    elif re.fullmatch(r'\d+', t): v = F(int(t))
    elif re.fullmatch(r'\d+\.\d+', t): v = F(t)
    elif re.fullmatch(r'(\d+)\.(\d*)\\overline\{(\d+)\}', t):
        m = re.fullmatch(r'(\d+)\.(\d*)\\overline\{(\d+)\}', t)
        w, pre, rep = m[1], m[2], m[3]
        v = F(int(w)) + (F(int(pre), 10 ** len(pre)) if pre else 0) + F(int(rep), (10 ** len(rep) - 1) * 10 ** len(pre))
    elif t.endswith('\\ldots'): return None
    else: raise ValueError('cannot read ' + tex)
    return -v if neg else v


cases = []
while len(cases) < N:
    tex, v, _ = expr(rnd.randint(1, 4))
    cases.append((tex + '=', v))

nib = os.environ.get('NIB', os.path.join(HERE, '..', 'dist', 'nib.js'))
js = ("const Nib=require(process.argv[1]);const L=JSON.parse(require('fs').readFileSync(0,'utf8'));"
      "process.stdout.write(JSON.stringify(L.map(t=>{const a=Nib.solve(t);const x=a[a.length-1];return x&&{latex:x.latex,kind:x.kind,value:x.value,exact:x.exact};})));")
out = subprocess.run(['node', '-e', js, nib], input=json.dumps([c[0] for c in cases]), capture_output=True, text=True, check=True).stdout
answers = json.loads(out)

wrong, none, approx, ok = [], 0, 0, 0
for (tex, v), a in zip(cases, answers):
    if a is None:
        none += 1
        continue
    try:
        got = value_of(a['latex'])
    except ValueError as e:
        wrong.append((tex, a['latex'], str(v), str(e))); continue
    if got is None:
        approx += 1
        if a['exact'] or abs(a['value'] - float(v)) > 1e-6 * max(1, abs(float(v))):
            wrong.append((tex, a['latex'], str(v), 'approximation off'))
        continue
    if got != v:
        wrong.append((tex, a['latex'], str(v), 'wrong value'))
    else:
        ok += 1

print(f'{N} random problems: {ok} exactly right, {approx} approximated (checked), {none} with no answer, {len(wrong)} wrong')
quiet = [(t, str(v)) for (t, v), a in zip(cases, answers) if a is None and re.search(r'[-+]|\\times|\\cdot|\\div|\^|\|', t[:-1].lstrip('-'))]
print(f'  no answer although there was working to do: {len(quiet)}')
for q in quiet[:12]:
    print('   ', q)
for w in wrong[:25]:
    print('  WRONG', w)
sys.exit(1 if wrong else 0)
