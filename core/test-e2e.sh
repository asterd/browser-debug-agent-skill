#!/usr/bin/env sh
set -eu

# End-to-end test: starts fixture server, runs bda verify with real Playwright.
# Proves the complete loop works with an actual browser.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FIXTURE_DIR="$SCRIPT_DIR/fixtures/broken-form"
TMPDIR_E2E=$(mktemp -d "${TMPDIR:-/tmp}/bda-e2e.XXXXXX")
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMPDIR_E2E"; }
trap cleanup EXIT HUP INT TERM

# 1. Start fixture server (serving the fixed version)
FIXTURE_FILE=fixed.html PORT=0 node "$FIXTURE_DIR/server.mjs" > "$TMPDIR_E2E/server.out" &
SERVER_PID=$!

# Wait for LISTENING:<port>
for i in $(seq 1 30); do
  if grep -q '^LISTENING:' "$TMPDIR_E2E/server.out" 2>/dev/null; then break; fi
  sleep 0.1
done
PORT=$(grep '^LISTENING:' "$TMPDIR_E2E/server.out" | head -1 | cut -d: -f2)
[ -n "$PORT" ] || { echo "FAIL: server did not start"; exit 1; }
echo "Fixture server on port $PORT (pid $SERVER_PID)"

# 2. Generate verify manifest with actual port
sed "s/{{PORT}}/$PORT/" "$FIXTURE_DIR/verify-fixed.json" > "$TMPDIR_E2E/manifest.json"

# 3. Run bda verify (from a dir where playwright is resolvable)
cd "$SCRIPT_DIR"
# set -e is on: without `|| EXIT_CODE=$?` a failing verify aborts the script
# before the check below, and the suite reports success on a red run.
EXIT_CODE=0
TMPDIR=/tmp node "$SCRIPT_DIR/dist/cli.js" verify "$TMPDIR_E2E/manifest.json" || EXIT_CODE=$?

if [ "$EXIT_CODE" -eq 0 ]; then
  echo ""
  echo "E2E TEST: PASS — bda verify succeeded with real browser"
else
  echo ""
  echo "E2E TEST: FAIL — exit code $EXIT_CODE"
  exit 1
fi
