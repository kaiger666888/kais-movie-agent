# Phase 40: Rapid Preview Tier - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Insert new phase `p10b_rapid_preview` between p10 (voice) and p11 (video_render) in the V8.6 13-step pipeline. For each shot, generate 2-3 low-quality rapid preview variants (seconds per variant) that vary exactly ONE structure parameter from baseline (Notion 红线 #6 — control variable). Variants are persisted to new AssetBus JSONL slot `preview-clips` for downstream structure-parameter A/B 赛马. Engine is dual-track: LTX-Video (real GPU, mocked in v6.0) OR slideshow-style (FFmpeg subprocess, native). When engine unavailable, fall back to direct Seedance via p11 (skip p10b) but must `WARN` log + mark `preview_skipped=True` on episode metadata — never silent. V5.0's 4 red-line gates (@Audio / asset envelope / consistency-guard / Hermes phase contract) inherited unchanged.

</domain>

<decisions>
## Implementation Decisions

### Engine Selection & Default
- Default engine when `KAIS_PREVIEW_ENGINE` unset: **slideshow** (safer fallback; no external API dep; honors 降级容忍 红线 #1)
- Engine health check: **lazy on first call** — try engine, catch failure, fall back within p10b; matches GoldTeamClient D-09 degrade-on-first-call pattern
- LTX-Video API contract (v6.0 mocked, real-GPU deferred to operator): **POST `:9001/api/v1/ltx`** with `{shot_id, prompt, structure_delta} → {clip_path, generation_time_ms}`; degrade envelope on connection failure
- Engine class structure: **`PreviewEngine` ABC + `LTXVideoEngine` / `SlideshowEngine` subclasses** — strategy pattern; matches V5.0 plugin module-per-concern convention

### Variant Generation Strategy
- Variant count: **exactly 3** per shot (predictable test surface; matches blueprint "2-3 个" upper bound; gives A/B + baseline triad)
- Structure parameters varied: **hook_position_sec / emotion_sequence / turning_points_sec / ending_state** — directly from blueprint; aligns 1:1 with Phase 41 emotion-recipe `structure{}` fields
- Control variable enforcement: **single-delta per variant** (Notion 红线 #6) — variant N changes exactly ONE param from baseline; `structure_delta` field records which one
- Generation parallelism: **ThreadPoolExecutor(max_workers=parallel_shots=4)** — matches p11 pattern (D-36-08); 3 variants × N shots fan out concurrently

### AssetBus Integration & Degradation
- preview-clips slot registration: **extend ASSET_SCHEMA in `asset_bus.py`** (append 2 new entries, follows V5.0 plan 36-03 "PRESERVES existing slots — only appends" pattern); V5.0 502 tests stay green
- **Slot name: `rapid-preview-clips`** (NOT `preview-clips` — the latter is already documented in v3.0-era SKILL.md:207,261 for a future p06_5_ltx2_preview phase with JSON semantics; renaming avoids namespace collision)
- rapid-preview-clips format: **JSONL append-only** — one line per variant; matches `finetune-dataset` slot pattern (`format: "jsonl"`, uses `append_line()`); fields: `shot_id / variant_id / structure_delta / clip_path / generation_time_ms / engine` per blueprint
- **New slot: `episode-meta`** (JSON, writer_phase=p10b_rapid_preview) — for episode-level metadata flags. The `pipeline-state` AssetBus slot does NOT exist (it's a separate `.pipeline-state.json` file managed by PipelineStateStore). Use `episode-meta` AssetBus slot for `preview_skipped: True` flag.
- p10b module registration: **modify `phases/__init__.py` PHASE_REGISTRY** — insert `p10b_rapid_preview` between `p10_voice` and `p11_video_render`; p11 `depends_on` changes from `["p10_voice"]` to `["p10b_rapid_preview"]`; p10b `depends_on: ["p10_voice"]`
- Degradation signaling: **`logger.warning("preview_skipped: ...")` + `episode_meta["preview_skipped"] = True`** written to new `episode-meta` AssetBus slot; V5.0 502 tests unaffected since p10b is new

### Variant Matrix (refined after plan-checker finding)
- Variant count: **exactly 3 per shot** (predictable test surface)
- **Variant matrix cycling**: across consecutive shots, cycle through all 4 structure params so each param gets A/B tested — shot N uses params `[N, N+1, N+2] mod 4` from the 4-param list `[hook_position_sec, emotion_sequence, turning_points_sec, ending_state]`. This ensures all 4 params are deterministically covered across a multi-shot episode.
- Control variable enforcement: **single-delta per variant** (Notion 红线 #6) — variant N changes exactly ONE param from baseline; `structure_delta` field records which one
- Test coverage: at least one test asserts `turning_points_sec` appears as a structure_delta key in ≥1 variant across a multi-shot fixture

### Claude's Discretion
None — all 4 areas fully resolved via smart discuss.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p11_video_render.py`** — direct template for p10b. Has the parallel_shots ThreadPoolExecutor fan-out pattern (D-36-08), gate trigger contract, expert delegation via `delegate_task`. p10b will mirror this structure but with `PreviewEngine` strategy instead of `visual_executor` expert.
- **`/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p10_voice.py`** — template for the simpler non-parallel path; shows INPUT_SLOTS / OUTPUT_SLOTS / GATE_ID constants pattern.
- **`/data/workspace/hermes-agent/plugins/pipeline_state/asset_bus.py`** — ASSET_SCHEMA dict at line 40; append new slot at line 282 (before closing `}`). Has `append_line()` method (line 503) and `read_lines()` (line 524) for JSONL slots. Atomic write via `tempfile.mkstemp + os.replace`.
- **`/data/workspace/hermes-agent/skills/kais-movie-pipeline/pipeline/phases/__init__.py`** — PHASE_REGISTRY list at line 63. Linear chain pattern; insert p10b between p10 and p11 (line 73-74).
- **`/data/workspace/hermes-agent/plugins/kais_aigc/gold_team.py`** — GoldTeamClient D-09 degrade-first contract template. Connection errors / 5xx / 429 → `{"degraded": True, ...}` envelope, never raise. LTXVideoEngine should follow this pattern.

### Established Patterns
- **Phase module signature**: `run(episode_id, asset_bus_read, asset_bus_write, delegate_task, trigger_gate=None, *, parallel_shots=4)` — p10b will use this exact signature.
- **Phase metadata constants**: `PHASE_ID`, `EXPERT`, `INPUT_SLOTS`, `OUTPUT_SLOTS`, `GATE_ID` at module top — referenced by runner.py + tests.
- **Expert delegation**: `_parse_expert_output(delegate_result)` from `p01_hook_topic` parses fenced JSON block from summary.
- **AssetBus slot schema**: each slot has `file`, `format` (`json` or `jsonl`), optional `description` / `writer_phase` / `reader_phases`.
- **Atomic write semantics**: JSON slots use write-tmp-then-rename; JSONL slots use `open(..., "a")` (O_APPEND).
- **Degrade-first**: connection errors / 5xx / timeouts return `{"degraded": True, ...}` envelope; 4xx raises domain error.

### Integration Points
- **DAG insertion**: `phases/__init__.py` PHASE_REGISTRY — p11's `depends_on` mutates from `["p10_voice"]` to `["p10b_rapid_preview"]`. Runner.py auto-discovers via `_compute_start_index` (no runner change needed). Insertion point is between p10 (index 9) and p11 (was index 10, becomes index 11). p08_scene_selection is at index 7 — `test_checkpoint_resume_mid_pipeline` (resumed_from=7, len(result["phases"])==6) still passes because p10b inserts AFTER index 7.
- **AssetBus write**: p10b reads `voice-clips` + `voice-timeline` (from p10) + `e-konte-sheets` (from p09, for keyframes); writes `rapid-preview-clips` JSONL + `episode-meta` JSON.
- **Episode meta flag**: degraded path writes `preview_skipped: True` to NEW `episode-meta` AssetBus slot (registered in plan 01).
- **V5.0 502 tests safety**: ASSET_SCHEMA is append-only (no removal); PHASE_REGISTRY insertion is positional (existing entries' indexes shift by 1 but their `id` strings stay stable). p10/p11 themselves unchanged. **V5.0 hard-coded `== 13` assertions in 4 test files must be updated to `== 14`**: `test_runner_full_dag.py:211` (len(result["phases"])==13 → 14), `test_runner_full_dag.py:455` (len(store.saved)==13 → 14), `test_e2e_degraded.py:308` (13 → 14), `test_canvas_sync_integration.py:300` (13 → 14). Plan 01 grep MUST cover `== 13` patterns broadly, not just `PHASE_REGISTRY` references.

</code_context>

<specifics>
## Specific Ideas

- p10b is **pure orchestration** (mirrors p10/p11 D-35-04 contract) — no LLM, no prompt templates. The 2-3 variants are mechanical structure_delta applications + engine calls, not creative rewrites. Creative decisions happen in p01-p09 (script + shots already locked by the time p10b runs).
- The "control variable" rule is enforced structurally: each variant's `structure_delta` field is `{param_name: new_value}` — exactly one key. Validation rejects multi-key deltas at write time (prevents Notion 红线 #6 violation).
- Mocked LTX-Video contract is intentionally minimal — just enough to verify orchestration. Real API calibration (response time distribution, error modes, clip quality) is operator-side per blueprint Out of Scope.
- Slideshow engine uses **keyframes from p09 e-konte-sheets + TTS from p10 voice-clips**, assembled via FFmpeg subprocess (`-i img -i audio -c:v libx264 -c:a aac out.mp4`). Generation target < 10s per variant.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Future enhancements (operator-triggered):
- Real LTX-Video API calibration (operator-side per blueprint Out of Scope)
- Preview variant scoring UI (web dashboard — out of v6.0 scope per REQUIREMENTS Out of Scope)
- Auto-promotion of winning variant to p11 input (recipe library consumption — v7.0+ candidate per REQUIREMENTS.md backlog section A)

</deferred>
