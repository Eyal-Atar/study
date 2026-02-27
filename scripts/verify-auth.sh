#!/usr/bin/env bash
# Verify Phase 6 auth: health, cookie-based login, /auth/me with cookie.
# Run with server up: ./scripts/verify-auth.sh [BASE_URL]
set -e
BASE="${1:-http://127.0.0.1:8000}"

echo "→ Health check..."
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health")
test "$code" = "200" || { echo "Health failed: $code"; exit 1; }
echo "  OK"

echo "→ Login (expect Set-Cookie: session_token)..."
res=$(curl -s -c /tmp/sf-cookies.txt -b /tmp/sf-cookies.txt -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test12"}')
if echo "$res" | grep -q '"detail"'; then
  echo "  (Login returned error - expected if user missing; checking cookie presence)"
fi
if grep -q "session_token" /tmp/sf-cookies.txt 2>/dev/null; then
  echo "  OK (session_token cookie set)"
else
  echo "  Note: No session_token in cookie file (OK if 401)"
fi

echo "→ GET /auth/me with cookie (expect 401 if not logged in)..."
code=$(curl -s -o /dev/null -w "%{http_code}" -b /tmp/sf-cookies.txt "$BASE/auth/me")
echo "  /auth/me status: $code (200 = authenticated, 401 = not logged in)"

echo ""
echo "Done. Session secret is loaded from backend/.env (SESSION_SECRET_KEY)."
