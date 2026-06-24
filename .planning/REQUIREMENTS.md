# Requirements — kais-movie-agent

> **v4.0 milestone shipped 2026-06-24.** This file is reset for the next milestone.
> Run `/gsd:new-milestone` to define v5.0 requirements.

## Active Requirements

(No active requirements — awaiting next milestone)

## Validated

See [PROJECT.md](./PROJECT.md) § "Validated" for the full list of shipped v1.0 + v2.0 + v3.0 + v4.0 requirements.

## Out of Scope (carry-forward to v5.0+)

- 上游 creative_history lineage retrofit(script→sts→shot hash stamping) — 原 v3.1 backlog (TD-v3-1)
- 真实 GPU E2E 验证(产出可播放非占位 master.mp4) — operator 侧 (W-v3-1~6 carry-forward)
- bin/pipeline.js CLI surface improvements (--to flag, status improvements) — v4.0 audit noted
- jimeng → dreamina CLI full migration (when platform provides) — v4.0 fallback-only marking in place
- LoRA training operator workflow(实际训练,v3.0 只产 manifest) — operator 侧
- 跨 workdir manifest 合并 / Multi-LoRA composition
- 多模型 A/B 测试(Runway/Kling/Sora) / 多平台导出 / 多语言 dubbing / 字幕烧录
- 分布式多机部署 / TypeScript 迁移 / CI-CD
