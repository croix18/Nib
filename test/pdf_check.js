// src/pdf.js: PDFs built from real JPEGs (one page; three pages of different sizes; a grey JPEG; a title with "–",
// "é", brackets and an emoji; progressive and CMYK JPEGs; a JPEG from Chrome's canvas, and the same PDF made inside
// Chrome) checked by qpdf --check, pdfinfo, pypdf (strict) and pdftoppm -r 40: a red and a blue square drawn at known
// places in each picture must land where the page puts the picture. Also: the cross-reference table byte for byte,
// pdfJpegSize on good and bad bytes, bad input to pdfMake, and the time for 30 one-megabyte pages.
//   node test/pdf_check.js        (PDFs go to $NIB_OUT, default test/shots/pdf; needs python3 with PIL and pypdf)
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const OUT = process.env.NIB_OUT || path.join(__dirname, 'shots', 'pdf');
fs.mkdirSync(OUT, { recursive: true });
const SRC = path.join(__dirname, '..', 'src');
const pdfSrc = fs.readFileSync(path.join(SRC, 'pdf.js'), 'utf8').replace(/__VERSION__/g, 'test');
const P = new Function("'use strict';\n" + pdfSrc + '\nreturn { PDF_SIZES, pdfMake, pdfJpegSize, pdfFit };')();
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log('  FAIL', m); } };
const section = n => console.log(n);
const DATE = new Date('2026-11-08T14:30:05Z');
const run = (cmd, args, input) => { const r = spawnSync(cmd, args, { encoding: 'utf8', input, maxBuffer: 64 << 20 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', stderr: r.stderr || '', error: r.error }; };
const sha = b => crypto.createHash('sha1').update(b).digest('hex');

// ------------------------------------------------------------------ the pictures (PIL): white, a red and a blue square
const RED = [255, 0, 0], BLUE = [0, 0, 255];
const PICS = [
  { name: 'portrait', w: 1224, h: 1584, marks: [['red', 150, 200, 200, 200], ['blue', 900, 1300, 160, 120]] },
  { name: 'landscape', w: 1600, h: 1000, marks: [['red', 1200, 100, 240, 240], ['blue', 80, 700, 300, 200]] },
  { name: 'a4', w: 1000, h: 1414, marks: [['red', 400, 600, 200, 200], ['blue', 60, 60, 120, 120]] },
  { name: 'wide', w: 800, h: 500, marks: [['red', 0, 0, 160, 120], ['blue', 640, 380, 160, 120]] },
  { name: 'grey', w: 800, h: 600, mode: 'L', marks: [['dark', 500, 120, 180, 180]] },
  { name: 'progressive', w: 900, h: 700, progressive: true, marks: [['red', 600, 400, 200, 200], ['blue', 100, 100, 150, 150]] },
  { name: 'cmyk', w: 900, h: 700, mode: 'CMYK', marks: [['red', 120, 420, 220, 200], ['blue', 600, 80, 200, 200, 'inkblue']] },   // cyan + magenta ink is a dark violet-blue
  { name: 'exif', w: 600, h: 400, exif: true, marks: [['red', 250, 150, 100, 100]] },
  { name: 'big', w: 2000, h: 1500, noise: true, q: 95, marks: [['red', 900, 700, 200, 200]] },
];
const PY_MAKE = `
import json, sys, random
from PIL import Image, ImageDraw
out, spec = sys.argv[1], json.loads(sys.argv[2])
ink = {'RGB': {'red': (255, 0, 0), 'blue': (0, 0, 255), 'white': (255, 255, 255)},
       'L': {'dark': 0, 'white': 255},
       'CMYK': {'red': (0, 255, 255, 0), 'blue': (255, 255, 0, 0), 'white': (0, 0, 0, 0)}}
for s in spec:
    mode = s.get('mode', 'RGB')
    im = Image.new(mode, (s['w'], s['h']), ink[mode]['white'])
    if s.get('noise'):
        random.seed(5)
        im = Image.frombytes('RGB', (s['w'], s['h']), bytes(random.getrandbits(8) | 0xC0 for _ in range(s['w'] * s['h'] * 3)))
    d = ImageDraw.Draw(im)
    for kind, x, y, w, h, *seen in s['marks']:
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=ink[mode][kind])
    kw = dict(quality=s.get('q', 92), progressive=bool(s.get('progressive')))
    if s.get('exif'):
        ex = Image.Exif(); ex[0x010F] = 'Nib test camera'; ex[0x0110] = 'pdf_check'; kw['exif'] = ex.tobytes()
    im.save(out + '/' + s['name'] + '.jpg', 'JPEG', **kw)
print('ok')
`;
const made = run('python3', ['-I', '-c', PY_MAKE, OUT, JSON.stringify(PICS)]);
if (made.code !== 0) { console.log('cannot make the test JPEGs (python3 with PIL):\n' + made.out); process.exit(1); }
const JPEG = {};
for (const p of PICS) JPEG[p.name] = new Uint8Array(fs.readFileSync(path.join(OUT, p.name + '.jpg')));
const pic = name => PICS.find(p => p.name === name);

// ------------------------------------------------------------------ checking a PDF
const PY_READ = `
import json, sys, hashlib, logging, io
from pypdf import PdfReader
log = io.StringIO(); h = logging.StreamHandler(log); lg = logging.getLogger('pypdf'); lg.addHandler(h); lg.setLevel(logging.WARNING)
try:
    r = PdfReader(sys.argv[1], strict=True)
    m = r.metadata or {}
    pages = []
    for p in r.pages:
        im = p['/Resources']['/XObject']['/Im0'].get_object()
        data = im.get_data()
        pages.append({'box': [float(v) for v in p.mediabox], 'filter': im['/Filter'], 'w': im['/Width'], 'h': im['/Height'],
                      'cs': im['/ColorSpace'], 'bpc': im['/BitsPerComponent'], 'decode': [float(v) for v in im['/Decode']] if '/Decode' in im else None,
                      'sha': hashlib.sha1(data).hexdigest(), 'content': p.get_contents().get_data().decode('latin-1')})
    d = m.creation_date if m else None
    print(json.dumps({'pages': pages, 'title': m.title, 'author': m.author, 'subject': m.subject, 'creator': m.creator, 'producer': m.producer,
                      'created': d.timestamp() if d else None, 'warnings': log.getvalue()}))
except Exception as e:
    print(json.dumps({'error': repr(e), 'warnings': log.getvalue()}))
`;
function pypdf(file) { const r = run('python3', ['-I', '-c', PY_READ, file]); try { return JSON.parse(r.stdout); } catch (e) { return { error: r.out }; } }
function pdfinfo(file, n) {
  const r = run('pdfinfo', ['-isodates', '-f', '1', '-l', String(n), file]), info = { stderr: r.stderr, sizes: [] };
  for (const line of r.stdout.split('\n')) {
    const m = /^(\w[\w ]*?):\s+(.*)$/.exec(line), s = /^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/.exec(line);
    if (s) info.sizes[+s[1] - 1] = [+s[2], +s[3]]; else if (m) info[m[1]] = m[2];
  }
  return info;
}
function render(file, page, dpi) {
  const prefix = path.join(OUT, path.basename(file, '.pdf') + '-p' + page);
  const r = run('pdftoppm', ['-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile', file, prefix]);
  const buf = fs.readFileSync(prefix + '.ppm');
  let i = 0; const tok = [];
  while (tok.length < 4) { while (/\s/.test(String.fromCharCode(buf[i]))) i++; let t = ''; while (!/\s/.test(String.fromCharCode(buf[i]))) t += String.fromCharCode(buf[i++]); tok.push(t); }
  return { stderr: r.stderr, w: +tok[1], h: +tok[2], px: buf.subarray(i + 1) };
}
const IS = { red: (r, g, b) => r > 150 && g < 110 && b < 110, blue: (r, g, b) => b > 150 && r < 110 && g < 110, dark: (r, g, b) => r < 90 && g < 90 && b < 90,
  inkblue: (r, g, b) => b > 110 && r < 90 && g < 90 && b - r > 50 };
function blob(img, kind) {
  let n = 0, sx = 0, sy = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const k = (y * img.w + x) * 3;
    if (!IS[kind](img.px[k], img.px[k + 1], img.px[k + 2])) continue;
    n++; sx += x + 0.5; sy += y + 0.5; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
  }
  return n ? { n, cx: sx / n, cy: sy / n, box: [x0, y0, x1, y1] } : null;
}
// one page: what pypdf and pdfinfo say, and where the squares are when it is drawn at 40 dpi
function checkPage(file, no, page, R, I, label) {
  const p = pic(page.pic), s = 40 / 72, rp = R.pages && R.pages[no - 1];
  const place = page.place || P.pdfFit(p.w, p.h, page.pw, page.ph);
  ok(rp && rp.filter === '/DCTDecode' && rp.w === p.w && rp.h === p.h && rp.bpc === 8 && rp.cs === (p.mode === 'L' ? '/DeviceGray' : p.mode === 'CMYK' ? '/DeviceCMYK' : '/DeviceRGB'),
    `${label}: pypdf sees a ${p.w}×${p.h} /DCTDecode image, ${rp && rp.cs}`);
  ok(rp && rp.sha === sha(JPEG[page.pic]), `${label}: the image stream is the JPEG, byte for byte`);
  ok(rp && Math.abs(rp.box[2] - page.pw) < 1e-3 && Math.abs(rp.box[3] - page.ph) < 1e-3 && I.sizes[no - 1] && Math.abs(I.sizes[no - 1][0] - page.pw) < 0.01 && Math.abs(I.sizes[no - 1][1] - page.ph) < 0.01,
    `${label}: page size ${page.pw} × ${page.ph} pt (pdfinfo ${I.sizes[no - 1] && I.sizes[no - 1].join(' × ')})`);
  const img = render(file, no, 40);
  ok(!img.stderr.trim() && Math.abs(img.w - page.pw * s) <= 1 && Math.abs(img.h - page.ph * s) <= 1, `${label}: pdftoppm -r 40 draws it ${img.w}×${img.h}` + (img.stderr.trim() ? ' — ' + img.stderr.trim() : ''));
  for (const [kind, mx, my, mw, mh, seen] of p.marks) {
    const kx = place[2] / p.w, ky = place[3] / p.h;
    const want = [(place[0] + mx * kx) * s, (place[1] + my * ky) * s, (place[0] + (mx + mw) * kx) * s, (place[1] + (my + mh) * ky) * s];
    const got = blob(img, seen || kind), cx = (want[0] + want[2]) / 2, cy = (want[1] + want[3]) / 2;
    const off = got ? Math.hypot(got.cx - cx, got.cy - cy) : Infinity, edge = got ? Math.max(...got.box.map((v, k) => Math.abs(v - want[k]))) : Infinity;
    ok(off < 1.5 && edge <= 2, `${label}: the ${kind} square lands where it should (centre off by ${off.toFixed(2)} px, edges by ≤ ${edge.toFixed(1)} px at 40 dpi)`);
  }
  if (p.mode === 'L') {
    const g = blob(img, 'dark'), k = g ? ((Math.round(g.cy) * img.w + Math.round(g.cx)) * 3) : 0;
    ok(g && img.px[k] === img.px[k + 1] && img.px[k + 1] === img.px[k + 2], `${label}: grey stays grey (${g && [img.px[k], img.px[k + 1], img.px[k + 2]].join(',')})`);
  }
  // outside the picture the page is white (where the picture leaves room)
  const corners = [[1, 1], [img.w - 2, 1], [1, img.h - 2], [img.w - 2, img.h - 2]].filter(([x, y]) => x < place[0] * s - 1 || y < place[1] * s - 1 || x > (place[0] + place[2]) * s + 1 || y > (place[1] + place[3]) * s + 1);
  ok(corners.every(([x, y]) => { const k = (y * img.w + x) * 3; return img.px[k] > 250 && img.px[k + 1] > 250 && img.px[k + 2] > 250; }), `${label}: white where there is no picture (${corners.length} corners checked)`);
}
// the cross-reference table, read byte for byte: 20-byte entries, each offset at its "n 0 obj", startxref at "xref"
function checkXref(bytes, label) {
  const s = Buffer.from(bytes).toString('latin1');
  const m = /startxref\n(\d+)\n%%EOF\n$/.exec(s);
  const at = m ? +m[1] : -1, head = at >= 0 ? /^xref\n0 (\d+)\n/.exec(s.slice(at)) : null;
  let good = !!head, n = head ? +head[1] : 0;
  if (good) {
    const t0 = at + head[0].length;
    good = s.slice(t0, t0 + 20) === '0000000000 65535 f \n';
    for (let k = 1; good && k < n; k++) {
      const e = s.slice(t0 + 20 * k, t0 + 20 * k + 20);
      good = /^\d{10} 00000 n \n$/.test(e) && s.startsWith(k + ' 0 obj\n', +e.slice(0, 10));
    }
    good = good && s.startsWith('trailer\n<< /Size ' + n + ' ', t0 + 20 * n);
  }
  ok(s.startsWith('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n') && good, `${label}: header, ${n} xref entries of 20 bytes pointing at their objects, startxref, %%EOF`);
}
// the whole file: write it, qpdf, pdfinfo, pypdf, every page
function checkPdf(name, pages, meta, extra) {
  const file = path.join(OUT, name + '.pdf'), bytes = extra && extra.bytes ? extra.bytes : P.pdfMake(pages.map(pg => ({ jpeg: JPEG[pg.pic], iw: pic(pg.pic).w, ih: pic(pg.pic).h, pw: pg.pw, ph: pg.ph, place: pg.place })), meta);
  fs.writeFileSync(file, bytes);
  const q = run('qpdf', ['--check', file]), qa = run('qpdf', ['--check', '--decode-level=all', file]);
  ok(q.code === 0 && /No syntax or stream encoding errors found/.test(q.out) && !/warning|error:/i.test(q.out.replace(/No syntax or stream encoding errors found;[^\n]*\n[^\n]*/, '')), `${name}.pdf: qpdf --check: no errors or warnings` + (q.code ? ' — ' + q.out : ''));
  ok(qa.code === 0 && !/warning/i.test(qa.out), `${name}.pdf: qpdf --check --decode-level=all (decodes the JPEGs): clean` + (qa.code ? ' — ' + qa.out : ''));
  checkXref(bytes, name + '.pdf');
  const I = pdfinfo(file, pages.length), R = pypdf(file);
  ok(!I.stderr.trim() && +I.Pages === pages.length && I['PDF version'] === '1.4', `${name}.pdf: pdfinfo: ${I.Pages} pages, PDF ${I['PDF version']}` + (I.stderr.trim() ? ' — ' + I.stderr.trim() : ''));
  ok(!R.error && !R.warnings && R.pages.length === pages.length, `${name}.pdf: pypdf (strict) opens it: ${R.error || R.pages.length + ' pages'}` + (R.warnings ? ' — warnings: ' + R.warnings : ''));
  if (meta && meta.title !== undefined) ok(I.Title === meta.title && R.title === meta.title, `${name}.pdf: the title reads back exactly: ${JSON.stringify(I.Title)} / ${JSON.stringify(R.title)}`);
  ok(R.creator === 'Nib Board' && R.producer === 'Nib test' && I.Creator === 'Nib Board', `${name}.pdf: Creator ${JSON.stringify(R.creator)}, Producer ${JSON.stringify(R.producer)}`);
  if (meta && meta.date) ok(R.created === meta.date.getTime() / 1000, `${name}.pdf: CreationDate is the moment given (${I.CreationDate})`);
  if (!R.error) pages.forEach((pg, k) => checkPage(file, k + 1, pg, R, I, `${name}.pdf p${k + 1}`));
  return { file, bytes, R, I };
}

(async () => {
  // ------------------------------------------------------------------ 1. pdfJpegSize
  section('1. pdfJpegSize');
  for (const p of PICS) {
    const s = P.pdfJpegSize(JPEG[p.name]);
    ok(s && s.w === p.w && s.h === p.h && s.comps === (p.mode === 'L' ? 1 : p.mode === 'CMYK' ? 4 : 3) && s.bits === 8, `${p.name}.jpg: ${s && `${s.w}×${s.h}, ${s.comps} components`}`);
  }
  ok(P.pdfJpegSize(JPEG.cmyk).adobe === true && P.pdfJpegSize(JPEG.portrait).adobe === false, 'the Adobe APP14 marker of the CMYK JPEG is seen');
  ok(P.pdfJpegSize(JPEG.portrait.buffer.slice(JPEG.portrait.byteOffset, JPEG.portrait.byteOffset + JPEG.portrait.length)).w === 1224, 'an ArrayBuffer works too');
  ok(P.pdfJpegSize('data:image/jpeg;base64,' + Buffer.from(JPEG.wide).toString('base64')).w === 800, 'and a data URL');
  const png = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489', 'hex');
  const badJ = [new Uint8Array(0), new Uint8Array([0xFF, 0xD8]), JPEG.portrait.subarray(0, 12), JPEG.portrait.subarray(0, 150), png, new Uint8Array(1000).fill(0xFF), new Uint8Array([0xFF, 0xD8, 0xFF, 0xDA, 0, 4, 0, 0]), null, undefined, 'not a jpeg', 42, {}];
  const badR = badJ.map(b => P.pdfJpegSize(b));
  ok(badR.every(r => r === null), 'empty, cut off before the frame header, PNG, garbage, a scan before any frame, non-bytes → null' + (badR.some(r => r !== null) ? ': ' + JSON.stringify(badR) : ''));
  ok((P.pdfJpegSize(JPEG.portrait.subarray(0, 200)) || {}).w === 1224, 'cut off after its frame header, a JPEG still tells its size');

  // ------------------------------------------------------------------ 2. one page
  section('2. one page');
  const L = P.PDF_SIZES.letter, LL = P.PDF_SIZES['letter-landscape'], A4 = P.PDF_SIZES.a4;
  checkPdf('one-page', [{ pic: 'portrait', pw: L[0], ph: L[1], place: P.pdfFit(1224, 1584, L[0], L[1], 36) }], { title: 'Ratios warm-up', date: DATE });

  // ------------------------------------------------------------------ 3. three pages of different sizes
  section('3. three pages, three sizes');
  checkPdf('three-pages', [
    { pic: 'landscape', pw: LL[0], ph: LL[1], place: P.pdfFit(1600, 1000, LL[0], LL[1], 24) },
    { pic: 'a4', pw: A4[0], ph: A4[1], place: [50, 80, 400, 565.6] },                    // placed by hand, from the top-left
    { pic: 'wide', pw: 400, ph: 250, place: [0, 0, 400, 250] },                           // a page fitted to its content
  ], { title: 'Three sizes', author: 'Mr. Shaffer', subject: 'pages of different sizes', date: DATE });

  // ------------------------------------------------------------------ 4. grey, progressive, CMYK, EXIF
  section('4. grey, progressive, CMYK and EXIF JPEGs');
  checkPdf('grey', [{ pic: 'grey', pw: LL[0], ph: LL[1] }], { title: 'Grey', date: DATE });           // place left out: fitted, centred
  checkPdf('progressive', [{ pic: 'progressive', pw: L[0], ph: L[1], place: [72, 72, 450, 350] }], { title: 'Progressive', date: DATE });
  const cm = checkPdf('cmyk', [{ pic: 'cmyk', pw: LL[0], ph: LL[1], place: [36, 36, 720, 560] }], { title: 'CMYK', date: DATE });
  ok(cm.R.pages && JSON.stringify(cm.R.pages[0].decode) === '[1,0,1,0,1,0,1,0]', 'the Adobe CMYK JPEG gets /Decode [1 0 1 0 1 0 1 0] (its ink is stored inverted)');
  checkPdf('exif', [{ pic: 'exif', pw: 300, ph: 200, place: [0, 0, 300, 200] }], { title: 'EXIF', date: DATE });

  // ------------------------------------------------------------------ 5. text in the Info dictionary
  section('5. titles');
  const t1 = 'Unit 3 – Ratios (café) \\ week 2 ✏️ 😀', a1 = 'Mr. Shaffer (7th grade)', s1 = 'Ratios – practice';
  const T = checkPdf('title', [{ pic: 'wide', pw: 400, ph: 250, place: [0, 0, 400, 250] }], { title: t1, author: a1, subject: s1, date: DATE });
  ok(T.R.author === a1 && T.R.subject === s1 && T.I.Author === a1 && T.I.Subject === s1, `author and subject read back: ${JSON.stringify(T.I.Author)}, ${JSON.stringify(T.I.Subject)}`);
  ok(Buffer.from(T.bytes).toString('latin1').includes('/Title <FEFF0055006E0069007400200033002020130020'), 'a title that is not plain ASCII is UTF-16BE hex with a byte-order mark');
  const t2 = 'Ratios (part 2) \\ review';
  const T2 = checkPdf('ascii-title', [{ pic: 'wide', pw: 400, ph: 250, place: [0, 0, 400, 250] }], { title: t2, date: DATE });
  ok(Buffer.from(T2.bytes).toString('latin1').includes('/Title (Ratios \\(part 2\\) \\\\ review)'), 'a plain ASCII title is a literal string with ( ) \\ escaped');
  const tz = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  const T3 = P.pdfMake([{ jpeg: JPEG.wide }], { title: 'Pacific', date: DATE });
  process.env.TZ = 'Asia/Kolkata';
  const T4 = P.pdfMake([{ jpeg: JPEG.wide }], { title: 'India', date: DATE });
  if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  const d3 = /\/CreationDate \(([^)]*)\)/.exec(Buffer.from(T3).toString('latin1'))[1], d4 = /\/CreationDate \(([^)]*)\)/.exec(Buffer.from(T4).toString('latin1'))[1];
  fs.writeFileSync(path.join(OUT, 'tz-pacific.pdf'), T3); fs.writeFileSync(path.join(OUT, 'tz-india.pdf'), T4);
  ok(d3 === "D:20261108063005-08'00'" && d4 === "D:20261108200005+05'30'" && pypdf(path.join(OUT, 'tz-pacific.pdf')).created === DATE.getTime() / 1000 && pypdf(path.join(OUT, 'tz-india.pdf')).created === DATE.getTime() / 1000,
    `dates carry the local offset and read back as the same moment: ${d3}, ${d4}`);
  const T5 = P.pdfMake([{ jpeg: JPEG.wide }], {});
  ok(!/\/Title/.test(Buffer.from(T5).toString('latin1')) && /\/CreationDate \(D:\d{14}/.test(Buffer.from(T5).toString('latin1')), 'no title: no /Title; no date: now');

  // ------------------------------------------------------------------ 6. defaults, odd sizes, bad input
  section('6. defaults and bad input');
  const D1 = P.pdfMake([{ jpeg: JPEG.wide }], { title: 'defaults', date: DATE }), d1s = Buffer.from(D1).toString('latin1');
  ok(/\/MediaBox \[0 0 612 792\]/.test(d1s) && /q 612 0 0 382\.5 0 204\.75 cm \/Im0 Do Q/.test(d1s), 'page size left out: Letter; place left out: fitted to the page, centred');
  const D2 = P.pdfMake([{ jpeg: JPEG.wide, iw: 400, ih: 250, pw: 300, ph: 200, place: [0, 0, 300, 200] }], { date: DATE });
  ok(/\/Width 800 \/Height 500/.test(Buffer.from(D2).toString('latin1')), 'iw / ih that disagree with the JPEG: the JPEG\'s own size is written (it is what a reader decodes)');
  const D3 = P.pdfMake([{ jpeg: JPEG.wide, pw: 28800, ph: 18000, place: [0, 0, 28800, 18000] }], { date: DATE });
  fs.writeFileSync(path.join(OUT, 'huge-page.pdf'), D3);
  const hp = pdfinfo(path.join(OUT, 'huge-page.pdf'), 1);
  ok(/\/MediaBox \[0 0 14400 9000\]/.test(Buffer.from(D3).toString('latin1')) && /q 14400 0 0 9000 0 0 cm/.test(Buffer.from(D3).toString('latin1')) && hp.sizes[0] && hp.sizes[0][0] === 14400,
    'a page side over 200 in is scaled down to 14400 pt, picture and all');
  const D4 = P.pdfMake([{ jpeg: 'data:image/jpeg;base64,' + Buffer.from(JPEG.wide).toString('base64'), pw: 400, ph: 250 }], { date: DATE });
  ok(Buffer.from(D4).includes(Buffer.from(JPEG.wide)), 'a data URL works as the jpeg');
  const D5 = P.pdfMake([{ jpeg: JPEG.wide, pw: 400, ph: 250, place: [-50, -20, 500, 290] }], { date: DATE }), d5 = Buffer.from(D5).toString('latin1');
  ok(/q 500 0 0 290 -50 -20 cm/.test(d5), 'a picture may hang off the page (negative x, y): ' + /q [^\n]* Q/.exec(d5)[0]);
  const throwsWith = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };
  ok(throwsWith(() => P.pdfMake([], {}), /no pages/) && throwsWith(() => P.pdfMake(null), /no pages/), 'no pages → throws "no pages"');
  ok(throwsWith(() => P.pdfMake([{ jpeg: JPEG.wide }, { jpeg: new Uint8Array(png) }], {}), /page 2 has no JPEG/), 'a PNG on page 2 → throws, naming page 2');
  ok(throwsWith(() => P.pdfMake([{}], {}), /page 1 has no JPEG/) && throwsWith(() => P.pdfMake([null], {}), /page 1 has no JPEG/), 'a page without jpeg → throws');

  // ------------------------------------------------------------------ 7. time and memory: 30 one-megabyte pages
  section('7. thirty big pages');
  const bigPages = []; for (let k = 0; k < 30; k++) bigPages.push({ jpeg: JPEG.big, iw: 2000, ih: 1500, pw: LL[0], ph: LL[1], place: P.pdfFit(2000, 1500, LL[0], LL[1], 18) });
  P.pdfMake(bigPages.slice(0, 2), { date: DATE });
  const t0 = process.hrtime.bigint(), many = P.pdfMake(bigPages, { title: 'Thirty pages', date: DATE }), dt = Number(process.hrtime.bigint() - t0) / 1e6;
  fs.writeFileSync(path.join(OUT, 'thirty-pages.pdf'), many);
  const qm = run('qpdf', ['--check', path.join(OUT, 'thirty-pages.pdf')]), im = pdfinfo(path.join(OUT, 'thirty-pages.pdf'), 30);
  const over = many.length - 30 * JPEG.big.length;
  console.log(`  30 pages of a ${(JPEG.big.length / 1e6).toFixed(2)} MB JPEG: ${(many.length / 1e6).toFixed(2)} MB of PDF in ${dt.toFixed(1)} ms (${over} bytes besides the pictures, ${(over / 30).toFixed(0)} a page)`);
  ok(qm.code === 0 && +im.Pages === 30 && over < 30 * 600, `30 one-megabyte pages: qpdf clean, ${im.Pages} pages, ${(over / 30).toFixed(0)} bytes of PDF a page around each JPEG`);
  ok(dt < 500, `built in ${dt.toFixed(1)} ms`);
  checkXref(many, 'thirty-pages.pdf');

  // ------------------------------------------------------------------ 8. Chrome: a canvas JPEG, and the PDF made in the browser
  section('8. Chrome');
  let puppeteer = null;
  try { puppeteer = require(path.join(__dirname, '..', 'demo', 'node_modules', 'puppeteer-core')); } catch (e) { /* no browser here */ }
  if (!puppeteer || !fs.existsSync('/usr/bin/google-chrome')) console.log('  (skipped: no puppeteer-core / Chrome)');
  else {
    const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage(), errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.emulateTimezone('UTC');
      await page.goto('about:blank');
      await page.addScriptTag({ content: "(function () {\n'use strict';\n" + pdfSrc + '\nwindow.PDF = { pdfMake, pdfJpegSize, pdfFit, PDF_SIZES };\n})();' });
      const got = await page.evaluate(async when => {
        const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, 1200, 900); g.fillStyle = '#f00'; g.fillRect(100, 150, 200, 200); g.fillStyle = '#00f'; g.fillRect(800, 600, 200, 150);
        const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
        const jpeg = new Uint8Array(await blob.arrayBuffer());
        const pdf = PDF.pdfMake([{ jpeg, iw: 1200, ih: 900, pw: 792, ph: 612, place: PDF.pdfFit(1200, 900, 792, 612, 36) }], { title: 'Made in Chrome – é', date: new Date(when) });
        const b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
        return { jpeg: b64(jpeg), pdf: b64(pdf), viaDataUrl: PDF.pdfJpegSize(c.toDataURL('image/jpeg', 0.9)) };
      }, DATE.getTime());
      const cj = new Uint8Array(Buffer.from(got.jpeg, 'base64')), cp = new Uint8Array(Buffer.from(got.pdf, 'base64'));
      fs.writeFileSync(path.join(OUT, 'chrome.jpg'), cj);
      PICS.push({ name: 'chrome', w: 1200, h: 900, marks: [['red', 100, 150, 200, 200], ['blue', 800, 600, 200, 150]] }); JPEG.chrome = cj;
      let sof = -1; for (let i = 2; i < cj.length - 1; i++) if (cj[i] === 0xFF && cj[i + 1] >= 0xC0 && cj[i + 1] <= 0xC2) { sof = cj[i + 1]; break; }
      ok(sof === 0xC0 && got.viaDataUrl && got.viaDataUrl.w === 1200, `Chrome's canvas.toBlob JPEG is baseline (SOF${sof - 0xC0}); toDataURL works too`);
      const pages = [{ pic: 'chrome', pw: 792, ph: 612, place: P.pdfFit(1200, 900, 792, 612, 36) }];
      process.env.TZ = 'UTC';
      const nodeMade = P.pdfMake([{ jpeg: cj, pw: 792, ph: 612, place: P.pdfFit(1200, 900, 792, 612, 36) }], { title: 'Made in Chrome – é', date: DATE });
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
      ok(Buffer.from(nodeMade).equals(Buffer.from(cp)), 'the PDF made in Chrome is byte for byte the one node makes from the same JPEG');
      checkPdf('chrome-made', pages, { title: 'Made in Chrome – é', date: DATE }, { bytes: cp });
      ok(!errors.length, 'no page errors in Chrome' + (errors.length ? ': ' + errors.join(' | ') : ''));
    } finally { await browser.close(); }
  }

  // ------------------------------------------------------------------ 9. names
  section('9. top-level names');
  const mine = topNames(fs.readFileSync(path.join(SRC, 'pdf.js'), 'utf8'));
  ok(mine.length > 5 && mine.every(n => /^(pdf|PDF_)/.test(n)), `every top-level name in pdf.js starts with pdf / PDF_ (${mine.length}: ${mine.filter(n => !/^(pdf|PDF_)/.test(n)).join(' ') || 'all'})`);
  const clash = [];
  for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.js') && f !== 'pdf.js'))
    for (const n of topNames(fs.readFileSync(path.join(SRC, f), 'utf8'))) if (mine.includes(n)) clash.push(f + ': ' + n);
  ok(!clash.length, 'no other src/ file declares any of them at top level' + (clash.length ? ': ' + clash.join(', ') : ''));

  console.log(`\nPDFs in ${OUT}`);
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('  FAIL (threw)', e && e.stack || e); process.exit(1); });

// the top-level names a src/ file declares (lines that start with function / const / let / var / class)
function topNames(src) {
  const out = [];
  for (const line of src.split('\n')) {
    const m = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(line) || /^class\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) { out.push(m[1]); continue; }
    const d = /^(?:const|let|var)\s+/.exec(line);
    if (!d) continue;
    let depth = 0, expect = true;
    for (let i = d[0].length; i < line.length; i++) {
      const c = line[i];
      if (c === '"' || c === "'" || c === '`') { for (i++; i < line.length && line[i] !== c; i++) if (line[i] === '\\') i++; continue; }
      if (c === '/' && line[i + 1] === '/') break;
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ',' && depth === 0) expect = true;
      else if (expect && depth === 0 && /[A-Za-z_$]/.test(c)) { const id = /^[A-Za-z_$][\w$]*/.exec(line.slice(i))[0]; out.push(id); i += id.length - 1; expect = false; }
    }
  }
  return out;
}
