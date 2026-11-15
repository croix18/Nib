// The comparison tools in tools/verify (they compare this engine with another one, so they are not a suite) still
// work, and the 1.6.7 references they compare against are intact:
//   1. every reference file (tools/verify/gold-1.6.7, gzipped) is what its SHA256 line says
//   2. readall.js reads a slice of two corpora with the engine in dist/ and cmp.js finds them the same as 1.6.7's
//      readings (matched by each expression's place in its corpus); a reading doctored on purpose is found
//   3. cmpsess.js: a recorded session against itself differs nowhere; a doctored reading is found; a confidence
//      moved in its seventh digit is counted apart
//   node test/verify_check.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), V = path.join(ROOT, 'tools', 'verify'), GOLD = path.join(V, 'gold-1.6.7');
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (c) passes++; else fails++; };
const run = (file, args, env) => spawnSync(process.execPath, [path.join(V, file), ...args], { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-verify-'));

// ------------------------------------------------------------------ 1. the references
{
  const lines = fs.readFileSync(path.join(GOLD, 'SHA256'), 'utf8').trim().split('\n');
  let bad = 0, rows = 0;
  for (const l of lines) {
    const [sum, name, n] = l.split(/\s+/);
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(GOLD, name + '.gz')));
    if (crypto.createHash('sha256').update(raw).digest('hex') !== sum || raw.toString('utf8').trim().split('\n').length !== +n) bad++;
    rows += +n;
  }
  const have = ['readings', 'sessions'].reduce((k, d) => k + fs.readdirSync(path.join(GOLD, d)).length, 0);
  ok(bad === 0 && lines.length === have, `the 1.6.7 references: ${lines.length} files, ${rows} lines, each what its SHA256 line says (${bad} wrong, ${have} files there)`);
}

// ------------------------------------------------------------------ 2. readall.js and cmp.js
{
  const out = path.join(tmp, 'r'); fs.mkdirSync(out);
  const a = run('readall.js', [path.join(ROOT, 'dist', 'nib.js'), path.join(__dirname, 'school_synth.jsonl'), path.join(out, 'school.jsonl'), '10', '3']);
  const n = fs.existsSync(path.join(out, 'school.jsonl')) ? fs.readFileSync(path.join(out, 'school.jsonl'), 'utf8').trim().split('\n').length : 0;
  ok(a.status === 0 && n === 70, `readall.js: every tenth school problem read with dist/nib.js (${n})`);
  const c = run('cmp.js', [path.join(GOLD, 'readings'), out]);
  ok(c.status === 0 && /TOTAL 70: latex 0, symbols 0, answers 0, candidate lists 0/.test(c.stdout), `cmp.js: the same as 1.6.7 read them (${(c.stdout.trim().split('\n').pop() || '').slice(0, 110)})`);
  // on the JavaScript path too
  const j = run('readall.js', [path.join(ROOT, 'dist', 'nib.js'), path.join(__dirname, 'school_synth.jsonl'), path.join(out, 'school.jsonl'), '50', '7'], { KERNEL: 'js' });
  const cj = run('cmp.js', [path.join(GOLD, 'readings'), out]);
  ok(j.status === 0 && cj.status === 0 && /TOTAL 14: latex 0, symbols 0, answers 0, candidate lists 0/.test(cj.stdout), 'and with KERNEL=js (every fiftieth)');
  // a reading changed on purpose
  const rows = fs.readFileSync(path.join(out, 'school.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  rows[3].latex += '+1'; rows[5].ans = ['7'];
  fs.writeFileSync(path.join(out, 'school.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const d = run('cmp.js', [path.join(GOLD, 'readings'), out]);
  ok(d.status === 1 && /TOTAL 14: latex 1, symbols 0, answers 1, candidate lists 0/.test(d.stdout), 'a reading and an answer changed on purpose are found (exit 1)');
  const none = run('cmp.js', [path.join(GOLD, 'readings'), tmp]);
  ok(none.status === 2, 'nothing to compare is said, not passed (exit 2)');
}

// ------------------------------------------------------------------ 3. cmpsess.js
{
  const ref = path.join(GOLD, 'sessions', 's3.jsonl.gz');
  const same = run('cmpsess.js', [ref, ref]);
  ok(same.status === 0 && /66 steps: 0 differ/.test(same.stdout), 'cmpsess.js: a recorded session against itself differs nowhere');
  const rows = zlib.gunzipSync(fs.readFileSync(ref)).toString('utf8').trim().split('\n').map(JSON.parse);
  rows[10].latex += 'x'; rows[20].conf += 1e-6; rows[30].answers = rows[30].answers.concat(['changed']);
  const doctored = path.join(tmp, 's3.jsonl'); fs.writeFileSync(doctored, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const d = run('cmpsess.js', [ref, doctored]);
  ok(d.status === 1 && /66 steps: 2 differ \(and 1 where only the confidence moved/.test(d.stdout), `a reading and the answers changed on purpose are found, a confidence moved in its seventh digit counted apart (${(d.stdout.trim().split('\n').pop() || '').slice(0, 90)})`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
