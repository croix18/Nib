// Runs the pass/fail suites one after another: one line per suite (its result, its time, its last line), then a summary;
// exits 1 if any failed. Each suite's whole output goes to test/shots/logs/<suite>.log, and a failed suite's last
// lines are printed under it.
//   node test/run.js [--browser] [--verbose] [suite ...]      (npm test, npm run test:browser)
//   --browser   the suites in a real browser (Chrome at $CHROME, default /usr/bin/google-chrome) instead of the node ones
//   --verbose   show each suite's output as it runs
//   suite       only these (e.g. node test/run.js solve_check store_check)
// The node suites need the data sets (npm run data) and the npm packages (npm ci); see docs/HANDOFF.md, Files.
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');

const NODE = ['check', 'solve_check', 'neat_check', 'shapes_check', 'scribble_check', 'store_check', 'pdf_check', 'replicator_check',
  'font_check', 'font_check.py'];
// replicator_browser opens the fonts font_check writes, so font_check runs first when they are not there
const BROWSER = ['browser', 'pad_browser', 'views_browser', 'fringe_browser', 'embed_browser', 'looks_browser', 'canvas_browser',
  'paper_browser', 'shapes_browser', 'store_browser', 'scribble_browser', 'board_browser', 'board_canvas_browser', 'replicator_browser'];

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const all = args.includes('--browser') ? BROWSER : NODE;
const only = args.filter(a => !a.startsWith('--')).map(a => a.replace(/\.js$/, ''));
const bad = only.filter(n => !NODE.includes(n) && !BROWSER.includes(n));
if (bad.length) { console.log('no such suite: ' + bad.join(', ') + '\nnode: ' + NODE.join(' ') + '\nbrowser: ' + BROWSER.join(' ')); process.exit(2); }
const suites = only.length ? only : all;
const LOGS = path.join(__dirname, 'shots', 'logs');
fs.mkdirSync(LOGS, { recursive: true });
if (!fs.existsSync(path.join(__dirname, '..', 'dist', 'nib.js'))) { console.log('no dist/nib.js: run npm run build'); process.exit(1); }

function runOne(name) {
  return new Promise(resolve => {
    const py = name.endsWith('.py');
    const cmd = py ? 'python3' : process.execPath, file = path.join(__dirname, py ? name : name + '.js');
    const t0 = Date.now();
    const child = spawn(cmd, [file], { cwd: path.join(__dirname, '..'), env: process.env });
    const log = fs.createWriteStream(path.join(LOGS, name.replace(/\.py$/, '_py') + '.log'));
    let tail = '';
    const take = d => { log.write(d); if (VERBOSE) process.stdout.write(d); tail = (tail + d).slice(-8000); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    child.on('error', e => take(String(e) + '\n'));
    child.on('close', (code, signal) => {
      log.end();
      const lines = tail.trimEnd().split('\n');
      resolve({ name, ok: code === 0, code: signal || code, s: (Date.now() - t0) / 1000, last: lines[lines.length - 1].trim(), lines });
    });
  });
}

(async () => {
  const results = [];
  if (suites.includes('replicator_browser') && !fs.existsSync(path.join(__dirname, 'shots', 'fonts')) && !suites.includes('font_check')) {
    const r = await runOne('font_check');
    console.log(`${r.ok ? 'made' : 'could not make'} the fonts replicator_browser opens (font_check, ${r.s.toFixed(1)} s)`);
  }
  for (const name of suites) {
    const r = await runOne(name);
    results.push(r);
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ${(r.s.toFixed(1) + ' s').padStart(8)}   ${r.last.slice(0, 110)}`);
    if (!r.ok && !VERBOSE) console.log(r.lines.slice(-15).map(l => '      | ' + l).join('\n') + `\n      (exit ${r.code}; all of it in test/shots/logs/${name.replace(/\.py$/, '_py')}.log)`);
  }
  const failed = results.filter(r => !r.ok), total = results.reduce((t, r) => t + r.s, 0);
  console.log(`\n${results.length - failed.length} of ${results.length} suites passed in ${(total / 60).toFixed(1)} min` +
    (failed.length ? '; failed: ' + failed.map(r => r.name).join(', ') : ''));
  process.exit(failed.length ? 1 : 0);
})();
