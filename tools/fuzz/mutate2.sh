#!/usr/bin/env bash
# The mutations the suites missed before, tried again against the hardened tree (the new hardening_check should notice).
set -u
SRC="$(cd "$(dirname "$0")/../.." && pwd)"; M="${TMPDIR:-/tmp}/nib-mutrepo2"; LOGS="${TMPDIR:-/tmp}/nib-mutate"; mkdir -p "$LOGS"
rm -rf "$M"; mkdir -p "$M"
(cd "$SRC" && (git ls-files; git ls-files --others --exclude-standard) | tar cf - -T -) | tar xf - -C "$M"
ln -s "$SRC/node_modules" "$M/node_modules"; mkdir -p "$M/training" && ln -s "$SRC/training/scratch" "$M/training/scratch"
cd "$M"
run() { local name="$1" file="$2" expr="$3"; shift 3
  cp "$file" "$file.orig"; sed -i -E "$expr" "$file"
  if cmp -s "$file" "$file.orig"; then echo "NOT APPLIED  $name"; rm "$file.orig"; return; fi
  local res=""
  if ! python3 build.py >/dev/null 2>build.err; then res="build failed"; else
    for s in "$@"; do if timeout 600 node "test/$s.js" >"$LOGS/mut2_$s.log" 2>&1; then res="$res MISSED-by-$s"; else res="$res caught-by-$s($(grep -c 'FAIL' $LOGS/mut2_$s.log) fails: $(grep -m1 'FAIL' $LOGS/mut2_$s.log | cut -c1-90))"; fi; done
  fi
  mv "$file.orig" "$file"; echo "$(printf '%-58s' "$name") $res"
}
python3 build.py >/dev/null && node test/hardening_check.js >/dev/null 2>&1 && echo "baseline hardening_check passes in the copy" || echo "BASELINE FAILS"
run "neat: exponents drawn at 0.5 size, not 0.65"          src/neat.js    's/script: 0\.65/script: 0.5/' hardening_check
run "solve: factorials allowed up to 2000"                 src/solve.js   "s/c\.n > 200n\) sfail\('factorial'\)/c.n > 2000n) sfail('factorial')/" hardening_check
run "solve: size limit raised tenfold"                     src/solve.js   's/const SOLVE_BITS = 4096/const SOLVE_BITS = 40960/' hardening_check
run "solve: powers of letters allowed up to 25"            src/solve.js   's/k\.n > 24n\) sfail\(.that power of letters.\)/k.n > 25n) sfail("that power of letters")/' hardening_check
run "scribble: 0.6 thresholds lowered to 0.4"              src/scribble.js 's/0\.6\b/0.4/' hardening_check
run "recognize: + over - is no longer read as plus-minus"  src/recognize.js "s/gap < 0\.5 \* ref\) label = '\\\\\\\\pm'/gap < 0.5 * ref) label = '+'/" hardening_check
run "core: memory holds 4000 corrections, not 400"         src/core.js    's/MEM_MAX = 400/MEM_MAX = 4000/' hardening_check
run "core: memory pull starts at 0.5 similarity"           src/core.js    's/MEM_SIM0 = 0\.88/MEM_SIM0 = 0.5/' hardening_check
run "replicator core: glyph weight ignored"                replicator/core.js 's/const r = weight \/ 2, pad = r \+ 3 \* unit/const r = 40 \/ 2, pad = r + 3 * unit/' hardening_check replicator_check font_check
# and the new guards themselves: taking one out must be noticed
run "guard out: a NaN score is no longer the worst score"  src/recognize.js 's/if \(Number\.isNaN\(v\)\) v = -Infinity;/if (false) v = -Infinity;/' hardening_check
run "guard out: the scribble point bound"                  src/scribble.js 's/pts\.length > SCR_MAX\.points\) return null;/false) return null;/' hardening_check
run "guard out: a null coordinate is a 0 again"            src/core.js    "s/const x = typeof v === 'number' \? v : typeof v === 'string' \&\& v\.trim\(\) !== '' \? \+v : NaN;/const x = +v;/" hardening_check
run "guard out: the Replicator box clip"                   replicator/core.js 's/const BOX_SLACK = 1;/const BOX_SLACK = 1e9;/' hardening_check
echo done
