# Runtime command reference

Use this reference directly — do not probe `--help` at the start of every task. If a companion skill for the runtime is installed, prefer its docs over this file.

## Companion skills (use when installed)

| Runtime | Companion skill | Install |
|---|---|---|
| playwright-cli | `microsoft/playwright-cli` | `npx skills add microsoft/playwright-cli` |
| Playwright tests | `currents-dev/playwright-best-practices-skill` | `npx skills add currents-dev/playwright-best-practices-skill` |

If the companion skill is present, use its full command reference. This file covers the essential subset for debugging.

---

## playwright-cli

Persistent browser session with accessibility snapshots and element refs. Refs invalidate on page change — always re-snapshot after navigation or interaction.

```bash
# Session lifecycle
playwright-cli open http://127.0.0.1:3000
playwright-cli open --browser=chrome        # use real Chrome
playwright-cli open --mobile                # mobile emulation
playwright-cli close

# Navigation
playwright-cli goto https://example.com
playwright-cli reload
playwright-cli go-back

# Snapshot and inspection
playwright-cli snapshot                     # accessibility tree with refs
playwright-cli snapshot --boxes             # include bounding boxes
playwright-cli snapshot --depth=4           # limit depth
playwright-cli find "Submit"               # search snapshot
playwright-cli eval "document.title"
playwright-cli eval "el => el.textContent" e5

# Interaction (use refs from latest snapshot)
playwright-cli click e15
playwright-cli fill e5 "user@test.com" --submit
playwright-cli type "search query"
playwright-cli press Enter
playwright-cli select e9 "option-value"
playwright-cli check e12
playwright-cli hover e4

# Viewport
playwright-cli resize 375 667
playwright-cli resize 1280 720

# Evidence
playwright-cli console                      # console messages
playwright-cli console error                # errors only
playwright-cli requests                     # network log
playwright-cli screenshot
playwright-cli screenshot e5                # element screenshot
playwright-cli screenshot --filename=bug.png

# Tabs
playwright-cli tab-list
playwright-cli tab-new https://example.com
playwright-cli tab-select 0

# Storage/auth
playwright-cli state-save auth.json
playwright-cli state-load auth.json
playwright-cli cookie-list
```

---

## Obscura

Lightweight native engine. Best for quick localhost HTTP probes. No persistent session — each command is a fresh page load.

```bash
# Basic fetch (returns rendered HTML)
obscura fetch http://127.0.0.1:3000/
obscura --allow-private-network fetch http://127.0.0.1:3000/

# Output modes
obscura fetch URL --dump text               # text only (minimal tokens)
obscura fetch URL --dump markdown           # markdown extraction
obscura fetch URL --dump links              # all links as list

# Screenshot
obscura fetch URL -s screenshot.png

# JS evaluation (use IIFE for multi-step)
obscura fetch URL --eval "document.title"
obscura fetch URL --eval "(function(){ document.querySelector('#btn').click(); return JSON.stringify({status: document.querySelector('#status').textContent}); })()"

# Combined: fetch + eval + screenshot
obscura --allow-private-network fetch http://127.0.0.1:3000/ \
  --eval "(function(){ return JSON.stringify({title:document.title, errors:[]}) })()" \
  -s /tmp/evidence.png

# Wait for content
obscura fetch URL --wait 5                  # wait up to 5s for settle
obscura fetch URL --wait-until load

# Selector (may return full HTML in some versions — prefer --eval)
obscura fetch URL --selector "#main"
```

### Limitations

- **No HTTPS remote sites** (TLS issue in some builds) — switch to Playwright/Chrome
- **No persistent session** — each fetch is a new page load
- **No native click/type** — use `--eval` with DOM manipulation
- **No HTTP status in output** — infer from page title/content
- **`--allow-private-network` required** for localhost/127.0.0.1

---

## Chrome/Chromium CDP

Direct Chrome DevTools Protocol. Use for Chrome-specific debugging, DevTools inspection, or as fallback when Playwright is unavailable.

### Launch

```bash
# Headless with remote debugging
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new \
  --disable-gpu \
  --no-first-run \
  --no-default-browser-check \
  --user-data-dir=/tmp/bda-profile-$$ \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  about:blank

# Headed (visible)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir=/tmp/bda-profile-$$ \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --window-size=1280,800 \
  http://127.0.0.1:3000/

# Linux
google-chrome --headless=new --remote-debugging-port=9222 \
  --user-data-dir=/tmp/bda-profile-$$ about:blank
```

### CDP endpoints

```bash
# Check if alive
curl -s http://127.0.0.1:9222/json/version | jq '.Browser'

# List targets (pages)
curl -s http://127.0.0.1:9222/json/list | jq '.[].url'

# Open new tab
curl -s http://127.0.0.1:9222/json/new?http://127.0.0.1:3000/

# Close tab
curl -s http://127.0.0.1:9222/json/close/TARGET_ID
```

### Connect via Playwright (recommended for interaction)

```javascript
const { chromium } = require('@playwright/test');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = await browser.contexts()[0].newPage();
await page.goto('http://127.0.0.1:3000/');
```

Once connected, use all Playwright APIs: click, fill, screenshot, viewport, console, network.

### Cleanup

```bash
# Kill owned Chrome process
kill $CHROME_PID
# Remove temp profile
rm -rf /tmp/bda-profile-$$
```

---

## Puppeteer

Programmatic CDP library for Node.js. Use when the project already has Puppeteer scripts/tests.

```javascript
const puppeteer = require('puppeteer');

// Launch
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

// Navigate
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle0' });
console.log(await page.title());

// Interaction
await page.click('#submit');
await page.type('#email', 'test@example.com');
await page.select('#role', 'admin');

// Viewport
await page.setViewport({ width: 375, height: 667 });

// Screenshot
await page.screenshot({ path: 'evidence.png' });
await page.screenshot({ path: 'element.png', clip: { x: 0, y: 0, width: 400, height: 300 } });

// Evaluate
const state = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  errors: window.__errors || []
}));

// Console monitoring
page.on('console', msg => console.log(msg.type(), msg.text()));

// Network monitoring
page.on('requestfailed', req => console.log('FAILED:', req.url()));
const response = await page.goto(url);
console.log('Status:', response.status());

// Wait
await page.waitForSelector('#loaded');
await page.waitForNavigation();

// Cleanup
await browser.close();
```

---

## Playwright (project-local, programmatic)

When the project has `@playwright/test` installed. Use for full test runs, multi-browser, or when playwright-cli is not available.

```javascript
const { chromium } = require('@playwright/test');

// Launch
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();

// Navigate + status
const response = await page.goto('http://127.0.0.1:3000/');
console.log('Status:', response.status());  // 200, 404, 500, etc.

// Interaction
await page.click('#submit');
await page.fill('#email', 'test@example.com');
await page.locator('#dropdown').selectOption('value');
await page.press('#input', 'Enter');

// Viewport resize
await page.setViewportSize({ width: 375, height: 667 });

// Accessibility snapshot
const a11y = await page.locator('body').ariaSnapshot();

// Screenshots
await page.screenshot({ path: 'full.png' });
await page.locator('#element').screenshot({ path: 'element.png' });

// Geometry
const box = await page.locator('#button').boundingBox();
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth > document.documentElement.clientWidth
);

// Console + Network
page.on('console', msg => { if(msg.type()==='error') console.log('ERROR:', msg.text()); });
page.on('requestfailed', req => console.log('FAILED:', req.url(), req.failure().errorText));

// Evaluate
const state = await page.evaluate(() => window.__APP_STATE__());

// Wait
await page.waitForSelector('#loaded');
await page.waitForURL('**/dashboard');

// Cleanup
await browser.close();
```

### Run existing tests

```bash
npx playwright test                         # all tests
npx playwright test tests/login.spec.ts     # specific file
npx playwright test -g "submit form"        # by title
npx playwright test --headed                # visible browser
npx playwright test --trace on              # capture trace
npx playwright show-report                  # view results
```
