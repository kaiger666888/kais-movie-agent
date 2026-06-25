---
phase: 33-pipeline-state-asset-bus
plan: 00
type: overview
wave: 0
depends_on: []
files_modified: []
autonomous: true
requirements: []   # Foundation phase — supports HERMES-SKILL-02/03 implicitly
---

<objective>
Phase 33 master plan — port 3 Node.js state modules to Python in
`hermes-agent/plugins/pipeline_state/`, then wire dispatch in `tools.py`.

Purpose: Provide state-layer foundation (checkpoint resume + asset bus V3 typed
slots + creative history DAG) for Phase 35 orchestration runner and Phase 34
review gates. Pure data-structure work — no HTTP, no orchestration loop, no
gate lifecycle.

Output: 3 new Python modules (`store.py` / `asset_bus.py` / `creative_history.py`)
+ 4 new test files + updated `tools.py` (4 stubs → real dispatch). ~800-1500 LOC
Python, ~45-55 tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/33-pipeline-state-asset-bus/CONTEXT.md
@.planning/phases/33-pipeline-state-asset-bus/PATTERNS.md
@.planning/phases/31-plugin-skeleton-hermes-agent-wiring/PATTERNS.md

# Node.js reference sources (read once per plan)
@lib/asset-bus.js
@lib/creative-history-tracker.js
# Pipeline state extract — see lib/pipeline.js:217-249, 611-618, 700-707

# Existing skeleton (Phase 31) — Plan 33-04 modifies tools.py
@/data/workspace/hermes-agent/plugins/pipeline_state/__init__.py
@/data/workspace/hermes-agent/plugins/pipeline_state/tools.py
@/data/workspace/hermes-agent/plugins/pipeline_state/plugin.yaml

# Node.js test refs (behavior baseline)
@/data/workspace/kais-movie-agent/test/phases/asset-bus.test.mjs
@/data/workspace/kais-movie-agent/test/phases/asset-bus-derived-from.test.mjs
@/data/workspace/kais-movie-agent/test/phases/creative-history-tracker.test.mjs
@/data/workspace/kais-movie-agent/test/phases/creative-history-perf.test.mjs
</context>

<plans>

## Wave 1 (parallel — disjoint file ownership)

| Plan | Module | Files Owned | Est. LOC | Est. Tests |
|------|--------|-------------|----------|------------|
| [33-01](./33-01-PLAN.md) | PipelineStateStore | `store.py`, `tests/test_store.py` | ~150-200 | 10-12 |
| [33-02](./33-02-PLAN.md) | AssetBus V3 | `asset_bus.py`, `tests/test_asset_bus.py` | ~250-350 | 15-18 |
| [33-03](./33-03-PLAN.md) | CreativeHistoryTracker | `creative_history.py`, `tests/test_creative_history.py` | ~200-300 | 12-15 |

## Wave 2 (sequential — depends on 33-01..03)

| Plan | Module | Files Owned | Est. LOC | Est. Tests |
|------|--------|-------------|----------|------------|
| [33-04](./33-04-PLAN.md) | tools.py dispatch wiring | `tools.py` (modified), `tests/test_tools_dispatch.py` (new) | ~150-200 | 8-10 |

## Dependency Graph

```
Wave 1 (parallel):
  33-01 (store.py) ─────────────┐
  33-02 (asset_bus.py) ─────────┼──→ Wave 2:
  33-03 (creative_history.py) ──┘    33-04 (tools.py wiring + integration tests)
```

**Why this works:**
- Wave 1 plans own disjoint files (`store.py` ≠ `asset_bus.py` ≠ `creative_history.py`) → fully parallel
- Wave 2 (33-04) imports from all three Wave 1 modules → depends on Wave 1 completion
- `creative_history.py` does import `AssetBus` (it stamps via bus), but Plan 33-03 can stub AssetBus for its own tests; runtime integration happens in Plan 33-04. See 33-03 task notes.

</plans>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| filesystem → Python | State files (`.pipeline-state.json`, `.pipeline-assets/*.json`) are read from workdir. Malformed files could crash the module. |
| Python → filesystem | Atomic writes (tmp+rename) must not leave half-written state. JSONL appends must not corrupt existing lines. |
| Hermes tool dispatch → Python handlers | Tool args (`episode_id`, `slot`, `entry`) cross from LLM/tool layer into Python. Untrusted shape. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-33-01 | Tampering | `.pipeline-state.json` read | mitigate | Wrap `json.loads` in try/except — return empty `PipelineState` on decode error (mirrors Node.js `_loadState` catch). |
| T-33-02 | Tampering | `.pipeline-assets/*.json` read | mitigate | Same — `read()` returns `None` on `FileNotFoundError` / `JSONDecodeError`. |
| T-33-03 | Information Disclosure | Checkpoint payloads (phase outputs) | accept | Workdir is operator-local; no PII handling at this layer (PII scrubber lives in Phase 25 FineTuneETL). |
| T-33-04 | Denial of Service | BFS over 1000-stamp chain | mitigate | `max_blast_radius` + `max_depth` caps; perf test asserts < 500ms. No unbounded loops. |
| T-33-05 | Tampering | JSONL append (finetune-dataset) | accept | Single-process writer (Hermes agent). No cross-process contention modeled. Mirrors Node.js appendFile behavior. |
| T-33-06 | Elevation | Tool dispatch `_handle_*` args | mitigate | Validate required args (`episode_id`, `slot`, `entry`) before dispatch; unknown slot → `AssetBusError` → `tool_error`. |

**No third-party package installs** — Phase 33 is pure stdlib. No `[SLOP]`/`[ASSUMED]`/`[SUS]` packages. T-33-SC N/A.
</threat_model>

<verification>
Phase 33 complete when ALL of:
1. All 4 plan SUMMARYs exist in `.planning/phases/33-pipeline-state-asset-bus/`
2. `pytest hermes-agent/plugins/pipeline_state/tests/ -v` passes (Phase 31 tests + new tests)
3. `grep -c '"status": "not_implemented"' hermes-agent/plugins/pipeline_state/tools.py` returns 0 (all stubs replaced)
4. `python -c "from plugins.pipeline_state import store, asset_bus, creative_history; print('OK')"` exits 0
5. ROADMAP SC#1-4 verified in respective plan SUMMARYs
</verification>

<success_criteria>
- [ ] SC#1: `pipeline_state/store.py` — PipelineStateStore (checkpoint save/load, episode persistence, resume) — Plan 33-01
- [ ] SC#2: `pipeline_state/asset_bus.py` — AssetBus V3 (3 typed slots + envelope + atomic write + JSONL append) — Plan 33-02
- [ ] SC#3: `pipeline_state/creative_history.py` — CreativeHistoryTracker (DAG + reverse BFS + blast radius cap, 1000-asset BFS < 500ms) — Plan 33-03
- [ ] SC#4: Python unit tests ≥ Node.js baseline (33+8+13+4=58 Node.js tests; Python target ≥ 45 net-new tests, dispatch tests in 33-04 bring total to 55+) — Plans 33-01..04
- [ ] Stub grep: 0 occurrences of `"status": "not_implemented"` in tools.py — Plan 33-04
</success_criteria>

<output>
Create `.planning/phases/33-pipeline-state-asset-bus/33-{01,02,03,04}-SUMMARY.md`
when each plan completes. Master SUMMARY (`33-00-SUMMARY.md`) optional at phase
close.
</output>
