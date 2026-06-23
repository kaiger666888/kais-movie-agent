# Requirements — kais-movie-agent

> v3.0 milestone shipped 2026-06-23. This file is reset for the next milestone.
> Run `/gsd:new-milestone` to define v3.1 requirements.

## Active Requirements

(No active requirements — awaiting next milestone)

## Validated

See [PROJECT.md](./PROJECT.md) § "Validated" for the full list of shipped v1.0 + v2.0 + v3.0 requirements.

## Out of Scope (carry-forward to v3.1+)

- 上游 creative_history lineage retrofit(script→sts→shot hash stamping)
- 真实 GPU E2E 验证(产出可播放 final.mp4)
- GLM-4.6V 50-pair golden set real-API baseline 校准
- Seedance 2.0 audio_refs API contract 验证 + 中文 lip sync 校准
- DINOv2 threshold calibration (50+50 real cross-episode pairs)
- LoRA training operator workflow(实际训练,本 milestone 只产 manifest)
- 跨 workdir manifest 合并
- Multi-LoRA composition(same episode 多角色 LoRA)
- 多模型 A/B 测试(Runway/Kling/Sora)
- 多平台导出 / 多语言 dubbing / 字幕烧录
- 分布式多机部署 / TypeScript 迁移 / CI/CD
