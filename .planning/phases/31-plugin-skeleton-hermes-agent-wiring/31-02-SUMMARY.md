---
phase: 31-plugin-skeleton-hermes-agent-wiring
plan: 02
subsystem: testing
tags: [hermes-agent, plugins, pytest, integration-tests, plugin-loader]

# Dependency graph
requires:
  - phase: 31-plugin-skeleton-hermes-agent-wiring (plan 01)
    provides: "kais_aigc / pipeline_state / review_gates plugin directories with plugin.yaml + __init__.py exposing register(ctx) + tools.py with 4 stub handlers each"
provides:
  - "9 passing integration tests proving hermes-agent PluginManager discovers, parses manifests for, and (when enabled) loads all 3 new plugins end-to-end"
  - "Test pattern for per-plugin loader-discovery tests (3 orthogonal states × N plugins) reusable by Phase 32/33/34"
  - "ROADMAP SC#2 acceptance evidence: discover_and_load() registers all 3 plugins without import error, tools==4 visible via list_plugins()"
affects: [31-03-smoke-tests, 32-kais-aigc-clients, 33-pipeline-state-store, 34-review-gates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-plugin loader-discovery test file (plugins/<name>/tests/test_loader_discovery.py) for independent failure isolation across plugins"
    - "Three orthogonal loader states asserted per plugin: default opt-in (enabled=False, 'not enabled' error), enabled+loaded (tools==4), disabled-wins (deny-list precedence)"
    - "monkeypatch.setattr(plugin_module, '_get_enabled_plugins', lambda: {...}) for in-process config override without touching ~/.hermes/config.yaml"
    - "force=True on every discover_and_load() call to bypass the manager's discovery cache (otherwise test N sees stale state from test N-1)"

key-files:
  created:
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/__init__.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/tests/test_loader_discovery.py
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/__init__.py
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_loader_discovery.py
    - /data/workspace/hermes-agent/plugins/review_gates/tests/__init__.py
    - /data/workspace/hermes-agent/plugins/review_gates/tests/test_loader_discovery.py
  modified: []

key-decisions:
  - "Use real PluginManager.discover_and_load() (not mocks) — the plan explicitly requires exercising the actual loader code path. Mocks would only re-assert what the loader source already says, proving nothing."
  - "monkeypatch _get_enabled_plugins / _get_disabled_plugins at module level (hermes_cli.plugins) rather than writing real config files — keeps tests hermetic and avoids polluting ~/.hermes/config.yaml (verified: 0-line diff post-test)."
  - "force=True on every discover_and_load() call — the manager caches discovery state (_discovered flag) and without force, test 2 would see stale state from test 1."
  - "Per-plugin test files (not one combined file) — Plan rationale: if kais_aigc discovery breaks, pipeline_state's tests still run and report pass/fail independently. Also gives Phase 32/33/34 a per-plugin home for future loader tests (e.g. check_fn assertions once env requirements land)."
  - "tests live alongside plugin source (plugins/<name>/tests/) mirroring hermes-agent's self-contained-plugin convention; invoked explicitly via `python -m pytest plugins/<name>/tests/` because pyproject.toml sets testpaths=[\"tests\"]."

patterns-established:
  - "Loader-discovery test template: 3 tests per plugin (default-state / enabled / disabled-wins), differing only in PLUGIN_NAME constant"
  - "_find_entry(listing) helper that scans list_plugins() output for the entry matching PLUGIN_NAME and pytest.fail()s with a helpful message if absent"

requirements-completed: [GPU-DIRECT-06]

# Metrics
duration: ~6min
completed: 2026-06-25
---

# Phase 31 Plan 02: Loader Discovery Tests (kais_aigc + pipeline_state + review_gates) Summary

**9 integration tests across 3 per-plugin test files proving hermes-agent's real `PluginManager.discover_and_load()` finds all 3 new bundled plugins, parses their manifests, gates them correctly via plugins.enabled/disabled, and reports tools==4 when loaded — satisfying ROADMAP SC#2**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-25T13:45:00Z (approx)
- **Completed:** 2026-06-25T13:51:44Z
- **Tasks:** 1/1 complete
- **Files created:** 6 (3 `tests/__init__.py` package markers + 3 `tests/test_loader_discovery.py`)
- **Files modified:** 0 (no production code changes — Wave 1 already shipped the implementation)

## Accomplishments

- **End-to-end loader integration coverage:** all 3 plugins (kais_aigc, pipeline_state, review_gates) verified discoverable via the real `PluginManager.discover_and_load()` bundled-plugins scan, not just isolated `register(ctx)` smoke tests.
- **Three orthogonal loader states asserted per plugin (9 tests total, all passing):**
  1. Default opt-in state — plugin discovered, manifest parsed, `source == "bundled"`, `enabled == False`, `error` mentions "not enabled" (proves manifest was found; standalone plugins require explicit `plugins.enabled` opt-in).
  2. Enabled + loaded — monkeypatch `_get_enabled_plugins` to include plugin name → plugin loads, `register(ctx)` runs, `enabled == True`, `error == None`, `tools == 4` (one per `ctx.register_tool` call).
  3. Disabled-list wins — plugin in BOTH allow-list and deny-list → `enabled == False`, `error` mentions "disabled" (proves deny-list precedence over allow-list).
- **ROADMAP SC#2 satisfied:** "hermes-agent plugin loader 启动时三个插件注册成功(无 import error, 日志可见 'plugin loaded')" — discover_and_load() runs without ImportError on any of the 3 plugins, and `HERMES_PLUGINS_DEBUG=1` produces "Parsed manifest" log lines for all 3 plugin paths.
- **Test isolation verified:** no writes to `~/.hermes/config.yaml` (0-line diff post-test); tests use `monkeypatch.setattr` for in-process config override only.
- **Debug observability confirmed:** `HERMES_PLUGINS_DEBUG=1 python3 -c ...` shows 3 "Parsed manifest: key=<name> ... source=bundled" debug log lines + 3 list_plugins() entries with the expected default-state fields.

## Task Commits

Each task was committed atomically (commits land in the hermes-agent sibling repo, not kais-movie-agent):

1. **Task 1: Loader discovery + enable tests for all 3 plugins** — `f86e15525` (test)

The plan was `tdd="true"` but the task's `<files>` are all test files with no production code to gate — the implementation already shipped in Wave 1 (plan 31-01). RED/GREEN collapses to a single GREEN commit because the tests correctly pass against the pre-existing plugin skeletons. (See "Decisions Made" below.)

## Files Created/Modified

**Test infrastructure (6 files, /data/workspace/hermes-agent/plugins/):**
- `kais_aigc/tests/__init__.py` — empty package marker so pytest can collect the test module
- `kais_aigc/tests/test_loader_discovery.py` — 3 tests (discovery / enable / disabled-wins) for kais_aigc
- `pipeline_state/tests/__init__.py` — empty package marker
- `pipeline_state/tests/test_loader_discovery.py` — 3 tests for pipeline_state
- `review_gates/tests/__init__.py` — empty package marker
- `review_gates/tests/test_loader_discovery.py` — 3 tests for review_gates

Each `test_loader_discovery.py` follows the same template — only the `PLUGIN_NAME` constant and the 4-tool listing in the docstring/assertion-message differ. Tests import `from hermes_cli import plugins as plugin_module` and `from hermes_cli.plugins import get_plugin_manager`, use `pytest.MonkeyPatch` to override `_get_enabled_plugins` / `_get_disabled_plugins`, and call `manager.discover_and_load(force=True)` on every test for a clean rescan.

## Decisions Made

1. **Use real PluginManager, not mocks** — the plan's `<interfaces>` block and `<objective>` both require exercising the actual loader. Mocks would only re-assert the loader's documented contract without proving the wiring works. Sanity-checked the real loader manually before writing the tests (3 plugins discovered as enabled=False; kais_aigc reports tools==4 when enabled).
2. **monkeypatch over real config writes** — patching `hermes_cli.plugins._get_enabled_plugins` / `_get_disabled_plugins` at the module level keeps tests hermetic and avoids polluting the user's `~/.hermes/config.yaml`. Verified post-test: 0-line diff.
3. **force=True on every call** — the manager caches the `_discovered` flag; without force, test 2 would short-circuit on test 1's state. This is documented in the loader source (lines 1125-1126).
4. **Single commit, not RED+GREEN** — the task is `tdd="true"` but its `<files>` are exclusively test files. There is no production code to write in a GREEN step because the implementation already shipped in Wave 1 (plan 31-01, commits `49a1b69d1` / `5771c5027` / `b3cb236ed`). The TDD cycle collapses: the tests are written, run, and pass immediately because the feature already exists. This is the correct outcome (a passing test against existing code proves the contract holds), not a TDD gate violation. No `refactor(...)` commit needed — no production code touched.
5. **Per-plugin test files (not one combined file)** — Plan rationale: independent failure isolation across plugins, and a per-plugin home for Phase 32/33/34 to add plugin-specific loader tests (e.g. `check_fn` assertions once env requirements land in Phase 32).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `python` not on PATH (only `python3`); ran pytest with `python3 -m pytest ...`. This was already noted in 31-01-SUMMARY.md and requires no code change. The plan's `<verify>` block writes `python -m pytest`; executors in this repo should substitute `python3`.
- A single pre-existing `DeprecationWarning` from `discord/player.py` ("'audioop' is deprecated") surfaces in pytest output. Out of scope (Rule scope boundary — not caused by this task's changes, pre-existing in hermes-agent's dependency tree). Logged here for visibility; not fixed.

## User Setup Required

None - no external service configuration required. The tests use `monkeypatch` for in-process config overrides and never touch `~/.hermes/config.yaml`. The plugin skeletons being tested have `check_fn=None` (no env-var availability gate) and degrade-style stub handlers that never call external services.

## Next Phase Readiness

- **Phase 31 Plan 03 (smoke tests):** ready — runs in parallel with this plan (zero file overlap; their `test_smoke.py` files use isolated fake-ctx, ours use real PluginManager). Both plans' files coexist under `plugins/<name>/tests/`.
- **Phase 32 (kais_aigc real clients):** ready — when real `check_fn` and `requires_env` land, Phase 32 can add a 4th test to `kais_aigc/tests/test_loader_discovery.py` asserting that the plugin reports `enabled=False` with a missing-env error when KAIS_GOLD_TEAM_URL is unset. The 3-test template established here is extensible.
- **Phase 33 (pipeline_state real store):** same extension path.
- **Phase 34 (review_gates real state machine):** same extension path.

No blockers. SC#2 acceptance criterion is met with passing-test evidence.

## Self-Check: PASSED

All 6 test files verified present on disk under `/data/workspace/hermes-agent/plugins/{kais_aigc,pipeline_state,review_gates}/tests/`. Commit `f86e15525` verified present in `git log` of the hermes-agent repo. All 9 tests verified passing via `python3 -m pytest plugins/{kais_aigc,pipeline_state,review_gates}/tests/test_loader_discovery.py -v`.

---
*Phase: 31-plugin-skeleton-hermes-agent-wiring*
*Plan: 02*
*Completed: 2026-06-25*
