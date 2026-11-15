// Parent: runs child.js over a case file with a watchdog; a case that takes longer than LIMIT ms is a hang (the child
// is killed and restarted after it). node run.js <cases.js> [limitMs=4000] [slowMs=400]
'use strict';
const REPO = require('path').join(__dirname, '..', '..');   // the repository
const { spawn } = require('child_process');
const path = require('path');
const NIB = process.env.NIB || REPO + '/dist/nib.js';
const file = path.resolve(process.argv[2]), LIMIT = +process.argv[3] || 4000, SLOW = +process.argv[4] || 400;
const res = { total: 0, ran: 0, threw: [], hung: [], slow: [], bad: [] };
function go(start) {
  return new Promise(resolve => {
    const ch = spawn(process.execPath, ['--stack-size=984', path.join(__dirname, 'child.js'), NIB, file, String(start)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '', cur = null, timer = null, errBuf = '', finished = false;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { if (cur) { res.hung.push(cur.name); ch.kill('SIGKILL'); } }, LIMIT); };
    ch.stderr.on('data', d => { errBuf += d; });
    ch.stdout.on('data', d => {
      buf += d; let k;
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k); buf = buf.slice(k + 1);
        let o; try { o = JSON.parse(line); } catch (e) { continue; }
        if (o.total) res.total = o.total;
        else if (o.start !== undefined) { cur = { i: o.start, name: o.name }; arm(); }
        else if (o.end !== undefined) {
          res.ran++;
          if (o.err) res.threw.push(cur.name + '  →  ' + o.err);
          if (o.bad) res.bad.push(cur.name + '  →  ' + o.bad + '   out=' + String(o.out).slice(0, 160));
          if (o.ms > SLOW) res.slow.push(cur.name + '  ' + o.ms + ' ms');
          cur = null; clearTimeout(timer);
        } else if (o.done) finished = true;
      }
    });
    ch.on('exit', (code, sig) => {
      clearTimeout(timer);
      if (finished) return resolve(null);
      if (cur) {                         // died or was killed inside a case
        if (sig !== 'SIGKILL') res.threw.push(cur.name + '  →  PROCESS DIED (' + (sig || code) + ') ' + errBuf.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 300));
        return resolve(cur.i + 1);
      }
      console.log('child exited early', code, sig, errBuf.slice(0, 500)); resolve(null);
    });
  });
}
(async () => {
  let next = 0;
  while (next !== null) next = await go(next);
  const show = (t, a, n = 40) => { console.log(`\n${t}: ${a.length}`); for (const x of a.slice(0, n)) console.log('   ' + x.slice(0, 420)); if (a.length > n) console.log('   … ' + (a.length - n) + ' more'); };
  require('fs').writeFileSync(process.env.OUT || require('path').join(require('os').tmpdir(), 'nib-fuzz-last.json'), JSON.stringify(res)); console.log(`cases ${res.total}, ran ${res.ran}`);
  show('THREW', res.threw); show('HUNG (> ' + LIMIT + ' ms)', res.hung); show('SLOW (> ' + SLOW + ' ms)', res.slow, 25); show('BAD RESULT', res.bad);
})();
