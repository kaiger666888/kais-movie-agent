---
phase: 34-review-gate-framework
plan: 00
type: overview
wave: 0
depends_on: ["31", "32", "33"]
files_modified: []
autonomous: true
requirements: ["GATE-NATIVE-01", "GATE-NATIVE-02", "GATE-NATIVE-03", "GATE-NATIVE-04", "GATE-NATIVE-05"]
---

<objective>
Phase 34 master plan — implement HIL review gate framework in
`hermes-agent/plugins/review_gates/`: Gate lifecycle state machine (3 modes),
8 V8.6 gates as YAML config, hermes-agent delegate_task approval adapter,
asset bus `review-outcomes` write-back, and max_retries episode-fail preserving
v4.0 PIPE-GUARD-01 CONSISTENCY_BLOCKED semantics.

Purpose: Provide the HIL layer for Phase 35 orchestration runner — runner calls
`pause_for_review` at phase tail, exits cleanly; resume happens via
`resume_from_callback` (webhook) or operator invocation of `gate_resolve`
(blocking).

Output: 3 new Python modules (`gate.py` / `gates.yaml` / `runner_hooks.py`) +
updated `tools.py` (4 stubs → real dispatch) + 4 new test files.
~600-900 LOC Python, ~35-45 tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/34-review-gate-framework/CONTEXT.md
@.planning/phases/34-review-gate-framework/PATTERNS.md
@.planning/phases/33-pipeline-state-asset-bus/PATTERNS.md

# Phase 31 skeleton (Plan 34-04 modifies tools.py)
@/data/workspace/hermes-agent/plugins/review_gates/__init__.py
@/data/workspace/hermes-agent/plugins/review_gates/tools.py
@/data/workspace/hermes-agent/plugins/review_gates/plugin.yaml

# Phase 32 review_platform (Plan 34-03 reuses JWT + HMAC verify_callback)
@/data/workspace/hermes-agent/plugins/kais_aigc/review_platform.py

# Phase 33 asset_bus + store (Plan 34-03 reuses for review-outcomes + episode-failed)
@/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py
@/data/workspace/hermes-agent/plugins/pipeline_state/store.py

# Node.js V8.6 review trigger logic (behavior reference)
# lib/pipeline.js:295-379 (remote review submission), 472-483 (awaiting_review event)
</context>

<plans>

## Wave 1 (parallel — disjoint file ownership)

| Plan | Module | Files Owned | Est. LOC | Est. Tests |
|------|--------|-------------|----------|------------|
| [34-01](./34-01-PLAN.md) | Gate state machine | `gate.py`, `tests/test_gate.py` | ~200-280 | 12-15 |
| [34-02](./34-02-PLAN.md) | 8 V8.6 gates YAML | `gates.yaml`, `tests/test_gates_config.py` | ~80-120 YAML + ~120 test | 6-8 |
| [34-03](./34-03-PLAN.md) | Runner hooks adapter | `runner_hooks.py`, `tests/test_runner_hooks.py` | ~200-280 | 10-14 |

## Wave 2 (sequential — depends on 34-01..03)

| Plan | Module | Files Owned | Est. LOC | Est. Tests |
|------|--------|-------------|----------|------------|
| [34-04](./34-04-PLAN.md) | tools.py dispatch wiring | `tools.py` (modified), `tests/test_tools_dispatch.py` (new), `tests/test_smoke.py` (Test 4 updated) | ~150-200 | 7-10 |

## Dependency Graph

```
Wave 1 (parallel):
  34-01 (gate.py state machine) ──────┐
  34-02 (gates.yaml + loader)  ───────┼──→ Wave 2:
  34-03 (runner_hooks.py adapter) ────┘    34-04 (tools.py wiring + integration tests)
```

**Why this works:**
- Wave 1 plans own disjoint files (`gate.py` ≠ `gates.yaml` ≠ `runner_hooks.py`) → fully parallel
- Wave 2 (34-04) imports from all three Wave 1 modules → depends on Wave 1 completion
- 34-03 (runner_hooks) imports `Gate` + `GateConfig` from 34-01 and `GATE_REGISTRY` from 34-02; it can stub these for its own unit tests, integration happens in 34-04

</plans>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| External review-platform → runner_hooks | HMAC-signed callback arrives from external service. Must verify before trusting decision payload. |
| Operator CLI → gate_resolve | Operator invokes `gate_resolve(gate_id, decision)` directly (blocking mode resume). Trust = operator is authenticated to hermes-agent. |
| Hermes tool dispatch → gate handlers | Tool args (`gate_id`, `episode_id`, `decision`) cross from LLM/tool layer. Untrusted shape. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-34-01 | Spoofing | Webhook callback body | mitigate | Reuse Phase 32 `review_platform.verify_callback` — HMAC-SHA256 + 5-min timestamp window. Reject on mismatch (do NOT auto-approve). |
| T-34-02 | Tampering | gates.yaml at load time | mitigate | Validate required fields (gate_id / phase / reviewer_role); reject unknown gate_id at submit; fail loud on missing YAML. |
| T-34-03 | Denial of Service | Polling-mode wait loop | mitigate | Enforce `timeout_sec` cap; never infinite loop. Log each poll attempt. |
| T-34-04 | Elevation | delegate_task resume path | mitigate | Only gates in PENDING status can be resolved; resuming an APPROVED gate raises GateError. |
| T-34-05 | Repudiation | review-outcomes write-back | mitigate | Every outcome record carries `resolved_at` ISO timestamp + `attempt` count + `reviewer_role` — full audit trail. |
| T-34-06 | Information Disclosure | gate payload_snapshot in review-outcomes | accept | Payload is creative content (script/shots) — no PII. Workdir is operator-local. |

**Single new third-party dep:** `pyyaml` (already transitive via plugin loader — D-34-03). No `[SLOP]`/`[ASSUMED]`/`[SUS]` packages.
</threat_model>

<verification>
Phase 34 complete when ALL of:
1. All 4 plan SUMMARYs exist in `.planning/phases/34-review-gate-framework/`
2. `pytest plugins/review_gates/tests/ -v` passes (Phase 31 tests + new tests)
3. `grep -c '"status": "not_implemented"' plugins/review_gates/tools.py` returns 0 (all stubs replaced)
4. `python -c "from plugins.review_gates import gate, runner_hooks; from plugins.review_gates.gate_config import load_gates; print('OK')"` exits 0
5. ROADMAP SC#1-5 verified in respective plan SUMMARYs
6. `GateMaxRetriesExceeded` raises on attempt > max_retries (preserves PIPE-GUARD-01)
</verification>

<success_criteria>
- [ ] SC#1: `review_gates/gate.py` — Gate lifecycle (submit → wait → resolve) + 3 modes (blocking/webhook/polling) — Plan 34-01
- [ ] SC#2: `review_gates/gates.yaml` — 8 V8.6 gates with full field set — Plan 34-02
- [ ] SC#3: blocking gate pauses (Event.wait); webhook gate uses HMAC callback resume (review_platform.py from Phase 32) — Plans 34-01 + 34-03
- [ ] SC#4: Resolution writes to asset bus review-outcomes slot; approve advances, reject+action rolls back — Plans 34-01 + 34-03
- [ ] SC#5: max_retries triggers episode-level fail (GateMaxRetriesExceeded + PipelineState failed status, PIPE-GUARD-01 semantics) — Plans 34-01 + 34-03
- [ ] Stub grep: 0 occurrences of `"status": "not_implemented"` in tools.py — Plan 34-04
</success_criteria>

<output>
Create `.planning/phases/34-review-gate-framework/34-{01,02,03,04}-SUMMARY.md`
when each plan completes. Master SUMMARY (`34-00-SUMMARY.md`) optional at phase
close.
</output>
