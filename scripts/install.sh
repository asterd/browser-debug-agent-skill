#!/usr/bin/env sh
set -eu

skill_name=browser-debug-agent
scope=global
scope_explicit=false
mode=copy
assume_yes=false
interactive_requested=false
force=false
list_only=false
remote_update=false
source_dir=""
requested_agents=""

usage() {
  cat <<'EOF'
Install browser-debug-agent for one or more agent hosts.

Usage: scripts/install.sh [options]

  --agent ID       codex, claude-code, cursor, gemini-cli, kiro,
                   github-copilot, opencode, or universal (repeatable)
  --scope SCOPE    global (default) or project
  --interactive     prompt for install scope and host selection
  --mode MODE      copy (default) or link; link requires a local checkout
  --source PATH    local bundle root containing SKILL.md
  --list           show supported hosts, detection, and target paths
  --yes            use all detected hosts without prompting
  --update         download the selected GitHub ref before installing
  --force          replace a foreign/corrupt target after backing it up
  --help           show this help

Environment for curl/bootstrap mode:
  BDA_REPOSITORY   GitHub owner/repo (default: asterd/browser-debug-agent-skill)
  BDA_REF          branch, tag, or commit (default: main)
EOF
}

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

append_agent() {
  case " $requested_agents " in *" $1 "*) ;; *) requested_agents="${requested_agents}${requested_agents:+ }$1" ;; esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent) [ "$#" -ge 2 ] || die "--agent requires a value"; append_agent "$2"; shift 2 ;;
    --scope) [ "$#" -ge 2 ] || die "--scope requires a value"; scope=$2; scope_explicit=true; shift 2 ;;
    --mode) [ "$#" -ge 2 ] || die "--mode requires a value"; mode=$2; shift 2 ;;
    --source) [ "$#" -ge 2 ] || die "--source requires a value"; source_dir=$2; shift 2 ;;
    --list) list_only=true; shift ;;
    --yes|-y) assume_yes=true; shift ;;
    --interactive) interactive_requested=true; shift ;;
    --update) remote_update=true; shift ;;
    --force) force=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

case "$scope" in global|project) ;; *) die "scope must be global or project" ;; esac
case "$mode" in copy|link) ;; *) die "mode must be copy or link" ;; esac
[ "$remote_update" = false ] || [ -z "$source_dir" ] || die "--update and --source cannot be combined"
[ "$remote_update" = false ] || [ "$mode" = copy ] || die "--update requires --mode copy"

prompt_input=""
if [ -t 0 ]; then
  prompt_input=/dev/stdin
elif ( : </dev/tty ) 2>/dev/null; then
  prompt_input=/dev/tty
elif [ "$interactive_requested" = true ]; then
  prompt_input=/dev/stdin
fi

prompt_read() {
  prompt=$1
  printf '%s' "$prompt" >&2
  IFS= read -r reply < "$prompt_input"
  printf '%s' "$reply"
}

if [ "$scope_explicit" = false ] && [ "$assume_yes" = false ] && [ -n "$prompt_input" ]; then
  printf '%s\n' 'Install scope:' >&2
  printf '%s\n' '  1) global  — available to the selected agent everywhere' >&2
  printf '%s\n' '  2) project — install only in the current project' >&2
  scope_selection=$(prompt_read 'Choose scope [1]: ')
  case "${scope_selection:-1}" in
    1) scope=global ;;
    2) scope=project ;;
    *) die "invalid scope selection: $scope_selection" ;;
  esac
fi

agent_command() {
  case "$1" in
    codex) printf '%s' codex ;;
    claude-code) printf '%s' claude ;;
    cursor) printf '%s' cursor ;;
    gemini-cli) printf '%s' gemini ;;
    kiro) printf '%s' kiro-cli ;;
    github-copilot) printf '%s' copilot ;;
    opencode) printf '%s' opencode ;;
    universal) printf '%s' "" ;;
    *) return 1 ;;
  esac
}

agent_root() {
  agent=$1
  if [ "$scope" = project ]; then
    case "$agent" in
      claude-code) printf '%s' "$(pwd)/.claude/skills" ;;
      kiro) printf '%s' "$(pwd)/.kiro/skills" ;;
      *) printf '%s' "$(pwd)/.agents/skills" ;;
    esac
  else
    case "$agent" in
      codex) printf '%s' "$HOME/.codex/skills" ;;
      claude-code) printf '%s' "$HOME/.claude/skills" ;;
      cursor) printf '%s' "$HOME/.cursor/skills" ;;
      gemini-cli) printf '%s' "$HOME/.gemini/skills" ;;
      kiro) printf '%s' "${KIRO_HOME:-$HOME/.kiro}/skills" ;;
      github-copilot) printf '%s' "$HOME/.copilot/skills" ;;
      opencode) printf '%s' "$HOME/.config/opencode/skills" ;;
      universal) printf '%s' "$HOME/.config/agents/skills" ;;
      *) return 1 ;;
    esac
  fi
}

backup_root() {
  agent=$1
  if [ "$scope" = project ]; then
    printf '%s' "$(pwd)/.browser-debug/installer-backups/$agent"
  else
    state_home=${XDG_STATE_HOME:-$HOME/.local/state}
    printf '%s' "$state_home/browser-debug-agent/backups/$agent"
  fi
}

is_detected() {
  agent=$1
  command_name=$(agent_command "$agent") || return 1
  [ -n "$command_name" ] && has "$command_name" && return 0
  [ -d "$(agent_root "$agent")" ]
}

all_agents="codex claude-code cursor gemini-cli kiro github-copilot opencode universal"
detected_agents=""
for agent in $all_agents; do
  if is_detected "$agent"; then detected_agents="${detected_agents}${detected_agents:+ }$agent"; fi
done

if [ "$list_only" = true ]; then
  printf '%-18s %-10s %s\n' HOST DETECTED TARGET
  for agent in $all_agents; do
    detected=no; is_detected "$agent" && detected=yes
    printf '%-18s %-10s %s\n' "$agent" "$detected" "$(agent_root "$agent")/$skill_name"
  done
  exit 0
fi

if [ -z "$requested_agents" ]; then
  if [ "$assume_yes" = true ]; then
    requested_agents=$detected_agents
  elif [ -n "$prompt_input" ]; then
    printf '%s\n' "Agent hosts for $scope scope:" >&2
    index=1
    for agent in $all_agents; do
      marker=""; is_detected "$agent" && marker=" (detected)"
      printf '  %s) %s%s\n' "$index" "$agent" "$marker" >&2
      index=$((index + 1))
    done
    selection=$(prompt_read "Choose comma-separated numbers [detected: ${detected_agents:-none}]: ")
    if [ -z "$selection" ]; then
      requested_agents=$detected_agents
    else
      old_ifs=$IFS; IFS=,
      for number in $selection; do
        number=$(printf '%s' "$number" | tr -d ' ')
        case "$number" in
          1) append_agent codex ;; 2) append_agent claude-code ;; 3) append_agent cursor ;;
          4) append_agent gemini-cli ;; 5) append_agent kiro ;;
          6) append_agent github-copilot ;; 7) append_agent opencode ;;
          8) append_agent universal ;;
          *) die "invalid selection: $number" ;;
        esac
      done
      IFS=$old_ifs
    fi
  else
    requested_agents=$detected_agents
  fi
fi
[ -n "$requested_agents" ] || die "no host selected or detected; pass --agent ID"

for agent in $requested_agents; do agent_command "$agent" >/dev/null || die "unsupported host: $agent"; done

cleanup_dir=""
current_stage=""
rollback_backup=""
rollback_target=""
cleanup() {
  [ -z "$current_stage" ] || rm -rf "$current_stage"
  if [ -n "$rollback_backup" ] && [ -n "$rollback_target" ] \
    && [ ! -e "$rollback_target" ] && [ ! -L "$rollback_target" ] \
    && { [ -e "$rollback_backup" ] || [ -L "$rollback_backup" ]; }; then
    mv "$rollback_backup" "$rollback_target" || true
  fi
  [ -z "$cleanup_dir" ] || rm -rf "$cleanup_dir"
}
trap cleanup EXIT HUP INT TERM

if [ -z "$source_dir" ] && [ "$remote_update" = false ]; then
  case "$0" in
    */*)
      script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd || true)
      candidate=$(CDPATH= cd -- "$script_dir/.." 2>/dev/null && pwd || true)
      if [ -n "$candidate" ] && [ -f "$candidate/SKILL.md" ]; then source_dir=$candidate; fi
      ;;
  esac
fi

if [ -z "$source_dir" ]; then
  [ "$mode" = copy ] || die "--mode link requires a local checkout"
  has curl || die "curl is required for bootstrap installation"
  has tar || die "tar is required for bootstrap installation"
  repository=${BDA_REPOSITORY:-asterd/browser-debug-agent-skill}
  ref=${BDA_REF:-main}
  case "$repository" in *[!A-Za-z0-9._/-]*|/*|*..*) die "invalid BDA_REPOSITORY" ;; esac
  case "$ref" in *[!A-Za-z0-9._/-]*|/*|*..*) die "invalid BDA_REF" ;; esac
  cleanup_dir=$(mktemp -d "${TMPDIR:-/tmp}/bda-install.XXXXXX")
  archive=$cleanup_dir/source.tar.gz
  url="https://codeload.github.com/$repository/tar.gz/$ref"
  printf 'Downloading %s at %s...\n' "$repository" "$ref"
  curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$archive"
  tar -tzf "$archive" | awk '$0 ~ /^\// || $0 ~ /(^|\/)\.\.(\/|$)/ { bad=1 } END { exit bad }' || die "unsafe archive paths"
  top=$(tar -tzf "$archive" | awk -F/ 'NF { print $1; exit }')
  [ -n "$top" ] || die "empty source archive"
  mkdir -p "$cleanup_dir/extract"
  tar -xzf "$archive" -C "$cleanup_dir/extract"
  source_dir=$cleanup_dir/extract/$top
fi

source_dir=$(CDPATH= cd -- "$source_dir" 2>/dev/null && pwd) || die "source directory not found"
[ -f "$source_dir/SKILL.md" ] || die "source does not contain SKILL.md"
[ -d "$source_dir/references" ] || die "source does not contain references/"
[ -d "$source_dir/scripts" ] || die "source does not contain scripts/"
has cmp || die "cmp is required to compare an existing installation"
has diff || die "diff is required to compare an existing installation"

is_managed_install() {
  target_dir=$1
  [ -f "$target_dir/SKILL.md" ] || return 1
  awk '
    NR == 1 && $0 == "---" { frontmatter=1; next }
    frontmatter && $0 == "---" { closed=1; exit }
    frontmatter && $0 ~ /^name:[[:space:]]*browser-debug-agent[[:space:]]*$/ { found=1 }
    END { exit !(frontmatter && closed && found) }
  ' "$target_dir/SKILL.md"
}

same_bundle() {
  target_dir=$1
  [ -f "$target_dir/SKILL.md" ] || return 1
  [ -d "$target_dir/references" ] || return 1
  [ -d "$target_dir/scripts" ] || return 1
  cmp -s "$source_dir/SKILL.md" "$target_dir/SKILL.md" || return 1
  diff -qr "$source_dir/references" "$target_dir/references" >/dev/null 2>&1 || return 1
  diff -qr "$source_dir/scripts" "$target_dir/scripts" >/dev/null 2>&1
}

stage_bundle() {
  stage=$1
  if [ "$mode" = link ]; then
    ln -s "$source_dir" "$stage"
  else
    mkdir -p "$stage"
    cp "$source_dir/SKILL.md" "$stage/SKILL.md"
    cp -R "$source_dir/references" "$stage/references"
    cp -R "$source_dir/scripts" "$stage/scripts"
  fi
}

installed_targets=""
for agent in $requested_agents; do
  target=$(agent_root "$agent")/$skill_name
  case " $installed_targets " in *" $target "*) continue ;; esac
  installed_targets="${installed_targets}${installed_targets:+ }$target"
  parent=$(dirname "$target")
  mkdir -p "$parent"
  current_stage="$parent/.${skill_name}.install.$$"
  [ ! -e "$current_stage" ] && [ ! -L "$current_stage" ] || die "staging path already exists: $current_stage"
  stage_bundle "$current_stage"

  if [ -e "$target" ] || [ -L "$target" ]; then
    if [ "$mode" = link ] && [ -L "$target" ] && [ "$(readlink "$target")" = "$source_dir" ]; then
      rm -rf "$current_stage"; current_stage=""
      printf 'Up to date %s -> %s\n' "$skill_name" "$target"
      continue
    fi
    if [ "$mode" = copy ] && same_bundle "$target"; then
      rm -rf "$current_stage"; current_stage=""
      printf 'Up to date %s -> %s\n' "$skill_name" "$target"
      continue
    fi
    if ! is_managed_install "$target" && [ "$force" != true ]; then
      die "$target is not a recognized $skill_name install; use --force to back it up and replace it"
    fi
    backups=$(backup_root "$agent")
    mkdir -p "$backups"
    backup="$backups/$(date +%Y%m%d%H%M%S).$$"
    mv "$target" "$backup"
    rollback_backup=$backup
    rollback_target=$target
    printf 'Backed up %s to %s\n' "$target" "$backup"
    if mv "$current_stage" "$target"; then
      current_stage=""
      rollback_backup=""
      rollback_target=""
      printf 'Updated %s -> %s\n' "$skill_name" "$target"
    else
      mv "$backup" "$target" || true
      rollback_backup=""
      rollback_target=""
      die "update failed; restored previous install at $target"
    fi
  else
    mv "$current_stage" "$target"
    current_stage=""
    printf 'Installed %s -> %s\n' "$skill_name" "$target"
  fi
done

printf 'Restart the selected agent host(s), then ask for a browser UI debug or verification task.\n'
