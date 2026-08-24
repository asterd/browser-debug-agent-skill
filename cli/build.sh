#!/usr/bin/env sh
set -eu

# Build the npm package by copying the skill bundle into cli/bundle/
# Run from the repo root: sh cli/build.sh

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
bundle_dir="$script_dir/bundle"

echo "Building browser-debug-agent CLI package..."

# Clean previous bundle
rm -rf "$bundle_dir"
mkdir -p "$bundle_dir"

# Copy skill files
cp "$repo_root/SKILL.md" "$bundle_dir/SKILL.md"
cp -R "$repo_root/references" "$bundle_dir/references"
cp -R "$repo_root/scripts" "$bundle_dir/scripts"

# Verify
[ -f "$bundle_dir/SKILL.md" ] || { echo "error: SKILL.md not copied"; exit 1; }
[ -d "$bundle_dir/references" ] || { echo "error: references/ not copied"; exit 1; }
[ -d "$bundle_dir/scripts" ] || { echo "error: scripts/ not copied"; exit 1; }
[ -x "$bundle_dir/scripts/install.sh" ] || chmod +x "$bundle_dir/scripts/install.sh"
[ -x "$bundle_dir/scripts/detect-browser-backend.sh" ] || chmod +x "$bundle_dir/scripts/detect-browser-backend.sh"

# Count files
file_count=$(find "$bundle_dir" -type f | wc -l | tr -d ' ')
echo "Bundle: $file_count files in cli/bundle/"
echo "Done. Run 'cd cli && npm publish' to publish."
