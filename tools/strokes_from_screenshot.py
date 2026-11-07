#!/usr/bin/env python3
# Strokes back out of a screenshot of the Board, to write them again in a test (tools/replay_board.js) when all there
# is of a problem is a picture of it.
#
#   pip install scikit-image skan          (once)
#   python3 tools/strokes_from_screenshot.py shot.png out.json [--css-width 1440]
#
# The light ink is thinned to its centre line, cut where lines meet or cross, and joined again the straightest way
# through each meeting (the two bars of a + become two strokes again, a 9 one stroke, loop and tail). Each stroke is
# started where a hand starts it (at its top, or its left for one that runs across; a loop at its top, anticlockwise)
# and given back the half line-width that thinning takes off each end. Small round blobs are taps (decimal points).
# The answers are gold, not light, so they are left out; so is the toolbar.
#
# Out: {width, height, strokes} in page px of a window --css-width wide (the screenshot's own px if not given), the
# strokes in the order they were most likely written: pieces of writing near each other together, read top to bottom
# and left to right, and within each, by the middle of each stroke from left to right.
# What it cannot know: the real order and direction of strokes, and where a pen lifted at a corner or crossed a
# line already there. Close enough to reproduce what the Board read (the 4 Nov board's three wrong answers came
# back exactly), not a record of the writing itself.
import sys, json, math, argparse
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.morphology import skeletonize, disk
from skan import Skeleton

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--css-width', type=float, default=0, help='width of the window in CSS px (the screenshot is scaled to it)')
ap.add_argument('--top', type=int, default=0, help='px of the screenshot to leave out at the top (default: the toolbar, found by its border)')
a = ap.parse_args()

im = np.asarray(Image.open(a.src).convert('RGB')).astype(int)
H, W, _ = im.shape
mx, mn = im.max(2), im.min(2)
mask = (mn > 140) & (mx - mn < 70)                       # light, unsaturated: the ink (gold answers are saturated)
top = a.top
if not top:
    # the toolbar ends at a lighter border line, even all the way across (rows with writing in them are not even)
    g = im.mean(axis=2)
    rows, spread = g.mean(axis=1), g.std(axis=1)
    for y in range(20, min(H // 4, 400)):
        if spread[y] < 8 and rows[y] > rows[y - 3] + 6 and rows[y] > rows[y + 3] + 6: top = y + 3; break
mask[:top] = False
mask = ndi.binary_closing(mask, structure=disk(1))
lab, _ = ndi.label(mask, structure=np.ones((3, 3)))
dots = []
for k, sl in enumerate(ndi.find_objects(lab), 1):
    sub = lab[sl] == k
    area = int(sub.sum()); hgt = sl[0].stop - sl[0].start; wid = sl[1].stop - sl[1].start
    if area < 6: mask[sl][sub] = False; continue
    if max(hgt, wid) <= 16 and area < 200:                # a tap
        ys, xs = np.nonzero(sub)
        cx, cy = xs.mean() + sl[1].start, ys.mean() + sl[0].start
        dots.append([(float(cx) - 1, float(cy)), (float(cx) + 1, float(cy))])
        mask[sl][sub] = False
sk = skeletonize(mask)
dist = ndi.distance_transform_edt(mask)                   # half the line's width, at each ink pixel
S = Skeleton(sk)
coords, deg = S.coordinates, S.degrees

def length(p): return sum(math.dist(p[k - 1], p[k]) for k in range(1, len(p)))
paths = []
for i in range(S.n_paths):
    idx = S.path(i)
    paths.append({'a': int(idx[0]), 'b': int(idx[-1]), 'pts': [(float(c), float(r)) for r, c in coords[idx]]})

# junctions: neighbouring junction pixels are one, and so are two joined by a short piece (a crossing thins to two)
jpix = [i for i in range(len(coords)) if deg[i] >= 3]
cluster = {}
for i in jpix:
    if i in cluster: continue
    stack = [i]; cluster[i] = i
    while stack:
        u = stack.pop()
        for v in jpix:
            if v not in cluster and max(abs(coords[u][0] - coords[v][0]), abs(coords[u][1] - coords[v][1])) <= 2:
                cluster[v] = i; stack.append(v)
parent = {}
def find(x):
    while parent.get(x, x) != x: x = parent[x]
    return x
def J(i): return find(cluster[i])
keep = []
for p in paths:
    if p['a'] in cluster and p['b'] in cluster and length(p['pts']) < 16 and J(p['a']) != J(p['b']): parent[J(p['a'])] = J(p['b'])
    else: keep.append(p)
paths = keep
def node(i): return ('J', J(i)) if i in cluster else ('E', i)

# whiskers: a short piece from a junction to a loose end
changed = True
while changed:
    changed = False
    count = {}
    for p in paths:
        for e in (p['a'], p['b']): count[node(e)] = count.get(node(e), 0) + 1
    keep = []
    for p in paths:
        na, nb = node(p['a']), node(p['b'])
        spur = (na[0] == 'J') != (nb[0] == 'J') and length(p['pts']) < 9 and count.get(na if na[0] == 'J' else nb, 0) >= 3
        if spur: changed = True
        else: keep.append(p)
    paths = keep

# at each junction, the ends that go straight through are one stroke
ends = {}
for pi, p in enumerate(paths):
    for side in (0, 1):
        n = node(p['a'] if side == 0 else p['b'])
        if n[0] == 'J': ends.setdefault(n, []).append((pi, side))
def leave(pi, side, reach=14):
    pts = paths[pi]['pts'] if side == 0 else paths[pi]['pts'][::-1]
    o, acc = pts[0], 0
    for k in range(1, len(pts)):
        acc += math.dist(pts[k - 1], pts[k])
        if acc >= reach: return (pts[k][0] - o[0], pts[k][1] - o[1])
    return (pts[-1][0] - o[0], pts[-1][1] - o[1])
pair = {}
for n, es in ends.items():
    es = list(es)
    if len(es) == 2 and es[0][0] != es[1][0]:
        pair[es[0]] = es[1]; pair[es[1]] = es[0]; continue  # a line that only touches itself: straight on
    while len(es) >= 2:
        best, bi = None, None
        for x in range(len(es)):
            for y in range(x + 1, len(es)):
                if es[x][0] == es[y][0] and len(paths[es[x][0]]['pts']) < 30: continue
                u, v = leave(*es[x]), leave(*es[y])
                nu, nv = math.hypot(*u), math.hypot(*v)
                if nu == 0 or nv == 0: continue
                ang = math.acos(max(-1, min(1, (u[0] * v[0] + u[1] * v[1]) / (nu * nv))))
                if best is None or ang > best: best, bi = ang, (x, y)
        if best is None or best < math.radians(115): break
        x, y = bi
        pair[es[x]] = es[y]; pair[es[y]] = es[x]
        es = [e for k, e in enumerate(es) if k not in (x, y)]

used, strokes = set(), []
def walk(pi, side):
    seq = []
    while True:
        used.add(pi)
        pts = paths[pi]['pts'] if side == 0 else paths[pi]['pts'][::-1]
        seq.extend(pts if not seq else pts[1:])
        other = (pi, 1 - side)
        if other in pair and pair[other][0] not in used: pi, side = pair[other]
        else: break
    return seq
for pi in range(len(paths)):
    if pi in used: continue
    start = next(((pi, side) for side in (0, 1) if (pi, side) not in pair), None)
    if start is None:
        cur, seen = (pi, 0), set()
        while cur in pair and cur[0] not in seen:
            seen.add(cur[0]); nxt = pair[cur]; cur = (nxt[0], 1 - nxt[1])
        start = cur if cur not in pair else (pi, 0)
    strokes.append(walk(*start))

def extend(s):
    if len(s) < 4: return s
    out = list(s)
    for end in (0, 1):
        q = out if end == 1 else out[::-1]
        p, b = q[-1], q[max(0, len(q) - 6)]
        d = math.dist(p, b)
        if d < 1e-6: continue
        r = float(dist[min(H - 1, int(round(p[1]))), min(W - 1, int(round(p[0])))])
        e = (p[0] + (p[0] - b[0]) / d * r, p[1] + (p[1] - b[1]) / d * r)
        out = out + [e] if end == 1 else [e] + out
    return out
def orient(s):
    p, q = s[0], s[-1]
    if math.dist(p, q) < 8 and len(s) > 20:                # a loop: from its top, anticlockwise
        k = min(range(len(s)), key=lambda i: s[i][1])
        s = s[k:] + s[1:k + 1]
        if s[min(len(s) - 1, 8)][0] > s[0][0]: s = s[::-1]
        return s
    if abs(p[0] - q[0]) > 1.3 * abs(p[1] - q[1]): return s if p[0] <= q[0] else s[::-1]
    return s if p[1] <= q[1] else s[::-1]
strokes = [orient(extend(s)) for s in strokes if length(s) >= 6] + dots

# in page px, in writing order
k = W / a.css_width if a.css_width else 1.0
strokes = [[(x / k, y / k) for x, y in s] for s in strokes]
def box(s): xs = [p[0] for p in s]; ys = [p[1] for p in s]; return (min(xs), min(ys), max(xs), max(ys))
B = [box(s) for s in strokes]
up = list(range(len(strokes)))
def root(i):
    while up[i] != i: up[i] = up[up[i]]; i = up[i]
    return i
u = (W / k) / 1440                                         # page px of a 1440 px window, in the output's units
near = 22 * u                                              # pieces of one problem are closer than this
for i in range(len(strokes)):
    for j in range(i + 1, len(strokes)):
        g = max(0, B[j][0] - B[i][2], B[i][0] - B[j][2], B[j][1] - B[i][3], B[i][1] - B[j][3])
        if g < near: up[root(i)] = root(j)
groups = {}
for i in range(len(strokes)): groups.setdefault(root(i), []).append(i)
G = []
for ix in groups.values():
    ix.sort(key=lambda i: B[i][0] + B[i][2])
    G.append((min(B[i][1] for i in ix), min(B[i][0] for i in ix), ix))
# reading order: rows (a piece starting more than 40 px below the row's first starts the next row), left to right
G.sort(key=lambda g: g[0])
rows = []
for g in G:
    if rows and g[0] - rows[-1][0][0] <= 40 * u: rows[-1].append(g)
    else: rows.append([g])
order = [i for r in rows for g in sorted(r, key=lambda g: g[1]) for i in g[2]]
out = []
for i in order:
    s = strokes[i]
    q = [s[0]]
    for p in s:
        if math.dist(p, q[-1]) >= 1.5: q.append(p)
    if len(q) == 1 and len(s) > 1: q.append(s[-1])
    out.append([[round(x, 1), round(y, 1)] for x, y in q])
json.dump({'width': round(W / k), 'height': round(H / k), 'strokes': out}, open(a.out, 'w'))
print(f'{len(out)} strokes, {len(G)} pieces of writing in {len(rows)} rows; window {round(W / k)} x {round(H / k)}')
