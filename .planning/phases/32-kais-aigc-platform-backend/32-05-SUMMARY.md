---
phase: 32-kais-aigc-platform-backend
plan: 05
subsystem: kais_aigc
tags: [wiring, dispatch, tools.py, wave-2]
requires:
  - 32-01  # gold_team.py
  - 32-02  # review_platform.py
  - 32-03  # canvas.py
  - 32-04  # jimeng.py
provides:
  - "tools.py with 4 real dispatch handlers wired to Wave 1 clients"
  - "17-element task_type enum in KAIS_GOLD_TEAM_SUBMIT_SCHEMA"
  - "_kais_tool_error exception mapper"
  - "16 dispatch + routing integration tests"
affects:
  - "Phase 35 orchestration skill — can now dispatch real GPU tasks / reviews / canvas syncs / jimeng calls via tool_view/tool_use"
tech-stack:
  added: []
  patterns:
    - "Tool handler dispatch (mirror plugins/spotify/tools.py _spotify_client + _spotify_tool_error)"
    - "monkeypatch.setattr on factory functions for dispatch tests (no httpx.MockTransport — Wave 1 owns HTTP coverage)"
key-files:
  created:
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_tools_dispatch.py
  modified:
    - /data/workspace/hermes-agent/plugins/kais_aigc/tools.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_smoke.py
decisions:
  - "17-element task_type enum = REQUIREMENTS GPU-DIRECT-01 (13) + Node.js ref (4: tts_generation, image_composition, video_generation, seedance_video)"
  - "Dispatch tests use monkeypatch on tools._*_client factories, NOT httpx.MockTransport — Wave 1 covers HTTP behavior; Wave 2 verifies routing only"
  - "Test 4 in test_smoke.py downgraded from stub-envelope assertion to valid-JSON-shape assertion — stubs are gone, handlers now dispatch"
metrics:
  duration: ~10min
  completed: 2026-06-25
  tasks: 2
  files: 3
---

# Phase 32 Plan 05: Wire 4 Clients to Tool Dispatch Summary

Swapped Phase 31's 4 stub handlers in `tools.py` for real client dispatch (GoldTeamClient / ReviewPlatformClient / CanvasClient / JimengClient) via factory functions + `_kais_tool_error` mapper; expanded the gold_team `task_type` enum from 4 representative entries to the full 17; added 16 dispatch tests proving each handler routes args to the correct client method through `tool_result` / `tool_error`.

## What Shipped

### tools.py (Phase 32 implementation replaces Phase 31 skeleton)
- **Imports added:** `GoldTeamClient, GoldTeamError` / `ReviewPlatformClient, ReviewClientError` / `CanvasClient, CanvasClientError` / `JimengClient, JimengError` + `tool_error` from `tools.registry`.
- **4 factory functions:** `_gold_team_client()`, `_review_platform_client()`, `_canvas_client()`, `_jimeng_client()` — each constructs the client with zero args (client classes read their env vars at construction per D-06).
- **`_kais_tool_error(client, exc)` mapper:** typed client errors (4xx / unrecoverable) → `tool_error(str(exc), status_code=exc.status or 500)`; unexpected exceptions → `tool_error(f"{client} tool failed: ...")`.
- **4 handler bodies rewritten:**
  - `_handle_kais_gold_team_submit` → `c.submit_task(task_type=..., params=...)` + optional `c.wait_for_task(result["task_id"])` when `wait=True`.
  - `_handle_kais_review_submit` → `c.submit_review(type=asset_type, content_ref=asset_id, metadata={"reviewer_role": ...} | None, callback_url=...)`.
  - `_handle_kais_canvas_sync` → builds `graph = {"nodes": [{"id", "type", "data"}]}` then `c.save_canvas_degraded(graph)`.
  - `_handle_kais_jimeng_call` → `c.call(subcommand, payload.copy())` (defensive copy prevents caller mutation).
- **`task_type` enum expanded to 17 entries:**
  `image_draw, image_refine, video_final, wan_i2v, tts_zh, tts_en, tts_bilingual, tts_generation, upscale, face_restore, image_pulid, controlnet_depth, image_to_3d, image_to_3d_mv, image_composition, video_generation, seedance_video`
- **Removed:** `_stub()` helper, all `"status": "not_implemented"` strings, all `implementing_phase` framing in docstrings.
- **LOC delta:** +443 / -63 across the 3 files (test_tools_dispatch.py is +380 new).

### test_tools_dispatch.py (new — 16 tests, 5 classes)
- `TestGoldTeamDispatch` (4): happy path tool_result, wait=True polls wait_for_task, missing task_type → tool_error, client exception → tool_error.
- `TestReviewPlatformDispatch` (4): happy path with reviewer_role+callback_url, no-reviewer_role passes None metadata, missing required, client exception.
- `TestCanvasDispatch` (3): happy path verifies graph shape, missing required, client exception.
- `TestJimengDispatch` (4): happy path, missing subcommand, client exception, payload-not-mutated.
- `TestSchema17Enums` (1): `len(enum) == 17` and all 4 Node.js-derived additions present.
- **Mocking strategy:** `monkeypatch.setattr(tools, "_gold_team_client", ...)` replaces factory functions with a small `_Ctx` wrapper returning a fake client double. No `httpx.Client` constructed anywhere in this file — HTTP behavior is owned by Wave 1's per-client test files.

### test_smoke.py (Test 4 updated)
Phase 31 Test 4 asserted every handler returned the stub envelope `{status: not_implemented, plugin, tool, implementing_phase, args_received}`. With stubs removed, the assertion is invalid. Test 4 now verifies the weaker but stable contract: each handler returns valid JSON, and on empty args (no required field) returns a `tool_error` envelope (`{"error": "..."}`). Real routing behavior is verified in test_tools_dispatch.py.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Smoke Test 4 asserted stale stub contract**
- **Found during:** Task 2 verification (full plugin test run)
- **Issue:** `test_smoke.py::test_handlers_return_not_implemented_json` asserted `parsed["status"] == "not_implemented"` and the stub envelope — Phase 32 wiring invalidated this directly.
- **Fix:** Renamed test to `test_handlers_return_valid_json`, updated docstring, weakened assertion to "valid JSON + tool_error on empty args". Real routing is covered by test_tools_dispatch.py (16 tests). Module docstring updated to reflect Phase 31+32 evolution.
- **Files modified:** `plugins/kais_aigc/tests/test_smoke.py`
- **Commit:** 65e589629

No other deviations. Plan executed as written.

## Verification Results

- **Task 1 automated check (tools.py wiring):** PASSED — 17 enums, 4 imports, 4 factories, `_kais_tool_error`, no `not_implemented`.
- **Task 2 dispatch tests:** PASSED — 16/16 tests in `test_tools_dispatch.py`.
- **Full plugin suite (Wave 1 + Wave 2):** PASSED — **85 passed, 9 warnings, 0 failed** in 1.19s. (Wave 1 = ~69 tests across 4 client files; Wave 2 = 16 dispatch tests.)
- **Phase 31 regression (loader + smoke):** PASSED — `test_loader_discovery.py` and `test_smoke.py` (with updated Test 4) green.
- **`__init__.py` unchanged:** `git diff` = 0 lines.
- **`plugin.yaml` unchanged:** `git diff` = 0 lines.
- **`pyproject.toml` unchanged:** `git diff` = 0 lines (no new deps).

## Success Criteria Met

- **GPU-DIRECT-06 (wiring half):** MET — tool bodies now dispatch to real Wave 1 clients via `tool_result`/`tool_error`. (Loader-registration half was Phase 31.)
- **GPU-DIRECT-01 (17 task types):** MET — enum expanded to 17 entries.
- **SC#5 final clause:** MET — Phase 35 orchestration skill can call `kais_gold_team_submit` / `kais_review_submit` / `kais_canvas_sync` / `kais_jimeng_call` via `tool_view`/`tool_use` and receive real client behavior.

## End-of-Phase 32 Statement

**GPU-DIRECT-01 through GPU-DIRECT-06 all MET.** Phase 32 delivers a working Python plugin (`kais_aigc`) with four real HTTP clients (gold_team / review_platform / canvas / jimeng), each implementing degrade-first semantics + typed errors + auth (X-API-Key / JWT / HMAC), plus 4 wired tool handlers dispatching through `tool_result`/`tool_error`. The orchestration skill (Phase 35) can now dispatch real GPU tasks, reviews, canvas syncs, and jimeng calls. Real-service E2E verification is deferred to Phase 39 per CONTEXT.md.

## Self-Check: PASSED

- FOUND: `/data/workspace/hermes-agent/plugins/kais_aigc/tools.py`
- FOUND: `/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_tools_dispatch.py`
- FOUND: `/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_smoke.py` (modified)
- FOUND: commit `65e589629` in `/data/workspace/hermes-agent` git log (code lives in sibling repo per D-01)
