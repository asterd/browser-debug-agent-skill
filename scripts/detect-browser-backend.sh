#!/usr/bin/env sh
set -eu

quick=false
case "${1:-}" in --quick|-q) quick=true ;; esac

has() { command -v "$1" >/dev/null 2>&1; }

json_escape() {
  printf '%s' "$1" | awk 'BEGIN { ORS="" } { if (NR > 1) printf "\\n"; gsub(/\\/, "\\\\"); gsub(/\"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "\\r"); printf "%s", $0 }'
}

first_line() {
  "$@" 2>/dev/null | awk 'NR == 1 { sub(/\r$/, ""); print; exit }' || true
}

emit_tool() {
  name=$1
  command_name=$2
  available=$3
  version=${4:-}
  comma=${5:-true}
  printf '    "%s": {"available": %s' "$name" "$available"
  if [ "$available" = true ]; then
    printf ', "command": "%s"' "$(json_escape "$command_name")"
    [ -z "$version" ] || printf ', "version": "%s"' "$(json_escape "$version")"
  fi
  printf '}'
  [ "$comma" = true ] && printf ','
  printf '\n'
}

obscura_cmd=""; obscura_ver=""
if has obscura; then obscura_cmd=$(command -v obscura); obscura_ver=$(first_line obscura --version); fi

agent_browser_cmd=""; agent_browser_ver=""
if has agent-browser; then agent_browser_cmd=$(command -v agent-browser); agent_browser_ver=$(first_line agent-browser --version); fi

playwright_cli_cmd=""; playwright_cli_ver=""
if has playwright-cli; then playwright_cli_cmd=$(command -v playwright-cli); playwright_cli_ver=$(first_line playwright-cli --version); fi

project_playwright_cmd=""; project_playwright_ver=""
if [ -x "./node_modules/.bin/playwright" ]; then
  project_playwright_cmd="./node_modules/.bin/playwright"
  project_playwright_ver=$(first_line ./node_modules/.bin/playwright --version)
fi

project_puppeteer_dir=""
if [ -d "./node_modules/puppeteer" ]; then project_puppeteer_dir="./node_modules/puppeteer"; fi

devtools_cmd=""; devtools_ver=""
if has chrome-devtools; then devtools_cmd=$(command -v chrome-devtools); devtools_ver=$(first_line chrome-devtools --version); fi

chrome_cmd=""
for candidate in google-chrome google-chrome-stable chromium chromium-browser chrome; do
  if has "$candidate"; then chrome_cmd=$(command -v "$candidate"); break; fi
done
if [ -z "$chrome_cmd" ] && [ "$quick" = false ]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
    if [ -x "$candidate" ]; then chrome_cmd=$candidate; break; fi
  done
fi

recommended="none"
reason="No supported browser runtime detected"
if [ -n "$project_playwright_cmd" ]; then recommended="project-playwright"; reason="Repository-local browser tooling preserves project configuration"
elif [ -n "$project_puppeteer_dir" ]; then recommended="project-puppeteer"; reason="Repository-local Puppeteer is available for existing project automation"
elif [ -n "$agent_browser_cmd" ]; then recommended="agent-browser"; reason="AI-oriented persistent CLI with snapshot refs and JSON output"
elif [ -n "$playwright_cli_cmd" ]; then recommended="playwright-cli"; reason="Agent CLI with accessibility snapshots and element refs"
elif [ -n "$devtools_cmd" ]; then recommended="chrome-devtools"; reason="Persistent Chrome DevTools CLI is available"
elif [ -n "$obscura_cmd" ]; then recommended="obscura"; reason="Lightweight native fast path; confirm renderer-sensitive results in Chromium"
elif [ -n "$chrome_cmd" ]; then recommended="chrome-cdp"; reason="Chrome is available; use an isolated CDP profile"
fi

printf '{\n'
printf '  "schema_version": 1,\n'
printf '  "recommended": "%s",\n' "$recommended"
printf '  "reason": "%s",\n' "$(json_escape "$reason")"
printf '  "tools": {\n'
if [ -n "$project_playwright_cmd" ]; then emit_tool project-playwright "$project_playwright_cmd" true "$project_playwright_ver"; else emit_tool project-playwright "" false ""; fi
if [ -n "$project_puppeteer_dir" ]; then emit_tool project-puppeteer "$project_puppeteer_dir" true ""; else emit_tool project-puppeteer "" false ""; fi
if [ -n "$agent_browser_cmd" ]; then emit_tool agent-browser "$agent_browser_cmd" true "$agent_browser_ver"; else emit_tool agent-browser "" false ""; fi
if [ -n "$playwright_cli_cmd" ]; then emit_tool playwright-cli "$playwright_cli_cmd" true "$playwright_cli_ver"; else emit_tool playwright-cli "" false ""; fi
if [ -n "$devtools_cmd" ]; then emit_tool chrome-devtools "$devtools_cmd" true "$devtools_ver"; else emit_tool chrome-devtools "" false ""; fi
if [ -n "$obscura_cmd" ]; then emit_tool obscura "$obscura_cmd" true "$obscura_ver"; else emit_tool obscura "" false ""; fi
if [ -n "$chrome_cmd" ]; then emit_tool chrome-cdp "$chrome_cmd" true "" false; else emit_tool chrome-cdp "" false "" false; fi
printf '  }\n'
printf '}\n'
