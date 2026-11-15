;; The classifier's kernel (1.7.0): the five 3x3 conv layers and their pools, the trajectory branch's three 1-D convs
;; and its pool, and the first dense layer, in WebAssembly with SIMD. tools/build_kern.js assembles this file into
;; src/kern.js (npm run kern), which carries the bytes and the loader; build.py only copies src/kern.js.
;;
;; The arithmetic is the one src/core.js defines (see "The classifier's arithmetic" there): float32 multiply, then
;; float32 add, each output element summed in the order of its terms in the JS (bias first; a 3x3 conv's taps in order
;; (ky, kx), within a tap the input channels in order; a zero input skipped), so the JS path and this one give the same
;; bits. Layouts are HWC (a pixel's channels next to each other); a weight row holds one input's co outputs. Every
;; channel count is a multiple of 4 (the loader does not use the kernel for a model where one is not). Pointers are
;; byte offsets into the memory. Its first 16 KiB are $mac's list (up to 2,048 inputs); the loader lays out the rest
;; once, and it never grows.
(module
  (memory (export "memory") 48)

  ;; out[0..co) = ReLU(b + the sum over r < rows, i < n of x[r * xrow + i] * w[r * wrow + i * ws][0..co)), in that
  ;; order (x in floats, the rest in bytes: xrow and wrow are byte steps, ws the bytes from one weight row to the next).
  ;; First the inputs that are not zero are listed at address 0 as (value, weight row offset), without a branch; then
  ;; each block of 24 outputs (and what is left, 4 at a time) is summed over that list in registers.
  (func $mac (param $out i32) (param $co i32) (param $b i32) (param $x i32) (param $n i32) (param $xrow i32)
             (param $w i32) (param $ws i32) (param $wrow i32) (param $rows i32)
    (local $e i32) (local $q i32) (local $p i32) (local $i i32) (local $xp i32) (local $wo i32) (local $wr i32) (local $wp i32)
    (local $v f32) (local $vv v128) (local $z v128)
    (local $a0 v128) (local $a1 v128) (local $a2 v128) (local $a3 v128) (local $a4 v128) (local $a5 v128)
    ;; the list
    (block $br (loop $lr
      (br_if $br (i32.eqz (local.get $rows)))
      (local.set $xp (local.get $x)) (local.set $wo (local.get $wr)) (local.set $i (local.get $n))
      (block $bi (loop $li
        (br_if $bi (i32.eqz (local.get $i)))
        (local.set $v (f32.load (local.get $xp)))
        (f32.store (local.get $q) (local.get $v))
        (i32.store offset=4 (local.get $q) (local.get $wo))
        (local.set $q (i32.add (local.get $q) (i32.shl (f32.ne (local.get $v) (f32.const 0)) (i32.const 3))))
        (local.set $xp (i32.add (local.get $xp) (i32.const 4)))
        (local.set $wo (i32.add (local.get $wo) (local.get $ws)))
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))
        (br $li)))
      (local.set $x (i32.add (local.get $x) (local.get $xrow)))
      (local.set $wr (i32.add (local.get $wr) (local.get $wrow)))
      (local.set $rows (i32.sub (local.get $rows) (i32.const 1)))
      (br $lr)))
    (local.set $e (i32.add (local.get $out) (i32.shl (local.get $co) (i32.const 2))))
    ;; blocks of 24 outputs, in six registers
    (block $d24 (loop $l24
      (br_if $d24 (i32.gt_u (i32.add (local.get $out) (i32.const 96)) (local.get $e)))
      (local.set $a0 (v128.load offset=0 (local.get $b))) (local.set $a1 (v128.load offset=16 (local.get $b)))
      (local.set $a2 (v128.load offset=32 (local.get $b))) (local.set $a3 (v128.load offset=48 (local.get $b)))
      (local.set $a4 (v128.load offset=64 (local.get $b))) (local.set $a5 (v128.load offset=80 (local.get $b)))
      (local.set $p (i32.const 0))
      (block $bk (loop $lk
        (br_if $bk (i32.ge_u (local.get $p) (local.get $q)))
        (local.set $vv (v128.load32_splat (local.get $p)))
        (local.set $wp (i32.add (local.get $w) (i32.load offset=4 (local.get $p))))
        (local.set $a0 (f32x4.add (local.get $a0) (f32x4.mul (local.get $vv) (v128.load offset=0 (local.get $wp)))))
        (local.set $a1 (f32x4.add (local.get $a1) (f32x4.mul (local.get $vv) (v128.load offset=16 (local.get $wp)))))
        (local.set $a2 (f32x4.add (local.get $a2) (f32x4.mul (local.get $vv) (v128.load offset=32 (local.get $wp)))))
        (local.set $a3 (f32x4.add (local.get $a3) (f32x4.mul (local.get $vv) (v128.load offset=48 (local.get $wp)))))
        (local.set $a4 (f32x4.add (local.get $a4) (f32x4.mul (local.get $vv) (v128.load offset=64 (local.get $wp)))))
        (local.set $a5 (f32x4.add (local.get $a5) (f32x4.mul (local.get $vv) (v128.load offset=80 (local.get $wp)))))
        (local.set $p (i32.add (local.get $p) (i32.const 8)))
        (br $lk)))
      ;; ReLU as the JS's `if (x < 0) x = 0`: a NaN or a -0 stays
      (v128.store offset=0 (local.get $out) (f32x4.pmax (local.get $a0) (local.get $z)))
      (v128.store offset=16 (local.get $out) (f32x4.pmax (local.get $a1) (local.get $z)))
      (v128.store offset=32 (local.get $out) (f32x4.pmax (local.get $a2) (local.get $z)))
      (v128.store offset=48 (local.get $out) (f32x4.pmax (local.get $a3) (local.get $z)))
      (v128.store offset=64 (local.get $out) (f32x4.pmax (local.get $a4) (local.get $z)))
      (v128.store offset=80 (local.get $out) (f32x4.pmax (local.get $a5) (local.get $z)))
      (local.set $out (i32.add (local.get $out) (i32.const 96)))
      (local.set $b (i32.add (local.get $b) (i32.const 96)))
      (local.set $w (i32.add (local.get $w) (i32.const 96)))
      (br $l24)))
    ;; what is left, four at a time
    (block $d4 (loop $l4
      (br_if $d4 (i32.ge_u (local.get $out) (local.get $e)))
      (local.set $a0 (v128.load (local.get $b)))
      (local.set $p (i32.const 0))
      (block $bk4 (loop $lk4
        (br_if $bk4 (i32.ge_u (local.get $p) (local.get $q)))
        (local.set $a0 (f32x4.add (local.get $a0) (f32x4.mul (v128.load32_splat (local.get $p))
          (v128.load (i32.add (local.get $w) (i32.load offset=4 (local.get $p)))))))
        (local.set $p (i32.add (local.get $p) (i32.const 8)))
        (br $lk4)))
      (v128.store (local.get $out) (f32x4.pmax (local.get $a0) (local.get $z)))
      (local.set $out (i32.add (local.get $out) (i32.const 16)))
      (local.set $b (i32.add (local.get $b) (i32.const 16)))
      (local.set $w (i32.add (local.get $w) (i32.const 16)))
      (br $l4))))

  ;; 3x3 convolution, zero padded to the same size (H x W, ci channels in, co out), then ReLU. For each output pixel,
  ;; the rows ky of its window that are inside the image; within a row the taps kx inside it are one run of inputs
  ;; (and of weight rows), so its terms come in the order (ky, kx, channel)
  (func (export "conv3") (param $inp i32) (param $H i32) (param $W i32) (param $ci i32) (param $w i32) (param $b i32) (param $co i32) (param $out i32)
    (local $y i32) (local $x i32) (local $ky0 i32) (local $ky1 i32) (local $kx0 i32) (local $kx1 i32) (local $cob i32) (local $cib i32)
    (local.set $cob (i32.shl (local.get $co) (i32.const 2)))
    (local.set $cib (i32.shl (local.get $ci) (i32.const 2)))
    (block $by (loop $ly
      (br_if $by (i32.ge_s (local.get $y) (local.get $H)))
      (local.set $ky0 (i32.eqz (local.get $y)))
      (local.set $ky1 (i32.sub (i32.const 3) (i32.eq (local.get $y) (i32.sub (local.get $H) (i32.const 1)))))
      (local.set $x (i32.const 0))
      (block $bx (loop $lx
        (br_if $bx (i32.ge_s (local.get $x) (local.get $W)))
        (local.set $kx0 (i32.eqz (local.get $x)))
        (local.set $kx1 (i32.sub (i32.const 3) (i32.eq (local.get $x) (i32.sub (local.get $W) (i32.const 1)))))
        (call $mac (local.get $out) (local.get $co) (local.get $b)
          ;; the input at (y + ky0 - 1, x + kx0 - 1), (kx1 - kx0) * ci of them, a row of the image apart
          (i32.add (local.get $inp) (i32.mul (i32.add (i32.mul (i32.sub (i32.add (local.get $y) (local.get $ky0)) (i32.const 1)) (local.get $W))
                                                      (i32.sub (i32.add (local.get $x) (local.get $kx0)) (i32.const 1))) (local.get $cib)))
          (i32.mul (i32.sub (local.get $kx1) (local.get $kx0)) (local.get $ci))
          (i32.mul (local.get $W) (local.get $cib))
          ;; the weight row of tap (ky0, kx0), channel 0; a row of the window is 3 * ci weight rows
          (i32.add (local.get $w) (i32.mul (i32.mul (i32.add (i32.mul (local.get $ky0) (i32.const 3)) (local.get $kx0)) (local.get $ci)) (local.get $cob)))
          (local.get $cob)
          (i32.mul (i32.mul (i32.const 3) (local.get $ci)) (local.get $cob))
          (i32.sub (local.get $ky1) (local.get $ky0)))
        (local.set $out (i32.add (local.get $out) (local.get $cob)))
        (local.set $x (i32.add (local.get $x) (i32.const 1)))
        (br $lx)))
      (local.set $y (i32.add (local.get $y) (i32.const 1)))
      (br $ly))))

  ;; 1-D convolution of width k, zero padded to the same length (T steps, ci channels in, co out), then ReLU: for each
  ;; step the taps j0 <= j < j1 inside the series are one run of inputs and of weight rows
  (func (export "conv1") (param $inp i32) (param $T i32) (param $ci i32) (param $w i32) (param $b i32) (param $co i32) (param $k i32) (param $out i32)
    (local $pad i32) (local $t i32) (local $j0 i32) (local $j1 i32) (local $cob i32)
    (local.set $pad (i32.shr_u (i32.sub (local.get $k) (i32.const 1)) (i32.const 1)))
    (local.set $cob (i32.shl (local.get $co) (i32.const 2)))
    (block $bt (loop $lt
      (br_if $bt (i32.ge_s (local.get $t) (local.get $T)))
      ;; j0 = max(0, pad - t), j1 = min(k, T + pad - t)
      (local.set $j0 (i32.sub (local.get $pad) (local.get $t)))
      (local.set $j0 (select (local.get $j0) (i32.const 0) (i32.gt_s (local.get $j0) (i32.const 0))))
      (local.set $j1 (i32.sub (i32.add (local.get $T) (local.get $pad)) (local.get $t)))
      (local.set $j1 (select (local.get $j1) (local.get $k) (i32.lt_s (local.get $j1) (local.get $k))))
      (call $mac (local.get $out) (local.get $co) (local.get $b)
        (i32.add (local.get $inp) (i32.shl (i32.mul (i32.sub (i32.add (local.get $t) (local.get $j0)) (local.get $pad)) (local.get $ci)) (i32.const 2)))
        (i32.mul (i32.sub (local.get $j1) (local.get $j0)) (local.get $ci)) (i32.const 0)
        (i32.add (local.get $w) (i32.mul (i32.mul (local.get $j0) (local.get $ci)) (local.get $cob))) (local.get $cob) (i32.const 0) (i32.const 1))
      (local.set $out (i32.add (local.get $out) (local.get $cob)))
      (local.set $t (i32.add (local.get $t) (i32.const 1)))
      (br $lt))))

  ;; a dense layer and its ReLU: out[0..co) = bias + the n inputs in order times their weight rows
  (func (export "dense") (param $x i32) (param $n i32) (param $w i32) (param $b i32) (param $co i32) (param $out i32)
    (call $mac (local.get $out) (local.get $co) (local.get $b) (local.get $x) (local.get $n) (i32.const 0)
      (local.get $w) (i32.shl (local.get $co) (i32.const 2)) (i32.const 0) (i32.const 1)))

  ;; max-pool: out, in order, holds for each (y, x) of H2 x W2 the largest of the four c-channel pixels at
  ;; a = inp + y * sy + x * sx, a + dx, a + dy and a + dx + dy (byte steps; the 2x2 pool of an image, or with dy = 0
  ;; the pairs of a 1-D series). Math.max's answer: a NaN wins, and +0 is above -0.
  (func (export "pool") (param $inp i32) (param $H2 i32) (param $W2 i32) (param $c i32) (param $out i32) (param $sx i32) (param $sy i32) (param $dx i32) (param $dy i32)
    (local $y i32) (local $x i32) (local $a i32) (local $e i32)
    (block $by (loop $ly
      (br_if $by (i32.ge_u (local.get $y) (local.get $H2)))
      (local.set $x (i32.const 0))
      (block $bx (loop $lx
        (br_if $bx (i32.ge_u (local.get $x) (local.get $W2)))
        (local.set $a (i32.add (local.get $inp) (i32.add (i32.mul (local.get $y) (local.get $sy)) (i32.mul (local.get $x) (local.get $sx)))))
        (local.set $e (i32.add (local.get $a) (i32.shl (local.get $c) (i32.const 2))))
        (block $bk (loop $lk
          (br_if $bk (i32.ge_u (local.get $a) (local.get $e)))
          (v128.store (local.get $out)
            (f32x4.max (f32x4.max (f32x4.max (v128.load (local.get $a)) (v128.load (i32.add (local.get $a) (local.get $dx))))
                                  (v128.load (i32.add (local.get $a) (local.get $dy))))
                       (v128.load (i32.add (i32.add (local.get $a) (local.get $dx)) (local.get $dy)))))
          (local.set $out (i32.add (local.get $out) (i32.const 16)))
          (local.set $a (i32.add (local.get $a) (i32.const 16)))
          (br $lk)))
        (local.set $x (i32.add (local.get $x) (i32.const 1)))
        (br $lx)))
      (local.set $y (i32.add (local.get $y) (i32.const 1)))
      (br $ly))))
)
