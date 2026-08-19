# Token economy

## Evidence output cost

The evidence priority in `SKILL.md` step 3 defines what to collect first. This reference addresses how to keep that evidence cheap in token terms once collected.

Cost gradient (cheapest to most expensive output):

- exit code or single-line status;
- targeted grep or evaluation result;
- filtered console/network lines;
- focused source range or diff stat;
- element screenshot or cropped artifact;
- full trace, full page screenshot, or unfiltered logs.

## Shell patterns

```bash
# Find project-owned errors only
rg -n "ErrorName|message fragment" src app packages test tests 2>/dev/null

# Compact changed-files view
git diff --stat && git diff --check

# Read targeted source
sed -n '120,220p' path/to/file

# Last useful server output
tail -n 80 .browser-debug/server.log

# Filter noisy logs
rg -i "error|warn|failed|exception|5[0-9]{2}|4[0-9]{2}" .browser-debug/server.log | tail -n 80
```

## Model behavior

Do not spend context restating observations that are already visible in command output. Convert raw evidence directly into the next tool action.

Prefer binary questions:

- Does the request fire?
- Is the element disabled?
- Is the route 200?
- Does width overflow?
- Does the targeted test pass?

Only widen data collection when the binary probe is insufficient.

## Screenshots

Screenshots are expensive evidence. Use them when visual appearance itself is part of correctness, not as a replacement for DOM queries.

## Traces

Traces are high-value but high-volume. Capture them for:

- race conditions;
- flaky interactions;
- multi-step state divergence;
- failures where console/network/DOM evidence is inconclusive;
- CI-only Playwright failures.

Avoid repeatedly opening or narrating the full trace. Extract the relevant failing action, error, request, or DOM state.
