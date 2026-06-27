---
phase: 40-rapid-preview-tier
plan: 02
subsystem: kais_aigc preview engine (pure library code — NO p10b integration)
tags: [preview-engine, strategy-pattern, ltx-video, slideshow, ffmpeg, httpx, degrade-first, v6.0]
requires:
  - V5.0 GoldTeamClient D-09 degrade-first contract (Phase 32-01)
  - 40-01 AssetBus rapid-preview-clips + episode-meta slots registered
provides:
  - "PreviewEngine ABC with abstract generate(*, shot_id, prompt, structure_delta, keyframe_image_path, voice_clip_path, output_path) -> dict"
  - "PreviewEngineError (subclass of Exception — raised on 4xx + invalid JSON)"
  - "SlideshowEngine: FFmpeg subprocess engine with subprocess_runner test-injection kwarg + degrade-on-missing-inputs / missing-binary / non-zero-exit"
  - "LTXVideoEngine: httpx POST engine mirroring GoldTeamClient D-09 contract (transport test-injection kwarg)"
  - "select_engine(env=None) factory: reads KAIS_PREVIEW_ENGINE at call time (D-06); default slideshow; unknown -> slideshow + WARN (T-40-09)"
  - "28 mocked tests covering ABC shape, factory dispatch, stub boundary lifecycle, both engine happy paths, all degrade paths, all raise paths"
affects:
  - "Plan 40-03 will compose select_engine() into p10b_rapid_preview.run() fan-out"
  - "Plan 40-03 will write {clip_path, generation_time_ms, engine} to rapid-preview-clips JSONL slot"
tech-stack:
  added:
    - "httpx (already a project dep — used by LTXVideoEngine)"
    - "subprocess + shutil (stdlib — used by SlideshowEngine for FFmpeg invocation + binary lookup)"
  patterns:
    - "Strategy pattern: PreviewEngine ABC + 2 concrete engines + select_engine factory"
    - "TDD RED/GREEN with explicit task-boundary stub strategy (WARNING #7)"
    - "D-09 degrade-first contract mirrored 1:1 from GoldTeamClient (no innovation on envelope shape)"
    - "Constructor injection for hermetic testing (transport=httpx.MockTransport / subprocess_runner=callable)"
    - "List-form argv for subprocess (T-40-06 argument-injection mitigation — no shell=True)"
key-files:
  created:
    - /data/workspace/hermes-agent/plugins/kais_aigc/preview_engine.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_preview_engine.py
  modified: []
key-decisions:
  - "generation_time_ms is LOCALLY-measured wall time (INFO #10) — IGNORES service-reported timing in LTX response body. Rationale: service-reported timing may be unreliable, missing, or inconsistent across engines; local wall time via time.monotonic() delta is always available and comparable."
  - "LTXVideoEngine faithfully mirrors GoldTeamClient D-09 contract (no envelope-shape innovation): ConnectError/Timeout/HTTPError -> degrade; >= 500 or 429 -> degrade; >= 400 -> raise PreviewEngineError; 2xx invalid JSON -> raise."
  - "Default engine is slideshow when KAIS_PREVIEW_ENGINE unset (safer fallback — no external API dep; honors 降级容忍 红线 #1)."
  - "Unknown KAIS_PREVIEW_ENGINE values fall back to slideshow + WARN log (T-40-09 mitigation — no eval(), no dynamic class lookup)."
  - "SlideshowEngine builds FFmpeg argv as Python list (T-40-06 mitigation — argument injection impossible without shell=True)."
  - "Stub strategy lifecycle (WARNING #7): Test 9 asserted NotImplementedError at Task 1 boundary; adjusted at Task 2 to only assert LTX stub; removed at Task 3 (both stubs expanded)."
requirements-completed:
  - RAPID-PREVIEW-02
  - RAPID-PREVIEW-05
duration: "8 min"
completed: "2026-06-27T05:07:49Z"
---

# Phase 40 Plan 02: PreviewEngine Strategy Pattern Summary

Built the PreviewEngine strategy pattern: `PreviewEngine` ABC + `SlideshowEngine` (FFmpeg subprocess, list-form argv) + `LTXVideoEngine` (mocked httpx POST mirroring GoldTeamClient D-09 contract) + `select_engine(env=None)` factory with slideshow default + WARN-on-unknown fallback — all 28 mocked tests GREEN, V5.0 regression preserved (620 passed, 1 pre-existing out-of-scope failure).

## Duration / Scope

- **Start:** 2026-06-27T04:59:28Z
- **End:** 2026-06-27T05:07:49Z
- **Duration:** 8 min (501s)
- **Tasks completed:** 3/3 (all `type="tdd"` with proper RED→GREEN cycle)
- **Files created:** 2 (`preview_engine.py` + `test_preview_engine.py`)
- **Files modified:** 0 (pure additive — no existing production code touched)
- **New tests added:** 28 (9 ABC + 8 Slideshow + 11 LTX)
- **Final test count (preview_engine):** 28 passed, 0 failed
- **Final test count (V5.0 regression):** 620 passed (592 baseline + 28 new), 1 pre-existing out-of-scope failure

## What Was Built

### Production code (`plugins/kais_aigc/preview_engine.py` — NEW, ~290 lines)

1. **`PreviewEngineError(Exception)`** — empty body, raised on 4xx caller bugs + invalid JSON service bugs.

2. **`PreviewEngine(abc.ABC)`** — abstract base class with:
   - Abstract `generate(*, shot_id, prompt, structure_delta, keyframe_image_path=None, voice_clip_path=None, output_path=None) -> dict`.
   - Static `_record_time(start) -> int` helper returning `int((time.monotonic() - start) * 1000)` for locally-measured `generation_time_ms` (INFO #10).

3. **`select_engine(env=None) -> PreviewEngine`** factory:
   - Reads `env` kwarg, else `os.environ.get("KAIS_PREVIEW_ENGINE", "slideshow")` at CALL time (D-06).
   - `"ltx"` → `LTXVideoEngine()`; `"slideshow"` → `SlideshowEngine()`; unknown → `SlideshowEngine()` + WARN log mentioning the value (T-40-09 mitigation).

4. **`SlideshowEngine(PreviewEngine)`** — FFmpeg subprocess engine:
   - Constructor accepts `subprocess_runner: Callable | None` for hermetic test injection (D-04).
   - `generate()` validates inputs (keyframe_image_path / voice_clip_path / output_path) → degrade envelope if missing.
   - When no runner injected, checks `shutil.which("ffmpeg")` → degrade envelope if missing.
   - Builds FFmpeg argv as Python list (T-40-06: no shell=True): `["ffmpeg", "-y", "-loop", "1", "-i", img, "-i", audio, "-c:v", "libx264", "-tune", "stillimage", "-c:a", "aac", "-b:a", "192k", "-shortest", "-pix_fmt", "yuv420p", out]`.
   - Non-zero exit → degrade envelope with returncode + first 200 chars stderr.
   - OSError → degrade envelope.
   - Success → `{clip_path, generation_time_ms, engine: "slideshow"}`.

5. **`LTXVideoEngine(PreviewEngine)`** — LTX-Video HTTP engine (mocked in v6.0):
   - Class constants: `DEFAULT_BASE_URL="http://localhost:9001"`, `DEFAULT_TIMEOUT=30.0`.
   - Constructor mirrors `GoldTeamClient` (base_url / `KAIS_LTX_URL` env / timeout / transport — D-04, D-06).
   - `_degrade(reason)` mirrors `GoldTeamClient._degrade` (engine=ltx instead of client=gold_team).
   - `_request(body)` mirrors `GoldTeamClient._request` (lines 170-221) EXACTLY: ConnectError/TimeoutException/HTTPError → degrade; status >= 500 or 429 → degrade; status >= 400 → raise `PreviewEngineError`; 2xx → JSON parse, invalid → raise.
   - `generate()` POSTs `{shot_id, prompt, structure_delta}` to `/api/v1/ltx`; validates `clip_path` in response; INFO #10: `generation_time_ms` is locally-measured (response body's timing field IGNORED).
   - `close()` + `__enter__`/`__exit__` context manager (mirrors GoldTeamClient).

### Test code (`plugins/kais_aigc/tests/test_preview_engine.py` — NEW, ~490 lines)

Three test classes tracking the three plan tasks:

- **`TestPreviewEngineABC` (9 tests)**: ABC shape (`issubclass(PreviewEngine, ABC)`, `cannot instantiate`, `generate.__isabstractmethod__`), `PreviewEngineError` subclass, `select_engine()` env dispatch (default slideshow, ltx, slideshow, unknown-with-WARN, call-time env read).

- **`TestSlideshowEngine` (8 tests)**: happy-path success envelope, exact FFmpeg argv ordering (T-40-06 pin), degrade on non-zero exit, degrade on missing keyframe/voice/output, degrade when `shutil.which('ffmpeg')` is None, constructor accepts `subprocess_runner` kwarg, `generation_time_ms` is non-negative int.

- **`TestLTXVideoEngine` (11 tests)**: happy path (INFO #10: locally-measured timing), POST to `/api/v1/ltx` with correct body, degrade on ConnectError / Timeout / HTTP 500 / HTTP 429, raise `PreviewEngineError` on HTTP 400 (caller bug), raise on invalid JSON (service bug), degrade when `clip_path` missing, constructor reads `base_url` from kwarg/env/default, engine without transport uses real `httpx.Client` (introspection only).

## Decision: Locally-Measured `generation_time_ms` (INFO #10)

**Decision:** Both engines return `generation_time_ms` measured as `int((time.monotonic() - start) * 1000)` — the LOCALLY-measured wall time of the `generate()` call. The LTX-Video service's response body MAY include a `generation_time_ms` field (mock returns `1200` in tests); **that field is IGNORED**.

**Rationale (per INFO #10):**
- Service-reported timing may be unreliable, missing, or inconsistent across engine implementations.
- Local wall time is always available (no service dependency for the metric).
- Local wall time is comparable across engines (slideshow vs LTX benchmark on the same axis).
- For SlideshowEngine there IS no service to report timing — local measurement is the only option, so using it for LTX too keeps the contract uniform.

**Test coverage:** `TestLTXVideoEngine.test_generate_happy_path_returns_success_envelope` documents this in its docstring and asserts the returned `generation_time_ms` is an int >= 0 (non-deterministic exact value — wall time varies).

## Confirmation: GoldTeamClient D-09 Contract Faithfully Mirrored

`LTXVideoEngine._request()` is a faithful port of `GoldTeamClient._request()` (lines 170-221 of `gold_team.py`):

| Scenario | GoldTeamClient | LTXVideoEngine | Match? |
|----------|----------------|----------------|--------|
| ConnectError / TimeoutException | `_degrade(f"{type(exc).__name__}: {exc}")` | `_degrade(f"{type(exc).__name__}: {exc}")` | ✓ |
| Other HTTPError | `_degrade(...)` | `_degrade(...)` | ✓ |
| status >= 500 | `_degrade(f"HTTP {status}")` | `_degrade(f"HTTP {status}")` | ✓ |
| status == 429 | `_degrade(f"HTTP {status}")` | `_degrade(f"HTTP {status}")` | ✓ |
| status >= 400 (4xx) | `raise GoldTeamError(f"HTTP {status}: {text[:200]}", ...)` | `raise PreviewEngineError(f"HTTP {status}: {text[:200]}")` | ✓ (no status/url kwargs — PreviewEngineError is single-purpose) |
| 2xx invalid JSON | `raise GoldTeamError(f"Invalid JSON response: {text[:200]}", ...)` | `raise PreviewEngineError(f"Invalid JSON response: {text[:200]}")` | ✓ |

No innovation on the envelope shape. `_degrade()` returns `{"degraded": True, "engine": "ltx", "reason": str}` (vs GoldTeamClient's `{"degraded": True, "client": "gold_team", "operation": ..., "reason": str}` — `engine` instead of `client`/`operation` since the engine is single-purpose).

## WARNING #7 Stub Strategy Lifecycle

The plan required an explicit boundary check proving stubs raise `NotImplementedError` at the Task 1 → 2/3 transition (so Tasks 2/3 EXPAND the stubs rather than accidentally re-using a no-op). Lifecycle of `TestPreviewEngineABC.test_stub_subclasses_raise_not_implemented_at_task_1_boundary`:

1. **Task 1 (commit `fdaa6b24e` RED + `3689cbce1` GREEN):** Test 9 asserted both `SlideshowEngine.generate()` AND `LTXVideoEngine.generate()` raise `NotImplementedError`. GREEN created both as stubs raising NIE.

2. **Task 2 (commit `0e7ef93e9` RED + `2c08068a3` GREEN):** Test 9 adjusted to assert ONLY `LTXVideoEngine.generate()` still raises NIE (SlideshowEngine stub expanded).

3. **Task 3 (commit `4b1da27d7` RED + `a8b8951c9` GREEN):** Test 9 REMOVED entirely per plan Task 3 done criteria ("Test 9 from Task 1 removed (both stubs now expanded)"). Module + class docstrings updated to document the lifecycle.

Final test count: 9 ABC + 8 Slideshow + 11 LTX = **28 tests** (matches plan's `<verification>` block expectation of 28).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added output_path input validation to SlideshowEngine**

- **Found during:** Task 2 GREEN implementation
- **Issue:** Plan's Task 2 `<behavior>` listed input validation for `keyframe_image_path` and `voice_clip_path` but NOT `output_path`. Without validation, `SlideshowEngine.generate(output_path=None)` would build an FFmpeg argv ending with `None` (TypeError) or spawn FFmpeg writing to literal `"None"` file.
- **Fix:** Added a third input validation branch: `if not output_path: return self._degrade("missing output_path")`. Matches the same degrade-envelope pattern as the other two validations. This is a correctness requirement (input validation is critical per Rule 2) — not a feature addition.
- **Files modified:** `preview_engine.py` (3 lines added in `SlideshowEngine.generate()`)
- **Verification:** No new test added (the pattern is identical to Tests 4 + 5); full test suite GREEN.
- **Commit:** `2c08068a3`

### Out-of-Scope Discoveries (deferred, NOT fixed)

**Pre-existing failure: `test_no_openclaw_references_in_phase_37_deliverables`**

- **File:** `plugins/kais_aigc/tests/test_canvas_sync_integration.py:744` (class `TestNoLegacyReferences`)
- **Issue:** Same pre-existing failure noted in 40-01 SUMMARY. `canvas_sync.py` has 127 lines of uncommitted changes (visible in `git diff --stat`) that include `sqlite`/`sqlite3` references; the test scans Phase 37 deliverables for openclaw/Toonflow/sqlite references and fails. These uncommitted changes pre-existed my Phase 40-02 work (visible in the original git status at session start: ` M plugins/kais_aigc/canvas_sync.py`).
- **Disposition:** Out of scope per deviation Rule scope boundary. Logged to deferred-items. User should commit or revert the `canvas_sync.py` sqlite changes separately.

**Total deviations:** 1 auto-fixed (Rule 2 input validation). **Impact:** None on test count or behavior contract — the added validation matches the existing pattern and prevents a TypeError/corruption on `None` output paths.

## Authentication Gates

None — no auth flows encountered during execution (LTX-Video is mocked via `httpx.MockTransport`; no real network calls).

## TDD Gate Compliance

All three tasks were `tdd="true"`. Verified gate sequence in git log:

**Task 1 (PreviewEngine ABC + factory + stubs):**
- `PASS` RED gate: `fdaa6b24e — test(40-02): RED — add failing tests for PreviewEngine ABC + select_engine factory + stub boundary`
- `PASS` GREEN gate: `3689cbce1 — feat(40-02): GREEN — implement PreviewEngine ABC + select_engine factory + stub subclasses`

**Task 2 (SlideshowEngine):**
- `PASS` RED gate: `0e7ef93e9 — test(40-02): RED — add 8 failing tests for SlideshowEngine + degrade paths`
- `PASS` GREEN gate: `2c08068a3 — feat(40-02): GREEN — implement SlideshowEngine (FFmpeg subprocess) + degrade paths`

**Task 3 (LTXVideoEngine):**
- `PASS` RED gate: `4b1da27d7 — test(40-02): RED — add 11 failing tests for LTXVideoEngine + D-09 contract`
- `PASS` GREEN gate: `a8b8951c9 — feat(40-02): GREEN — implement LTXVideoEngine (mocked httpx) + remove Test 9 stub boundary`

All 6 gate commits present in `git log --oneline` in correct RED-before-GREEN order.

## Self-Check

**Files (all created):**

- `FOUND`: /data/workspace/hermes-agent/plugins/kais_aigc/preview_engine.py (NEW)
- `FOUND`: /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_preview_engine.py (NEW)

**Commits (all 6 plan commits present in git log):**

- `FOUND`: `fdaa6b24e` — test(40-02): RED — PreviewEngine ABC tests
- `FOUND`: `3689cbce1` — feat(40-02): GREEN — PreviewEngine ABC + factory + stubs
- `FOUND`: `0e7ef93e9` — test(40-02): RED — SlideshowEngine tests
- `FOUND`: `2c08068a3` — feat(40-02): GREEN — SlideshowEngine impl
- `FOUND`: `4b1da27d7` — test(40-02): RED — LTXVideoEngine tests
- `FOUND`: `a8b8951c9` — feat(40-02): GREEN — LTXVideoEngine impl + Test 9 removal

**Verification commands (from PLAN `<verification>` block):**

- `PASS`: `pytest plugins/kais_aigc/tests/test_preview_engine.py -q` = 28 passed (9 ABC + 8 Slideshow + 11 LTX)
- `PASS`: default fallback — `select_engine()` returns `SlideshowEngine` instance
- `PASS`: env dispatch — `KAIS_PREVIEW_ENGINE=ltx ... select_engine()` returns `LTXVideoEngine`
- `PASS`: full V5.0 regression — `pytest skills/kais-movie-pipeline/tests/ plugins/pipeline_state/tests/ plugins/kais_aigc/tests/ plugins/review_gates/tests/ -q` = 620 passed, 1 pre-existing out-of-scope failure (canvas_sync sqlite references)

## Next Step

Ready for **40-03** (compose `select_engine()` into `p10b_rapid_preview.run()` fan-out — ThreadPoolExecutor(max_workers=parallel_shots=4), 3 variants per shot cycling through `[hook_position_sec, emotion_sequence, turning_points_sec, ending_state]`, write `{shot_id, variant_id, structure_delta, clip_path, generation_time_ms, engine}` to `rapid-preview-clips` JSONL slot; degrade path writes `preview_skipped: True` to `episode-meta` JSON slot). Plan 02's engines are pure library code ready for composition — no further engine-layer work needed.
