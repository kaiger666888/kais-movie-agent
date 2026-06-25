# Phase 36 CONTEXT — Remaining 10 Phases Port (p04-p13)

**Phase:** 36 — Remaining 10 Phases Port
**Status:** planning
**Depends on:** Phase 35 (verified passed 2026-06-26 — vertical slice p01-p03 proven end-to-end, 53 Phase 35 + 353 cross-plugin tests green)
**Cross-repo:** Deliverables land in `/data/workspace/hermes-agent/skills/kais-movie-pipeline/`; planning docs live here.

---

## Goal (outcome, not task)

**As a** hermes-agent operator,
**I want to** invoke `/kais-movie-pipeline` and have the runner sequentially dispatch all 13 V8.6 phases (p01 hook+topic → p13 delivery) end-to-end in Python,
**so that** the complete short-drama pipeline runs natively in hermes-agent (no Node.js subprocess, no openclaw orchestration).

Phase 35 established the template (p01-p03 + runner + asset bus + gate framework). Phase 36 ports p04-p13 (10 phase modules) using that template. After Phase 36, the full 13-phase pipeline runs in Python under mocked clients; Phase 37 wires canvas sync, Phase 38 cuts openclaw, Phase 39 ships E2E.

---

## Decisions (locked — DO NOT revisit)

### D-36-01: Reference port, not re-design
**Decision:** Per ROADMAP SC#2 + PROJECT.md locked decision — p04-p13 phase modules port the Node.js `lib/phases/index.js` V8.6 handler **behavioral contract** (which asset-bus slots read/written, which expert invoked with which `goal` shape, which gate triggered when), NOT the imperative implementation. The 35-03 phase module anatomy is the template:
1. `PHASE_ID` / `EXPERT` / `INPUT_SLOTS` / `OUTPUT_SLOTS` / `GATE_ID` module constants
2. `run()` function with 5-arg signature (`episode_id`, `asset_bus_read`, `asset_bus_write`, `delegate_task`, `trigger_gate`)
3. Gather inputs from asset bus (graceful empty)
4. Construct self-contained `goal` for delegate_task — instructs subagent to `skill_view` the expert(s) then apply the Workflow
5. Parse fenced JSON from delegate summary (reuse `_parse_expert_output` from p01)
6. Write outputs to asset bus
7. Trigger gate if `GATE_ID` set + `trigger_gate` provided

**Anti-pattern (forbidden):** porting imperative Node.js control flow line-by-line, or putting LLM calls / prompt templates / business rules in phase modules (D-35-04 still applies — PURE ORCHESTRATION).

### D-36-02: Phase naming & DAG order
**Decision:** The 10 new modules follow the Phase 35 SKILL.md DAG order. Module file names use the pattern `p<NN>_<snake_case_name>.py`:

| File | Phase ID | V8.6 Step | Primary Expert(s) | Gate |
|------|----------|-----------|-------------------|------|
| `p04_character_design.py` | `p04_character_design` | Step 4 | `character_designer` + `visual_executor` (drawer) | Gate 4 `shot-prep` (per V8.6 gates.yaml) |
| `p05_pain_discovery.py` | `p05_pain_discovery` | Step 5 | `creative_source` (re-invoke) + `theory_critic` | — |
| `p06_spatio_temporal_script.py` | `p06_spatio_temporal_script` | Step 6 (atomic §5) | `screenplay` + `cinematographer` + `script_auditor` | Gate 6 `spatio-temporal` |
| `p07_scene_generation.py` | `p07_scene_generation` | Step 7 (atomic §4) | `visual_executor` + `prompt_injector` + `style_genome` + `colorist` | Gate 5 `scene-design` |
| `p08_scene_selection.py` | `p08_scene_selection` | Step 8 | `cinematographer` + `editor` | — |
| `p09_shot_breakdown.py` | `p09_shot_breakdown` | Step 9 | `cinematographer` + `continuity_auditor` | — |
| `p10_voice.py` | `p10_voice` | Step 7B + Step 10 partial | `audio_pipeline` (voicer sub-step) | — |
| `p11_video_render.py` | `p11_video_render` | Step 10 + 11 video half | `visual_executor` (animator) + `audio_pipeline` (lip_sync) | Gate 7 `render-preview` |
| `p12_composition.py` | `p12_composition` | Step 11 audio half + Step 12 | `audio_pipeline` (composer+foley+mixer+spatial) + `editor` | — |
| `p13_delivery.py` | `p13_delivery` | Step 13 | `colorist` + `compliance_gate` + `editor` | Gate 8 `final-delivery` |

**Note on Step 7B / Step 10 mapping:** V8.6 has 13 logical Steps but the SKILL.md Phase 35 DAG collapses them into 13 phase modules. Step 7B (audio skeleton) and Step 10 (video gen) are split across p10 (voice) + p11 (video render) + p12 (composition) — see PATTERNS.md §Phase-Slot-Map for the exact slot routing. Phase 36 keeps the 13-module shape (Phase 35's PHASE_REGISTRY extends cleanly).

### D-36-03: PHASE_REGISTRY update
**Decision:** `pipeline/phases/__init__.py` appends 10 entries to PHASE_REGISTRY after p03. Each entry: `{"id": "<phase_id>", "module": <module>, "depends_on": [<upstream phase_id>...]}`. Depends_on follows the linear DAG (p04 depends on p03; p05 on p04; ... p13 on p12) — no branching (parallelism is intra-phase shot-level in p11 only, plumbed via `RunnerConfig.parallel_shots`).

### D-36-04: AssetBus schema extension (Wave 1 per-phase)
**Decision:** Each Wave 1 child plan (36-01..36-04) extends `ASSET_SCHEMA` in `plugins/pipeline_state/asset_bus.py` with the slots its phases write. Slot names are kebab-case semantic (per Phase 35 convention). Estimated ~20 new slots total (see asset-bus-schema.md "Phase 36 Future Slots" placeholder list — refined per-plan). Each plan declares its slots in must_haves so verification catches missing schema entries.

### D-36-05: Test pattern — mirror Phase 35 35-03/35-05
**Decision:** Each Wave 1 plan writes one `tests/test_p<NN>_<name>.py` per phase (mirrors `test_p01_unit.py` / `test_p02_unit.py` / `test_p03_unit.py` pattern from Phase 35) — 4-7 tests per phase: (a) reads correct input slot, (b) constructs goal mentioning all assigned experts via skill_view, (c) calls delegate_task once with right toolsets, (d) writes correct output slots, (e) triggers correct gate (or skips if GATE_ID=None), (f) parses expert JSON output correctly, (g) handles empty input slot gracefully. Mocked delegate_task returns canned fenced-JSON summaries. **No real subagent spawns, no real HTTP** (D-35-08 still applies).

36-05 adds `tests/test_phase_registry_full.py` (asserts 13 entries in PHASE_REGISTRY in DAG order) + `tests/test_runner_full_dag.py` (asserts runner iterates p01-p13 sequentially with mocked delegate, checkpoint resume mid-pipeline works at p07).

### D-36-06: references/ refinement (Wave 2 — 36-05)
**Decision:** After all 10 phase modules land, 36-05 refines the 4 reference docs from skeleton → full form per SC#4:
- `pipeline-dag.md` — add per-edge slot flow table (which slot flows p04→p05 etc.)
- `review-gates.md` — replace "Gates 4-8 Future" stub with per-gate rows (gate 4-8 reviewer + mode + actual trigger phase)
- `asset-bus-schema.md` — replace "Phase 36 Future Slots TBD" placeholder list with the actual ~20 slot table written in Wave 1, plus read/write contract per slot
- `expert-mapping.md` — replace "Phase 36" scope column with actual phase module file paths + the delegate_task `goal` template summary per phase

**Wave 2 depends on Wave 1** (36-05 must run after 36-01..36-04) — refinement needs the actual slot names + goal shapes that Wave 1 produces.

### D-36-07: Wave grouping — 4 parallel + 1 wave-2
**Decision:** 5 plans total, grouped to keep each plan ≤3 phase modules (manageable executor scope):
- **36-01 (Wave 1):** p04 + p05 + p06 — character/pain/spatio (script-stage continuation)
- **36-02 (Wave 1):** p07 + p08 + p09 — scene_gen/scene_select/shot_break (visual design)
- **36-03 (Wave 1):** p10 + p11 — voice + video_render (parallel_shots exercised here)
- **36-04 (Wave 1):** p12 + p13 — composition + delivery (final ship)
- **36-05 (Wave 2):** PHASE_REGISTRY update + references/ refinement + full-DAG runner tests — depends on all Wave 1 plans

Wave 1 plans can run in parallel (different phase modules, different asset-bus slots, different test files — no conflicts).

### D-36-08: parallel_shots actual dispatch (p11 only)
**Decision:** Phase 35 plumbed `RunnerConfig.parallel_shots: int = 4` (D-35-06). Phase 36-03 (p11 video_render) is where the config actually drives dispatch: p11 fans out shot-level delegate_task calls concurrently (up to `parallel_shots` shots in flight). Implementation uses `concurrent.futures.ThreadPoolExecutor(max_workers=config.parallel_shots)` — phase module receives the config via an extra `parallel_shots: int` kwarg on `run()` (signature extension only for p11; other phases keep the 5-arg Phase 35 signature). Tests mock the thread pool to keep them deterministic.

---

## Critical Findings from Phase 35 (carry forward)

### CF-36-01: Phase 35 template is the contract
The 35-03 phase module anatomy (PHASE_ID/EXPERT/INPUT_SLOTS/OUTPUT_SLOTS/GATE_ID constants + 5-arg `run()` + `_parse_expert_output` reuse) is the **canonical template**. Phase 36 ports deviate only when V8.6 behavior demands (e.g. p11 parallel shot fan-out per D-36-08). No new patterns invented.

### CF-36-02: delegate_task goal shape is self-contained
Per Phase 35 D-35-07, the `goal` string instructs the subagent to first `skill_view(name="<expert>")` then apply the Workflow. Phase 36 goals follow the same shape — the phase module does NOT call skill_view in parent context (would burn parent context across 13 phases × 5-15KB expert SKILL.md = context exhaustion).

### CF-36-03: Atomic operations are single delegate_task calls
V8.6 §1-§6 atomic operations (multi-expert collaboration in a single ACP call) port as a SINGLE `delegate_task` invocation per phase — the subagent orchestrates the multi-expert collaboration internally. p06 (§5) and p07 (§4) and p11 (§6) all use this pattern (mirrors p02 §2 and p03 §3 from Phase 35).

### CF-36-04: Gate triggering is conditional
Phase modules trigger gates ONLY when (a) `GATE_ID` module constant is set AND (b) `trigger_gate` callable is not None. `RunnerConfig.enable_gates=False` propagates None to all phases (CI/batch mode). Phase 36 modules with no gate (p05, p08, p09, p10, p12) set `GATE_ID = None` and skip the trigger block entirely.

---

## Claude's Discretion areas

- **Slot name final spelling** — `character-bible` vs `character-bible-2.0`: use `character-bible` (matches V8.6 asset-bus convention). Document choice in refined asset-bus-schema.md.
- **Goal template wording** — each phase's `goal` string is at executor discretion as long as it (a) mentions all assigned experts via skill_view, (b) names the upstream slot inputs, (c) specifies the JSON output shape. No need to verbatim-port Node.js prompt strings.
- **p11 parallel shot fan-out shape** — `ThreadPoolExecutor` vs `asyncio.gather`: ThreadPoolExecutor (sync delegate_task is already blocking; threads are simpler). Document in PATTERNS.md.
- **Test count per phase** — 4-7 tests per phase (mirrors Phase 35 35-03 unit test density). No need to hit a specific number; cover the 7 lifecycle steps from D-36-05.

---

## Out of Phase 36 Scope (handled in later phases)

- Canvas sync event subscriber triggering on phase completion (Phase 37)
- OpenClaw grep cleanup / DEPRECATED.md (Phase 38)
- Real E2E producing master.mp4 with non-mocked clients (Phase 39)
- Refining delegate_task structured return contract (currently fenced-JSON parsing; hermes-agent may add native structured returns in v6.0+)
- Multi-platform export / multi-language dubbing (v6.0+ per REQUIREMENTS.md Out of Scope)
