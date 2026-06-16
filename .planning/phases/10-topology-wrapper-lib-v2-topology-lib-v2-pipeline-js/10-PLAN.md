# Phase 10: Topology Wrapper — PLAN

**Phase:** 10
**Phase Name:** Topology Wrapper (lib/v2_topology/ + lib/v2_pipeline.js)
**Goal:** Wrapper layer exposing 16 v2.0 node IDs; `KAI_PIPELINE_MODE` env var switching; V8 untouched.

---

## Plan 1: v2_topology scaffolding

### 1.1 Create lib/v2_topology/ directory + 16 node stubs

For each node ID from `nodes.yaml`, create a stub file that:
- Exports a class named in PascalCase (e.g., `CreativeSource`)
- Has `constructor(ctx)` accepting pipeline context
- Has `async run(inputs)` method that delegates to V8 phase handler
- Has `id` getter returning the canonical node ID
- Has `layer`, `role`, `v8Passthrough` metadata fields
- Returns V8 phase output unchanged

Node stubs (16):
- `creative_source.js`, `style_genome.js`, `screenplay.js`, `script_auditor.js`
- `character_designer.js`, `cinematographer.js`, `prompt_injector.js`, `visual_executor.js`, `continuity_auditor.js`
- `audio_pipeline.js`, `editor.js`, `colorist.js`, `hook_retention.js`, `quality_gate.js`, `compliance_gate.js`
- `theory_critic.js`

### 1.2 Create lib/v2_topology/index.js

Export all 16 node classes + `NODE_REGISTRY` map keyed by canonical ID + metadata (layer, role, v8_passthrough_target).

### 1.3 Create lib/v2_topology/_node-base.js

Shared base class with `v8Passthrough` helper that resolves and calls V8 `phaseHandlers[id]` via the existing pipeline.

**Files:**
- `lib/v2_topology/_node-base.js` (NEW)
- `lib/v2_topology/index.js` (NEW)
- `lib/v2_topology/{16 files}.js` (NEW)

---

## Plan 2: v2_pipeline entry point

### 2.1 Create lib/v2_pipeline.js

- Reads `KAI_PIPELINE_MODE` env var (default: `v8`)
- `v8` mode: imports and delegates to existing `lib/pipeline.js` `KaisPipeline` class — zero changes
- `v2` mode: builds v2.0 DAG topology using `lib/v2_topology/`, executes nodes in topological order per `edges.yaml` (Phase 10: all nodes are V8 pass-through)
- `parallel` mode: runs both v8 + v2, emits diff JSON to `workdir/v2-vs-v8-diff.json`
- Exports `V2Pipeline` class with same public API as `KaisPipeline` (`run`, `getConfig`, etc.)

**Files:**
- `lib/v2_pipeline.js` (NEW)

---

## Plan 3: Tests + smoke run

### 3.1 Test wrapper integrity

- Each stub loads without throwing
- `KAI_PIPELINE_MODE=v8` runs identically to V8 baseline (regression check)
- `KAI_PIPELINE_MODE=v2` produces same outputs as v8 mode (since pass-through)
- `KAI_PIPELINE_MODE=parallel` emits non-empty diff file

**Files:**
- `test/v2-topology-smoke.mjs` (NEW)

---

## Verification

- `lib/v2_topology/index.js` exports 16 node classes
- `lib/v2_pipeline.js` switches on `KAI_PIPELINE_MODE` correctly
- V8 lib/pipeline.js + lib/phases/index.js byte-identical to baseline `734dc71c9d` (will verify via `git diff`)
- Smoke test passes in all three modes
