#!/bin/bash
# ─────────────────────────────────────────────────────────────
# StudyFlow — Dev Start Script
#
# Usage:
#   ./start.sh           → starts server on http://localhost:8000
#   ./start.sh --ngrok   → starts server + ngrok HTTPS tunnel (for iOS testing)
# ─────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")"

# Load PORT from .env if present
PORT=$(grep -E "^PORT=" .env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')
PORT=${PORT:-8000}

USE_NGROK=false
if [ "$1" = "--ngrok" ]; then
  USE_NGROK=true
fi

# ─── Start server ────────────────────────────────────────────
echo ""
echo "  StudyFlow starting on port $PORT..."
echo ""

cd backend
python run.py &
SERVER_PID=$!
cd ..

# ─── ngrok (optional) ────────────────────────────────────────
if [ "$USE_NGROK" = true ]; then
  if ! command -v ngrok &> /dev/null; then
    echo "  ERROR: ngrok not found. Install it with:"
    echo "    brew install ngrok"
    echo "  Then run:  ./start.sh --ngrok"
    echo ""
    kill $SERVER_PID 2>/dev/null
    exit 1
  fi

  echo "  Waiting for server to boot..."
  sleep 2

  echo "  Starting ngrok tunnel → https://....ngrok.io"
  echo ""
  echo "  ┌─────────────────────────────────────────────────────┐"
  echo "  │  AFTER ngrok starts:                                │"
  echo "  │  1. Copy the https://xxxx.ngrok.io URL              │"
  echo "  │  2. Open it in Safari on your iPhone                │"
  echo "  │  3. Delete old StudyFlow from Home Screen           │"
  echo "  │  4. Share → Add to Home Screen (use the https URL)  │"
  echo "  │  5. Open from Home Screen → Enable Notifications    │"
  echo "  └─────────────────────────────────────────────────────┘"
  echo ""

  # ngrok will take over the terminal and show the URL
  ngrok http $PORT

else
  echo "  Local:  http://localhost:$PORT"
  echo "  iOS:    run './start.sh --ngrok' for HTTPS tunnel"
  echo ""
  echo "  Press Ctrl+C to stop."
  echo ""
  wait $SERVER_PID
fi
