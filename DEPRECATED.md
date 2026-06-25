# Deprecated — v5.0 Final Notice

**This repository is deprecated as of v5.0 (2026-06-26).**
**Final deprecation — no further development. Read-only archive.**

## Superseded By

**[`hermes-agent/skills/kais-movie-pipeline/`](../hermes-agent/skills/kais-movie-pipeline/)** — the 13-step short-drama pipeline is now a native hermes-agent skill.

- All orchestration is Python.
- Zero Node.js runtime dependency.
- Zero openclaw / Toonflow dependency.

The v1.4 partial deprecation notice (which claimed orchestration had moved to
"OpenClaw Agent") is itself superseded — v5.0 reversed that framing. The
pipeline is now hermes-native with no external orchestration layer.

## Migration Guide

Every path below is verified live on disk as of 2026-06-26.

| Old location (v1.x–v4.x) | New location (v5.0) |
|--------------------------|---------------------|
| `lib/phases/*.js` (13 phase handlers) | `hermes-agent/skills/kais-movie-pipeline/pipeline/phases/p01_*.py`–`p13_*.py` |
| `lib/canvas-sync-hook.js` | `hermes-agent/plugins/kais_aigc/canvas_sync.py` (event subscriber, Phase 37) |
| `lib/state/*.js` (PipelineStateStore + AssetBus, incl. `lib/asset-bus.js`) | `hermes-agent/plugins/pipeline_state/` |
| `lib/review-gate-*.js` | `hermes-agent/plugins/review_gates/` |
| `lib/clients/*.js` (gold-team / review / canvas / jimeng) | `hermes-agent/plugins/kais_aigc/{gold_team,review_platform,canvas,jimeng}.py` |
| Runner entry | `hermes-agent/skills/kais-movie-pipeline/pipeline/runner.py::run_episode` |

### Entry point

```bash
# From hermes-agent repo root
python3 -m skills.kais_movie_pipeline.pipeline.runner
# or
python3 skills/kais-movie-pipeline/pipeline/runner.py
```

`run_episode()` in `runner.py` is the canonical entry point — replaces the old
Node.js `lib/pipeline-runner.js`.

## Behavioral Equivalence

Phase 36 was a reference port of all 13 phases — p04-p13 behavior aligns with
the Node.js V8.6 handler semantics (not a re-design). The 3 v5.0 cross-cutting
constraints hold:

- **Degrade-first**: every external service call has a degrade path (no hard
  failure on transient outages).
- **Canvas HTTP API v2 only**: `PIPE-INTEGRITY-01` preserved — no sqlite,
  direct Canvas HTTP API subscription.
- **CONSISTENCY_BLOCKED semantics** on gate `max_retries`: `PIPE-GUARD-01`
  preserved — consistency failures block progression, not silently skip.

The V8.6 behavioral contract is documented in `kais-movie-agent/SKILL.md`
(preserved under a HISTORICAL banner as the v5.0 reference contract).

## Status

- **Read-only archive.** Git history preserved. No new development.
- **v5.0 verification**: 495 baseline tests pass (498 after Phase 38 adds the
  decoupling regression test). Zero openclaw / Toonflow references in the 4
  v5.0 deliverable dirs (asserted by
  `plugins/kais_aigc/tests/test_openclaw_decoupled.py`).
- **Physical archival** (move to `.archive/repos/` or delete) is an operator
  decision to make after v5.0 ships — the repo is safe to leave in place.
- **See** `.planning/milestones/v5.0-MILESTONE-AUDIT.md` (Phase 39) for the
  full v5.0 milestone audit.

## See Also

- `kais-movie-agent/SKILL.md` — HISTORICAL V8.6 behavioral contract (preserved
  as Phase 36 port reference).
- `kais-movie-agent/INTEGRATION.md` — V1.0 integration snapshot (historical).
- `.planning/phases/38-openclaw-decoupling-docs-cleanup/38-01-SUMMARY.md` —
  Phase 38 execution summary (this deprecation rewrite).
