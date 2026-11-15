// Runs fuzz cases start..end against dist/nib.js, one line of JSON per case on stdout (written synchronously so a hang
// leaves the START line behind). node child.js <nib.js> <cases.js> <start>
'use strict';
const fs = require('fs');
const Nib = require(process.argv[2]);
const cases = require(process.argv[3])(Nib);
const start = +process.argv[4] || 0;
const say = o => fs.writeSync(1, JSON.stringify(o) + '\n');
const brief = v => {
  try {
    if (v === undefined) return 'undefined';
    const s = JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? String(x) + 'n' : typeof x === 'number' && !Number.isFinite(x) ? 'NONFINITE:' + x : x));
    return s === undefined ? String(v) : s.length > 300 ? s.slice(0, 300) + '…(' + s.length + ')' : s;
  } catch (e) { return 'UNSERIALISABLE: ' + e.message; }
};
say({ total: cases.length });
for (let i = start; i < cases.length; i++) {
  const c = cases[i];
  say({ start: i, name: c.name });
  const t0 = process.hrtime.bigint();
  let out, err = null;
  try { out = c.run(); } catch (e) { err = (e && e.constructor && e.constructor.name) + ': ' + String(e && e.message).slice(0, 200) + ' @ ' + String(e && e.stack).split('\n').slice(1, 3).join(' | ').slice(0, 260); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  let bad = null;
  if (!err && c.check) { try { bad = c.check(out) || null; } catch (e) { bad = 'check threw: ' + e.message; } }
  say({ end: i, ms: Math.round(ms * 10) / 10, err, bad, out: err ? undefined : brief(out) });
}
say({ done: true });
