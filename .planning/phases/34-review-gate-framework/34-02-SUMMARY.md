---
phase: 34-review-gate-framework
plan: 02
subsystem: review_gates (gate config)
tags: [hil-gates, yaml-config, v8.6-pipeline, pyyaml]
requires:
  - "34-01 (GateConfig/GateMode dataclass in gate.py) — provides the frozen target type for to_gate_config()"
provides:
  - "plugins/review_gates/gates.yaml — 8 V8.6 gate definitions (CF-02)"
  - "plugins/review_gates/gate_config.py — load_gates() / to_gate_config() / GATE_REGISTRY / GateConfigError"
  - "GATE_REGISTRY dict (eager-loaded at import) — consumed by runner_hooks (34-03) and tools.py (34-04)"
affects:
  - "Plan 34-03 runner_hooks.py — imports GATE_REGISTRY to build Gate instances"
  - "Plan 34-04 tools.py — gates_list handler will read GATE_REGISTRY"
  - "Phase 35 runner — reads gate definitions indirectly via runner_hooks"
tech-stack:
  added: ["pyyaml (already transitive via plugin loader — no pyproject.toml change, D-34-03)"]
  patterns:
    - "Eager YAML load at import (D-34-02; hot-reload explicitly out of scope)"
    - "Frozen GateConfig dataclass as the immutable gate definition (D-34-04)"
    - "Reviewer-role normalization: list[str] in YAML -> comma-joined str on dataclass"
    - "Lazy import of gate.GateConfig inside to_gate_config() for Wave 1 parallel safety"
key-files:
  created:
    - plugins/review_gates/gates.yaml
    - plugins/review_gates/gate_config.py
    - plugins/review_gates/tests/test_gates_config.py
  modified: []
decisions:
  - "D1: Lazy-import gate.GateConfig/GateMode inside to_gate_config() (Rule 3 deviation) so the YAML loader works standalone when 34-01's gate.py is absent in Wave 1 parallel"
  - "D2: callback_url left null in gates.yaml for all 8 gates — webhook-mode render-gate is wired at runtime by runner_hooks (Phase 34-03), not statically in config"
  - "D3: Multi-reviewer gates (script/scene-select/delivery) use list-form reviewer_role in YAML, normalized to comma-joined string on GateConfig per plan note"
metrics:
  duration: 3 min
  completed: 2026-06-25
  tasks: 2
  files: 3
  loc:
    gates.yaml: 149
    gate_config.py: 226
    test_gates_config.py: 331
  tests: 14
---

# Phase 34 Plan 02: 8 V8.6 Gates as YAML Config Summary

Defines the 8 V8.6 review gates as immutable `gates.yaml` plus a stdlib-only loader/validator that eagerly builds a `GATE_REGISTRY` at import and converts raw entries to frozen `GateConfig` dataclasses from Plan 34-01.

## What Was Built

### `gates.yaml` (149 LOC)
The 8 V8.6 review gates spanning the 13-phase pipeline, per CF-02:

| # | gate_id | phase | reviewer_role | mode | timeout | retries |
|---|---------|-------|---------------|------|---------|---------|
| 1 | topic-gate | p01_hook_topic | creative_source | blocking | 3600 | 2/300 |
| 2 | outline-gate | p02_outline | creative_source | blocking | 3600 | 2/300 |
| 3 | script-gate | p03_script_audit | script_auditor + compliance_gate | blocking | 7200 | 3/600 |
| 4 | character-gate | p04_character_design | creative_source | blocking | 3600 | 2/300 |
| 5 | scene-select-gate | p08_scene_selection | creative_source + theory_critic | blocking | 3600 | 2/300 |
| 6 | shot-breakdown-gate | p09_shot_breakdown | creative_source | blocking | 3600 | 2/300 |
| 7 | render-gate | p11_video_render | editor | **webhook** | 14400 | 1/1800 |
| 8 | delivery-gate | p13_delivery | compliance_marketing + editor | blocking | 7200 | 3/600 |

Each entry carries the full ROADMAP SC#2 contract: `gate_id` / `phase` / `asset_bus_slots_to_lock` (non-empty list) / `reviewer_role` / `timeout_sec` / `callback_url` / `default_mode` / `retry_policy`.

### `gate_config.py` (226 LOC)
- `load_gates()` — idempotent YAML read + validation; raises `GateConfigError` on missing file, parse error, wrong top-level shape, count ≠ 8, duplicate ids, or any field-level violation
- `to_gate_config(gate_id)` — returns the frozen `GateConfig` dataclass from Plan 34-01; normalizes `reviewer_role` list → comma-joined string; converts `asset_bus_slots_to_lock` list → tuple
- `GATE_REGISTRY` — eagerly loaded at module import (fails loud if YAML is broken; D-34-02)
- `GateConfigError` — single exception type for all config-layer failures

### `tests/test_gates_config.py` (331 LOC, 14 tests, all pass)

| Class | Tests | Coverage |
|---|---|---|
| `TestLoadGates` | 5 | Exactly 8 entries; CF-02 keys; idempotency; top-level version=1; unique gate_ids |
| `TestGateFieldsComplete` | 1 | All 7 required fields × all 8 gates with valid types/values |
| `TestSpecificGateValues` | 2 | topic/script/render/delivery CF-02 anchoring values |
| `TestGateConfigConversion` | 3 | Frozen dataclass; TypeError on setattr; tuple slots; list→str normalization |
| `TestYAMLValidationRejects` | 3 | Missing field / bad mode enum / negative timeout all raise `GateConfigError` |

## Verification Results

| Check | Expected | Actual |
|---|---|---|
| `grep -c "gate_id:" gates.yaml` | 8 | 8 ✓ |
| `to_gate_config('render-gate').default_mode` | `GateMode.WEBHOOK` | `GateMode.WEBHOOK` ✓ |
| `python3 -c "import yaml"` exits 0 | yes | pyyaml 6.0.1 ✓ |
| gates.yaml LOC | ≥80 | 149 ✓ |
| gate_config.py LOC | ≥70 | 226 ✓ |
| test_gates_config.py LOC | ≥150 | 331 ✓ |
| pytest pass rate | 6-8 tests pass | 14 tests pass ✓ |
| pyproject.toml changes | none | none (D-34-03) ✓ |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Deferred `gate.GateConfig/GateMode` import to inside `to_gate_config()`**
- **Found during:** Task 2 implementation (pre-execution check)
- **Issue:** The plan's reference listing imports `from plugins.review_gates.gate import GateConfig, GateMode` at module top. Plan 34-02 has `depends_on: []` and runs in Wave 1 parallel with Plan 34-01 (which owns `gate.py`). At execution start, `gate.py` did not exist. A top-level import would `ImportError` the entire `gate_config.py` module, breaking `load_gates()` and all 11 YAML/loader/validation tests that do NOT depend on `GateConfig`.
- **Fix:** Moved the `gate` import inside `to_gate_config()` (lazy import). Added a `try/except ImportError` that re-raises as `GateConfigError` with a helpful message if `gate.py` is absent. The YAML loader and validator are now usable standalone.
- **Files modified:** `plugins/review_gates/gate_config.py`
- **Outcome:** Plan 34-01 landed mid-execution (commit `6d6c29029`), so all 14 tests pass — the 3 `TestGateConfigConversion` tests included. Behavior is identical to the plan's reference listing once 34-01 is present.

**2. [Rule 2 — Critical functionality] Hardened validation beyond plan spec**
- **Found during:** Task 2 implementation
- **Issue:** Plan's `_validate_entry()` checked the headline constraints but not: duplicate gate_ids within the YAML, non-str elements in `asset_bus_slots_to_lock`, non-str elements in list-form `reviewer_role`, or boolean values sneaking through `isinstance(x, int)` checks (Python booleans are ints).
- **Fix:** Added duplicate-id detection in `load_gates()`; element-type checks for slots and reviewer_role lists; explicit `isinstance(x, bool)` rejection for numeric fields (`bool` is a subclass of `int` in Python, so `isinstance(True, int)` is True — a 1 or 0 from a YAML typo would otherwise pass validation silently).
- **Files modified:** `plugins/review_gates/gate_config.py`
- **Commit:** `1d1afec2b`

## Authentication Gates

None. Plan 34-02 is pure data + stdlib loader; no network or external services.

## TDD Gate Compliance

| Gate | Commit | Status |
|---|---|---|
| RED | `593e838b7` — `test(34-02): add failing tests for 8-gate YAML config loader` | ✓ 11 failed, 3 skipped |
| GREEN | `1d1afec2b` — `feat(review_gates): 8 V8.6 gates config (Phase 34-02)` | ✓ 14 passed |
| REFACTOR | — | Not needed (clean first pass) |

Sequence verified in `git log`: RED (`593e838b7`) precedes GREEN (`1d1afec2b`).

## Known Stubs

None. All 8 gate definitions are fully populated with real CF-02 values. No placeholder text, no empty defaults, no TODOs.

## Threat Flags

None. This plan ships pure static configuration + a stdlib YAML loader. No new network endpoints, auth paths, file access patterns, or trust-boundary schema changes. The `callback_url` field is present but null for all gates — webhook wiring is Plan 34-03's concern.

## Self-Check: PASSED

- Files created: `plugins/review_gates/gates.yaml` ✓, `plugins/review_gates/gate_config.py` ✓, `plugins/review_gates/tests/test_gates_config.py` ✓
- Commits: RED `593e838b7` ✓, GREEN `1d1afec2b` ✓
- SUMMARY.md present ✓
- 14/14 tests pass ✓
