# Phase 13: V8 Legacy Cleanup + Cross-Repo Validation — SUMMARY

**Phase:** 13
**Status:** ✅ Complete
**Date:** 2026-06-17

## What Was Done

### 1. Default mode flipped v8 → v2
`lib/v2_pipeline.js` `resolvePipelineMode()` default changed from `'v8'` to `'v2'`. V8 still available via explicit `KAI_PIPELINE_MODE=v8`.

### 2. V8 deprecation banners (no functional changes)
- `lib/pipeline.js` header: `@deprecated Phase 13 (2026-06-17)` banner pointing to docs/V8-DEPRECATION.md
- `lib/phases/index.js` header: same banner
- Banner preserves V8 baseline ref `734dc71c9d5ff20d55dbd0255f367030962cf329`

### 3. Three documentation deliverables

#### docs/V8-DEPRECATION.md
Formal deprecation document covering:
- OpenClaw single-LLM orchestration (Phase 7 §3.1 D1.4)
- Sketch-then-render强制两阶段 (Phase 7 §3.3 D3.4 — replaced by composition_lock)
- Toonflow review platform (replaced by quality_gate + compliance_gate)
- Hard-coded model names (moved to dated annex)
- 20-step linear pipeline → 16-node hybrid topology
- Backward compatibility guarantee
- Known V8 issues (hmac_node.js CommonJS/ESM mismatch)
- Migration path

#### docs/v2-model-annex-2026-06-16.md
Dated model instantiation annex per NODE-08 + PITFALLS §1.3:
- Per-node current instantiation table (model, role, verified_date, stability, swap alternatives)
- Stability legend (stable_2026 / evolving / research_bet)
- Note: canonical capability-spec layer (lib/v2_topology/) is model-agnostic
- Migration path for model swaps

#### docs/CROSS-REPO-ADR-PROCESS.md
Cross-repo ADR governance:
- Co-ownership matrix (kais-movie-agent impl + hermes-agent design-intent)
- When cross-repo ADR is required (structural DAG changes)
- When unilateral changes are OK (instantiation, refactors, bug fixes)
- ADR template + lifecycle
- v2.0 frozen DAG (no structural changes during v2.0)

### 4. PROJECT.md frontmatter
Added:
```yaml
---
impl_targets_design: design-2026-06-16-prfp
v8_baseline_ref: 734dc71c9d5ff20d55dbd0255f367030962cf329
v8_deprecated_at: 2026-06-17
hermes_agent_baseline_ref: 85965c393f44deae29a833f2ae98af66d26548ce
---
```

### 5. Canonical-clean lint check
`test/v2-canonical-clean.mjs` — 10 checks:
- Scans lib/v2_topology/ + lib/v2_pipeline.js for 20+ hard-coded model names
- Uses word-boundary regex (avoids false-positive on "audio" → "udio")
- Strips comments before scanning
- Asserts ZERO matches in canonical capability-spec layer
- Verifies PROJECT.md frontmatter present
- Verifies 3 new docs exist
- Verifies V8 deprecation banners present

All 10 checks pass.

### 6. Backward compatibility validation
- `KAI_PIPELINE_MODE=v8` explicitly still resolves to `'v8'` (verified via existing resolvePipelineMode tests)
- V8 lib/pipeline.js + lib/phases/index.js unchanged functionally (only banner comments added)
- V8 fallback path preserved through Phase 13

### 7. Updated prior phase smoke tests
- Phase 10 smoke test: updated assertions to reflect Phase 11-12 migration (all nodes now native, no V8 pass-through)
- Phase 11 smoke test: updated to confirm all 16 nodes native (not just Layer 0-3)

## Success Criteria Status

1. ✅ `lib/phases/index.js` V8 dispatch marked deprecated; default `KAI_PIPELINE_MODE=v2`
2. ✅ OpenClaw single-LLM orchestration replaced with layered LLM calls per node (in lib/v2_topology/)
3. ✅ Sketch-then-render强制两阶段 replaced with `composition_lock` (cinematographer sub-steps) + instantiation annex
4. ✅ Toonflow review platform replaced with `quality_gate` + `compliance_gate` integration
5. ✅ Hard-coded model names removed from canonical node specs; moved to dated annex (verified by lint)
6. ✅ `impl_targets_design: design-2026-06-16-prfp` declared in PROJECT.md frontmatter
7. ✅ V8 baseline `734dc71c9d` still works via `KAI_PIPELINE_MODE=v8` (backward compat validated)
8. ✅ Cross-repo ADR process documented (docs/CROSS-REPO-ADR-PROCESS.md)

## Files Changed

**Added (4):**
- `docs/V8-DEPRECATION.md`
- `docs/v2-model-annex-2026-06-16.md`
- `docs/CROSS-REPO-ADR-PROCESS.md`
- `test/v2-canonical-clean.mjs`

**Modified (5):**
- `lib/v2_pipeline.js` — default mode v8 → v2
- `lib/pipeline.js` — deprecation banner only (no functional change)
- `lib/phases/index.js` — deprecation banner only (no functional change)
- `.planning/PROJECT.md` — frontmatter added
- `test/v2-topology-smoke.mjs` + `test/v2-phase11-smoke.mjs` — updated assertions

## Hand-off to Phase 14

Phase 14 will:
- Extend lib/state/ with consistency_context schema (5 sections per Phase 10 §2.1)
- Add 6th dim to script_auditor (consistency_context_violations)
- creative_source outputs novelty_constraint
- screenplay consumes novelty_constraint
- 6 narrative arc templates available
- commercial_mode escape hatch flag
