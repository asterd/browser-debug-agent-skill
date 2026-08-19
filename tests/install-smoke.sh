#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/bda-test.XXXXXX")
cleanup() { rm -rf "$test_root"; }
trap cleanup EXIT HUP INT TERM

updated_source=$test_root/updated-source
mkdir -p "$updated_source"
cp "$repo_root/SKILL.md" "$updated_source/SKILL.md"
cp -R "$repo_root/references" "$updated_source/references"
cp -R "$repo_root/scripts" "$updated_source/scripts"
printf '\n<!-- upgrade-smoke-marker -->\n' >>"$updated_source/SKILL.md"

# Global install.
HOME="$test_root/home" "$repo_root/scripts/install.sh" \
  --source "$repo_root" --agent codex --scope global --mode copy --yes

global_target=$test_root/home/.codex/skills/browser-debug-agent
[ -f "$global_target/SKILL.md" ]
[ -f "$global_target/references/browser-drivers.md" ]
[ -x "$global_target/scripts/detect-browser-backend.sh" ]

# Identical rerun is a no-op and creates no backup.
output=$(HOME="$test_root/home" "$repo_root/scripts/install.sh" \
  --source "$repo_root" --agent codex --scope global --mode copy --yes)
printf '%s\n' "$output" | grep -q '^Up to date '
[ ! -d "$test_root/home/.local/state/browser-debug-agent/backups/codex" ]

# A changed recognized bundle updates automatically and preserves the old copy.
output=$(HOME="$test_root/home" "$repo_root/scripts/install.sh" \
  --source "$updated_source" --agent codex --scope global --mode copy --yes)
printf '%s\n' "$output" | grep -q '^Updated '
grep -q 'upgrade-smoke-marker' "$global_target/SKILL.md"
set -- "$test_root/home/.local/state/browser-debug-agent/backups/codex"/*
[ -e "$1/SKILL.md" ]

# Project-local installation and upgrade use the shared .agents path.
mkdir -p "$test_root/project"
(
  cd "$test_root/project"
  HOME="$test_root/home" "$repo_root/scripts/install.sh" \
    --source "$repo_root" --agent codex --scope project --mode copy --yes
  HOME="$test_root/home" "$repo_root/scripts/install.sh" \
    --source "$updated_source" --agent codex --scope project --mode copy --yes
)
project_target=$test_root/project/.agents/skills/browser-debug-agent
grep -q 'upgrade-smoke-marker' "$project_target/SKILL.md"
set -- "$test_root/project/.browser-debug/installer-backups/codex"/*
[ -e "$1/SKILL.md" ]

# A foreign collision is not overwritten without --force.
foreign_home=$test_root/foreign-home
foreign_target=$foreign_home/.codex/skills/browser-debug-agent
mkdir -p "$foreign_target"
printf '%s\n' 'not this skill' >"$foreign_target/SKILL.md"
if HOME="$foreign_home" "$repo_root/scripts/install.sh" \
  --source "$repo_root" --agent codex --scope global --mode copy --yes >/dev/null 2>&1; then
  printf 'foreign target was overwritten without --force\n' >&2
  exit 1
fi
grep -q 'not this skill' "$foreign_target/SKILL.md"

HOME="$foreign_home" "$repo_root/scripts/install.sh" \
  --source "$repo_root" --agent codex --scope global --mode copy --yes --force >/dev/null
grep -q '^name: browser-debug-agent$' "$foreign_target/SKILL.md"
set -- "$foreign_home/.local/state/browser-debug-agent/backups/codex"/*
grep -q 'not this skill' "$1/SKILL.md"

HOME="$test_root/home" "$repo_root/scripts/install.sh" \
  --source "$repo_root" --agent codex --scope global --list >/dev/null

printf 'install and upgrade smoke test: ok\n'
