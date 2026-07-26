#!/usr/bin/env bash
# Smoke-test the /chat SSE endpoint with curl.
#
# Prereqs: API running with DATABASE_URL, JWT_SECRET, OPENROUTER_API_KEY set;
# run `node scripts/seed.mjs` first and export API_URL, JWT, SESSION_ID.
set -euo pipefail

: "${API_URL:?run seed.mjs and export API_URL}"
: "${JWT:?run seed.mjs and export JWT}"
: "${SESSION_ID:?run seed.mjs and export SESSION_ID}"

MESSAGE=${1:-"Can you quiz me on how igneous rocks form?"}

echo "→ streaming /chat (session $SESSION_ID)…"
echo

OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

curl -sS -N -X POST "$API_URL/chat" \
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
echo "smoke test passed"
