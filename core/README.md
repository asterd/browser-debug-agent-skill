# browser-debug-agent

Browser debugging orchestrator for AI coding agents. One command to set up, one command to verify.

## Install

```bash
npx browser-debug-agent setup kiro
npx browser-debug-agent setup claude-code
npx browser-debug-agent setup codex
```

Or install globally:

```bash
npm install -g browser-debug-agent
bda setup kiro
```

## What it does

`bda setup` verifies your environment and configures everything:

- Checks Node.js >= 20
- Checks for Chrome/Chromium/Edge (the default backend uses your installed browser)
- Installs the browser-debug-agent skill for your AI host
- Configures the MCP server so your agent gets browser tools
- Sets up `.gitignore` and session directories

After setup, your AI agent can open browsers, take snapshots, interact with elements, check console/network, and run deterministic verifications — all without leaving the conversation.

## CLI

```bash
# Setup (one time per project)
bda setup kiro              # or: claude-code, codex, cursor, opencode, gemini-cli
bda setup kiro --global     # user-level instead of project-level

# Browser session (persistent daemon — survives between commands)
bda open http://localhost:3000
bda snapshot                # accessibility tree
bda interact click "#btn"
bda interact fill "#email" "test@example.com"
bda evaluate "document.title"
bda console                 # console log entries
bda network                 # request/response log
bda screenshot
bda stop

# Deterministic verification
bda verify manifest.json    # pass/fail with evidence

# Server management
bda server discover         # detect dev server from package.json
bda server start            # start and wait for readiness
bda server attach URL       # attach to existing server

# Session management
bda session list
bda session stop ID
bda session clean

# Health check
bda doctor
```

## Verify manifests

Create a JSON file with assertions:

```json
{
  "url": "http://localhost:3000",
  "viewport": { "width": 1280, "height": 720 },
  "assertions": [
    { "type": "visible", "expect": "Settings", "label": "Heading visible" },
    { "type": "console_errors", "expect": "none", "label": "No JS errors" },
    { "type": "network_status", "expect": { "failed": "none" }, "label": "No failed requests" },
    { "type": "js", "expect": "document.querySelectorAll('.error').length === 0", "label": "No error elements" }
  ]
}
```

Run: `bda verify manifest.json` — exits 0 on pass, 1 on fail.

## MCP tools (for AI agents)

When configured, your agent gets these tools:

| Tool | Description |
|------|-------------|
| `browser_open` | Open a URL — also navigates, resizes and reloads a live session |
| `browser_snapshot` | Accessibility snapshot |
| `browser_interact` | Click, fill, press, hover, select |
| `browser_evaluate` | Run JS in page |
| `browser_console` | Get console entries |
| `browser_network` | Get network entries |
| `browser_screenshot` | Take screenshot |
| `browser_wait` | Wait for a selector |
| `browser_state` | Read cookies / localStorage, or set a cookie (values masked) |
| `browser_verify` | Run assertion manifest |
| `browser_stop` | Close session |
| `browser_doctor` | Health check |

## Supported hosts

| Host | Skill path | MCP path |
|------|-----------|----------|
| Kiro | `.kiro/skills/` | `.kiro/settings/mcp.json` |
| Claude Code | `.claude/skills/` | `.claude/settings/mcp.json` |
| Codex | `.codex/skills/` | `.codex/settings/mcp.json` |
| Cursor | `.cursor/skills/` | `.cursor/mcp.json` |
| OpenCode | `.opencode/skills/` | `.opencode/mcp.json` |
| Gemini CLI | `.gemini/skills/` | `.gemini/settings/mcp.json` |

## Architecture

```
CLI / MCP Server
      │
      ▼
  Session Manager ──── Evidence (JSONL + redaction)
      │
      ▼
  Browser Daemon ───── Chrome CDP Adapter
      │
      ▼
  Chromium (headless)
```

- **Session Manager**: worktree-scoped sessions with ownership tracking
- **Browser Daemon**: persists between CLI commands via Unix socket
- **Evidence**: every action logged as JSONL with automatic secret redaction
- **Verify**: deterministic assertions — no LLM judgment in the loop

## Development

```bash
cd core
npm install
npm run build
npm test                    # unit + integration tests (`npm test`)
sh test-e2e.sh             # E2E with real browser
sh test-e2e-repair.sh      # broken→fixed repair loop
```

## License

MIT
