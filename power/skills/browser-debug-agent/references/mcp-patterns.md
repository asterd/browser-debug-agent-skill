# MCP tool patterns

Exact sequences for browser tasks using `browser-debug-agent` MCP tools. Follow these patterns — do not improvise tool order.

## Available tools

| Tool | Purpose |
|------|---------|
| `browser_open` | Open a URL — **and** navigate, resize, or reload a live session |
| `browser_stop` | Close session, kill browser, clean up |
| `browser_wait` | Wait for a selector to appear |
| `browser_snapshot` | Accessibility tree (structure + text + roles) |
| `browser_interact` | Click, fill, press, hover, select |
| `browser_evaluate` | Run JS in page context |
| `browser_console` | Console log entries (errors, warnings) |
| `browser_network` | HTTP requests/responses with real method |
| `browser_screenshot` | PNG screenshot (returned as inline image) |
| `browser_state` | Read cookies / localStorage, or set a cookie |
| `browser_verify` | Run deterministic assertion manifest |
| `browser_doctor` | Health check + available backends |

### browser_open does four jobs

Once a session is live, call it again without `headless`/`profile`/`backend` and it
reuses that session instead of restarting the browser:

```
browser_open { url }                      -> open (or navigate to) a URL
browser_open { width: 375, height: 667 }  -> resize the viewport
browser_open { reload: true }             -> reload the current page
browser_open { url, profile: "user" }     -> restart with a different profile
```

### browser_state reads and writes session state

```
browser_state {}                            -> cookies (values masked)
browser_state { what: "localStorage" }      -> localStorage (credential keys masked)
browser_state { set: { name, value, domain } } -> set a cookie
browser_state { what: "cookies", reveal: true } -> raw values, only with user consent
```

Values that look like credentials come back masked (`eyJh...5c (83 chars, masked)`).
That is deliberate: raw tokens in the transcript are a leak. Ask the user before
passing `reveal: true`.

## Critical rules

- **Snapshot before interact**: always `browser_snapshot` before click/fill. Use the tree to find selectors.
- **Snapshot after resize**: `browser_open` (width/height) changes layout. Old selectors may not be valid.
- **Snapshot after navigate**: navigation changes the page.
- **One action, then check**: after each action, snapshot or check console/network before proceeding.
- **Console after actions**: errors appear after the actions that cause them.

## Basic debug flow

```
→ browser_open { url: "http://localhost:3000" }
→ browser_snapshot                     // see the page structure
→ browser_interact { type: "click", selector: "#submit-btn" }
→ browser_evaluate { expression: "document.getElementById('status').textContent" }
→ browser_console                      // check for JS errors
→ browser_network                      // check for failed requests
→ browser_screenshot                   // visual evidence
→ browser_stop
```

## Responsive testing

Do NOT reload between viewports. Resize in place:

```
→ browser_open { url: "http://localhost:3000" }

// Desktop (1280x720)
→ browser_open { width: 1280, height: 720 }
→ browser_snapshot
→ browser_screenshot
→ browser_evaluate { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth" }

// Tablet (768x1024)
→ browser_open { width: 768, height: 1024 }
→ browser_snapshot                     // MANDATORY after resize
→ browser_screenshot

// Mobile (375x812)
→ browser_open { width: 375, height: 812 }
→ browser_snapshot                     // MANDATORY after resize
→ browser_screenshot
→ browser_evaluate { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth" }

→ browser_stop
```

## Form interaction

```
→ browser_snapshot
// See: textbox "Email", button "Save"

→ browser_interact { type: "fill", selector: "#email", value: "test@example.com" }
→ browser_interact { type: "click", selector: "#save-btn" }
→ browser_wait { selector: "#status" }
→ browser_evaluate { expression: "document.getElementById('status').textContent" }
→ browser_console                      // check for errors after submit
→ browser_network                      // verify POST request succeeded
```

## Authenticated session (user's real Chrome profile)

When the target page requires login/authentication:

```
→ browser_open { url: "https://app.example.com/dashboard", profile: "user", visible: true }
// Chrome opens with the user's real cookies, login, localStorage
→ browser_snapshot
→ browser_state                        // inspect auth state
→ browser_state { what: "localStorage" }                // inspect tokens
```

Use `profile: "user"` only when:
- The page returns 401/403 or redirects to login
- No test account is available
- The task explicitly requires real authenticated state

Default (`profile: "isolated"`) is always preferred for safety.

## Injecting auth tokens

If you have a token but don't want to use the full user profile:

```
→ browser_open { url: "http://localhost:3000" }
→ browser_state { set: { name: "session", value: "abc123", domain: "localhost" } }
→ browser_open { reload: true }                       // reload with the new cookie
→ browser_snapshot
```

## Visible mode (watch the browser)

When the user asks to see, watch, or demo:

```
→ browser_open { url: "http://localhost:3000", visible: true }
// Chrome window appears on screen — the user sees every action
→ browser_interact { type: "click", selector: "#menu" }
→ browser_screenshot                   // capture what the user sees
```

Use `visible: true` only when explicitly asked. Headless is faster and works everywhere (CI, SSH, containers).

## Wait for dynamic content

```
→ browser_interact { type: "click", selector: "#load-more" }
→ browser_wait { selector: ".results-loaded", timeout: 5000 }
→ browser_snapshot
```

## Full verification mode

```
→ browser_open { url: "http://localhost:3000" }

// 1. Desktop
→ browser_open { width: 1280, height: 720 }
→ browser_snapshot
→ [interact with every visible control]
→ browser_console
→ browser_network
→ browser_screenshot

// 2. Tablet
→ browser_open { width: 768, height: 1024 }
→ browser_snapshot                     // MANDATORY
→ browser_evaluate { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth" }
→ browser_screenshot

// 3. Mobile
→ browser_open { width: 375, height: 812 }
→ browser_snapshot                     // MANDATORY
→ browser_evaluate { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth" }
→ browser_screenshot

// 4. Final
→ browser_console                      // all errors across all viewports
→ browser_stop
```

## Common mistakes

- Interacting without a prior `browser_snapshot` → you don't know the page structure
- Using selectors from before a `browser_open` (width/height) → layout changed, elements moved
- Checking `browser_console` before actions → misses errors caused by the action
- Using `profile: "user"` by default → exposes real credentials unnecessarily
- Forgetting `browser_stop` → Chrome process stays alive
