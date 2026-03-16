#!/usr/bin/env bash
# Run on the server as root or a sudo user.
# Usage: bash deploy/deploy.sh
set -e

REPO_DIR="/var/www/VAT"
SERVICE="elevenlabs-tester"

echo "→ Pulling latest code..."
git -C "$REPO_DIR" pull

echo "→ Installing/updating dependencies..."
"$REPO_DIR/.venv/bin/pip" install -q -r "$REPO_DIR/backend/requirements.txt"

echo "→ Restarting service..."
systemctl restart "$SERVICE"

echo "→ Status:"
systemctl status "$SERVICE" --no-pager -l
