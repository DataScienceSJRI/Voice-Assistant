#!/usr/bin/env bash
# Local dev only. Production uses systemd — see deploy/elevenlabs-tester.service
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV="$ROOT/.venv"

if [ ! -d "$VENV" ]; then
  echo "→ Creating virtual environment..."
  python3 -m venv "$VENV"
fi

echo "→ Installing dependencies..."
"$VENV/bin/pip" install -q -r "$ROOT/backend/requirements.txt"

echo "→ Starting server at http://localhost:8000"
echo ""
cd "$ROOT/backend"
"$VENV/bin/uvicorn" main:app --host 0.0.0.0 --port 8000 --reload
