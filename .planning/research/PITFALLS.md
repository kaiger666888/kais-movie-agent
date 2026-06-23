# Pitfalls Research

**Domain:** Adding v3.0 industrial pipeline features (Seedance AV sync, cross-episode reuse, creative history, bad case, fine-tuning, GLM-4.6V upgrade) to an existing v2.0 degraded-first AIGC movie pipeline
**Researched:** 2026-06-22
**Confidence:** HIGH (code-grounded findings + official docs + peer-reviewed research)

This document is scoped to **integration pitfalls** — mistakes made when bolting v3.0 capabilities onto the existing v2.0 pipeline. It deliberately preserves the v2.0 stability strengths (three-layer degrade chain, idempotent `.pipeline-state.json`, CompositionEngine shell-injection safety, Hermes fire-and-forget audit, <5s degraded E2E) and flags every place a v3.0 feature could silently break one of them.

Code references use absolute paths so downstream phase planners can grep them.

---

## Critical Pitfalls

### Pitfall 1: Seedance 2.0 audio reference is silently ignored when prompt does not bind it

**What goes wrong:**
Seedance 2.0 omni_reference mode accepts up to 3 audio files, but the model "aggressively prioritizes the background noise of a video file and completely ignores your seamlessly uploaded MP3" when the prompt does not explicitly bind the audio (e.g. `@Audio1 for lip-sync`). The generated video then has either silence or hallucinated audio, and the lip-sync drifts or never engages.

**Why it happens:**
The current `cloud-production` handler at `/data/workspace/kais-movie-agent/lib/phases/index.js:3061` submits a task with `identity_refs / scene_refs / action_refs` but **no audio field and no prompt binding syntax**. The existing `getOmniReferencePack()` in `/data/workspace/kais-movie-agent/lib/character-asset-manager.js:241` returns `{ identityImages, sceneImages, actionVideos }` — there is no `audioRefs` slot. Engineers who add audio by simply extending the params object will discover the model accepts the request, returns a video, and the lip-sync is simply absent — there is no error, no warning.

**Consequences:**
- v3.0 A2 ships claiming "audio-driven lip sync" but Layer-2 runs produce unsynchronized videos.
- Failure is invisible in degraded mode (handler writes stub regardless) — only surfaces in real GPU runs (B-1).
- Debugging loop is expensive: each Seedance call costs real GPU time (~minutes per shot).

**How to avoid:**
1. Require explicit `@Audio1` binding in the prompt string — make `getOmniReferencePack()` accept an `audioRefs` array and have it emit bindings like `@Audio1 提供对白音频（口型同步基准，严格遵守）`.
2. Validate at submission time: if `taskType === 'seedance_omni_reference'` and `audio_refs` is non-empty but the prompt contains no `@Audio` token, **throw** rather than submit.
3. Document the bitrate floor: reference audio below 128 kbps produces poor phoneme detection (community-reported). Reject sub-128kbps WAVs at the handler boundary.
4. Split long dialogue into ≤10s segments — timing drift accumulates past 10s.
5. One audio file per speaking character; describe turn-taking in the prompt for multi-speaker scenes.

**Warning signs:**
- Generated video has correct character identity but closed-mouth / random mouth movement.
- Audio waveform in output does not correlate with the reference audio.
- `video_tasks.json` shows `status: completed` but QA spot-check finds sync issues.

**Phase to address:**
v3.0 Phase A2 (Seedance 2.0 omni_reference + audio). Verification: Layer-2 GPU run with a known audio clip, manual frame-check that lip movement correlates with phonemes. Do not mark A2 complete on degraded-mode evidence alone.

---

### Pitfall 2: Seedance 2.0 multilingual / multi-speaker lip-sync silently underperforms

**What goes wrong:**
Seedance 2.0 lip-sync is English-biased. Community reports confirm it "does not work correctly" for many non-English languages, and multi-speaker scenes (2-3 characters) are "significantly harder" — timing drift, crosstalk bleed, and mismatched speaker-to-mouth assignment are common. For a Chinese-language short-drama pipeline (`audience_platform: 'douyin'` per `HERMES_DEFAULTS`), this is the primary use case, not an edge case.

**Why it happens:**
- The phoneme model is trained predominantly on English; Chinese pinyin/syllable density maps poorly.
- Multi-speaker scenes require the model to attribute audio segments to specific on-screen characters — this is an open research problem, not a solved one.
- Marketing claims ("8+ languages supported") conflict with practical reports ("5 languages for accurate lip sync") — the reliable surface is narrower than docs suggest.

**Consequences:**
- Chinese dialogue scenes (the default for this project) produce lip movements that don't match Chinese phonemes.
- 2-character dialogue scenes (common in short drama) produce lip-sync on the wrong character or on both characters simultaneously.
- The pipeline's `delivery` phase `lip_sync_threshold: 1` (100%) in `HERMES_DEFAULTS` is unachievable for Chinese dialogue — the gate will either always fail or be silently bypassed.

**How to avoid:**
1. **Do not enable native Seedance lip-sync for Chinese dialogue by default.** Keep the v2.0 path (TTS → separate lip-sync tool) as the primary; treat Seedance native sync as an opt-in enhancement for English content.
2. For Chinese content, decompose to single-speaker shots wherever possible — split multi-speaker scenes into over-the-shoulder shots so each Seedance call has exactly one mouth to sync.
3. Relax `delivery.lip_sync_threshold` from `1` (impossible) to a measurable target (e.g. `0.85`) — and back it with a real measurement (audio-video correlation metric), not a human gate.
4. Add a language-detection check: if `script-lock` determines the dialogue language is non-English and non-Mandarin-supported, emit a warning and route through the legacy lip-sync path.

**Warning signs:**
- Chinese dialogue shots consistently flagged for re-generation in QA.
- Multi-speaker shots require 3+ retries (the community "2 re-roll rule": if it fails twice, the source is the problem).
- Lip-sync quality varies wildly shot-to-shot with no parameter change.

**Phase to address:**
v3.0 Phase A2 (implementation) + Phase D1 (scoring). A real AV-sync metric must exist before A2 can be marked complete — otherwise there is no way to distinguish "lip-sync worked" from "lip-sync was skipped."

---

### Pitfall 3: Cross-episode fingerprint matching produces false negatives on makeup/aging/wardrobe, false positives across lookalikes

**What goes wrong:**
The v2.0 placeholder `face_embedding_hash = SHA-256(path)` (`/data/workspace/kais-movie-agent/lib/phases/index.js:285`) and `costume_fingerprint = SHA-256(path-list)` (`:289`) are **path hashes, not perceptual hashes** — they change if the same image is saved to a different filename. When v3.0 Phase B2 upgrades these to real perceptual hashes for cross-episode reuse, two failure modes appear:

- **False negatives** (same character, no match): makeup changes, prosthetics, aging across a long series, camera angle/lighting drift, post-processing color grading — all drop the similarity score below threshold. The actor is not recognized and a new asset set is generated, defeating the reuse goal.
- **False positives** (different characters, match): two characters played by similar-looking actors, or the same actor in a dual role, get merged into one asset set. The wrong L1 anchor propagates and every downstream shot inherits the wrong face.

**Why it happens:**
Perceptual hashes (pHash, dHash, DINOv2 embeddings) reduce an image to a small bit-vector — this is inherently lossy. Academic literature confirms "perceptual hashes can easily produce false negatives" ([Gang et al., UIUC](https://gangw.cs.illinois.edu/PHashing.pdf)) and makeup-as-aging-attacks are specifically hard to distinguish from genuine aging ([Kotwal, Idiap](https://publications.idiap.ch/downloads/papers/2019/Kotwal_IEEETRANS.BIOM-2_2019.pdf)). The cross-episode setting amplifies this: the delta between EP01 and EP12 of a series can be larger (makeup evolution, wardrobe refresh) than the delta between two different characters in the same episode.

**Consequences:**
- **False positive is catastrophic**: wrong L1 anchor → every shot in the new episode has the wrong face → entire episode must be regenerated. Recovery cost = full pipeline rerun.
- **False negative is silent waste**: reuse library misses the match → generates fresh assets → v3.0 B2 reports "0% reuse rate" and the team assumes the feature is broken.
- Underlying v2.0 risk: `_computeFaceEmbeddingHash` is called in `_generateL1Anchors` (`:374`) and the hash is stored in manifests read by `continuity-auditor._getApprovedL1Anchors`. Changing the hash function changes every stored hash — old manifests become uncomparable.

**How to avoid:**
1. **Two-stage matching**: perceptual hash for fast candidate retrieval (top-K), then DINOv2 cosine similarity for confirmation. Never match on perceptual hash alone.
2. **Human-in-the-loop gate for cross-episode reuse**: the first time a character is matched across episodes, require explicit approval (reuse the existing `review` mechanism). Only auto-reuse after an approved match.
3. **Version the hash**: store `{ algorithm: "dinov2-v1", embedding: [...] }` in manifests, not bare hashes. Reject cross-manifest comparison when algorithms differ.
4. **Threshold calibration**: do not ship a threshold (e.g. 0.85) without a labeled evaluation set of ≥50 same-character and ≥50 different-character pairs. The right number is empirical, not theoretical.
5. **Never auto-merge** two character asset sets based on fingerprint alone — always require a secondary signal (same `character.name`, same actor metadata, or human confirmation).

**Warning signs:**
- Cross-episode reuse rate is either 0% (false negatives) or 100% (false positives) — both indicate a broken matcher.
- Same actor in different roles gets consolidated into one character.
- A character's face "drifts" episode-to-episode despite L1 anchor reuse (indicates the wrong anchor was selected).

**Phase to address:**
v3.0 Phase B2 (CharacterAssetManager cross-episode fingerprint index). Must include a labeled evaluation harness before shipping — this is a research-grade matching problem, not an engineering task.

---

### Pitfall 4: `creative_history` trace graph suffers dependency explosion — O(shots × trace_depth) on every script edit

**What goes wrong:**
v3.0 Phase B4 requires "改剧本自动定位受影响镜头" (script edit → automatically locate affected shots). The naive implementation builds a forward-dependency graph: `script_line → shot → video → episode`. When a script line changes, you traverse the graph to find affected shots. At series scale (e.g. 24 episodes × 60 shots × 8 script lines each = 11,520 edges), the "blast radius" of a single script edit can touch hundreds of shots — and re-running those shots invalidates downstream consistency audits, quality gates, and cost reports, triggering a cascading recompute.

The provenance-research literature calls this **"dependency explosion"**: "coarse-grained audit logs... generate false causal relationships" and "Windows devices have a long tail of highly connected services processes that exacerbate the dependency explosion of provenance analysis" ([NDSS PRISM 2026](https://www.ndss-symposium.org/wp-content/uploads/prism2026-12.pdf), [ITM Conferences 2024](https://www.itm-conferences.org/articles/itmconf/pdf/2024/03/itmconf_aiss2024_00016.pdf)). The same pathology applies to creative asset graphs.

**Why it happens:**
- Every shot depends on multiple script lines, character anchors, scene geometry, and audio stems — the graph is dense, not tree-shaped.
- A single character description change (e.g. "主角发型改为短发") transitively affects every shot containing that character — potentially the entire episode.
- The v2.0 pipeline already stores `.pipeline-state.json` with per-phase results; adding a trace layer on top without lazy evaluation means every read traverses the full graph.

**Consequences:**
- "Locate affected shots" returns 80%+ of the episode for any meaningful script change — the feature becomes useless because the answer is always "rerun everything."
- Performance: synchronous graph traversal on every `script-lock` edit makes the interactive review loop unusable (>10s response).
- State invalidation cascades: changing one shot invalidates its consistency audit, which invalidates the episode quality report, which invalidates the cost report — the entire v2.0 idempotency model breaks if trace edges are not versioned.

**How to avoid:**
1. **Lazy / on-demand traversal**: do not materialize the full trace graph. Store edges in `.creative-history.jsonl` (append-only log) and compute blast-radius only when explicitly queried.
2. **Coarse-grained invalidation**: tag shots with `{ episode, scene_id, character_ids }` — when a script line changes, invalidate at scene granularity, not shot granularity. Most edits don't require shot-level precision.
3. **Version stamps, not references**: store `{ shot_id, source_hash }` pairs. A shot is "affected" only if its `source_hash` differs from the current script hash — not if it's transitively reachable.
4. **Cap blast radius**: if an edit affects >N shots (configurable, default 20), prompt the user to scope the edit rather than auto-invalidating.
5. **Never block the pipeline on trace computation** — it must be a query tool, not a gate. The v2.0 principle "Hermes audit fire-and-forget" applies here.

**Warning signs:**
- `script-lock` edit response time grows linearly with episode count.
- "Affected shots" list is consistently >50% of total shots.
- Users start ignoring the trace feature because "it always says rerun everything."

**Phase to address:**
v3.0 Phase B4 (creative_history trace chain). The blast-radius query must have a documented performance budget (e.g. <500ms for a 24-episode series) and a test that proves it.

---

### Pitfall 5: Bad-case blacklist over-matching rejects reasonable prompts, pipeline appears "broken"

**What goes wrong:**
v3.0 Phase B5 persists failed-shot patterns to a blacklist and rejects matching prompts at generation time. Naive implementations (substring match, regex alternation, keyword lists) over-match: a blacklist entry for `"bloody violence"` rejects `"bloody mary cocktail"`, `"violins in background"` matches `"violence"`, and a pattern anchored on a specific failure mode (e.g. `"night scene with rain"`) rejects every legitimate night-rain scene. The pipeline starts failing on prompts that should work, and users perceive the system as broken.

**Why it happens:**
- Keyword/regex blacklists have no semantic understanding — `"violence"` as a substring matches `"violins"`.
- Failed-shot patterns are specific to a context (model version, character, scene) but get stored as universal rules.
- There is no canonical "failed pattern" representation — engineers reach for the simplest thing that works (string match) and it works on the test case but over-matches in production.
- The LLM-safety literature documents this as the **"alignment tax" / over-refusal problem** — overly strict classifiers refuse benign inputs. Promptfoo's red-team docs explicitly address "[preventing false positives](https://www.promptfoo.dev/docs/red-team/troubleshooting/false-positives/)" because it is the dominant failure mode.

**Consequences:**
- Legitimate shots silently fail to generate; the pipeline appears to hang or produce empty output.
- Users add ever-more-specific carveouts to the blacklist, creating a maintenance treadmill.
- The blacklist grows monotonically (shots are added on failure, never removed on success) → over-matching worsens over time.
- Degraded mode hides the problem: the handler writes a stub regardless, so the over-matching is invisible until Layer-2 GPU runs.

**How to avoid:**
1. **Semantic matching, not lexical**: store failed patterns as embeddings (DINOv2 or text-embedding) and match by cosine similarity with a high threshold (≥0.92). Substring/regex matching is unacceptable for prompt-sized inputs.
2. **Store context, not just pattern**: a blacklist entry must include `{ pattern, model_version, character_id, scene_id, failure_mode, timestamp }`. Match only when context also aligns — a failure with Seedance 1.0 is not a failure with Seedance 2.0.
3. **TTL / decay**: blacklist entries expire after N successful generations of a similar prompt (e.g. 30 days or 50 successes). The blacklist must be self-cleaning.
4. **Soft block, not hard reject**: on match, log a warning and require a human confirmation (via the existing review platform) rather than silently rejecting. Never hard-block without an audit trail.
5. **Precision metric**: track `false_rejection_rate` (how many blocked prompts were actually fine). If it exceeds 5%, the blacklist thresholds need recalibration.
6. **Test the blacklist against a golden set** of known-good prompts before each deployment — a regression test that fails if any good prompt is rejected.

**Warning signs:**
- Generation success rate drops over time as the blacklist grows.
- Users report "the pipeline worked yesterday but not today" with no code change (blacklist grew overnight).
- Blacklist size grows monotonically; no entries are ever removed.

**Phase to address:**
v3.0 Phase B5 (bad-case library + generation-time blacklist). Must ship with a false-positive evaluation harness and a TTL mechanism — not just the blacklist itself.

---

### Pitfall 6: Fine-tuning data pipeline poisons the model with copyright/PII/backdoors — silently and irreversibly

**What goes wrong:**
v3.0 Phase B6 routes failed shots → Hermes audit → data回流 → LoRA / prompt-template fine-tuning. Three failure modes, all silent:

1. **Copyright infringement backdoor**: poisoned fine-tuning data causes the model to reproduce copyrighted images when triggered. ICML 2024 ("The Stronger the Diffusion Model, the Easier the Backdoor") and NeurIPS 2023 ("Data Poisoning to Induce Copyright Breaches") both demonstrate that **more capable diffusion models are more susceptible** to this attack — a finished LoRA can be triggered to emit memorized copyrighted content, creating legal liability that surfaces only after deployment.

2. **PII leakage**: failed-shot diagnostics often contain user-specific data (actor names, project codenames, internal review feedback). Fine-tuning on this bakes the PII into model weights — it can be extracted via membership inference attacks.

3. **Concept drift / regression**: fine-tuning on "failed" cases optimizes for the failure mode if the labels are wrong. A shot that failed for lighting reasons but was labeled as "character identity issue" teaches the LoRA the wrong lesson — and every subsequent generation inherits the regression.

**Why it happens:**
- The data回流 loop has no human review gate between "failed shot" and "training data." Engineers treat failed shots as automatically-labeled training data.
- Copyright status of AI-generated content is legally ambiguous; the pipeline does not track provenance licenses of input references.
- PII is not scrubbed from prompt metadata before it enters the training corpus.
- LoRA fine-tuning is opaque — there is no automatic regression test against a held-out golden set.

**Consequences:**
- **Copyright**: deployed model reproduces a licensed character/image → legal takedown, platform ban (Douyin/B站 have strict AIGC provenance rules).
- **PII**: actor real names or internal project codenames leak through model outputs.
- **Regression**: a LoRA trained on mislabeled failures degrades output quality globally; rollback requires retraining (days of GPU time).
- **Irreversibility**: once a LoRA is merged into the base model, the poison is baked in — you cannot "delete" a concept from model weights.

**How to avoid:**
1. **Mandatory human review gate** between Hermes audit and training corpus. Every sample must be labeled `{ copyright_status, pii_scrubbed, label_correct, approved_for_training }` by a human before it enters the dataset. This is non-negotiable.
2. **Copyright provenance tracking**: every reference image fed into the pipeline must carry a `license` field. Reject unlicensed inputs at the `character-generation` boundary. Do not fine-tune on outputs derived from unlicensed references.
3. **PII scrubbing pipeline**: before any artifact enters the training corpus, run automated PII detection (actor names → "ACTOR_1", project codenames → "PROJECT_X"). Log what was scrubbed.
4. **Golden-set regression test**: maintain a frozen set of 50-100 "known-good" prompts with expected outputs. Before merging any LoRA, run the golden set — if quality drops on any sample, block the merge.
5. **DataElixir-style dataset purification**: the literature ([AAAI-24](https://ojs.aaai.org/index.php/AAAI/article/view/30186/32105), [ICCV 2025 CopyrightShield](https://openaccess.thecvf.com/content/ICCV2025/papers/Guo_CopyrightShield_Enhancing_Diffusion_Model_Security_Against_Copyright_Infringement_Attacks_ICCV_2025_paper.pdf)) provides techniques to detect and remove poisoned samples — adopt one before shipping B6.
6. **LoRA is never auto-deployed**: a fine-tuned adapter goes to staging, runs the golden set, gets human sign-off, and only then promotes to production. Never close the loop automatically.
7. **Provenance watermarking**: tag every fine-tuned output with C2PA-style provenance metadata so downstream platforms can verify the training lineage.

**Warning signs:**
- Golden-set quality score drops after a LoRA merge (catches regression).
- Model outputs begin resembling a specific licensed character not in the prompt (catches copyright memorization).
- Training corpus contains raw actor names, file paths with usernames, or internal review text (catches PII).

**Phase to address:**
v3.0 Phase B6 (data回流 fine-tuning闭环). This is the highest-risk phase in v3.0 — it must include a human review gate, a golden-set regression harness, and a PII scrubber as **launch blockers**, not follow-ups.

---

### Pitfall 7: GLM-4.6V upgrade breaks scoring because prompts embed file paths as text, not `image_url` content blocks

**What goes wrong:**
The v2.0 `continuity-auditor.js` builds prompts like:

```javascript
prompt: `对比以下生成图与角色身份锚点的面部一致性。
身份锚点(角色标准外观): [${anchorPath}]
待检查生成图: [${imagePath}]`
```

(See `/data/workspace/kais-movie-agent/lib/continuity-auditor.js:386-387`, `:475`, `:514`.)

This embeds the **file path as a string** inside the prompt. GLM-4V-Flash tolerated this (likely server-side path resolution by Hermes, or it scored without actually seeing the image). GLM-4.6V's official API ([Z.AI docs](https://docs.z.ai/guides/vlm/glm-4.6v)) requires structured content blocks:

```json
{ "type": "image_url", "image_url": { "url": "..." } }
```

A bare `model: 'glm-4v-flash' → 'glm-4.6v'` string swap will cause the model to receive a prompt containing bracketed file paths and **no actual image** — it will hallucinate a score based on the text (filename hints like "protagonist_front_face.png"), or return a low-confidence default. The quality gate then passes or fails on noise.

**Why it happens:**
- `callLLM` in `/data/workspace/kais-movie-agent/lib/hermes-adapter.js:91` accepts a `prompt` string and builds `messages: [{ role: 'user', content: prompt }]` — it has no support for content-block arrays.
- The model name is hardcoded in 5 places across the codebase with **3 different versions already**:
  - `continuity-auditor.js:398` → `'glm-4v-flash'`
  - `quality-gate.js:152` → `'glm-4.6v'` (already on the new model!)
  - `gate-config.yaml:69` → `'glm-4-flash'` (text-only, not even a vision model)
  - `scripts/anatomy-validator.py:32` → `'glm-4.6v'`
  - `scripts/scene-evaluator.py:40` → `'glm-4.6v'`
- A developer who "upgrades GLM-4V to GLM-4.6V" by search-replacing the model string will hit this silently — the API returns 200, the JSON parses, the score is just wrong.

**Consequences:**
- Identity consistency scoring (`identity_match` dimension) returns text-guessed scores, not visual scores — the entire QUAL-01/QUAL-03 remediation from v2.0 unravels.
- Quality gate (`quality-gate.js` already uses `glm-4.6v` but passes prompts the same way) may already be silently degraded.
- The `null-on-failure` contract (v2.0 QUAL-01 fix) does not catch this — the model returns a valid-looking JSON score, so no null fallback triggers.
- Tests running against the 401 path (W-3 in the audit) will not catch this — they never reach the scoring logic.

**How to avoid:**
1. **Refactor `callLLM` first, change model names second.** Add support for `content: [{type:'text',...},{type:'image_url',...}]` arrays in `hermes-adapter.js`. Add a `vision(prompt, images[])` helper that constructs the proper content blocks. Do not change any `model:` string until this helper exists.
2. **Centralize the model name**: single env var `ZHIPU_VISION_MODEL` (default `'glm-4.6v'`) read in one place. Eliminate the 5 hardcoded copies.
3. **Migration script for stored hashes**: if GLM-4.6V returns different score distributions than 4V-Flash (likely — different model), the `_scoreCache` in `continuity-auditor.js:214` contains stale entries keyed on the old model. Invalidate the cache on model change.
4. **Golden-set scoring baseline**: before cutover, run 50 known image-pairs through both GLM-4V-Flash and GLM-4.6V. If scores diverge by >0.1 on any pair, investigate — the threshold `0.85` in `DIMENSIONS` (`:25`) may need recalibration.
5. **Verify the `thinking` parameter**: GLM-4.6V supports `thinking: {type: 'enabled'}` for chain-of-thought. For scoring tasks where determinism matters, you may want to disable this (it introduces variance). For complex audits (structural consistency), it may help. Make this per-call, not global.
6. **Test against a real API key before merge** — this is the W-3 item from the v2.0 audit, and it is now a blocker for D1.

**Warning signs:**
- After the model swap, `identity_match` scores cluster around a single value (e.g. everything is 0.7-0.8) — indicates text-guessing, not visual analysis.
- Score distribution shifts dramatically even though input images are unchanged.
- Quality-gate pass rate jumps to ~100% (model is permissive on text alone) or drops to ~0% (model is confused by path text).

**Phase to address:**
v3.0 Phase D1 (GLM-4.6V upgrade). **D1 must precede or run in parallel with any feature that relies on scoring quality** (A2 verification, B2 fingerprint matching, B5 bad-case evaluation). Shipping D1 as "just change the model string" is the most likely single failure in v3.0.

---

### Pitfall 8: New v3.0 modules skip the three-layer degrade chain, breaking the <5s E2E promise

**What goes wrong:**
v2.0's core stability comes from the three-layer degrade chain (service / task / phase level) and `.pipeline-state.json` idempotency. Every v2.0 handler follows the pattern: try the real service → on failure, write a stub with `_degraded: true` → save state → continue. New v3.0 modules (CharacterAssetManager cross-episode index, creative-history trace, bad-case matcher, fine-tuning data回流) are I/O-heavy features that can hang or crash in ways the v2.0 modules don't.

Specific risks:
- **Cross-episode fingerprint index** (B2): if the index lives in a separate store (SQLite, vector DB), that store can be unavailable. Without a degrade path, `getReferencePack()` throws → `cloud-production` aborts → pipeline stops.
- **Creative-history trace** (B4): if the trace is written synchronously in-phase, a disk-full or permissions error aborts the phase.
- **Bad-case matcher** (B5): if the matcher is called as a gate before `cloud-production`, a matcher crash blocks all generation.
- **Fine-tuning data回流** (B6): if the data upload hangs, Hermes audit (currently fire-and-forget) becomes a blocking dependency.

**Why it happens:**
- Engineers model new features as "infrastructure" (always available) rather than "external services" (sometimes unavailable).
- v2.0 degrade pattern is implicit (copy-pasted between handlers) — there is no enforced base class or lint rule requiring it.
- Degraded-mode E2E test (`test/e2e/pipeline-degraded-e2e.test.mjs`) only exercises the 20 existing phases; new modules are invisible to it unless explicitly wired.

**Consequences:**
- The <5s degraded E2E promise (a v2.0 headline achievement) silently breaks.
- A single unavailable v3.0 module (e.g. vector DB for fingerprints) makes the entire pipeline non-functional in production, even though v2.0 ran fine without that module.
- `.pipeline-state.json` idempotency breaks if new modules write state outside the standard phase-state schema — resume after crash produces inconsistent state.

**How to avoid:**
1. **Every new v3.0 module must declare a degrade contract**: `{ critical_path: boolean, fallback_behavior: string }`. If `critical_path: false`, the module must be wrapped in try/catch and the pipeline must proceed without it.
2. **CharacterAssetManager cross-episode index** must degrade to "no reuse, generate fresh" — never block the pipeline on a fingerprint lookup.
3. **Creative-history trace** must be append-only fire-and-forget (like Hermes audit) — a trace write failure logs a warning and continues.
4. **Bad-case matcher** must default-open: on matcher unavailable, allow the generation (log a warning). Better to over-generate than to block the pipeline.
5. **Fine-tuning data回流** must be an async queue, not inline — the pipeline phase returns immediately and the data upload happens in a worker.
6. **Extend the degraded E2E test** to cover every new module: simulate each one failing and assert the pipeline still completes in <5s.
7. **`.pipeline-state.json` schema versioning**: any new state fields must be additive and optional. The `_migrateV2State` pattern in `pipeline.js:221` must be extended for v3.0 fields.

**Warning signs:**
- Degraded-mode E2E test time grows beyond 5s.
- Pipeline fails in production but passes in CI (CI doesn't simulate the new module's failure modes).
- `.pipeline-state.json` accumulates fields that aren't in the migration map.

**Phase to address:**
**Every v3.0 phase** must include a "degrade contract" in its success criteria. The phase-18 closure pattern (`_stub: true` + `_degraded_reason`) should be the template — no new module ships without a documented degrade path and a test that exercises it.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Model name hardcoded per-file (5 copies, 3 versions) | Fast iteration during v2.0 | GLM-4.6V upgrade requires touching 5 files; drift between them silently breaks scoring | **Never for v3.0** — centralize before D1 |
| `face_embedding_hash = SHA-256(path)` placeholder | Avoids image-hash lib dependency in v2.0 | Every stored hash becomes invalid when upgraded to perceptual hash; old manifests uncomparable | v2.0 only — B2 must replace and version-stamp |
| Substring blacklist for bad-case prompts | Simple to implement, catches exact repeats | Over-matches, grows monotonically, never self-cleans | **Never** — use semantic matching from day 1 |
| Fine-tuning on auto-labeled failed shots | Closes the data loop without human cost | Mislabels poison the LoRA; copyright/PII liability baked into weights | **Never** — human review gate is mandatory |
| Synchronous creative-history trace writes | Simpler implementation, immediate consistency | Disk I/O blocks phase; full-graph traversal slow at scale | MVP only — move to async append-only log before scale |
| Perceptual hash threshold picked by gut (0.85) | Avoids building an evaluation set | Either over-merges (false positives, catastrophic) or under-merges (false negatives, wasted compute) | **Never** — calibrate empirically on labeled data |
| GLM-4V→4.6V model string swap without content-block refactor | Appears to work (API returns 200) | Scoring runs on text-guessed file paths, not images; quality gate silently degrades | **Never** — refactor `callLLM` first |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Seedance 2.0 omni_reference | Upload audio without `@Audio1` prompt binding | Bind every reference explicitly in prompt; reject submission if audio present but unbound |
| Seedance 2.0 multi-speaker | Single audio for multi-speaker scene | One audio per character; split scene into single-speaker shots for Chinese dialogue |
| Seedance 2.0 bitrate | Accept any WAV/MP3 | Reject <128kbps; warn <192kbps; split clips >10s |
| GLM-4.6V vision API | Pass image as `[path]` string in prompt text | Pass as `{type:'image_url', image_url:{url}}` content block; refactor `callLLM` first |
| GLM-4.6V `thinking` param | Enable globally for "smarter" outputs | Per-call: disable for deterministic scoring, enable for complex audits |
| Cross-episode fingerprint | Match on perceptual hash alone | Two-stage: hash for retrieval, DINOv2 for confirmation; human gate on first match |
| Cross-episode fingerprint | Compare old manifests (path-hash) to new (perceptual) | Version-stamp hashes; reject cross-algorithm comparison |
| Bad-case blacklist | Substring/regex match | Embedding cosine similarity with high threshold (≥0.92) + context match |
| Fine-tuning data回流 | Auto-label failed shots as training data | Human review gate with copyright/PII/label checks before corpus admission |
| Hermes audit (v2.0 strength) | Make v3.0 features block on Hermes response | Keep fire-and-forget; v3.0 modules must not turn Hermes into a synchronous dependency |
| gold-team Seedance task | Assume `task_type: 'seedance_omni_reference'` supports audio | Verify gold-team service-side support before wiring audio_refs; task_type support is operator-dependent (v2.0 audit flagged this as "unknown") |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Creative-history full-graph traversal on every script edit | `script-lock` response time grows linearly with episode count | Lazy/on-demand traversal; append-only log; scene-granularity invalidation | >12 episodes |
| Cross-episode fingerprint index scan | Asset lookup time grows with character count | Vector index (not linear scan); cache lookups | >50 characters |
| Bad-case blacklist linear scan | Generation pre-check grows with blacklist size | Embedding index (FAISS/Annoy); TTL-based pruning | >1000 entries |
| Synchronous fine-tuning data upload | Pipeline phase blocks on network I/O | Async queue; fire-and-forget like Hermes audit | Always — never inline |
| `_scoreCache` invalidation storm on GLM model change | First run after model swap re-scores everything (API cost spike) | Version-stamp cache entries by model; warm the cache before cutover | At D1 cutover |
| Trace edges stored in `.pipeline-state.json` | State file grows unboundedly; load/save slow | Separate `.creative-history.jsonl` append-only log | >24 episodes |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Fine-tuning on unlicensed reference images | Copyright infringement lawsuit; platform ban (Douyin/B站 AIGC provenance rules) | Provenance license tracking; reject unlicensed inputs at character-generation boundary |
| Fine-tuning on actor real names / project codenames in prompt metadata | PII baked into weights; extractable via membership inference | Automated PII scrubber before corpus admission; log scrubbing actions |
| Poisoned failed-shot dataset (SilentBadDiffusion attack) | Deployed model reproduces copyrighted content on trigger — liability surfaces post-deployment | DataElixir-style dataset purification; golden-set regression test before LoRA merge |
| Bad-case blacklist stored in plaintext with internal failure diagnostics | Blacklist leak reveals internal model weaknesses / prompt patterns | Encrypt at rest; restrict access; scrub diagnostics before storage |
| Cross-episode fingerprint index contains actor face embeddings | Biometric data — falls under GDPR/PIPL if EU/CN actors involved | Hash embeddings (not reversible); access-control the index; document retention policy |
| GLM-4.6V `thinking` mode logs chain-of-thought with image URLs | Internal asset URLs leak in logs; CoT may reveal proprietary evaluation criteria | Disable thinking mode for production scoring; redact URLs in log pipeline |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| "Affected shots" trace returns 80%+ of episode | Users ignore the feature; manual rerun tracking returns | Cap blast radius; prompt user to scope edits; scene-granularity default |
| Bad-case blacklist silently rejects prompts | Users perceive system as broken; no feedback on why | Soft-block with explicit reason + human-override path; surface in review UI |
| Cross-episode reuse merges two different characters | Wrong face propagates entire episode; catastrophic rework | Human-in-the-loop on first cross-episode match; never auto-merge |
| GLM-4.6V scoring variance confuses creators | Same shot scores differently across runs (thinking mode on) | Deterministic mode for scoring; document variance; provide confidence intervals |
| Fine-tuned LoRA degrades golden-set outputs | "The model got worse after the update" with no rollback path | Staged rollout; golden-set regression gate; instant rollback to previous adapter |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces — verify each before marking a v3.0 phase complete:

- [ ] **Seedance AV sync (A2):** Often missing `@Audio` prompt binding — verify with a real GPU run that lip movement correlates with audio phonemes (not just that the API returned 200)
- [ ] **Seedance multi-speaker (A2):** Often missing per-character audio routing — verify each character's mouth matches their own audio, not the other's
- [ ] **Cross-episode fingerprint (B2):** Often missing hash version-stamping — verify old manifests either migrate cleanly or are rejected, not silently mis-compared
- [ ] **Cross-episode fingerprint (B2):** Often missing false-positive evaluation — verify a labeled same-character/different-character set was tested before shipping
- [ ] **Creative history trace (B4):** Often missing blast-radius cap — verify that a single-line script edit doesn't invalidate >20 shots without user confirmation
- [ ] **Creative history trace (B4):** Often missing performance budget — verify <500ms query response at 24-episode scale
- [ ] **Bad-case blacklist (B5):** Often missing TTL/decay — verify the blacklist does not grow monotonically; entries expire after success
- [ ] **Bad-case blacklist (B5):** Often missing false-rejection metric — verify precision is tracked and <5%
- [ ] **Fine-tuning data回流 (B6):** Often missing human review gate — verify every sample is labeled `{copyright, pii, label_correct, approved}` by a human
- [ ] **Fine-tuning data回流 (B6):** Often missing golden-set regression test — verify the LoRA is blocked from merge if any golden sample regresses
- [ ] **GLM-4.6V upgrade (D1):** Often missing content-block refactor — verify `callLLM` was refactored, not just the model string swapped
- [ ] **GLM-4.6V upgrade (D1):** Often missing cache invalidation — verify `_scoreCache` is version-stamped by model and invalidated on cutover
- [ ] **GLM-4.6V upgrade (D1):** Often missing threshold recalibration — verify the 0.85 identity threshold was re-validated against the new model's score distribution
- [ ] **Degraded-mode (all phases):** Often missing per-module degrade contract — verify every new module has a documented fallback and a test exercising it
- [ ] **Degraded-mode (all phases):** Often missing <5s E2E regression — verify the degraded E2E test was extended and still passes <5s with v3.0 modules

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| GLM-4.6V scoring silently degraded (text-guessed scores) | MEDIUM | (1) Revert model string to `glm-4v-flash`; (2) refactor `callLLM` to support content blocks; (3) re-run golden-set scoring baseline; (4) re-cut over with cache invalidation |
| Cross-episode false positive (wrong face propagated) | HIGH | (1) Quarantine the affected episodes; (2) revert to pre-merge character asset state; (3) re-run fingerprint match with tighter threshold + human gate; (4) re-generate affected shots. Cost = full pipeline rerun for affected episodes |
| Cross-episode false negative (no reuse, wasted compute) | LOW | (1) Lower threshold; (2) add secondary matching signal (character name); (3) backfill the missed matches. No data lost, only compute wasted |
| Creative-history trace dependency explosion | MEDIUM | (1) Switch to lazy traversal; (2) add blast-radius cap; (3) rebuild trace index from `.pipeline-state.json` snapshots. No data regeneration needed |
| Bad-case blacklist over-matching | MEDIUM | (1) Disable blacklist (fail-open); (2) migrate to semantic matching; (3) back-test against golden prompts; (4) re-enable with precision monitoring |
| Fine-tuning copyright infringement (model emits licensed content) | HIGH | (1) Roll back LoRA immediately; (2) quarantine affected outputs; (3) audit training corpus for licensed material; (4) rebuild corpus with provenance tracking; (5) legal review before redeployment. LoRA cannot be "patched" — must retrain |
| Fine-tuning regression (golden-set quality drop) | MEDIUM | (1) Roll back to previous LoRA adapter; (2) investigate mislabeled samples in corpus; (3) add label-verification step; (4) retrain. Golden-set gate makes this detectable before deployment |
| Seedance audio ignored (lip-sync absent) | LOW | (1) Add `@Audio` prompt binding; (2) verify task_type supports audio_refs with gold-team operator; (3) re-submit shots. No architectural change |
| Seedance multi-speaker wrong-character sync | MEDIUM | (1) Split multi-speaker scenes into single-speaker shots; (2) re-submit. May require STS script revision |
| New v3.0 module breaks degraded E2E <5s | MEDIUM | (1) Identify the blocking module via per-module failure simulation; (2) add try/catch degrade wrapper; (3) extend E2E test; (4) re-verify <5s |

## Pitfall-to-Phase Mapping

How v3.0 roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Seedance audio ignored (P1) | Phase A2 | Real GPU Layer-2 run; manual frame-check of lip-sync vs audio waveform |
| Seedance multilingual/multi-speaker underperforms (P2) | Phase A2 + D1 | AV-sync metric; Chinese dialogue test set; relax `lip_sync_threshold` from 1 → measurable |
| Fingerprint false neg/pos (P3) | Phase B2 | Labeled evaluation set (≥50 same-char + ≥50 diff-char pairs); human gate on first cross-episode match |
| Creative-history dependency explosion (P4) | Phase B4 | Blast-radius cap test; <500ms query at 24-episode scale |
| Bad-case over-matching (P5) | Phase B5 | False-rejection metric <5%; golden-prompt regression test; TTL mechanism |
| Fine-tuning data poisoning (P6) | Phase B6 | Human review gate; golden-set regression harness; PII scrubber; copyright provenance tracking — all launch blockers |
| GLM-4.6V content-block breakage (P7) | **Phase D1 (must precede scoring-dependent features)** | Refactor `callLLM` to support content blocks; golden-set score baseline before/after; cache invalidation |
| New modules break degraded E2E (P8) | **Every phase** | Each phase's SC includes a degrade contract; extended degraded E2E test <5s |

**Phase ordering implication for the roadmap:**
- **D1 (GLM-4.6V upgrade) is a prerequisite, not a parallel workstream.** A2 verification, B2 fingerprint confirmation, B5 bad-case evaluation all depend on trustworthy visual scoring. Shipping them on a silently-broken GLM-4.6V migration produces false confidence.
- **B6 (fine-tuning) is the highest-risk phase** and should be scheduled with the most testing runway — a LoRA poisoning event is irreversible and can create legal liability.
- **P8 (degraded E2E) is a cross-cutting concern, not a phase** — every phase's success criteria must include a degrade contract row.

## Sources

### Codebase evidence (HIGH confidence — directly inspected)
- `/data/workspace/kais-movie-agent/lib/phases/index.js:285,289` — `SHA-256(path)` placeholder fingerprints
- `/data/workspace/kais-movie-agent/lib/phases/index.js:3061` — `seedance_omni_reference` taskType with no audio field
- `/data/workspace/kais-movie-agent/lib/character-asset-manager.js:241-281` — `getOmniReferencePack` returns identity/scene/action, no audio
- `/data/workspace/kais-movie-agent/lib/continuity-auditor.js:386-398,475,514` — prompts embed file paths as text, not `image_url` blocks; model hardcoded to `glm-4v-flash`
- `/data/workspace/kais-movie-agent/lib/hermes-adapter.js:91-115` — `callLLM` builds `content: prompt` string, no content-block support
- `/data/workspace/kais-movie-agent/lib/quality-gate.js:152` — already uses `glm-4.6v` (inconsistent with continuity-auditor)
- `/data/workspace/kais-movie-agent/lib/gate-config.yaml:69` — `glm-4-flash` (third model version, not even vision-capable)
- `/data/workspace/kais-movie-agent/lib/continuity-auditor.js:214` — `_scoreCache` not keyed by model version
- `/data/workspace/kais-movie-agent/.planning/v2.0-MILESTONE-AUDIT.md` — W-3 (GLM-4V real API key never validated), B-1 (no real GPU run)

### Official documentation (HIGH confidence)
- [GLM-4.6V Official Docs (Z.AI)](https://docs.z.ai/guides/vlm/glm-4.6v) — confirms `image_url` content-block format, `thinking` parameter, 128K context
- [ZhipuAI API Portal](https://open.bigmodel.cn/dev/api) — API reference

### Seedance community & workflow evidence (MEDIUM-HIGH confidence)
- [Reddit r/generativeAI — Seedance audio ignored](https://www.reddit.com/r/generativeAI/comments/1tqsvb5/) — "aggressively prioritizes background noise... completely ignore your uploaded MP3"
- [Instagram — Seedance multi-speaker lip-sync](https://www.instagram.com/p/DYA9mhQCdAE/) — "works only in english language, i tried with non english language, it does not work correctly"
- [Curious Refuge — Seedance 2.0 Omni review](https://curiousrefuge.com/blog/how-to-use-seedance-2-omni) — multi-speaker workflow, audio binding requirement
- [CreatOK — Seedance audio sync explained](https://www.creatok.ai/blog/seedance-2-audio-sync-explained-perfect-sync-technology/)
- [Segmind — Seedance 1.0 vs 2.0 comparison](https://blog.segmind.com/seedance-1-0-vs-2-0-which-video-model-should-you-choose/)
- [Facebook Seedance group — lip-sync workflow](https://www.facebook.com/groups/1405079694162137/posts/1452761399393966/) — "Use the WAV strictly as a timing reference only" prompt pattern
- [Crepal — Seedance 2.0 lip-sync voiceover fix](https://crepal.ai/blog/aivideo/blog-seedance-2-0-lip-sync-voiceover-fix/) — "2 re-roll rule"

### Perceptual hash / fingerprint evidence (MEDIUM-HIGH confidence, peer-reviewed)
- [It's Not What It Looks Like: Manipulating Perceptual Hashing (UIUC)](https://gangw.cs.illinois.edu/PHashing.pdf) — "perceptual hashes can easily produce false negatives"
- [Detection of Age-Induced Makeup Attacks on Face Recognition (Idiap)](https://publications.idiap.ch/downloads/papers/2019/Kotwal_IEEETRANS.BIOM-2_2019.pdf) — makeup-as-aging attacks hard to distinguish from genuine aging
- [Diffusion-based Makeup Removal for Accurate Age Estimation (CVPR 2026 Workshop)](https://openaccess.thecvf.com/content/CVPR2026W/BIOM2026/papers/Gavas_DiffClean_Diffusion-based_Makeup_Removal_for_Accurate_Age_Estimation_CVPRW_2026_paper.pdf)
- [The Problem with Perceptual Hashes (Rent-a-Founder)](https://rentafounder.com/the-problem-with-perceptual-hashes/) — accessible overview of collision/false-negative tradeoffs

### Provenance / dependency explosion evidence (MEDIUM-HIGH confidence, peer-reviewed)
- [How to Effectively Trace Provenance on Windows Endpoint (NDSS PRISM 2026)](https://www.ndss-symposium.org/wp-content/uploads/prism2026-12.pdf) — "dependency explosion of provenance analysis"
- [A PT-based Approach to Construct Efficient Provenance Graph (ITM 2024)](https://www.itm-conferences.org/articles/itmconf/pdf/2024/03/itmconf_aiss2024_00016.pdf) — "dependency explosion... generates false causal relationships"
- [ProGraPher: Anomaly Detection based on Provenance Graphs (USENIX Security)](https://www.usenix.org/system/files/usenixsecurity23-yang-fan.pdf)
- [Unified Lineage System (ACM)](https://dl.acm.org/doi/abs/10.1145/3722212.3724458) — lineage stitching at scale

### Fine-tuning poisoning / copyright evidence (HIGH confidence, peer-reviewed)
- [The Stronger the Diffusion Model, the Easier the Backdoor (ICML 2024)](https://proceedings.mlr.press/v235/wang24bm.html) — SilentBadDiffusion, "more capable models are more susceptible"
- [Data Poisoning to Induce Copyright Breaches (NeurIPS 2023)](https://neurips.cc/virtual/2023/77078)
- [CopyrightShield (ICCV 2025)](https://openaccess.thecvf.com/content/ICCV2025/papers/Guo_CopyrightShield_Enhancing_Diffusion_Model_Security_Against_Copyright_Infringement_Attacks_ICCV_2025_paper.pdf)
- [DataElixir: Purifying Poisoned Datasets (AAAI-24)](https://ojs.aaai.org/index.php/AAAI/article/view/30186/32105)
- [Poisoning Fine-tuning Datasets of Constitutional Classifiers (Anthropic Alignment)](https://alignment.anthropic.com/2026/backdooring-classifiers/)

### Bad-case / blacklist over-matching evidence (MEDIUM confidence)
- [Preventing False Positives — Promptfoo](https://www.promptfoo.dev/docs/red-team/troubleshooting/false-positives/)
- [False Positives: The Hidden Cost Center in Production AI (Medium)](https://medium.com/@adnanmasood/false-positives-the-hidden-cost-center-in-production-ai-790afc8c1632)

---
*Pitfalls research for: v3.0 industrial pipeline alignment (Seedance AV sync / cross-episode reuse / creative history / bad case / fine-tuning / GLM-4.6V upgrade) on existing v2.0 degraded-first AIGC movie pipeline*
*Researched: 2026-06-22*
