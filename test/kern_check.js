// The classifier's kernel (1.7.0; docs/HANDOFF.md, Speed (1.7.0)):
//   1. it is in the engine, under 4,096 bytes, and src/kern.js is what src/kern.wat assembles to; node uses it
//   2. the kernel and the JS path give the same bits (conv features, trajectory vector, hidden layer, probabilities)
//      for thousands of stroke groups cut from the school problems: single symbols and the runs of 2, 3 and 4 strokes
//      the segmentation tries, each at several sizes
//   3. the JS path is taken, quietly, where WebAssembly is missing or will not compile
//   4. the kernel is at least 4 times as fast as the JS path on the conv stack
//   node test/kern_check.js
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { npm } = require('./data');
npm('wabt');
const Nib = require(path.join(ROOT, 'dist', 'nib.js'));
const K = require(path.join(ROOT, 'tools', 'build_kern.js'));
const I = Nib._internals;
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (c) passes++; else fails++; };
const section = n => console.log('\n' + n);
const rows = fs.readFileSync(path.join(__dirname, 'school_synth.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
// how many numbers of a and b differ: the same bits (Object.is), or a zero for a zero
const differ = (a, b) => {
  if (!a || !b || a.length !== b.length) return Infinity;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i]) && !(a[i] === 0 && b[i] === 0)) n++;
  return n;
};

(async () => {
  // ================================================================== 1
  section('1. the kernel is in the engine, small, and what its source assembles to');
  {
    const bin = await K.assemble(), want = K.source(bin);
    const have = fs.readFileSync(path.join(ROOT, 'src', 'kern.js'), 'utf8');
    ok(bin.length < K.MAX_BYTES, `the module is ${bin.length} bytes (under ${K.MAX_BYTES}: Chrome compiles it on the main thread)`);
    ok(have === want, 'src/kern.js is what src/kern.wat and tools/build_kern.js make');
    const dist = fs.readFileSync(path.join(ROOT, 'dist', 'nib.js'), 'utf8');
    ok(dist.includes("const KERN_WASM = '" + bin.toString('base64') + "';"), 'dist/nib.js carries those bytes');
    ok(Nib.kernel === 'simd', `Nib.kernel in node: ${Nib.kernel}`);
    ok((() => { try { Nib.kernel = 'js'; } catch (e) { /* read-only */ } return Nib.kernel === 'simd'; })(), 'Nib.kernel is read-only');
    ok(I.kernelUse('js') === 'js' && Nib.kernel === 'js' && I.kernelUse('simd') === 'simd' && I.kernelUse('auto') === 'simd', "kernelUse('js' | 'simd' | 'auto') switches the path");
    ok((() => { try { I.kernelUse('fast'); return false; } catch (e) { return /kernelUse/.test(e.message); } })(), 'kernelUse refuses anything else');
  }

  // ================================================================== 2
  section('2. the kernel and the JS path agree to the bit');
  {
    // the stroke groups: every run of 1 to 4 consecutive strokes (as the segmentation tries them) of every 6th
    // problem, read against the problem's size and against half and twice it
    const groups = [];
    rows.forEach((r, ri) => {
      if (ri % 6) return;
      const ref = I.refSize(r.strokes);
      for (let i = 0; i < r.strokes.length; i++) for (let n = 1; n <= 4 && i + n <= r.strokes.length; n++) {
        const g = r.strokes.slice(i, i + n);
        groups.push({ g, ref: [ref, ref / 2, ref * 2][(i + n) % 3] });
      }
    });
    const counts = [0, 0, 0, 0];
    for (const x of groups) counts[x.g.length - 1]++;
    const bad = { conv: 0, online: 0, hidden: 0, probs: 0, classify: 0 }, numbers = { conv: 0, online: 0, hidden: 0, probs: 0 };
    const first = [];
    let classified = 0;
    groups.forEach(({ g, ref }, gi) => {
      const { img, scal } = I.rasterize(g, ref), f = I.onlineFeatures(g, ref), whole = gi % 8 === 0;
      I.kernelUse('simd');
      const ck = I.convFeatures(img), ok_ = I.onlineBranch(f), pk = I.fcProbs(ck, scal, ok_), gk = whole && I.classifyGroup(g, ref);
      I.kernelUse('js');
      const cj = I.convFeatures(img), oj = I.onlineBranch(f), pj = I.fcProbs(cj, scal, oj), gj = whole && I.classifyGroup(g, ref);
      const d = { conv: differ(ck, cj), online: differ(ok_, oj), hidden: differ(pk.hidden, pj.hidden), probs: differ(pk, pj), classify: whole ? differ(gk, gj) + differ(gk.hidden, gj.hidden) : 0 };
      if (whole) classified++;
      for (const k in d) { bad[k] += d[k]; if (d[k] && first.length < 5) first.push(`${g.length} strokes, ref ${ref.toFixed(1)}: ${k} differs in ${d[k]}`); }
      numbers.conv += ck.length; numbers.online += ok_.length; numbers.hidden += pk.hidden.length; numbers.probs += pk.length;
    });
    I.kernelUse('auto');
    ok(groups.length >= 3000, `${groups.length} stroke groups (${counts.map((c, i) => c + ' of ' + (i + 1)).join(', ')} strokes)`);
    ok(!bad.conv, `conv features: ${bad.conv} of ${numbers.conv} differ`);
    ok(!bad.online, `trajectory vector: ${bad.online} of ${numbers.online} differ`);
    ok(!bad.hidden, `hidden layer: ${bad.hidden} of ${numbers.hidden} differ`);
    ok(!bad.probs, `probabilities: ${bad.probs} of ${numbers.probs} differ`);
    ok(!bad.classify, `classifyGroup on ${classified} of them (probabilities and embedding): ${bad.classify} numbers differ`);
    for (const l of first) console.log('      ' + l);
  }

  // ================================================================== 3
  section('3. where WebAssembly cannot run, the JS path, quietly');
  {
    const g = rows[0].symbols[0].strokes.map(i => rows[0].strokes[i]), ref = I.refSize(rows[0].strokes);
    I.kernelUse('simd'); const want = I.classifyGroup(g, ref);
    const info = console.info, warn = console.warn, said = [], warned = [];
    console.info = (...a) => said.push(a.join(' ')); console.warn = (...a) => warned.push(a.join(' '));
    const WA = globalThis.WebAssembly;
    try {
      delete globalThis.WebAssembly;
      const k1 = I.kernelUse('auto'), p1 = I.classifyGroup(g, ref);
      ok(k1 === 'js' && Nib.kernel === 'js' && !differ(p1, want), `no WebAssembly: ${k1}, and the same probabilities`);
      ok(said.length === 1 && /JavaScript/.test(said[0]) && !warned.length, `said once with console.info (${JSON.stringify(said[0])}), no warning`);
      ok((() => { try { I.kernelUse('simd'); return false; } catch (e) { return true; } })(), "kernelUse('simd') throws where the kernel cannot be loaded");
      said.length = 0;
      globalThis.WebAssembly = Object.assign(Object.create(WA), { Module: function () { throw new WA.CompileError('WebAssembly.Module(): Compiling function failed: Wasm SIMD unsupported'); } });
      const k2 = I.kernelUse('auto'), p2 = I.classifyGroup(g, ref);
      ok(k2 === 'js' && !differ(p2, want), `compiling throws: ${k2}, and the same probabilities`);
      ok(said.length === 1 && /SIMD unsupported/.test(said[0]), `said once: ${JSON.stringify(said[0])}`);
      said.length = 0;
      globalThis.WebAssembly = Object.assign(Object.create(WA), { Module: WA.Module, Instance: function () { throw new Error('Refused to compile or instantiate WebAssembly module because \'unsafe-eval\' is not an allowed source'); } });
      const k3 = I.kernelUse('auto');
      ok(k3 === 'js' && said.length === 1, `instantiating throws (a Content-Security-Policy): ${k3}`);
    } finally {
      globalThis.WebAssembly = WA; console.info = info; console.warn = warn;
    }
    ok(I.kernelUse('auto') === 'simd', 'WebAssembly back: the kernel again');
  }

  // ================================================================== 4
  section('4. the kernel is fast');
  {
    const imgs = [];
    for (const r of rows.slice(0, 120)) { const ref = I.refSize(r.strokes); for (const y of r.symbols) imgs.push(I.rasterize(y.strokes.map(i => r.strokes[i]), ref).img); }
    const S = imgs.slice(0, 200);
    const time = () => { const t0 = process.hrtime.bigint(); for (const im of S) I.convFeatures(im); return Number(process.hrtime.bigint() - t0) / 1e6 / S.length; };
    let best = { simd: Infinity, js: Infinity };
    for (let rep = 0; rep < 3; rep++) for (const k of ['simd', 'js']) { I.kernelUse(k); best[k] = Math.min(best[k], time()); }
    I.kernelUse('auto');
    const ratio = best.js / best.simd;
    ok(ratio >= 4, `the conv stack over ${S.length} symbols: kernel ${best.simd.toFixed(2)} ms, JS ${best.js.toFixed(2)} ms a symbol (${ratio.toFixed(1)} times; at least 4)`);
  }

  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
