---
phase: 32-kais-aigc-platform-backend
plan: 01
subsystem: kais_aigc/gold_team
tags: [python, httpx, gpu-client, degrade-first]
requires:
  - Phase 31 kais_aigc skeleton (tools.py schemas + __init__.py register)
provides:
  - GoldTeamClient (sync httpx client for gold-team :8002 GPU task API)
  - GoldTeamError (4xx + unrecoverable failures)
affects:
  - Plan 32-05 tools.py _handle_kais_gold_team_submit (dispatch target)
tech-stack:
  added: []
  patterns:
    - sync httpx.Client + httpx.MockTransport testing (mirrors microsoft_graph_client)
    - degrade-first envelope on 5xx/429/timeout/connect; raise on 4xx
    - env-var config read at construction time (D-06)
key-files:
  created:
    - /data/workspace/hermes-agent/plugins/kais_aigc/gold_team.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_gold_team.py
  modified: []
decisions:
  - "Default URL :8002 per REQUIREMENTS GPU-DIRECT-01 (CRITICAL-FINDING-01: Node.js ref used :8900)"
  - "X-API-Key header conditional on KAIS_GOLD_TEAM_API_KEY (CRITICAL-FINDING-02: Node.js ref removed auth)"
  - "task_type passed through as opaque string - 17-element enum lives in tools.py (Plan 32-05)"
  - "subscribe_events() returns documented degrade envelope - real SSE deferred to Phase 39"
  - "wait_for_task RAISES on failure/timeout (not degrade) - mirrors Node.js waitForTask semantics"
metrics:
  duration: ~12min
  completed: 2026-06-25
  loc:
    gold_team.py: 403
    test_gold_team.py: 290
  tests: 15
  commits: [5dd7d0b54]
---

# Phase 32 Plan 01: GoldTeamClient Summary

Python port of the Node.js `lib/gold-team-client.js` GPU task scheduler client — sync `httpx.Client` with X-API-Key hardening, `/api/v1/tasks` endpoint, and full degrade-first error contract.

## What Shipped

**`gold_team.py` (403 LOC)** — `GoldTeamClient` + `GoldTeamError`:

- **Public methods (mirrors Node.js ref):** `submit_task`, `get_task`, `list_tasks`, `wait_for_task`, `submit_task_degraded`, `verify_callback`, `ping`, `subscribe_events` (stub), `close`, `__enter__`, `__exit__`.
- **Central `_request` wrapper** enforces the degrade / raise contract per D-09:
  - `httpx.ConnectError` / `httpx.TimeoutException` / generic `httpx.HTTPError` → degrade envelope (never raises).
  - HTTP 5xx and 429 → degrade envelope.
  - HTTP 4xx → raises `GoldTeamError(status=...)` (caller bug).
  - Non-JSON 2xx → raises `GoldTeamError` (service bug).
- **`_unwrap` helper** extracts `data` from the `{"data": ...}` envelope, defensive against schema drift.
- **X-API-Key header** added conditionally in `_headers()` when `KAIS_GOLD_TEAM_API_KEY` is set (CRITICAL-FINDING-02).
- **`wait_for_task`** raises on `state=failed`, on poll timeout, or on degrade mid-poll — different contract from `submit_task` because by the time you have a `task_id`, a poll failure is a real failure (mirrors Node.js `waitForTask`).
- **`verify_callback`** uses `hmac.compare_digest` for constant-time comparison.
- **`subscribe_events`** returns a documented degrade envelope pointing at Phase 39 (CONTEXT.md Deferred Ideas — real SSE comes there).

**`test_gold_team.py` (290 LOC, 15 tests)** — `TestGoldTeamClient`:

- happy path submit / get / list / wait (4 tests)
- degrade paths: 503, 429, ConnectError, ReadTimeout (4 tests)
- raise path: 400 with `status` attribute check (1 test)
- wait_for_task: completes-on-done, raises-on-failed, times-out (3 tests)
- CRITICAL-FINDING-02 coverage: no X-API-Key header when env unset + `api_key=None` (1 test)
- `submit_task_degraded` swallows error (1 test)
- custom `callback_path` honored (1 test)
- `subscribe_events` documented degrade (1 test)

Every `GoldTeamClient` instance in the test file is built with `transport=httpx.MockTransport(handler)` — zero real network calls. `grep -c "httpx.Client()" test_gold_team.py` returns 0.

## CRITICAL-FINDINGS Resolution

| Finding | Resolution |
|---------|------------|
| **01** Node.js ref uses `:8900` | Python default is `http://192.168.71.140:8002` per REQUIREMENTS GPU-DIRECT-01 (authoritative). Endpoint path is `/api/v1/tasks` (not `/api/tasks`). Documented in module docstring. |
| **02** Node.js ref removed auth | `_headers()` injects `X-API-Key: <key>` whenever `KAIS_GOLD_TEAM_API_KEY` is set; absent when unset. Tested by `test_no_api_key_header_when_unset`. |

## Plan 32-05 Wiring Confirmation

`GoldTeamClient` exposes the surface Plan 32-05 needs to swap `_handle_kais_gold_team_submit` from stub to real dispatch — no schema renegotiation required:

```python
# In tools.py (Plan 32-05):
from plugins.kais_aigc.gold_team import GoldTeamClient, GoldTeamError

def _handle_kais_gold_team_submit(args: dict, **kw) -> str:
    with GoldTeamClient() as c:           # reads KAIS_GOLD_TEAM_URL/API_KEY env
        result = c.submit_task(
            task_type=args["task_type"],
            params=args.get("payload") or {},
        )
    # degrade envelopes flow through tool_result; GoldTeamError via tool_error
```

The `task_type` enum expansion (4 → 17 elements per CRITICAL-FINDING-06) stays in `tools.py` — the client is task-type-agnostic and accepts any string.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1 AST verification snippet assumed positional `__init__` args**
- **Found during:** Task 1 verification
- **Issue:** The plan's verification snippet inspected `init_node.args.args` for `transport`, but PATTERNS.md "Client Class Anatomy" prescribes `__init__(self, *, base_url=..., transport=...)` (keyword-only after `*`). The implementation correctly uses keyword-only args (matching PATTERNS.md), so the snippet's assertion failed.
- **Fix:** Updated the verification snippet to also inspect `args.kwonlyargs`. No code change to `gold_team.py` — the implementation matches PATTERNS.md exactly. The plan's intent (`transport` is an `__init__` parameter) is met.
- **Files modified:** none (verification-only adjustment)
- **Commit:** 5dd7d0b54

No other deviations. Plan executed as written.

## Verification Gates

- [x] Task 1 automated structure check (classes, methods, imports, env vars, transport kwarg, LOC ≥ 150) — PASS
- [x] `pytest plugins/kais_aigc/tests/test_gold_team.py -v` — 15/15 passed in 0.13s
- [x] `git diff pyproject.toml | wc -l` == 0 (no new deps — D-03, D-04 honored)
- [x] `grep -c "httpx.Client()" test_gold_team.py` == 0 (all MockTransport — no real network)
- [x] Per-task commit with `feat(kais_aigc): implement gold_team client (Phase 32-01)` — `5dd7d0b54`

## Self-Check: PASSED

- `plugins/kais_aigc/gold_team.py` exists — FOUND
- `plugins/kais_aigc/tests/test_gold_team.py` exists — FOUND
- commit `5dd7d0b54` — FOUND in `git log`
- 15 tests pass — verified via pytest run above
