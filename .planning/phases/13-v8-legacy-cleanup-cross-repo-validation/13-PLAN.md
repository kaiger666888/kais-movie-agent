# Phase 13: V8 Legacy Cleanup + Cross-Repo Validation — PLAN

## Plan 1: Documentation deliverables

### 1.1 `docs/V8-DEPRECATION.md`
Formal V8 deprecation document covering:
- Deprecation timeline (Phase 13 start = 2026-06-17)
- V8 baseline ref: 734dc71c9d5ff20d55dbd0255f367030962cf329
- What's deprecated:
  - OpenClaw single-LLM orchestration (per Phase 7 §3.1 D1.4)
  - Sketch-then-render强制两阶段 (per Phase 7 §3.3 D3.4 — replaced with composition_lock)
  - Toonflow review platform (replaced by quality_gate + compliance_gate)
  - Hard-coded model names in canonical node specs (moved to dated annex per NODE-08)
- Backward compatibility guarantee (KAI_PIPELINE_MODE=v8 still works)
- Migration path (KAI_PIPELINE_MODE=v2 default)
- Known V8 issues (hmac_node.js CommonJS/ESM mismatch)

### 1.2 `docs/v2-model-annex-2026-06-16.md`
Dated model instantiation annex per NODE-08 + PITFALLS §1.3. Lists:
- Per-node current instantiation (model name, role, verified date, stability)
- Swap alternatives
- Stability legend
- Note: canonical capability-spec layer (lib/v2_topology/) remains model-agnostic

### 1.3 `docs/CROSS-REPO-ADR-PROCESS.md`
Cross-repo ADR governance:
- Co-ownership matrix (kais-movie-agent impl + hermes-agent design-intent)
- When cross-repo ADR is required (structural DAG changes)
- ADR template + lifecycle (proposed → accepted → superseded)
- v2.0 PRFP DAG is frozen — no structural changes in this milestone

### 1.4 `PROJECT.md` frontmatter
Add:
```yaml
---
impl_targets_design: design-2026-06-16-prfp
v8_baseline_ref: 734dc71c9d5ff20d55dbd0255f367030962cf329
v8_deprecated_at: 2026-06-17
---
```

## Plan 2: Code deprecation banners

### 2.1 lib/phases/index.js header
Add deprecation banner comment (no functional changes):
```js
/**
 * @deprecated Phase 13 (2026-06-17) — V8 step dispatch deprecated.
 * Default is now KAI_PIPELINE_MODE=v2 (see lib/v2_pipeline.js).
 * This file is preserved for backward compatibility (KAI_PIPELINE_MODE=v8).
 * V8 baseline ref: 734dc71c9d5ff20d55dbd0255f367030962cf329
 * See docs/V8-DEPRECATION.md for migration guide.
 */
```

### 2.2 lib/pipeline.js header
Same deprecation banner.

### 2.3 lib/v2_pipeline.js — flip default mode
Change `resolvePipelineMode()` default from `'v8'` → `'v2'`.

## Plan 3: Lint check for hard-coded models

Create `test/v2-canonical-clean.mjs`:
- Scan lib/v2_topology/ + lib/v2_pipeline.js for hard-coded model names
- Assert ZERO matches
- Run as part of test suite

## Plan 4: Backward compatibility test

Extend smoke test:
- `KAI_PIPELINE_MODE=v8` (explicit) still resolves correctly
- `KAI_PIPELINE_MODE=v2` is now the default (no env var set)
- `KAI_PIPELINE_MODE=parallel` still works

## Verification

Per ROADMAP success criteria 1-8:
1. lib/phases/index.js V8 dispatch marked deprecated; default v2 ✅
2. OpenClaw single-LLM replaced with layered LLM calls per node ✅ (in v2_topology)
3. Sketch-then-render强制两阶段 replaced with composition_lock + instantiation annex ✅ (cinematographer sub-steps)
4. Toonflow review replaced with quality_gate + compliance_gate integration ✅ (Phase 12)
5. Hard-coded model names removed from canonical node specs; moved to dated annex ✅ (lint check)
6. impl_targets_design declared in PROJECT.md frontmatter ✅
7. V8 baseline still works via KAI_PIPELINE_MODE=v8 ✅ (test)
8. Cross-repo ADR process documented ✅
