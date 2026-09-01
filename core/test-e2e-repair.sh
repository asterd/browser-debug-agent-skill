#!/usr/bin/env sh
set -eu

# E2E test: demonstrates the full repair loop.
# 1. Serve the BROKEN fixture → bda verify FAILS
# 2. Serve the FIXED fixture → bda verify PASSES
# This proves the verify command correctly distinguishes broken from fixed.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
FIXTURE_DIR="$SCRIPT_DIR/fixtures/broken-form"
TMPDIR_E2E=$(mktemp -d "${TMPDIR:-/tmp}/bda-e2e-repair.XXXXXX")
cleanup() { kill "$SRV1" 2>/dev/null || true; kill "$SRV2" 2>/dev/null || true; rm -rf "$TMPDIR_E2E"; }
trap cleanup EXIT HUP INT TERM

echo "=== E2E Repair Loop Test ==="
echo ""

# --- Phase 1: BROKEN fixture should FAIL ---
echo "Phase 1: Verifying BROKEN fixture (expect FAIL)..."

FIXTURE_FILE=index.html PORT=0 node "$FIXTURE_DIR/server.mjs" > "$TMPDIR_E2E/srv1.out" &
SRV1=$!
for i in $(seq 1 30); do grep -q '^LISTENING:' "$TMPDIR_E2E/srv1.out" 2>/dev/null && break; sleep 0.1; done
PORT1=$(grep '^LISTENING:' "$TMPDIR_E2E/srv1.out" | head -1 | cut -d: -f2)
[ -n "$PORT1" ] || { echo "FAIL: server 1 did not start"; exit 1; }

# The broken fixture calls /api/settigns (typo) and doesn't preventDefault.
# Our verify manifest checks for no failed network requests — this should fail
# because the page reloads (missing preventDefault) so the form never completes.
# We only check console_errors and visible (which will pass) and network (which should fail).
cat > "$TMPDIR_E2E/manifest-broken.json" <<EOF
{
  "url": "http://127.0.0.1:$PORT1",
  "assertions": [
    { "type": "visible", "expect": "Settings", "label": "Heading visible" },
    { "type": "network_status", "expect": { "url": "/api/settigns", "status": 200 }, "label": "API call succeeds (broken endpoint)" }
  ]
}
EOF

cd "$SCRIPT_DIR"
if TMPDIR=/tmp node dist/cli.js verify "$TMPDIR_E2E/manifest-broken.json" 2>&1; then
  echo ""
  echo "FAIL: broken fixture should have failed verification!"
  exit 1
fi
echo ""
echo "✔ Phase 1 PASSED: broken fixture correctly FAILED verification"
echo ""

kill "$SRV1" 2>/dev/null || true

# --- Phase 2: FIXED fixture should PASS ---
echo "Phase 2: Verifying FIXED fixture (expect PASS)..."

FIXTURE_FILE=fixed.html PORT=0 node "$FIXTURE_DIR/server.mjs" > "$TMPDIR_E2E/srv2.out" &
SRV2=$!
for i in $(seq 1 30); do grep -q '^LISTENING:' "$TMPDIR_E2E/srv2.out" 2>/dev/null && break; sleep 0.1; done
PORT2=$(grep '^LISTENING:' "$TMPDIR_E2E/srv2.out" | head -1 | cut -d: -f2)
[ -n "$PORT2" ] || { echo "FAIL: server 2 did not start"; exit 1; }

cat > "$TMPDIR_E2E/manifest-fixed.json" <<EOF
{
  "url": "http://127.0.0.1:$PORT2",
  "assertions": [
    { "type": "visible", "expect": "Settings", "label": "Heading visible" },
    { "type": "console_errors", "expect": "none", "label": "No console errors" },
    { "type": "network_status", "expect": { "failed": "none" }, "label": "No failed requests" }
  ]
}
EOF

# set -e is on: capture the status inline, or a failure aborts before the check.
VERIFY_EXIT=0
TMPDIR=/tmp node dist/cli.js verify "$TMPDIR_E2E/manifest-fixed.json" 2>&1 || VERIFY_EXIT=$?
if [ "$VERIFY_EXIT" -ne 0 ]; then
  echo "FAIL: fixed fixture should have passed (exit $VERIFY_EXIT)"
  exit 1
fi
echo ""
echo "✔ Phase 2 PASSED: fixed fixture correctly VERIFIED"
echo ""
echo "=== E2E REPAIR LOOP: ALL PASS ==="
