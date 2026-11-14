// Where the tests find what is not in the repo, and one clear line when it is missing.
//   DATA          the data sets (NIB_DATA, default training/scratch/data/; `npm run data` makes them)
//   need(file)    a data file's path; stops the suite with "run npm run data" when it is not there
//   npm(name)     an npm package's path: NIB_NPM, then the root node_modules (`npm ci`), then demo/node_modules;
//                 stops with "run npm ci" when it is in none ({optional: true}: null instead)
//   CHROME        the Chrome the browser suites drive ($CHROME, default /usr/bin/google-chrome)
//   packagesFor(page)  a test page's ../node_modules/… files answered from NIB_NPM or demo/node_modules when the
//                 root node_modules does not have them (with npm ci it does, and the page loads them itself)
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = (process.env.NIB_DATA || path.join(ROOT, 'training', 'scratch', 'data')).replace(/\/?$/, '/');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';

function stop(msg) { console.log(msg); process.exit(1); }

function need(file) {
  const f = path.isAbsolute(file) ? file : DATA + file;
  if (!fs.existsSync(f)) stop(`missing data: ${f} (run npm run data${process.env.NIB_DATA ? ', or check NIB_DATA' : ''})`);
  return f;
}

function npm(name, opt) {
  const dirs = [process.env.NIB_NPM, path.join(ROOT, 'node_modules'), path.join(ROOT, 'demo', 'node_modules')].filter(Boolean);
  for (const d of dirs) if (fs.existsSync(path.join(d, name))) return path.join(d, name);
  if (opt && opt.optional) return null;
  stop(`missing npm package ${name} (run npm ci)`);
}

function needChrome() {
  if (!fs.existsSync(CHROME)) stop(`no Chrome at ${CHROME} (set CHROME to its path)`);
  return CHROME;
}

async function packagesFor(page) {
  const root = path.join(ROOT, 'node_modules');
  if (!process.env.NIB_NPM && fs.existsSync(path.join(root, '@fontsource'))) return;
  await page.setRequestInterception(true);
  page.on('request', r => {
    const m = /^file:\/\/.*?\/node_modules\/(.+)$/.exec(r.url());
    const f = m && npm(decodeURIComponent(m[1]), { optional: true });
    if (f && !f.startsWith(root + path.sep)) r.respond({ status: 200, contentType: f.endsWith('.woff2') ? 'font/woff2' : undefined, body: fs.readFileSync(f) });
    else r.continue();
  });
}

module.exports = { ROOT, DATA, CHROME, need, npm, needChrome, packagesFor };
