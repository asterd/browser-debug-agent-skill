#!/usr/bin/env sh
set -eu

# browser-debug-agent CLI
# Wrapper around scripts/install.sh for npx-friendly installation

# Resolve symlinks to find the real script location
resolve_link() {
  target=$1
  while [ -L "$target" ]; do
    dir=$(dirname "$target")
    target=$(readlink "$target")
    case "$target" in /*) ;; *) target="$dir/$target" ;; esac
  done
  printf '%s' "$target"
}

real_script=$(resolve_link "$0")
cli_dir=$(CDPATH= cd -- "$(dirname -- "$real_script")" && pwd)
bundle_dir="$cli_dir/../bundle"

# If bundle doesn't exist (dev mode), use repo root
if [ ! -d "$bundle_dir" ]; then
  repo_root=$(CDPATH= cd -- "$cli_dir/../.." 2>/dev/null && pwd || true)
  if [ -n "$repo_root" ] && [ -f "$repo_root/SKILL.md" ]; then
    bundle_dir=$repo_root
  else
    echo "error: cannot find skill bundle" >&2
    exit 1
  fi
fi

usage() {
  cat <<'EOF'
browser-debug-agent — Browser debugging skill for AI agents

Usage:
  bda init --ai <host> [--global] [--with-runtimes]
  bda update [--global]
  bda uninstall [--ai <host>]
  bda list
  bda doctor

Options:
  --ai <host>       kiro, claude, codex, cursor, gemini, copilot, opencode, all
  --global          install to user-global path instead of project
  --with-runtimes   also install Obscura + Playwright without prompting

Examples:
  bda init --ai kiro                        Install for Kiro (project)
  bda init --ai kiro --global               Install for Kiro (global)
  bda init --ai all --with-runtimes         Install skill + all browser runtimes
  bda update                                Update installed copies
  bda doctor                                Check Playwright, Chrome, Obscura
EOF
}

map_agent() {
  case "$1" in
    kiro) printf 'kiro' ;;
    claude|claude-code) printf 'claude-code' ;;
    codex) printf 'codex' ;;
    cursor) printf 'cursor' ;;
    gemini|gemini-cli) printf 'gemini-cli' ;;
    copilot|github-copilot) printf 'github-copilot' ;;
    opencode) printf 'opencode' ;;
    all) printf '' ;;
    *) printf '%s' "$1" ;;
  esac
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  init|install)
    ai=""
    scope="project"
    runtimes_flag=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --ai) ai="$2"; shift 2 ;;
        --global|-g) scope="global"; shift ;;
        --with-runtimes) runtimes_flag="--with-runtimes"; shift ;;
        *) shift ;;
      esac
    done
    [ -n "$ai" ] || { echo "error: --ai <host> is required"; usage; exit 1; }
    if [ "$ai" = all ]; then
      exec sh "$bundle_dir/scripts/install.sh" --source "$bundle_dir" --scope "$scope" --yes $runtimes_flag
    else
      agent=$(map_agent "$ai")
      exec sh "$bundle_dir/scripts/install.sh" --source "$bundle_dir" --agent "$agent" --scope "$scope" --yes $runtimes_flag
    fi
    ;;
  update)
    scope="project"
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --global|-g) scope="global"; shift ;;
        *) shift ;;
      esac
    done
    exec sh "$bundle_dir/scripts/install.sh" --source "$bundle_dir" --scope "$scope" --yes
    ;;
  uninstall|remove)
    echo "To uninstall, remove the skill directory for your host:"
    echo "  Kiro project:  rm -rf .kiro/skills/browser-debug-agent"
    echo "  Kiro global:   rm -rf ~/.kiro/skills/browser-debug-agent"
    echo "  Claude project: rm -rf .claude/skills/browser-debug-agent"
    echo "  Codex global:  rm -rf ~/.codex/skills/browser-debug-agent"
    echo "  Universal:     rm -rf .agents/skills/browser-debug-agent"
    ;;
  list)
    exec sh "$bundle_dir/scripts/install.sh" --source "$bundle_dir" --scope project --list
    ;;
  doctor)
    exec sh "$bundle_dir/scripts/detect-browser-backend.sh"
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    echo "error: unknown command '$cmd'"
    usage
    exit 1
    ;;
esac
