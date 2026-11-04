"""Validate the fonts test/font_check.js wrote with fontTools: every table parses, checksums match, stored bounds
equal recalculated bounds, outer contours run clockwise (TrueType), metrics cover the ink, the cmap is sane.
  python3 test/font_check.py"""
import glob, os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.boundsPen import BoundsPen

fails = 0


def ok(c, m):
    global fails
    if not c:
        print('  FAIL', m)
        fails += 1


files = sorted(glob.glob(os.path.join(os.path.dirname(__file__), 'shots', 'fonts', '*.ttf')))
ok(files, 'no fonts found: run node test/font_check.js first')
for path in files:
    name = os.path.basename(path)
    f = TTFont(path, checkChecksums=2)          # raises on any table checksum mismatch
    for tag in f.keys():
        if tag != 'GlyphOrder':
            f[tag]                               # decompile every table
    need = {'head', 'hhea', 'maxp', 'OS/2', 'hmtx', 'cmap', 'loca', 'glyf', 'name', 'post'}
    ok(need <= set(f.keys()), f'{name}: tables {sorted(f.keys())}')
    # whole-file checksum: the bytes of the file sum to 0xB1B0AFBA
    data = open(path, 'rb').read()
    ok(len(data) % 4 == 0, f'{name}: length is a multiple of 4')
    total = sum(int.from_bytes(data[i:i + 4], 'big') for i in range(0, len(data), 4)) & 0xFFFFFFFF
    ok(total == 0xB1B0AFBA, f'{name}: whole-font checksum {total:#x}')
    glyf, hmtx, head, os2, hhea = f['glyf'], f['hmtx'], f['head'], f['OS/2'], f['hhea']
    gs = f.getGlyphSet()
    xs0, ys0, xs1, ys1 = [], [], [], []
    for gname in f.getGlyphOrder():
        g = glyf[gname]
        if g.numberOfContours == 0:
            continue
        stored = (g.xMin, g.yMin, g.xMax, g.yMax)
        g.recalcBounds(glyf)
        ok(stored == (g.xMin, g.yMin, g.xMax, g.yMax), f'{name} {gname}: stored bounds {stored}')
        ok(hmtx[gname][1] == g.xMin, f'{name} {gname}: left side bearing equals xMin')
        xs0.append(g.xMin); ys0.append(g.yMin); xs1.append(g.xMax); ys1.append(g.yMax)
        # area of the whole glyph is negative for clockwise outlines in fontTools' pen convention
        ap = AreaPen(gs)
        gs[gname].draw(ap)
        ok(ap.value < 0, f'{name} {gname}: outlines run clockwise (area {ap.value:.0f})')
        coords, ends, flags = g.getCoordinates(glyf)
        ok(g.numberOfContours == len(ends), f'{name} {gname}: contour count')
    if xs0:
        ok((head.xMin, head.yMin, head.xMax, head.yMax) == (min(xs0), min(ys0), max(xs1), max(ys1)), f'{name}: head bounds')
        ok(os2.usWinAscent >= max(ys1) and os2.usWinDescent >= -min(ys0), f'{name}: Windows metrics cover the ink')
    ok(hhea.numberOfHMetrics == f['maxp'].numGlyphs == len(f.getGlyphOrder()), f'{name}: glyph counts agree')
    cm = f.getBestCmap()
    ok(cm.get(32) and cm.get(0xA0) == cm.get(32), f'{name}: space is mapped')
    ok(all(v in f.getGlyphOrder() for v in cm.values()), f'{name}: cmap points at real glyphs')
    ok(os2.version == 4 and os2.fsSelection & 0x40, f'{name}: OS/2 v4, regular')
    fam = f['name'].getDebugName(1)
    ok(fam and len(fam) <= 31, f'{name}: family name {fam!r}')
    print(f'  {name:18} {len(f.getGlyphOrder())} glyphs, {len(cm)} code points, family {fam!r}')
print(f'{fails} failed' if fails else 'all passed')
sys.exit(1 if fails else 0)
