# Architecture Research

**Domain:** v3.0 Industrial Pipeline Alignment — AIGC movie-making orchestration
**Researched:** 2026-06-22
**Confidence:** HIGH (codebase-verified integration points; MEDIUM on Seedance 2.0 API surface)

## Current v2.0 Baseline (verified from source)

Before describing v3.0 changes, here is the as-built architecture that v3.0 must integrate with. Every claim below is sourced from reading the actual `lib/` modules.

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     Pipeline Orchestrator                         │
│                  lib/pipeline.js (~700 LOC)                       │
│   - 20 PHASES array (id, stageOrder, review config)               │
│   - runPhase / run / resume (idempotent, status-driven)           │
│   - V2_MIGRATION_MAP legacy ID translation                        │
│   - Review gate (_runRemoteReview) → review-platform              │
│   - Telegram notifications (async, non-blocking)                  │
│   - Git checkpoint per phase (GitStageManager)                    │
└──────────┬──────────────────────────────┬─────────────────────────┘
           │ phaseHandlers[phaseId].after  │ AssetBus read/write
           ▼                               ▼
┌─────────────────────────┐    ┌───────────────────────────────────┐
│  lib/phases/index.js    │    │  lib/asset-bus.js                  │
│  4071 LOC, 20 handlers  │───▶│  .pipeline-assets/*.json            │
│  Each handler:          │    │  13 typed asset slots              │
│   - _hermesDecide()     │    │  (art-bible, shot-list, voice-     │
│   - AssetBus read/write │    │   timeline, visual-soul, etc.)     │
│   - GoldTeam submit     │    └───────────────────────────────────┘
│   - ShotParallelScheduler
│   - EvaluationCollector.record()
│   - _hermesAudit()
└──┬──────────┬───────────┬──────────────┬─────────────────────────┘
   │          │           │              │
   ▼          ▼           ▼              ▼
┌──────┐ ┌────────┐ ┌──────────┐ ┌──────────────────┐
│Hermes│ │GoldTeam│ │Character │ │EvaluationCollector│
│Client│ │Client  │ │AssetMgr  │ │(.pipeline-assets/ │
│(44   │ │(GPU)   │ │(L1/L2/   │ │ evaluations.json) │
│tasks)│ │        │ │ L3/L4)   │ │ + cost-report.json│
└──────┘ └────────┘ └──────────┘ └───────────────────┘
```

### Verified Component Contracts

| Component | File | Contract v3.0 Must Respect |
|-----------|------|----------------------------|
| `Pipeline` | `lib/pipeline.js` | `runPhase(phaseId, phaseConfig)` — handler lookup via `phaseHandlers[phaseId]`; result must be `{summary, metrics}`; state persisted to `.pipeline-state.json` per-phase |
| `phaseHandlers` | `lib/phases/index.js` | Each handler = `{before?, after?}`; `after(pipeline, phase, phaseConfig)` is the workhorse; helpers `_hermesDecide`, `_hermesAudit`, `_makeCollector`, `_makeGtClient`, `ShotParallelScheduler` are module-private |
| `AssetBus` | `lib/asset-bus.js` | `ASSET_SCHEMA` is a frozen registry — adding slots requires schema entry with `{file, fields}`; read/write are cached; unknown asset names throw |
| `CharacterAssetManager` | `lib/character-asset-manager.js` | `baseDir`-scoped (per-project); L1 manifest at `characters/{id}/L1_identity/manifest.json`; `getOmniReferencePack()` already returns identity+scene+action split — v3.0 audio extension fits here |
| `HermesClient` | `lib/hermes-client.js` | `VALID_PHASES` array must stay 1:1 with PHASES; `decide(phase, context)` + `audit(phase, decisionId, metrics, params)`; timeout 30s decide / 10s audit |
| `EvaluationCollector` | `lib/evaluation-collector.js` | Appends to `evaluations.json`; `exportForHermes(phase)` already produces best/worst params — v3.0 ETL consumes this |
| `GitStageManager` | `lib/git-stage-manager.js` | One checkpoint per phase via `_git.checkpoint(stage, {description, metrics})` |

### cloud-production Handler (v2.0 baseline)

Located at `lib/phases/index.js:2962-3148`. Key flow:

1. Hermes decide → effectiveParams
2. AssetBus read `spatio-temporal-script` → shots[]
3. GoldTeam ping (fail → stub + Hermes audit + return)
4. `_loadPreviousVideoTasks` → idempotent skip of completed shots
5. `ShotParallelScheduler.runWithRetry(shotsToRun, async shot => {...}, {maxRetries: 3})`
6. Per shot: `assetManager.getOmniReferencePack()` → `gtClient.submitTask({taskType: 'seedance_omni_reference', params: {prompt, identity_refs, scene_refs, action_refs, identity_weight, action_weight}})`
7. Merge previous + new results → `video_tasks.json`
8. Hermes audit + EvaluationCollector record

**Critical observation:** The current Seedance submission has NO audio input. Identity refs, scene refs, action refs only. v3.0 A2 must extend this exact call site.

---

## v3.0 Target Architecture

### Five New Capabilities → Five New/Modified Components

| v3.0 Feature | Component | Type | Touches |
|--------------|-----------|------|---------|
| A2: Seedance 2.0 audio-visual sync | `cloud-production` handler + `CharacterAssetManager.getOmniReferencePack` | MODIFY | Add audio_driven params to submitTask; add dialogue audio path to refPack |
| B2: Cross-episode asset library | New `CrossEpisodeAssetIndex` class | NEW | Sits beside CharacterAssetManager; fingerprint-based lookup |
| B4: creative_history trace | New `CreativeHistoryTracker` + AssetBus schema extension | NEW + MODIFY | Add `creative-history` slot to ASSET_SCHEMA; new module |
| B5: failed_shots blacklist | New `BlacklistEngine` module | NEW | Hook into ShotParallelScheduler.runWithRetry pre-submit |
| B6: Fine-tuning ETL | New `FineTuningETL` module | NEW | Consumes EvaluationCollector + Hermes audit logs |
| D1: GLM-4.6v upgrade | `lib/ai-scorer.js` / consistency auditor | MODIFY | Model name swap, response schema verification |

### System Overview (v3.0 target)

```
┌──────────────────────────────────────────────────────────────────┐
│                     Pipeline Orchestrator (unchanged)             │
└──────────┬────────────────────────────────────────────┬──────────┘
           │                                            │
           ▼                                            ▼
┌─────────────────────────┐              ┌──────────────────────────┐
│  phaseHandlers (MODIFIED│              │  AssetBus (MODIFIED)     │
│  cloud-production       │              │  + creative-history slot │
│  + audio params)        │              │  + failed-shots slot     │
│                         │              │  + finetune-dataset slot │
│  + BlacklistEngine hook │              └──────────────────────────┘
│  + CreativeHistory hook │
└──┬──────┬──────┬───────┘
   │      │      │
   ▼      ▼      ▼
┌──────┐ ┌────────────┐ ┌──────────────────┐
│ NEW  │ │ NEW        │ │ NEW              │
│Cross-│ │Blacklist   │ │CreativeHistory   │
│Ep    │ │Engine      │ │Tracker           │
│Index │ │(vector/    │ │(DAG of shot      │
│(fp)  │ │ hash/word) │ │ dependencies)    │
└──────┘ └────────────┘ └──────────────────┘
           │
           ▼
┌────────────────────────────────────────────────┐
│  NEW: FineTuningETL                             │
│  Hermes audit + EvaluationCollector             │
│  → prompt-training-set.jsonl / LoRA manifest   │
└────────────────────────────────────────────────┘
```

## Recommended Project Structure (v3.0 additions)

```
lib/
├── pipeline.js                      # unchanged
├── phases/index.js                  # MODIFY: cloud-production audio, hooks
├── asset-bus.js                     # MODIFY: +3 schema slots
├── character-asset-manager.js       # MODIFY: +fingerprint, +audio ref
├── cross-episode-asset-index.js     # NEW (B2)
├── creative-history-tracker.js      # NEW (B4)
├── blacklist-engine.js              # NEW (B5)
├── finetuning-etl.js                # NEW (B6)
├── ai-scorer.js                     # MODIFY: glm-4.6v model swap (D1)
├── evaluation-collector.js          # unchanged (consumed by ETL)
└── hermes-client.js                 # unchanged (consumed by ETL)
```

### Structure Rationale

- **All new modules top-level in `lib/`:** Matches existing flat layout (no `lib/services/` subdir pattern in v2.0). Keeps imports simple (`import { BlacklistEngine } from '../blacklist-engine.js'`).
- **Modifications to existing files are surgical:** cloud-production handler is 187 LOC — audio extension is additive (new params object keys), not a rewrite.
- **AssetBus extension is the integration spine:** creative_history, failed_shots, and finetune_dataset all need cross-phase persistence — AssetBus already provides typed, cached, atomic writes. Extending `ASSET_SCHEMA` is the idiomatic way to add cross-phase state.

---

## Architectural Patterns

### Pattern 1: Schema-Extended AssetBus as Integration Spine

**What:** v3.0 capabilities need to persist new state types (creative_history DAG, failed_shots blacklist, finetune_dataset manifest). Rather than create parallel storage, extend `ASSET_SCHEMA`.

**When to use:** Any new state that must survive across phases and be read by later phases.

**Trade-offs:**
- Pro: Zero new infra; cache + atomic write already exist; `require()` throws if missing.
- Pro: Git checkpoint automatically versions the new state.
- Con: Schema becomes a god-object. Mitigate by keeping field lists minimal and documenting each slot.

**Example:**
```javascript
// lib/asset-bus.js — additive v3.0 entries
const ASSET_SCHEMA = {
  // ... existing 13 slots ...
  // ─── v3.0 additions ───
  'creative-history': {
    file: 'creative-history.json',
    fields: ['shots', 'edges', 'version', 'root_inputs'],
  },
  'failed-shots': {
    file: 'failed-shots.json',
    fields: ['blacklist', 'patterns', 'last_updated'],
  },
  'finetune-dataset': {
    file: 'finetune-dataset.json',
    fields: ['samples', 'task_type', 'version', 'exported_at'],
  },
};
```

### Pattern 2: Pre-Submit Hook in ShotParallelScheduler Loop

**What:** BlacklistEngine and CreativeHistoryTracker both need to intercept per-shot generation. Rather than modifying `ShotParallelScheduler`, inject hooks into the per-shot callback in `cloud-production` handler.

**When to use:** Any per-shot transformation that should compose with existing retry logic.

**Trade-offs:**
- Pro: Keeps `ShotParallelScheduler` generic; hooks are handler-scoped.
- Pro: Blacklist short-circuits before GPU spend (cost saver).
- Con: Handler callback grows longer. Mitigate by extracting hook orchestrator.

**Example:**
```javascript
// lib/phases/index.js — cloud-production handler, inside runWithRetry callback
const newResults = await scheduler.runWithRetry(shotsToRun, async (shot) => {
  // ─── v3.0 HOOK: BlacklistEngine pre-check ───
  const blacklistHit = await blacklistEngine.match(shot);
  if (blacklistHit) {
    return { shot_id: shot.id, status: 'blacklisted',
             reason: blacklistHit.pattern_id };
  }

  // ─── v3.0 HOOK: CreativeHistory lineage stamp ───
  await historyTracker.stampShot(shot.id, {
    script_hash, outline_hash, character_id, costume_id,
  });

  // existing omni_reference pack + audio extension (v3.0 A2)
  const refPack = await assetManager.getOmniReferencePack(..., {
    audioPath: shot.dialogue_audio_path,  // NEW
  });

  const task = await gtClient.submitTask({ ... });
  // ...
}, { maxRetries: 3 });
```

### Pattern 3: Hermes Audit as ETL Source (not just feedback loop)

**What:** v3.0 B6 repurposes the Hermes audit stream as training data. Currently `_hermesAudit()` fires-and-forgets. v3.0 captures `(decision, metrics, params, outcome)` tuples into a durable store for offline fine-tuning.

**When to use:** When the audit signal has aggregate value beyond per-decision tuning.

**Trade-offs:**
- Pro: No new instrumentation — Hermes audit already fires on every phase.
- Pro: Failed cases are already tagged via `outcome: 'failed'` in `auditFailure()`.
- Con: Hermes server is the system of record; ETL must handle Hermes downtime gracefully (degrade to EvaluationCollector-only).

**Example:**
```javascript
// lib/finetuning-etl.js
export class FineTuningETL {
  async export({ since, taskTypes }) {
    // 1. Read evaluations.json (EvaluationCollector)
    // 2. Cross-reference Hermes audit stream (if reachable)
    // 3. Filter failed + low-score cases
    // 4. Emit prompt-training-set.jsonl + LoRA-target-manifest.json
    // 5. Write AssetBus 'finetune-dataset' slot
  }
}
```

### Pattern 4: Fingerprint Index Decoupled from Asset Storage

**What:** B2 cross-episode asset reuse needs a fingerprint index. Keep the index separate from CharacterAssetManager's per-project manifest structure.

**When to use:** When lookup crosses project/workdir boundaries.

**Trade-offs:**
- Pro: CharacterAssetManager stays per-project (no cross-workdir coupling).
- Pro: Index can be rebuilt from manifests (eventual consistency).
- Con: Drift risk if manifests change without index update. Mitigate with post-write hook in CharacterAssetManager that re-embeds.

**Example:**
```javascript
// lib/cross-episode-asset-index.js
export class CrossEpisodeAssetIndex {
  constructor(indexDir) { /* e.g., ~/.kai/asset-index/ */ }

  async indexCharacter({ projectDir, characterId, l1Images }) {
    // 1. Compute perceptual hash (pHash) of each L1 image
    // 2. Store {projectDir, characterId, phash, manifest_path}
    // 3. Enable query: findSimilar(phash, threshold)
  }

  async findSimilar(phash, opts = {}) {
    // Hamming distance over indexed hashes
    // Returns [{projectDir, characterId, similarity}]
  }
}
```

---

## Data Flow

### A2: Seedance 2.0 Audio-Visual Sync (cloud-production)

```
spatio-temporal-script.json (shots[])
    │
    ├── per shot: dialogue_audio_path (from seed-skeleton temp_dialogue/)
    │
    ▼
CharacterAssetManager.getOmniReferencePack(charId, {
  costumeId, sceneFrame,
  audioPath: shot.dialogue_audio_path,   ← NEW v3.0 input
})
    │
    ├── identityImages (L1, unchanged)
    ├── sceneImages (L2/scene, unchanged)
    ├── actionVideos (unchanged)
    └── audioTrack: dialogue_audio_path  ← NEW in return object
    │
    ▼
gtClient.submitTask({
  taskType: 'seedance_omni_reference_pro',  ← NEW task type (or same + audio)
  params: {
    prompt, identity_refs, scene_refs, action_refs,
    identity_weight, action_weight,
    audio_track: refPack.audioTrack,        ← NEW
    lip_sync_mode: 'auto',                  ← NEW (Seedance 2.0 native)
  }
})
```

**Build note:** The `taskType` choice (new vs extended) depends on GoldTeam API. If GoldTeam exposes `seedance_omni_reference_pro` as a distinct task type, register it in GoldTeamClient's 44-type list. If it's a param flag on the existing type, just add params. **LOW confidence** until GoldTeam API docs consulted in implementation phase.

### B4: creative_history Trace DAG

```
Phase: pain-discovery
    └── root_input: { pain_report_hash }
            │
Phase: script-generation
    └── derived: { script_hash, parent: pain_report_hash }
            │
Phase: spatio-temporal-script
    └── derived: { sts_hash, parent: script_hash, shots: [{shot_id, hash}] }
            │
Phase: cloud-production
    └── per shot: { shot_id, video_task_id, parent: sts.shot_hash }
            │
            ▼  (user edits script)
Phase: script-generation (re-run)
    └── CreativeHistoryTracker.diffAffectedShots(new_script_hash)
            returns: [shot_id_3, shot_id_7]   ← auto-located
```

**Data structure choice:** Adjacency list with hash-stamped nodes (NOT a graph DB). Justification:
- Pipeline is single-process, single-workdir; no concurrent writers.
- DAG fits in JSON (<10K nodes per episode).
- Hash-stamping enables content-addressed diff (edit script → rehash → BFS to leaves).
- AssetBus slot gives atomic persistence + git versioning for free.

**Schema:**
```javascript
// creative-history.json
{
  version: 1,
  root_inputs: { pain_report: "sha256:..." },
  nodes: [
    { id: "script:v3",    type: "script",     hash: "sha256:abc",
      parent_ids: ["pain_report:v1"], phase: "script-generation" },
    { id: "shot:EP01:S3", type: "shot",       hash: "sha256:def",
      parent_ids: ["script:v3", "character:hero:v2"], phase: "sts" },
    { id: "video:shot:S3:take1", type: "video",
      parent_ids: ["shot:EP01:S3"], phase: "cloud-production" },
  ],
  edges: [ /* derived from parent_ids for BFS */ ],
}
```

### B5: BlacklistEngine Matching

```
failed_shots.json (accumulated across runs)
    │
    ├── patterns: [
    │     { id, type: 'keyword',  match: {prompt_contains: "extra fingers"} },
    │     { id, type: 'hash',     match: {identity_refs_phash: "...", distance: <4} },
    │     { id, type: 'semantic', match: {embedding: [...], cosine: >0.92} },
    │   ]
    │
    ▼  (per shot, pre-submit)
BlacklistEngine.match(shot) → null | { pattern_id, evidence }
    │
    ├── null → proceed with submitTask
    └── hit  → return {status: 'blacklisted'} (skip GPU spend)
```

**Matching strategy (layered):**
1. **Keyword (cheapest):** regex/substring on prompt + scene description. Use first.
2. **Perceptual hash (medium):** pHash of identity_refs + scene_frame, Hamming distance. Use for "same bad composition" recurrence.
3. **Semantic vector (expensive, optional):** embedding cosine similarity. **Defer** — requires an embedding model. v3.0 can ship with hash + keyword only; vector is a fast-follow.

**Zero-npm-deps constraint:** Project principle is "零 npm 依赖" (PROJECT.md L85). pHash can be computed with a small pure-JS DCT implementation (~50 LOC) — no `sharp`/`image-hash` dependency. Mark this as a **MEDIUM** confidence implementation note.

### B6: Fine-Tuning ETL Pipeline

```
.pipeline-assets/evaluations.json (EvaluationCollector)
    │
    ├── filter: success=false OR ai_quality_score < threshold
    │
    ▼
FineTuningETL.collect({ since, taskTypes })
    │
    ├── join with Hermes audit (decision_id ↔ metrics)
    │
    ├── transform per task type:
    │     - seedance_omni_reference → {prompt, refs, failure_mode}
    │     - tts_generation         → {text, voice_profile, failure_mode}
    │     - flux_image             → {prompt, l1_refs, failure_mode}
    │
    ▼
finetune-dataset.json (AssetBus slot)
    + prompt-training-set.jsonl   (Hermes-side consumption)
    + lora-target-manifest.json   (per-character fine-tune targets)
```

**Degradation:** If Hermes unreachable, ETL falls back to EvaluationCollector-only data (already has `parameters_used`, `ai_quality_score`, `success`). Mark Hermes join as best-effort.

---

## Component Boundaries (v3.0)

| Component | Responsibility | Communicates With | New/Modified |
|-----------|---------------|-------------------|--------------|
| `cloud-production` handler | Submit Seedance 2.0 tasks with audio; invoke hooks | AssetBus, CharacterAssetManager, BlacklistEngine, CreativeHistoryTracker, GoldTeam, Hermes | MODIFY |
| `CharacterAssetManager` | L1-L4 asset lookup; resolve audio path for current shot | AssetBus, CrossEpisodeAssetIndex | MODIFY (+audio, +fingerprint) |
| `CrossEpisodeAssetIndex` | pHash index; findSimilar across projects | CharacterAssetManager (post-write hook) | NEW |
| `CreativeHistoryTracker` | Append nodes; diffAffectedShots BFS | AssetBus (`creative-history` slot), cloud-production handler | NEW |
| `BlacklistEngine` | Match shot against failed patterns | AssetBus (`failed-shots` slot), cloud-production handler | NEW |
| `FineTuningETL` | Extract training data from evals + Hermes | EvaluationCollector, HermesClient, AssetBus (`finetune-dataset` slot) | NEW |
| `ai-scorer` / consistency auditor | GLM-4.6v model invocation | Hermes decide/audit | MODIFY (model name + response schema) |
| `AssetBus` | Persist 3 new typed slots | All of the above | MODIFY (schema only) |

---

## Integration Risk Analysis

### Risk 1: Hermes VALID_PHASES drift
**Where:** `lib/hermes-client.js:16-24` — `VALID_PHASES` array must stay 1:1 with `PHASES`.
**v3.0 impact:** No new phases planned (the 5 capabilities extend existing phases). LOW risk. But if BlacklistEngine or FineTuningETL want their own Hermes decision types, they must either reuse existing phase IDs or extend both arrays in lockstep.
**Mitigation:** v3.0 capabilities use existing phase IDs (`cloud-production`, `consistency-guard`) for Hermes calls.

### Risk 2: ShotParallelScheduler callback signature change
**Where:** `cloud-production` handler passes `async (shot) => {...}` to `scheduler.runWithRetry`.
**v3.0 impact:** Adding blacklist short-circuit changes return semantics (`status: 'blacklisted'` is neither success nor retryable failure).
**Mitigation:** Check `ShotParallelScheduler.collectFailures` / `collectPermanentFailures` semantics — blacklisted shots should count as "skipped" not "failed". May need scheduler extension. **MEDIUM** confidence — verify scheduler contract during implementation.

### Risk 3: AssetBus schema bloat
**Where:** `lib/asset-bus.js` ASSET_SCHEMA grows from 13 → 16 slots.
**v3.0 impact:** Minimal — schema is a flat object, lookups are O(1). But the `fields` arrays become documentation debt.
**Mitigation:** Keep v3.0 slot field lists minimal (3-5 fields each); detailed schema lives in the consuming module.

### Risk 4: Cross-episode index drift
**Where:** CharacterAssetManager writes manifest.json; CrossEpisodeAssetIndex reads them.
**v3.0 impact:** If a character is deleted or re-registered, the index can become stale.
**Mitigation:** Index is rebuildable from manifest scan (`rebuild()` method). Add a post-write hook in `CharacterAssetManager.registerIdentityAnchors` that calls `index.indexCharacter()` — single writer, no race.

### Risk 5: pHash pure-JS implementation quality
**Where:** BlacklistEngine + CrossEpisodeAssetIndex both need pHash.
**v3.0 impact:** A naive DCT pHash has higher collision rate than `image-hash` npm package.
**Mitigation:** Use 64-bit pHash with Hamming distance threshold ≤6 (industry standard for "same image"). For "visually similar" use threshold ≤12. Document thresholds in code.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Modifying ShotParallelScheduler for v3.0 concerns
**Why bad:** Scheduler is a generic primitive. Mixing blacklist logic into it couples retry semantics with matching semantics.
**Instead:** Keep hooks in the handler callback. Scheduler stays generic.

### Anti-Pattern 2: Making Hermes a hard dependency for FineTuningETL
**Why bad:** Hermes already has degrade paths throughout v2.0 (every `_hermesDecide` is wrapped in try/catch). FineTuningETL must honor the same degrade-first principle.
**Instead:** ETL reads EvaluationCollector as source-of-truth; Hermes join is enrichment (best-effort).

### Anti-Pattern 3: Storing creative_history in a graph database
**Why bad:** Violates zero-infra principle (PROJECT.md L85). Adds operational burden for <10K nodes.
**Instead:** Adjacency list in JSON via AssetBus. BFS in-memory.

### Anti-Pattern 4: Coupling BlacklistEngine to a specific vector DB
**Why bad:** Same zero-infra principle. Also premature — v3.0 doesn't need semantic matching on day one.
**Instead:** Layered matcher: keyword (day 1) → pHash (day 1) → embedding (defer to v4.0).

---

## Scalability Considerations

| Concern | Per-episode (current) | 10-episode series | 100-episode library |
|---------|----------------------|-------------------|---------------------|
| creative_history nodes | ~500 (shots × takes) | 5K across episodes | 50K — still fits in JSON, but diff BFS slows; consider per-episode DAGs + cross-episode index |
| failed_shots patterns | ~20 | 200 | 2K — pHash matching stays O(n) at this scale; fine |
| CrossEpisodeAssetIndex | 5 characters | 50 characters | 500 characters — pHash index in-memory is trivial |
| FineTuningETL samples | ~100 | 1K | 10K — JSONL export still fine; consider streaming write |
| evaluations.json | ~200 records | 2K | 20K — EvaluationCollector loads all into memory; may need pagination in v4.0 |

**v3.0 is sized for the 10-episode series case.** v4.0 should revisit evaluations.json pagination and creative_history sharding if 100-episode scale is in scope.

---

## Build Order (dependency-aware)

Ordered so each phase's deps are satisfied by prior phases. Each phase is independently shippable.

### Phase 1: AssetBus schema extension (BLOCKER — unblocks 2, 3, 4, 5)
**Files:** `lib/asset-bus.js` (add 3 slots)
**Why first:** Every other v3.0 component reads/writes AssetBus. Schema must exist before consumers.
**Risk:** Trivial — additive change, no behavior modification.
**Effort:** XS (1 schema edit, 1 test).

### Phase 2: GLM-4.6v model swap (D1)
**Files:** `lib/ai-scorer.js`, consistency auditor callsites
**Why early:** Isolated change, no deps on v3.0 infra. Reduces risk if v3.0 schedule slips — D1 ships standalone.
**Risk:** Response schema may differ from glm-4v-flash. Verify field names (`score`, `reasoning`) match.
**Effort:** S (model name + response validation + test fixtures).

### Phase 3: CrossEpisodeAssetIndex + CharacterAssetManager fingerprint (B2)
**Files:** NEW `lib/cross-episode-asset-index.js`, MODIFY `lib/character-asset-manager.js`
**Deps:** None (uses standalone index dir, not AssetBus).
**Why here:** Independent of pipeline flow changes. Can be built + tested in isolation.
**Risk:** pHash pure-JS implementation quality. Validate with known-similar image pairs.
**Effort:** M (pHash impl ~50 LOC + index CRUD + query + tests).

### Phase 4: CreativeHistoryTracker (B4)
**Files:** NEW `lib/creative-history-tracker.js`, MODIFY `lib/phases/index.js` (stamp calls in cloud-production)
**Deps:** Phase 1 (AssetBus `creative-history` slot).
**Why here:** Needs AssetBus slot from Phase 1. Does not depend on B2 or B5.
**Risk:** Hash-stamping must be retrofitted into earlier phases (script-generation, spatio-temporal-script) for full lineage. MVP: stamp only at cloud-production (downstream-only lineage). Full upstream lineage is a fast-follow.
**Effort:** M (DAG ops + BFS diff + integration into handler).

### Phase 5: BlacklistEngine (B5)
**Files:** NEW `lib/blacklist-engine.js`, MODIFY `lib/phases/index.js` (hook in cloud-production callback)
**Deps:** Phase 1 (AssetBus `failed-shots` slot).
**Why here:** Needs AssetBus slot. Independent of Phase 3/4. Placed after CreativeHistory so cloud-production modifications compose both hooks cleanly.
**Risk:** Scheduler return-semantics for blacklisted shots (see Risk 2). Validate that blacklisted ≠ retried.
**Effort:** M (keyword + pHash matchers + handler hook + tests).

### Phase 6: Seedance 2.0 audio-visual sync (A2)
**Files:** MODIFY `lib/character-asset-manager.js` (audio in getOmniReferencePack), MODIFY `lib/phases/index.js` (cloud-production submitTask params)
**Deps:** Phase 5 (cloud-production hook chain must be stable before adding audio param surface).
**Why late:** Touches the highest-risk code path (GPU submission). Wants BlacklistEngine + CreativeHistory hooks already in place so A2 changes don't conflict.
**Risk:** GoldTeam API surface for Seedance 2.0 task type / audio param. **Requires GoldTeam API consultation** before implementation — flag for research.
**Effort:** L (API verification + CharacterAssetManager extension + handler param plumbing + audio path resolution + E2E test).

### Phase 7: FineTuningETL (B6)
**Files:** NEW `lib/finetuning-etl.js`
**Deps:** Phase 1 (AssetBus `finetune-dataset` slot). Soft dep on Phases 5-6 (richer failure data once blacklist + audio are in flow).
**Why last:** Consumes the output of all prior phases. Max value when blacklist + audio failures are flowing into evaluations.json.
**Risk:** Hermes availability for audit-stream join (mitigated by degrade-to-EvaluationCollector-only).
**Effort:** M (ETL transform per task type + Hermes best-effort join + JSONL export + tests).

### Build Order Summary

```
Phase 1 (AssetBus schema) ──┬─→ Phase 4 (CreativeHistory)
                            ├─→ Phase 5 (BlacklistEngine) ──→ Phase 6 (Seedance A2) ──┐
                            └─→ Phase 7 (FineTuningETL) ◀────────────────────────────┘
Phase 2 (GLM-4.6v) ── independent
Phase 3 (CrossEpisodeIndex) ── independent
```

Critical path: **1 → 5 → 6 → 7** (4 phases of sequential work).
Phases 2, 3 can run in parallel with the critical path.

---

## Phase-Specific Research Flags

| Phase | Research Needed | Confidence |
|-------|----------------|------------|
| Phase 6 (Seedance A2) | GoldTeam API for `seedance_omni_reference_pro` task type — does it exist? What are audio param names? | LOW — needs GoldTeam docs/operator input |
| Phase 5 (BlacklistEngine) | ShotParallelScheduler contract for non-retryable non-failure returns (blacklisted) | MEDIUM — code-reading during implementation |
| Phase 3 (CrossEpisodeIndex) | pHash collision behavior on stylized AIGC character faces (may differ from photographic) | MEDIUM — empirical validation needed |
| Phase 4 (CreativeHistory) | Where to inject hash-stamping in upstream phases (script-generation, sts) without breaking v2.0 handlers | MEDIUM — handler-by-handler audit |
| Phase 2 (GLM-4.6v) | Response schema diff vs glm-4v-flash; token cost delta | LOW — needs API docs |

---

## Sources

- `lib/pipeline.js` (read in full) — PHASES array, runPhase flow, review gate, V2_MIGRATION_MAP integrity check
- `lib/phases/index.js:2962-3148` — cloud-production handler (Seedance submission, ShotParallelScheduler, Hermes audit, EvaluationCollector)
- `lib/phases/index.js:1-200` — handler helpers (`_hermesDecide`, `_hermesAudit`, `_makeCollector`, `ShotParallelScheduler` import)
- `lib/asset-bus.js` (read in full) — ASSET_SCHEMA structure, read/write/require contract, cache behavior
- `lib/character-asset-manager.js` (read in full) — L1-L4 structure, `getOmniReferencePack` signature (v3.0 A2 extension point)
- `lib/hermes-client.js` (read in full) — VALID_PHASES lockstep requirement, decide/audit/auditFailure signatures
- `lib/evaluation-collector.js` (read in full) — record schema, `exportForHermes` (v3.0 ETL input), `aggregateForEpisode`
- `.planning/PROJECT.md` (read in full) — v3.0 Active requirements (A2/B2/B4/B5/B6/D1), zero-npm-deps principle, degrade-first principle
