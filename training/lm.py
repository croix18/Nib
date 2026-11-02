import os
"""Bigram context model over layout rows: CROHME training trees + a synthetic middle-school corpus."""
import json, random, re
from collections import Counter

S = os.environ.get('NIB_SCRATCH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scratch'))
rng = random.Random(11)

# ------------------------------------------------------------ mini LaTeX -> rows parser
CMD = {'\\%': '%', '\\$': '$', '\\lt': '<', '\\gt': '>', '\\leq': '\\le', '\\geq': '\\ge', '\\neq': '\\ne'}


def tokenize(s):
    return re.findall(r'\\[A-Za-z]+|\\[%${}]|[^\s]', s)


def parse(tokens):
    pos = [0]

    def group():
        if pos[0] < len(tokens) and tokens[pos[0]] == '{':
            pos[0] += 1
            r = row('}')
            pos[0] += 1
            return r
        t = tokens[pos[0]]; pos[0] += 1
        return [{'k': 's', 'l': CMD.get(t, t)}]

    def row(stop):
        out = []
        while pos[0] < len(tokens) and tokens[pos[0]] != stop:
            t = tokens[pos[0]]
            if t == '\\frac':
                pos[0] += 1
                out.append({'k': 'f', 'num': group(), 'den': group()})
            elif t == '\\sqrt':
                pos[0] += 1
                idx = None
                if tokens[pos[0]] == '[':
                    pos[0] += 1; idx = row(']'); pos[0] += 1
                u = {'k': 'r', 'body': group()}
                if idx: u['idx'] = idx
                out.append(u)
            elif t in '^_':
                pos[0] += 1
                out[-1]['sup' if t == '^' else 'sub'] = group()
            elif t == '{':
                pos[0] += 1; out += row('}'); pos[0] += 1
            else:
                pos[0] += 1
                out.append({'k': 's', 'l': CMD.get(t, t)})
        return out
    return row(None)


def rows_of(row, start, acc):
    toks = [start]
    for u in row:
        toks.append(u['l'] if u['k'] == 's' else ('FRAC' if u['k'] == 'f' else 'ROOT'))
    toks.append('</s>')
    acc.append(toks)
    for u in row:
        for k, st in (('sup', '<sup>'), ('sub', '<sub>'), ('num', '<num>'), ('den', '<den>'), ('body', '<body>'), ('idx', '<idx>'),
                      ('above', '<sup>'), ('below', '<sub>')):
            if k in u: rows_of(u[k], st, acc)


# ------------------------------------------------------------ synthetic middle-school corpus
V = 'x' * 14 + 'y' * 5 + 'n' * 4 + 'a' * 3 + 'b' * 3 + 'm' * 2 + 'k' * 2 + 't' * 2 + 'p' * 2 + 'r' * 2 + 'h' + 'w' + 'c' * 2 + 'd' + 's' + 'z' + 'g' + 'q' + 'u' + 'v' + 'j' + 'e' + 'f' + 'i'


def num(lo=0, hi=20):
    r = rng.random()
    if r < 0.6: return str(rng.randint(max(lo, 0), hi))
    if r < 0.85: return str(rng.randint(10, 99))
    return str(rng.randint(100, 999))


def dec():
    return f'{rng.randint(0, 20)}.{rng.randint(0, 99):0{rng.choice([1, 2])}d}'


def v(): return rng.choice(V)
def sgn(): return rng.choice(['', '', '-'])
def op(): return rng.choice(['+', '+', '-', '-', '\\times', '\\div', '\\cdot'])
def rel(): return rng.choice(['=', '=', '=', '<', '>', '\\le', '\\ge', '\\ne'])
def val():
    r = rng.random()
    if r < 0.45: return num()
    if r < 0.65: return dec()
    if r < 0.8: return f'\\frac{{{num(1, 12)}}}{{{num(1, 12)}}}'
    if r < 0.9: return f'(-{num()})'
    return num(1, 9) + f'\\frac{{{num(1, 9)}}}{{{num(2, 12)}}}'


def term():
    r = rng.random()
    c = rng.choice(['', num(2, 12), num(2, 12), dec(), f'\\frac{{{num(1, 9)}}}{{{num(2, 12)}}}', '-'])
    if r < 0.6: return c + v()
    if r < 0.8: return c + v() + '^{' + rng.choice(['2', '2', '3', 'n', '4', '-1']) + '}'
    return num()


T = [
    lambda: f'{term()} {rng.choice(["+", "-"])} {num()} {rel()} {sgn()}{num()}',
    lambda: f'{term()} {rng.choice(["+", "-"])} {term()}',
    lambda: f'{val()} {op()} {val()}',
    lambda: f'{val()} {op()} {val()} {op()} {val()}',
    lambda: f'{val()} {op()} {val()} = {val()}',
    lambda: f'{sgn()}{num()}({term()} {rng.choice(["+", "-"])} {num()})',
    lambda: f'{num()}^{{{rng.choice(["2", "3", "4", "0", "-2", "5"])}}}',
    lambda: f'({sgn()}{num(1, 9)})^{{{rng.choice(["2", "3"])}}} = {num()}',
    lambda: f'{dec()} \\times 10^{{{sgn()}{rng.randint(1, 9)}}}',
    lambda: f'{v()}^{{{num(1, 9)}}} \\cdot {v()}^{{{num(1, 9)}}}',
    lambda: f'\\frac{{{v()}^{{{num(2, 9)}}}}}{{{v()}^{{{num(1, 5)}}}}}',
    lambda: f'\\sqrt{{{num(1, 144)}}} = {num()}',
    lambda: f'\\sqrt[3]{{{num(1, 125)}}}',
    lambda: f'{num(1, 99)}\\%',
    lambda: f'{dec()} = {num(1, 99)}\\%',
    lambda: f'\\frac{{{num(1, 9)}}}{{{num(2, 10)}}} = {num(1, 99)}\\%',
    lambda: f'\\${dec()}',
    lambda: f'{v()} {rng.choice(["<", ">", "\\le", "\\ge"])} {sgn()}{num()}',
    lambda: f'{term()} {rng.choice(["+", "-"])} {num()} {rng.choice(["<", ">", "\\le", "\\ge"])} {num()}',
    lambda: f'|{sgn()}{num()}| = {num()}',
    lambda: f'|{v()}| {rel()} {num()}',
    lambda: f'\\frac{{{v()}}}{{{num(2, 12)}}} {rel()} {sgn()}{num()}',
    lambda: f'\\frac{{{num(1, 9)}}}{{{num(2, 12)}}}{v()} {rng.choice(["+", "-"])} {num()} = {num()}',
    lambda: f'\\frac{{{num(1, 20)}}}{{{num(1, 20)}}} = \\frac{{{v()}}}{{{num(1, 30)}}}',
    lambda: f'{num(1, 20)}:{num(1, 20)}',
    lambda: rng.choice(['A = \\pi r^{2}', 'C = 2\\pi r', 'C = \\pi d', 'V = lwh', 'A = lw', 'A = \\frac{1}{2}bh', 'P = 2l + 2w',
                        'y = mx + b', 'd = rt', 'I = prt', 'V = \\pi r^{2}h', 'a^{2} + b^{2} = c^{2}', 'V = Bh', 'A = bh',
                        'V = s^{3}', 'SA = 2lw + 2lh + 2wh', 'V = \\frac{1}{3}Bh', 'y = kx', 'm = \\frac{y_{2} - y_{1}}{x_{2} - x_{1}}']),
    lambda: f'y = {sgn()}{rng.choice([num(1, 9), dec(), "\\frac{" + num(1, 5) + "}{" + num(2, 9) + "}"])}x {rng.choice(["+", "-"])} {num()}',
    lambda: f'{num()} {rng.choice(["+", "-"])} ({sgn()}{num()}) = {sgn()}{num()}',
    lambda: f'{num(2, 9)}{v()} = {num()}',
    lambda: f'{v()} = {sgn()}{val()}',
    lambda: f'{rng.randint(1, 180)}^{{\\circ}}',
    lambda: f'\\pi \\approx 3.14',
]


def main():
    acc = []
    for line in open(f'{S}/data/train.jsonl'):
        r = json.loads(line)
        if r['tree'] is None: continue
        labels = [s['label'] for s in r['symbols']]

        def conv(row):
            out = []
            for u in row:
                o = {'k': u['k']}
                if u['k'] == 's': o['l'] = labels[u['s']]
                for k in ('sup', 'sub', 'num', 'den', 'body', 'idx', 'above', 'below'):
                    if k in u: o[k] = conv(u[k])
                out.append(o)
            return out
        rows_of(conv(r['tree']), '<s>', acc)
    n_crohme = len(acc)
    for _ in range(12000):
        s = rng.choice(T)()
        s = s.replace('\\approx', '=')
        rows_of(parse(tokenize(s)), '<s>', acc)
    print('rows', n_crohme, len(acc) - n_crohme)
    uni = Counter(); bi = Counter()
    for toks in acc:
        for t in toks[1:]: uni[t] += 1
        for a, b in zip(toks, toks[1:]): bi[(a, b)] += 1
    classes = open(f'{S}/work/ep/classes.txt').read().split('\n')
    vocab = sorted(set(classes) | set(uni) | {'<s>', '<sup>', '<sub>', '<num>', '<den>', '<body>', '<idx>', '</s>', '<unk>',
                                               'FRAC', 'ROOT', ':', '\\cdot', '\\circ'})
    vocab = [t for t in vocab if t != 'junk']
    ix = {t: i for i, t in enumerate(vocab)}
    out = {'vocab': vocab, 'uni': [uni.get(t, 0) for t in vocab],
           'bi': [[ix[a], ix[b], c] for (a, b), c in bi.items() if a in ix and b in ix]}
    json.dump(out, open(f'{S}/work/lm.json', 'w'), separators=(',', ':'))
    print('vocab', len(vocab), 'bigrams', len(out['bi']))
    for a in ('<s>', '2', 'x', '\\times', '<sup>'):
        tot = sum(c for (p, q), c in bi.items() if p == a)
        top = sorted(((c, q) for (p, q), c in bi.items() if p == a), reverse=True)[:8]
        print(a, '->', ' '.join(f'{q}:{c / tot:.2f}' for c, q in top))


if __name__ == '__main__':
    main()
