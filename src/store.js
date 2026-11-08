// ================================================================== storage: compact points, images by id
// The Board keeps every page in localStorage (5 MB for everything), so each stroke's points are kept as a short
// string; pictures (data URLs, often megabytes) go to IndexedDB by id instead.
//
// Packed points: one string of base64url digits (A–Z a–z 0–9 - _, so it sits in JSON without escaping).
//   digit 0      flags: bit 0 set when pressure is stored ('A' without, 'B' with); the other bits are 0 (a later
//                format would set them, and this one then reads nothing rather than misreading it)
//   then         per point Δx, Δy (and Δp): the change from the point before (from 0 for the first) in quantised
//                units (x and y × 10 rounded, so 0.1 px; p × 100 rounded, 0..100), zigzag-mapped to unsigned
//                (0, −1, 1, −2, … → 0, 1, 2, 3, …) and written as a varint of base-32 digits, low digit first: a
//                digit is 5 bits of the number, plus 32 when more digits follow.
// Pen samples are ~0.7 px apart, so most changes fit one digit: about 2.4 characters a point (JSON: about 15).

const STORE_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const STORE_CODE = new Uint8Array(64);                   // digit → character code
const STORE_DIGIT = new Int8Array(128).fill(-1);         // character code → digit (−1: not a digit)
for (let i = 0; i < 64; i++) { STORE_CODE[i] = STORE_B64.charCodeAt(i); STORE_DIGIT[STORE_CODE[i]] = i; }
const STORE_MAXQ = 2 ** 49;     // quantised values stay within ±2^49 (±5.6e13 px), so every delta is an exact double
const STORE_ASCII = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;   // the digits are ASCII: UTF-8 reads them as they are
let storeBuf = new Uint8Array(1 << 14);                  // scratch for storePack, doubled when a stroke needs more

function storeQ(v) { const r = Math.round(v); return r > STORE_MAXQ ? STORE_MAXQ : r < -STORE_MAXQ ? -STORE_MAXQ : r; }

// one change d, zigzag-mapped, as base-32 digits into buf at n → the new n
function storeDigits(buf, n, d) {
  let z = d >= 0 ? 2 * d : -2 * d - 1;
  if (z < 32) { buf[n] = STORE_CODE[z]; return n + 1; }
  if (z < 0x40000000) while (z >= 32) { buf[n++] = STORE_CODE[32 | (z & 31)]; z >>>= 5; }
  else while (z >= 32) { const r = z % 32; buf[n++] = STORE_CODE[32 | r]; z = (z - r) / 32; }
  buf[n] = STORE_CODE[z];
  return n + 1;
}

// one stroke's points → a short string (see above). withPressure: also keep p (0..1); left out, it is on when a point
// has a p. Points without a finite x and y are left out; a point without a p takes the one before it (0.5 at first).
function storePack(points, withPressure) {
  const pts = Array.isArray(points) ? points : [];
  const wp = withPressure === undefined ? pts.some(q => q && q.length > 3 && Number.isFinite(q[3])) : !!withPressure;
  let buf = storeBuf, n = 0, lx = 0, ly = 0, lp = 0, any = false;
  buf[n++] = STORE_CODE[wp ? 1 : 0];
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    if (!q) continue;
    const x = +q[0], y = +q[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (n + 33 > buf.length) { const b = new Uint8Array(buf.length * 2); b.set(buf.subarray(0, n)); storeBuf = buf = b; }   // 3 values of up to 11 digits
    const X = storeQ(x * 10), Y = storeQ(y * 10);
    n = storeDigits(buf, n, X - lx); lx = X;
    n = storeDigits(buf, n, Y - ly); ly = Y;
    if (wp) {
      const p = q.length > 3 ? +q[3] : NaN;
      const P = Number.isFinite(p) ? Math.round((p < 0 ? 0 : p > 1 ? 1 : p) * 100) : any ? lp : 50;
      n = storeDigits(buf, n, P - lp); lp = P;
    }
    any = true;
  }
  if (STORE_ASCII && n > 64) return STORE_ASCII.decode(buf.subarray(0, n));
  if (n < 4096) return String.fromCharCode.apply(null, buf.subarray(0, n));
  const parts = [];
  for (let i = 0; i < n; i += 4096) parts.push(String.fromCharCode.apply(null, buf.subarray(i, Math.min(n, i + 4096))));
  return parts.join('');
}

// a string from storePack → [[x, y, 0, p?], ...] (t is not stored, so it is 0; p only when it was packed).
// Anything else ('' , garbage, a cut-off string, a later format) → [] (never throws).
function storeUnpack(str) {
  if (typeof str !== 'string' || str.length < 2) return [];
  const c0 = str.charCodeAt(0), flags = c0 < 128 ? STORE_DIGIT[c0] : -1;
  if (flags !== 0 && flags !== 1) return [];
  const stride = flags ? 3 : 2, out = [];
  let x = 0, y = 0, p = 0, comp = 0, z = 0, mul = 1, digits = 0;
  for (let i = 1; i < str.length; i++) {
    const c = str.charCodeAt(i), d = c < 128 ? STORE_DIGIT[c] : -1;
    if (d < 0) return [];
    z += (d & 31) * mul;
    if (d & 32) { if (++digits >= 11) return []; mul *= 32; continue; }
    const v = z < 4294967296 ? (z >>> 1) ^ -(z & 1) : z % 2 ? -(z + 1) / 2 : z / 2;
    z = 0; mul = 1; digits = 0;
    if (comp === 0) x += v; else if (comp === 1) y += v; else p += v;
    if (++comp === stride) { out.push(stride === 3 ? [x / 10, y / 10, 0, p / 100] : [x / 10, y / 10, 0]); comp = 0; }
  }
  return comp || digits || mul !== 1 ? [] : out;
}

// ------------------------------------------------------------------ images by id
// IndexedDB database 'nib-board' (version 1), object store 'images': id (a string) → data URL. Opened once and reused.
// When IndexedDB is not there or refuses (a private window, blocked site data, an opaque origin, a full disk), images
// are kept in a Map for the life of the page instead, and storeImagesDurable() says false. Nothing here throws or
// rejects: every function returns a Promise that resolves.
const STORE_DB = 'nib-board', STORE_IMAGES = 'images', STORE_WAIT = 5000;   // ms an unanswered open waits
const storeMem = new Map();      // images only this page has (IndexedDB missing, or it refused them)
let storeOpening = null;         // Promise<IDBDatabase | null>

function storeKey(id) { return typeof id === 'string' ? (id ? id : null) : typeof id === 'number' && Number.isFinite(id) ? String(id) : null; }

function storeOpen() {
  if (storeOpening) return storeOpening;
  const me = storeOpening = new Promise(resolve => {
    let done = false;
    const finish = db => {
      if (done) { if (db) try { db.close(); } catch (e) { /* ok */ } return; }
      done = true; clearTimeout(timer);
      if (db) {
        // another tab opening a newer version: step aside; the browser closing it (site data cleared): open again next time
        db.onversionchange = () => { try { db.close(); } catch (e) { /* ok */ } if (storeOpening === me) storeOpening = null; };
        db.onclose = () => { if (storeOpening === me) storeOpening = null; };
      }
      resolve(db);
    };
    const open = version => {
      let req;
      try {
        const f = typeof indexedDB !== 'undefined' ? indexedDB : null;     // reading it can throw (an opaque origin)
        if (!f) { finish(null); return; }
        req = version ? f.open(STORE_DB, version) : f.open(STORE_DB);
      } catch (e) { finish(null); return; }
      req.onupgradeneeded = () => { try { const db = req.result; if (!db.objectStoreNames.contains(STORE_IMAGES)) db.createObjectStore(STORE_IMAGES); } catch (e) { /* the open then fails */ } };
      req.onsuccess = () => {
        let db = null;
        try { db = req.result; if (!db.objectStoreNames.contains(STORE_IMAGES)) { db.close(); db = null; } } catch (e) { db = null; }
        finish(db);
      };
      req.onerror = e => {
        if (e && e.preventDefault) e.preventDefault();
        let name = '';
        try { name = req.error ? req.error.name : ''; } catch (_) { /* ok */ }
        if (version && name === 'VersionError') open(0);   // a newer Board made the database: use it as it is
        else finish(null);
      };
    };
    const timer = setTimeout(() => finish(null), STORE_WAIT);
    open(1);
  }).catch(() => null);
  return me;
}

// one request on the images store in a transaction of its own → {db: IndexedDB was there, ok: it did it, value}
// (a write is ok once it is committed). Requests run in the order they are asked for.
function storeRun(mode, make) {
  return storeOpen().then(db => !db ? { db: false, ok: false } : new Promise(resolve => {
    try {
      const tx = db.transaction(STORE_IMAGES, mode), req = make(tx.objectStore(STORE_IMAGES));
      let ok = false, value;
      req.onsuccess = () => { ok = true; value = req.result; };
      req.onerror = e => { if (e && e.preventDefault) e.preventDefault(); };
      tx.oncomplete = () => resolve({ db: true, ok, value });
      tx.onabort = () => resolve({ db: true, ok: false });
    } catch (e) { resolve({ db: true, ok: false }); }
  })).catch(() => ({ db: false, ok: false }));
}

// keep a picture under an id → true (false only for a bad id or a value that is not a string)
function storeImagePut(id, dataUrl) {
  const k = storeKey(id);
  if (k === null || typeof dataUrl !== 'string') return Promise.resolve(false);
  return storeRun('readwrite', s => s.put(dataUrl, k)).then(r => {
    if (r.ok) storeMem.delete(k); else storeMem.set(k, dataUrl);     // refused: kept for the life of the page
    return true;
  }).catch(() => { storeMem.set(k, dataUrl); return true; });
}

// the picture kept under an id → its data URL, or null
function storeImageGet(id) {
  const k = storeKey(id);
  if (k === null) return Promise.resolve(null);
  return storeRun('readonly', s => s.get(k))
    .then(r => storeMem.has(k) ? storeMem.get(k) : r.ok && typeof r.value === 'string' ? r.value : null)
    .catch(() => storeMem.has(k) ? storeMem.get(k) : null);
}

// forget the picture under an id → true (false for a bad id, or when IndexedDB refused to delete it)
function storeImageDelete(id) {
  const k = storeKey(id);
  if (k === null) return Promise.resolve(false);
  return storeRun('readwrite', s => s.delete(k)).then(r => { storeMem.delete(k); return r.ok || !r.db; }).catch(() => { storeMem.delete(k); return true; });
}

// the ids of every picture kept → [ids], sorted
function storeImageIds() {
  return storeRun('readonly', s => s.getAllKeys()).then(r => {
    const ids = new Set(r.ok && Array.isArray(r.value) ? r.value.map(String) : []);
    for (const k of storeMem.keys()) ids.add(k);
    return [...ids].sort();
  }).catch(() => [...storeMem.keys()].sort());
}

// → true when pictures outlive the page: IndexedDB is open and holds every one of them
function storeImagesDurable() { return storeOpen().then(db => !!db && storeMem.size === 0).catch(() => false); }
