# Skill Evaluation — browser-debug-agent

> Evaluated: 2026-08-19
> Source: `/Users/ddurzo/Development/ai/browser-debug-agent-skill`
> Evaluator: skill-evaluation v2.1.0
> Framework: [Anthropic Skill Best Practices](https://claude.com/blog/lessons-from-building-claude-code-how-we-use-skills) + Matt Pocock's [writing-great-skills](https://www.youtube.com/watch?v=UNzCG3lw6O0)

## Summary

| Metric | Value |
|--------|-------|
| Overall Score | 92.32/100 |
| Grade | A |
| Category | product-verification |
| Invocation | model-invoked |
| Files | 13 source files evaluated |
| Criteria scored / N/A | 16 scored, 2 N/A |

## Scorecard

### Axis 1 — Trigger

| # | Criterion | Weight | Score | Notes |
|---|-----------|--------|-------|-------|
| 1 | Invocation design | 2x | 90/100 | Automatic invocation fits browser-visible implementation and debugging work; the three exits make autonomous execution useful (`SKILL.md:3`, `SKILL.md:8`). Trigger eval could not be run because this local skill is not registered in the current agent catalog. |
| 2 | Description quality | 2x | 88/100 | Starts with action verbs, names concrete browser-debug branches, and states the existing-tool boundary without enumerating backend syntax (`SKILL.md:3`). It remains moderately long because several adjacent failure classes must route here. |

### Axis 2 — Structure

| # | Criterion | Weight | Score | Notes |
|---|-----------|--------|-------|-------|
| 3 | Steps vs. reference clarity | 1x | 94/100 | Six ordered loop steps are separate from runtime and safety reference material (`SKILL.md:34-105`). |
| 4 | Branch-aware disclosure & pointers | 2x | 95/100 | Backend detail is required before the first browser command; escalation, visual QA, and token-economy references have precise conditional pointers (`SKILL.md:32`, `SKILL.md:88`, `SKILL.md:103`, `SKILL.md:111`). |
| 5 | Conciseness | 2x | 95/100 | Entrypoint is 129 lines, down from 377, while backend and failure-specific detail lives in four references (`SKILL.md`; `references/`). |
| 6 | Coherent scope | 1x | 92/100 | Primary action is browser product verification and repair (`SKILL.md:8-17`). Installation, upgrade, CI, and V2 direction stay outside the loaded entrypoint (`README.md:17-93`, `.github/workflows/validate.yml`). |

### Axis 3 — Steering

| # | Criterion | Weight | Score | Notes |
|---|-----------|--------|-------|-------|
| 7 | Leading words | 2x | 90/100 | “Evidence-led”, “first divergence”, and the three uppercase exits recur as compact process anchors (`SKILL.md:3`, `SKILL.md:8`, `SKILL.md:55`, `SKILL.md:121-127`). |
| 8 | Completion criteria & legwork | 2x | 96/100 | Every operational step ends with an observable completion statement and the final definition accounts for passed, unrun, and blocked checks (`SKILL.md:40`, `SKILL.md:51`, `SKILL.md:74`, `SKILL.md:82`, `SKILL.md:105`, `SKILL.md:121-127`). |
| 9 | Gotchas section | 2x | 85/100 | Failure traps are explicit—stale refs, forced clicks, arbitrary sleeps, backend mismatch, primary-profile attachment, and secret leakage—although they are co-located with their rules instead of under one Gotchas heading (`SKILL.md:74`, `SKILL.md:80`, `SKILL.md:113-119`). |
| 10 | Grounded in expertise | 2x | 95/100 | Guidance reflects actual snapshot invalidation, Playwright runner/agent-CLI separation, CDP endpoint risk, renderer boundaries, regression radius, and geometry checks (`references/browser-drivers.md:46-92`, `references/debug-loop.md:17-92`, `references/visual-qa.md:18-88`). |
| 11 | Avoids railroading | 1x | 94/100 | The skill defines task-fit defaults and capability boundaries while leaving native project commands, exact browser CLI, and regression radius adaptable (`SKILL.md:23-32`, `SKILL.md:92-105`). |

### Axis 4 — Pruning

| # | Criterion | Weight | Score | Notes |
|---|-----------|--------|-------|-------|
| 12 | No-ops (deletion test) | 2x | 90/100 | Most sentences change execution or stopping behavior. Remaining low-value candidates are presentation guidance in the final-response sentence (`SKILL.md:129`) and some README restatement (`README.md:11-15`), neither affects the core loop materially. |
| 13 | Single source of truth | 1x | 89/100 | Exit definitions now live only in `SKILL.md:121-127`; backend facts live in `references/browser-drivers.md`. The evidence hierarchy remains intentionally summarized in both `SKILL.md:64-72` and `references/token-economy.md:3-15`, leaving minor duplication. |
| 14 | Relevance & sediment | 1x | 96/100 | Obsolete assumed CLI shapes and the `playwright-core` false-positive detector were removed; current runtime names are isolated behind help probes (`SKILL.md:21-32`, `scripts/detect-browser-backend.sh:1-83`). Packaging-only material remains outside `SKILL.md`. |

### Conditional criteria

| # | Criterion | Weight | Score | Notes |
|---|-----------|--------|-------|-------|
| 15 | Setup flow | 1x | 97/100 | Scored by judgment because this product-verification skill clearly benefits from portable setup. The flow covers ecosystem install, seven local hosts, global/project scope, no-op comparison, remote update, recoverable backup, and foreign-target refusal (`README.md:17-93`, `scripts/install.sh:14-299`). |
| 16 | Memory mechanism | 1x | N/A | The evidence ledger is task-local diagnostic state, not durable business/runbook memory (`SKILL.md:53-62`). |
| 17 | Scripts & libraries | 1x | 98/100 | Detector and installer have smoke coverage for JSON escaping, precedence, idempotence, global/local upgrade, backup, foreign collision, and forced recovery; CI runs them on every push/PR (`tests/detector-smoke.sh`, `tests/install-smoke.sh:16-74`, `.github/workflows/validate.yml:10-23`). |
| 18 | On-demand hooks | 1x | N/A | No hook can enforce browser execution portably across the supported hosts; explicit validation commands are a better fit (`README.md:116-123`). |

## Trigger Eval

Skipped — sub-agents are available, but the target is a local project and is not registered in the current agent skill catalog. Running prompts without discoverability would measure installation state rather than description quality.

### Prompts tested

| # | Prompt | Expected | Triggered | Other skills |
|---|--------|----------|-----------|--------------|
| 1 | Fix the settings form: Save does nothing in the local app and I need you to verify the repair in a browser. | should-trigger | not run | N/A |
| 2 | Reproduce this flaky checkout click and use console/network evidence to find the cause. | should-trigger | not run | N/A |
| 3 | The mobile header overlaps the search field at 390px; patch it and prove the layout is correct. | should-trigger | not run | N/A |
| 4 | Run the existing Playwright failure, fix the source, and rerun the exact browser scenario. | should-trigger | not run | N/A |
| 5 | Check why this local route is blank even though the dev server returns 200. | should-trigger | not run | N/A |
| 6 | Write unit tests for this pure date formatter. | should-not-trigger | not run | N/A |
| 7 | Review this API schema for breaking changes without running the frontend. | should-not-trigger | not run | N/A |
| 8 | Summarize this public web page for me. | should-not-trigger | not run | N/A |
| 9 | Create a Figma component library for these tokens. | should-not-trigger | not run | N/A |
| 10 | Optimize this SQL query and explain its execution plan. | should-not-trigger | not run | N/A |

### Results

| Metric | Value |
|--------|-------|
| Should-trigger hit rate | not measured |
| Should-not-trigger leak rate | not measured |
| Other skills observed | none |

### Observations

Use this prompt set after publishing or installing the skill into an isolated evaluation host. Do not score a 0/5 caused solely by absent discovery metadata.

## Failure Modes Detected

| Mode | Evidence | Root cause | Defense |
|------|----------|------------|---------|
| Duplication (minor) | `SKILL.md:64-72`; `references/token-economy.md:3-15` | The core evidence order is useful inline, while the reference repeats and expands it for output-heavy tasks. | Keep the inline order normative; prune the reference to additions that are unique when it next changes. |
| Weak steering risk (unconfirmed) | Trigger eval skipped; `SKILL.md:3` | Invocation and runtime routing are well written but not empirically exercised in a discoverable host. | Run the saved positive/negative prompt set after publication and tighten only on observed misses or leaks. |

## Prioritized Actions

### 1. Run the saved trigger regression after publication

**Evidence:** Trigger Eval section; `SKILL.md:3`

**Fix:** Install the released skill in an isolated supported host, execute all ten prompts independently, and revise the description only if observed routing warrants it.

### 2. Collapse the remaining evidence-order duplication

**Evidence:** `SKILL.md:64-72`; `references/token-economy.md:3-15`

**Fix:** Keep the seven-item diagnostic order in the entrypoint and make `token-economy.md` contain only additional shell/output tactics.

### 3. Forward-test runtime routing before adding `bda`

**Evidence:** `SKILL.md:23-32`; `README.md:129-141`

**Fix:** Record realistic existing-Playwright, Obscura-fast-path, and Chrome-specific tasks; verify that agents choose the intended installed runtime before freezing adapter semantics.

## Bonus Patterns

| Pattern | Status | Notes |
|---------|--------|-------|
| Validation loops | Present | Exact reproduction and regression radius are mandatory (`SKILL.md:84-105`). |
| Output templates | Present | Compact evidence ledger and three exit formats (`SKILL.md:55-62`, `SKILL.md:121-127`). |
| Procedures over declarations | Present | Six-step evidence-led method adapts to the repository and runtime. |
| Defaults over menus | Present | Existing project tooling first, then compatible agent CLI/Obscura/CDP (`SKILL.md:23-30`). |
| Trace-checkable steering | Present | “Evidence-led”, “first divergence”, and uppercase exit states are distinctive. |

## Grade Scale

| Grade | Range | Meaning |
|-------|-------|---------|
| A | 80–100 | Production-quality, reference skill |
| B | 60–79 | Good skill, minor improvements needed |
| C | 40–59 | Functional but significant gaps |
| D | 20–39 | Needs substantial rework |
| F | 0–19 | Skeleton only, not production-ready |

---

*Generated by [skill-evaluation](https://github.com/fabricioctelles/skills) v2.1.0, merging the [Anthropic skill quality framework](https://claude.com/blog/lessons-from-building-claude-code-how-we-use-skills) with Matt Pocock's [writing-great-skills](https://www.youtube.com/watch?v=UNzCG3lw6O0) methodology.*
