#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_root=$(mktemp -d "${TMPDIR:-/tmp}/bda-detector.XXXXXX")
cleanup() { rm -rf "$test_root"; }
trap cleanup EXIT HUP INT TERM

mkdir -p "$test_root/bin" "$test_root/project/node_modules/.bin" "$test_root/project/node_modules/puppeteer"

make_fake() {
  path=$1
  version=$2
  {
    printf '%s\n' '#!/usr/bin/env sh'
    printf "printf '%%s\\n' '%s'\n" "$version"
  } >"$path"
  chmod +x "$path"
}

make_fake "$test_root/bin/agent-browser" 'agent-browser 1.2.3 "quoted"'
make_fake "$test_root/bin/playwright-cli" 'playwright-cli 9.9.9'
make_fake "$test_root/project/node_modules/.bin/playwright" 'Version 8.8.8'

output=$(CDPATH= cd -- "$test_root/project" && PATH="$test_root/bin:/usr/bin:/bin" "$repo_root/scripts/detect-browser-backend.sh")
printf '%s\n' "$output" | jq -e '
  .recommended == "project-playwright" and
  .tools["project-playwright"].available == true and
  .tools["project-puppeteer"].available == true and
  .tools["agent-browser"].version == "agent-browser 1.2.3 \"quoted\"" and
  .tools["playwright-cli"].available == true
' >/dev/null

printf 'detector smoke test: ok\n'
