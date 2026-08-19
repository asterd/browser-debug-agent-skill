# Debug loop and escalation tree

## Evidence ledger

Maintain a tiny internal ledger rather than prose notes:

```text
EXPECTED: submit -> /api/save 200 -> success banner
ACTUAL:   submit -> no request -> button remains disabled
FIRST DIVERGENCE: disabled state before click
EVIDENCE: button.disabled=true; form.valid=true; console clean
HYPOTHESIS: stale derived state / missing dependency
```

Update only when evidence changes.

## Decision tree

### Application does not start

1. Run native start/build command once.
2. Capture final actionable error lines.
3. Locate first project-owned stack frame/config reference.
4. Patch or resolve missing local prerequisite.
5. retry startup.
6. Do not enter browser loop until readiness succeeds.

### Blank or broken page

1. Check HTTP status/document response.
2. Check uncaught exceptions and console errors.
3. Check failed JS/CSS/data requests.
4. Inspect root DOM and hydration state.
5. Only then inspect CSS/rendering.

### Click/type action fails

1. Verify target exists.
2. Verify visible/enabled/editable state.
3. Inspect bounding box and hit-test point.
4. Inspect overlays/z-index/pointer-events.
5. Verify locator targets intended element.
6. Verify event fires and state transition occurs.
7. Avoid force-click unless testing intentional covered-element behavior.

### Incorrect data

1. Inspect initiating network request.
2. Compare request payload to UI state.
3. Inspect response status/body shape.
4. Find transformation/state boundary where data diverges.
5. Verify stale cache/race only after request correctness.

### Layout bug

1. Identify exact element and containing block.
2. Measure boxes and overflow.
3. Inspect computed styles and active media queries.
4. Check font load and intrinsic asset dimensions.
5. Test smallest failing viewport and nearest passing viewport.
6. Patch the layout rule, then verify both.

### Flaky behavior

1. Repeat exact scenario several times without changing code.
2. Correlate failures with network/timing/state.
3. Remove fixed sleeps from reproduction.
4. Wait on semantic readiness conditions.
5. Isolate storage/server state.
6. Use trace only if event order remains ambiguous.

## Patch failure policy

After patch 1 fails:
- compare symptom and evidence;
- determine whether hypothesis was falsified or implementation was incomplete.

After patch 2 fails in same causal area:
- stop local patching;
- inspect caller/callee/state ownership or backend compatibility;
- obtain a new piece of evidence before patch 3.

## Regression radius

Choose regression scope based on the changed boundary:

- pure style: target visual states + nearest component tests;
- component state: component tests + target e2e flow;
- shared hook/util: tests for direct consumers + target flow;
- routing/auth/global state: broader e2e subset;
- build/config: build + representative smoke route;
- API contract: API tests + all directly affected browser flows.
