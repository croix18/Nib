// npm run kern: src/kern.wat (the classifier's kernel, WebAssembly text) assembled with the wabt package and written
// into src/kern.js with its loader (kernLoad, below: it is copied into src/kern.js as it is written here). src/kern.js is
// committed, so build.py needs nothing but the standard library; change the kernel or the loader here and run this.
//   node tools/build_kern.js           write src/kern.js
//   node tools/build_kern.js --check   exit 1 if src/kern.js is not what src/kern.wat and this loader make (CI runs it)
// The module must stay under 4,096 bytes: Chrome compiles a larger one on the main thread only asynchronously, and the
// engine loads it synchronously the first time it classifies.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), WAT = path.join(ROOT, 'src', 'kern.wat'), OUT = path.join(ROOT, 'src', 'kern.js');
const MAX_BYTES = 4096;

// ------------------------------------------------------------------ the loader (copied into src/kern.js, under NOTE)
const NOTE = `// The kernel for the model M, or null (said once with console.info) where it cannot be used: no WebAssembly, no SIMD,
// a Content-Security-Policy that forbids it, a model whose layers it does not take. The weights are copied into the
// module's memory once; the memory is laid out here and never grows. Each call below does one classification's part
// in that memory and gives back new arrays, as the JS path does.
`;
function kernLoad(M) {
  const say = why => { if (typeof console !== 'undefined' && console.info) console.info('Nib: the classifier runs in JavaScript (' + why + ')'); return null; };
  const L = M.L, convs = ['c0', 'c1', 'c2', 'c3', 'c4'], onls = L.o0 ? ['o0', 'o1', 'o2'] : [];
  // the shapes the kernel takes: those of convFeatures, onlineJS and fcJS in src/core.js, every channel count a multiple of 4
  // (and no more than 2,048 inputs to one output: the kernel lists them in the first 16 KiB of its memory)
  const LIST = 2048;
  let ci = 4, H = 32, big = 32 * 32 * 4;
  for (let i = 0; i < 5; i++) {
    const l = L[convs[i]];
    if (!l || l.co % 4 || l.w.length !== 9 * ci * l.co || 9 * ci > LIST) return say('a conv layer it does not take');
    big = Math.max(big, H * H * l.co); ci = l.co;
    if (i === 0 || i === 2 || i === 4) H >>= 1;
  }
  const nf = H * H * ci;
  let oc = ONF, obig = OK_ * ONF;
  for (const k of onls) {
    const l = L[k];
    if (!l || l.co % 4 || !(l.k % 2) || l.w.length !== l.k * oc * l.co || l.k * oc > LIST) return say('a trajectory layer it does not take');
    obig = Math.max(obig, OK_ * l.co); oc = l.co;
  }
  const no = onls.length ? 2 * oc : 0, nx = nf + no + 5, f1 = L.f1;
  if (!f1 || f1.co % 4 || f1.w.length !== nx * f1.co || nx > LIST) return say('a dense layer it does not take');
  let inst;
  try { inst = new WebAssembly.Instance(new WebAssembly.Module(b64bytes(KERN_WASM))); } catch (e) { return say(String(e && e.message || e)); }
  const E = inst.exports;
  // the memory, in floats (16-byte aligned), after the list: each layer's weights and bias, two activation buffers for
  // each branch, the dense layer's input (features, trajectory, scalars) and its output
  let top = 2 * LIST;
  const at = n => { const p = top; top += (n + 3) & ~3; return p; };
  const W = {}, B = {};
  for (const k of convs.concat(onls, ['f1'])) { W[k] = at(L[k].w.length); B[k] = at(L[k].co); }
  const A0 = at(big), A1 = at(big), O0 = at(obig), O1 = at(obig), X = at(nx), Y = at(f1.co);
  if (top * 4 > E.memory.buffer.byteLength) return say('the model does not fit its memory');
  const F = new Float32Array(E.memory.buffer);
  for (const k in W) { F.set(L[k].w, W[k]); F.set(L[k].b, B[k]); }
  // the conv stack from img, its features into X
  const conv = img => {
    F.set(img, A0);
    let src = A0, dst = A1, H = 32, ci = 4;
    for (let i = 0; i < 5; i++) {
      const co = L[convs[i]].co;
      E.conv3(src * 4, H, H, ci, W[convs[i]] * 4, B[convs[i]] * 4, co, dst * 4);
      ci = co; [src, dst] = [dst, src];
      if (i === 0 || i === 2 || i === 4) {
        const to = i === 4 ? X : dst, cb = ci * 4;
        E.pool(src * 4, H >> 1, H >> 1, ci, to * 4, 2 * cb, 2 * H * cb, cb, H * cb);
        H >>= 1; dst = src; src = to;
      }
    }
  };
  // the trajectory branch from its features f, pooled; its 2 * ci numbers into X after the conv features
  const online = f => {
    F.set(f, O0);
    let T = OK_, ci = ONF;
    E.conv1(O0 * 4, T, ci, W.o0 * 4, B.o0 * 4, L.o0.co, L.o0.k, O1 * 4); ci = L.o0.co;
    E.conv1(O1 * 4, T, ci, W.o1 * 4, B.o1 * 4, L.o1.co, L.o1.k, O0 * 4); ci = L.o1.co;
    E.pool(O0 * 4, T >> 1, 1, ci, O1 * 4, 0, 2 * ci * 4, ci * 4, 0); T >>= 1;
    E.conv1(O1 * 4, T, ci, W.o2 * 4, B.o2 * 4, L.o2.co, L.o2.k, O0 * 4); ci = L.o2.co;
    const g = onlinePool(F, O0, T, ci);
    F.set(g, X + nf);
    return g;
  };
  // the first dense layer over X with the scalars put in, then the rest in JS (fcOut)
  const dense = scal => {
    F.set(scal, X + nf + no);
    E.dense(X * 4, nx, W.f1 * 4, B.f1 * 4, f1.co, Y * 4);
    return fcOut(F.slice(Y, Y + f1.co));
  };
  return {
    conv(img) { conv(img); return F.slice(X, X + nf); },
    online(f) { return online(f); },
    fc(feat, scal, onl) {
      if (feat.length !== nf || (onl ? onl.length : 0) !== no || scal.length !== 5) return fcJS(feat, scal, onl);
      F.set(feat, X); if (onl) F.set(onl, X + nf);
      return dense(scal);
    },
    classify(img, f, scal) { conv(img); if (no) online(f); return dense(scal); },
  };
}

// ------------------------------------------------------------------ assemble, write or check
async function assemble() {
  let wabt;
  try { wabt = await require('wabt')(); } catch (e) { console.log('build_kern: the wabt package is not installed: run npm ci'); process.exit(1); }
  const mod = wabt.parseWat('kern.wat', fs.readFileSync(WAT, 'utf8'), { simd: true });
  mod.resolveNames(); mod.validate();
  const bin = Buffer.from(mod.toBinary({ log: false, write_debug_names: false }).buffer);
  mod.destroy();
  new WebAssembly.Module(bin);                    // node compiles it, so a browser with SIMD will
  return bin;
}
function source(bin) {
  return '// Written by tools/build_kern.js (npm run kern) from src/kern.wat: do not edit. The classifier\'s kernel, ' + bin.length + ' bytes of\n' +
    '// WebAssembly with SIMD, and its loader (see "The classifier\'s arithmetic" in src/core.js, and docs/HANDOFF.md, Speed (1.7.0)).\n' +
    "'use strict';\n" +
    "const KERN_WASM = '" + bin.toString('base64') + "';\n\n" +
    NOTE + kernLoad.toString() + '\n';
}
if (require.main === module) {
  (async () => {
    const bin = await assemble();
    if (bin.length >= MAX_BYTES) { console.log(`build_kern: the kernel is ${bin.length} bytes; it must stay under ${MAX_BYTES} (Chrome's limit for compiling on the main thread)`); process.exit(1); }
    const src = source(bin);
    if (process.argv.includes('--check')) {
      const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
      if (have !== src) { console.log('build_kern: src/kern.js is not what src/kern.wat and tools/build_kern.js make: run npm run kern'); process.exit(1); }
      console.log(`src/kern.js is what src/kern.wat assembles to (${bin.length} bytes)`);
    } else {
      fs.writeFileSync(OUT, src);
      console.log(`src/kern.js: ${bin.length} bytes of WebAssembly`);
    }
  })().catch(e => { console.log('build_kern: ' + (e && e.message || e)); process.exit(1); });
}
module.exports = { assemble, source, MAX_BYTES };
