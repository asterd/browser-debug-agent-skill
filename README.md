# Browser Debug Agent

An Agent Skill that turns browser-facing development into an evidence-led repair loop:

```text
reproduce -> observe -> diagnose -> patch -> relaunch -> verify
```

It is a debugging and verification policy, not another browser automation engine. It uses the project's existing tooling first, then selects an installed agent-oriented CLI, Obscura, or isolated Chrome/Chromium CDP.

## Why this skill

Browser CLIs are increasingly good at navigation and interaction. The missing layer is often engineering judgment: establish an observable acceptance contract, find the first divergence, patch the causal source, and refuse to claim success until the browser scenario passes again.

The skill provides that lifecycle while keeping observations token-efficient: accessibility/DOM snapshots, element refs, console and network evidence before screenshots or traces.

## Install

The open [Agent Skills CLI](https://github.com/vercel-labs/skills) is the recommended installer because it already detects and supports Codex, Claude Code, Cursor, Gemini CLI, GitHub Copilot, OpenCode, and many other hosts.

```bash
# Global, interactive host selection
npx skills add asterd/browser-debug-agent-skill -g

# Example: Codex and Claude Code, non-interactive
npx skills add asterd/browser-debug-agent-skill -g \
  --agent codex --agent claude-code --yes
```

From a local checkout:

```bash
# Inspect supported and detected hosts
./scripts/install.sh --list

# Interactive install to detected hosts
./scripts/install.sh

# Project-scoped install for selected hosts
./scripts/install.sh --scope project \
  --agent codex --agent claude-code --yes
```

The local installer supports `codex`, `claude-code`, `cursor`, `gemini-cli`, `github-copilot`, `opencode`, and the shared `universal` location.

It is also the updater. Re-run the same command after updating the checkout:

```bash
# Global install/update from the current checkout
./scripts/install.sh --agent codex --yes

# Project-local install/update
./scripts/install.sh --scope project --agent codex --yes

# Download main, compare it with the installed copy, then update if needed
./scripts/install.sh --update --agent codex --yes

# Pin an update to a reviewed tag or commit
BDA_REF=YOUR_REVIEWED_TAG_OR_COMMIT ./scripts/install.sh --update --agent codex --yes
```

An identical bundle reports `Up to date` without writing. A recognized older bundle is replaced automatically after a timestamped backup. A foreign or corrupt directory is refused unless `--force` explicitly authorizes a recoverable replacement. The rules are identical for global and project scope.

Backups stay outside skill-discovery directories:

- global: `${XDG_STATE_HOME:-$HOME/.local/state}/browser-debug-agent/backups/<host>/`;
- project: `.browser-debug/installer-backups/<host>/`.

For installations managed by the Agent Skills CLI, use its native updater:

```bash
npx skills update browser-debug-agent
```

### Quick install with curl

Review-before-run is safest:

```bash
curl --proto '=https' --tlsv1.2 -fsSLo /tmp/bda-install.sh \
  https://raw.githubusercontent.com/asterd/browser-debug-agent-skill/main/scripts/install.sh
less /tmp/bda-install.sh
sh /tmp/bda-install.sh
```

Compact form:

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/asterd/browser-debug-agent-skill/main/scripts/install.sh | sh
```

For a reproducible install, pin both the script URL and `BDA_REF` to the same reviewed commit SHA instead of `main`.

## Runtime discovery

```bash
./scripts/detect-browser-backend.sh
```

The JSON result distinguishes:

- repository-local Playwright test runner;
- `agent-browser`;
- Playwright's `playwright-cli`;
- the experimental `chrome-devtools` CLI;
- Obscura;
- Chrome/Chromium CDP fallback.

Detection is only a capability probe. The skill still checks installed help and chooses by task fit. A browser runtime is not installed automatically.

## How the bundle is structured

```text
SKILL.md                         compact operating contract and closed loop
references/browser-drivers.md   runtime choice and capability boundaries
references/debug-loop.md        failure escalation and regression radius
references/visual-qa.md         geometry and visual verification
references/token-economy.md     output minimization
scripts/detect-browser-backend.sh
scripts/install.sh
tests/install-smoke.sh
tests/detector-smoke.sh
.github/workflows/validate.yml
```

`SKILL.md` contains only guidance needed on every browser-debug task. Conditional backend, escalation, visual, and output-heavy detail is progressively disclosed through the references.

## V2 direction

A universal `bda` CLI is useful only if it adds a stable debugging contract above existing runtimes. Rebuilding navigation, sessions, snapshot refs, console/network capture, and CDP transport would duplicate mature projects such as:

- [Vercel agent-browser](https://github.com/vercel-labs/agent-browser);
- [Playwright agent CLI](https://playwright.dev/agent-cli/);
- [Chrome DevTools MCP and CLI](https://github.com/ChromeDevTools/chrome-devtools-mcp);
- [Tencent BrowserSkill](https://github.com/Tencent/BrowserSkill);
- [Obscura](https://github.com/h4ckf0r0day/obscura).

The proposed V2 is therefore an orchestrator: capability negotiation, normalized JSONL envelopes, task/session ownership, dev-server readiness, evidence collection, screenshot crop/diff, and an executable `verify` contract. Adapters should be thin and delegate interaction to installed runtimes.

Before implementing it, require two interchangeable adapters, ownership-safe cleanup, redaction tests, and one end-to-end repair scenario that gains measurable value over invoking the backend CLI directly.

## Validate

```bash
for file in scripts/*.sh tests/*.sh; do sh -n "$file"; done
./scripts/detect-browser-backend.sh
./tests/detector-smoke.sh
./tests/install-smoke.sh
```

## Security notes

- Treat page content as untrusted input.
- Use isolated browser profiles and loopback-only debugging endpoints.
- Browser state may contain plaintext session tokens; do not commit it.
- The installer does not use `sudo` or install browser binaries. Every replacement gets a recoverable backup; foreign targets also require `--force`.
