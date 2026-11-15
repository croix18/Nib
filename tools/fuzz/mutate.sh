#!/usr/bin/env bash
# A small mutation-testing sample: break one thing in a copy of the repo, rebuild, run the suite that should notice.
# "caught" = the suite failed (good). "MISSED" = the suite still passed with the bug in (a gap in the tests).
set -u
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
M="${TMPDIR:-/tmp}/nib-mutrepo"
LOGS="${TMPDIR:-/tmp}/nib-mutate"; mkdir -p "$LOGS"
rm -rf "$M"; mkdir -p "$M"
(cd "$SRC" && git ls-files | tar cf - -T -) | tar xf - -C "$M"
ln -s "$SRC/node_modules" "$M/node_modules"
mkdir -p "$M/training" && ln -s "$SRC/training/scratch" "$M/training/scratch"
cd "$M"
run() { # name file sed-expression suites...
  local name="$1" file="$2" expr="$3"; shift 3
  cp "$file" "$file.orig"
  sed -i -E "$expr" "$file"
  if cmp -s "$file" "$file.orig"; then echo "NOT APPLIED  $name"; rm "$file.orig"; return; fi
  local res=""
  if ! python3 build.py >/dev/null 2>build.err; then res="build failed"; else
    case "$file" in src/pad.js|board/*|replicator/*) python3 board/build.py >/dev/null 2>&1; python3 replicator/build.py >/dev/null 2>&1;; esac
    for s in "$@"; do
      local t0=$(date +%s)
      if timeout 900 node "test/$s.js" >"$LOGS/mut_$s.log" 2>&1; then res="$res MISSED-by-$s"; else res="$res caught-by-$s($(grep -c 'FAIL' $LOGS/mut_$s.log) fails)"; fi
      res="$res[$(( $(date +%s) - t0 ))s]"
    done
  fi
  mv "$file.orig" "$file"
  echo "$(printf '%-62s' "$name") $res"
}
python3 build.py >/dev/null && python3 board/build.py >/dev/null && python3 replicator/build.py >/dev/null
# sanity: the unmutated copy passes a quick suite
node test/store_check.js >/dev/null 2>&1 && echo "baseline store_check passes in the copy" || echo "BASELINE FAILS"

run "store: points kept to 1 px, not 0.1"                     src/store.js   's/storeQ\(x \* 10\), Y = storeQ\(y \* 10\)/storeQ(x * 1), Y = storeQ(y * 1)/' store_check
run "pdf: xref offset off by one"                             src/pdf.js     's/xref = size, id/xref = size + 1, id/' pdf_check
run "shapes: lines snap to 20 degrees, not 15"                src/shapes.js  's|q = Math.PI / 12, ts|q = Math.PI / 9, ts|' shapes_check
run "neat: exponents drawn at 0.5 size, not 0.65"             src/neat.js    's/script: 0\.65/script: 0.5/' neat_check
run "solve: 1/0 gives 0 instead of no answer"                 src/solve.js   "s/czero\(b\) \? sfail\('division by zero'\) : isFl/czero(b) ? QZERO : isFl/" solve_check
run "solve: factorials allowed up to 2000"                    src/solve.js   "s/c\.n > 200n\) sfail\('factorial'\)/c.n > 2000n) sfail('factorial')/" solve_check
run "solve: size limit raised tenfold"                        src/solve.js   's/const SOLVE_BITS = 4096/const SOLVE_BITS = 40960/' solve_check
run "solve: unary minus binds tighter than a power"           src/solve.js   's/k\.n > 24n\) sfail\(.that power of letters.\)/k.n > 25n) sfail("that power of letters")/' solve_check
run "scribble: three legs make a scribble, not five"          src/scribble.js 's/L\.n >= 5 \&\& len >= 4 \* L\.R/L.n >= 3 \&\& len >= 4 * L.R/' scribble_check
run "scribble: a stroke 40% inside is rubbed out, not 60%"    src/scribble.js 's/0\.6\b/0.4/' scribble_check
run "recognize: + over - is no longer read as plus-minus"     src/recognize.js "s/gap < 0\.5 \* ref\) label = '\\\\\\\\pm'/gap < 0.5 * ref) label = '+'/" check
run "core: memory holds 4000 corrections, not 400"            src/core.js    's/MEM_MAX = 400/MEM_MAX = 4000/' check
run "core: memory pull starts at 0.5 similarity"              src/core.js    's/MEM_SIM0 = 0\.88/MEM_SIM0 = 0.5/' check
run "pad: undo history holds 5 steps, not 500"                src/pad.js     's/this\.history\.length > 500\) this\.history\.splice\(0, this\.history\.length - 500\)/this.history.length > 5) this.history.splice(0, this.history.length - 5)/' pad_browser canvas_browser
run "pad: an erased stroke is not put back by undo"           src/pad.js     's/if \(back\) for \(const e of h\.erase\.slice\(\)\.reverse\(\)\) this\.strokes\.splice\(e\.i, 0, e\.s\);/if (back) for (const e of []) this.strokes.splice(e.i, 0, e.s);/' pad_browser
run "pad: zoom allowed down to 1%"                            src/pad.js     's/const PAD_ZMIN = [0-9.]+/const PAD_ZMIN = 0.01/' canvas_browser
run "board: the save is delayed 60 s, not half a second"      board/board.js 's/saveTimer = setTimeout\(write, 500\)/saveTimer = setTimeout(write, 60000)/' board_canvas_browser
run "replicator core: glyph weight ignored"                   replicator/core.js 's/const r = weight \/ 2, pad = r \+ 3 \* unit/const r = 40 \/ 2, pad = r + 3 * unit/' replicator_check
echo done
