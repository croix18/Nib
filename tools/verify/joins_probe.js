// Does a board join every pair of pieces that belongs together, however many there are on the page?
// (Found on 15 November 2026, docs/reviews/found-2026-11-15.md: the pad's read asks joinOperands at most eight times a
// read, and joinOperands makes one join each time it is asked — so a page gets eight joins and no more.)
// Two pages are tried at several sizes:
//   lines      N school problems, each with a wide gap in its line (its right part pushed away)
//   asked      N equations in one letter, each with "letter =" written a line and a half under it (the way the Board is
//              asked for a solution)
// and after the pad has read the page, joinOperands is asked once more about the pieces it left: when it would still
// join two of them, the read stopped early. Exit 1 when that happens on any page.
//   node tools/verify/joins_probe.js [sizes = 6,12,20,40] [engine = dist/nib.js]
'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(T.npm('puppeteer-core'));
const SIZES = (process.argv[2] || '6,12,20,40').split(',').map(Number);
const ENGINE = path.resolve(process.argv[3] || REPO + '/dist/nib.js'), Nib = require(ENGINE);
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').map(JSON.parse);

// equations in one letter that the engine reads right, with the strokes of the letter and of the equals sign
const eqs = [];
for (const r of rows) {
  if (!/^[0-9]*[a-z][+-][0-9]+=[0-9]+$/.test(r.latex)) continue;
  const res = Nib.recognize(r.strokes);
  if (res.latex !== r.latex) continue;
  const letter = res.symbols.find(s => /^[a-z]$/.test(s.label)), eq = res.symbols.find(s => s.label === '=');
  if (letter && eq) eqs.push({ strokes: r.strokes, letter: letter.strokes, eq: eq.strokes });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nibjoins-'));
  fs.writeFileSync(path.join(dir, 'page.html'), `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}nib-pad{display:block;width:1400px;height:900px}</style>
<nib-pad id="pad" view="ink" settle="0" delay="30" auto="false" separate times="false" reveal solve infinite paper="dots"></nib-pad><script src="${ENGINE}"></script>`);
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, args: ['--no-sandbox'] });
  let early = 0;
  console.log(`Nib ${Nib.version}; ${eqs.length} equations to ask about`);
  for (const kind of ['lines', 'asked']) for (const N of SIZES) {
    const page = await browser.newPage(); await page.setViewport({ width: 1400, height: 900 });
    await page.goto('file://' + path.join(dir, 'page.html'), { waitUntil: 'load' });
    const r = await page.evaluate(async (kind, N, rows, eqs) => {
      const el = document.getElementById('pad'); for (let i = 0; i < 300 && !el.pad; i++) await new Promise(r => setTimeout(r, 20));
      const P = el.pad, I = Nib._internals, strokes = [];
      const box = st => { let x0 = Infinity, y0 = Infinity, y1 = -Infinity; for (const s of st) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } return [x0, y0, y1]; };
      for (let k = 0; k < N; k++) {
        if (kind === 'lines') {
          const r = rows[(k * 7 + 13) % rows.length], [x0, y0, y1] = box(r.strokes);
          const st = r.strokes.map(s => s.map(p => [(p[0] - x0) * 0.7 + 60 + (k % 4) * 900, (p[1] - y0) * 0.7 + 400 + Math.floor(k / 4) * 260]));
          if (st.length > 3) {                       // the widest gap between its strokes made 1.3 heights wider
            const bx = st.map(s => [Math.min(...s.map(p => p[0])), Math.max(...s.map(p => p[0]))]), order = bx.map((b, i) => i).sort((a, b) => bx[a][0] - bx[b][0]);
            let cut = -1, best = -Infinity, reach = bx[order[0]][1];
            for (let q = 1; q < order.length; q++) { const g = bx[order[q]][0] - reach; if (g > best) { best = g; cut = q; } reach = Math.max(reach, bx[order[q]][1]); }
            const right = new Set(order.slice(cut)); st.forEach((s, i) => { if (right.has(i)) for (const p of s) p[0] += 1.3 * (y1 - y0) * 0.7; });
          }
          strokes.push(...st);
        } else {
          const e = eqs[k % eqs.length], [x0, y0, y1] = box(e.strokes), H = y1 - y0, ox = 60 + (k % 3) * 900, oy = 300 + Math.floor(k / 3) * (H * 4 + 120);
          const put = (s, dx, dy) => s.map(p => [p[0] - x0 + ox + dx, p[1] - y0 + oy + dy]);
          const left = idx => Math.min(...idx.map(i => Math.min(...e.strokes[i].map(p => p[0])))), right = idx => Math.max(...idx.map(i => Math.max(...e.strokes[i].map(p => p[0]))));
          for (const s of e.strokes) strokes.push(put(s, 0, 0));
          for (const i of e.letter) strokes.push(put(e.strokes[i], x0 - left(e.letter), H * 1.6));
          for (const i of e.eq) strokes.push(put(e.strokes[i], x0 - left(e.eq) + right(e.letter) - left(e.letter) + H * 0.35, H * 1.6));
        }
      }
      P.setState({ strokes });
      const clusters = I.clustersOf(P.ink).length, parts = P.recognize().parts || [];
      // every join the read left undone: joinOperands asked until it has none (the pieces read as the pad reads them)
      let left = 0, now = parts.map(p => ({ idx: p.idx, strokes: p.strokes, result: p.result }));
      for (; left < 500; left++) {
        const joined = I.joinOperands(now); if (!joined) break;
        const old = new Map(now.map(p => [p.idx, p]));
        now = joined.map(g => old.get(g) || (() => { const st = g.map(i => P.ink[i]); return { idx: g, strokes: st, result: P._recFor(st[0]).recognize(st, Object.assign({}, P._ropts(), { fix: P._fixFor(st) })) }; })());
      }
      return { clusters, parts: parts.length, answers: (P.answers || []).length, left };
    }, kind, N, rows.map(r => ({ strokes: r.strokes })), eqs);
    if (r.left) early++;
    console.log(`${r.left ? 'EARLY' : 'ok   '} ${N} ${kind === 'lines' ? 'lines with a gap each' : 'equations each asked "letter ="'}: ${r.clusters} clusters, ${r.clusters - r.parts} joined by the read, ${r.left} more left undone; ${r.answers} answers`);
    await page.close();
  }
  await browser.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(early ? `\non ${early} of these pages the read stopped joining early` : '\nevery page was joined to the end');
  process.exit(early ? 1 : 0);
})();
