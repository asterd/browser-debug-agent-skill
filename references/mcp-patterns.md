# MCP tool patterns

Exact sequences for common browser tasks using Playwright MCP tools. Follow these patterns — do not improvise tool order.

## Critical rules

- **Snapshot before interact**: always call `browser_snapshot` before any click/type/hover. Refs are only valid from the latest snapshot.
- **Snapshot after resize**: `browser_resize` invalidates all refs. Take a new snapshot immediately after.
- **Snapshot after navigate**: navigation changes the page. Old refs are dead.
- **One action, then verify**: after each meaningful action, snapshot or check console/network before the next action.

## Responsive testing (viewport sequence)

Do NOT reload the page between viewports. Resize in place:

```
→ browser_navigate { url: "http://localhost:3000" }
→ browser_snapshot                              // desktop refs

// Desktop check (1280x720)
→ browser_resize { width: 1280, height: 720 }
→ browser_snapshot                              // MUST re-snapshot after resize
→ browser_take_screenshot                       // desktop evidence
// interact with desktop refs here

// Tablet check (768x1024)
→ browser_resize { width: 768, height: 1024 }
→ browser_snapshot                              // NEW refs for tablet layout
→ browser_take_screenshot                       // tablet evidence
// check overflow: browser_evaluate { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth" }

// Mobile check (375x812)
→ browser_resize { width: 375, height: 812 }
→ browser_snapshot                              // NEW refs for mobile layout
→ browser_take_screenshot                       // mobile evidence
// check overflow, button reachability, text clipping
```

## Interaction workflow

```
→ browser_snapshot
  - textbox "Email" [ref=e3]
  - button "Submit" [ref=e7]

→ browser_type { ref: "e3", text: "test@example.com" }
→ browser_click { ref: "e7" }
→ browser_snapshot                              // verify the result
  - heading "Success" [ref=e12]
```

## Console + network check

```
→ browser_console_messages                      // get all console output
→ browser_network_requests                      // get all network activity
```

Call these AFTER the interaction sequence, not before. Errors appear after actions that cause them.

## Overflow and geometry check

```
→ browser_evaluate { expression: "JSON.stringify({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })" }
```

## Mobile emulation (alternative to resize)

For proper mobile emulation with touch/UA, launch with device config:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--device=iPhone 15"]
    }
  }
}
```

But for responsive testing during a debug session, `browser_resize` is sufficient and doesn't require restart.

## Full verification mode sequence

```
// 1. Navigate
→ browser_navigate { url: "http://localhost:3000" }

// 2. Desktop pass
→ browser_resize { width: 1280, height: 720 }
→ browser_snapshot
→ [interact with every visible control using refs]
→ browser_console_messages                      // check errors
→ browser_network_requests                      // check failures
→ browser_take_screenshot

// 3. Tablet pass
→ browser_resize { width: 768, height: 1024 }
→ browser_snapshot                              // MANDATORY after resize
→ browser_evaluate { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth" }
→ browser_take_screenshot

// 4. Mobile pass
→ browser_resize { width: 375, height: 812 }
→ browser_snapshot                              // MANDATORY after resize
→ [re-test critical interactions with NEW mobile refs]
→ browser_evaluate { expression: "document.documentElement.scrollWidth > document.documentElement.clientWidth" }
→ browser_take_screenshot

// 5. Final console check
→ browser_console_messages
```

## Common mistakes

- Using refs from before a resize → element not found. Always re-snapshot.
- Calling browser_click without a prior browser_snapshot → no valid refs.
- Assuming viewport change needs page reload → it doesn't. Just resize.
- Taking screenshot without resizing first → captures previous viewport size.
- Checking console before interactions → misses errors caused by the interaction.
