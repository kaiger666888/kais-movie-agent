---
phase: 31-plugin-skeleton-hermes-agent-wiring
plan: 01
subsystem: infra
tags: [hermes-agent, plugins, plugin-skeleton, python, yaml]

# Dependency graph
requires: []
provides:
  - "kais_aigc plugin directory with 4-tool surface (manifest + register entry + schemas + stub handlers)"
  - "pipeline_state plugin directory with 4-tool surface (manifest + register entry + schemas + stub handlers)"
  - "review_gates plugin directory with 4-tool surface (manifest + register entry + schemas + stub handlers)"
  - "Interface-first tool schemas Phase 32/33/34 can fill in without renegotiation"
affects: [32-kais-aigc-clients, 33-pipeline-state-store, 34-review-gates, 31-02-loader-registration, 31-03-smoke-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Standalone multi-tool plugin pattern mirroring plugins/spotify/ (register loop in __init__.py, schemas+handlers in tools.py)"
    - "Interface-first schemas: declare Phase 32/33/34 target parameter shape so handlers swap without schema renegotiation"
    - "Degrade-style stub envelope `{status: not_implemented, plugin, tool, implementing_phase, args_received}` so register() never raises and grep finds every stub"

key-files:
  created:
    - /data/workspace/hermes-agent/plugins/kais_aigc/plugin.yaml
    - /data/workspace/hermes-agent/plugins/kais_aigc/__init__.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/tools.py
    - /data/workspace/hermes-agent/plugins/kais_aigc/README.md
    - /data/workspace/hermes-agent/plugins/pipeline_state/plugin.yaml
    - /data/workspace/hermes-agent/plugins/pipeline_state/__init__.py
    - /data/workspace/hermes-agent/plugins/pipeline_state/tools.py
    - /data/workspace/hermes-agent/plugins/pipeline_state/README.md
    - /data/workspace/hermes-agent/plugins/review_gates/plugin.yaml
    - /data/workspace/hermes-agent/plugins/review_gates/__init__.py
    - /data/workspace/hermes-agent/plugins/review_gates/tools.py
    - /data/workspace/hermes-agent/plugins/review_gates/README.md
  modified: []

key-decisions:
  - "Manifest is plugin.yaml (YAML) not plugin.json — hermes-agent loader only scans for plugin.yaml/plugin.yml (CRITICAL-FINDING-01)"
  - "register(ctx) lives in __init__.py not a separate entry module — loader imports __init__.py and calls register(ctx) (CRITICAL-FINDING-02)"
  - "kind: standalone chosen (opt-in via plugins.enabled) not kind: backend — these plugins expose new tool surfaces, not backends for existing core tools (CRITICAL-FINDING-03)"
  - "Degrade-style JSON stub envelopes preferred over raise NotImplementedError — register() must succeed at discovery time, and stubs are grep-discoverable for Phase 32/33/34"
  - "No premature client.py/state.py/gates.py modules created in Phase 31 — Phase 32/33/34 add them when real logic lands (resists premature abstraction)"

patterns-established:
  - "Plugin manifest: name / version (quoted string) / description / author / kind: standalone / provides_tools list"
  - "Plugin entry: __init__.py exports register(ctx), loops over _TOOLS tuple calling ctx.register_tool(name, toolset=<plugin>, schema, handler, check_fn=None, emoji)"
  - "Plugin tools.py: schema dicts (name/description/parameters) + handler stubs returning tool_result({status: not_implemented, ...})"

requirements-completed: [GPU-DIRECT-06]

# Metrics
duration: ~10min
completed: 2026-06-25
---

# Phase 31 Plan 01: Plugin Skeleton (kais_aigc + pipeline_state + review_gates) Summary

**Three standalone hermes-agent plugin skeletons scaffolded under /data/workspace/hermes-agent/plugins/ — 12 files across 3 directories, each exposing 4 tools via interface-first schemas and degrade-style stub handlers ready for Phase 32/33/34 to fill in**

## Performance

- **Duration:** ~10 min
- **Tasks:** 3/3 complete
- **Files created:** 12 (4 per plugin × 3 plugins)
- **Files modified:** 0 (pyproject.toml untouched, no new dependencies)

## Accomplishments

- **kais_aigc plugin** with 4 tools: `kais_gold_team_submit`, `kais_review_submit`, `kais_canvas_sync`, `kais_jimeng_call` — target schemas cover gold-team :8002 (with task_type enum), review-platform (JWT+HMAC), canvas :10588 (saveGraph), jimeng-free-api :5100 (6-subcommand enum)
- **pipeline_state plugin** with 4 tools: `pipeline_checkpoint_save`, `pipeline_checkpoint_load`, `asset_bus_read`, `asset_bus_write` — target schemas cover PipelineStateStore atomic JSONL + AssetBus V3 typed slots (creative-history / failed-shots / finetune-dataset / review-outcomes)
- **review_gates plugin** with 4 tools: `gate_submit`, `gate_wait`, `gate_resolve`, `gates_list` — target schemas cover HIL gate state machine (blocking/webhook/polling), approve/reject/contest decisions, and 8 V8.6 gate config listing
- All three plugins follow the spotify standalone multi-tool pattern exactly (manifest shape + register loop + schema/handler split + emoji tagging)
- All 3 task-level inline verifications pass (manifest parses, register(ctx) callable, exactly 4 tools registered with correct toolset name, no exceptions)
- Overall verification passes: 3 dirs exist, exactly 12 files, 0-line pyproject.toml diff, import surface limited to stdlib + tools.registry + relative plugin imports

## Task Commits

Each task was committed atomically (commits land in the hermes-agent sibling repo, not kais-movie-agent):

1. **Task 1: Scaffold kais_aigc plugin** — `49a1b69d1` (feat)
2. **Task 2: Scaffold pipeline_state plugin** — `5771c5027` (feat)
3. **Task 3: Scaffold review_gates plugin** — `b3cb236ed` (feat)

## Files Created/Modified

**kais_aigc/** (4 files, /data/workspace/hermes-agent/plugins/kais_aigc/):
- `plugin.yaml` — manifest (name=kais_aigc, version=0.1.0, kind=standalone, 4 provides_tools)
- `__init__.py` — register(ctx) entry point, loops over 4-tool _TOOLS tuple with toolset="kais_aigc"
- `tools.py` — 4 JSON-schema dicts (interface-first, Phase 32 target shapes) + 4 stub handlers
- `README.md` — 1-paragraph description + Phase 32 pointer

**pipeline_state/** (4 files, /data/workspace/hermes-agent/plugins/pipeline_state/):
- `plugin.yaml` — manifest declaring pipeline_checkpoint_save / pipeline_checkpoint_load / asset_bus_read / asset_bus_write
- `__init__.py` — register(ctx) entry point with toolset="pipeline_state"
- `tools.py` — 4 schemas (Phase 33 target shapes: atomic JSONL, most-recent-wins, slot routing, atomic append) + 4 stubs
- `README.md` — 1-paragraph description + Phase 33 pointer

**review_gates/** (4 files, /data/workspace/hermes-agent/plugins/review_gates/):
- `plugin.yaml` — manifest declaring gate_submit / gate_wait / gate_resolve / gates_list
- `__init__.py` — register(ctx) entry point with toolset="review_gates"
- `tools.py` — 4 schemas (Phase 34 target shapes: 3-mode submit, timeout wait, 3-decision resolve, 8-gate list) + 4 stubs
- `README.md` — 1-paragraph description + Phase 34 pointer

## Decisions Made

The plan deferred four explicit decisions to the executor via CONTEXT.md / PATTERNS.md; all four were resolved in favor of the researched reference pattern (no novel architectural choices introduced):

1. **Manifest format = plugin.yaml (YAML)** — Override of the phase_context's `plugin.json` instruction. Loader code (`hermes_cli/plugins.py:1363-1365`) only checks `plugin.yaml` then `plugin.yml`. JSON manifests would be silently skipped.
2. **Entry module = __init__.py** — Override of the phase_context's implication that `client.py`/`state.py`/`gates.py` are entry modules. Loader imports `__init__.py` and invokes `register(ctx)`. Named implementation modules will be added in Phase 32/33/34 alongside `tools.py`, not as entry points.
3. **kind = standalone** — Override of any backend implication. These plugins expose *new* tool surfaces (not pluggable providers for existing core tools like image_generate). `standalone` makes them opt-in via `plugins.enabled`, which is correct for skeleton scaffolds that should not disrupt existing hermes-agent sessions during the v5.0 rollout.
4. **Stub shape = degrade-style JSON envelope** — `tool_result({status: not_implemented, plugin, tool, implementing_phase, args_received})` rather than `raise NotImplementedError(...)`. Ensures `register()` succeeds at discovery time (handler is captured, not invoked) and gives Phase 32/33/34 executors a single grep target to find every stub.

## Deviations from Plan

None - plan executed exactly as written. The four "decisions" above are not deviations; they are resolutions of explicit discretion points left to the executor by CONTEXT.md and PATTERNS.md.

## Issues Encountered

- `python` not on PATH (only `python3`); ran verification scripts with `python3 -c ...` instead. No code change required.

## User Setup Required

None - no external service configuration required. Skeleton plugins ship with `check_fn=None` (no availability gate) and degrade-style stubs that never call out to external services. Phase 32 will introduce env requirements (KAIS_GOLD_TEAM_URL etc.) when real HTTP clients land.

## Next Phase Readiness

- **Phase 31 Plan 02 (loader registration):** ready — the 3 plugin directories exist with valid `plugin.yaml` manifests, so `PluginManager.discover_and_load()` will find them. Plan 02 verifies they appear in `manager.list_plugins()`.
- **Phase 31 Plan 03 (smoke tests):** ready — each `__init__.py` exposes `register(ctx)`, so smoke tests can invoke it against a fake ctx (mirrors the verification pattern used here).
- **Phase 32 (kais_aigc real clients):** ready — schemas in `kais_aigc/tools.py` declare the target parameter shape; Phase 32 swaps handler bodies only.
- **Phase 33 (pipeline_state real store):** ready — same interface-first contract.
- **Phase 34 (review_gates real state machine):** ready — same interface-first contract.

No blockers. The skeleton is the literal prerequisite for Phase 32/33/34 independently proceeding.

## Self-Check: PASSED

All 12 plugin files + SUMMARY.md verified present on disk. All 3 task commits
(`49a1b69d1`, `5771c5027`, `b3cb236ed`) verified present in `git log` of the
hermes-agent repo.

---
*Phase: 31-plugin-skeleton-hermes-agent-wiring*
*Plan: 01*
*Completed: 2026-06-25*
