# Phase 41: Emotion Recipe Library - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Build `plugins/pipeline_state/recipe_library.py` — a structured emotion-recipe library that converts V5.0's scattered `creative-history` 5-dimensional script_auditor scores into reusable, queryable配方 (recipes). Each recipe captures the structure parameters that produced a given creative outcome + its validation status (completion rate, sample size, convergence flag). Provides 5 core methods (create / get / list / update_validation / query_by_structure) and 3 query modes (by genre / by structure similarity / by validation status). Persisted to new `emotion-recipe` AssetBus slot (JSONL append-only). Foundation for Phase 42 (feedback_ingest triggers `update_validation` to close the convergence loop).

</domain>

<decisions>
## Implementation Decisions

### Recipe Library Architecture
- Module location: **`plugins/pipeline_state/recipe_library.py`** — sibling to `creative_history.py`; pure stdlib, sync API (D-07); pure library code (NO HTTP, NO subprocess — those concerns stay in `kais_aigc/`)
- Constructor signature: **`RecipeLibrary(*, asset_bus: AssetBus)`** — mirrors CreativeHistoryTracker; writes via `asset_bus.append_line("emotion-recipe", recipe_dict)`; reads via `asset_bus.read_lines("emotion-recipe")`
- 5 core methods:
  - `create_recipe(genre, structure, source_episode) -> recipe_id` — derives recipe_id via slugify+sequence, writes version=1 row
  - `get_recipe(recipe_id, version=None) -> dict` — returns latest by default, specific version if `version=N` provided
  - `list_recipes(*, genre=None, converged=None) -> list[dict]` — filtered list (genre filter / converged filter / both / neither)
  - `update_validation(recipe_id, platform, completion_rate, sample_size_delta=1) -> dict` — appends new version row with bumped version int + recomputed Wilson CI + converged flag
  - `query_by_structure(structure_query, top_k=5, min_score=0.7) -> list[tuple[dict, float]]` — returns top-K similar recipes with score
- Structure similarity algorithm: **Cosine similarity over numerical fields** (hook_position_sec, turning_points_sec timestamps + emotion_drop_level as 3-dim vector) **+ Jaccard over emotion_sequence list** (treat as set, |A∩B|/|A∪B|); final score = `0.7 * cosine + 0.3 * jaccard` (weight numerical over categorical). Return matches with score ≥ `min_score` (default 0.7).
  - **Algorithm refinement (WARNING #4, plan-checker revision pass 2):** `turning_points_sec` is a `list[int]` in the structure schema, but cosine similarity requires fixed-length vectors. The list is COMPRESSED to a scalar mean (`mean(turning_points_sec)`) before being placed in the 3-dim cosine vector `[hook_position_sec, mean(turning_points_sec), emotion_drop_level]`. This is a deliberate compression choice — the mean preserves the "average beat density" signal while keeping the vector 3-dimensional (avoiding variable-length padding). Default `min_score=0.7` filters to well-matched recipes only; operators can lower it for broader recall. The Jaccard component (over `emotion_sequence`) is unaffected by this compression since Jaccard operates on sets natively.
- Version handling: **Append-only with version int per recipe_id** — `update_validation` ALWAYS appends a new row with `version = latest + 1`; old versions preserved for audit (never mutated); `get_recipe` defaults to latest version; query/list operations return only latest per recipe_id by default

### Creative History Extraction & Convergence Logic

**DATA SOURCE PIVOT (locked 2026-06-27 after plan-checker BLOCKER #1):**

V5.0 `creative-history` slot contains hash-stamping lineage records (`{asset_slot, asset_id, source_hashes, content_hash, timestamp}`) — NOT creative content. The 5-dim scores and structural data assumed by the blueprint live in DIFFERENT slots:

- **`story-framework` slot** (p02_outline output) — has the structural data:
  - `mcmahon_arc`: story archetype string (e.g., "man_in_a_hole")
  - `snowflake_artifacts.anchor_validation`: timestamp string like "Catalyst ~7.5s ✓ / Midpoint ~37s ✓ / All Is Lost ~55s ✓"
  - `snyder_beats_summary`: list of beat descriptions with timestamps
- **`final-audit` slot** (p06 output) — has 5-dim scalar scores `D1_narrative, D2_emotion, D3_hook, D4_character, D5_completion` (0-20 scale)

**Updated structure{} extraction (from `story-framework` + `final-audit`):**

  | emotion-recipe structure{} field | Source | Mapping logic |
  |----------------------------------|--------|---------------|
  | `hook_position_sec` (int seconds) | `story-framework.snowflake_artifacts.anchor_validation` | Parse "Catalyst ~Ns" → int(N); fallback to first snyder_beats timestamp |
  | `emotion_sequence` (list[str]) | `story-framework.mcmahon_arc` | Lookup table per arc type: `man_in_a_hole → ["hope","descent","crisis","recovery"]`, `rags_to_riches → ["low","rise","peak","fall"]`, etc. (5-6 common arcs) |
  | `turning_points_sec` (list[int]) | `story-framework.snowflake_artifacts.anchor_validation` | Parse all "X ~Ns" timestamps → list of ints |
  | `emotion_drop_level` (int 1-5) | `final-audit.scores.D2_emotion` (0-20) | `int((20 - D2) / 4) + 1` clamped [1,5] (lower D2 score = bigger drop) |
  | `ending_state` (str) | `final-audit.scores.D5_completion` | `D5 >= 16 → "resolved"`, `D5 >= 12 → "new_suspense"`, else `"cliffhanger"` |

**`extract_structure_from_episode(episode_id)` is a HELPER, not critical path:**
- Reads `story-framework` + `final-audit` slots, applies above mapping, returns structure dict
- Operators can call this for convenience OR pass explicit structure{} to `create_recipe()` for override
- If either slot is missing or malformed, helper returns None and logs WARNING (does not raise)
- Episode-level aggregation: each episode produces ONE recipe (no per-shot fan-out)

- **Wilson confidence interval**: pure stdlib `math` module, formula:
  ```python
  def wilson_ci(passed: int, total: int, z: float = 1.96) -> tuple[float, float]:
      # Returns (lower, upper) bounds at 95% CI (z=1.96)
      if total == 0: return (0.0, 1.0)
      p = passed / total
      denom = 1 + z*z / total
      center = (p + z*z / (2 * total)) / denom
      spread = z * math.sqrt((p * (1 - p) + z*z / (4 * total)) / total) / denom
      return (center - spread, center + spread)
  ```
- **Converged flag**: `converged = True` when `sample_size >= 10 AND (upper - lower) <= 0.10` (±5% means total spread ≤ 10%)
- **`update_validation` flow** (called by Phase 42 feedback_ingest.py):
  1. Read latest version of recipe
  2. Compute new validation{} fields: `completion_rate = (passed_cumulative + new_completion) / (sample_size + 1)`, `sample_size += 1`, recompute CI
  3. Append new row with `version = latest + 1`, `last_validated = now_iso8601`
  4. Return new row dict
- **recipe_id naming**: `<genre-slug>-<NNN>` zero-padded 3 digits (e.g., `urban-fantasy-001`)
  - `slugify(genre)`: lowercase, replace whitespace with hyphens, strip non-alphanumeric (keep hyphens), collapse consecutive hyphens
  - Sequence: `max(existing_ids_with_same_slug) + 1`; if none exist, start at 001

### Claude's Discretion
None — both areas fully resolved via smart discuss.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`/data/workspace/hermes-agent/plugins/pipeline_state/creative_history.py`** — direct sibling template. Shows AssetBus-injected constructor pattern, sync API, pure-stdlib hash computation, append-only history semantics. Phase 41's `recipe_library.py` will mirror this module's structure line-for-line (constants → helpers → class).
- **`/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py`** — already has `append_line()` / `read_lines()` methods for JSONL slots. Phase 41 needs to register ONE new slot `emotion-recipe` in ASSET_SCHEMA (JSONL format, writer_phase=`recipe_library` — Phase 41 owns the slot, NOT p10b). Phase 40 already proved this pattern works (`rapid-preview-clips` slot).
- **`/data/workspace/hermes-agent/plugins/pipeline_state/__init__.py`** — plugin exports. Add `RecipeLibrary` to `__all__` after implementation.
- **V5.0 `story-framework` slot** (p02_outline output, already in ASSET_SCHEMA) — Phase 41 READS this for structural data: `mcmahon_arc`, `snowflake_artifacts.anchor_validation` timestamps, `snyder_beats_summary`. Format per existing artifact: `{value: {story_kernel: {...}, snowflake_artifacts: {...}, snyder_beats_summary: [...]}, ...}`
- **V5.0 `final-audit` slot** (p06 output, already in ASSET_SCHEMA) — Phase 41 READS this for 5-dim scalar quality scores `D1_narrative, D2_emotion, D3_hook, D4_character, D5_completion` (0-20 scale each). Format per existing artifact: `{value: {scores: {D1_narrative: 17, ...}, total_score: 80, ...}}`
- **V5.0 `creative-history` slot** — Phase 41 does NOT read this. Original blueprint assumption that creative-history contained script_auditor scores was incorrect (plan-checker BLOCKER #1, verified 2026-06-27). creative-history remains hash-stamping lineage only.

### Established Patterns
- **AssetBus JSONL slot schema**: `{file: "X.jsonl", format: "jsonl", description: "...", writer_phase: "...", reader_phases: [...]}`. The `rapid-preview-clips` slot from Phase 40 is the canonical recent example.
- **Atomic write semantics**: JSONL uses `open(..., "a")` (O_APPEND POSIX atomicity for lines ≤ PIPE_BUF); JSON uses tempfile + os.replace.
- **Content hash for version tracking**: `_compute_hash(value)` from creative_history.py:45 — SHA-256 of canonical JSON with `sort_keys=True`. Phase 41 can reuse this for `recipe.content_hash` field if needed (not in blueprint schema, but useful for dedup).
- **D-07 sync API**: all `pipeline_state` modules use sync API (no async def). Phase 41 follows.
- **Pure stdlib**: no third-party deps for `pipeline_state` modules (httpx lives in `kais_aigc/`). Phase 41 uses only `math`, `json`, `hashlib`, `logging`, `datetime`, `pathlib`, `typing`.

### Integration Points
- **AssetBus write**: `recipe_library.RecipeLibrary.create_recipe()` calls `asset_bus.append_line("emotion-recipe", recipe_dict)`. Format follows blueprint schema strictly.
- **AssetBus read (extraction)**: `RecipeLibrary.extract_structure_from_episode(episode_id)` reads `story-framework` slot (for structure) + `final-audit` slot (for D1-D5 quality scores). Returns structure dict per mapping table in decisions section. Helper is best-effort — if either slot missing/malformed, returns None + WARNING log.
- **Phase 42 consumption**: `feedback_ingest.FeedbackIngestClient` will call `recipe_library.update_validation(recipe_id, platform, completion_rate)` after each feedback submission. This is the convergence-loop closure.
- **V5.0 502-test safety**: ASSET_SCHEMA append-only; no existing slot modified. New `emotion-recipe` slot is purely additive.

</code_context>

<specifics>
## Specific Ideas

- `recipe_library.py` is **pure library code** (no entry point, no CLI). Operators interact via:
  - Phase 42's `feedback_ingest.py` HTTP endpoint (automatic on feedback receipt)
  - Direct Python REPL (manual curation — `from plugins.pipeline_state.recipe_library import RecipeLibrary`)
- The 5-dim → structure mapping is intentionally mechanical and documented. No ML inference in v6.0 — that's operator-side calibration territory (deferred per blueprint Out of Scope).
- Wilson CI is implemented in pure stdlib (`math.sqrt`) — no scipy/numpy. The formula is small enough to fit in a 10-line helper. This keeps the dependency surface minimal (matches V5.0 "零第三方 dep for state modules" convention).
- `query_by_structure` is the **primary consumer-facing API** — operators use this to find "what recipes worked for similar structure?" The default `top_k=5` + `min_score=0.7` returns 0-5 results; tuning these is operator-side.
- The `recipe_id` naming (`<genre-slug>-<NNN>`) is human-readable — operators can glance at `urban-fantasy-001` and immediately know it's the first recipe for urban-fantasy genre. UUID would lose this affordance.

</specifics>

<deferred>
## Deferred Ideas

- **ML-driven structure inference** — when creative-history accumulates ≥100 episodes, train a regressor to predict optimal structure{} for given creative goals. v7.0+ candidate.
- **Recipe auto-application to p10b** — when p10b runs, query recipe_library for top converged recipe matching episode genre and pre-populate `structure_delta` baseline. v7.0+ candidate (operator-triggered, per REQUIREMENTS.md backlog section A).
- **Cross-episode convergence dashboards** — web UI showing which recipes converged + their validation history. Out of v6.0 scope (no web UI per REQUIREMENTS Out of Scope).
- **Multi-platform validation tracking** — current schema supports `validation{platform: "douyin|bilibili|youtube"}` as a single platform per recipe_id-version. If the same structure{} is published to multiple platforms, separate recipe_id per platform OR extend schema to `validations: {platform: metrics}` dict. Defer to v6.1 based on operator usage patterns.

</deferred>
