#!/usr/bin/env bash
# The ten scripted sessions on a board with one engine, in Chrome, each compared with its reference as it ends:
#   tools/verify/sessions.sh <engine.js> <out dir> [reference dir]
# Eight are compared with what Nib 1.6.7 did (tools/verify/gold-1.6.7/sessions). Two more, many9 and many11, are on
# pages that need 13 and 14 joins and move single strokes off their symbols: 1.6.7 and 1.7.0 read those wrongly
# (docs/reviews/found-2026-11-15.md), so their reference is what 1.7.1 did (tools/verify/gold-1.7.1/sessions).
# A reference dir given here is used for every session it has a file for.
# About 9 minutes on the kernel (25 with 1.6.7, which the two cannot be compared with).
# NIB_SESSION_INIT: a line of script run in the page first, e.g. "Nib._internals.poolUse(0)".
# NIB_SESSION_ATTRS: attributes for the pad besides the session's own. SESSIONS="s1 big8" runs only those.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ENG="${1:?the engine (dist/nib.js)}"; OUT="${2:?where the sessions go}"; GIVEN="${3:-}"
G167="$REPO/tools/verify/gold-1.6.7/sessions"; G171="$REPO/tools/verify/gold-1.7.1/sessions"
mkdir -p "$OUT"; bad=0
run() { # name seed expressions steps reference [1: half the moves take one stroke]
  [ -z "${SESSIONS:-}" ] || case " $SESSIONS " in *" $1 "*) ;; *) return 0;; esac
  NIB_SESSION_STROKES="${6:-}" node "$REPO/tools/verify/session.js" "$ENG" "$OUT/$1.jsonl" "$2" "$3" "$4" "${NIB_SESSION_ATTRS:-}" "${NIB_SESSION_INIT:-}" || { bad=1; return 0; }
  ref="$5/$1.jsonl"; [ -z "$GIVEN" ] || { [ -f "$GIVEN/$1.jsonl" ] || [ -f "$GIVEN/$1.jsonl.gz" ]; } && [ -n "$GIVEN" ] && ref="$GIVEN/$1.jsonl"
  [ -f "$ref" ] || ref="$ref.gz"
  if [ -f "$ref" ]; then printf '%s: ' "$1"; node "$REPO/tools/verify/cmpsess.js" "$ref" "$OUT/$1.jsonl" | tail -1; [ "${PIPESTATUS[0]}" = 0 ] || bad=1
  else echo "$1: no reference to compare with ($ref)"; fi
}
for s in 1 2 3 4 5 6; do run "s$s" "$s" 16 30 "$G167"; done
run big8 8 60 30 "$G167"
run big7 7 100 22 "$G167"
run many9 9 120 22 "$G171" 1
run many11 11 120 22 "$G171" 1
[ "$bad" = 0 ] && echo "sessions: nothing differs" || echo "sessions: SOMETHING DIFFERS (run cmpsess.js on the file for where)"
exit "$bad"
