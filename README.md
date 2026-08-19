# Browser Debug Agent

[![Validate](https://github.com/asterd/browser-debug-agent-skill/actions/workflows/validate.yml/badge.svg)](https://github.com/asterd/browser-debug-agent-skill/actions/workflows/validate.yml)

An open Agent Skill for browser debugging, browser automation, UI testing, and browser-visible regression verification. It is compatible with Codex, Claude Code, Kiro, Cursor, Gemini CLI, GitHub Copilot, OpenCode, and other hosts that support the Agent Skills format.

It turns browser-facing development into an evidence-led repair loop:

```text
reproduce -> observe -> diagnose -> patch -> relaunch -> verify
```

It is a debugging and verification policy, not another browser automation engine. It uses the project's existing Playwright/Puppeteer as the default full-featured runtime, Obscura for quick localhost probes, and isolated Chrome/Chromium CDP when needed.

## Why this skill

Browser CLIs are increasingly good at navigation and interaction. The missing layer is often engineering judgment: establish an observable acceptance contract, find the first divergence, patch the causal source, and refuse to claim success until the browser scenario passes again.

The skill provides that lifecycle while keeping observations token-efficient: accessibility/DOM snapshots, element refs, console and network evidence before screenshots or traces.

When explicitly requested, it can also run the same scenario in a visible, isolated Playwright or Chrome session: fill safe test data, exercise controls and popups, resize viewports, inspect code against the observed behavior, and verify the result with structured evidence. Headless execution remains the default.

When the target requires authentication, the skill detects login redirects or 401/403 responses, asks for explicit user approval, and escalates to the user's real browser profile — read-only by default, with each mutation requiring separate authorization.

## What this is — and is not

- An **Agent Skill**: reusable browser-debugging guidance for Claude Code, Codex, Kiro, and other compatible coding agents.
- A companion to **Playwright**, **Chrome DevTools/CDP**, **Obscura**, and agent-oriented browser CLIs: it selects and orchestrates installed tooling rather than replacing it.
- **Not an MCP server**: it does not expose MCP tools itself. It can use installed DevTools or browser MCP/CLI tooling when that is the best available runtime.

Use it for terms and tasks such as browser debugging, UI bug fixing, frontend testing, browser automation, Playwright testing, Chrome DevTools diagnostics, console/network errors, responsive testing, visual regression verification, authenticated web app testing, and agentic browser testing.

## Install

The open [Agent Skills CLI](https://github.com/vercel-labs/skills) is the recommended installer because it already detects and supports Codex, Claude Code, Cursor, Gemini CLI, Kiro, GitHub Copilot, OpenCode, and many other hosts.

```bash
# Global, interactive host selection
npx skills add asterd/browser-debug-agent-skill -g

# Example: Codex and Claude Code, non-interactive
npx skills add asterd/browser-debug-agent-skill -g \
  --agent codex --agent claude-code --yes

# Kiro CLI, global
npx skills add asterd/browser-debug-agent-skill -g --agent kiro-cli --yes

# Kiro CLI, current project only: installs to .kiro/skills/
npx skills add asterd/browser-debug-agent-skill --agent kiro-cli --yes
```

> **Important for Kiro users:** You must pass `--agent kiro-cli` explicitly. Running `npx skills add ... --yes` without it installs only to `.agents/skills/` (the universal path), which Kiro does not read. Kiro discovers skills exclusively from `.kiro/skills/` (workspace) and `~/.kiro/skills/` (global).

From a local checkout:

```bash
# Inspect supported and detected hosts
./scripts/install.sh --list

# Interactive install: choose global/project scope, then agent hosts
./scripts/install.sh

# Same interactive chooser when stdin is redirected (for example curl | sh)
./scripts/install.sh --interactive

# Project-scoped install for selected hosts
./scripts/install.sh --scope project \
  --agent codex --agent claude-code --yes
```

The local installer supports `codex`, `claude-code`, `cursor`, `gemini-cli`, `kiro`, `github-copilot`, `opencode`, and the shared `universal` location. Kiro installs to `~/.kiro/skills/` globally (or `$KIRO_HOME/skills/`) and `.kiro/skills/` for a workspace. The local installer calls this host `kiro`; the Agent Skills CLI calls it `kiro-cli`.

For a local Kiro-only installation with this bundle, run `./scripts/install.sh --scope project --agent kiro --yes`. Its target is exactly `.kiro/skills/browser-debug-agent/`.

During an interactive installation, the script checks Obscura, project-local Playwright Chromium, and project-local Puppeteer. For each missing runtime it asks before downloading anything. Obscura installs as a user-local binary; Playwright and Puppeteer are added only to a project with `package.json`. Playwright is the default E2E choice; Puppeteer is offered for projects that need its programmatic CDP API.

It is also the updater. Re-run the same command after updating the checkout:

```bash
# Global install/update from the current checkout
./scripts/install.sh --agent codex --yes

# Kiro workspace install/update
./scripts/install.sh --scope project --agent kiro --yes

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
# Full discovery (install-time, probes /Applications/ paths)
./scripts/detect-browser-backend.sh

# Quick discovery (runtime, PATH-only, no filesystem probing)
./scripts/detect-browser-backend.sh --quick
```

The JSON result distinguishes:

- repository-local Playwright test runner;
- `agent-browser`;
- Playwright's `playwright-cli`;
- project-local Puppeteer;
- the experimental `chrome-devtools` CLI;
- Obscura;
- Chrome/Chromium CDP fallback.

Detection is only a capability probe — the full script is for install-time use. During a task, the skill uses lightweight `command -v` checks instead. A browser runtime is not installed automatically.

### Runtime hierarchy

| Priority | Runtime | Best for |
|---|---|---|
| 1 | Project Playwright/Puppeteer | Full interaction, HTTPS, status codes, viewport, accessibility |
| 2 | Obscura | Quick localhost HTTP probes (fetch, eval, screenshot) |
| 3 | Agent CLI | Snapshot/ref interaction when installed |
| 4 | Chrome/Chromium CDP | Chrome-specific work or fallback |

Obscura blocks private-network URLs such as `localhost` by default. For a local development server you own, use `obscura --allow-private-network fetch http://127.0.0.1:8080/`; do not enable that exception for untrusted destinations. Note: Obscura may not support HTTPS remote sites depending on the build — the skill falls back to Playwright or Chrome automatically.

## How the bundle is structured

```text
SKILL.md                              compact operating contract (92 lines)
references/browser-drivers.md        runtime choice, limitations, and effective patterns
references/debug-loop.md             failure escalation and regression radius
references/visual-qa.md              geometry and visual verification
references/token-economy.md          output minimization
references/session-recording.md      GIF/video recording protocol
scripts/detect-browser-backend.sh    install-time discovery (supports --quick for PATH-only)
scripts/install.sh                   multi-host installer and updater
tests/install-smoke.sh
tests/detector-smoke.sh
tests/fixture-app/index.html         self-contained browser smoke fixture
tests/repair-fixture/index.html      debug-loop repair demonstration
tests/chrome-devtools-demo/index.html  CDP interaction demo
.github/workflows/validate.yml
```

`SKILL.md` contains only guidance needed on every browser-debug task. Conditional backend, escalation, visual, and output-heavy detail is progressively disclosed through the references.

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
