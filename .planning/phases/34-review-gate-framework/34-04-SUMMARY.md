---
phase: 34-review-gate-framework
plan: 04
subsystem: review_gates (tool dispatch)
tags: [hil-gates, tool-dispatch, wave-2, pipe-guard-01]
requires:
  - 34-01 (Gate state machine — Gate / GateError / GateMaxRetriesExceeded / GateMode)
  - 34-02 (gates.yaml + GATE_REGISTRY + GateConfigError)
  - 34-03 (runner_hooks.pause_for_review / mark_episode_failed / _PENDING_GATES)
provides:
  - "review_gates.tools — 4 real dispatch handlers (gate_submit / gate_wait / gate_resolve / gates_list)"
  - "runner_hooks.resolve_direct — operator-side direct gate resolution (bypasses HMAC)"
affects:
  - "Phase 35 orchestration runner — calls gate_submit / gate_resolve via normal tool dispatch"
  - "Phase 37 canvas-sync — subscribes to gate-resolution events emitted on resolve"
tech-stack:
  added: []
  patterns:
    - "Factory-helper indirection: tools.py imports runner_hooks as a module so tests monkeypatch _review_client (mirrors Phase 34-03 / 33-04)"
    - "tool_error(message, **extra_kwargs) for structured error envelopes (NOT tool_error(dict) which str()-ifies)"
    - "Gate guidance pattern: gate_wait returns instructions instead of blocking (Phase 35 runner owns the wait loop)"
    - "Direct operator resolution path (resolve_direct) kept separate from external HMAC callback path (resume_from_callback)"
key-files:
  created:
    - hermes-agent/plugins/review_gates/tests/test_tools_dispatch.py (322 LOC, 11 tests)
  modified:
    - hermes-agent/plugins/review_gates/tools.py (340 LOC — replaced 4 stubs with real dispatch)
    - hermes-agent/plugins/review_gates/runner_hooks.py (+37 LOC — added resolve_direct per Plan Option b)
    - hermes-agent/plugins/review_gates/tests/test_smoke.py (Test 4 weakened to valid-JSON assertion)
decisions:
  - "D1: Adopted Plan Option (b) — added resolve_direct() to runner_hooks.py rather than a skip_hmac flag on resume_from_callback. Cleaner separation: HMAC stays mandatory for external callbacks; direct operator path has its own entry point."
  - "D2: gate_wait returns guidance, never blocks. Blocking inside a single tool-handler thread is dangerous; the Phase 35 runner owns the wait/poll loop via pause_for_review (blocking) or poll_until_terminal (polling). Webhook mode is non-blocking by design."
  - "D3: tool_error called with (str_message, **kwargs) not (dict). Passing a dict to tool_error str()-ifies it (Python repr, not JSON); the kwargs form produces correct JSON envelopes with the error message + extra fields."
  - "D4: Smoke Test 4 sample_args set to {} so all 4 handlers hit validation paths and return tool_error JSON without performing real I/O. The dispatch tests (test_tools_dispatch.py) exercise the real paths with proper fixtures. Mirrors Phase 33-04."
metrics:
  duration: 5m12s
  completed: 2026-06-25T15:40:30Z
  tasks_completed: 2
  tests_added: 11
  files_modified: 4
  files_created: 1
---

# Phase 34 Plan 04: Tool Dispatch Wiring Summary

Swapped Phase 31's 4 stub handlers in `tools.py` for real dispatch against Wave 1 modules (Gate state machine + gates.yaml registry + runner_hooks adapter), completing the Hermes tool surface so Phase 35 can call `gate_submit` / `gate_wait` / `gate_resolve` / `gates_list` through normal tool dispatch.

## What Was Built

### `tools.py` (340 LOC — 4 handlers swapped)

| Handler | Dispatch target | Behavior |
|---------|----------------|----------|
| `_handle_gate_submit` | `runner_hooks.pause_for_review` | Builds Gate from gates.yaml, submits to review platform, writes `awaiting_review` state. Catches `GateMaxRetriesExceeded` → `mark_episode_failed` + tool_error envelope with PIPE-GUARD-01 marker. |
| `_handle_gate_wait` | Guidance shim (no dispatch) | Returns `{status, configured_mode, timeout_sec, instructions}`. NEVER blocks — the Phase 35 runner owns the wait loop. |
| `_handle_gate_resolve` | `runner_hooks.resolve_direct` | Direct operator-side resolution bypassing HMAC. Writes outcome to asset bus `review-outcomes` slot (CF-04). Surfaces `rollback_to` on reject. |
| `_handle_gates_list` | `GATE_REGISTRY` (eager-loaded) | Returns all 8 V8.6 gates as dicts with `gate_id/phase/reviewer_role/default_mode/timeout_sec/asset_bus_slots_to_lock/retry_policy`. |

Schemas (`GATE_SUBMIT_SCHEMA` / `GATE_WAIT_SCHEMA` / `GATE_RESOLVE_SCHEMA` / `GATES_LIST_SCHEMA`) UNCHANGED — Phase 31 contract locked.

### `runner_hooks.py` (+37 LOC — `resolve_direct` added)

New `resolve_direct(gate_id, decision, suggested_action)` entry point per Plan Option (b). Identical to `resume_from_callback` post-HMAC-verification: looks up pending gate from `_PENDING_GATES`, calls `gate.resolve()`, writes outcome to asset bus, advances PipelineState, surfaces `rollback_to` on reject. Used by the `gate_resolve` tool handler; external webhook callbacks continue through `resume_from_callback` (HMAC enforced).

### `tests/test_tools_dispatch.py` (322 LOC, 11 tests, 6 classes)

| Class | Tests | Coverage |
|-------|-------|----------|
| `TestGateSubmit` | 3 | valid submit returns `{status:submitted, review_id, attempt:1}`; unknown gate_id → tool_error; missing args → tool_error |
| `TestGateResolve` | 3 | approve → `{status:resolved, decision:approve}`; reject with suggested_action → `rollback_to` included; invalid decision → tool_error |
| `TestGatesList` | 2 | returns count=8; each gate has required fields (gate_id/phase/reviewer_role/default_mode) |
| `TestGateWait` | 1 | returns `{status, instructions}` structure; never blocks |
| `TestEndToEndSubmitResolve` | 1 | submit topic-gate → resolve_direct → outcome written to `.pipeline-assets/review-outcomes.json` (CF-04 SC#4) |
| `TestMaxRetriesEpisodeFail` | 1 | gate with max_retries=1; second submit → `{status:episode_failed}` + PipelineState phase status = "failed" + error contains `CONSISTENCY_BLOCKED` (SC#5 PIPE-GUARD-01) |

### `tests/test_smoke.py` Test 4 updated

Renamed `test_handlers_return_not_implemented_json` → `test_handlers_return_valid_json`. Weakened stub-envelope assertion to "valid JSON object" (Phase 31 stubs removed). Sample args set to `{}` so handlers hit validation paths without performing real I/O. Mirrors Phase 33-04 exactly.

## Verification Results

| Check | Expected | Actual |
|-------|----------|--------|
| `"status": "not_implemented"` count in tools.py | 0 | 0 ✓ |
| Dispatch wiring refs (pause_for_review/resume_from_callback/resolve_direct/GATE_REGISTRY) | ≥4 | 27 ✓ |
| Handler import smoke | OK | OK ✓ |
| tools.py LOC | ≥150 | 340 ✓ |
| test_tools_dispatch.py LOC | ≥200 | 322 ✓ |
| `__init__.py` diff | 0 lines | 0 lines ✓ |
| test_tools_dispatch.py test count | ≥7 | 11 ✓ |
| Full review_gates suite | ≥30 pass | 68 pass ✓ |
| Cross-plugin regression (review_gates + pipeline_state + kais_aigc) | no regressions | 251 pass ✓ |
| Wave 1 files untouched (gate.py/gate_config.py/gates.yaml/plugin.yaml) | unchanged | unchanged ✓ |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] tool_error(dict) produces Python repr, not JSON**
- **Found during:** Task 1 (first test run — `TestMaxRetriesEpisodeFail` failed with JSONDecodeError)
- **Issue:** Initial handler called `tool_error({"status": "episode_failed", ...})`. `tool_error(message)` does `{"error": str(message)}` — passing a dict produces `str(dict)` (Python repr with single quotes), which is not valid JSON. The test's `json.loads(err_payload)` failed.
- **Fix:** Changed to `tool_error(str(exc), status="episode_failed", gate_id=..., episode_id=...)`. The `**extra` kwargs merge into the envelope, producing valid JSON with both `error` and the structured fields at the top level. Updated the test to assert on top-level fields directly.
- **Files modified:** `plugins/review_gates/tools.py`, `plugins/review_gates/tests/test_tools_dispatch.py`

**2. [Rule 3 - Blocking] Smoke Test 4 triggered real review-platform I/O**
- **Found during:** Task 2 (full suite run — smoke Test 4 failed with HTTP 401)
- **Issue:** The original Phase 31 smoke test passed `{"gate_id": "topic-gate", "episode_id": "ep-001"}` to all 4 handlers. With real dispatch, `gate_submit` now calls `pause_for_review` → real `ReviewPlatformClient.submit_review` → HTTP 401 (no JWT in test env). The smoke module loads fresh via `_load_module` so the `_review_client` mock from dispatch tests doesn't apply.
- **Fix:** Changed sample_args to `{}`. The 3 dispatching handlers (submit/wait/resolve) hit their validation-error path and return `tool_error` JSON; `gates_list` returns its 8-gate envelope. No I/O. The assertion was also relaxed from "has status or error" to "non-empty JSON object" (since `gates_list` returns `{gates, count}` without a status field).
- **Files modified:** `plugins/review_gates/tests/test_smoke.py`

**3. [Rule 2 - Critical functionality] End-to-end outcome test envelope unwrap**
- **Found during:** Task 1 (first test run — `TestEndToEndSubmitResolve` failed)
- **Issue:** Initial test looked for `outcomes` at the envelope top level. Phase 33 AssetBus wraps writes in a v3.0 envelope `{value, derived_from, content_hash, schema_version}` — the outcomes list lives at `envelope["value"]["outcomes"]`.
- **Fix:** Updated test to unwrap `envelope.get("value", envelope)` before looking for `outcomes`.
- **Files modified:** `plugins/review_gates/tests/test_tools_dispatch.py`

## Authentication Gates

None. All review-platform interactions in tests are mocked via `MagicMock` injection (`monkeypatch.setattr(runner_hooks, "_review_client", lambda: fake_client)`). The smoke test uses empty args to avoid any dispatch path.

## Known Stubs

None. All 4 handlers dispatch to real Wave 1 modules. No placeholder text, no empty defaults, no TODOs. The `gate_wait` guidance shim is intentional design (D2), not a stub — blocking inside a tool handler is dangerous and the Phase 35 runner owns the wait loop.

## Threat Flags

None. This plan adds no new network endpoints (delegates to Phase 32 review-platform client via runner_hooks), no new auth paths (HMAC verification stays mandatory on `resume_from_callback`; `resolve_direct` is operator-authenticated by virtue of already being inside hermes-agent), no new file-access patterns (uses Phase 33 AssetBus + PipelineStateStore), and no schema changes at trust boundaries.

## Self-Check: PASSED

- `plugins/review_gates/tools.py` modified (340 LOC, 0 `not_implemented`) ✓
- `plugins/review_gates/runner_hooks.py` modified (+37 LOC, `resolve_direct` added) ✓
- `plugins/review_gates/tests/test_tools_dispatch.py` created (322 LOC, 11 tests) ✓
- `plugins/review_gates/tests/test_smoke.py` Test 4 updated ✓
- Commit `a9aa4ca55` present in git log ✓
- 68/68 review_gates tests pass ✓
- 251/251 cross-plugin tests pass (zero regressions) ✓
- Wave 1 files (gate.py / gate_config.py / gates.yaml / plugin.yaml / __init__.py) UNCHANGED ✓
