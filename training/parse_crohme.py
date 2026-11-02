"""Parse CROHME 2019 InkML into JSONL: strokes, symbol segmentation + labels,
and a layout tree derived from the Presentation-MathML ground truth.

Layout tree = row (list of units). Unit kinds:
  {"k":"s","s":i,"sup":row?,"sub":row?,"above":row?,"below":row?}   symbol i
  {"k":"f","s":bar,"num":row,"den":row,...scripts}                  fraction (bar symbol)
  {"k":"r","s":rad,"body":row,"idx":row?,...scripts}                square / nth root
"""
import glob, json, os, re, sys
import xml.etree.ElementTree as ET

BASE = sys.argv[1]
OUT = sys.argv[2]
INK = '{http://www.w3.org/2003/InkML}'
XMLID = '{http://www.w3.org/XML/1998/namespace}id'

LABEL_MAP = {'\\lt': '<', '\\gt': '>', '\\leq': '\\le', '\\geq': '\\ge', '\\neq': '\\ne'}


def canon(label):
    return LABEL_MAP.get(label, label)


def strip(tag):
    return tag.split('}', 1)[1] if '}' in tag else tag


class Broken(Exception):
    pass


def parse_file(path):
    root = ET.parse(path).getroot()
    traces = {}
    order = []
    for tr in root.iter(INK + 'trace'):
        tid = tr.get('id')
        pts = []
        for p in (tr.text or '').replace('\n', ' ').split(','):
            v = p.split()
            if len(v) >= 2:
                try:
                    pts.append([round(float(v[0]), 2), round(float(v[1]), 2)])
                except ValueError:
                    pass
        # drop consecutive duplicates
        ded = []
        for q in pts:
            if not ded or ded[-1] != q:
                ded.append(q)
        if ded:
            traces[tid] = ded
            order.append(tid)
    idx_of = {tid: i for i, tid in enumerate(order)}
    strokes = [traces[t] for t in order]

    symbols = []
    href2sym = {}
    for tg in root.iter(INK + 'traceGroup'):
        views = tg.findall(INK + 'traceView')
        if not views:
            continue
        ann = tg.find(INK + 'annotation')
        label = ann.text if ann is not None else None
        refs = [idx_of[v.get('traceDataRef')] for v in views if v.get('traceDataRef') in idx_of]
        if not refs or label is None:
            continue
        sym = {'label': canon(label.strip()), 'strokes': sorted(set(refs))}
        ax = tg.find(INK + 'annotationXML')
        if ax is not None and ax.get('href') is not None:
            href2sym[ax.get('href')] = len(symbols)
        symbols.append(sym)

    truth = None
    for a in root.findall(INK + 'annotation'):
        if a.get('type') == 'truth':
            truth = a.text
    writer = None
    for a in root.findall(INK + 'annotation'):
        if a.get('type') == 'writer':
            writer = a.text

    tree = None
    err = None
    axml = root.find(INK + 'annotationXML')
    if axml is not None:
        maths = [e for e in axml.iter() if strip(e.tag) == 'math']
        if maths:
            try:
                used = set()
                tree = build_row(maths[0], href2sym, used)
                if len(used) != len(symbols):
                    raise Broken('unmapped symbols %d/%d' % (len(used), len(symbols)))
            except Broken as e:
                tree, err = None, str(e)
    covered = set(s for sym in symbols for s in sym['strokes'])
    return {
        'id': os.path.basename(path)[:-6],
        'writer': writer,
        'truth': truth,
        'strokes': strokes,
        'symbols': symbols,
        'orphans': [i for i in range(len(strokes)) if i not in covered],
        'tree': tree,
        'err': err,
    }


def sym_of(e, href2sym, used):
    i = e.get(XMLID)
    if i is None or i not in href2sym:
        raise Broken('no symbol for %s %s' % (strip(e.tag), i))
    s = href2sym[i]
    if s in used:
        raise Broken('symbol reused')
    used.add(s)
    return s


def build_row(e, h, used):
    t = strip(e.tag)
    kids = list(e)
    if t in ('math', 'mrow', 'mstyle', 'mpadded', 'semantics'):
        row = []
        for k in kids:
            row.extend(build_row(k, h, used))
        return row
    if t in ('mi', 'mn', 'mo', 'mtext'):
        return [{'k': 's', 's': sym_of(e, h, used)}]
    if t in ('msup', 'msub', 'msubsup', 'munder', 'mover', 'munderover'):
        if len(kids) < 2:
            raise Broken('script arity')
        base = build_row(kids[0], h, used)
        if not base:
            raise Broken('empty base')
        last = base[-1]
        slots = {'msup': ['sup'], 'msub': ['sub'], 'msubsup': ['sub', 'sup'],
                 'munder': ['below'], 'mover': ['above'], 'munderover': ['below', 'above']}[t]
        if len(kids) != len(slots) + 1:
            raise Broken('script arity')
        for slot, k in zip(slots, kids[1:]):
            if slot in last:
                raise Broken('double script')
            last[slot] = build_row(k, h, used)
        return base
    if t == 'mfrac':
        if len(kids) != 2:
            raise Broken('frac arity')
        s = sym_of(e, h, used)
        return [{'k': 'f', 's': s, 'num': build_row(kids[0], h, used), 'den': build_row(kids[1], h, used)}]
    if t == 'msqrt':
        s = sym_of(e, h, used)
        body = []
        for k in kids:
            body.extend(build_row(k, h, used))
        return [{'k': 'r', 's': s, 'body': body}]
    if t == 'mroot':
        if len(kids) != 2:
            raise Broken('root arity')
        s = sym_of(e, h, used)
        return [{'k': 'r', 's': s, 'body': build_row(kids[0], h, used), 'idx': build_row(kids[1], h, used)}]
    raise Broken('tag ' + t)


def main():
    os.makedirs(OUT, exist_ok=True)
    for split in ('train', 'valid', 'test'):
        n = ok = 0
        errs = {}
        with open(os.path.join(OUT, split + '.jsonl'), 'w') as fo:
            for f in sorted(glob.glob(os.path.join(BASE, split, '*.inkml'))):
                n += 1
                try:
                    r = parse_file(f)
                except ET.ParseError:
                    continue
                if r['tree'] is not None:
                    ok += 1
                else:
                    k = re.sub(r'[0-9]+', '#', r['err'] or 'none')[:40]
                    errs[k] = errs.get(k, 0) + 1
                r['split'] = split
                fo.write(json.dumps(r, separators=(',', ':')) + '\n')
        print(split, n, 'trees', ok, sorted(errs.items(), key=lambda x: -x[1])[:8])


if __name__ == '__main__':
    main()
