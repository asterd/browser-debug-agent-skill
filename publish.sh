#!/usr/bin/env sh
set -eu

# publish.sh — Bump version, build, test, publish to npm, push to GitHub.
# Run from the repo root.
#
# Usage:
#   sh publish.sh              # bump patch, publish
#   sh publish.sh minor        # bump minor, publish
#   sh publish.sh major        # bump major, publish
#   sh publish.sh --no-bump    # publish the version already in package.json
#   sh publish.sh --dry        # dry run (no publish, no push)

BUMP="patch"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry|--dry-run) DRY_RUN=true ;;
    --no-bump) BUMP="none" ;;
    patch|minor|major) BUMP="$arg" ;;
  esac
done

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

npm whoami >/dev/null 2>&1 || fail "Not logged in to npm. Run: npm login"
ok "npm authenticated as $(npm whoami)"

# --- Bump version ---
cd "$CORE_DIR"

OLD_VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
info "Current version: $OLD_VERSION"

if [ "$BUMP" = none ]; then
  VERSION="$OLD_VERSION"
  ok "Publishing $VERSION as-is (--no-bump)"
else
  # Bump in package.json (no git tag — we'll tag after tests pass)
  npm version "$BUMP" --no-git-tag-version >/dev/null
  VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
  ok "Bumped to $VERSION ($BUMP)"
fi

# The Kiro Power ships the same version; a test enforces this, fail early here.
POWER_VERSION=$(node -e "process.stdout.write(require('$REPO_ROOT/power/plugin.json').version)")
if [ "$POWER_VERSION" != "$VERSION" ]; then
  node -e "
    const fs=require('fs'), p='$REPO_ROOT/power/plugin.json';
    const j=JSON.parse(fs.readFileSync(p,'utf8')); j.version='$VERSION';
    fs.writeFileSync(p, JSON.stringify(j,null,2)+'\n');
  "
  ok "Synced power/plugin.json to $VERSION"
fi

# --- Build ---
info "Building..."
npm install
npm run build
ok "Build complete"

# --- Test ---
info "Running unit tests..."
TMPDIR=/tmp node --test --test-timeout=60000 "dist/*.test.js"
ok "Unit tests pass"

info "Running E2E..."
TMPDIR=/tmp sh test-e2e.sh
ok "E2E verify pass"

TMPDIR=/tmp sh test-e2e-repair.sh
ok "E2E repair loop pass"

# --- Commit + push the version bump ---
cd "$REPO_ROOT"
# Stage only release artifacts — never sweep in unrelated working-tree changes.
git add core/package.json core/package-lock.json power/plugin.json power/skills
if git diff --cached --quiet; then
  info "Nothing to commit (version unchanged)"
else
  git commit -m "release: v$VERSION"
fi

if [ "$DRY_RUN" = true ]; then
  info "[DRY RUN] Would push commit and tag v$VERSION"
else
  git push origin HEAD
  ok "Pushed version bump"
fi

# --- Publish to npm ---
cd "$CORE_DIR"
if [ "$DRY_RUN" = true ]; then
  info "[DRY RUN] npm publish --dry-run"
  npm publish --dry-run --access public
else
  info "Publishing to npm..."
  npm publish --access public
  ok "Published browser-debug-agent@$VERSION to npm"
fi

# --- Git tag ---
cd "$REPO_ROOT"
TAG="v$VERSION"
if [ "$DRY_RUN" = true ]; then
  info "[DRY RUN] Would create tag $TAG"
else
  if git rev-parse "$TAG" >/dev/null 2>&1; then
    info "Tag $TAG already exists — skipping"
  else
    git tag -a "$TAG" -m "Release $VERSION"
    git push origin "$TAG"
  fi
  ok "Pushed tag $TAG"
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
echo "    npx browser-debug-agent@latest setup kiro"
