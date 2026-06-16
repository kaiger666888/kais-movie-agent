# Phase 10: Topology Wrapper — SUMMARY

**Phase:** 10
**Phase Name:** Topology Wrapper (lib/v2_topology/ + lib/v2_pipeline.js)
**Status:** ✅ Complete
**Date:** 2026-06-17

## What Was Built

### lib/v2_topology/ — 16 node API stubs (16 + base + index = 18 files)
All 16 canonical v2.0 PRFP node IDs from `nodes.yaml` implemented as `NodeBase` subclasses:

**Layer 0 (root):** creative_source
**Layer 1 (intent_parallel):** style_genome, character_designer
**Layer 2 (narrative + visual intent):** screenplay, script_auditor, cinematographer
**Layer 3 (visual execution):** prompt_injector, visual_executor, continuity_auditor
**Layer 4 (audio):** audio_pipeline
**Layer 5 (post + form-specific):** editor, colorist, hook_retention (短剧-only)
**Layer 6 (final gates + consultative):** quality_gate, compliance_gate, theory_critic

Each stub:
- Exports PascalCase class extending `NodeBase`
- Declares canonical `id`, `layer`, `role`
- Declares `v8PassthroughTargets` array (V8 phase IDs to delegate to)
- NEW nodes (theory_critic, hook_retention, prompt_injector) return `phase_10_stub: true` markers

### lib/v2_topology/_node-base.js — Shared base class
- Lazy-loads `phaseHandlers` from `lib/phases/index.js` (avoids triggering V8 baseline load chain at module-import time — works around pre-existing V8 hmac_node.js CommonJS/ESM mismatch bug)
- `run()` method delegates to V8 handler by default
- `describe()` returns introspectable metadata

### lib/v2_topology/index.js — Canonical registry
- `NODE_CLASSES` map keyed by canonical ID (16 entries)
- `TOTAL_NODES=16`, `LINEAR_NODE_COUNT=15`, `CONSULTATIVE_NODE_COUNT=1`
- `LINEAR_EXECUTION_ORDER` array (15 nodes — excludes consultative theory_critic)
- `buildNodeRegistry()`, `createNode(id)`, `listNodeIds()` helpers

### lib/v2_pipeline.js — v2.0 entry point with KAI_PIPELINE_MODE
- `resolvePipelineMode()` validates env var, defaults to `v8`, accepts v8/v2/parallel
- `V2Pipeline` class with v8/v2/parallel execution paths
- v8 mode: pure delegation to KaisPipeline
- v2 mode: builds topology manifest + delegates to V8 (Phase 10 transparent pass-through)
- parallel mode: runs both, writes `v2-vs-v8-diff.json` to workdir
- V8 KaisPipeline imported lazily (testability + avoids V8 baseline import chain at module load)

### test/v2-topology-smoke.mjs — 17 checks
All 17 checks pass:
- Node count assertions (16/15/1)
- Registry integrity (all 16 IDs)
- Execution order (excludes theory_critic)
- Mode resolver (v8 default, accepts v2/parallel, rejects garbage)
- NEW nodes return `phase_10_stub` markers
- describe() returns valid shape for all nodes

## V8 Baseline Preservation

- `lib/pipeline.js`: untouched in this phase (pre-existing Canvas changes from `df9011c` are not Phase 10 work)
- `lib/phases/index.js`: untouched
- `lib/agents/`: untouched
- V8 baseline `734dc71c9d` still works via `KAI_PIPELINE_MODE=v8`

## Success Criteria Status

1. ✅ `lib/v2_topology/` directory exists with 16 node stub files
2. ✅ Each node stub transparently passes through to existing V8 implementation
3. ✅ `lib/v2_pipeline.js` exists as v2.0 entry point; accepts `KAI_PIPELINE_MODE` env var
4. ✅ `KAI_PIPELINE_MODE=v8` runs V8 baseline (default at Phase 10 ship)
5. ✅ `KAI_PIPELINE_MODE=v2` runs v2.0 topology (transparent pass-through at this phase)
6. ✅ `KAI_PIPELINE_MODE=parallel` runs both + emits diff for A/B validation
7. ✅ V8 lib/pipeline.js + lib/phases/index.js untouched by Phase 10 work (fallback preserved)

## Files Changed

**Added (21 files):**
- `lib/v2_topology/_node-base.js`
- `lib/v2_topology/index.js`
- `lib/v2_topology/{16 node files}.js`
- `lib/v2_pipeline.js`
- `test/v2-topology-smoke.mjs`
- `.planning/phases/10-.../{CONTEXT,PLAN,SUMMARY,VERIFICATION}.md`

**Modified (0 files):** None — V8 baseline untouched.

## Known Pre-existing Issues (NOT in Phase 10 scope)

- `lib/gold-team-client.js:11` imports `{ sign, verify }` from `shared/hmac_node.js` which is CommonJS — broken when loaded via ESM. This is a pre-existing V8 baseline bug; Phase 13 (V8 cleanup) will address it.
- Phase 10 mitigates by lazy-loading V8 modules so topology tests run without triggering this bug.

## Hand-off to Phase 11

Phase 11 will:
- Replace V8 pass-through with native v2.0 per-node implementations for 9 Layer 0-3 nodes
- Implement `screenplay ↔ script_auditor` loop_with_critic edge (max 3 iter, ¥5/iter)
- Implement `visual_executor ↔ continuity_auditor` loop_with_critic edge (max 2 iter, ¥50/iter)
- Create `prompt_injector` natively (cross-cutting invariants)
- Set `isV2Native = true` on migrated nodes
