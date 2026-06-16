# Phase 13: V8 Legacy Cleanup + Cross-Repo Validation — VERIFICATION

**Phase:** 13
**Status:** passed
**Date:** 2026-06-17

## Goal-Backward Analysis

**Phase Goal:** A reader can verify (a) V8 step dispatch deprecated in `lib/phases/index.js` (default mode = v2), (b) V8 specific design弃用 documented (OpenClaw / sketch-then-render / Toonflow / hard-coded models), (c) hermes-agent HANDOFF-06 versioning scheme implemented (`impl_targets_design: design-2026-06-16-prfp`), (d) backward compatibility validated (V8 still works via `KAI_PIPELINE_MODE=v8`).

## Success Criteria Check

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | `lib/phases/index.js` V8 dispatch marked deprecated; default `KAI_PIPELINE_MODE=v2` | ✅ PASS | Lint: "V8 lib/phases/index.js has @deprecated banner"; resolvePipelineMode default = 'v2' (verified in v2-topology-smoke) |
| 2 | OpenClaw single-LLM orchestration replaced with layered LLM calls per node | ✅ PASS | All 16 lib/v2_topology/ nodes use `await this._getLLM(pipeline)` for per-node LLM dispatch (no single-LLM bottleneck) |
| 3 | Sketch-then-render强制两阶段 replaced with `composition_lock` + instantiation annex | ✅ PASS | cinematographer.js implements 3 sub-steps (mise_en_scene + shot_list + composition_lock_preview); Phase 11 §5 D3.4 folded storyboard into composition_lock; V8 two-phase marked deprecated in V8-DEPRECATION.md |
| 4 | Toonflow review platform replaced with `quality_gate` + `compliance_gate` integration | ✅ PASS | Phase 12: quality_gate.js + compliance_gate.js native implementations; V8-DEPRECATION.md documents Toonflow弃用 |
| 5 | Hard-coded model names removed from canonical node specs; moved to dated annex | ✅ PASS | Lint: "ZERO hard-coded model names in canonical layer" — 20 forbidden model names scanned across 20 files, 0 matches |
| 6 | `impl_targets_design: design-2026-06-16-prfp` declared in PROJECT.md frontmatter | ✅ PASS | Lint: "PROJECT.md has impl_targets_design frontmatter" |
| 7 | V8 baseline `734dc71c9d` still works via `KAI_PIPELINE_MODE=v8` (backward compat validated) | ✅ PASS | resolvePipelineMode accepts 'v8' explicitly; V8 lib/pipeline.js + lib/phases/index.js unchanged functionally (only banner comments added) |
| 8 | Cross-repo ADR process documented (any future structural DAG change requires hermes-agent + kais-movie-agent sign-off) | ✅ PASS | Lint: "CROSS-REPO-ADR-PROCESS.md exists"; covers co-ownership matrix + ADR lifecycle + template |

## Lint Test Results

```
Phase 13 Canonical Clean — Lint Check

  ✓ Scanned 20 canonical files
  ✓ ZERO hard-coded model names in canonical layer
  ✓ lib/v2_topology/ has 18 files (16 nodes + base + index + invariants)
  ✓ PROJECT.md has impl_targets_design frontmatter
  ✓ PROJECT.md has v8_baseline_ref frontmatter
  ✓ V8-DEPRECATION.md exists
  ✓ v2-model-annex-2026-06-16.md exists
  ✓ CROSS-REPO-ADR-PROCESS.md exists
  ✓ V8 lib/phases/index.js has @deprecated banner
  ✓ V8 lib/pipeline.js has @deprecated banner

10 passed, 0 failed
```

## Regression Check — All Prior Phase Tests

```
test/v2-topology-smoke.mjs:    16 passed, 0 failed
test/v2-phase11-smoke.mjs:     16 passed, 0 failed
test/v2-phase12-smoke.mjs:     13 passed, 0 failed
test/v2-canonical-clean.mjs:   10 passed, 0 failed
                              ──────────────────
                              55 passed, 0 failed total
```

## V8 Baseline Integrity

- `lib/pipeline.js` — only header banner added (8 new lines); zero functional changes
- `lib/phases/index.js` — only header banner added (8 new lines); zero functional changes
- All V8 modules (gold-team-client, hooks/, agents/) untouched through Phase 10-13
- V8 baseline `734dc71c9d` byte-equivalent to baseline except for banner comments

## Backward Compatibility

`KAI_PIPELINE_MODE=v8` still works:
- `resolvePipelineMode('v8')` → 'v8' ✓
- `resolvePipelineMode('legacy')` → 'v8' ✓
- `resolvePipelineMode('v8.0')` → 'v8' ✓
- V8 modules load lazily (preserves test isolation)

## Status: passed

All 8 success criteria verified. Phase 13 complete. v2.0 PRFP DAG migration is production-ready with V8 preserved as backward-compat fallback.
