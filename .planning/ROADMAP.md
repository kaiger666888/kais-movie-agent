# Roadmap: kais-movie-agent 集成开发

## Milestones

- ✅ **v1.0 AIGC Integration** — Phases 1-9 (shipped 2026-05-18)
- ✅ **v2.0 Pipeline Remediation** — Phases 10-18 (shipped 2026-06-22) — [Archive](./milestones/v2.0-ROADMAP.md)
- ✅ **v3.0 Industrial Pipeline Alignment** — Phases 19-25 (shipped 2026-06-23) — [Archive](./milestones/v3.0-ROADMAP.md)
- ✅ **v4.0 Production Pipeline Remediation** — Phases 26-30 (shipped 2026-06-24) — [Archive](./milestones/v4.0-ROADMAP.md)

## Phases

<details>
<summary>✅ v4.0 Production Pipeline Remediation (Phases 26-30) — SHIPPED 2026-06-24</summary>

- [x] Phase 26: Data Spine Repair (PIPE-DATA-01/02)
- [x] Phase 27: Real Render Path Restoration (PIPE-RENDER-01/02)
- [x] Phase 28: Cross-System Integrity & Safety Hardening (PIPE-INTEGRITY-01/02)
- [x] Phase 29: Composition Tail + Quality Gate Activation (PIPE-COMPOSE-01/02, PIPE-GUARD-01)
- [x] Phase 30: End-to-End Shipping Verification (acceptance gate)

Full details: [v4.0-ROADMAP.md](./milestones/v4.0-ROADMAP.md)

</details>

<details>
<summary>✅ v3.0 Industrial Pipeline Alignment (Phases 19-25) — SHIPPED 2026-06-23</summary>

- [x] Phase 19: callLLM 重构 + GLM-4.6V 升级 (D1-01~04) — BLOCKER
- [x] Phase 20: AssetBus Schema 扩展 (SCHEMA-01~03) — keystone
- [x] Phase 21: BlacklistEngine + bad case 持久化 (B5-01~06)
- [x] Phase 22: Seedance 2.0 Audio-Visual Sync (A2-01~05)
- [x] Phase 23: CreativeHistoryTracker (B4-01~06) — flagship
- [x] Phase 24: CrossEpisodeAssetIndex (B2-01~06) — parallel track
- [x] Phase 25: FineTuningETL (B6-01~06) — highest-risk

Full details: [v3.0-ROADMAP.md](./milestones/v3.0-ROADMAP.md)

</details>

<details>
<summary>✅ v2.0 Pipeline Remediation (Phases 10-18) — SHIPPED 2026-06-22</summary>

- [x] Phase 10-18: v2.0 remediation (see archive)

</details>

<details>
<summary>✅ v1.0 AIGC Integration (Phases 1-9) — SHIPPED 2026-05-18</summary>

- [x] Phase 1-9: AIGC integration (see archive)

</details>

## Next Milestone

Not yet planned. Run `/gsd:new-milestone` to start v5.0.

Candidate themes (from PROJECT.md):
- 上游 creative_history lineage retrofit (TD-v3-1, unblock full Git-for-AIGC-movies)
- 多模型 A/B 测试 (Runway/Kling/Sora)
- 多平台导出 / 多语言 dubbing / 字幕烧录
- 独立 lip sync phase (sync.so / HeyGen as Seedance fallback)
- bin/pipeline.js CLI surface improvements (--to flag, status improvements)
