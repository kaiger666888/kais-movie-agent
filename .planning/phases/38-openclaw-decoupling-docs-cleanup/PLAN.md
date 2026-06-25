---
phase: 38-openclaw-decoupling-docs-cleanup
plan: master
type: execute
wave: N/A
depends_on: [36, 37]
files_modified:
  - kais-movie-agent/DEPRECATED.md
  - kais-movie-agent/SKILL.md
  - kais-movie-agent/INTEGRATION.md
  - kais-movie-agent/README.md
autonomous: true
requirements: [OPENCLAW-REMOVE-01, OPENCLAW-REMOVE-02, OPENCLAW-REMOVE-03]
user_setup: []

must_haves:
  truths:
    - "grep -ri 'openclaw|OpenClaw|sessions_spawn(runtime=\"acp\")|Toonflow' across hermes-agent/skills/kais-movie-pipeline/, plugins/kais_aigc/, plugins/pipeline_state/, plugins/review_gates/ returns 0 executable hits (absence-declarations in docstrings + the SC verification test itself are allowed)"
    - "kais-movie-agent/DEPRECATED.md updated to v5.0 final deprecation notice pointing to hermes-agent new location (skill path + plugin path + behavioral equivalence statement)"
    - "kais-movie-agent deliverable docs (DEPRECATED.md, SKILL.md, INTEGRATION.md, README.md) cleaned of stale 'openclaw is the orchestrator' framing — replaced with v5.0 hermes-native framing or marked as historical archive"
    - "v5.0 deliverables (4 dirs) have no Node.js runtime dependency — no package.json import / require / subprocess.run(node) calls in executable code (test_*.py / docstrings / absence-declarations allowed)"
    - "DEPRECATED.md migration guide is actionable — reader can locate the new hermes-agent skill path, the 3 plugins, and the runner entry point without further lookup"
  artifacts:
    - path: "kais-movie-agent/DEPRECATED.md"
      provides: "v5.0 final deprecation notice — points to hermes-agent new location, migration guide with skill path + plugin path + behavioral equivalence"
      contains: "v5.0"
    - path: "kais-movie-agent/SKILL.md"
      provides: "Cleaned skill doc — openclaw/Toonflow framing replaced with v5.0 hermes-native framing OR marked as historical archive"
      contains: "v5.0"
    - path: "kais-movie-agent/INTEGRATION.md"
      provides: "Cleaned integration doc — stale 'openclaw orchestrator' framing updated or marked historical"
      contains: "v5.0"
    - path: "plugins/kais_aigc/tests/test_openclaw_decoupled.py"
      provides: "SC#1 + SC#3 verification test — scans 4 v5.0 deliverable dirs for openclaw/Toonflow/sessions_spawn(runtime=acp)/Node.js runtime refs; runs in CI to prevent regression"
      contains: "test_openclaw_references_zero_in_v5_deliverables"
  key_links:
    - from: "DEPRECATED.md migration guide"
      to: "hermes-agent/skills/kais-movie-pipeline/SKILL.md"
      via: "explicit relative/path or absolute path reference in the Superseded By section"
      pattern: "hermes-agent/skills/kais-movie-pipeline"
    - from: "DEPRECATED.md migration guide"
      to: "hermes-agent/plugins/{kais_aigc,pipeline_state,review_gates}/"
      via: "explicit plugin directory paths listed"
      pattern: "plugins/(kais_aigc|pipeline_state|review_gates)"
---

<objective>
Finalize the v5.0 openclaw decoupling at the documentation and reference layer. After Phase 37, the v5.0 code deliverables (4 dirs: skills/kais-movie-pipeline/, plugins/kais_aigc/, plugins/pipeline_state/, plugins/review_gates/) already have zero executable openclaw/Toonflow references — Phase 37 verified this with `test_no_openclaw_references_in_phase_37_deliverables`. Phase 38 closes the loop:

1. **SC#1 — Code grep zero hits**: add a permanent regression test that scans all 4 v5.0 deliverable dirs for openclaw / OpenClaw / `sessions_spawn(runtime="acp")` / Toonflow references and fails if any executable code (non-docstring, non-test) hits are found. This locks the decoupling against future drift.

2. **SC#2 — DEPRECATED.md v5.0 final notice**: rewrite `kais-movie-agent/DEPRECATED.md` from the v1.4 partial notice to a v5.0 final deprecation notice. Point readers to the new hermes-agent location with an actionable migration guide: skill path, 3 plugin paths, runner entry point, behavioral equivalence statement.

3. **SC#3 — No Node.js runtime dependency**: extend the regression test to also scan for `require(.*package\.json)`, `subprocess.run.*node`, `import.*package\.json` in executable code across the 4 v5.0 deliverable dirs. Zero hits expected.

4. **Cleanup of kais-movie-agent deliverable docs**: `SKILL.md`, `INTEGRATION.md`, `README.md` (and any other doc with openclaw refs) are updated to either (a) reflect v5.0 hermes-native framing or (b) carry a clear "HISTORICAL — v1.x/V8.6 archive, superseded by hermes-agent/skills/kais-movie-pipeline/" banner at the top. Choice per doc at executor discretion based on whether the doc has ongoing operational value.

Output: 4 updated docs in kais-movie-agent/ + 1 new regression test in hermes-agent/plugins/kais_aigc/tests/. Single plan (38-01) — this is a small phase.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/38-openclaw-decoupling-docs-cleanup/CONTEXT.md

# v5.0 deliverable dirs to scan (the SC#1/SC#3 targets)
@/data/workspace/hermes-agent/skills/kais-movie-pipeline/SKILL.md
@/data/workspace/hermes-agent/plugins/kais_aigc/

# kais-movie-agent docs to clean up (SC#2 + cleanup objective)
@/data/workspace/kais-movie-agent/DEPRECATED.md
@/data/workspace/kais-movie-agent/SKILL.md
@/data/workspace/kais-movie-agent/INTEGRATION.md
@/data/workspace/kais-movie-agent/README.md

# Phase 37 precedent — the openclaw-grep test pattern to extend
@/data/workspace/hermes-agent/plugins/kais_aigc/tests/test_canvas_sync_integration.py

<interfaces>
DEPRECATED.md v5.0 final notice (target shape):

```markdown
# Deprecated — v5.0 Final Notice

**This repository is deprecated as of v5.0 (2026-06-26).**
**Final deprecation — no further development. Read-only archive.**

## Superseded By

**hermes-agent/skills/kais-movie-pipeline/** — the 13-step short-drama pipeline
is now a native hermes-agent skill. All orchestration is Python. Zero Node.js
runtime dependency. Zero openclaw / Toonflow dependency.

## Migration Guide

| Old location (v1.x–v4.x) | New location (v5.0) |
|--------------------------|---------------------|
| `lib/phases/*.js` (13 phase handlers) | `hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p01_*.py`–`p13_*.py` |
| `lib/canvas-sync-hook.js` | `hermes-agent/plugins/kais_aigc/canvas_sync.py` (event subscriber, Phase 37) |
| `lib/state/*.js` (PipelineStateStore + AssetBus) | `hermes-agent/plugins/pipeline_state/` |
| `lib/review-gate-*.js` | `hermes-agent/plugins/review_gates/` |
| `lib/clients/*.js` (gold-team / review / canvas / jimeng) | `hermes-agent/plugins/kais_aigc/{gold_team,review_platform,canvas,jimeng}.py` |
| Runner entry | `hermes-agent/skills/kais-movie-pipeline/pipeline/runner.py::run_episode` |

## Behavioral Equivalence

Phase 36 was a reference port — p04-p13 behavior aligns with Node.js V8.6
handler semantics (not a re-design). The 3 v5.0 cross-cutting constraints hold:

- Degrade-first: every external service call has a degrade path
- Canvas HTTP API v2 only (PIPE-INTEGRITY-01 preserved, no sqlite)
- CONSISTENCY_BLOCKED semantics on gate max_retries (PIPE-GUARD-01 preserved)

## Status

- Read-only archive (Git history preserved)
- v5.0 verification: 495 tests pass, 0 openclaw refs in deliverable dirs
- See `.planning/milestones/v5.0-MILESTONE-AUDIT.md` (Phase 39) for full audit
```

Regression test (target shape):

```python
# plugins/kais_aigc/tests/test_openclaw_decoupled.py
import re, pathlib

V5_DELIVERABLE_DIRS = [
    pathlib.Path("skills/kais-movie-pipeline"),
    pathlib.Path("plugins/kais_aigc"),
    pathlib.Path("plugins/pipeline_state"),
    pathlib.Path("plugins/review_gates"),
]
EXECUTABLE_SUFFIXES = {".py"}  # docs/.md not scanned for code refs
ABSENCE_DECL_RE = re.compile(r"no openclaw|no toonflow|not require openclaw|absence", re.I)

def test_openclaw_references_zero_in_v5_deliverables():
    """SC#1 + OPENCLAW-REMOVE-01."""
    pattern = re.compile(r'openclaw|toonflow|sessions_spawn\(runtime=["\']acp', re.I)
    hits = []
    for d in V5_DELIVERABLE_DIRS:
        for p in d.rglob("*"):
            if not p.is_file() or p.suffix not in EXECUTABLE_SUFFIXES:
                continue
            for i, line in enumerate(p.read_text(errors="ignore").splitlines(), 1):
                if pattern.search(line) and not ABSENCE_DECL_RE.search(line):
                    hits.append(f"{p}:{i}: {line.strip()}")
    assert not hits, f"SC#1 violation — openclaw/Toonflow code refs:\n{chr(10).join(hits)}"

def test_no_nodejs_runtime_dependency_in_v5_deliverables():
    """SC#3 + OPENCLAW-REMOVE-03."""
    pattern = re.compile(r'require\(|subprocess\.run\(\s*\[?\s*["\']node|import.*package\.json', re.I)
    # Same iteration, ABSENCE_DECL_RE applies
    ...
```
</interfaces>
</context>

<tasks>

This phase is a single sub-plan (38-01). Scope is small enough that decomposition would add overhead without parallelism benefit.

| Plan | Wave | Objective | Files |
|------|------|-----------|-------|
| 38-01 | 1 | (a) Add `test_openclaw_decoupled.py` regression test (SC#1 + SC#3), (b) rewrite DEPRECATED.md to v5.0 final notice (SC#2), (c) cleanup SKILL.md / INTEGRATION.md / README.md openclaw framing | 1 new test + 4 doc updates |

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Doc edits → reader | The migration guide in DEPRECATED.md is the canonical pointer for any future operator who needs to find the v5.0 code. Wrong paths = lost time. Mitigation: paths verified by `ls` before commit, regression test asserts the SKILL.md path string appears in DEPRECATED.md. |
| Regression test → future drift | The openclaw-grep test guards against accidental re-introduction of openclaw refs in future phases (39+) or v6.0. False positives (flagging absence-declarations) would erode trust. Mitigation: ABSENCE_DECL_RE pattern filters docstrings + "no openclaw" lines. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-38-01 | Info disclosure | Migration guide points to wrong path | mitigate | Verify every path with `ls` before commit; add `test_deprecated_md_points_to_live_skill` asserting `hermes-agent/skills/kais-movie-pipeline/SKILL.md` exists. |
| T-38-02 | DoS | Regression test is brittle (flags docstrings) | mitigate | ABSENCE_DECL_RE filter; only scan executable `.py` code, not `.md` docs. |
| T-38-03 | Repudiation | SKILL.md rewritten without preserving historical context | mitigate | Add HISTORICAL banner at top of rewritten docs; preserve v1.x/V8.6 sections under a clearly-marked "## Historical (v1.x–v4.x)" heading. |

No new packages, no Node.js bridges, no LLM code.
</threat_model>

<verification>
## Phase-level verification (after 38-01 completes)

```bash
# 1. Full v5.0 regression still green (no test breakage from doc edits)
cd /data/workspace/hermes-agent && python3 -m pytest skills/kais-movie-pipeline/tests/ plugins/kais_aigc/tests/ plugins/pipeline_state/tests/ plugins/review_gates/tests/ 2>&1 | tail -5
# Expect: 497+ passed (495 baseline + 2 new tests in test_openclaw_decoupled.py)

# 2. SC#1 — 0 openclaw refs in v5.0 deliverable dirs (executable code)
python3 -m pytest plugins/kais_aigc/tests/test_openclaw_decoupled.py::test_openclaw_references_zero_in_v5_deliverables -v
# Expect: PASSED

# 3. SC#3 — no Node.js runtime dependency in v5.0 deliverable dirs
python3 -m pytest plugins/kais_aigc/tests/test_openclaw_decoupled.py::test_no_nodejs_runtime_dependency_in_v5_deliverables -v
# Expect: PASSED

# 4. SC#2 — DEPRECATED.md updated to v5.0 final notice
grep -E "v5.0.*[Dd]eprecat|Superseded By|hermes-agent/skills/kais-movie-pipeline" /data/workspace/kais-movie-agent/DEPRECATED.md
# Expect: 3+ hits (v5.0 + Superseded By + skill path)

# 5. DEPRECATED.md migration guide points to a live file (T-38-01 mitigation)
test -f /data/workspace/hermes-agent/skills/kais-movie-pipeline/SKILL.md && echo "OK: skill path in DEPRECATED.md is live"

# 6. kais-movie-agent docs cleaned (no stale "OpenClaw is the only orchestrator" framing left)
grep -niE "openclaw.*唯一编排|toonflow.*审核页面" /data/workspace/kais-movie-agent/SKILL.md /data/workspace/kais-movie-agent/INTEGRATION.md /data/workspace/kais-movie-agent/README.md
# Expect: 0 hits OR hits only under a clearly-marked "## Historical" banner
```
</verification>

<success_criteria>
All 3 ROADMAP Phase 38 SC met:

1. **SC#1**: `grep -ri "openclaw|OpenClaw|sessions_spawn(runtime=\"acp\")|Toonflow"` returns 0 hits in executable code under `hermes-agent/skills/kais-movie-pipeline/`, `plugins/kais_aigc/`, `plugins/pipeline_state/`, `plugins/review_gates/`. Verified by: `test_openclaw_references_zero_in_v5_deliverables` PASSED (with absence-declaration filter for docstrings).

2. **SC#2**: `kais-movie-agent/DEPRECATED.md` updated to v5.0 final deprecation notice + migration guide. Verified by: doc contains "v5.0" + "Superseded By" + explicit `hermes-agent/skills/kais-movie-pipeline` path; the referenced SKILL.md exists on disk; migration table lists the 5 major component mappings (phases, canvas-sync, state, gates, clients).

3. **SC#3**: v5.0 deliverables (4 dirs) have no Node.js runtime dependency. Verified by: `test_no_nodejs_runtime_dependency_in_v5_deliverables` PASSED — scans for `require(`, `subprocess.run(...node)`, `import package.json` in executable code; zero hits. `package.json` not imported by any new v5.0 code.
</success_criteria>

<output>
Create `.planning/phases/38-openclaw-decoupling-docs-cleanup/38-01-SUMMARY.md` when the sub-plan completes.
Master SUMMARY (`.planning/phases/38-openclaw-decoupling-docs-cleanup/38-SUMMARY.md`) is created by the orchestrator after the sub-plan finishes (single-plan phase — master SUMMARY optional).
</output>

<source_audit>

## Multi-Source Coverage Audit (mandatory)

### GOAL (ROADMAP Phase 38 goal)
- "v5.0 所有交付物 0 openclaw 引用残留,DEPRECATED.md 更新,新代码无 Node.js runtime 依赖"
- **COVERED by:** Sub-plan 38-01 covers all three clauses (code grep test + DEPRECATED.md rewrite + Node.js runtime grep test)

### REQ (REQUIREMENTS.md phase_req_ids for Phase 38)
- **OPENCLAW-REMOVE-01** (0 grep hits in 4 dirs) → **38-01** `test_openclaw_references_zero_in_v5_deliverables`
- **OPENCLAW-REMOVE-02** (DEPRECATED.md v5.0 final notice + migration guide) → **38-01** DEPRECATED.md rewrite
- **OPENCLAW-REMOVE-03** (no Node.js runtime dependency, package.json not imported) → **38-01** `test_no_nodejs_runtime_dependency_in_v5_deliverables`
- **Coverage: 3/3 REQ IDs mapped. No gaps.**

### CONTEXT (decisions from CONTEXT.md)
All decisions covered:
- D-38-01 (single plan, no decomposition) → 38-01
- D-38-02 (rewrite DEPRECATED.md, not append v5.0 section) → 38-01
- D-38-03 (regression test in plugins/kais_aigc/tests/, scoped to v5.0 deliverable dirs) → 38-01
- D-38-04 (SKILL.md / INTEGRATION.md cleanup approach — HISTORICAL banner vs full rewrite) → 38-01
- D-38-05 (absence-declaration filter in grep test — don't flag docstrings) → 38-01

### Phase 37 carry-forward (CF-38-01)
- CF-38-01 (Phase 37 already verified 0 openclaw refs in canvas_sync/canvas_graph — Phase 38 extends this to all 4 dirs permanently via regression test) → **38-01**

**Audit result: 0 gaps. Plan set is complete.**
</source_audit>
