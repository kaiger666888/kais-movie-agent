# Phase 13: V8 Legacy Cleanup + Cross-Repo Validation — Context

**Gathered:** 2026-06-17
**Mode:** Auto-generated

<domain>
## Phase Boundary

Deprecate V8 step dispatch (default `KAI_PIPELINE_MODE=v2`); document V8 specific design弃用 (OpenClaw / sketch-then-render / Toonflow / hard-coded models); implement HANDOFF-06 versioning scheme (`impl_targets_design: design-2026-06-16-prfp`); validate backward compatibility (V8 still works via `KAI_PIPELINE_MODE=v8`).

</domain>

<decisions>
## Implementation Decisions

### V8 baseline preservation covenant
Per Phase 10 success criterion 7, lib/pipeline.js + lib/phases/index.js are preserved byte-identical to baseline 734dc71c9d (Phase 10-12 did not modify them). Phase 13 does NOT remove V8 — only:
1. Switches default `KAI_PIPELINE_MODE` from `v8` → `v2`
2. Documents V8 as deprecated (not removed)
3. Adds V8 deprecation banner to lib/phases/index.js header comment
4. Moves hard-coded model names from "canonical" position to dated annex doc (the V8 lib keeps its names — those are V8 instantiation, not v2.0 canonical)

### Hard-coded model name handling (success criterion 5)
Phase 13 verifies that the v2.0 canonical node specs (lib/v2_topology/) have ZERO hard-coded model names. They are model-agnostic per capability-spec layer principle. Model names appear ONLY in dated annex doc `docs/v2-model-annex-2026-06-16.md` (per NODE-08 + PITFALLS §1.3).

V8 lib/phases/index.js keeps its names (flux-dev, wan14b, CosyVoice2) — those are V8 instantiation, not v2.0 canonical. V8 is deprecated, so its names are not canonical concerns.

### Cross-repo ADR process (success criterion 8)
Create `docs/CROSS-REPO-ADR-PROCESS.md` documenting:
- kais-movie-agent (impl layer) + hermes-agent (design-intent layer) co-ownership
- Structural DAG changes require cross-repo ADR sign-off
- v2.0 PRFP DAG is frozen; no structural changes in v2.0 scope
- ADR template + lifecycle

### Backward compatibility validation (success criterion 7)
Run smoke test with `KAI_PIPELINE_MODE=v8` to confirm V8 baseline still executes via fallback path. (V8 baseline has pre-existing hmac_node.js CommonJS/ESM bug — document this separately as known issue; not a Phase 13 regression.)

</decisions>

<code_context>
## Existing Code Insights

### v2.0 canonical cleanliness
- lib/v2_topology/*.js: 0 hard-coded model names (verified via grep)
- lib/v2_pipeline.js: 0 hard-coded model names
- All v2.0 specs reference `design-2026-06-16-prfp` schema version, not specific models

### V8 baseline state
- lib/pipeline.js + lib/phases/index.js: untouched through Phase 10-12
- V8 instantiation (flux-dev, wan14b, CosyVoice2, etc.) preserved
- Pre-existing V8 bug: lib/gold-team-client.js imports broken shared/hmac_node.js (CommonJS/ESM mismatch) — documented in DEPRECATED.md or new V8-DEPRECATION.md

### KAI_PIPELINE_MODE switching
- Phase 10 default: 'v8'
- Phase 13 change: default flips to 'v2'
- 'v8' still accepted for backward compatibility

</code_context>

<specifics>
## Specific Ideas

### Files to create
1. `docs/V8-DEPRECATION.md` — formal V8 deprecation document
2. `docs/v2-model-annex-2026-06-16.md` — dated model instantiation annex (per NODE-08)
3. `docs/CROSS-REPO-ADR-PROCESS.md` — cross-repo ADR governance
4. Update `PROJECT.md` frontmatter with `impl_targets_design: design-2026-06-16-prfp`

### Files to modify (deprecation banners only — no functional changes)
- `lib/phases/index.js` — add deprecation banner at top
- `lib/pipeline.js` — add deprecation banner at top
- `lib/v2_pipeline.js` — change default mode from 'v8' to 'v2'

### Test additions
- Verify `KAI_PIPELINE_MODE=v8` is honored when explicitly set
- Verify v2.0 topology files have 0 hard-coded models (lint check)
- Backward compat smoke test

</specifics>

<deferred>
## Deferred Ideas

- LLM-creative wiring (consistency_context + novelty_constraint) — Phase 14
- Actual V8 code removal (delete lib/phases/index.js) — future milestone after extended deprecation period
- V8 hmac_node.js bug fix — separate V8 maintenance issue (not v2.0 scope)

</deferred>
