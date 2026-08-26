#!/usr/bin/env sh
set -eu

# publish.sh — Build and publish browser-debug-agent to npm + push to GitHub.
# Run from the repo root.
#
# Prerequisites:
#   - npm login (run once, authenticates via browser)
#   - gh auth login (for GitHub push/release)
#
# Usage:
#   sh publish.sh          # publish current version
#   sh publish.sh --dry    # dry run (no publish, no push)

DRY_RUN=false
case "${1:-}" in --dry|--dry-run) DRY_RUN=true ;; esac

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CORE_DIR="$REPO_ROOT/core"

ok() { printf '\033[32m✔\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✘\033[0m %s\n' "$*"; exit 1; }
info() { printf '\033[36mℹ\033[0m %s\n' "$*"; }

# --- Checks ---
info "Checking prerequisites..."

command -v node >/dev/null || fail "node not found"
command -v npm >/dev/null || fail "npm not found"
command -v git >/dev/null || fail "git not found"

NODE_MAJOR=$(node -e "process.stdout.write(String(parseInt(process.version.slice(1))))")
[ "$NODE_MAJOR" -ge 20 ] || fail "Node >= 20 required (got $NODE_MAJOR)"

# Check npm auth
npm whoami >/dev/null 2>&1 || fail "Not logged in to npm. Run: npm login"
ok "npm authenticated as $(npm whoami)"

# Check clean git state
if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
  fail "Working tree is not clean. Commit or stash changes first."
fi
ok "Git working tree clean"

# --- Build ---
info "Building core..."
cd "$CORE_DIR"
npm install
npm run build
ok "Build complete"

# --- Test ---
info "Running tests..."
TMPDIR=/tmp node --test dist/session.test.js dist/evidence.test.js dist/verify.test.js dist/server.test.js dist/integration.test.js dist/mcp-server.test.js
ok "Unit tests pass (29/29)"

info "Running E2E..."
TMPDIR=/tmp sh test-e2e.sh
ok "E2E verify pass"

TMPDIR=/tmp sh test-e2e-repair.sh
ok "E2E repair loop pass"

# --- Version ---
VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
info "Publishing version $VERSION"

# --- Publish to npm ---
if [ "$DRY_RUN" = true ]; then
  info "[DRY RUN] npm publish --dry-run"
  npm publish --dry-run --access public
else
  info "Publishing to npm..."
  npm publish --access public
  ok "Published browser-debug-agent@$VERSION to npm"
fi

# --- Git tag + push ---
cd "$REPO_ROOT"
TAG="v$VERSION"

if git tag -l "$TAG" | grep -q .; then
  info "Tag $TAG already exists, skipping"
else
  if [ "$DRY_RUN" = true ]; then
    info "[DRY RUN] Would create tag $TAG and push"
  else
    git tag -a "$TAG" -m "Release $VERSION"
    git push origin main --tags
    ok "Pushed tag $TAG to GitHub"
  fi
fi

# --- Summary ---
echo ""
ok "Done! browser-debug-agent@$VERSION is live."
echo ""
echo "  Users can now run:"
echo "    npm install -g browser-debug-agent"
echo "    bda setup kiro"
echo ""
echo "  Or without global install:"
echo "    npx browser-debug-agent setup kiro"
