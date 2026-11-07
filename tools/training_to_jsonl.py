#!/usr/bin/env python3
"""The writing a Nib Board kept for training -> rows in the trainer's format (training/scratch/data/*.jsonl).

    python3 -I tools/training_to_jsonl.py Nib-training-2026-11-07.json [more.json ...] out.jsonl [--repeat-fixed N]

Each record of a saved file (format 'nib-training', version 1) becomes one row:
    {id, writer, truth, strokes: [[[x, y], ...], ...], symbols: [{label, strokes: [indices]}], orphans,
     latex, source: 'board', types, fixed: true/false, split: 'board'}
Strokes stay in board CSS px with y down, the trainer's convention (CROHME ink is y down too); the times are
dropped. Labels are the classifier's classes: a times dot is its '.', a ':' is two '.', a degree sign is 'o';
a symbol with a label the classifier has no class for is left out (its strokes go to orphans) and counted.
The same record (same key) in several files is taken once, the newest. --repeat-fixed N writes each row that
carries a correction N times (default 1), to weight the corrections in training.
Standard library only."""
import json, sys

# the classifier's classes (training/scratch/work/ep/classes.txt), without 'junk'
CLASSES = set(r"""! $ % ( ) + , - . / 0 1 2 3 4 5 6 7 8 9 < = > A B C E F G H I L M N P R S T V X Y [ \Delta \alpha \beta
\cos \div \exists \forall \gamma \ge \in \infty \int \lambda \ldots \le \lim \log \mu \ne \phi \pi \pm \prime
\rightarrow \sigma \sin \sqrt \sum \tan \theta \times \{ \} ] a b c d e f g h i j k l m n o p q r s t u v w x y z |""".split())
MAP = {'\\cdot': '.', '\\circ': 'o'}


def symbols_of(rec, n):
    out, dropped = [], []
    for s in rec.get('symbols') or []:
        lab = s.get('label')
        idx = sorted(set(i for i in (s.get('strokes') or []) if isinstance(i, int) and 0 <= i < n))
        if not idx or not isinstance(lab, str):
            continue
        lab = MAP.get(lab, lab)
        if lab == ':' and len(idx) == 2:                      # two stacked dots, one symbol each
            out += [{'label': '.', 'strokes': [idx[0]]}, {'label': '.', 'strokes': [idx[1]]}]
        elif lab in CLASSES:
            out.append({'label': lab, 'strokes': idx})
        else:
            dropped.append(lab)
    return out, dropped


def main(argv):
    rep = 1
    args = []
    i = 0
    while i < len(argv):
        if argv[i] == '--repeat-fixed':
            rep = max(1, int(argv[i + 1])); i += 2; continue
        args.append(argv[i]); i += 1
    if len(args) < 2:
        print(__doc__.strip().split('\n\n')[1], file=sys.stderr)
        return 2
    ins, out = args[:-1], args[-1]
    if not out.endswith('.jsonl'):
        print('the last argument is the .jsonl to write: ' + out, file=sys.stderr)
        return 2
    recs, files = {}, 0
    for path in ins:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict) or data.get('format') != 'nib-training' or data.get('version') != 1:
            print('not a Nib training file (format nib-training, version 1): ' + path, file=sys.stderr)
            return 1
        files += 1
        for r in data.get('records') or []:
            if not isinstance(r, dict) or not isinstance(r.get('key'), str) or not r.get('strokes'):
                continue
            old = recs.get(r['key'])
            if old is None or (r.get('t') or 0) >= (old.get('t') or 0):
                recs[r['key']] = r
    n_rows = n_strokes = n_syms = n_fixed = 0
    dropped = {}
    with open(out, 'w', encoding='utf-8') as f:
        for r in sorted(recs.values(), key=lambda r: r.get('t') or 0):
            strokes = [[[float(p[0]), float(p[1])] for p in s if isinstance(p, list) and len(p) >= 2] for s in r['strokes']]
            symbols, lost = symbols_of(r, len(strokes))
            for lab in lost:
                dropped[lab] = dropped.get(lab, 0) + 1
            covered = set(k for s in symbols for k in s['strokes'])
            fixed = bool(r.get('fixed'))
            types = list(r.get('types') or [])
            latex = r.get('latex') or ''
            row = {'id': 'board_' + r['key'].replace(',', '_')[:120], 'writer': 'board', 'truth': '$' + latex + '$',
                   'strokes': strokes, 'symbols': symbols, 'orphans': [k for k in range(len(strokes)) if k not in covered],
                   'latex': latex, 'source': 'board', 'types': types + [None] * (len(strokes) - len(types)),
                   'fixed': fixed, 'split': 'board'}
            line = json.dumps(row, separators=(',', ':')) + '\n'
            for _ in range(rep if fixed else 1):
                f.write(line)
            n_rows += 1; n_strokes += len(strokes); n_syms += len(symbols); n_fixed += fixed
    print(f'{files} file(s): {n_rows} records, {n_strokes} strokes, {n_syms} symbols, {n_fixed} fixed'
          + (f' (each fixed row written {rep} times)' if rep > 1 else '') + f' -> {out}')
    if dropped:
        print('left out (no class for them): ' + ', '.join(f'{k} x{v}' for k, v in sorted(dropped.items())))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
