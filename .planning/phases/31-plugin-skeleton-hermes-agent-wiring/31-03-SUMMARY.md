---
phase: 31-plugin-skeleton-hermes-agent-wiring
plan: 03
subsystem: infra
tags: [hermes-agent, plugins, smoke-tests, pytest, python]

# Dependency graph
requires:
  - "31-01: plugin skeleton artifacts (kais_aigc + pipeline_state + review_gates __init__.py + tools.py + plugin.yaml)"
  - "31-02: tests/ package markers (tests/__init__.py per plugin) — running in parallel Wave 2"
provides:
  - "15-test smoke suite (5 per plugin × 3 plugins) that encodes the Phase 31 skeleton contract"
  - "ROADMAP SC#3 verification via literal python -c subprocess check (the exact form SC#3 demands)"
  - "Regression gate Phase 32/33/34 can run after every handler change to catch tool-surface breakage"
affects: [32-kais-aigc-clients, 33-pipeline-state-store, 34-review-gates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fake-ctx smoke test pattern: _FakeCtx captures register_tool() kwargs so tests assert on tool surface without spinning up PluginManager (no global registry side effects, <1s runtime)"
    - "importlib.util.spec_from_file_location for module loading — mirrors how hermes-agent's PluginManager imports directory plugins"
    - "subprocess.run([sys.executable, '-c', ...]) for the literal SC#3 check — proves python -c 'from plugins.<name> import register' succeeds with exit code 0"

key-files:
  created:
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_smoke.py
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_smoke.py
    - /data/workspace/hermes-agent/plugins/review_gates/tests/test_smoke.py
  modified: []

key-decisions:
  - "Used a fake ctx (_FakeCtx capturing register_tool kwargs) instead of PluginManager.discover_and_load() — isolates each test to a single plugin, avoids mutating the global tool registry, and runs in <1s with no config dependency (per PATTERNS.md 'Test Pattern')"
  - "Subprocess-based SC#3 check inserts HERMES_ROOT (parent of plugins/) into sys.path rather than PLUGINS_DIR — this makes 'from plugins.<name> import register' resolve reliably via the hermes-agent-root-on-sys.path mechanism, independent of cwd"
  - "Each smoke file is self-contained (no shared conftest across plugins) — a plugin can be moved/removed without breaking the others' tests"

patterns-established:
  - "5-test smoke contract per plugin: manifest_valid / module_imports_cleanly / register_registers_4_tools / handlers_return_not_implemented_json / python_dash_c_import_succeeds"
  - "Handler test reads mod._TOOLS to build {name: handler} map — single source of truth, no duplicated tool list in test"

requirements-completed: [GPU-DIRECT-06]

# Metrics
duration: ~5min
completed: 2026-06-25
---

# Phase 31 Plan 03: Smoke Tests for Plugin Skeleton Summary

**15 per-plugin smoke tests (5 per plugin × 3 plugins) covering manifest validity, module import cleanliness, register() tool-surface correctness, stub handler return-shape contract, and the literal ROADMAP SC#3 `python -c` import check — all running in 0.22s as a fast regression gate for Phase 32/33/34**

## Performance

- **Duration:** ~5 min
- **Tasks:** 1/1 complete (single multi-file task)
- **Files created:** 3 (one `test_smoke.py` per plugin)
- **Files modified:** 0
- **Test runtime:** 0.22s for the 15-test smoke suite (well under the 5s must_have threshold)

## Accomplishments

- **15 smoke tests pass** (5 per plugin × 3 plugins):
  - Test 1 (`test_manifest_valid`): each `plugin.yaml` parses via `yaml.safe_load` and declares `name`, `version`, `description`, `kind=standalone`, and the exact 4-tool `provides_tools` list in declared order.
  - Test 2 (`test_module_imports_cleanly`): `__init__.py` and `tools.py` both load via `importlib.util.spec_from_file_location` with no exceptions — catches missing deps, circular imports, and missing symbols.
  - Test 3 (`test_register_registers_4_tools_with_correct_toolset`): `mod.register(_FakeCtx())` produces exactly 4 `register_tool` calls; tool-name set matches `EXPECTED_TOOLS`; every call has `toolset == PLUGIN_NAME`; every schema is a dict with `name`/`description`/`parameters` keys and `schema["name"] == call["name"]`.
  - Test 4 (`test_handlers_return_not_implemented_json`): every stub handler (looked up from `mod._TOOLS`) returns a string; `json.loads` succeeds; parsed JSON has `status == "not_implemented"`, `plugin == PLUGIN_NAME`, `tool == <tool name>`, truthy `implementing_phase`, and `args_received` echoing the input args dict.
  - Test 5 (`test_python_dash_c_import_succeeds`): `subprocess.run([sys.executable, "-c", "from plugins.<name> import register; print(callable(register))"])` exits 0 with stdout `True` — the literal ROADMAP SC#3 check.
- **Combined with Plan 31-02's loader tests: 24 tests pass total** — `python -m pytest plugins/{kais_aigc,pipeline_state,review_gates}/tests/` reports `24 passed in 1.73s`. Zero file overlap with 31-02 (which owns `tests/__init__.py` + `test_loader_discovery.py`); my 3 `test_smoke.py` files are additive.
- **SC#3 verified in the exact form ROADMAP demands:** the literal `python -c "import plugins.<name>"`-equivalent subprocess test passes for all 3 plugins, AND a separate shell-level manual verification (`for p in kais_aigc pipeline_state review_gates; do python -c "..."; done`) prints `register callable: True` three times.
- **Tests are decoupled from the real PluginManager** — uses `_FakeCtx` (captures `register_tool` kwargs) per PATTERNS.md, so no global tool-registry mutation, no config-state dependency, and sub-second runtime. This is intentionally different from Plan 31-02's loader tests: 31-02 catches manifest-format/discovery bugs, 31-03 catches tool-surface/handler-contract bugs.

## Task Commits

Each task was committed atomically to the hermes-agent sibling repo (not kais-movie-agent):

1. **Task 1: Per-plugin smoke tests (3 files, 15 tests)** — `2cc5a7dcf` (test)

## Files Created/Modified

**Created (3 files, all under `/data/workspace/hermes-agent/plugins/`):**

- `kais_aigc/tests/test_smoke.py` — 5 smoke tests for the kais_aigc plugin. `EXPECTED_TOOLS = ["kais_gold_team_submit", "kais_review_submit", "kais_canvas_sync", "kais_jimeng_call"]`.
- `pipeline_state/tests/test_smoke.py` — 5 smoke tests for the pipeline_state plugin. `EXPECTED_TOOLS = ["pipeline_checkpoint_save", "pipeline_checkpoint_load", "asset_bus_read", "asset_bus_write"]`.
- `review_gates/tests/test_smoke.py` — 5 smoke tests for the review_gates plugin. `EXPECTED_TOOLS = ["gate_submit", "gate_wait", "gate_resolve", "gates_list"]`.

Each file is self-contained: own `PLUGIN_NAME` / `EXPECTED_TOOLS` constants, own `_FakeCtx` class, own `_load_module` helper. No shared conftest across plugins (intentional — a plugin can be moved/removed without breaking the others' tests).

## Decisions Made

The plan left a few implementation details to executor discretion; resolutions:

1. **Fake ctx vs real PluginManager** — followed PATTERNS.md's "Test Pattern" guidance: `_FakeCtx` that captures `register_tool(**kwargs)` calls. Real PluginManager would mutate the global tool registry (side effects leak across tests) and require config state. Fake ctx isolates each test to one plugin's `register()` behavior and runs in milliseconds.
2. **Module loading mechanism** — used `importlib.util.spec_from_file_location` with `submodule_search_locations=[plugin_dir]`. This mirrors how hermes-agent's `PluginManager` imports directory plugins (loader code at `hermes_cli/plugins.py:1607-1620`) and avoids relying on the synthetic `hermes_plugins.<slug>` namespace.
3. **sys.path for the subprocess SC#3 check** — insert `HERMES_ROOT` (parent of `plugins/`) into sys.path, not `PLUGINS_DIR`. This makes `from plugins.<name> import register` resolve via the standard `plugins`-as-package-on-sys.path mechanism, independent of the subprocess's cwd. Also passes `cwd=str(HERMES_ROOT)` to the subprocess for belt-and-suspenders reliability.
4. **Handler lookup source** — read `mod._TOOLS` (the `(name, schema, handler, emoji)` tuple list declared in each plugin's `__init__.py`) to build the `{name: handler}` map. Single source of truth — the test doesn't duplicate the tool list a third time.
5. **`tests/` directory creation** — directories did not exist at execution time (Plan 31-02's `tests/__init__.py` files existed on disk but were untracked, suggesting 31-02 was running in parallel). Created the 3 `tests/` directories via `mkdir -p` and placed only `test_smoke.py` in each. Did NOT create or modify `tests/__init__.py` — that file is owned by Plan 31-02 (zero file overlap preserved).

## Deviations from Plan

None - plan executed exactly as written. The "decisions" above are resolutions of implementation-discretion points consistent with PATTERNS.md, not deviations from the plan's contracts.

One execution note (not a deviation): the `tests/` directories did not exist when execution started, so creating them via `mkdir -p` was a prerequisite to writing `test_smoke.py`. This is within Rule 3 (auto-fix blocking issue: cannot write to a non-existent directory) and did not change any deliverable's contract.

## Issues Encountered

- `python` not on PATH (only `python3`); ran pytest with `python3 -m pytest ...` instead. No code change required. The smoke tests themselves use `sys.executable` for the subprocess check, so they work regardless of whether the interpreter is invoked as `python` or `python3`.
- `pyproject.toml` has `testpaths = ["tests"]` which restricts default pytest discovery, but the plan's explicit-path invocation (`python -m pytest plugins/<name>/tests/test_smoke.py`) overrides this and works as documented.

## User Setup Required

None - smoke tests are pure module imports + subprocess invocations of the same Python interpreter. No external services, no network, no env vars. Phase 32+ will add integration tests that require `KAIS_GOLD_TEAM_URL` etc. when real HTTP clients land; those are explicitly out of scope for Phase 31.

## Next Phase Readiness

- **Phase 32 (kais_aigc real clients):** ready — the smoke suite is the regression gate. Phase 32 swaps handler bodies in `kais_aigc/tools.py` (real HTTP clients for gold-team :8002, review-platform, canvas :10588, jimeng :5100). After the swap, run `python -m pytest plugins/kais_aigc/tests/test_smoke.py -v`: tests 1/2/3/5 must still pass (tool surface unchanged); test 4 must be updated to assert the real return shape (the `status: not_implemented` stub assertion will fail once handlers return real data — that's the signal Phase 32 has landed). Phase 32 may also add NEW tests (`test_gold_team_submit_real.py`, etc.) alongside the smoke tests without modifying the smoke suite.
- **Phase 33 (pipeline_state real store):** same contract — smoke tests 1/2/3/5 stay green, test 4 gets updated for real PipelineStateStore/AssetBus return shapes.
- **Phase 34 (review_gates real state machine):** same contract — smoke tests 1/2/3/5 stay green, test 4 gets updated for real gate lifecycle return shapes.
- **ROADMAP SC#3 (smoke imports pass):** MET and verified — the subprocess-based `python -c` check is the literal SC#3 form, and it passes for all 3 plugins.

No blockers. The smoke suite is the contractual proof that the Phase 31 skeleton is wired correctly and ready for Phase 32/33/34 to fill in.

## Self-Check: PASSED

All 3 smoke test files verified present on disk. Commit `2cc5a7dcf` verified
present in `git log` of the hermes-agent repo. All 15 smoke tests pass
(`15 passed in 0.22s`). Combined Phase 31 test count: `24 passed in 1.73s`
(9 loader tests from 31-02 + 15 smoke tests from 31-03).

---
*Phase: 31-plugin-skeleton-hermes-agent-wiring*
*Plan: 03*
*Completed: 2026-06-25*
