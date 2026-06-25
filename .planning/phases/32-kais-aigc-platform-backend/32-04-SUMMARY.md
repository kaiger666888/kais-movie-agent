---
phase: 32-kais-aigc-platform-backend
plan: 04
subsystem: kais-aigc/jimeng-client
tags: [python, httpx, jimeng, gpu-direct, rate-limit, retry]
requires:
  - "32-01 (plugin scaffold — __init__.py, tools.py, plugin.yaml)"
provides:
  - "JimengClient + JimengError — 6 subcommands + session rotation + exp backoff"
  - "SUBCOMMAND_ENDPOINTS dispatch table (Plan 32-05 wires into _handle_kais_jimeng_call)"
affects:
  - "plugins/kais_aigc/tools.py (Plan 32-05 swaps _handle_kais_jimeng_call stub → real dispatch)"
tech-stack:
  added: []
  patterns:
    - "httpx.MockTransport test injection (D-04)"
    - "sleep_fn callable injection for offline backoff tests"
    - "Degrade envelope (D-09) — returned, not raised"
    - "Bearer auth header from KAIS_JIMENG_SESSION_ID (comma-sep for rotation)"
key-files:
  created:
    - "/data/workspace/hermes-agent/plugins/kais_aigc/jimeng.py"
    - "/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_jimeng.py"
  modified: []
decisions:
  - "Default base URL http://localhost:5100 (REQUIREMENTS GPU-DIRECT-04 wins over Node.js ref :8003 — CRITICAL-FINDING-04)"
  - "Subcommand-agnostic dispatcher — caller injects functionMode for multimodal2video; specialized composition methods (submitSeedanceTask/omniReferenceVideo/etc.) deferred to Phase 35/36"
  - "Inline exponential backoff (no tenacity dep) — matches Node.js ref implementation"
metrics:
  duration: ~25min
  completed: 2026-06-25
  tasks_completed: 2
  files_created: 2
  client_loc: 352
  test_loc: 324
  tests_passed: 16
---

# Phase 32 Plan 04: Jimeng Client Summary

**One-liner:** Python port of the jimeng-free-api contract — 6-subcommand dispatcher with session rotation (3-strike threshold) and exponential backoff (1s→16s cap) on 429, degrade envelope on terminal failure.

## Deliverables

| Artifact | Path | LOC | Purpose |
|----------|------|-----|---------|
| `jimeng.py` | `/data/workspace/hermes-agent/plugins/kais_aigc/jimeng.py` | 352 | JimengClient + JimengError + SUBCOMMAND_ENDPOINTS |
| `test_jimeng.py` | `/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_jimeng.py` | 324 | 16 mocked-HTTP tests (TestJimengClient) |

## CRITICAL-FINDING-04 Resolution

- Default base URL: **`http://localhost:5100`** per REQUIREMENTS GPU-DIRECT-04 (Node.js ref's `:8003` is the deprecated default — overridden).
- 6-subcommand contract ported; deprecated composition methods (`submitSeedanceTask`, `omniReferenceVideo`, `generateIdentityVerification`, `generateWithSeedLock`, `generateKeyframesBatch`, `generateCharacterAnchor`) intentionally NOT ported — those belong to Phase 35/36 orchestration.
- Auth: `Authorization: Bearer <session_id>` header (matches Node.js ref).

## 6 Subcommands → Endpoint Map (GPU-DIRECT-04)

| Subcommand | Method | Path | Default Model |
|------------|--------|------|---------------|
| `text2image` | POST | `/v1/images/generations` | `jimeng-5.0` |
| `image2image` | POST | `/v1/images/compositions` | `jimeng-5.0` |
| `multimodal2video` | POST | `/v1/videos/generations` | `jimeng-video-seedance-2.0` |
| `multiframe2video` | POST | `/v1/videos/generations` | `jimeng-video-seedance-2.0` |
| `frames2video` | POST | `/v1/videos/generations` | `jimeng-video-3.5-pro` |
| `image_upscale` | POST | `/v1/images/upscales` | `jimeng-upscale-4x` |

The client is **subcommand-agnostic** — it dispatches based on `(method, path)` from `SUBCOMMAND_ENDPOINTS` and passes the caller's payload through verbatim (defaulting only `model`). Subcommand-specific fields like `functionMode="omni_reference"` (Seedance omni-reference mode for multimodal2video) are caller-injected, NOT auto-injected by the client. This keeps the client a thin transport layer; higher-level orchestration logic lives in Phase 35/36.

## Session Rotation Logic

- `KAIS_JIMENG_SESSION_ID` env var parsed as comma-separated list (empty entries filtered).
- Strike counter `_rate_limit_count` increments on every 429.
- After `ROTATE_AFTER_STRIKES` (3) consecutive strikes AND >1 sessions configured → `_rotate_session()` advances `_session_index = (_session_index + 1) % len(sessions)`, swaps `_session_id`, resets strike counter.
- Single-session config: rotation is a no-op; strikes accumulate until `max_retries` exhausted → degrade envelope.
- Test `test_call_rotates_session_after_3_strikes` verifies: 3 requests on `sess-A`, 4th request uses `sess-B`.

## Backoff Schedule (1s, 2s, 4s, 8s, 16s cap)

```python
wait = min(BACKOFF_BASE_SEC * 2**rate_limit_count, BACKOFF_CAP_SEC)
# strike 0 → 1s, strike 1 → 2s, strike 2 → 4s, strike 3 → 8s, strike 4+ → 16s
```

Matches Node.js ref `Math.min(1000 * Math.pow(2, n), 16000)`. Inline implementation (no tenacity dependency — D-03 / "no new deps").

Additional sleeps (mirroring Node.js ref):
- 1-second inter-request spacing (`RATE_LIMIT_SLEEP_SEC`) — `_enforce_rate_spacing()`.
- 2-second sleep on `ConnectError`/`TimeoutException` before retry (`CONNECT_RETRY_SLEEP_SEC`).
- 5-second sleep on HTTP 45 unusual status (`UNUSUAL_STATUS_SLEEP_SEC`).

## Test Injection Pattern

```python
JimengClient(
    base_url="http://test-jimeng",
    session_id="sess-1,sess-2",
    transport=httpx.MockTransport(handler),  # no real network
    sleep_fn=lambda s: None,                  # no real sleeping
    max_retries=N,                            # per-test override
)
```

- `transport` kwarg → httpx MockTransport handler (mirrors `tests/tools/test_microsoft_graph_client.py`).
- `sleep_fn` kwarg → no-op callable; tests stay sub-second.
- `_client(handler, **kw)` factory allows per-test `session_id` / `sleep_fn` / `max_retries` overrides.

## Test Coverage (16 tests, all pass)

| # | Test | Verifies |
|---|------|----------|
| 1 | `test_call_text2image_happy_path` | POST `/v1/images/generations`, model=`jimeng-5.0`, `Bearer sess-1`, unwraps `data` |
| 2 | `test_call_image2image_uses_compositions_endpoint` | Routes to `/v1/images/compositions` |
| 3 | `test_call_multimodal2video_passes_file_paths` | Routes to `/v1/videos/generations`, passes `file_paths` + caller-set `functionMode` |
| 4 | `test_call_frames2video_routes_to_video_generations` | Routes to `/v1/videos/generations` |
| 5 | `test_call_image_upscale_routes_to_upscales_endpoint` | Routes to `/v1/images/upscales` |
| 6 | `test_call_retries_on_429_then_succeeds` | 429 → 1s backoff → retry → 200 succeeds |
| 7 | `test_call_rotates_session_after_3_strikes` | 3 strikes on `sess-A` → 4th request uses `sess-B` |
| 8 | `test_call_degrades_when_max_retries_exhausted` | Continuous 429s single session → degrade envelope |
| 9 | `test_call_degrades_on_503` | 5xx → immediate degrade (no retry) |
| 10 | `test_call_raises_on_400` | 4xx → `JimengError` (caller bug) |
| 11 | `test_call_raises_on_404` | Non-429 4xx also raises |
| 12 | `test_call_unknown_subcommand_raises` | `JimengError` mentions "unknown subcommand" |
| 13 | `test_call_degrades_on_connect_error` | ConnectError → retry once → degrade |
| 14 | `test_subcommand_endpoints_covers_all_six` | Sanity: SUBCOMMAND_ENDPOINTS keys match GPU-DIRECT-04 |
| 15 | `test_payload_model_override_wins` | Caller `model` overrides subcommand default |
| 16 | `test_payload_not_mutated` | Caller's payload dict is not mutated |

Run: `cd /data/workspace/hermes-agent && python3 -m pytest plugins/kais_aigc/tests/test_jimeng.py -v` → **16 passed in 0.14s**.

## Plan 32-05 Hand-off

Plan 32-05 can wire `JimengClient` into `_handle_kais_jimeng_call` (currently a Phase 31 stub) via:

```python
from plugins.kais_aigc.jimeng import JimengClient, JimengError

def _handle_kais_jimeng_call(args: dict, **kw) -> str:
    subcommand = args.get("subcommand")
    payload = args.get("payload") or {}
    try:
        with JimengClient() as c:  # reads KAIS_JIMENG_URL + KAIS_JIMENG_SESSION_ID
            result = c.call(subcommand, payload)
        return tool_result(result)
    except JimengError as exc:
        return _kais_tool_error("jimeng", exc)
```

The `KAIS_JIMENG_CALL_SCHEMA` declared in Phase 31 is unchanged.

## Deviations from Plan

None — plan executed exactly as written. Minor interpretation: the plan's literal AST check `'import requests' not in src` was overly broad (matched `httpx.ConnectError` substrings); the intended meaning ("don't import the requests library") is satisfied — verified via `ast.walk` that no `requests` or `tenacity` modules are imported.

## Self-Check

- [x] `plugins/kais_aigc/jimeng.py` exists — 352 LOC, all required methods present.
- [x] `plugins/kais_aigc/tests/test_jimeng.py` exists — 324 LOC, 16 tests.
- [x] Commit `234046a36` exists (Task 1).
- [x] Commit `31d26c6b1` exists (Task 2).
- [x] All 16 tests pass.
- [x] No `pyproject.toml` changes (no new deps).

## Self-Check: PASSED
