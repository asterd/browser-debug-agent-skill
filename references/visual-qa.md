# Visual QA protocol

## Goal

Use screenshots as visual proof, backed by DOM geometry and deterministic state.

## Before screenshot

Stabilize the page:

- wait for requested content, not arbitrary time;
- ensure loading indicators are complete unless testing them;
- disable or account for animations when project conventions permit;
- ensure fonts/assets are loaded;
- set a deterministic viewport;
- seed or isolate volatile data when possible.

## Geometry checks

For a target element `el`, evaluate compactly:

```js
(() => {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return {
    box: {x:r.x,y:r.y,w:r.width,h:r.height},
    display:s.display,
    position:s.position,
    overflow:s.overflow,
    zIndex:s.zIndex,
    visible: !!(r.width && r.height) && s.visibility !== 'hidden' && s.display !== 'none'
  };
})()
```

For overflow:

```js
({
  vw: document.documentElement.clientWidth,
  pageW: document.documentElement.scrollWidth,
  vh: document.documentElement.clientHeight,
  pageH: document.documentElement.scrollHeight
})
```

Horizontal `pageW > vw` is suspicious unless intentional.

## Occlusion check

For a clickable element, test the center point with `document.elementFromPoint`. If another unrelated element wins hit-testing, inspect stacking/overlay behavior.

## Responsive matrix

If requirements give viewports, use exactly those.

Otherwise for ordinary responsive UI use a minimal matrix such as:

- narrow/mobile;
- wide/desktop.

Add a breakpoint-adjacent width when the defect occurs around a media/container query boundary.

Do not multiply screenshots without a hypothesis.

## Screenshot policy

Capture:

- before image only when it helps establish the bug or compare a visual change;
- after image for visually meaningful fixes;
- failure screenshot automatically when a scenario breaks;
- element screenshot instead of full-page when the defect is local.

Inspect screenshot content visually. Do not treat successful file creation as verification.

## Visual regression

If the repo already uses Playwright screenshot assertions or another golden-image tool:

1. reproduce against current baseline;
2. inspect actual/expected/diff;
3. patch source;
4. rerun comparison;
5. update baseline only when the intended design change is established.

Rendering varies by OS/browser/font environment. Generate and compare baselines under consistent conditions.

## Layout acceptance examples

A layout fix may require all of:

- no horizontal overflow;
- target control inside viewport;
- no unintended overlap;
- text not clipped;
- correct responsive visibility;
- interactive target receives pointer hit;
- screenshot visually matches intended composition.
