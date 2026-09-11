# MCP tool patterns

Exact sequences for browser tasks using `browser-debug-agent` MCP tools. Follow these patterns — do not improvise tool order.

## Available tools

| Tool | Purpose |
|------|---------|
| `browser_open` | Open a URL, or re-point the live session: navigate (new `url`), resize (`width`/`height`), reload (`reload:true`). Headless + isolated by default; `visible:true` to watch, `profile:"user"` for logged-in state |
| `browser_stop` | Close session, kill browser, clean up |
| `browser_wait` | Wait for a selector to appear |
| `browser_snapshot` | Accessibility tree (structure + text + roles) |
| `browser_interact` | Click, fill, press, hover, select |
| `browser_evaluate` | Run JS in page context — the workhorse for text evidence |
| `browser_console` | Console log entries (errors, warnings) |
| `browser_network` | HTTP requests/responses with real method |
| `browser_screenshot` | PNG screenshot (inline image, ~15–25k tokens — expensive) |
| `browser_state` | Read cookies / localStorage, or set a cookie (`set: {...}`) |
| `browser_verify` | Run deterministic assertion manifest |
| `browser_doctor` | Health check + available backends |

## Evidence hierarchy — TEXT before pixels

A screenshot costs ~15–25k tokens. A DOM/console/network read costs a few hundred. Almost every frontend bug is diagnosable from text. Climb this ladder and STOP at the first level that answers the question:

1. `browser_console` — errors, stack traces (names the file + line)
2. `browser_network` — 4xx/5xx, wrong method, missing request
3. `browser_snapshot` — page structure, roles, text, what's present/missing
4. `browser_evaluate` — precise questions: element present? value? computed style? overflow?
5. `browser_screenshot` — ONLY when appearance itself is the answer

| Question | Cheap text answer (not a screenshot) |
|----------|--------------------------------------|
| Is the element there / visible? | `browser_evaluate`: `!!document.querySelector(sel) && document.querySelector(sel).offsetParent !== null` |
| Did the click/submit work? | `browser_evaluate` the resulting state, or `browser_console` / `browser_network` |
| Is there an error? | `browser_console` |
| What's on the page? | `browser_snapshot` |
| Is the form filled right? | `browser_evaluate`: field `.value` |
| Does the layout overflow? | `browser_evaluate`: `document.documentElement.scrollWidth > document.documentElement.clientWidth` |
| Where/how big is an element? | `browser_evaluate`: `JSON.stringify(el.getBoundingClientRect())` |
| What color / font / spacing? | `browser_evaluate`: `getComputedStyle(el).<prop>` |

## Critical rules

- **Text first.** Reach for console/network/snapshot/evaluate before ever considering a screenshot.
- **Snapshot before interact**: `browser_snapshot` to find selectors before click/fill.
- **Re-snapshot / re-evaluate after a resize, navigate, or reload**: layout changed.
- **Console after actions**: errors appear after the actions that cause them.
- **No "let me look" screenshots**, no repeated screenshots of the same state.

## Basic debug flow (text-first)

```
→ browser_open { url: "http://localhost:3000" }
→ browser_snapshot                     // structure — is the element there?
→ browser_interact { type: "click", selector: "#submit-btn" }
→ browser_evaluate { expression: "document.getElementById('status').textContent" }   // did it work?
→ browser_console                      // any JS errors?
→ browser_network                      // did the request fire, what status?
→ browser_stop
```

No screenshot needed — the DOM query, console, and network fully diagnose the flow. Add a screenshot only if the bug is about how it *looks*.

## Navigate / resize / reload — all via browser_open

The live session is re-pointed with `browser_open`, not separate tools:

```
→ browser_open { url: "http://localhost:3000/other" }   // navigate
→ browser_open { url: "http://localhost:3000", reload: true }   // reload
→ browser_open { url: "http://localhost:3000", width: 375, height: 812 }   // resize viewport
```

## Responsive testing

Re-point the viewport with `browser_open` (same url, new width/height). Prove layout with geometry numbers, not screenshots — capture ONE screenshot only for a viewport that actually shows a problem.

```
→ browser_open { url: "http://localhost:3000", width: 1280, height: 720 }
→ browser_evaluate { expression: "JSON.stringify({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })" }

→ browser_open { url: "http://localhost:3000", width: 768, height: 1024 }
→ browser_evaluate { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth" }

→ browser_open { url: "http://localhost:3000", width: 375, height: 812 }
→ browser_evaluate { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth" }

// ONLY if a viewport overflows or looks broken, ONE screenshot to document it:
→ browser_screenshot

→ browser_stop
```

Geometry numbers (`scrollWidth`, `clientWidth`, `getBoundingClientRect()`) prove overflow, clipping, and positioning as text — far cheaper than an image per viewport.

## Form interaction

```
→ browser_snapshot                     // see: textbox "Email", button "Save"
→ browser_interact { type: "fill", selector: "#email", value: "test@example.com" }
→ browser_interact { type: "click", selector: "#save-btn" }
→ browser_wait { selector: "#status" }
→ browser_evaluate { expression: "document.getElementById('status').textContent" }
→ browser_console                      // errors after submit
→ browser_network                      // verify POST succeeded
```

## Authenticated session (user's real Chrome profile)

When the target requires login:

```
→ browser_open { url: "https://app.example.com/dashboard", profile: "user" }
→ browser_snapshot
→ browser_state { what: "cookies" }        // inspect auth state (text, not screenshot)
→ browser_state { what: "localStorage" }   // inspect tokens
```

Use `profile: "user"` only when the page returns 401/403 or redirects to login and no test account exists. Default (`profile: "isolated"`) otherwise.

## Injecting auth tokens

```
→ browser_open { url: "http://localhost:3000" }
→ browser_state { set: { name: "session", value: "abc123", domain: "localhost" } }
→ browser_open { url: "http://localhost:3000", reload: true }
→ browser_snapshot
```

## Visible mode (watch the browser)

Only when the user asks to see/watch/demo:

```
→ browser_open { url: "http://localhost:3000", visible: true }
```

Headless is the default — faster, works in CI/SSH/containers.

## Wait for dynamic content

```
→ browser_interact { type: "click", selector: "#load-more" }
→ browser_wait { selector: ".results-loaded", timeout: 5000 }
→ browser_snapshot
```

## Full verification mode (geometry-driven, minimal screenshots)

```
→ browser_open { url: "http://localhost:3000", width: 1280, height: 720 }
→ browser_snapshot
→ [interact with every visible control]
→ browser_evaluate { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth" }
→ browser_console
→ browser_network

→ browser_open { url: "http://localhost:3000", width: 768, height: 1024 }
→ browser_evaluate { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth" }
→ browser_open { url: "http://localhost:3000", width: 375, height: 812 }
→ browser_evaluate { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth" }

// Screenshot ONLY the viewports that showed a real problem
→ browser_console                      // final: all errors
→ browser_stop
```

## Prove the fix

```
→ browser_verify {
    url: "http://localhost:3000",
    assertions: [
      { type: "console_errors", expect: "none", label: "no JS errors" },
      { type: "network_status", expect: { failed: "none" }, label: "no failed requests" },
      { type: "visible", expect: "Saved", label: "status shows Saved" }
    ]
  }
```

## Common mistakes

- Taking a screenshot to "have a look" before reading text evidence
- Screenshotting every viewport instead of using geometry numbers
- Interacting without a prior `browser_snapshot`
- Checking `browser_console` before the action that causes the error
- Using `profile: "user"` by default — exposes real credentials
- Forgetting `browser_stop` — leaves Chrome running
