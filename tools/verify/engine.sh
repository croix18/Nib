#!/usr/bin/env bash
# A released engine out of this repository's history, to compare with the one in dist/:
#   tools/verify/engine.sh <commit or tag> [file]        prints the file it wrote
# (default: tools/verify/.engines/nib-<commit>.js — that folder is not committed).
# Nib 1.6.7 is b84b93d, the last engine before the WebAssembly kernel; 1.7.0 is fc9b824.
# In a shallow clone the commit may not be there yet: git fetch --depth=200 origin main
set -eu
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
REV="${1:?which commit? (1.6.7 is b84b93d)}"
SHORT="$(git -C "$REPO" rev-parse --short "$REV")"
OUT="${2:-$REPO/tools/verify/.engines/nib-$SHORT.js}"
mkdir -p "$(dirname "$OUT")"
git -C "$REPO" show "$REV:dist/nib.js" > "$OUT"
echo "$OUT"
