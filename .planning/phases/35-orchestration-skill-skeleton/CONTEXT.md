# Phase 35 CONTEXT — Orchestration Skill Skeleton (vertical slice)

**Phase:** 35 — Orchestration Skill Skeleton (vertical slice)
**Status:** keystone — v5.0 ship decision depends on this
**Depends on:** Phase 32 (kais_aigc clients) + Phase 33 (pipeline_state) + Phase 34 (review_gates) — all SHIPPED
**Cross-repo:** Deliverables land in `/data/workspace/hermes-agent/skills/kais-movie-pipeline/`; planning docs live here.

---

## Goal (outcome, not task)

**As a** hermes-agent operator,
**I want to** invoke `/kais-movie-pipeline` as a single skill that runs the first 3 phases (p01 hook+topic, p02 outline, p03 script+audit) end-to-end,
**so that** the 13-step short-drama pipeline becomes a native hermes-agent skill (not a Node.js subprocess).

Phase 35 delivers the keystone slice; Phase 36 fills p04-p13 using the template Phase 35 establishes.

---

## Decisions (locked — DO NOT revisit)

### D-35-01: Skill location & directory layout
**Decision:** Skill lives at `hermes-agent/skills/kais-movie-pipeline/` (per user-locked PROJECT.md decision).
**Layout:**
```
hermes-agent/skills/kais-movie-pipeline/
├── SKILL.md                          # Skill manifest + 13-step DAG + 15-expert collab graph
├── pipeline/
│   ├── __init__.py
│   ├── runner.py                     # 13-phase loop + checkpoint resume + parallel_shots=4
│   ├── phases/
│   │   ├── __init__.py               # PHASE_REGISTRY (p01..p13)
│   │   ├── p01_hook_topic.py         # Wave 2 — calls hook_retention expert
│   │   ├── p02_outline.py            # Wave 2 — calls creative_source + screenplay
│   │   ├── p03_script_audit.py       # Wave 2 — calls screenplay + script_auditor
│   │   └── (p04..p13 — Phase 36)
│   └── (gates.py / state.py adapters — Phase 36 if needed)
├── references/
│   ├── pipeline-dag.md               # 13-step dependency graph
│   ├── review-gates.md               # 8-gate per-phase mapping
│   ├── asset-bus-schema.md           # slot types + lifecycle
│   └── expert-mapping.md             # 13 phase ↔ 15 expert mapping
└── tests/
    ├── test_runner.py                # runner loop + checkpoint tests
    └── test_p01_p02_p03.py           # vertical slice tests (mocked delegate_task)
```
**Rationale:** Mirrors `movie-experts/_shared/SKILL-LAYOUT.md` frontmatter+directory convention so `tools/skills_tool.py` discovers it identically. Adds `pipeline/` Python subdir + `tests/` subdir — slight extension of the "pure markdown" rule in SKILL-LAYOUT, justified because this is an **orchestration** skill (executes code), not a knowledge skill.

### D-35-02: Skill discovery mechanism
**Decision:** Skill is discovered by `skills_list()` / `skill_view()` via the standard mechanism — recursive scan of skills directories for `SKILL.md` files with valid YAML frontmatter. The hermes-agent skills directory is `~/.hermes/skills/` (via `get_skills_dir()`); additional roots come from `skills.external_dirs` in `~/.hermes/config.yaml`.
**Operational implication for development/testing:**
- During Phase 35 development, tests use `tmp_path` + `monkeypatch.setattr(tools.skills_tool, "SKILLS_DIR", tmp_path)` to isolate the discovery scan.
- For real invocation (`/kais-movie-pipeline` slash command), operator must EITHER (a) symlink `~/.hermes/skills/kais-movie-pipeline → /data/workspace/hermes-agent/skills/kais-movie-pipeline`, OR (b) add `- /data/workspace/hermes-agent/skills` to `~/.hermes/config.yaml` under `skills.external_dirs`. The CONTEXT-doc "operator setup" section (in SKILL.md body) documents option (b) as the default.
- This is NOT a Node.js bridge, NOT a plugin — `kais-movie-pipeline` is a SKILL that calls PLUGINS (`kais_aigc` / `pipeline_state` / `review_gates`) and other SKILLS (movie-experts) via `delegate_task` / `skill_view`.

### D-35-03: Python-only, no Node.js bridges
**Decision:** Per PROJECT.md locked decision — all orchestration code is Python. No `subprocess.run(["node", ...])` anywhere in `kais-movie-pipeline/`. The Node.js `lib/phases/index.js` is a REFERENCE PORT TARGET, not a runtime dependency.
**Reference port policy:** Each Python phase module mirrors the Node.js handler's I/O contract (which asset-bus slots it reads/writes, which gate it triggers, which expert it invokes) — NOT the implementation. We do not port imperative Node.js control flow line-by-line; we port the BEHAVIORAL CONTRACT.

### D-35-04: Phase modules are PURE orchestration
**Decision:** Phase modules (`p01_hook_topic.py` etc.) contain ZERO creative logic. They:
1. Load inputs from asset bus / state store / env
2. Invoke the appropriate movie-expert via `delegate_task(goal=..., context=..., toolsets=[...])`
3. Receive the expert's output (parsed from subagent summary)
4. Transform only if strictly needed for the downstream slot schema (no creative rewrites)
5. Write output to the asset bus
6. Trigger the gate via `runner_hooks.pause_for_review` if the phase has a configured gate

**Anti-pattern (forbidden):** phase module containing prompt templates, LLM calls, business rules. If logic is needed, it belongs in the EXPERT skill, not the orchestration phase.

### D-35-05: Asset bus extension — phase-specific slots
**Decision:** Phase 33 shipped AssetBus with only 4 typed slots (`creative-history` / `failed-shots` / `finetune-dataset` / `review-outcomes`). Phase 35 needs phase-output slots (`topic-kernel`, `story-framework`, `script-draft`, `audit-report`, etc.) to pass artifacts between phases.
**Resolution:** Phase 35-02 (runner) extends `ASSET_SCHEMA` in `plugins/pipeline_state/asset_bus.py` with new slot definitions mirroring the Node.js V8.6 asset-bus slot names. Slots are JSON format (envelope-wrapped, atomic write). Phase 35-02 task 1 performs the schema extension; Phase 35-03 phase modules consume the new slots.
**Why not use PipelineStateStore checkpoint payload instead?** Checkpoint payload is for RESUME state (phase cursor + intermediate). Phase outputs are first-class artifacts consumed by downstream phases, gates, canvas sync. Mixing them would violate single-responsibility.

### D-35-06: parallel_shots: 4 preserved
**Decision:** V8.6 / v2.0 behavior — `parallel_shots: 4` for episode-level shot parallelism — MUST be preserved in `runner.py`. Phase 35 implements the CONFIG PLUMBING (a `parallel_shots: int = 4` field in RunnerConfig); the actual parallel dispatch is exercised in p11 (Phase 36). Phase 35 tests verify the config is read and threaded through (a unit test asserting `RunnerConfig().parallel_shots == 4`), not that real parallelism happens in p01-p03 (p01-p03 are not shot-parallel — they're script-stage).

### D-35-07: delegate_task invocation contract
**Decision:** Phase modules call `delegate_task` (tool registered in `tools/delegate_tool.py`) via the standard tool dispatch path. Synchronous (background=false) — the runner blocks on each phase. Each delegate call's `goal` is a complete, self-contained instruction derived from the expert's SKILL.md `## When to use this skill` section; the `context` carries the asset-bus inputs (JSON-serialized); `toolsets` is `["skills", "file"]` minimum (the expert needs `skill_view` to load its own SKILL.md, and `file` to read/write artifacts if it does that directly — though orchestration phase usually mediates file I/O).
**Return shape:** `delegate_task` returns a summary string. Phase modules extract structured output by instructing the expert in `goal` to emit JSON in a fenced block at end of its summary, then the phase module parses it. (This is a deliberate convention; hermes-agent doesn't guarantee structured returns from delegate.)

### D-35-08: Tests use mocked delegate_task + mocked clients
**Decision:** All Phase 35 tests mock:
- `delegate_task` (via monkeypatch on `tools.delegate_task` dispatch) — return canned expert outputs
- kais_aigc clients (gold_team, review_platform, canvas, jimeng) — never make real HTTP
- PipelineStateStore / AssetBus — use `tmp_path` workdir (real filesystem, but isolated per test)

No network, no real LLM calls, no real subagent spawns. Tests verify ORCHESTRATION CORRECTNESS (right expert invoked with right inputs, right slot written, right gate triggered), not creative output quality.

---

## Critical Findings from Discovery

### CRITICAL-FINDING-35-01: Skill discovery is path-based, not registration-based
Unlike plugins (which need `plugin.yaml` + PluginManager.discover_and_load()), skills are discovered purely by recursive scan of `~/.hermes/skills/` (+ external_dirs) for `SKILL.md` files. No registration call needed. **Implication:** Phase 35-01 just needs to drop SKILL.md in the right directory; Phase 35-05 tests mock the scan path.

### CRITICAL-FINDING-35-02: delegate_task is synchronous-by-default in a single tool call
The tool blocks the parent until children complete (unless `background=true`). Phase modules invoke it synchronously — the runner naturally waits. No promise/future plumbing needed.

### CRITICAL-FINDING-35-03: Phase 33 AssetBus has only 4 slots — needs extension
See D-35-05. Phase 35-02 task 1 extends ASSET_SCHEMA. This is the only cross-plugin code change in Phase 35; everything else is additive in the `kais-movie-pipeline/` skill directory.

### CRITICAL-FINDING-35-04: Existing plugin tool surfaces are dispatching (Phase 32/33/34 complete)
Verified: `kais_aigc/tools.py` has 4 real handlers, `pipeline_state/tools.py` has 4 real handlers, `review_gates/tools.py` has 4 real handlers (incl. `runner_hooks.pause_for_review`). Phase 35 phase modules call these via standard tool dispatch (not direct Python imports). For tests that don't want to spin up the full tool registry, phase modules expose internal functions that accept injected dispatch callables.

### CRITICAL-FINDING-35-05: 15 movie-experts are SKILLS under `skills/movie-experts/<name>/SKILL.md`
The new pipeline skill references them via `metadata.hermes.related_skills` (per SKILL-LAYOUT convention) and invokes them via `delegate_task(goal="<instructions to load and apply expert>")`. The phase module does NOT call `skill_view` directly — instead it tells the subagent in `goal` to call `skill_view(name="hook_retention")` first then apply the expert. (Alternative: phase module calls `skill_view` in parent context, extracts the prompt body, passes it via `context`. Chosen approach: let the subagent do its own skill_view — simpler, matches how operators invoke experts.)

---

## Claude's Discretion areas

- **Slot naming convention** — `topic-kernel` vs `p01-topic-kernel` vs `topic_kernel`: use `topic-kernel` (kebab-case, matches existing slot names). Document choice in `references/asset-bus-schema.md`.
- **runner.py module structure** — single file vs `runner/` package: single file for Phase 35 (≤500 LOC target), split if Phase 36 pushes >800 LOC.
- **Test framework** — pytest (matches existing plugin tests in `plugins/*/test_*.py`).
- **references/ doc depth** — skeleton form (per ROADMAP SC#5); refined in Phase 36. Skeleton = structure + section headers + 1-2 sentences per section, not full content.

---

## Out of Phase 35 Scope (handled in later phases)

- p04 through p13 phase module implementations (Phase 36)
- Canvas event subscriber triggering on phase completion (Phase 37)
- OpenClaw grep cleanup / DEPRECATED.md (Phase 38)
- Real E2E producing master.mp4 (Phase 39)
- `runner.py` parallel shot dispatch actual code (Phase 36 implements; Phase 35 only config plumbing)
- Refining references/ docs with port experience (Phase 36)
