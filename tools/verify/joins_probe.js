// Does a board join every pair of pieces that belongs together, however many there are on the page?
// (Found on 15 November 2026, docs/reviews/found-2026-11-15.md: until 1.7.1 the pad's read asked joinOperands eight
// times a read, and joinOperands makes one join each time it is asked — so a page got eight joins and no more, and
// the pairs after the eighth stayed two pieces: read apart, two lines of the page's reading, selected and tidied
// apart.)
// Two pages are tried at several sizes, both made from the school sample:
//   sums       N sums that end in "=", each with a wide gap in its line ("26.20 − 17.15      =")
//   asked      N equations in one letter, written first, and then "letter =" under each (the way the Board is asked
//              for a solution, by someone who writes the questions after the equations)
// After the pad has read the page, joinOperands is asked about the pieces again until it has nothing more to join:
// the joins the read left undone. The answers on the page are counted against those each item gets when it is read
// alone. (They come out the same joined or not: the pad finds a sum's other half and an "x =" its equation by where
// they stand when it works out answers — _replan. The count is there so that a change to the joining cannot lose
// answers unseen.)
// Exit 1 when a page of 300 pieces or fewer is left with joins undone.
//   node tools/verify/joins_probe.js [sizes = 6,12,20,40] [engine = dist/nib.js]
'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(T.npm('puppeteer-core'));
const SIZES = (process.argv[2] || '6,12,20,40').split(',').map(Number);
const ENGINE = path.resolve(process.argv[3] || REPO + '/dist/nib.js'), Nib = require(ENGINE);
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').map(JSON.parse);

const box = st => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return [x0, y0, x1, y1]; };
const answerOf = latex => { const a = Nib.solve(latex).filter(Boolean); return a.length ? a[a.length - 1].latex : null; };
// equations in one letter that the engine reads right, with the strokes of the letter and of the equals sign
const eqs = [];
for (const r of rows) {
  if (!/^[0-9]*[a-z][+-][0-9]+=[0-9]+$/.test(r.latex)) continue;
  const res = Nib.recognize(r.strokes);
  if (res.latex !== r.latex) continue;
  const letter = res.symbols.find(s => /^[a-z]$/.test(s.label)), eq = res.symbols.find(s => s.label === '=');
  if (!letter || !eq) continue;
  const b = box(r.strokes), H = b[3] - b[1];
  // the question under it: the letter, then the equals sign, a line and a half lower
  const left = idx => Math.min(...idx.map(i => Math.min(...r.strokes[i].map(p => p[0])))), right = idx => Math.max(...idx.map(i => Math.max(...r.strokes[i].map(p => p[0]))));
  const ask = letter.strokes.map(i => r.strokes[i].map(p => [p[0] - left(letter.strokes) + b[0], p[1] + H * 1.6]))
    .concat(eq.strokes.map(i => r.strokes[i].map(p => [p[0] - left(eq.strokes) + b[0] + right(letter.strokes) - left(letter.strokes) + H * 0.35, p[1] + H * 1.6])));
  // read alone, the two are an equation and its question, with an answer
  const alone = Nib.recognize(r.strokes.concat(ask)), want = answerOf(alone.latex);
  if (alone.lines.length === 2 && alone.lines[0].latex === r.latex && want) eqs.push({ strokes: r.strokes, ask, want, eqStrokes: eq.strokes.map(i => r.strokes[i]) });
}
// sums that the engine reads right with an equals sign written after them, and answers
const sums = [];
if (eqs.length) for (const r of rows) {
  if (/=|[a-z]/.test(r.latex) || r.strokes.length < 4) continue;
  const b = box(r.strokes), H = b[3] - b[1], e = eqs[sums.length % eqs.length].eqStrokes, eb = box(e);
  const k = Math.min(1, 0.45 * H / Math.max(eb[2] - eb[0], 1));        // an equals sign no wider than half the line's height
  const sign = e.map(s => s.map(p => [b[2] + 0.4 * H + (p[0] - eb[0]) * k, (b[1] + b[3]) / 2 + (p[1] - (eb[1] + eb[3]) / 2) * k]));
  const all = r.strokes.concat(sign), res = Nib.recognize(all, { times: false }), want = answerOf(res.latex);
  if (res.latex === r.latex + '=' && want) sums.push({ strokes: all, want });
  if (sums.length >= 60) break;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nibjoins-'));
  fs.writeFileSync(path.join(dir, 'page.html'), `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}nib-pad{display:block;width:1400px;height:900px}</style>
<nib-pad id="pad" view="ink" settle="0" delay="30" auto="false" separate times="false" reveal solve infinite paper="dots"></nib-pad><script src="${ENGINE}"></script>`);
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, args: ['--no-sandbox'] });
  let early = 0;
  console.log(`Nib ${Nib.version}; ${sums.length} sums and ${eqs.length} equations of the school sample to make pages of`);
  for (const kind of ['sums', 'asked']) for (const N of SIZES) {
    const page = await browser.newPage(); await page.setViewport({ width: 1400, height: 900 });
    await page.goto('file://' + path.join(dir, 'page.html'), { waitUntil: 'load' });
    const r = await page.evaluate(async (kind, N, sums, eqs) => {
      const el = document.getElementById('pad'); for (let i = 0; i < 300 && !el.pad; i++) await new Promise(r => setTimeout(r, 20));
      const P = el.pad, I = Nib._internals, strokes = [], later = [], want = [];
      const box = st => { let x0 = Infinity, y0 = Infinity, y1 = -Infinity; for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } return [x0, y0, y1]; };
      for (let k = 0; k < N; k++) {
        if (kind === 'sums') {
          const r = sums[k % sums.length], [x0, y0, y1] = box(r.strokes);
          const st = r.strokes.map(s => s.map(p => [(p[0] - x0) * 0.7 + 60 + (k % 4) * 900, (p[1] - y0) * 0.7 + 400 + Math.floor(k / 4) * 260]));
          // the widest gap between its strokes made 1.3 heights wider
          const bx = st.map(s => [Math.min(...s.map(p => p[0])), Math.max(...s.map(p => p[0]))]), order = bx.map((b, i) => i).sort((a, b) => bx[a][0] - bx[b][0]);
          let cut = -1, best = -Infinity, reach = bx[order[0]][1];
          for (let q = 1; q < order.length; q++) { const g = bx[order[q]][0] - reach; if (g > best) { best = g; cut = q; } reach = Math.max(reach, bx[order[q]][1]); }
          const right = new Set(order.slice(cut)); st.forEach((s, i) => { if (right.has(i)) for (const p of s) p[0] += 1.3 * (y1 - y0) * 0.7; });
          strokes.push(...st); want.push(r.want);
        } else {
          const e = eqs[k % eqs.length], [x0, y0, y1] = box(e.strokes), ox = 60 + (k % 3) * 900 - x0, oy = 300 + Math.floor(k / 3) * ((y1 - y0) * 4 + 120) - y0;
          for (const s of e.strokes) strokes.push(s.map(p => [p[0] + ox, p[1] + oy]));
          for (const s of e.ask) later.push(s.map(p => [p[0] + ox, p[1] + oy]));       // the questions are written after all the equations
          want.push(e.want);
        }
      }
      P.setState({ strokes: strokes.concat(later) });
      const clusters = I.clustersOf(P.ink).length, parts = P.recognize().parts || [];
      // every join the read left undone: joinOperands asked until it has none (the pieces read as the pad reads them)
      let left = 0, now = parts.map(p => ({ idx: p.idx, strokes: p.strokes, result: p.result }));
      for (; left < 500; left++) {
        const joined = I.joinOperands(now); if (!joined) break;
        const old = new Map(now.map(p => [p.idx, p]));
        now = joined.map(g => old.get(g) || (() => { const st = g.map(i => P.ink[i]); return { idx: g, strokes: st, result: P._recFor(st[0]).recognize(st, Object.assign({}, P._ropts(), { fix: P._fixFor(st) })) }; })());
      }
      // the answers on the page against those each item has alone (each wanted answer counted once)
      const got = (P.answers || []).map(a => a.latex); let right = 0;
      for (const w of want) { const i = got.indexOf(w); if (i >= 0) { right++; got.splice(i, 1); } }
      return { clusters, parts: parts.length, left, right, answers: (P.answers || []).length };
    }, kind, N, sums, eqs);
    const bad = r.left > 0 && r.clusters <= 300;
    if (bad) early++;
    console.log(`${bad ? 'EARLY' : 'ok   '} ${String(N).padStart(3)} ${kind === 'sums' ? 'sums with a gap each' : 'equations, each asked "letter =" afterwards'}: ${r.clusters} clusters, ${r.clusters - r.parts} joined by the read, ${r.left} more left undone; ${r.right} of ${N} answered as when read alone (${r.answers} answers on the page)`);
    await page.close();
  }
  await browser.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(early ? `\non ${early} of these pages the read stopped joining early` : '\nevery page was joined to the end');
  process.exit(early ? 1 : 0);
})();
