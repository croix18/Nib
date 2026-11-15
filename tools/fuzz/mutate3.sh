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
run "replicator core: glyph weight ignored"                replicator/core.js 's/const r = weight \/ 2, pad = r \+ 3 \* unit/const r = 40 \/ 2, pad = r + 3 * unit/' hardening_check
run "guard out: the scribble point bound"                  src/scribble.js 's/pts\.length > SCR_MAX\.points\) return null;/false) return null;/' hardening_check
echo done
