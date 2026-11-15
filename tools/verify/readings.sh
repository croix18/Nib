#!/usr/bin/env bash
# Every reading of the reference sample with one engine — 5,605 expressions, about 3 minutes on the kernel (25 with
# 1.6.7, or with KERNEL=js for the first three sets):
#   tools/verify/readings.sh <engine.js> <out dir>
#   node tools/verify/cmp.js tools/verify/gold-1.6.7/readings <out dir>
# The corpora are test/school_synth.jsonl and the data sets `npm run data` fetches (training/scratch/data/, or $NIB_DATA).
# SETS="school board" reads only those.
set -eu
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ENG="${1:?the engine (dist/nib.js)}"; OUT="${2:?where the readings go}"
D="${NIB_DATA:-$REPO/training/scratch/data}"; mkdir -p "$OUT"
want() { [ -z "${SETS:-}" ] || case " $SETS " in *" $1 "*) return 0;; *) return 1;; esac; }
one() { want "$2" || return 0; node "$REPO/tools/verify/readall.js" "$ENG" "$1" "$OUT/$2.jsonl" "$3" "$4" "${5:-{\}}"; }
one "$REPO/test/school_synth.jsonl" school 1 0
one "$D/board.jsonl" board 1 0
one "$D/test.jsonl" test 1 0
one "$D/t12.jsonl" t12 1 0
one "$D/test.jsonl" test_all 3 0 '{"symbols":"all"}'
one "$D/t13.jsonl" t13_0 2 0
one "$D/valid.jsonl" valid_0 2 0
one "$D/synth_t13.jsonl" synth_t13_0 2 0
for s in delayed drift finger mixed mouse order reverse slope; do one "$D/stress_$s.jsonl" "stress_${s}_0" 4 0; done
echo "readings done: $OUT"
