#!/usr/bin/env sh
set -eu

# Copy SKILL.md and references into skill/ for npm packaging.
# This ensures the skill files are available when installed via npm.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SKILL_DIR="$SCRIPT_DIR/skill"

rm -rf "$SKILL_DIR"
mkdir -p "$SKILL_DIR"

# Copy from repo root (development) or from existing bundle (CI/publish)
if [ -f "$REPO_ROOT/SKILL.md" ]; then
  cp "$REPO_ROOT/SKILL.md" "$SKILL_DIR/SKILL.md"
  cp -R "$REPO_ROOT/references" "$SKILL_DIR/references"
elif [ -f "$SCRIPT_DIR/SKILL.md" ]; then
  # Already in place (shouldn't happen but handle gracefully)
  cp "$SCRIPT_DIR/SKILL.md" "$SKILL_DIR/SKILL.md"
  [ -d "$SCRIPT_DIR/references" ] && cp -R "$SCRIPT_DIR/references" "$SKILL_DIR/references"
else
  echo "warning: SKILL.md not found — skill files won't be bundled" >&2
  exit 0
fi

echo "Bundled skill files into core/skill/"
