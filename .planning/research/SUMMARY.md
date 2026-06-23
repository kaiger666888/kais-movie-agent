# Project Research Summary

**Project:** kais-movie-agent v3.0 — Industrial Pipeline Alignment
**Domain:** AIGC 短视频工业化流水线 (audio-visual sync, cross-episode reuse, creative history, bad-case blacklist, fine-tuning feedback, vision eval upgrade)
**Researched:** 2026-06-22
**Confidence:** HIGH (codebase-verified integration points; MEDIUM on Seedance 2.0 / GoldTeam API surface)

## Executive Summary

v3.0 is **not a greenfield build** — it is a surgical alignment of an already-shipped v2.0 pipeline to 2026 industrial-station expectations (Seedance 2.0, Kling O1, SkyReels V4). The defining discovery across all four research files: **most v3.0 capability is already latent in the codebase.** The v2.0 continuity-auditor already implements full DINOv2 embedding + cosine similarity; the quality-gate already runs on `glm-4.6v`; the AssetBus already provides the typed-slot persistence pattern; the ShotParallelScheduler already writes `failed_shots.json`. The stack "additions" are therefore mostly (1) **wiring existing APIs** (Seedance audio_refs, GLM-4.6v model string), (2) **extending existing patterns** (`InvariantBus._provenance` → creative_history, `failed_shots.json` → BlacklistEngine), and (3) **two small self-contained utilities** (pHash ~80 LOC, asset-fingerprint ~150 LOC). **Zero new npm dependencies.** Only one new external API surface (Seedance 2.0 multimodal) is recommended.

The recommended approach is a **prerequisite-first build order**: (1) D1 callLLM refactor + GLM-4.6v upgrade as a blocking prerequisite (because A2/B2/B5 all depend on trustworthy visual scoring), then (2) AssetBus schema extension as the integration spine, then (3) the five capability modules (B5 blacklist → A2 audio → B4 creative_history → B2 cross-episode → B6 fine-tuning) in dependency order. AssetBus schema extension is the keystone — every other module reads/writes through it. The killer differentiator is **B4 per-shot creative_history trace** (Git-for-AIGC-movies: 改剧本一行 → 自动定位受影响镜头); the highest-risk phase is **B6 fine-tuning** (irreversible LoRA poisoning — must ship with human review gate as launch blocker).

The key risks are three. **(1) GLM-4.6V prompt-format breakage (Pitfall 7)** — the most likely single failure point: v2.0 prompts embed file paths as bracketed text (`[${imagePath}]`), but GLM-4.6V requires `{type:'image_url'}` content blocks. A bare model-string swap returns 200 + text-guessed scores = silently broken quality gate. Prevention: refactor `callLLM` BEFORE touching any model name. **(2) Seedance audio silently ignored (Pitfall 1)** — the most insidious failure: the model accepts audio files but ignores them without explicit `@Audio1` prompt binding; degraded mode hides it entirely; only surfaces in real GPU runs. **(3) Fine-tuning data poisoning (Pitfall 6)** — irreversible: a mislabeled or copyrighted sample bakes into LoRA weights; must have human gate + golden-set regression + PII scrubber as launch blockers, not follow-ups.

## Key Findings

### Recommended Stack

**Zero new npm packages.** The `package.json` `{socket.io-client}` principle is preserved. Stack additions are: (a) external services/APIs, (b) self-implemented utilities (~650 LOC total across 5 new `lib/*.js` modules), and (c) out-of-process tools on the gold-team GPU side.

**Core technologies (services/APIs):**
- **Seedance 2.0 (火山方舟 ark API)** — `doubao-seedance-2.0` for video gen with native audio-driven lip-sync; extends existing `JimengClient.omniReferenceVideo` with `audio_refs` + `generate_audio: true` passthrough.
- **GLM-4.6V (智谱 bigmodel)** — `glm-4.6v` / `glm-4.6v-flash` (free) for vision eval; already used in `quality-gate.js:152`, only `continuity-auditor.js:398` still on `glm-4v-flash`.
- **GoldTeamClient DINOv2 Embedding** — existing `task_type='dinov2_embedding'` already implemented in `continuity-auditor.js:412-441` with cosine similarity; v3.0 reuses for asset fingerprint (B2) and bad-case semantic match (B5).
- **GLM-4.6V Image2Prompt** — translates failed-shot images into indexable failure-mode descriptions for blacklist tagging.
- **kohya-ss / OneTrainer** (out-of-process on gold-team GPU) — SDXL/FLUX LoRA training; v3.0 only emits dataset manifest, operator triggers training.

**Self-implemented utilities (no npm):**
- `lib/perceptual-hash.js` (~80 LOC) — DCT-II pHash, fingerprint fallback when DINOv2 unavailable.
- `lib/asset-fingerprint.js` (~150 LOC) — sha256 + DINOv2 + pHash triple-index for cross-episode reuse.
- `lib/creative-history-tracker.js` (~200 LOC) — extends `InvariantBus._provenance`; DAG with reverse BFS for shot↔script localization.
- `lib/blacklist-engine.js` (~120 LOC) — persists `failed_shots.json`; keyword + pHash + (deferred) embedding layered matcher.
- `lib/finetuning-etl.js` — exports `(failed_shot, anchor, audio, recommended_action)` manifest for operator-triggered LoRA training.

**Rejected:** `image-hash`, `hnswlib-wasm`, `faiss-node`, Milvus, Qdrant, `dependency-graph`, Wav2Lip — all violate zero-npm/zero-infra principles or are unnecessary at current scale.

### Expected Features

**Must have (table stakes — 2026 industrial-station baseline):**
- **A2-lite: Seedance omni + audio_refs field plumbed** — interface + phase ordering in place even if operator doesn't enable immediately.
- **B2: pHash fingerprint + cross-episode manifest** — at minimum first-episode-builds-library → second-episode-queries-library → hit reuses L1/L2.
- **B4: creative_history JSON schema + shot ↔ script reverse index** — edit a script line, system outputs affected shot_id list (report only; auto-rerender deferred to v3.1).
- **B5: failed_shots persisted + startup-loaded + generation-time prompt injection** — keyword + pHash dual-query.
- **B6: training-data manifest exporter** — JSONL output for operator evaluation; no auto-training in v3.0.
- **D1: GLM-4.6v replaces glm-4v-flash** — all vision scoring paths.

**Should have (differentiators — competitive moat against SaaS rivals):**
- **Per-shot creative_history 改剧本重渲 (B4 killer feature)** — Git-for-AIGC-movies entry point; SkyReels/Runway still do whole-segment regeneration.
- **Bad-case semantic rejection via DINOv2 embedding** — industry negative prompts are string-only; we match by cosine ≥0.92.
- **Private cross-episode character library** — Kling O1 Element Library is platform-bound (100 cap); ours is local, private, uncapped.
- **Data flywheel back to LoRA** — closed SaaS (Sora/Veo) can't touch this; core value of self-built pipeline.

**Defer (v3.1+):**
- Auto-rerender on script edit (B4 v3.1).
- Vector search for blacklist (B5 — only when >10K entries).
- Auto-trigger LoRA training (B6 — needs operator approval workflow).
- C2PA provenance compliance (v4.0 — only for external distribution).
- Multi-model A/B testing (v4.0).
- Full GPU E2E validation (PROJECT.md already Out of Scope for v3.0).

**Anti-features (don't do):**
- Real-time bad-case monitoring web UI (violates zero-dependency Node principle).
- General perceptual-hash npm library (8 years stale, no ESM; self-implement).
- Vector database infra (Qdrant/Milvus — scale unjustified at <10K entries).
- Cron-triggered auto-training (operator must review before GPU burn).

### Architecture Approach

AssetBus is the **integration spine** — extend `ASSET_SCHEMA` from 13 → 16 typed slots (add `creative-history`, `failed-shots`, `finetune-dataset`). All v3.0 modules persist through these slots, gaining atomic writes + cache + git checkpoint for free. New modules are flat in `lib/` (matching v2.0 layout). Hooks for BlacklistEngine + CreativeHistoryTracker are injected into the `cloud-production` handler's per-shot callback (NOT into ShotParallelScheduler — keeps the scheduler generic). FineTuningETL consumes EvaluationCollector + Hermes audit as ETL source (Hermes is best-effort enrichment, not hard dependency).

**Major components:**
1. **AssetBus (MODIFY)** — +3 schema slots; the keystone change that unblocks 4 other modules.
2. **BlacklistEngine (NEW, B5)** — layered matcher: keyword → pHash → embedding (deferred); hook in cloud-production pre-submit.
3. **CreativeHistoryTracker (NEW, B4)** — append-only DAG + reverse BFS; blast-radius cap.
4. **CrossEpisodeAssetIndex (NEW, B2)** — pHash index decoupled from per-project CharacterAssetManager.
5. **FineTuningETL (NEW, B6)** — consumes evals + Hermes audit; emits JSONL manifest.
6. **cloud-production handler (MODIFY, A2)** — Seedance audio_refs + hook orchestrator.
7. **ai-scorer / continuity-auditor (MODIFY, D1)** — callLLM refactor + model centralization.

### Critical Pitfalls

1. **GLM-4.6V content-block breakage (Pitfall 7)** — `callLLM` must be refactored to support `{type:'image_url'}` content arrays BEFORE any model name change. Without this, v2.0's bracketed-path prompts (`[${imagePath}]`) produce text-guessed scores, not visual scores. **Most likely single failure in v3.0.**

2. **Seedance audio silently ignored (Pitfall 1)** — most insidious: API returns 200 + video, but lip-sync never engages if prompt lacks explicit `@Audio1` binding. Reject submissions where audio_refs is non-empty but prompt contains no `@Audio` token. **Cannot be caught in degraded mode — requires Layer-2 GPU verification.**

3. **Fine-tuning data poisoning (Pitfall 6)** — irreversible: copyright/PII/mislabel bakes into LoRA weights; SilentBadDiffusion (ICML 2024) shows more capable models are MORE susceptible. Human review gate + golden-set regression + PII scrubber are launch blockers.

4. **Cross-episode fingerprint false-positive (Pitfall 3)** — catastrophic: wrong L1 anchor → wrong face in every shot of new episode → full pipeline rerun. Never match on perceptual hash alone; two-stage (hash retrieval + DINOv2 confirm) + human gate on first cross-episode match.

5. **Bad-case blacklist over-matching (Pitfall 5)** — substring/regex blacklists reject legitimate prompts ("violins" matches "violence"); the pipeline appears broken. Semantic matching (cosine ≥0.92) + TTL decay + soft-block with audit trail from day 1.

6. **Degrade-chain breakage (Pitfall 8)** — every new v3.0 module must declare a degrade contract; degraded E2E test must stay <5s. BlacklistEngine defaults open (matcher unavailable = allow generation); CreativeHistoryTracker is fire-and-forget append; FineTuningETL is async queue.

## Implications for Roadmap

Based on cross-research consensus (all 4 researchers independently arrived at this ordering):

### Phase 1: callLLM Refactor + GLM-4.6V Upgrade (D1) — BLOCKER

**Rationale:** A2 verification, B2 fingerprint confirmation, B5 bad-case evaluation all depend on trustworthy visual scoring. Shipping them on a silently-broken GLM-4.6V migration produces false confidence. This is the most likely single failure point in v3.0 (Pitfall 7). Also: GLM-4.6V upgrade is just 1 string replacement AFTER the refactor — fast win, but only safe after refactor.
**Delivers:** Centralized `ZHIPU_VISION_MODEL` env var (eliminating 5 hardcoded copies with 3 different versions), `callLLM` content-block support, cache invalidation by model version, golden-set scoring baseline (50 image pairs).
**Addresses:** D1 from FEATURES.md.
**Avoids:** Pitfall 7 (content-block breakage), Pitfall 8 (degrade-chain — refactored callLLM preserves fallback path).
**Research flag:** LOW — needs GLM-4.6V API docs verification (response schema diff vs glm-4v-flash, `thinking` parameter behavior for deterministic scoring).

### Phase 2: AssetBus Schema Extension (keystone)

**Rationale:** Every other v3.0 component reads/writes through AssetBus. Schema must exist before any consumer can be built. Trivial additive change, unblocks 4 downstream modules.
**Delivers:** 3 new typed slots: `creative-history` (shots/edges/version/root_inputs), `failed-shots` (blacklist/patterns/last_updated), `finetune-dataset` (samples/task_type/version/exported_at). Backward compatible — missing slots degrade to null.
**Avoids:** Pitfall 8 (typed slots give atomic write + git checkpoint + cache for free to all new modules).
**Research flag:** Skip — well-documented v2.0 pattern.

### Phase 3: BlacklistEngine (B5) — bad case persistence + semantic match

**Rationale:** Foundational persistence that B6 (fine-tuning) consumes. Must be in place before Seedance A2 so failure data flows correctly from day 1 of audio integration. Lower complexity than B4/B2, fast cost-saver (skips GPU spend on known-bad patterns).
**Delivers:** `failed_shots.json` persistence + startup load + layered matcher (keyword + pHash; embedding deferred). TTL/decay mechanism. Soft-block with audit trail. False-rejection metric tracking.
**Addresses:** B5 from FEATURES.md.
**Avoids:** Pitfall 5 (over-matching — semantic match from day 1), Pitfall 8 (default-open degrade).
**Research flag:** MEDIUM — ShotParallelScheduler return-semantics for blacklisted (non-retryable, non-failure) shots needs code-reading during implementation.

### Phase 4: Seedance 2.0 Audio-Visual Sync (A2)

**Rationale:** Depends on Phase 1 (D1) for visual scoring verification — only way to distinguish "lip-sync worked" from "lip-sync was skipped." Depends on Phase 3 (BlacklistEngine) so cloud-production hook chain is stable before audio param surface added. Late placement because touches highest-risk code path (GPU submission).
**Delivers:** `getOmniReferencePack` accepts `audioRefs`; cloud-production handler emits `@Audio1` prompt bindings; rejects audio present without binding. Chinese test set + real AV-sync metric (audio-video correlation). Relax `lip_sync_threshold` from impossible 1.0 → measurable 0.85.
**Addresses:** A2-lite from FEATURES.md.
**Avoids:** Pitfall 1 (silently ignored audio — submission-time validation), Pitfall 2 (multilingual underperformance — Chinese test set + scene-split for multi-speaker).
**Research flag:** HIGH — GoldTeam API surface for Seedance 2.0 audio (`seedance_omni_reference_pro` task type vs param flag? audio field names?) is unknown; requires operator consultation BEFORE implementation.

### Phase 5: CreativeHistoryTracker (B4) — killer differentiator

**Rationale:** Most complex new module (HIGH complexity per FEATURES.md). High value (Git-for-AIGC-movies entry point — strongest competitive moat). Needs AssetBus slot from Phase 2. Independent of B2 fingerprint. Placed after A2 so cloud-production hook chain composes cleanly.
**Delivers:** Append-only DAG in `.creative-history.jsonl`; hash-stamped nodes (`{shot_id, source_hash}`); reverse-BFS diff query (`diffAffectedShots(new_script_hash)` → shot_id list). Blast-radius cap (default 20 shots; prompt user to scope larger). Performance budget <500ms at 24-episode scale.
**Addresses:** B4 from FEATURES.md (v3.0 ships report-only output; auto-rerender deferred to v3.1).
**Avoids:** Pitfall 4 (dependency explosion — lazy on-demand traversal, scene-granularity invalidation, version stamps not references).
**Research flag:** MEDIUM — where to inject hash-stamping in upstream phases (script-generation, spatio-temporal-script) without breaking v2.0 handlers. MVP: stamp only at cloud-production (downstream-only lineage); full upstream lineage is fast-follow.

### Phase 6: CrossEpisodeAssetIndex (B2) — research-grade matching

**Rationale:** Requires labeled evaluation set (≥50 same-character + ≥50 different-character pairs) — research-grade matching problem, not pure engineering. pHash collision behavior on stylized AIGC character faces needs empirical validation. Independent of pipeline flow — can be built in parallel with critical path but ships late because of validation requirements.
**Delivers:** pHash self-implementation (~80 LOC DCT-II + Hamming); CrossEpisodeAssetIndex class with `indexCharacter` / `findSimilar`; two-stage match (hash retrieval → DINOv2 cosine ≥0.92 confirm); version-stamped hashes (`{algorithm: "dinov2-v1", embedding: [...]}`); human-in-the-loop gate on first cross-episode match.
**Addresses:** B2 from FEATURES.md.
**Avoids:** Pitfall 3 (false-positive catastrophic — two-stage + human gate), Pitfall 3 (false-negative silent waste — calibrated threshold).
**Research flag:** MEDIUM — pHash collision behavior on stylized AIGC faces may differ from photographic; needs labeled validation before shipping.

### Phase 7: FineTuningETL (B6) — highest risk, most testing runway

**Rationale:** Last because consumes output of all prior phases (max value when blacklist + audio failures flow into evaluations.json). Highest-risk phase in v3.0 (Pitfall 6 — LoRA poisoning is irreversible). Needs most testing runway. v3.0 only emits manifest + recommended-action JSONL; operator triggers training out-of-process.
**Delivers:** FineTuningETL class consuming EvaluationCollector + Hermes audit (best-effort); per-task-type transform (seedance/tts/flux); JSONL manifest export; PII scrubber; golden-set regression harness (50-100 known-good prompts). **Human review gate is launch blocker** — every sample labeled `{copyright_status, pii_scrubbed, label_correct, approved_for_training}`.
**Addresses:** B6 from FEATURES.md.
**Avoids:** Pitfall 6 (copyright/PII/regression — human gate + golden set + PII scrubber as launch blockers).
**Research flag:** MEDIUM — LoRA training workflow details deferred to operator (out-of-process); but ETL transform logic + PII scrubbing patterns need validation.

### Phase Ordering Rationale

- **D1 first** because A2/B2/B5 all depend on trustworthy visual scoring; shipping them on silently-broken GLM-4.6V produces false confidence (Pitfall 7).
- **AssetBus schema next** because it's the integration spine for B4/B5/B6 (every module reads/writes through it).
- **B5 before A2** because (a) B5 has lower complexity, (b) failure data must flow from day 1 of audio integration, (c) cloud-production hook chain should stabilize before adding audio param surface.
- **A2 before B4/B2** because A2 depends on D1 (Phase 1) for verification, while B4/B2 are independent of A2; placing A2 early de-risks the GPU code path.
- **B4 before B2** because B4 is the killer differentiator with higher value; B2 is research-grade and needs labeled validation, so schedule with more runway.
- **B6 last** because it consumes output of all prior phases and is highest-risk (irreversible LoRA poisoning); most testing runway needed.
- **Cross-cutting Pitfall 8 (degrade contracts)** is a row in EVERY phase's success criteria, not a phase itself.

### Critical Path

```
Phase 1 (D1) → Phase 2 (AssetBus) → Phase 3 (B5) → Phase 4 (A2) → Phase 5 (B4) → Phase 7 (B6)
                                                              ↘
                                                               Phase 6 (B2) — independent track
```

### Research Flags

**Needs deeper research during planning (`/gsd:plan-phase --research-phase N`):**
- **Phase 4 (A2 Seedance):** HIGH — GoldTeam API surface for Seedance 2.0 audio task type / param names is unknown. Requires operator consultation BEFORE implementation begins.
- **Phase 6 (B2 CrossEpisode):** MEDIUM — pHash collision behavior on stylized AIGC character faces; needs labeled validation set construction (≥50 same-char + ≥50 diff-char pairs).
- **Phase 7 (B6 FineTuning):** MEDIUM — PII scrubbing patterns + dataset poisoning detection (DataElixir / CopyrightShield techniques from literature).
- **Phase 5 (B4 CreativeHistory):** MEDIUM — hash-stamping injection points in upstream phases (script-generation, sts) without breaking v2.0 handlers.

**Standard patterns (skip research-phase):**
- **Phase 1 (D1):** LOW — pure refactor + string replacement; API docs straightforward.
- **Phase 2 (AssetBus):** Skip — well-documented v2.0 pattern; additive change.
- **Phase 3 (B5):** MEDIUM — ShotParallelScheduler contract for blacklisted return value needs code-reading.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | Most decisions align with already-shipped code; verified against `package.json` zero-deps principle, GLM/Seedance official docs, codebase integration points. Only Seedance 2.0 audio API surface is MEDIUM (pending operator confirmation). |
| Features | **MEDIUM-HIGH** | Official docs + industrial analogs (Kling O1, SkyReels V4) for table stakes. B4 creative_history is self-designed schema (no public AIGC provenance reference); B6 fine-tuning concept is HIGH but execution depends on operator workflow. |
| Architecture | **HIGH** | Every integration point is codebase-verified (read lib/pipeline.js, phases/index.js, asset-bus.js, character-asset-manager.js in full). v2.0 baseline contracts documented. |
| Pitfalls | **HIGH** | Code-grounded findings (continuity-auditor.js:386, hermes-adapter.js:91, etc.) + official docs + peer-reviewed research (ICML 2024, NeurIPS 2023, NDSS PRISM 2026). |

**Overall confidence:** **HIGH**

### Gaps to Address

- **GoldTeam API for Seedance 2.0 audio:** does `seedance_omni_reference_pro` task type exist? What are audio param names? Flag for operator consultation before Phase 4 implementation begins. Cannot be resolved by reading code.
- **GoldTeam DINOv2 embedding interface:** is the existing `task_type='dinov2_embedding'` stable and exposed for B2/B5 reuse? Assumed yes from `continuity-auditor.js` usage but needs operator confirmation for production volume.
- **GLM-4.6V response schema diff vs glm-4v-flash:** does it return same field names (`score`, `reasoning`)? Token cost delta? Needs API docs verification + golden-set baseline (50 image pairs) before D1 cutover.
- **LoRA training workflow operator contract:** v3.0 emits manifest; what format does operator's trainer expect? Kohya-ss dataset schema alignment needed.
- **pHash collision threshold on stylized AIGC faces:** empirical — needs labeled validation set construction during Phase 6.
- **ShotParallelScheduler return contract for blacklisted shots:** must distinguish "skipped" from "failed" — verify during Phase 3 implementation.

## Sources

### Primary (HIGH confidence)
- **Codebase (directly inspected):** `lib/pipeline.js`, `lib/phases/index.js` (cloud-production handler at :2962-3148, fingerprint placeholders at :285/:289, `_computeFaceEmbeddingHash`/`_computeCostumeFingerprint`), `lib/asset-bus.js` (ASSET_SCHEMA), `lib/character-asset-manager.js` (`getOmniReferencePack` at :241), `lib/hermes-client.js` (VALID_PHASES lockstep), `lib/evaluation-collector.js`, `lib/continuity-auditor.js` (`_tryDINOv2Embedding` at :412-441, `glm-4v-flash` at :398, bracketed-path prompts at :386/:475/:514), `lib/hermes-adapter.js` (`callLLM` at :91), `lib/quality-gate.js` (`glm-4.6v` at :152), `lib/gate-config.yaml` (`glm-4-flash` at :69), `package.json` (zero-deps principle).
- **Seedance 2.0 API official docs** — https://www.volcengine.com/docs/82379/1520757 [field definitions, `generate_audio`, `audio_url`, `reference_audio` role, duration/size limits].
- **GLM-4.6V official docs** — https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v + https://docs.z.ai/guides/vlm/glm-4.6v [API examples, `thinking` parameter, `image_url/video_url/file_url` content type, OCR/Image2Prompt/Function Call capabilities].
- **Peer-reviewed research (fine-tuning poisoning):** ICML 2024 SilentBadDiffusion, NeurIPS 2023 Copyright Breaches, ICCV 2025 CopyrightShield, AAAI-24 DataElixir.
- **Peer-reviewed research (perceptual hash):** UIUC Gang et al. (false negatives in PHashing), Idiap Kotwal (makeup-as-aging attacks).
- **Peer-reviewed research (provenance):** NDSS PRISM 2026 (dependency explosion), ITM Conferences 2024.

### Secondary (MEDIUM-HIGH confidence)
- **Kling O1 Element Library release note** — https://kling.ai/release-note/release-notes/u3o4p73f2h
- **SkyReels V4 arXiv paper** — https://arxiv.org/html/2602.21818v1
- **GeNIe (Hard Negative Mining, arXiv 2312.02548)** — ECCV 2020 hard negative evidence.
- **NVIDIA Data Flywheel Blueprint** + arXiv 2510.06674 (AITL framework).
- **USD/Halie provenance metadata** — openusd.org + NVIDIA Developer Forums.
- **Seedance community reports** — Reddit r/generativeAI, Curious Refuge, CreatOK, Segmind, Crepal (audio binding requirement, multilingual limits, "2 re-roll rule").
- **Promptfoo red-team false-positive docs** — https://www.promptfoo.dev/docs/red-team/troubleshooting/false-positives/

### Tertiary (MEDIUM confidence)
- **GLM-4.6V release info** — IT之家 + ModelScope (release date, MoE 106B-A12B architecture, 50% price drop, open-source).
- **kohya_ss / OneTrainer GitHub** + LoRA Training Guide 2026 (sanj.dev).
- **DINOv2 vs CLIP comparison** — Meta AI blog + arXiv 2304.07193 + CVPR 2025 poster.
- **hnswlib-wasm vs faiss-node** — NPM + Hacker News community consensus.

---
*Research completed: 2026-06-22*
*Ready for roadmap: yes*
