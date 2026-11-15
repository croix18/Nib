// npm run lint: the sources checked for the mistakes a test only finds if it happens to run that line: a name that
// does not exist, a duplicate key, code that cannot be reached, a comparison with NaN, an assignment to a constant.
// Nothing about style. The engine is linted as build.py puts it together (src/*.js in one function scope, in the
// build's order), then the Board's script, the Replicator's core and the scripts inside the page templates; findings
// are given with the source file and line they are in.
//   node tools/lint.js        exits 1 on any error (warnings are printed, and do not fail it)
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let ESLint, js, globals;
try { ({ ESLint } = require('eslint')); js = require('@eslint/js'); globals = require('globals'); } catch (e) { console.log('lint: ESLint is not installed: run npm ci'); process.exit(1); }
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// the engine's sources, in the order build.py joins them (read from build.py, so the two cannot drift apart)
const m = /for f in \(((?:'[a-z]+\.js',?\s*)+)\)/.exec(read('build.py'));
if (!m) { console.log('lint: could not find the list of sources in build.py'); process.exit(1); }
const SRC = m[1].match(/[a-z]+\.js/g);

// pieces: {name, code, at(line) -> 'file:line'}
const pieces = [];
{
  const parts = ['(function NibEngine(global) {'], map = [null];          // map[bundle line - 1] = [file, line] (the wrapper named as build.py names it)
  for (const f of SRC) {
    const lines = read('src/' + f).replace(/^'use strict';$/m, '').split('\n');
    lines.forEach((l, i) => { parts.push(l); map.push(['src/' + f, i + 1]); });
  }
  parts.push("})(typeof window !== 'undefined' ? window : globalThis);");
  pieces.push({ name: 'the engine (src/*.js as built)', code: parts.join('\n'), at: n => (map[n - 1] ? map[n - 1][0] + ':' + map[n - 1][1] : 'engine:' + n) });
}
for (const f of ['board/board.js', 'replicator/core.js']) pieces.push({ name: f, code: read(f), at: n => f + ':' + n });
for (const f of ['board/template.html', 'replicator/template.html', 'demo/template.html']) {
  const html = read(f), re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let s, k = 0;
  while ((s = re.exec(html))) {
    if (/\bsrc=|json/.test(s[1]) || !s[2].trim() || /^\/\*[A-Z_]+\*\/$/.test(s[2].trim())) continue;   // a placeholder the build fills
    const first = html.slice(0, s.index + s[0].indexOf(s[2])).split('\n').length;
    pieces.push({ name: f + ' (script ' + ++k + ')', code: s[2], at: n => f + ':' + (first + n - 1) });
  }
}

const rules = Object.assign({}, js.configs.recommended.rules, {
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
  'no-empty': 'off', 'no-prototype-builtins': 'off', 'no-inner-declarations': 'off', 'no-control-regex': 'off',
  'no-irregular-whitespace': ['error', { skipStrings: true, skipComments: true, skipRegExps: true, skipTemplates: true }],
  'no-self-compare': 'error', 'no-unreachable-loop': 'error', 'no-constant-binary-expression': 'error', 'array-callback-return': 'error',
  'no-loss-of-precision': 'error', 'no-template-curly-in-string': 'error', 'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error',
});
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
  languageOptions: { ecmaVersion: 2022, sourceType: 'script',
    // module, require, Buffer: the engine also runs in node; Nib: the engine's global, for the pages; katex: the demo
    // page's, when the page carries it
    globals: Object.assign({}, globals.browser, { module: 'writable', require: 'readonly', globalThis: 'readonly', process: 'readonly', Buffer: 'readonly', Nib: 'readonly', katex: 'readonly' }) },
  linterOptions: { reportUnusedDisableDirectives: 'off' },
  rules,
}] });

(async () => {
  let errors = 0, warnings = 0;
  for (const p of pieces) {
    const [res] = await eslint.lintText(p.code, { filePath: path.join(ROOT, 'lint-piece.js') });
    for (const msg of res.messages) {
      const bad = msg.severity === 2 || msg.fatal;
      if (bad) errors++; else warnings++;
      console.log((bad ? 'ERROR ' : 'warn  ') + p.at(msg.line) + '  ' + msg.message + (msg.ruleId ? '  (' + msg.ruleId + ')' : ''));
    }
  }
  console.log(`lint: ${pieces.length} pieces, ${SRC.length} engine sources; ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`);
  process.exit(errors ? 1 : 0);
})();
