// Deckhand's own Playwright configuration, run with the system's Chrome — for a machine where Playwright's Chromium
// cannot be downloaded. This is how Deckhand 7.63.1's suite (Nib 1.7.0 inside) was run before it was pushed:
//   cd <Deckhand> && npm ci
//   TZ=UTC DECKHAND_DIR=$PWD npx playwright test -c <Nib>/tools/verify/deckhand/playwright.system-chrome.config.js
// (TZ=UTC: Deckhand's suite assumes it. Two workers by default — DH_WORKERS; a few of its tests are sensitive to
// load and pass alone, see Deckhand's docs/HANDOFF.md.)
const dir = process.env.DECKHAND_DIR || process.cwd();
const base = require(dir + '/playwright.config.js');
module.exports = { ...base, testDir: dir + '/tests', outputDir: require('os').tmpdir() + '/deckhand-results', workers: +(process.env.DH_WORKERS || 2),
  reporter: [['list']],
  projects: base.projects.map(p => ({ ...p, use: { ...p.use, channel: 'chrome', launchOptions: { args: ['--no-sandbox'] } } })),
  webServer: { ...base.webServer, cwd: dir } };
