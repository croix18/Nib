// A scripted session on a board pad, the same for any engine: what the pad reads, answers and lays out after every
// step, one JSON line per step. Two engines that read alike give the same file (cmpsess.js).
//   node tools/verify/session.js <engine.js> <out.jsonl> [seed=1] [exprs=40] [steps=40] [padAttrs=''] [script run in the page first]
// The steps use only the pad's own methods (addElement, setState, undo, relabel, …), with points that carry no time,
// and wait for the pad to come to rest after each one, so the order of the reads does not depend on how fast they are.
'use strict';
const REPO = require('path').join(__dirname, '..', '..'), T = require(REPO + '/test/data');   // the repository, and where its tests find packages and Chrome
const fs = require('fs'), path = require('path'), os = require('os');
const puppeteer = require(T.npm('puppeteer-core'));
const [engine, out, seedArg, exprArg, stepArg, attrArg, initArg] = process.argv.slice(2);
const SEED = +(seedArg || 1), EXPRS = +(exprArg || 40), STEPS = +(stepArg || 40), ATTRS = attrArg || '';
const rows = fs.readFileSync(REPO + '/test/school_synth.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nibsess-'));
  const html = path.join(dir, 'page.html');
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}nib-pad{display:block;width:1400px;height:900px}</style>
<nib-pad id="pad" view="ink" settle="0" delay="30" separate times="false" reveal solve infinite paper="dots" ${ATTRS}></nib-pad>
<script>${fs.readFileSync(engine, 'utf8').replace(/<\/script/g, '<\\/script')}</script>`);
  const browser = await puppeteer.launch({ executablePath: T.needChrome(), headless: true, userDataDir: dir, protocolTimeout: 0, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (/error|warn/.test(m.type())) errors.push(m.type() + ': ' + m.text()); });
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto('file://' + html, { waitUntil: 'load' });
  if (initArg) await page.evaluate(initArg);              // a line of script run in the page first, e.g. "Nib._internals.poolUse(0)"
  const t0 = Date.now();
  const lines = await page.evaluate(async (rows, SEED, EXPRS, STEPS) => {
    const el = document.getElementById('pad');
    for (let i = 0; i < 200 && !el.pad; i++) await new Promise(r => setTimeout(r, 20));
    const P = el.pad;
    let seed = SEED >>> 0; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const pick = a => a[Math.floor(rnd() * a.length)];
    let lastEmit = performance.now(), emits = 0, partials = 0;
    el.addEventListener('nib:result', e => { lastEmit = performance.now(); emits++; if (e.detail && e.detail.partial) partials++; });
    const settled = () => { const ink = P.ink, rs = P.resultStrokes || []; return !ink.length ? !P.result || !rs.length : !!P.result && !P.result.partial && rs.length === ink.length && rs.every((s, k) => s === ink[k]); };
    const rest = async () => { const t = performance.now(); for (;;) { await new Promise(r => setTimeout(r, 40)); const now = performance.now(); if (settled() && now - lastEmit > 400 && now - t > 400) return; if (now - t > 600000) throw new Error('did not come to rest'); } };
    // an expression of the corpus, at a place on the board; every fifth with its right part pushed away (a gap in the line)
    const place = (k, col, row, gap) => {
      const r = rows[(k * 7 + SEED * 13) % rows.length]; let x0 = Infinity, y0 = Infinity, y1 = -Infinity;
      for (const s of r.strokes) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      const st = r.strokes.map(s => s.map(p => [(p[0] - x0) * 0.7 + 60 + col * 900, (p[1] - y0) * 0.7 + 400 + row * 260]));
      if (gap && st.length > 3) {
        const bx = st.map(s => [Math.min(...s.map(p => p[0])), Math.max(...s.map(p => p[0]))]);
        const order = bx.map((b, i) => i).sort((a, b) => bx[a][0] - bx[b][0]);
        let cut = -1, best = -Infinity, reach = bx[order[0]][1];
        for (let q = 1; q < order.length; q++) { const g = bx[order[q]][0] - reach; if (g > best) { best = g; cut = q; } reach = Math.max(reach, bx[order[q]][1]); }
        const H = (y1 - y0) * 0.7, right = new Set(order.slice(cut));
        st.forEach((s, i) => { if (right.has(i)) for (const p of s) p[0] += 1.3 * H; });
      }
      return st;
    };
    const digest = step => {
      const res = P.result, rs = P.resultStrokes || [], ink = P.ink, at = new Map(ink.map((s, i) => [s, i]));
      const box = b => (b ? b.map(v => Math.round(v * 100) / 100) : null);
      return JSON.stringify({ step, n: ink.length,
        latex: res ? res.latex : null, text: res ? res.text : null, conf: res ? Math.round(res.confidence * 1e6) / 1e6 : null,
        syms: res ? res.symbols.map(s => s.label + ':' + s.strokes.map(i => at.get(rs[i])).join('.') + ':' + (s.candidates || []).slice(0, 3).map(c => c[0]).join('/')).join(' ') : null,
        parts: res && res.parts ? res.parts.map(p => p.idx.map(i => at.get(rs[i])).join('.') + '=' + (p.result ? p.result.latex : '')) : null,
        answers: (P.answers || []).map(a => [a.line, a.latex, a.kind, a.exact, a.value]), solved: P.solvedLatex(),
        plan: P.plan ? [P.plan.style, P.plan.items.map(it => [it.id, it.answer ? 1 : 0, it.hidden ? 1 : 0, box(it.box), it.revealKey || ''])] : null,
        faults: (P.faults || []).length });
    };
    const out = [];
    const mark = async name => { await rest(); out.push(digest(name)); };
    // the page: EXPRS expressions, four to a row
    const pageStrokes = []; for (let i = 0; i < EXPRS; i++) pageStrokes.push(...place(i, i % 4, Math.floor(i / 4), i % 5 === 4));
    P.setState({ strokes: pageStrokes });
    await mark('load');
    let next = EXPRS, wrote = 0;
    const partsNow = () => (P.result && P.result.parts ? P.result.parts.filter(p => p.strokes.length) : []);
    for (let k = 0; k < STEPS; k++) {
      const r = rnd();
      let name;
      if (r < 0.34) {                     // write an expression, a stroke at a time (now and then three strokes at once)
        const st = place(next, next % 4, Math.floor(next / 4), next % 3 === 0); next++; wrote++;
        name = 'write ' + st.length;
        for (let i = 0; i < st.length; i++) { P.addElement(st[i]); if (rnd() < 0.3 && i + 2 < st.length) { P.addElement(st[++i]); P.addElement(st[++i]); } await mark(name + '.' + i); }
        continue;
      } else if (r < 0.42) { const n = 1 + Math.floor(rnd() * 4); for (let i = 0; i < n; i++) P.undo(); name = 'undo ' + n; }
      else if (r < 0.48) { const n = 1 + Math.floor(rnd() * 4); for (let i = 0; i < n; i++) P.redo(); name = 'redo ' + n; }
      else if (r < 0.56) { const ps = partsNow(); if (!ps.length) continue; const p = pick(ps); P.select(p.strokes); P.nudgeSelection(Math.round((rnd() - 0.5) * 400), Math.round((rnd() - 0.5) * 200)); P.clearSelection(); name = 'nudge'; }
      else if (r < 0.62) { const ps = partsNow(); if (!ps.length) continue; const p = pick(ps); P.select(p.strokes); P.deleteSelection(); name = 'delete part'; }
      else if (r < 0.66) { const ps = partsNow(); if (!ps.length) continue; const p = pick(ps); P.select(p.strokes); P.duplicateSelection(); P.clearSelection(); name = 'duplicate part'; }
      else if (r < 0.74) { const res = P.result; if (!res || !res.symbols.length) continue; const s = pick(res.symbols); const c = (s.candidates || [])[1]; if (!c) continue; P.relabel(s, c[0]); name = 'relabel ' + s.label + '>' + c[0]; }
      else if (r < 0.80) { const o = pick([{ symbols: 'all' }, { symbols: 'school' }, { view: 'tidy' }, { view: 'ink' }, { view: 'hand' }, { solve: false }, { solve: true }, { degrees: false }, { degrees: true }]); P.setOptions(o); name = 'options ' + JSON.stringify(o); }
      else if (r < 0.88) { const c = pick([() => P.panBy(-300, -200), () => P.panBy(250, 300), () => P.zoomAt(0.6, 700, 450), () => P.zoomAt(1.5, 700, 450), () => P.fitContent()]); c(); name = 'camera'; }
      else if (r < 0.93) { const snap = P.snapshot(); P.clear(); await mark('clear'); P.restore(snap); name = 'restore'; }
      else { const st = P.getState(); P.setState(st); name = 'reload'; }
      await mark(name);
    }
    return { out, emits, partials, wrote };
  }, rows, SEED, EXPRS, STEPS);
  fs.writeFileSync(out, lines.out.join('\n') + '\n');
  console.log(`${path.basename(engine)} seed ${SEED}: ${lines.out.length} steps recorded (${lines.wrote} expressions written), ${lines.emits} readings announced (${lines.partials} partial), ${((Date.now() - t0) / 1000).toFixed(1)} s${errors.length ? ' | page said: ' + errors.slice(0, 3).join(' ;; ') : ''}`);
  await browser.close(); fs.rmSync(dir, { recursive: true, force: true });
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
