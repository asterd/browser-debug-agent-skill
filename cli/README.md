# browser-debug-agent

Browser debugging and UI verification skill for AI coding agents. Works with Kiro, Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, OpenCode, and other hosts supporting the Agent Skills format.

## Install

```bash
# Install for your AI host (project-scoped)
npx browser-debug-agent init --ai kiro
npx browser-debug-agent init --ai claude
npx browser-debug-agent init --ai codex
npx browser-debug-agent init --ai cursor
npx browser-debug-agent init --ai all

# Global install
npx browser-debug-agent init --ai kiro --global

# Update existing installation
npx browser-debug-agent update

# Check available browser runtimes
npx browser-debug-agent doctor
```

## What it does

Turns browser-facing development into an evidence-led repair and verification loop:

```
reproduce → observe → diagnose → patch → relaunch → verify
```

It is a debugging and verification **policy**, not another browser automation engine. It orchestrates whatever browser tooling is already installed (Playwright, Chrome, Obscura) and drives the agent through a structured loop with explicit exit conditions.

## Supported hosts

| Host | Project path | Global path |
|------|-------------|-------------|
| Kiro | `.kiro/skills/` | `~/.kiro/skills/` |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| Codex | `.agents/skills/` | `~/.codex/skills/` |
| Cursor | `.agents/skills/` | `~/.cursor/skills/` |
| Gemini CLI | `.agents/skills/` | `~/.gemini/skills/` |
| GitHub Copilot | `.agents/skills/` | `~/.copilot/skills/` |
| OpenCode | `.agents/skills/` | `~/.config/opencode/skills/` |

## Links

- [GitHub](https://github.com/asterd/browser-debug-agent-skill)
- [Full documentation](https://github.com/asterd/browser-debug-agent-skill#readme)
