---
phase: 41-emotion-recipe-library
plan: 02
subsystem: pipeline_state/recipe_library
tags: [emotion-recipe, recipe-library, wilson-ci, convergence-loop, phase-42-contract]
requires:
  - 41-01-PLAN  # RecipeLibrary skeleton (create/get/list) + emotion-recipe slot
provides:
  - "RecipeLibrary.extract_structure_from_episode(episode_id) -> dict | None"
  - "RecipeLibrary.update_validation(recipe_id, platform, completion_rate, sample_size_delta=1) -> dict | None"
  - "_wilson_ci(passed, total, z=1.96) -> tuple[float, float]"
  - "_is_converged(sample_size, lower, upper, *, min_sample=10, max_spread=0.10) -> bool"
affects:
  - "Phase 42 feedback_ingest.py — will call update_validation to close convergence loop"
  - "future 41-03 query_by_structure — will reuse the structure schema produced here"
tech-stack:
  added: []
  patterns:
    - "Pure stdlib Wilson CI (math.sqrt only — no scipy/numpy)"
    - "Append-only multi-version JSONL semantics (deepcopy + version=N+1)"
    - "Best-effort helper pattern (None + WARNING log on missing/malformed data)"
key-files:
  created:
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_recipe_library_extraction.py
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_recipe_library_update_validation.py
  modified:
    - /data/workspace/hermes-agent/plugins/pipeline_state/recipe_library.py
decisions:
  - "DATA SOURCE PIVOT (plan-checker BLOCKER #1): reads story-framework + final-audit slots (NOT creative-history). Structural data in story-framework.{mcmahon_arc, snowflake_artifacts.anchor_validation, snyder_beats_summary}; 5-dim quality scores in final-audit.scores.{D1-D5}."
  - "Wilson CI implemented in pure stdlib via math.sqrt (no scipy/numpy) — keeps dependency surface minimal per CONTEXT.md D-07 decision"
  - "update_validation signature LOCKED for Phase 42 — exact parameter names + defaults preserved"
  - "Multi-version append-only: deepcopy latest row, bump version, append — old rows never mutated"
metrics:
  duration: "~25 minutes"
  completed: "2026-06-27"
  tasks: 4
  files: 3
  tests-added: 44
---

# Phase 41 Plan 02: Story-Framework + Final-Audit Extraction + Wilson CI + update_validation Summary

Implemented the convergence-loop core of Phase 41 — 3 new methods/helpers in `recipe_library.py` that convert V5.0 structural + quality data into structured emotion recipes and define the validation-update API Phase 42 will trigger.

## Deliverables

**3 new methods/helpers added to `recipe_library.py`:**

1. **`extract_structure_from_episode(episode_id) -> dict | None`** — RECIPE-LIB-04
   Reads V5.0 `story-framework` + `final-audit` AssetBus slots (NOT creative-history — DATA SOURCE PIVOT applied), applies the 5-field mapping table, returns a structure{} dict OR None on missing/malformed slot.

2. **`_wilson_ci(passed, total, z=1.96) -> tuple[float, float]`** — pure stdlib
   Wilson score confidence interval using `math.sqrt` only (NO scipy/numpy). Returns `(0.0, 1.0)` widest interval on `total <= 0` (divide-by-zero mitigation, threat T-41-09).

3. **`update_validation(recipe_id, platform, completion_rate, sample_size_delta=1) -> dict | None`** — RECIPE-LIB-01 (Phase 42 contract, signature LOCKED)
   Appends a new version row to an existing recipe, recomputes Wilson CI + converged flag, never mutates old versions (append-only invariant).

**Plus 3 module-level helpers:** `MCMAHON_ARC_EMOTIONS` lookup table, `_parse_anchor_validation`, `_map_d2_to_drop_level`, `_map_d5_to_ending_state`, `_is_converged`.

## DATA SOURCE PIVOT Applied

Per plan-checker BLOCKER #1 (locked 2026-06-27), the original blueprint assumed the 5-dim script_auditor scores lived in `creative-history`. V5.0 verified reality (from `pipeline-runs/ep-001/.pipeline-assets/`):

| Slot | Contains | Phase 41 reads |
|------|----------|----------------|
| `creative-history` | hash-stamping lineage records ONLY | NOT read by this module |
| `story-framework` | structural data: `mcmahon_arc`, `snowflake_artifacts.anchor_validation`, `snyder_beats_summary` | YES (3 fields) |
| `final-audit` | 5-dim quality scores: `D1_narrative, D2_emotion, D3_hook, D4_character, D5_completion` (0-20 scale) | YES (D2 + D5) |

Verification (grep): `creative-history` count = 0 in `recipe_library.py`; `story-framework|final-audit` count = 14.

## Mapping Table (verbatim from CONTEXT.md)

| structure{} field | Source slot | Source path | Mapping logic |
|-------------------|-------------|-------------|---------------|
| `hook_position_sec` (int) | story-framework | `snowflake_artifacts.anchor_validation` | Parse "Catalyst ~Ns" → `int(float(N))`; fallback to first snyder_beats range lower bound |
| `emotion_sequence` (list[str]) | story-framework | `story_kernel.mcmahon_arc` | Lookup via MCMAHON_ARC_EMOTIONS table; fallback `["setup","rising","climax","resolution"]` + WARNING on unknown arc |
| `turning_points_sec` (list[int]) | story-framework | `snowflake_artifacts.anchor_validation` | Parse ALL "~Ns" timestamps → `[int(float(x)) for x in matches]` |
| `emotion_drop_level` (int 1-5) | final-audit | `scores.D2_emotion` (0-20) | `int((20 - D2) / 4) + 1` clamped `[1,5]` (lower D2 → bigger drop) |
| `ending_state` (str enum) | final-audit | `scores.D5_completion` (0-20) | `D5 >= 16 → "resolved"`, `D5 >= 12 → "new_suspense"`, else `"cliffhanger"` |

## McMahon Arc → emotion_sequence Lookup Table (6 arcs + fallback)

```python
MCMAHON_ARC_EMOTIONS = {
    "man_in_a_hole":     ["hope", "descent", "crisis", "recovery"],
    "rags_to_riches":    ["low", "rise", "peak", "fall"],
    "the_quest":         ["call", "trial", "ordeal", "boon"],
    "voyage_and_return": ["depart", "wonder", "terror", "return"],
    "rebirth":           ["sin", "realization", "redemption", "new_life"],
    "tragedy":           ["pride", "error", "catastrophe", "aftermath"],
}
# Unknown arc → ["setup", "rising", "climax", "resolution"] + WARNING log
```

## anchor_validation Regex Parsing

- Hook: `r"Catalyst\s*~(\d+(?:\.\d+)?)s"` → `int(float("7.5"))` = 7 (round-toward-zero)
- All turning points: `r"~(\d+(?:\.\d+)?)s"` global findall → `[int(float(x)) for x in matches]`
- Fallback (Catalyst absent): `r"\((\d+)-\d+s\)"` on snyder_beats, take lower bound

Reference: `"Catalyst ~7.5s ✓ / Midpoint ~37s ✓ / All Is Lost ~55s ✓"` → hook=7, turning_points=[7, 37, 55]

## D2_emotion → emotion_drop_level Formula

```python
raw = int((20 - D2) / 4) + 1
drop_level = max(1, min(5, raw))
```

| D2 | raw | drop_level (clamped) |
|----|-----|----------------------|
| 20 | 1 | 1 |
| 17 | 1 (int(3/4)+1 = 0+1) | 1 |
| 16 | 2 | 2 |
| 12 | 3 | 3 |
| 8  | 4 | 4 |
| 4  | 5 | 5 |
| 0  | 6 | 5 (clamped) |

**WARNING #1 (CONTEXT.md) handled:** Computed from a single D2 scalar per episode — no per-shot mean, no double quantization.

## D5_completion → ending_state Thresholds

- `D5 >= 16` → `"resolved"`
- `12 <= D5 < 16` → `"new_suspense"`
- `D5 < 12` → `"cliffhanger"`

## Wilson CI Pure-Stdlib Verification

```python
def _wilson_ci(passed, total, z=1.96):
    if total <= 0: return (0.0, 1.0)
    p = passed / total
    denom = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denom
    spread = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denom
    return (center - spread, center + spread)
```

Grep proof:
- `math.sqrt` count in recipe_library.py: **3** (uses stdlib)
- `scipy|numpy` count: **0** (no third-party scientific libs)
- Unit test `test_uses_math_sqrt_no_scipy_numpy` introspects source via `inspect.getsource` and asserts absence of forbidden tokens (threat T-41-12).

## Converged Flag Rule

```python
converged = (sample_size >= 10) AND ((upper - lower) <= 0.10)
```

Both conditions required — sample sufficiency AND tightness. ±5% half-width means total spread ≤ 10%.

## update_validation Signature (Phase 42 Contract — LOCKED)

```python
def update_validation(
    self,
    recipe_id: str,
    platform: str,
    completion_rate: float,
    sample_size_delta: int = 1,
) -> dict | None:
```

Verified via `inspect.signature(RecipeLibrary.update_validation)` — parameter names + defaults match exactly. Phase 42 `feedback_ingest.FeedbackIngestClient` will call this method after each feedback submission to close the convergence loop.

## Multi-Version Append-Only Invariant Proof

`update_validation` flow:
1. `latest = self.get_recipe(recipe_id)` — KeyError propagates if unknown
2. Input validation: completion_rate ∈ [0,1], sample_size_delta ≥ 1, platform ∈ {douyin, bilibili, youtube}
3. Compute new validation{}: running-average blend (single-step, no double quantization), Wilson CI, converged flag
4. `new_row = copy.deepcopy(latest)`; bump version; set new validation; set `last_validated = now ISO 8601 UTC`; `bus.append_line()`; return new_row

**Proof test (Test 8 — `test_multi_version_append_only_invariant`):** After 3 update calls, `bus.read_lines("emotion-recipe")` returns 4 rows for the recipe_id with versions [1, 2, 3, 4]. The v1 row is byte-identical to initial state (`sample_size=0`, `last_validated=None`); the v2 row retains its original `sample_size=1`. Old rows are NEVER mutated.

## Verified Against ACTUAL V5.0 Fixtures (Test 11 — Canonical End-to-End)

`TestFullEpisodeExtractFromV5Fixtures.test_canonical_ep_001_extraction` seeds `story-framework` and `final-audit` slots with the ACTUAL inner `.value` content from `pipeline-runs/ep-001/.pipeline-assets/{story-framework,final-audit}.json` (envelope fields stripped; `bus.write` re-wraps). Verifies:

```python
result == {
    "hook_position_sec": 7,                                    # Catalyst ~7.5s → int(7.5)=7
    "emotion_sequence": ["hope", "descent", "crisis", "recovery"],  # man_in_a_hole
    "turning_points_sec": [7, 37, 55],                         # all ~Ns timestamps
    "emotion_drop_level": 1,                                   # int((20-17)/4)+1 = 0+1 = 1
    "ending_state": "resolved",                                # D5=16 >= 16
}
```

## Test Count Added

**44 new tests across 2 files (17 extraction + 10 Wilson CI + 17 update_validation):**

- `tests/test_recipe_library_extraction.py` — 15 tests (+ 2 parametrize expansions = 17 collected)
  - McMahon arc lookup × 3 (man_in_a_hole, rags_to_riches, unknown fallback)
  - anchor_validation parsing × 3 (Catalyst hook, all turning_points, fallback)
  - D2→drop_level × 1 (parametrized 3 cases)
  - D5→ending_state × 3 (resolved, new_suspense, cliffhanger)
  - Full episode extract × 1 (canonical V5.0 fixtures)
  - Missing-data degrade × 3 (no story-framework, no final-audit, malformed)
  - Integration × 1 (extracted structure → create_recipe)

- `tests/test_recipe_library_update_validation.py` — 27 tests (10 Wilson + 14 update_validation + 3 parametrize expansions)
  - Wilson CI × 7 (total=0, all-passed, all-failed, 50/50, small-sample, z-param, math.sqrt inspection)
  - Converged flag × 3 (tight+sufficient True, below-sample False, too-wide False)
  - update_validation × 10 (basic, running average, CI format, default delta, batch delta, converged flip, below-threshold, append-only invariant, KeyError, degrade, platform, ISO timestamp)
  - Input validation × 1 (parametrized 4 out-of-range completion_rates)
  - Phase 42 signature stability × 1

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Test 4 Wilson CI assertion (50/100 spread too wide for <0.10)**
- **Found during:** Task 2 RED phase
- **Issue:** Original plan-spec test asserted `(upper - lower) < 0.10` for `_wilson_ci(50, 100)`, but the actual Wilson spread at 50/100 z=1.96 is ~0.192 (50% pass rate at sample_size=100 is NOT converged — needs much larger sample for tight CI on a 50/50 split).
- **Fix:** Updated assertion to verify centering near 0.5 (`0.45 < mid < 0.55`) instead of the incorrect `< 0.10` spread bound. Behavior under test is unchanged; only the assertion threshold was wrong.
- **Files modified:** `tests/test_recipe_library_update_validation.py::TestWilsonCi::test_50_50_large_sample_centered_near_half`
- **Commit:** 05151183d

**2. [Rule 1 - Bug] Fixed Test 8 converged-True fixture (50/100 not converged)**
- **Found during:** Task 2 RED phase
- **Issue:** Original plan-spec test used `_wilson_ci(50, 100)` expecting `_is_converged(100, lower, upper) is True`, but as noted above spread is 0.19 > 0.10 so converged is False.
- **Fix:** Switched to `_wilson_ci(500, 1000)` (spread ~0.06 ≤ 0.10) which correctly demonstrates the converged=True case.
- **Files modified:** `tests/test_recipe_library_update_validation.py::TestWilsonCi::test_converged_true_at_sample_10_tight_ci`
- **Commit:** 05151183d

**3. [Rule 1 - Bug] Removed literal "scipy"/"numpy" tokens from `_wilson_ci` docstring**
- **Found during:** Task 2 GREEN phase
- **Issue:** The original docstring contained the literal tokens "scipy" and "numpy" in the explanation of threat T-41-12. The test `test_uses_math_sqrt_no_scipy_numpy` asserts these tokens absent via `inspect.getsource(_wilson_ci)`, so the literal references in the docstring caused the test to fail (the function's own source must not contain the forbidden tokens).
- **Fix:** Rephrased the docstring to refer to "third-party scientific libraries" instead of naming them literally.
- **Files modified:** `recipe_library.py` (`_wilson_ci` docstring)
- **Commit:** 05151183d

**4. [Rule 1 - Bug] Fixed f-string syntax error in platform ValueError**
- **Found during:** Task 3 GREEN phase
- **Issue:** `f"platform must be one of {_VALID_PLATFORMS - {''!r}}, ..."` is invalid f-string syntax (nested `!r` inside set literal confuses the parser).
- **Fix:** Extracted `valid_update_platforms = _VALID_PLATFORMS - {""}` to a local variable before the f-string, then used `sorted(valid_update_platforms)` in the message.
- **Files modified:** `recipe_library.py` (`update_validation` input validation block)
- **Commit:** 2324e09ca

**5. [Rule 2 - Critical] Updated module docstring to reflect DATA SOURCE PIVOT**
- **Found during:** Task 3 finalization
- **Issue:** The module-level docstring still claimed "Converts V5.0 creative-history 5-dim script_auditor scores..." — stale documentation from before the plan-checker BLOCKER #1 pivot. This is a correctness issue (misleading docs) AND causes the plan's verification gate `grep -c "creative-history"` to return non-zero (expected 0).
- **Fix:** Rewrote module docstring to describe the actual data sources (story-framework + final-audit) and explicitly reference the pivot decision.
- **Files modified:** `recipe_library.py` (module docstring + comment on `extract_structure_from_episode`)
- **Commit:** 2324e09ca

## Threat Model Mitigation Status

All 7 mitigated threats from the plan's `<threat_model>` are covered by passing tests:

| Threat | Mitigation test | Status |
|--------|-----------------|--------|
| T-41-07 (slot shape tampering) | Test 12, 13, 14 (missing/malformed degrade) | PASS |
| T-41-07b (unknown mcmahon_arc) | Test 3 (unknown arc fallback + WARNING) | PASS |
| T-41-08 (mutate existing version) | Test 8 (append-only invariant) | PASS |
| T-41-09 (Wilson divide-by-zero) | Test 1 + early-return on total<=0 | PASS |
| T-41-10 (out-of-range completion_rate) | Test 13 (ValueError on bad_cr) | PASS |
| T-41-11 (silent update_validation failure) | Test 10 (warning logged on bus failure) | PASS |
| T-41-12 (scipy/numpy smuggled) | Test 7 (inspect.getsource assertion) | PASS |

## Self-Check: PASSED

- FOUND: `/data/workspace/hermes-agent/plugins/pipeline_state/recipe_library.py`
- FOUND: `/data/workspace/hermes-agent/plugins/pipeline_state/tests/test_recipe_library_extraction.py`
- FOUND: `/data/workspace/hermes-agent/plugins/pipeline_state/tests/test_recipe_library_update_validation.py`
- FOUND: commit 70a7aca18 (Task 1 — extract_structure_from_episode)
- FOUND: commit 05151183d (Task 2 — _wilson_ci + _is_converged)
- FOUND: commit 2324e09ca (Task 3 — update_validation)

Verification commands executed:
- `python -m pytest plugins/pipeline_state/tests/ -q` → **271 passed** (V5.0 + Phase 41-01 + 41-02 regression)
- `inspect.signature(RecipeLibrary.update_validation)` → params = `['self', 'recipe_id', 'platform', 'completion_rate', 'sample_size_delta']` ✓
- `grep -c "math.sqrt" recipe_library.py` → 3 ✓
- `grep -c "scipy\|numpy" recipe_library.py` → 0 ✓
- `grep -c "story-framework\|final-audit" recipe_library.py` → 14 ✓
- `grep -c "creative-history" recipe_library.py` → 0 ✓ (data source pivot applied)
