#!/usr/bin/env bash
# Smoke-test the tutor-chat SSE endpoint with curl.
#
# Prereqs: run `node scripts/seed.mjs` first and export SUPABASE_URL, JWT,
# SESSION_ID as it prints. Requires the edge functions to be deployed and
# ANTHROPIC_API_KEY set in function secrets.
set -euo pipefail

: "${SUPABASE_URL:?run seed.mjs and export SUPABASE_URL}"
: "${JWT:?run seed.mjs and export JWT}"
: "${SESSION_ID:?run seed.mjs and export SESSION_ID}"

MESSAGE=${1:-"Can you quiz me on how igneous rocks form? Give me a question from my notes."}

echo "→ streaming tutor-chat (session $SESSION_ID)…"
echo

OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

curl -sS -N -X POST "$SUPABASE_URL/functions/v1/tutor-chat" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"message\": $(printf '%s' "$MESSAGE" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}" \
  | tee "$OUT"

echo
echo "── assertions ──────────────────────────────"
grep -q '"type":"delta"' "$OUT" && echo "✓ received text deltas" || {
  echo "✗ no text deltas"; exit 1;
}
grep -q '"type":"done"' "$OUT" && echo "✓ received done event" || {
  echo "✗ no done event"; exit 1;
}
if grep -q '"cacheReadInputTokens":0' "$OUT"; then
  echo "ℹ first turn (no cache read) — run again to verify cache hits"
else
  echo "✓ prompt cache read tokens > 0"
fi
echo "smoke test passed"
