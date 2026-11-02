#!/usr/bin/env bash
# Commit everything and push to GitHub from inside a Claude session.
# Why the header: the sandbox proxy answers git's first (unauthenticated) request with 403
# instead of 401, so git never offers credentials. Sending Basic auth preemptively works.
# Token lives in .github-token (git-ignored, chmod 600). Never put it in the remote URL.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .github-token ] || { echo "no .github-token" >&2; exit 1; }
T=$(tr -d '[:space:]' < .github-token)
B=$(printf 'x-access-token:%s' "$T" | base64 -w0)
MSG=${1:-"Update"}
COAUTHOR=${CLAUDE_MODEL_NAME:-"Claude Opus 5.5"}
TRAILER="Co-Authored-By: $COAUTHOR <noreply@anthropic.com>"
[ -n "${CLAUDE_SESSION_URL:-}" ] && TRAILER="$TRAILER
Claude-Session: $CLAUDE_SESSION_URL"
git add -A
if ! git diff --cached --quiet; then
  git -c user.name="Croix Shaffer" -c user.email="268190892+croix18@users.noreply.github.com" \
    commit -q -m "$MSG

$TRAILER"
fi
git -c "http.https://github.com/.extraheader=Authorization: Basic $B" push -q origin main 2>&1 | grep -v "acknowledgments\|push negotiation" || true
# Trust the remote, not the message.
REMOTE=$(git -c "http.https://github.com/.extraheader=Authorization: Basic $B" ls-remote origin main | cut -f1)
LOCAL=$(git rev-parse HEAD)
if [ "$REMOTE" = "$LOCAL" ]; then echo "pushed: $LOCAL"; else echo "PUSH FAILED: remote $REMOTE local $LOCAL" >&2; exit 1; fi
