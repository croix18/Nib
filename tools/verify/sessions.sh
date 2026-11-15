#!/usr/bin/env bash
# The eight scripted sessions on a board with one engine, in Chrome, each compared with the reference as it ends:
#   tools/verify/sessions.sh <engine.js> <out dir> [reference dir]
# (reference: tools/verify/gold-1.6.7/sessions; about 6 minutes on the kernel, 20 with 1.6.7).
# NIB_SESSION_INIT: a line of script run in the page first, e.g. "Nib._internals.poolUse(0)".
# NIB_SESSION_ATTRS: attributes for the pad besides the session's own. SESSIONS="s1 big8" runs only those.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ENG="${1:?the engine (dist/nib.js)}"; OUT="${2:?where the sessions go}"; REF="${3:-$REPO/tools/verify/gold-1.6.7/sessions}"
mkdir -p "$OUT"; bad=0
run() { # name seed expressions steps
  [ -z "${SESSIONS:-}" ] || case " $SESSIONS " in *" $1 "*) ;; *) return 0;; esac
  node "$REPO/tools/verify/session.js" "$ENG" "$OUT/$1.jsonl" "$2" "$3" "$4" "${NIB_SESSION_ATTRS:-}" "${NIB_SESSION_INIT:-}" || { bad=1; return 0; }
  ref="$REF/$1.jsonl"; [ -f "$ref" ] || ref="$ref.gz"
  if [ -f "$ref" ]; then printf '%s: ' "$1"; node "$REPO/tools/verify/cmpsess.js" "$ref" "$OUT/$1.jsonl" | tail -1; [ "${PIPESTATUS[0]}" = 0 ] || bad=1; fi
}
for s in 1 2 3 4 5 6; do run "s$s" "$s" 16 30; done
run big8 8 60 30
run big7 7 100 22
[ "$bad" = 0 ] && echo "sessions: nothing differs" || echo "sessions: SOMETHING DIFFERS (run cmpsess.js on the file for where)"
exit "$bad"
