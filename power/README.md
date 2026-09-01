# browser-debug-agent — Kiro Power

Packages the browser-debug-agent MCP server **and** its debugging skill as a single
[Kiro Power](https://kiro.dev/docs/powers/), following the open
[Agent Plugins 1.0.0](https://agent-plugins.org/) specification.

## Why a Power

Kiro activates a Power **only when the conversation matches its keywords**. Connecting
MCP servers permanently costs context on every request; a Power costs nothing until you
actually talk about a browser bug. The MCP surface here is 12 tools (~980 tokens) and it
loads on demand rather than up front.

## What's inside

```
power/
├── plugin.json                     # manifest + activation keywords
├── mcp.json                        # the MCP server (npx browser-debug-agent mcp-serve)
└── skills/browser-debug-agent/
    ├── SKILL.md                    # the evidence-led debugging method
    └── references/                 # 7 reference docs, loaded on demand
```

`skills/` is **generated** by `core/build-bundle.mjs` from the repo-root `SKILL.md` and
`references/`. Edit those, run `npm run build` in `core/`, and the Power picks up the
change. Never edit `power/skills/` by hand — it is overwritten.

## Requirements

- Google Chrome, Chromium, or Edge (the default backend drives your installed browser)
- Node.js >= 20 (for `npx`)

Nothing else is downloaded: the MCP server is fetched by `npx` on first use.

## Installing

**From a public GitHub repo** (how you'd share it):

1. Kiro → Powers panel (Ghosty icon with the lightning bolt) → import from URL
2. Paste `https://github.com/asterd/browser-debug-agent-skill`
3. Point it at the `power/` directory

**From a local folder** (how you test it before publishing):

1. Kiro → Powers panel → import from local folder
2. Select this `power/` directory

Kiro namespaces the MCP server on install, so it will not collide with an existing
`browser-debug-agent` entry in your own `mcp.json`.

## Publishing

A Power is published by pushing a public GitHub repository that contains `plugin.json`
— there is no separate package registry to upload to. This repo already qualifies once
pushed.

The curated gallery at [kiro.dev/powers](https://kiro.dev/powers/) lists partner Powers.
At the time of writing Kiro's docs describe browsing that gallery but do not document a
public submission process, so treat listing there as a separate, manual ask to Kiro.

Bumping the Power: edit `version` in `plugin.json` (semver) and push. Keep `name` stable
— changing it forces users to reinstall.

## Using it

Once installed, ask Kiro in plain language:

> The save button on the settings page does nothing. Debug it.

> Verify the checkout flow at mobile, tablet and desktop widths.

The Power activates on the keywords in `plugin.json`, loads the skill, and the agent
drives a real browser: reproduce → gather evidence → patch → re-verify.

## Relationship to the npm package

Same engine, two delivery paths:

| | Kiro Power | npm package |
|---|---|---|
| Install | Powers panel | `npm i -g browser-debug-agent` |
| Loading | on keyword match | always on |
| Hosts | Kiro | Kiro, Claude Code, Codex, Cursor, OpenCode, Gemini CLI |
| CLI (`bda`) | not included | included |

Use the Power in Kiro; use the npm package for other hosts, for CI, or when you want the
`bda` CLI. Installing both is fine — Kiro namespaces the Power's server separately.
