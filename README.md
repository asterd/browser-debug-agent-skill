# browser-debug-agent

Give your AI coding agent real browser debugging powers. Open pages, inspect the DOM, check console/network, click elements, and run deterministic verifications — all from chat.

Works with **Kiro**, **Claude Code**, **Codex**, **Cursor**, **OpenCode**, and **Gemini CLI**.

## Two ways to install

| | Kiro Power | npm package |
|---|---|---|
| **For** | Kiro users | every supported host, plus CI |
| **Install** | Powers panel in Kiro | `npm install -g browser-debug-agent` |
| **Tools load** | only when the conversation matches its keywords | always on |
| **Includes the `bda` CLI** | no | yes |

If you use Kiro, prefer the Power: it costs no context until you actually talk
about a browser bug. Everywhere else — and for CI — use the npm package. Having
both is fine; Kiro namespaces the Power's server separately.

## Quick start — npm (2 commands)

```bash
# 1. Install globally
npm install -g browser-debug-agent

# 2. Set up your project (picks your AI host automatically or specify it)
cd your-project
bda setup kiro          # or: claude-code, codex, cursor, opencode, gemini-cli
```

That's it. Restart your agent and ask it to debug your frontend.

### Without global install

```bash
cd your-project
npx browser-debug-agent setup kiro
```

### Keeping it up to date

```bash
bda update    # updates the package and refreshes every installed skill
```

## Quick start — Kiro Power

The Power bundles the same MCP server and skill into one installable package
([Agent Plugins 1.0.0](https://agent-plugins.org/)). Kiro loads it only when
your conversation mentions browser work, so it costs nothing the rest of the time.

1. In Kiro, open the **Powers** panel (Ghosty icon with the lightning bolt)
2. Import from URL: `https://github.com/asterd/browser-debug-agent-skill`
3. Point it at the `power/` directory

You can also import `power/` as a local folder to try it before sharing.

Details, and how to publish your own fork: [`power/README.md`](power/README.md).

## What happens after setup

Your AI agent now has 12 browser tools available via MCP (~980 tokens of schema —
deliberately compact, so it leaves room for other servers):

| Tool | What it does |
|------|--------------|
| `browser_open` | Open a URL — also navigates, resizes, and reloads a live session |
| `browser_snapshot` | Get the accessibility tree of the page |
| `browser_interact` | Click, fill, type, hover, select |
| `browser_evaluate` | Run JS in the page context |
| `browser_console` | Get console log entries |
| `browser_network` | Get request/response log |
| `browser_screenshot` | Capture page or element |
| `browser_wait` | Wait for a selector to appear |
| `browser_state` | Read cookies / localStorage, or set a cookie (values masked) |
| `browser_verify` | Run deterministic assertions |
| `browser_stop` | Close the browser session |
| `browser_doctor` | Health check |

Plus a **debugging methodology skill** that teaches your agent to:
- Reproduce before editing
- Gather structured evidence (errors > console > network > DOM > geometry > pixels)
- Patch the smallest causal area
- Verify with browser-visible proof
- Never claim "fixed" without evidence

## Example conversations

> "The save button doesn't work on the settings page. Debug it."

Your agent will: open the page → click Save → check console for errors → inspect network for failed requests → find the bug → patch it → verify the fix with a real browser.

> "Verify that the login page works at mobile, tablet, and desktop viewports."

Your agent will: open the page at 375px, 768px, 1280px → check for overflow → verify all interactive controls → report pass/fail with evidence.

## CLI (for direct use)

You can also use `bda` directly from your terminal:

```bash
bda open http://localhost:3000     # open browser (persists between commands)
bda snapshot                       # accessibility tree
bda interact click "#submit"       # click a button
bda evaluate "document.title"      # run JS
bda console                        # see errors
bda network                        # see requests
bda screenshot                     # save PNG
bda verify checks.json             # deterministic assertions
bda stop                           # close

bda doctor                         # check environment
bda server discover                # detect dev server command
bda update                         # update bda and refresh installed skills
```

### Watching the browser, and authenticated sessions

```bash
bda open http://localhost:3000 --visible            # show the browser instead of headless
bda open https://app.internal --profile user        # reuse your real Chrome profile (quit Chrome first)
```

`--profile user` reuses your logged-in cookies and localStorage. bda never deletes that
profile and never process-kills by profile path when you use it. Treat it as a privileged
action: cookie and localStorage values stay masked unless you explicitly ask to reveal them.

## Verify manifests

Create `verify.json`:

```json
{
  "url": "http://localhost:3000",
  "assertions": [
    { "type": "visible", "expect": "Settings", "label": "Heading shows" },
    { "type": "console_errors", "expect": "none", "label": "No JS errors" },
    { "type": "network_status", "expect": { "failed": "none" }, "label": "No 4xx/5xx" },
    { "type": "js", "expect": "document.querySelector('.error') === null", "label": "No error UI" }
  ]
}
```

```bash
bda verify verify.json   # exits 0 on pass, 1 on fail
```

## Requirements

- **Node.js >= 20**
- **Google Chrome, Chromium, or Edge** — the default `chrome-cdp` backend drives your installed browser and needs no extra downloads. `bda setup` checks for it and tells you if it is missing.
- **Playwright** (optional) — only for `--backend playwright`. Install it yourself: `npm install -D playwright && npx playwright install chromium`.
- One of the supported AI hosts

## Using it in CI

`bda verify` is headless by default and exits 0 on pass, 1 on fail — usable as a pipeline gate:

```yaml
- run: npm install -g browser-debug-agent
- run: npx bda verify verify.json    # CI=true adds --no-sandbox automatically
```

Set `BDA_NO_SANDBOX=1` if you run in a container without the `CI` variable set.

## How it works

```
Your AI agent (Kiro, Claude Code, etc.)
         │
         ▼
    MCP Server (browser-debug-agent)
         │
         ▼
    Browser Daemon (persistent Chrome via CDP — Playwright optional)
         │
         ▼
    Your app (localhost)
```

- **Browser Daemon**: a persistent Chrome process (driven over CDP) that survives between tool calls. No cold start on every command.
- **Evidence JSONL**: every action is logged with automatic redaction of cookies, tokens, and credentials.
- **Session ownership**: only stops processes it started. Your dev server is safe.
- **Deterministic verify**: assertions produce pass/fail, no LLM judgment involved.

## Supported hosts

| Host | Setup command | Skill path | MCP config |
|------|--------------|-----------|------------|
| Kiro | `bda setup kiro` | `.kiro/skills/` | `.kiro/settings/mcp.json` |
| Claude Code | `bda setup claude-code` | `.claude/skills/` | `.claude/settings/mcp.json` |
| Codex | `bda setup codex` | `.codex/skills/` | `.codex/settings/mcp.json` |
| Cursor | `bda setup cursor` | `.cursor/skills/` | `.cursor/mcp.json` |
| OpenCode | `bda setup opencode` | `.opencode/skills/` | `.opencode/mcp.json` |
| Gemini CLI | `bda setup gemini-cli` | `.gemini/skills/` | `.gemini/settings/mcp.json` |

Add `--global` for user-level instead of project-level:

```bash
bda setup kiro --global
```

## Troubleshooting

```bash
bda doctor   # shows runtime versions, host status, active sessions
```

Common issues:
- **"Chrome not found"** → install Google Chrome, or point bda at another Chromium build
- **"Playwright not found"** → the playwright backend is opt-in: `npm install -D playwright && npx playwright install chromium`
- **"No browser session"** → your agent needs to call `browser_open` before other tools
- **MCP not connecting** → restart your AI host after running `bda setup`

## What's in this repo

| Path | What it is |
|---|---|
| `core/` | the `browser-debug-agent` npm package: MCP server, `bda` CLI, adapters |
| `power/` | the Kiro Power (manifest + MCP config + a generated copy of the skill) |
| `SKILL.md`, `references/` | the debugging method — the single source both paths ship |

`power/skills/` is generated from `SKILL.md` and `references/` by the build, so the
Power and the npm package can never ship different instructions. Edit the sources at
the repo root, then run `npm run build` in `core/`.

## Development

```bash
git clone https://github.com/asterd/browser-debug-agent-skill.git
cd browser-debug-agent-skill/core
npm install
npm run build
npm test              # unit + integration tests
sh test-e2e.sh        # real browser E2E
sh test-e2e-repair.sh # repair loop test
```

## License

MIT
