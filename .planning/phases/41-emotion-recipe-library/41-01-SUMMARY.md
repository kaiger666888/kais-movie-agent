---
phase: 41-emotion-recipe-library
plan: 01
subsystem: pipeline_state/recipe_library
tags: [python, assetbus, jsonl, tdd, pure-stdlib]
requires:
  - Phase 33 AssetBus V3 (append_line/read_lines JSONL dispatch)
  - Phase 36 emotion-recipe downstream consumers (none yet — 41-02 onward)
provides:
  - RecipeLibrary class with create_recipe / get_recipe / list_recipes (3 of 5 core methods)
  - emotion-recipe AssetBus JSONL slot (append-only, writer_phase=recipe_library)
  - slugify + recipe_id sequencing helpers (<slug>-<NNN> zero-padded 3 digits)
affects:
  - Plan 41-02 update_validation (uses _build_initial_recipe schema + read_lines)
  - Plan 41-03 query_by_structure (uses list_recipes as data source)
  - Plan 41-04 integration (recipe_library wired into Phase 42 feedback_ingest)
  - plugins.pipeline_state namespace (RecipeLibrary added to exports)
tech-stack:
  added: []
  patterns:
    - append-only AssetBus slot extension (D-36-05 — V5.0 slots byte-equivalent)
    - TDD RED→GREEN per task (test commit + feat commit per task)
    - pure stdlib sync API (D-07 — no async, no third-party deps)
    - JSONL schema strict (16 fields, types enforced in _validate_structure)
    - degrade-mode logger.warning + None return on AssetBus failure (mirrors creative_history.py)
    - Chinese-fallback slug ("recipe") for non-ASCII genre strings
key-files:
  created:
    - /data/workspace/hermes-agent/plugins/pipeline_state/recipe_library.py
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_recipe_library.py
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus_emotion_recipe_slot.py
  modified:
    - /data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py (1 new ASSET_SCHEMA entry appended after episode-meta)
    - /data/workspace/hermes-agent/plugins/pipeline_state/__init__.py (1 import line added)
    - /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus_phase35_slots.py (expected JSONL list updated to include emotion-recipe — deviation)
decisions:
  - "validation.confidence_interval stored as human-readable string '±N%' (not ci_lower/ci_upper floats) per CONTEXT.md recipe JSONL schema — keeps operator-facing surface readable"
  - "validation.platform starts as '' (empty string, unset) on create — first update_validation (41-02) overwrites with the platform enum"
  - "_slugify empty-slug fallback: literal 'recipe' (so all-Chinese genre like '都市奇幻·轻喜剧' produces recipe_id 'recipe-001' rather than '-001' or '001')"
  - "get_recipe raises KeyError (not returns None) on unknown recipe_id — consistent with creative_history.py 'pure library code, programmer errors raise' pattern"
  - "RecipeLibrary is a library class, NOT a tool handler — re-exported via __init__ for namespace discovery but NOT added to _TOOLS tuple or register(ctx)"
  - "JSONL_SLOTS frozenset UNCHANGED at {finetune-dataset} — emotion-recipe dispatched via ASSET_SCHEMA[slot]['format'] == 'jsonl' (verified Phase 40-01 pattern)"
  - "Do NOT split Task 2 into 2a/2b — the 3 methods are mutually dependent (get reads what create writes; list filters both); splitting would duplicate fixture setup ~30%"
metrics:
  duration: ~22min
  completed: 2026-06-27
  loc:
    recipe_library.py: 307
    test_recipe_library.py: 345
    test_asset_bus_emotion_recipe_slot.py: 189
  tests: 46  # 24 slot regression + 22 RecipeLibrary (16 from plan + 6 slugify edge cases)
  commits: [fbbb038b9, 300498292, 4a81e7e2a, 805d5074e, e2284f3a4]
---

# Phase 41 Plan 01: Emotion Recipe Library Skeleton Summary

Registered the `emotion-recipe` AssetBus JSONL slot (append-only, V5.0-safe) and shipped the RecipeLibrary module skeleton with 3 of 5 core methods (create_recipe / get_recipe / list_recipes) + slugify helper + recipe_id `<slug>-<NNN>` sequencing.

## What Shipped

### `recipe_library.py` (307 LOC) — RecipeLibrary class + 5 module-level helpers

**Public methods (plan 41-01 ships 3 of 5):**

- **`create_recipe(genre, structure, source_episode) -> str | None`** — validates structure (5 fields, types enforced), slugifies genre, sequences recipe_id, appends version=1 row to emotion-recipe slot, returns recipe_id. On AssetBus failure: logs warning + returns None (does not raise). On bad structure: raises ValueError (programmer error).
- **`get_recipe(recipe_id, *, version=None) -> dict`** — reads all rows, filters by recipe_id; returns latest version by default, specific version on request. Raises `KeyError(f"recipe_id not found: {recipe_id}")` on unknown recipe_id.
- **`list_recipes(*, genre=None, converged=None) -> list[dict]`** — reads all rows, groups by recipe_id, picks latest version per group, applies genre/converged filters, returns list. Empty slot returns `[]`.

**Private helpers:**

- **`_slugify(text)`** — lowercase, whitespace→hyphen, strip `[^a-z0-9-]`, collapse consecutive hyphens. Empty result (e.g., all-Chinese genre) falls back to literal `"recipe"` so recipe_id stays non-empty + ASCII-safe.
- **`_validate_structure(structure)`** — RECIPE-LIB-02 schema strict: `hook_position_sec` (int >= 0), `emotion_sequence` (non-empty list[str]), `turning_points_sec` (list[int]), `emotion_drop_level` (int in [1,5]), `ending_state` (enum: resolved|new_suspense|cliffhanger). Bool guard on int checks (Python bool is int subclass).
- **`_build_initial_recipe(...)`** — assembles the 16-field dict with version=1 and initial validation{} values.
- **`_next_sequence(rows, slug)`** — max+1 over existing `<slug>-<NNN>` recipe_ids (or 1 if none).
- **`_latest_version(rows, recipe_id)`** — max-version row picker for a given recipe_id.

**Schema contract (16 fields, RECIPE-LIB-02):**

```python
{
  "recipe_id": "urban-fantasy-001",          # str
  "version": 1,                               # int
  "genre": "Urban Fantasy",                   # str
  "structure": {                              # 5 fields
    "hook_position_sec": 3, "emotion_sequence": [...],
    "turning_points_sec": [...], "emotion_drop_level": 4,
    "ending_state": "new_suspense",
  },
  "validation": {                             # 5 fields — initial values on create
    "platform": "", "completion_rate": 0.0,
    "confidence_interval": "±0%", "sample_size": 0, "converged": False,
  },
  "provenance": {                             # 3 fields — RECIPE-LIB-06 traceability
    "source_episode": "ep-001",
    "created": "2026-06-27T...", "last_validated": None,
  },
}
```

### `asset_bus.py` — ASSET_SCHEMA extension (append-only)

Single new entry appended after `episode-meta`:

```python
"emotion-recipe": {
    "file": "emotion-recipe.jsonl",
    "format": "jsonl",  # append-only — use append_line() / read_lines()
    "description": "Structured emotion recipes extracted from creative-history "
                   "5-dim script_auditor scores. One line per recipe version "
                   "(update_validation appends version=N+1). Reader: operator-side "
                   "+ Phase 42 feedback_ingest (calls update_validation).",
    "writer_phase": "recipe_library",
    "reader_phases": [],
},
```

All 32 pre-Phase-41 slots byte-equivalent (REGRESSION GUARD test asserts each slot's file+format against a hardcoded snapshot).

### `__init__.py` — plugin namespace re-export

One import line added after the existing tools import block:

```python
from plugins.pipeline_state.recipe_library import RecipeLibrary  # noqa: F401
```

RecipeLibrary is a **library class**, NOT a tool handler. The `_TOOLS` tuple and `register(ctx)` function are unchanged. The re-export enables `from plugins.pipeline_state import RecipeLibrary` for Phase 42 + operator REPL usage.

### Test files (534 LOC, 46 new tests)

**`test_asset_bus_emotion_recipe_slot.py` (189 LOC, 24 tests)** — `TestEmotionRecipeSlotRegistered` + `TestPrePhase41SlotsPreserved` + `TestJsonlFrozensetUnchanged` + `TestEmotionRecipeSlotRoundTrip`:
- Slot registered + metadata (file/format/writer_phase/reader_phases).
- 32-slot V5.0+Phase40 byte-equivalence regression guard (parametrized snapshot).
- `AssetBus.JSONL_SLOTS == frozenset({"finetune-dataset"})` — emotion-recipe NOT added (D-36-05).
- Round-trip via `append_line`/`read_lines`; `write()`/`read()` raise AssetBusError on jsonl slot.

**`test_recipe_library.py` (345 LOC, 22 tests)** — `TestConstructor` + `TestCreateRecipe` + `TestSlugifyChineseFallback` + `TestSlugifyDirect` + `TestGetRecipe` + `TestListRecipes` + `TestSchemaStrict` + `TestDegradeMode`:
- Constructor: kw-only asset_bus, ValueError on None, TypeError on positional.
- create_recipe: returns recipe_id, writes v1 row with all 16 fields.
- recipe_id sequencing: same-genre increments (001→002), different-genre starts at 001.
- _slugify: whitespace + special chars + consecutive hyphens + Chinese fallback + empty fallback.
- get_recipe: latest by default, specific version on request, KeyError on unknown.
- list_recipes: no filter, genre filter, converged filter, combined filter.
- Schema strict: 16 fields with correct types (RECIPE-LIB-02).
- Degrade mode: bus.append_line IOError → None + warning log.

## recipe_id Sequencing Semantics

```
genre="Urban Fantasy"     → slug="urban-fantasy"     → "urban-fantasy-001"
genre="Urban Fantasy"     → slug="urban-fantasy"     → "urban-fantasy-002"
genre="Sci-Fi Thriller"   → slug="sci-fi-thriller"   → "sci-fi-thriller-001"
genre="都市奇幻·轻喜剧"   → slug="" → "recipe"        → "recipe-001"
genre="  A---B  "         → slug="a-b"               → "a-b-001"
```

Sequence numbers are zero-padded to 3 digits (`{seq:03d}`). Reads all existing rows on each `create_recipe` call to determine the next sequence — O(N) per create, acceptable since recipe creation is operator-triggered (not hot path).

## V5.0 ASSET_SCHEMA + JSONL_SLOTS Preservation

**Append-only extension (D-36-05):**
- All 32 pre-Phase-41 slots verified byte-equivalent via parametrized regression test (file + format fields).
- `AssetBus.JSONL_SLOTS` frozenset UNCHANGED at `frozenset({"finetune-dataset"})`.
- emotion-recipe is dispatched via `ASSET_SCHEMA["emotion-recipe"]["format"] == "jsonl"` (the same path that handles rapid-preview-clips since Phase 40).

**Full pipeline_state test suite: 227 tests passing (was 181 baseline pre-Phase-41).** No V5.0 regression.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated `test_asset_bus_phase35_slots.py::test_jsonl_slots_unchanged` to include emotion-recipe**
- **Found during:** Task 1 GREEN verification
- **Issue:** The existing Phase 35 test asserts `jsonl == ["finetune-dataset", "rapid-preview-clips"]` where `jsonl` is derived from `ASSET_SCHEMA` by filtering `format == "jsonl"`. Adding `emotion-recipe` (jsonl format) caused this assertion to fail — directly blocking Task 1 GREEN.
- **Fix:** Updated expected list to `["finetune-dataset", "rapid-preview-clips", "emotion-recipe"]` + refreshed docstring to document Phase 41 as the third JSONL slot source. The test still catches drift — it now catches drift relative to the post-Phase-41 baseline.
- **Files modified:** `plugins/pipeline_state/tests/test_asset_bus_phase35_slots.py` (1 assertion + docstring)
- **Commit:** 300498292

This is a directly-caused regression-test update — the alternative (letting the test fail) would violate Task 1's Done criterion ("All existing AssetBus tests still pass"). Per Rule 3 scope boundary, this is in-scope because the failure is directly caused by the new ASSET_SCHEMA entry.

## Authentication Gates

None — this plan is pure library code, no external services.

## Known Stubs

None — `create_recipe` / `get_recipe` / `list_recipes` are fully implemented with real AssetBus I/O (no mocks, no placeholders, no TODO markers). `_validate_structure` enforces the full RECIPE-LIB-02 contract.

## Deferred to Subsequent Plans

- **41-02 (update_validation):** Implements the 4th core method — appends version=N+1 rows with Wilson CI recompute, `last_validated` timestamp, `converged` flag update. Also ships `extract_structure_from_episode` helper that reads `story-framework` + `final-audit` slots.
- **41-03 (query_by_structure):** Implements the 5th core method — cosine similarity over `[hook_position_sec, mean(turning_points_sec), emotion_drop_level]` + Jaccard over `emotion_sequence`; returns top-K matches with score.
- **41-04 (integration):** Wires RecipeLibrary into Phase 42 feedback_ingest.py (closes the convergence loop on feedback receipt).

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or trust-boundary crossings introduced beyond what `creative_history.py` (V5.0) already established. The threat register in PLAN.md (T-41-01 through T-41-06) is fully mitigated by the shipped tests.

## Self-Check: PASSED

Files verified present:
- FOUND: /data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py
- FOUND: /data/workspace/hermes-agent/plugins/pipeline_state/recipe_library.py
- FOUND: /data/workspace/hermes-agent/plugins/pipeline_state/__init__.py
- FOUND: /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_recipe_library.py
- FOUND: /data/workspace/hermes-agent/plugins/pipeline_state/tests/test_asset_bus_emotion_recipe_slot.py

Commits verified in git log:
- fbbb038b9 (test RED — slot regression)
- 300498292 (feat GREEN — slot registered + deviation fix)
- 4a81e7e2a (test RED — RecipeLibrary suite)
- 805d5074e (feat GREEN — RecipeLibrary skeleton)
- e2284f3a4 (feat — wire plugin exports)

Test count: 227 pipeline_state tests passing (46 new in Phase 41-01).
