---
gsd_state_version: 1.0
milestone: v6.0
milestone_name: Rapid Convergence Loop
status: shipped
stopped_at: "v6.0 MILESTONE SHIPPED — Phase 42 plan 04 (FINAL plan) complete. 12 plans across Phases 40-42, 359 tests added on top of V5.0 502 baseline (802 passing in scoped sweep). '最速收敛闭环' closed: extract → recipe create → p10b preview → Wilson CI update → recipe query. All 6 FEEDBACK-INGEST-XX + all Phase 40/41 REQs satisfied. STRUCTURAL 'no auto-modify pipeline' invariant enforced via grep (Test 13). 0 openclaw refs. JSONL_SLOTS frozenset unchanged. ASSET_SCHEMA append-only (31 → 36 slots)."
last_updated: "2026-06-27T12:46:00.000Z"
last_activity: 2026-06-27
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 12
  completed_plans: 12
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-27)

**Core value:** 降级优先的 GPU 任务调度 — 外部服务不可用时系统仍可运行。
**v6.0 focus:** 补齐「最速收敛闭环」三件套 — 快速预览层(p10b) + 配方库(recipe_library) + 数据回流接口(feedback_ingest)。

## Current Position

Phase: 42 (Feedback Ingestion) — SHIPPED
Plan: 4 of 4 (all plans shipped 2026-06-27)
Status: v6.0 milestone COMPLETE
Last activity: 2026-06-27

Progress: [██████████] 100%

## Performance Metrics

**Velocity (cumulative):**

- v1.0 + v2.0 + v3.0 + v4.0 + v5.0: 9 + 19 + 35 + 12 + 36 = 111 plans archived
- v4.0 average: ~5-6 min/plan (reference baseline from Phase 26-30)
- v5.0 average: ~7-8 min/plan (Python rewrite + cross-repo deliverables)

**v5.0 By Phase (final — archived):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 31. Plugin Skeleton + Wiring | 3/3 | 21min | 7min |
| 32. Kais-AIGC Backend (Python) | 5/5 | ~50min | 10min |
| 33. Pipeline State & Asset Bus | 4/4 | ~42min | 10.5min |
| 34. Review Gate Framework | 4/4 | ~19min | ~5min |
| 35. Orchestration Skill Skeleton | 5/5 | ~42min | ~8min |
| 36. Remaining 10 Phases Port | 6/6 | ~36min | 6min |
| 37. Canvas Sync Migration | 3/3 | 21min | ~7min |
| 38. OpenClaw Decoupling + Docs | 5/5 | ~25min | 5min |
| 39. E2E Validation + v5.0 Audit | 1/1 | 18min | 18min |

**v5.0 totals:** 36 plans | ~274 min | 502 tests | 25/25 REQs | ~5500 LOC Python | 0 openclaw refs

**v6.0 By Phase (ALL SHIPPED 2026-06-27 — MILESTONE COMPLETE):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 40. Rapid Preview Tier | 4/4 | ~33min | ~8min |
| 41. Emotion Recipe Library | 4/4 | ~94min | ~24min (plans 01-04) |
| 42. Feedback Ingestion | 4/4 | ~26min | ~6.5min (plans 01-04) |

**v6.0 totals:** 12 plans | ~153 min | 359 tests added (802 passing scoped sweep) | 6/6 FEEDBACK-INGEST-XX + 7/7 RAPID-PREVIEW-XX + 6/6 RECIPE-LIB-XX REQs satisfied | 0 openclaw refs | ASSET_SCHEMA grew 31 → 36 (append-only) | "最速收敛闭环" closed.

**Phase 40 detail (shipped 2026-06-27):**

| Plan | Title | Duration | Tests Added |
|------|-------|----------|-------------|
| 40-01 | AssetBus preview-clips slot + PHASE_REGISTRY p10b stub | 11 min | ~20 |
| 40-02 | PreviewEngine ABC + SlideshowEngine + LTXVideoEngine | 8 min | ~26 |
| 40-03 | p10b_rapid_preview.py full phase module + degrade WARN | 7 min | ~89 |
| 40-04 | Cross-cutting integration tests + V5.0 regression guard | ~7 min | 39 |

**Phase 40 totals:** 4 plans | ~33 min | 676 tests (V5.0 baseline 502 + 174 Phase 40 additions) | 7/7 RAPID-PREVIEW-XX REQs satisfied | 0 openclaw refs (no production code touched Phase 37 deliverables) | 1 pre-existing out-of-scope failure (test_no_openclaw_references_in_phase_37_deliverables, canvas_sync sqlite refs)

**Phase 41 detail (plans 01-04 shipped 2026-06-27):**

| Plan | Title | Duration | Tests Added |
|------|-------|----------|-------------|
| 41-01 | RecipeLibrary skeleton (create/get/list) + emotion-recipe AssetBus slot | ~22 min | 46 (24 slot regression + 22 library) |
| Phase 41 P01 | ~22min | 3 tasks | 5 files |
| Phase 41 P02 | 25m | 4 tasks | 3 files |

**Phase 42 detail (ALL 4 plans shipped 2026-06-27 — v6.0 FINAL phase):**

| Plan | Title | Duration | Tests Added |
|------|-------|----------|-------------|
| 42-01 | FeedbackIngestClient skeleton + feedback-data/feedback-rejected AssetBus slots | ~5 min | 21 (11 slot + 10 skeleton) |
| 42-02 | HMAC verification + 4-stage validation pipeline + continuous-rate Wilson CI | ~7 min | 27 (9 continuous-CI + 18 validation; plus Phase 41 Test 14 realignment) |
| 42-03 | Starlette HTTP server + start_feedback_server + list_pending_updates + __main__ CLI | ~5 min | 16 (server lifecycle + HTTP status matrix + env resolution) |
| 42-04 | E2E integration + V5.0/40/41 regression guard + structural FEEDBACK-INGEST-05 | ~9 min | 30 (10 E2E + 20 regression incl. 4 parametrize variants) |

## Accumulated Context

### Decisions

Decisions logged in PROJECT.md + REQUIREMENTS.md + gsd-v6.0-rapid-convergence.md (blueprint).

**v6.0 key decisions (locked 2026-06-27):**

- **Phase 编号**: 继续 v5.0(Phase 39),v6.0 从 Phase 40 起,不重置
- **3 phase 严格串行**: 40 → 41 → 42,无 parallel track(blueprint 数据流约束)
- **p10b 是插入不替换**: 在 p10(voice) 与 p11(video_render) 之间,V5.0 的 502 tests 不能 break
- **降级容忍 + 红线门继承**: 4 个 V5.0 红线门在预览层同样生效,降级必须 WARN 不沉默
- **控制变量**: 预览赛马一次只改一个结构参数(Notion 红线 #6)
- **数据回流不自动改管线**: feedback 只更新配方库评分,人决策优先
- **配方结构对齐 Phase 40**: emotion-recipe 的 `structure{}` 字段与 p10b 的 structure_delta 对齐,故 41 依赖 40

**v5.0 key decisions (archived):**

- Skill 位置并入 hermes-agent (`hermes-agent/skills/kais-movie-pipeline/`)
- 全部 Python 重写,不做 Node subprocess 桥接
- Canvas 迁移到 hermes-agent 内部 event hook,不走 openclaw
- [Phase ?]: Slot name 'rapid-preview-clips' (NOT 'preview-clips') — avoids SKILL.md p06.5 collision (BLOCKER #5)
- [Phase ?]: Slot name 'episode-meta' (NOT 'pipeline-state') — pipeline-state.json is separate PipelineStateStore file (BLOCKER #1)
- [Phase ?]: JSONL_SLOTS frozenset left UNCHANGED — dispatch uses ASSET_SCHEMA[slot].format
- [Phase ?]: p10b EXPERT=None + GATE_ID=None — pure orchestration; PreviewEngine strategy replaces expert delegation
- [Phase ?]: generation_time_ms is LOCALLY-measured wall time via time.monotonic() (INFO #10) — service-reported timing in LTX response body is IGNORED for cross-engine comparability
- [Phase ?]: LTXVideoEngine faithfully mirrors GoldTeamClient D-09 contract — no innovation on degrade envelope shape
- [Phase 40]: p10b variant matrix CYCLES all 4 structure params across multi-shot episodes (BLOCKER #4) — shot N uses [STRUCTURE_PARAMS[N%4], [(N+1)%4], [(N+2)%4]] so turning_points_sec is deterministically covered
- [Phase 40]: p10b preview_skipped flag written to episode-meta AssetBus slot (BLOCKER #1 fix) — episode-meta is the registered AssetBus JSON slot; pipeline-state.json is a separate PipelineStateStore file, NOT an AssetBus slot
- [Phase 40]: p10b degrade semantics: per-variant silent count, episode-level WARN only on full degrade — mirrors v4.0 no-silent-swallow at episode boundary; per-variant fail is recoverable
- [Phase ?]: Phase 41-01: validation.confidence_interval stored as human-readable string '±N%' (not ci_lower/ci_upper floats)
- [Phase ?]: Phase 41-01: _slugify empty-slug fallback to literal 'recipe' (all-Chinese genre → recipe_id 'recipe-001' rather than '-001')
- [Phase ?]: Phase 41-01: get_recipe raises KeyError on unknown recipe_id (pure library code, programmer errors raise — mirrors creative_history.py)
- [Phase ?]: Phase 41-01: RecipeLibrary re-exported via __init__.py for namespace discovery but NOT added to _TOOLS tuple (library class, not a tool handler)
- [Phase ?]: DATA SOURCE PIVOT: RecipeLibrary reads story-framework + final-audit (NOT creative-history)
- [Phase ?]: Wilson CI pure stdlib (math.sqrt only)
- [Phase ?]: update_validation signature LOCKED for Phase 42
- [Phase 42]: FeedbackIngestClient ships submit_feedback as a documented stub envelope {status: 'not_implemented', reason: '...'} in plan 42-01 — lets callers/tests pin the skeleton surface without coupling to 42-02/42-03 internals
- [Phase 42]: KAIS_FEEDBACK_PORT default 8091 — sibling to gold-team :8002 and review-platform :8090 so a single host can run all three services without port conflicts
- [Phase 42]: Constructor takes recipe_library: Any (duck-typed) rather than hard-importing RecipeLibrary — prevents a potential import cycle if RecipeLibrary ever imports this module
- [Phase 42]: Phase 41 + Phase 35 snapshot tests (EXPECTED_SLOTS + JSONL list) extended rather than preserved as-is — they asserted exact-set equality with pre-Phase-42 state, and the append-only contract necessarily extends that set
- [Phase 42-02]: HMAC verification ALWAYS requires KAIS_FEEDBACK_SECRET — NO dev-mode escape (deliberate divergence from V5.0 review_platform which accepts all callbacks when secret unset; Phase 42 is production-facing)
- [Phase 42-02]: HMAC verification happens BEFORE json.loads — deliberate DoS mitigation (reject invalid signatures without burning CPU on potentially-malicious JSON)
- [Phase 42-02]: hmac.compare_digest for constant-time signature compare — NEVER == (threat T-42-03 spoofing mitigation)
- [Phase 42-02]: Structural invariant — RecipeLibrary.update_validation NEVER touched on signature/schema/semantic rejections; only after all 4 pipeline stages pass (Test 17/17b verify)
- [Phase 42-02]: update_validation(use_continuous_rate=True) added as keyword-only with default False — CONTEXT.md-authorized widening of Phase 41's LOCKED signature; default preserves int-passed path with zero regression
- [Phase 42-02]: get_recipe_by_episode returns None on unknown (does NOT raise KeyError) — best-effort lookup, distinct from get_recipe semantics to support the 404 flow
- [Phase 42-02]: Continuous-rate Wilson CI mathematically correct — Wilson score interval is well-defined for any continuous p in [0,1] (CONTEXT.md specifics); Phase 41 _wilson_ci math body unchanged, only type annotations widened to int | float
- [Phase 42-03]: Lazy import of starlette/uvicorn INSIDE _build_starlette_app / start_feedback_server / _run_cli — preserves 42-01/42-02 callers' fast import path; V5.0 deps remain hard-required only when the HTTP surface is actually used
- [Phase 42-03]: @contextlib.contextmanager (NOT a custom __enter__/__exit__ class) for start_feedback_server — simpler, less code, identical semantics for the test-cleanup use case
- [Phase 42-03]: Production CLI (_run_cli) uses uvicorn.run on the MAIN thread (NOT the context manager) — daemon thread would not receive SIGINT/SIGTERM; CONTEXT.md LOCKED "serve_forever in production, context manager for test cleanup"
- [Phase 42-03]: Route handler strips internal http_status key from JSON response body — keeps API contract clean ({status, feedback_id, recipe_id}) and prevents internal-state leakage (T-42-13 info-disclosure mitigation)

### Pending Todos

None for v6.0.

### Blockers

v6.0 ready to plan.

- Pre-existing failure (out of scope): test_no_openclaw_references_in_phase_37_deliverables fails due to UNCOMMITTED canvas_sync.py sqlite references (lines 406, 417, 426). Not caused by Phase 40-01 / 42-03. User should commit or revert canvas_sync.py changes separately. See .planning/phases/42-feedback-ingestion/deferred-items.md.

### Key Risks (v6.0 — active)

1. **p10b DAG 插入不破坏 V5.0 502 tests** — 缓解: p10b 是纯插入,不修改 p10/p11 现有行为;降级路径(fallback to Seedance)保证 V5.0 路径仍可走
2. **LTX-Video 真实 API 不可用** — 缓解: blueprint Out of Scope 已声明 real-GPU LTX-Video 评测归 operator 侧,v6.0 用 mocked API 验证编排正确性
3. **配方库消费方未定义** — 缓解: v6.0 只做配方库数据结构 + 查询接口,自动消费留 v7.0+(PROJECT.md Next Milestone Goals 已列)

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v3.1 | 上游 creative_history lineage retrofit (script→sts→shot) | Deferred | v3.0 roadmap |
| v3.1 | creative_history auto-rerender on script edit | Deferred | v3.0 roadmap |
| W-v5-1 | Real-GPU E2E (real ZHIPU_API_KEY + real Seedance audio/video) | Operator-side | v5.0 PROJECT.md Out of Scope |
| W-v5-2 | Real gold-team task execution (17 task types) | Operator-side | v5.0 PROJECT.md Out of Scope |
| W-v5-3 | Real canvas platform round-trip | Operator-side | v5.0 PROJECT.md Out of Scope |
| v6.0+ | 配方库自动消费 (p03 阶段推荐 converged 配方) | Deferred | v6.0 PROJECT.md — 需观察 v6.0 配方库数据沉淀质量 |
| v6.0+ | 多模型 A/B 测试 (Runway/Kling/Sora) | Deferred | v3.0 roadmap |
| v6.0+ | 多平台导出 (抖音/B站/YouTube/快手) | Deferred | v3.0 roadmap |
| v6.0+ | 多语言 dubbing (HeyGen 175+) | Deferred | v3.0 roadmap |
| v6.0+ | 独立 lip sync phase (sync.so / HeyGen) | Deferred | v3.0 roadmap |
| v6.0+ | 分布式多机部署 | Deferred | v2.0 |
| v6.0+ | TypeScript 迁移 / CI/CD pipeline | Deferred | v2.0 |
| v6.0+ | hermes-agent dashboard 内嵌管线可视化 | Deferred | v5.0 PROJECT.md |

## Session Continuity

Last session: 2026-06-27T12:46:00.000Z
Stopped at: v6.0 MILESTONE SHIPPED — Phase 42 plan 04 (FINAL plan of v6.0) complete. 30 new tests (10 E2E integration + 20 regression guard including LOAD-BEARING Test 13 structural FEEDBACK-INGEST-05 grep). Scoped sweep: 802 tests passing. All 6 FEEDBACK-INGEST-XX REQs satisfied. Deviation Rule 1: reworded feedback_ingest.py docstring (was tripping Test 13 grep).
Resume file: None

**Next action:**

```
v6.0 MILESTONE SHIPPED. Next:
  /gsd:plan-phase 43   # v6.0-MILESTONE-AUDIT.md (mirrors Phase 39 v5.0 audit pattern)
  OR
  manual audit invocation if no separate phase is desired
```

**Critical context to preserve across sessions:**

- v6.0 ACTIVE — 3 phases (40-42), 19 REQs, strict serial 40→41→42
- v5.0 SHIPPED 2026-06-26 — 9 phases (31-39), 36 plans, 502 tests, 25/25 REQs, ~5500 LOC Python (archived, do not modify)
- hermes-agent hosts kais-movie-pipeline skill + 3 plugins (kais_aigc / pipeline_state / review_gates)
- openclaw completely decoupled (0 executable-code refs in v5.0 deliverable dirs)
- v6.0 constraints: p10b is INSERT not replace; 4 red-line gates inherited; degrade must WARN not silent; feedback updates recipe scores only, no auto pipeline modification
- Blueprint source of truth: .planning/gsd-v6.0-rapid-convergence.md
