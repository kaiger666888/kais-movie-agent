---
phase: 41-emotion-recipe-library
plan: 03
subsystem: pipeline_state/recipe_library
tags: [emotion-recipe, recipe-library, similarity, cosine, jaccard, pure-stdlib, tdd]
requires:
  - 41-01-PLAN  # RecipeLibrary list_recipes (data source for query)
  - 41-02-PLAN  # _wilson_ci helpers + structure schema (builds on numerical vector)
provides:
  - "RecipeLibrary.query_by_structure(structure_query, top_k=5, min_score=0.7) -> list[(dict, float)]"
  - "_cosine_similarity(vec_a, vec_b) -> float (pure stdlib, math.sqrt)"
  - "_jaccard_similarity(list_a, list_b) -> float (set built-in)"
  - "_structure_to_numerical_vector(structure) -> [hook, mean(turning_points), drop_level]"
affects:
  - "RECIPE-LIB-01 — fully complete (5/5 core methods shipped across 41-01/02/03)"
  - "RECIPE-LIB-05 — fully complete (3/3 query modes: genre filter, validation filter, structure similarity)"
  - "Phase 42 feedback_ingest.py — operators can now query 'what worked for similar structure?' before pushing feedback"
  - "Future Phase 42+ convergence dashboard — query_by_structure is the primary similarity surface"
tech-stack:
  added: []
  patterns:
    - "Pure stdlib cosine similarity (math.sqrt + sum — no numpy/scipy/sklearn)"
    - "Pure stdlib Jaccard similarity (set intersection/union built-in)"
    - "List-compressed-to-scalar vector mapping (turning_points_sec list → mean scalar — WARNING #4)"
    - "Stable-sort ranking with insertion-order tiebreaker (Python sorted() stability)"
    - "Combined weighted score: 0.7 * cosine(numerical) + 0.3 * jaccard(categorical)"
    - "TDD RED→GREEN per task with atomic commits (test commit + feat commit per task)"
key-files:
  created:
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_recipe_library_query.py
  modified:
    - /data/workspace/hermes-agent/plugins/pipeline_state/recipe_library.py
decisions:
  - "WARNING #4 refinement applied: turning_points_sec list collapsed to scalar mean BEFORE cosine (list-of-ints cannot feed a fixed-width dot product across recipes with different list lengths)"
  - "Weighting 0.7 cosine / 0.3 jaccard locked from CONTEXT.md — numerical structure weighted higher than categorical emotion"
  - "Delegates to list_recipes() for candidate set (latest-version-only) — single source of truth, no duplicate historical-version scoring"
  - "Input validation (T-41-18): top_k < 1 or min_score outside [0,1] raise ValueError — fail-fast on programmer error"
  - "Missing structure_query fields degrade to defaults (hook=0, tp=[], drop=0, emo_seq=[]) — operator-facing API must be forgiving"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-27"
  tasks: 3
  files: 2
  tests-added: 31
---

# Phase 41 Plan 03: query_by_structure (Structure Similarity Query) Summary

Delivered the 5th and final core RecipeLibrary method — `query_by_structure(structure_query, top_k=5, min_score=0.7)` — the primary consumer-facing API for finding "what recipes worked for similar structure?" This plan completes RECIPE-LIB-01 (all 5 core methods shipped) and RECIPE-LIB-05 (all 3 query modes supported).

## Deliverables

**3 new module-level helpers added to `recipe_library.py`:**

1. **`_cosine_similarity(vec_a, vec_b) -> float`** — pure stdlib cosine (`math.sqrt` + `sum`); returns `0.0` on zero-magnitude input (no divide-by-zero — threat T-41-14). Range `[-1.0, 1.0]`.

2. **`_jaccard_similarity(list_a, list_b) -> float`** — `|A ∩ B| / |A ∪ B|` via `set` built-in; order-insensitive; duplicates collapse; returns `0.0` on both-empty. Range `[0.0, 1.0]`.

3. **`_structure_to_numerical_vector(structure) -> list[float]`** — extracts the 3-dim vector `[hook_position_sec, mean(turning_points_sec), emotion_drop_level]` used by cosine. Applies WARNING #4 refinement: the `turning_points_sec` list is collapsed to its scalar mean before the dot product.

**1 new public method on `RecipeLibrary`:**

4. **`query_by_structure(structure_query, top_k=5, min_score=0.7) -> list[tuple[dict, float]]`** — RECIPE-LIB-01 method #5 + RECIPE-LIB-05 query mode #3. Returns the top-K most-similar recipes (latest version per recipe_id only) ranked by combined similarity score, filtered to `score >= min_score`.

## Similarity Algorithm (CONTEXT.md LOCK — pure stdlib)

```python
score = 0.7 * cosine(numerical_vector) + 0.3 * jaccard(emotion_sequence)
```

**Numerical vector** (3-dim, fed to cosine):

```python
[
    float(hook_position_sec),               # int seconds → float
    float(mean(turning_points_sec) or 0),   # list → scalar mean (WARNING #4)
    float(emotion_drop_level),              # int 1-5 → float
]
```

**Jaccard input** (treated as sets): the two `emotion_sequence` lists.

**Weighting rationale (CONTEXT.md):** numerical structure (0.7) weighted higher than categorical emotion (0.3) — structure carries more signal for "did this recipe work for a similar shape of story?"

## Pure-Stdlib Proof (threat T-41-15)

```bash
$ grep -c "math.sqrt" plugins/pipeline_state/recipe_library.py
4                                      # 3 from 41-02 (_wilson_ci) + 1 new (_cosine_similarity)
$ grep -c "scipy\|numpy\|sklearn" plugins/pipeline_state/recipe_library.py
0
```

Verified additionally by `TestSimilarityHelpers.test_similarity_helpers_use_pure_stdlib` — introspects the source of both helpers via `inspect.getsource()` and asserts:
- `_cosine_similarity` source contains `"math.sqrt"` and none of `{scipy, numpy, sklearn}`
- `_jaccard_similarity` source contains `"set("` and none of `{scipy, numpy, sklearn}`

## query_by_structure Contract

```python
def query_by_structure(
    self,
    structure_query: dict,
    top_k: int = 5,
    min_score: float = 0.7,
) -> list[tuple[dict, float]]:
```

**Implementation flow (5 steps):**

1. Input validation — `ValueError` on `top_k < 1` or `min_score` outside `[0, 1]` (threat T-41-18).
2. `candidates = self.list_recipes()` — get latest version per recipe_id (41-01 method; threat T-41-16 mitigation — historical versions never leak).
3. Build query vector + emotion set ONCE (avoid recompute per candidate).
4. For each candidate: compute `cos = _cosine_similarity(...)`, `jac = _jaccard_similarity(...)`, `score = 0.7*cos + 0.3*jac`. Keep if `score >= min_score`.
5. Stable sort descending by score (Python's `sorted(..., reverse=True)` is stable — threat T-41-17 mitigation: ties preserve insertion order). Truncate to `top_k`.

**Default behavior:** `top_k=5`, `min_score=0.7` → returns 0-5 high-similarity recipes. Operators tune these per use case.

**Degrade rules (operator-facing API must be forgiving):**
- Empty candidate library → return `[]`
- Missing `structure_query` fields → treated as defaults (`hook=0`, `turning_points=[]`, `drop_level=0`, `emotion_sequence=[]`)
- Zero-magnitude query vector (all zeros) → cosine returns `0.0` (early-return guard); score collapses to `0.3 * jaccard`; if jaccard also `0.0`, score is `0.0` and the recipe is filtered out by default `min_score=0.7`

## RECIPE-LIB-01 Complete (5/5 Core Methods)

| # | Method | Plan | Purpose |
|---|--------|------|---------|
| 1 | `create_recipe` | 41-01 | Append a new v1 recipe to the JSONL slot |
| 2 | `get_recipe` | 41-01 | Fetch by recipe_id (optionally specific version) |
| 3 | `list_recipes` | 41-01 | List latest-version-per-id with genre/converged filters |
| 4 | `update_validation` | 41-02 | Append a new version with updated Wilson CI (Phase 42 contract) |
| 5 | `query_by_structure` | **41-03** | **Structure-similarity ranked query (this plan)** |

Verified via:
```bash
$ python3 -c "from plugins.pipeline_state.recipe_library import RecipeLibrary; \
    [print(f'OK: {m}') for m in ['create_recipe','get_recipe','list_recipes', \
    'update_validation','query_by_structure'] if hasattr(RecipeLibrary, m)]"
OK: create_recipe
OK: get_recipe
OK: list_recipes
OK: update_validation
OK: query_by_structure
```

## RECIPE-LIB-05 Complete (3/3 Query Modes)

| Mode | Method | Plan |
|------|--------|------|
| By genre | `list_recipes(genre="...")` | 41-01 |
| By validation status | `list_recipes(converged=True)` | 41-01 |
| By structure similarity | `query_by_structure(query)` | **41-03 (this plan)** |

## Test Count Added

**31 new tests across 1 file** (`tests/test_recipe_library_query.py`):

- `TestSimilarityHelpers` — **14 tests** (Task 1)
  - cosine × 5 (identical→1.0, orthogonal→0.0, opposite→-1.0, zero-vector→0.0, magnitude-invariant→1.0)
  - jaccard × 6 (identical, disjoint, partial 1/3, both-empty, order-insensitive, duplicates-collapse)
  - structure→vector × 2 (full structure with mean computation, empty turning_points degrade)
  - pure-stdlib source inspection × 1 (threat T-41-15: `inspect.getsource` asserts no scipy/numpy/sklearn tokens)

- `TestRecipeLibraryQuery` — **17 tests** (Task 2)
  - 15 plan-spec tests: empty library, exact match→1.0, ranking descending, min_score default filter, min_score strict, min_score=0 returns all, top_k=5 default cap, top_k=3 explicit, top_k>library size, combined formula numeric verification (Test 10), latest-version-only no double-count, tuple shape `(dict, float)`, missing-field degrade, stable-sort tiebreaker, zero-magnitude query vector
  - 2 input-validation tests (threat T-41-18): `top_k < 1` raises `ValueError`, `min_score` outside `[0, 1]` raises `ValueError`

## TDD Gate Compliance

Plan is `type: tdd`. Gate sequence verified in git log:

1. **RED gate** — `9cd7efd5d test(41-03): similarity helpers + structure-vector mapping (RED→GREEN)` — Task 1 tests committed before method existed (initially failed with `ImportError: cannot import name '_cosine_similarity'`).
2. **GREEN gate** — `3875dfce8 feat(41-03): query_by_structure with cosine+jaccard similarity (RECIPE-LIB-05)` — Task 2 method implementation, tests pass.

Task 1 used the combined RED→GREEN pattern (single commit covers both gates — tests written first, then helpers added, both verified before commit). Task 2 used the same pattern (tests added to existing file, then method added, both verified before commit). Task 3 was verification-only (`type="auto"`) and produced no separate commit since the implementation was already committed atomically in Tasks 1 and 2.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected Test 5 (test_min_score_explicit_stricter) Partial-candidate fixture**
- **Found during:** Task 2 RED→GREEN iteration
- **Issue:** The original plan-spec fixture for the "Partial" candidate used a small numerical perturbation — `turning_points_sec=[5, 20, 35, 60]` (mean 30) vs query's `[3, 15, 30, 55]` (mean 25.75). The query vector is dominated by its middle component (25.75 of the 26.23 magnitude), so a small shift in that component yields cosine ≈ 0.998 and combined score ≈ 0.998 — well above the strict `min_score=0.9` threshold the test was trying to exclude it with. The test assertion `len(strict) == 1` failed because both Perfect AND Partial scored above 0.9.
- **Fix:** Switched the Partial candidate to zero out `turning_points_sec` (empty list → mean 0.0 → vector `[3, 0, 4]`). This pulls the middle component to 0, producing a verifiable cosine ≈ 0.19 (`dot=25`, `||q||≈26.23`, `||c||=5`, `25/(26.23*5)=0.1905`) and combined score ≈ 0.43 — comfortably below 0.9 and above 0. The same construction is reused in Test 10 (`test_combined_score_formula`) for cross-verification.
- **Files modified:** `tests/test_recipe_library_query.py::TestRecipeLibraryQuery::test_min_score_explicit_stricter`
- **Commit:** 3875dfce8

No other deviations. The implementation matches CONTEXT.md's similarity algorithm lock exactly; all 15 plan-spec tests pass (plus 2 additional input-validation tests for threat T-41-18).

## Threat Model Mitigation Status

All 5 mitigated threats from the plan's `<threat_model>` are covered by passing tests:

| Threat | Category | Mitigation test | Status |
|--------|----------|-----------------|--------|
| T-41-14 | Denial of Service (zero-vector divide-by-zero) | Test 4 (Task 1) + Test 15 (Task 2) — cosine early-returns 0.0 | PASS |
| T-41-15 | Tampering (scipy/numpy smuggled) | Test 14 (Task 1) — `inspect.getsource` token assertion | PASS |
| T-41-16 | Information Disclosure (historical versions leak) | Test 11 (Task 2) — multi-version recipe counts once | PASS |
| T-41-17 | Repudiation (silent tie reordering) | Test 14 (Task 2) — stable-sort preserves insertion order | PASS |
| T-41-18 | Tampering (invalid top_k / min_score) | 2 input-validation tests — `ValueError` on out-of-range | PASS |

## Self-Check: PASSED

- FOUND: `/data/workspace/hermes-agent/plugins/pipeline_state/recipe_library.py` (modified)
- FOUND: `/data/workspace/hermes-agent/plugins/pipeline_state/tests/test_recipe_library_query.py` (created)
- FOUND: commit `9cd7efd5d` (Task 1 — similarity helpers RED→GREEN)
- FOUND: commit `3875dfce8` (Task 2 — query_by_structure GREEN)

Verification commands executed:
- `python3 -m pytest plugins/pipeline_state/tests/test_recipe_library_query.py -q` → **31 passed**
- `python3 -m pytest plugins/pipeline_state/tests/ -q` → **302 passed** (271 baseline + 31 new)
- `grep -c "math.sqrt" recipe_library.py` → **4** (3 from 41-02 + 1 new)
- `grep -c "scipy\|numpy\|sklearn" recipe_library.py` → **0** ✓
- All 5 core RecipeLibrary methods present ✓
- `inspect.signature(RecipeLibrary.query_by_structure)` → params = `['self', 'structure_query', 'top_k', 'min_score']` ✓
