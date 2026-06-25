# Phase 38 CONTEXT — OpenClaw Decoupling + Docs Cleanup

**Phase:** 38 — OpenClaw Decoupling + Docs Cleanup
**Status:** planning
**Depends on:** Phase 36 (full 13-phase port — code frozen, no more Python files added), Phase 37 (canvas sync migrated — last openclaw dependency path closed)
**Cross-repo:** All code deliverables in `/data/workspace/hermes-agent/`; doc cleanup in `/data/workspace/kais-movie-agent/`; planning lives here.

---

## Goal (outcome, not task)

**As a** future operator or auditor of the v5.0 system,
**I want to** see zero openclaw / Toonflow references in the v5.0 code deliverables, a clear DEPRECATED.md pointing me to the new hermes-agent location, and a regression test that prevents future drift,
**so that** I can trust the decoupling is complete and find the live code without archaeology.

After Phase 38, the v5.0 deliverables are documentation-clean. Phase 39 ships the E2E validation + milestone audit.

---

## Scope (locked)

### In scope

1. **Code grep test** — `plugins/kais_aigc/tests/test_openclaw_decoupled.py` with two tests scanning the 4 v5.0 deliverable dirs for openclaw/Toonflow/sessions_spawn(runtime="acp") (SC#1) and Node.js runtime dependency patterns (SC#3). Lives in hermes-agent because the deliverable dirs are there.
2. **DEPRECATED.md rewrite** — `kais-movie-agent/DEPRECATED.md` from v1.4 partial notice to v5.0 final notice with migration guide (SC#2).
3. **Doc cleanup** — `kais-movie-agent/SKILL.md`, `INTEGRATION.md`, `README.md` cleaned of stale openclaw-is-the-orchestrator framing. Historical banner approach preferred for SKILL.md (40KB, not worth rewriting).

### Out of scope

- **Phase 39 deliverables**: E2E master.mp4 production (OPENCLAW-REMOVE-04), v5.0-MILESTONE-AUDIT.md (OPENCLAW-REMOVE-05), CANVAS-IN-HERMES-04 E2E verification. These land in Phase 39.
- **Code changes to v5.0 deliverables**: Phase 36/37 code is frozen. Phase 38 only adds tests + edits docs in kais-movie-agent. If the grep test finds real openclaw refs in v5.0 code, that's a Phase 36/37 regression to fix in a follow-up — but Phase 37 already verified zero such refs exist.
- **Rewriting kais-aigc-platform**: the microservice stack stays as-is (v5.0 only wrote new clients in Phase 32).
- **Rewriting movie-experts**: 15 expert skills consumed as-is.

---

## Decisions (locked — DO NOT revisit)

### D-38-01: Single plan, no decomposition

**Decision:** Phase 38 is one sub-plan (38-01). The three work items (regression test, DEPRECATED.md rewrite, doc cleanup) are small and loosely coupled — decomposition would add orchestrator overhead without parallelism benefit.

**Rationale:** Estimated 250 LOC + 4 doc edits. Well under the 500-LOC threshold where decomposition pays off. The work items have no inter-dependency (test doesn't depend on doc edits, DEPRECATED.md doesn't depend on SKILL.md cleanup).

### D-38-02: Rewrite DEPRECATED.md, not append v5.0 section

**Decision:** Fully replace the v1.4 partial deprecation notice with a v5.0 final notice. Do not preserve the v1.4 content under a "historical" section — the v1.4 notice was itself superseded by v5.0.

**Rationale:** The v1.4 notice (lines 9-19 of current DEPRECATED.md) claims "Orchestration duties fully transferred to OpenClaw Agent" — this is exactly the framing v5.0 reverses. Appending would leave contradictory statements in the same file. Rewrite is cleaner.

**Alternative considered:** Append v5.0 section, mark v1.4 as superseded. Rejected — two superseded-notices in one file is confusing.

### D-38-03: Regression test in plugins/kais_aigc/tests/, not a separate dir

**Decision:** `test_openclaw_decoupled.py` lives in `hermes-agent/plugins/kais_aigc/tests/` alongside the Phase 37 `test_canvas_sync_integration.py` (which has a similar openclaw-grep test scoped to canvas_sync only). The new test extends the scope to all 4 v5.0 deliverable dirs.

**Rationale:** Co-locate with the existing precedent. The kais_aigc plugin is the natural home — it's where the canvas-related openclaw removal happened (Phase 32 + 37), and the test is about the v5.0 deliverables collectively.

**Alternative considered:** `hermes-agent/tests/test_v5_decoupled.py` at repo root. Rejected — hermes-agent has no top-level tests/ dir convention; tests live in plugin tests/ dirs.

### D-38-04: SKILL.md historical banner, not full rewrite

**Decision:** For `kais-movie-agent/SKILL.md` (40281 bytes, 30+ openclaw/Toonflow refs throughout): prepend a HISTORICAL banner at the top documenting that the file describes v1.x/V8.6 architecture and is superseded by `hermes-agent/skills/kais-movie-pipeline/SKILL.md`. Do not rewrite the body.

**Rationale:** The 40KB body has ongoing reference value — it documents the V8.6 behavioral contract that Phase 36 ported to Python (per ROADMAP "Phase 36 reference port,非 re-design"). Rewriting would either lose this reference or require ~2 days of work for marginal benefit. The banner is honest and minimal.

**For smaller docs** (INTEGRATION.md 4438 bytes, README.md 4955 bytes): inline cleanup is feasible and preferred where the doc has ongoing operational value. Per-doc choice at executor discretion.

### D-38-05: Absence-declaration filter in grep test

**Decision:** The openclaw/Toonflow grep test filters out lines matching `ABSENCE_DECL_RE` (patterns like "no openclaw", "no toonflow", "not require openclaw", "absence", "不再", "脱离", "不走 openclaw"). This prevents false positives on docstrings that assert the absence of openclaw (e.g., canvas_sync.py line 29: "No `openclaw` / `Toonflow` / sqlite references") and on the SC#1 verification tests themselves (which necessarily mention "openclaw" in their test names).

**Rationale:** Without this filter, the test would fail on its own existence. Phase 37's `test_no_openclaw_references` already uses this pattern (line 320-322 of test_canvas_sync.py) — Phase 38 follows the same convention.

**Alternative considered:** Scan only `.py` files, exclude `test_*.py` and docstrings. Rejected — too easy to hide real refs in test files; the absence-declaration approach is more robust.

---

## Critical Findings from Prior Phases (carry forward)

### CF-38-01: Phase 37 already verified 0 openclaw refs in canvas_sync/canvas_graph

Phase 37's `test_no_openclaw_references_in_phase_37_deliverables` (in test_canvas_sync_integration.py) scans `plugins/kais_aigc/canvas_sync.py` + `canvas_graph.py` for openclaw/Toonflow/sqlite and asserts zero executable hits (absence-declarations filtered). This test PASSED in Phase 37 verification. Phase 38 extends the scope from 2 files to all 4 v5.0 deliverable dirs.

### CF-38-02: v5.0 deliverable dirs are stable (Phase 36 code freeze)

Per ROADMAP, Phase 36 is the reference port of all 13 phases. After Phase 36 verification (2026-06-26), no new Python files are added to the 4 v5.0 deliverable dirs until v6.0. Phase 38's regression test is therefore stable — it scans a frozen codebase.

### CF-38-03: DEPRECATED.md migration paths must be verified live

The migration guide in DEPRECATED.md is the canonical pointer for future operators. Every path in the migration table must `ls` successfully on disk before commit. Task 2 step 1 of 38-01 enumerates the paths to verify.

### CF-38-04: Hermes SKILL.md is already openclaw-clean

`hermes-agent/skills/kais-movie-pipeline/SKILL.md` has zero openclaw/Toonflow references (verified during Phase 38 pre-scan). Phase 38 does NOT edit this file — it's already v5.0-clean. The kais-movie-agent/SKILL.md (the old one) is the cleanup target.

---

## Claude's Discretion areas

- **Per-doc cleanup approach (rewrite vs banner)**: for INTEGRATION.md and README.md, choose full rewrite if the doc has ongoing operational value (e.g. quickstart with current paths), or HISTORICAL banner if purely descriptive of the old architecture. SKILL.md is locked to banner approach (D-38-04).
- **Migration table rows**: PLAN.md `<interfaces>` shows 6 rows (phases, canvas-sync, state, gates, clients, runner entry). Add or remove rows if discovery reveals other major components worth pointing to (e.g. `lib/blacklist-engine.js` → no v5.0 equivalent, so omit).
- **Test file imports**: use `pathlib` + `re` from stdlib only. No new test dependencies. The test walks paths relative to the hermes-agent repo root — use `pathlib.Path(__file__).resolve().parents[3]` to anchor (test lives in `plugins/kais_aigc/tests/`, so 3 levels up is repo root).

---

## Out of Phase 38 Scope (handled in later phases or v6.0+)

- E2E openclaw-OFF validation producing master.mp4 (Phase 39 / OPENCLAW-REMOVE-04)
- v5.0-MILESTONE-AUDIT.md (Phase 39 / OPENCLAW-REMOVE-05)
- Canvas E2E verification (Phase 39 / CANVAS-IN-HERMES-04)
- Physical archival of kais-movie-agent repo (operator decision post-v5.0-ship)
- TypeScript migration / CI/CD (v6.0+)
