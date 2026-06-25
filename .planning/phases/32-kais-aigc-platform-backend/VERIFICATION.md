---
phase: 32-kais-aigc-platform-backend
verified: 2026-06-25T15:05:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 32: Kais-AIGC Platform Backend (Python clients) — Verification Report

**Phase Goal:** 4 个 Python 客户端 (gold_team / review_platform / canvas / jimeng) 实现完整 auth + degrade + mocked HTTP tests,kais_aigc plugin 暴露统一 tool surface 供 orchestration skill 通过 hermes-agent tool dispatch 调用 — 取代 Node.js lib/* + openclaw 中间层
**Verified:** 2026-06-25T15:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | gold_team.py 提交 17 类 task + async polling + batch + SSE + X-API-Key 认证 | VERIFIED | `gold_team.py:87` `DEFAULT_BASE_URL = "http://192.168.71.140:8002"` (CF-01); `:144` `h["X-API-Key"] = self._api_key` (CF-02); `:227` `submit_task`, `:272` `list_tasks`, `:292` `wait_for_task` (async polling loop with `DEFAULT_POLL_INTERVAL=5.0` :89), `:328` `submit_task_degraded`, `:378` `subscribe_events` (documented-degrade SSE envelope). 15/15 `test_gold_team.py` pass |
| 2 | review_platform.py JWT bearer + HMAC-SHA256 callback + 5min window | VERIFIED | `review_platform.py:96` `CALLBACK_TIMESTAMP_TOLERANCE_SEC = 300`; `:98` `JWT_LIFETIME_SEC = 300`; `:144` `jwt.encode({...HS256})` (CF-03); `:362` `hmac.new(...sha256).hexdigest()`; `:368` `hmac.compare_digest(expected, signature)` (CF-04); `:327-328` docstring specifies `sha256=<hex>` format + constant-time compare. 16/16 `test_review_platform.py` pass (incl. expired/future/tampered/wrong-format rejection tests) |
| 3 | canvas.py 走 HTTP API v2 + loadGraph 只读 + degrade (无 sqlite) | VERIFIED | `grep -ci sqlite canvas.py` → **0** (CF-05 / PIPE-INTEGRITY-01 preserved); `canvas.py:85` `API_PREFIX = "/api/canvas/v2"`; `:215` `save_canvas` → `POST /api/canvas/v2/save-v2`; `:244` `load_graph` (read-only); `:148-152` `_degrade` returns uniform envelope + WARNING log, never raises. 14/14 `test_canvas.py` pass |
| 4 | jimeng.py 6 subcommands + session rotation + exponential backoff | VERIFIED | `jimeng.py:49-54` endpoint table enumerates all 6 (`text2image`/`image2image`/`multimodal2video`/`multiframe2video`/`frames2video`/`image_upscale`); `:110` `ROTATE_AFTER_STRIKES = 3`; `:113` `BACKOFF_BASE_SEC = 1.0` (1s/2s/4s/8s/16s cap); `:123` `sleep_fn` injectable for tests; `:130` `KAIS_JIMENG_SESSION_ID` comma-separated rotation. 16/16 `test_jimeng.py` pass (incl. `test_call_rotates_session_after_3_strikes`, `test_call_retries_on_429_then_succeeds`) |
| 5 | 4 client 都 degrade + env var 配置 + tool dispatch 可用 | VERIFIED | 22 env-var refs across 4 clients (`KAIS_GOLD_TEAM_URL`/`KAIS_GOLD_TEAM_API_KEY`, `KAIS_REVIEW_URL`/`KAIS_REVIEW_JWT_SECRET`/`KAIS_REVIEW_CALLBACK_SECRET`, `KAIS_CANVAS_URL`, `KAIS_JIMENG_URL`/`KAIS_JIMENG_SESSION_ID`). `tools.py:15-18` imports all 4 client classes; `:190/:230/:244` dispatch bodies invoke real client methods. 16/16 `test_tools_dispatch.py` pass (incl. `test_gold_team_task_type_enum_has_17` — CF-06) |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Lines | Status | Details |
|----------|----------|-------|--------|---------|
| `plugins/kais_aigc/gold_team.py` | GoldTeamClient ≥150 LOC | 403 | VERIFIED | Wired: `tools.py:16` imports, `:190` uses |
| `plugins/kais_aigc/review_platform.py` | ReviewPlatformClient + HMAC ≥150 LOC | 380 | VERIFIED | Wired: `tools.py:18` imports |
| `plugins/kais_aigc/canvas.py` | CanvasClient ≥120 LOC | 281 | VERIFIED | Wired: `tools.py:15` imports, `:230` uses |
| `plugins/kais_aigc/jimeng.py` | JimengClient ≥150 LOC | 352 | VERIFIED | Wired: `tools.py:17` imports, `:244` uses |
| `plugins/kais_aigc/tools.py` | dispatch + 17-enum, contains `_gold_team_client` | 248 | VERIFIED | `:26` `_gold_team_client()` factory; 17-element enum confirmed by `test_gold_team_task_type_enum_has_17` |
| `tests/test_gold_team.py` | Mocked-HTTP tests | 15 tests | VERIFIED | 5 MockTransport refs |
| `tests/test_review_platform.py` | Mocked-HTTP + HMAC tests | 16 tests | VERIFIED | 3 MockTransport refs |
| `tests/test_canvas.py` | Mocked-HTTP tests | 14 tests | VERIFIED | 4 MockTransport refs |
| `tests/test_jimeng.py` | Mocked-HTTP + rotation tests | 16 tests | VERIFIED | 4 MockTransport refs |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| tools.py `_handle_kais_gold_team_submit` | `GoldTeamClient` | `from plugins.kais_aigc.gold_team import` | WIRED | tools.py:16, :190 `with _gold_team_client() as c: result = c.submit_task(...)` |
| tools.py `_handle_kais_review_submit` | `ReviewPlatformClient` | `from plugins.kais_aigc.review_platform import` | WIRED | tools.py:18 |
| tools.py `_handle_kais_canvas_sync` | `CanvasClient` | `from plugins.kais_aigc.canvas import` | WIRED | tools.py:15, :230 |
| tools.py `_handle_kais_jimeng_call` | `JimengClient` | `from plugins.kais_aigc.jimeng import` | WIRED | tools.py:17, :244 |

### Critical Findings Compliance

| CF | Requirement | File:Line | Status |
|----|-------------|-----------|--------|
| CF-01 | Port :8002 (not :8900) | gold_team.py:87 `DEFAULT_BASE_URL = "http://192.168.71.140:8002"` | COMPLIANT |
| CF-02 | X-API-Key header added | gold_team.py:139-144 `_auth_headers()` adds `h["X-API-Key"]` when key configured | COMPLIANT |
| CF-03 | JWT actually attached | review_platform.py:144 `jwt.encode({iat, exp, sub}, secret, "HS256")`; attached via `_make_jwt()` in request headers | COMPLIANT |
| CF-04 | HMAC 5min window + compare_digest | review_platform.py:96 `TOLERANCE=300`; :368 `hmac.compare_digest(expected, signature)` | COMPLIANT |
| CF-05 | Canvas save-v2 schema + no sqlite | canvas.py:0 sqlite refs; :215-241 `save_canvas` POSTs `{projectId, episodesId, graph}` to `/save-v2` | COMPLIANT |
| CF-06 | 17-element task_type enum in tools.py | tools.py:79-90 enum has 17 entries (verified by `test_gold_team_task_type_enum_has_17`) | COMPLIANT |
| CF-07 | Sync httpx throughout | all 4 clients import `httpx`; tests use `httpx.MockTransport`; no `aiohttp`/`requests` | COMPLIANT |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No `TBD`/`FIXME`/`XXX` markers in any Phase 32 file | — | — |
| (none) | — | No `NotImplementedError` stubs (Phase 31 stubs fully replaced) | — | — |
| (none) | — | No `subprocess`/`os.system`/Node.js bridges | — | — |
| (none) | — | No `pyproject.toml` modification (httpx + PyJWT already present) | — | — |

`grep -ri "raise NotImplementedError\|subprocess\|os.system" plugins/kais_aigc/{gold_team,review_platform,canvas,jimeng,tools}.py` → **0 hits**
All 7 Phase 32 commits verified NOT to touch `pyproject.toml`.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full Phase 32 suite | `python3 -m pytest plugins/kais_aigc/tests/ -v` | **85 passed, 0 failed, 1.19s** | PASS |
| Phase 31 regression (loader + smoke + pipeline_state + review_gates) | `python3 -m pytest plugins/kais_aigc/tests/test_loader_discovery.py plugins/kais_aigc/tests/test_smoke.py plugins/pipeline_state/tests/ plugins/review_gates/tests/ -v` | **24 passed, 0 failed, 1.71s** | PASS |
| Canvas sqlite absence | `grep -ci "sqlite" plugins/kais_aigc/canvas.py` | `0` | PASS |
| Task enum count | dynamic via test | `test_gold_team_task_type_enum_has_17` passes; 17 items enumerated | PASS |
| HMAC rejection tests | dynamic via test | expired/future/tampered/wrong-format all rejected (4 dedicated tests) | PASS |

### Probe Execution

Phase 32 has no dedicated `scripts/.../probe-*.sh` probes — verification exercised via pytest behavioral spot-checks above.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| GPU-DIRECT-01 | 32-01 | gold_team.py GoldTeamClient (17 task types, X-API-Key, async poll, batch, SSE, degrade) | SATISFIED | gold_team.py 403 LOC; 15 tests pass |
| GPU-DIRECT-02 | 32-02 | review_platform.py ReviewPlatformClient (JWT, HMAC, 5min window) | SATISFIED | review_platform.py 380 LOC; 16 tests pass |
| GPU-DIRECT-03 | 32-03 | canvas.py CanvasClient (HTTP v2, loadGraph read-only, degrade, no sqlite) | SATISFIED | canvas.py 281 LOC; 14 tests pass; 0 sqlite refs |
| GPU-DIRECT-04 | 32-04 | jimeng.py JimengClient (6 subcommands, rotation, backoff) | SATISFIED | jimeng.py 352 LOC; 16 tests pass |
| GPU-DIRECT-05 | 32-01..04 | all 4 clients degrade + env var config + mocked HTTP | SATISFIED | 22 env-var refs; 16 dispatch tests pass |
| GPU-DIRECT-06 (wiring half) | 32-05 | tools.py dispatches to real clients | SATISFIED | tools.py 248 LOC; 16 dispatch tests pass |

No orphaned requirements.

### Human Verification Required

None. All truths verified programmatically. Phase produces no UI; orchestration skill invocation will be exercised in Phase 35+ (downstream phase, not a Phase 32 gap).

### Gaps Summary

No gaps found. All 5 ROADMAP Success Criteria verified at code level + test level + wiring level. All 7 Critical Findings (CF-01..07) compliant. All 6 GPU-DIRECT requirements satisfied. No anti-patterns. No blocker debt markers. Phase 31 regression intact (24/24 pass).

### Phase 33/34 Readiness

- **Phase 33 (Pipeline State & Asset Bus):** READY — `pipeline_state` plugin skeleton intact (Phase 31), Phase 32 introduced no regressions (regression suite 24/24 pass).
- **Phase 34 (Review Gate Framework):** READY — `review_platform.py` HMAC verifier (`verify_callback`) and JWT bearer auth provide the callback primitives Phase 34 blocking/webhook gates require. `CALLBACK_TIMESTAMP_TOLERANCE_SEC = 300` + `compare_digest` are directly reusable.
- **Phase 35 (Orchestration Skill):** READY — `tools.py` exposes all 4 tools (`kais_gold_team_submit` / `kais_review_submit` / `kais_canvas_sync` / `kais_jimeng_call`) dispatching to real clients; hermes-agent tool registry integration verified via `test_tools_dispatch.py`.

### Concerns / Partial Items

None blocking. Minor note for downstream awareness:
- `subscribe_events()` (SSE) in gold_team returns a documented degrade envelope rather than streaming — by design (CONTEXT.md D-09), no SSE consumer exists in v5.0 orchestration. If Phase 35+ requires real streaming, the method body will need expansion; not a Phase 32 gap.

---

_Verified: 2026-06-25T15:05:00Z_
_Verifier: Claude (gsd-verifier)_
