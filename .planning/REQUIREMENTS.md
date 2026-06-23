# Requirements — kais-movie-agent

> v2.0 milestone shipped 2026-06-22. This file is reset for the next milestone.
> Run `/gsd:new-milestone` to define v3.0 requirements.

## Active Requirements

(No active requirements — awaiting next milestone)

## Validated

See [PROJECT.md](./PROJECT.md) § "Validated" for the full list of shipped v1.0 + v2.0 requirements.

## Out of Scope (carry-forward to v3.0+)

- 真实 GPU E2E 验证(产出可播放 final.mp4)
- GLM-4V 真实 API key 验证(端到端评分质量)
- 分布式多机部署(Redis 队列 + N workers)
- TypeScript 迁移(至少 lib/ 核心模块)
- CI/CD pipeline(GitHub Actions)
- 资产指纹去重 + 跨剧集复用
- 镜头级 A/B 测试
- 失败 case 库 + bad case 黑名单
