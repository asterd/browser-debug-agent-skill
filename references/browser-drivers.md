# Browser runtime strategies

Read this reference before issuing the first browser command in a task. The invariant is one conceptual loop regardless of runtime:

```text
doctor -> launch/attach -> open -> snapshot -> interact -> re-snapshot
       -> console/network/eval -> screenshot/trace when needed -> stop
```

## Capability probe

Run:

```bash
sh scripts/detect-browser-backend.sh
```

The output is discovery, not proof of compatibility. Run the selected command's `--version` and relevant `--help` before use because these CLIs evolve independently.

## Prefer existing project tooling

If the repository already has Playwright tests, use its local binary, config, `webServer`, `baseURL`, projects, fixtures, auth state, and snapshot conventions. Do not translate an existing test into another runtime.

Typical probe:

```bash
[ -x node_modules/.bin/playwright ] && node_modules/.bin/playwright --version
```

Use fail-fast and compact reporting while iterating. Add trace retention only for the decisive failure or when event order remains ambiguous.

### Puppeteer projects

Use an existing project-local Puppeteer setup when its scripts or tests own the failing flow. Puppeteer is a programmatic CDP library rather than an agent-oriented snapshot CLI, so prefer its existing project scripts or a narrow source-owned Node probe. Do not add it merely to replace an already working Playwright setup.

## Agent-oriented CLI runtimes

### agent-browser

Use when installed and an AI-oriented, persistent CDP session with JSON output is useful. Its preferred interaction is `open -> snapshot -i --json -> action by ref -> re-snapshot`. It also exposes console, errors, network, evaluation, screenshots, isolated sessions, and connection to an existing CDP endpoint.

Probe actual commands with:

```bash
agent-browser --version
agent-browser --help
agent-browser snapshot --help
```

### Playwright agent CLI

`playwright-cli` returns accessibility snapshots with element refs and invalidates refs when the page changes. Prefer refs observed in the latest snapshot; scope or depth-limit snapshots on complex pages.

Probe:

```bash
playwright-cli --version
playwright-cli --help
playwright-cli snapshot --help
```

The project-local `playwright` test runner and `playwright-cli` are different interfaces. Detection must not treat one as proof that the other is installed.

### Chrome DevTools CLI

The `chrome-devtools-mcp` package may expose the experimental `chrome-devtools` CLI. Use it when DevTools console/network/performance behavior or its persistent daemon is valuable. Request raw JSON when supported.

Probe:

```bash
chrome-devtools status
chrome-devtools --help
```

Do not assume every MCP tool is exposed by the CLI.

## Obscura

Obscura is a lightweight native engine with JavaScript, rendering, screenshots, and a CDP server. It is a strong fast path for supported fetch/evaluate/extract work and can serve a CDP endpoint for richer clients.

Probe installed syntax:

```bash
obscura --version
obscura --help
obscura fetch --help
obscura serve --help
```

Obscura blocks loopback, RFC1918, and link-local URLs by default as an SSRF defense. When testing a server the agent owns or the user explicitly identified as local, opt in for that command only:

```bash
obscura --allow-private-network fetch http://127.0.0.1:8080/
```

Do not set a blanket environment override or use this flag for an untrusted URL. The capability applies to private-network destinations, not merely the hostname `localhost`.

Web-platform compatibility is the boundary: if a failure could be renderer-specific, reproduce once in Chromium before changing application code. Do not use Obscura as final visual truth for a Chrome-specific defect.

## Chrome / Chromium CDP

Use Chrome for Chrome-specific rendering, extension work, DevTools diagnostics, or final compatibility verification. Launch a separate temporary profile, bind remote debugging to loopback, and prefer a dynamically selected free port.

Do not attach to a person's primary profile unless explicitly requested. A local debugging endpoint grants full browser control to other local processes; close it after the task.

## Headed interaction and responsive review

Use a headed session only when the user asks to watch or inspect the browser. This is an interaction mode, not a weaker form of verification.

1. State the target URL and the bounded scenario. Start from a known state.
2. Prefer the repository's Playwright setup when it has the route, fixtures, and browser configuration needed for the scenario. Run it headed only through its documented configuration or current CLI help. Otherwise launch isolated Chrome/Chromium with a temporary profile and loopback-only CDP.
3. Read the relevant UI code before broad exploration. Turn it into a compact checklist: inputs and validation, primary action, loading/error/success states, popup/dialog trigger and dismissal, focus/keyboard behavior, required requests, and named responsive viewport sizes.
4. Perform actions one at a time, re-snapshot after each meaningful page change, and capture console/network/DOM evidence for the first divergence. Use screenshots only as focused visual evidence.
5. Resize to the requested or code-relevant breakpoints; check semantic visibility, overflow, hit targets, geometry, and the interaction path at each viewport. Do not infer responsive correctness from one desktop screenshot.
6. Inspect the smallest causal source area before patching. After a change, reload/reset and repeat the same checklist in the same browser mode; confirm the regression with the cheapest applicable headless or project test too.

Visible sessions may fill safe test data and operate non-consequential controls. They do not authorize real account use, irreversible submissions, communication, payments, or deletion. Ask before any such step even if the user is watching.

## Selection matrix

| Task | Default | Verification boundary |
|---|---|---|
| Existing Playwright failure | Project-local Playwright | Same configured project/browser |
| Cheap extraction or JS probe | Obscura | Chromium if API/rendering matters |
| Ad-hoc agent interaction | Installed snapshot/ref CLI | Re-snapshot after page changes |
| Console/network/performance diagnosis | Chrome DevTools CLI/MCP | Preserve only filtered evidence |
| Pixel-perfect Chrome issue | Chrome/Chromium | Consistent OS/browser/fonts |
| Cross-browser requirement | Playwright projects | All requested engines |

## Backend-switch rule

Switch only after recording one of: unsupported capability, renderer discrepancy, protocol/CLI defect, or explicit compatibility coverage. An application failure alone is not evidence that the runtime is wrong.
