// ================================================================== PDF export
// A PDF made of pictures, one JPEG per page, written here (no library): PDF 1.4 with a catalog, a page tree, per
// page one /DCTDecode image XObject and a one-line content stream that draws it, an /Info dictionary and a classic
// cross-reference table. The JPEG goes into the file unchanged (PDF readers decode JPEG themselves), so a page costs
// what its JPEG costs, and the file is built from a list of chunks copied once into the result.

// page sizes in points (1/72 in)
const PDF_SIZES = { letter: [612, 792], 'letter-landscape': [792, 612], a4: [595.28, 841.89], 'a4-landscape': [841.89, 595.28] };
const PDF_MAX_PAGE = 14400;    // the largest page side PDF 1.4 readers take (200 in); a bigger page is scaled down to it
const PDF_MIN_PAGE = 3;

// bytes from a Uint8Array (or Node Buffer), any other typed array or DataView, an ArrayBuffer, or a base64 data URL
// (canvas.toDataURL('image/jpeg')); null for anything else
function pdfBytes(x) {
  if (ArrayBuffer.isView(x)) return x instanceof Uint8Array ? x : new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  if (x instanceof ArrayBuffer || Object.prototype.toString.call(x) === '[object ArrayBuffer]') return new Uint8Array(x);
  if (typeof x === 'string' && /^data:[^,]*;base64,/i.test(x)) {
    try {
      const bin = atob(x.slice(x.indexOf(',') + 1)), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    } catch (e) { return null; }
  }
  return null;
}

// A JPEG's pixel size and colour components, read from its frame header (SOF):
// {w, h, comps (1 grey, 3 colour, 4 CMYK), bits (8 for every JPEG a PDF can hold), adobe (an Adobe APP14 segment came
// first)}, or null when the bytes are not a JPEG (no SOI, a damaged marker, no frame header before the scan).
function pdfJpegSize(bytes) {
  const b = pdfBytes(bytes);
  if (!b || b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2, adobe = false;
  while (i + 1 < b.length) {
    if (b[i] !== 0xFF) return null;                                  // not at a marker: damaged
    const m = b[i + 1];
    if (m === 0xFF) { i++; continue; }                               // fill byte
    i += 2;
    if (m === 0x01 || m === 0xD8 || (m >= 0xD0 && m <= 0xD7)) continue;   // markers without a length
    if (m === 0xD9 || m === 0xDA) return null;                       // end of image, or the scan, before any frame header
    if (i + 2 > b.length) return null;
    const len = (b[i] << 8) | b[i + 1];
    if (len < 2 || i + len > b.length) return null;
    if (m === 0xEE && len >= 7 && b[i + 2] === 0x41 && b[i + 3] === 0x64 && b[i + 4] === 0x6F && b[i + 5] === 0x62 && b[i + 6] === 0x65) adobe = true;
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {   // SOF0..SOF15 (not DHT, JPG, DAC)
      if (len < 8) return null;
      return { w: (b[i + 5] << 8) | b[i + 6], h: (b[i + 3] << 8) | b[i + 4], comps: b[i + 7], bits: b[i + 2], adobe };
    }
    i += len;
  }
  return null;
}

// where a picture of iw × ih px goes to fill a pw × ph pt page without distortion, centred inside a margin (pt):
// [x, y, w, h] in pt from the page's top-left
function pdfFit(iw, ih, pw, ph, margin) {
  const mg = Math.max(0, +margin || 0), aw = Math.max(1e-3, pw - 2 * mg), ah = Math.max(1e-3, ph - 2 * mg);
  const k = Math.min(aw / iw, ah / ih), w = iw * k, h = ih * k;
  return [(pw - w) / 2, (ph - h) / 2, w, h];
}

// a number as PDF writes it: plain decimal (never 1e-7 or 1e+21), at most 4 decimals, no trailing zeros
function pdfNum(v) {
  const c = Number.isFinite(v) ? Math.max(-1e9, Math.min(1e9, v)) : 0, r = Math.round(c * 1e4) / 1e4;
  return r ? r.toFixed(4).replace(/\.?0+$/, '') : '0';
}

// text for the Info dictionary: a literal string when it is plain printable ASCII (with ( ) \ escaped), else UTF-16BE
// in hex with a byte-order mark (so "–", "é" and emoji survive)
function pdfText(s) {
  s = String(s);
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, '\\$&') + ')';
  let h = '<FEFF';
  for (let i = 0; i < s.length; i++) h += (0x10000 + s.charCodeAt(i)).toString(16).slice(1).toUpperCase();
  return h + '>';
}

// a PDF date, local time with its offset from UT: D:YYYYMMDDHHmmSS+HH'mm' (Z when the offset is 0)
function pdfDate(d) {
  const p = n => String(n).padStart(2, '0'), off = -d.getTimezoneOffset(), a = Math.abs(off);
  const tz = off === 0 ? 'Z' : (off > 0 ? '+' : '-') + p(Math.floor(a / 60)) + "'" + p(a % 60) + "'";
  return 'D:' + String(d.getFullYear()).padStart(4, '0') + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + tz;
}

// ASCII (and the header's four high bytes) to bytes
function pdfLatin1(s) {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
  return u;
}

// the trailer's file identifier: a 128-bit hash (four FNV-1a lanes) of strings and of a sample of each picture's bytes
function pdfIdOf(parts) {
  const h = [0x811c9dc5, 0x050c5d1f, 0x6a09e667, 0x3c6ef372];
  const mix = c => { for (let k = 0; k < 4; k++) h[k] = Math.imul(h[k] ^ c, 0x01000193 + 2 * k) >>> 0; };
  for (const part of parts) {
    if (typeof part === 'string') for (let i = 0; i < part.length; i++) mix(part.charCodeAt(i));
    else { const step = Math.max(1, part.length >> 12); for (let i = 0; i < part.length; i += step) mix(part[i]); mix(part.length & 255); }
  }
  return h.map(v => v.toString(16).padStart(8, '0')).join('').toUpperCase();
}

// A PDF made of one picture per page.
//   pages: [{ jpeg: the bytes of a baseline (or progressive) JPEG, as canvas.toBlob gives (a Uint8Array, an
//             ArrayBuffer or a data URL); iw, ih: its pixel size (read from the JPEG itself, which wins when they
//             differ: it is what a reader decodes); pw, ph: the page size in pt (default Letter); place: [x, y, w, h]
//             where the picture goes, in pt from the page's TOP-left (default: fitted to the page, centred) }]
//   meta:  { title, author?, subject?, date? (a Date; default now) }
// Returns a Uint8Array holding a PDF 1.4 file. Pages may differ in size; a page side above 200 in is scaled down to it
// (picture and all). A grey JPEG goes in as /DeviceGray, a colour one as /DeviceRGB, a CMYK one as /DeviceCMYK.
// Throws an Error naming the page when there are no pages or a page has no usable JPEG.
function pdfMake(pages, meta) {
  if (!Array.isArray(pages) || !pages.length) throw new Error('pdfMake: no pages');
  const M = meta || {};
  const date = M.date instanceof Date && Number.isFinite(M.date.getTime()) ? M.date : new Date();
  const chunks = [], at = [0];
  let size = 0;
  const add = u => { chunks.push(u); size += u.length; };
  const text = s => add(pdfLatin1(s));
  const obj = (n, body) => { at[n] = size; text(n + ' 0 obj\n' + body + '\nendobj\n'); };
  const idParts = [String(M.title || ''), date.toISOString(), String(pages.length)];

  text('%PDF-1.4\n%' + String.fromCharCode(0xE2, 0xE3, 0xCF, 0xD3) + '\n');   // the second line's high bytes mark the file as binary
  const title = M.title === undefined || M.title === null ? '' : String(M.title);
  const kids = pages.map((_, i) => (4 + 3 * i) + ' 0 R').join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R' + (title ? ' /ViewerPreferences << /DisplayDocTitle true >>' : '') + ' >>');
  obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');
  let info = '<<';
  if (title) info += ' /Title ' + pdfText(title);
  if (M.author) info += ' /Author ' + pdfText(M.author);
  if (M.subject) info += ' /Subject ' + pdfText(M.subject);
  obj(3, info + ' /Creator (Nib Board) /Producer (Nib __VERSION__) /CreationDate (' + pdfDate(date) + ') >>');

  for (let i = 0; i < pages.length; i++) {
    const P = pages[i] || {}, n = 4 + 3 * i, jpeg = pdfBytes(P.jpeg), sof = jpeg && pdfJpegSize(jpeg);
    if (!sof) throw new Error('pdfMake: page ' + (i + 1) + ' has no JPEG (jpeg must hold the bytes of a JPEG file)');
    if (sof.bits !== 8 || (sof.comps !== 1 && sof.comps !== 3 && sof.comps !== 4)) throw new Error('pdfMake: page ' + (i + 1) + ': a ' + sof.bits + '-bit JPEG with ' + sof.comps + ' components cannot go into a PDF');
    const iw = sof.w || Math.round(+P.iw), ih = sof.h || Math.round(+P.ih);
    if (!(iw > 0 && ih > 0)) throw new Error('pdfMake: page ' + (i + 1) + ': the JPEG does not say its size');
    let pw = +P.pw > 0 && Number.isFinite(+P.pw) ? +P.pw : PDF_SIZES.letter[0];
    let ph = +P.ph > 0 && Number.isFinite(+P.ph) ? +P.ph : PDF_SIZES.letter[1];
    const pl = Array.isArray(P.place) && P.place.length >= 4 && P.place.slice(0, 4).every(v => Number.isFinite(+v)) && +P.place[2] > 0 && +P.place[3] > 0
      ? P.place.slice(0, 4).map(Number) : pdfFit(iw, ih, pw, ph);
    const k = Math.min(1, PDF_MAX_PAGE / Math.max(pw, ph));
    if (k < 1) { pw *= k; ph *= k; for (let j = 0; j < 4; j++) pl[j] *= k; }
    pw = Math.max(PDF_MIN_PAGE, pw); ph = Math.max(PDF_MIN_PAGE, ph);
    const cs = sof.comps === 1 ? '/DeviceGray' : sof.comps === 3 ? '/DeviceRGB' : '/DeviceCMYK';
    const decode = sof.comps === 4 && sof.adobe ? ' /Decode [1 0 1 0 1 0 1 0]' : '';   // Adobe CMYK JPEGs are stored inverted
    obj(n, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pdfNum(pw) + ' ' + pdfNum(ph) + '] /Resources << /XObject << /Im0 ' + (n + 1) +
      ' 0 R >> /ProcSet [/PDF ' + (sof.comps === 1 ? '/ImageB' : '/ImageC') + '] >> /Contents ' + (n + 2) + ' 0 R >>');
    at[n + 1] = size;
    text((n + 1) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + iw + ' /Height ' + ih + ' /ColorSpace ' + cs +
      ' /BitsPerComponent 8' + decode + ' /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
    add(jpeg);
    text('\nendstream\nendobj\n');
    // the picture's unit square scaled to w × h and moved to (x, y), y from the page's bottom (PDF's origin)
    const draw = 'q ' + pdfNum(pl[2]) + ' 0 0 ' + pdfNum(pl[3]) + ' ' + pdfNum(pl[0]) + ' ' + pdfNum(ph - pl[1] - pl[3]) + ' cm /Im0 Do Q';
    obj(n + 2, '<< /Length ' + draw.length + ' >>\nstream\n' + draw + '\nendstream');
    idParts.push(pdfNum(pw) + 'x' + pdfNum(ph), jpeg);
  }

  const count = 4 + 3 * pages.length, xref = size, id = pdfIdOf(idParts);
  let tail = 'xref\n0 ' + count + '\n0000000000 65535 f \n';        // every entry is 20 bytes: 10-digit offset, generation, n/f, SP LF
  for (let n = 1; n < count; n++) tail += String(at[n]).padStart(10, '0') + ' 00000 n \n';
  tail += 'trailer\n<< /Size ' + count + ' /Root 1 0 R /Info 3 0 R /ID [<' + id + '> <' + id + '>] >>\nstartxref\n' + xref + '\n%%EOF\n';
  text(tail);

  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
