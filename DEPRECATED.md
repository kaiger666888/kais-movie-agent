# ⚠️ DEPRECATED

**This repository is deprecated as of v1.4 (2026-06-13).**

## Original Purpose

AI short-drama pipeline orchestrator — 14 sub-skills covering the full movie production pipeline.

## Why Deprecated

Explicitly retired in v1.3 milestone (CLN-01, CLN-02, CLN-03):

- Removed from `docker-compose.v9.yml` (zero references — verified by Phase 19 regression tests)
- All source code references removed from `kais-aigc-platform` and `kais-gold-team`
- Orchestration duties fully transferred to **OpenClaw Agent**

## Superseded By

**OpenClaw Agent** — the new orchestration layer that replaces movie-agent's 14 sub-skills.

## Status

- **Read-only archive.** No new development expected.
- **Git history preserved** for reference.
- **Not referenced** by any service in `docker-compose.v9.yml`.
- **Safe to physically archive** (move to `.archive/repos/` or delete) once any remaining reference is confirmed gone.

## See Also

- `/data/workspace/kais-aigc-platform/.planning/REPO-INVENTORY.md` — full sibling repo audit
- `/data/workspace/kais-aigc-platform/.planning/v1.3-MILESTONE-AUDIT.md` — v1.3 retirement verification
