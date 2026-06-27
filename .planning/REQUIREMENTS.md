# Requirements: (next milestone — pending)

**Status:** v6.0 SHIPPED 2026-06-27. No active milestone.
**Next step:** Run `/gsd:new-milestone <name>` to define the next milestone.

## v6.0 Archive

v6.0 requirements archived at [milestones/v6.0-REQUIREMENTS.md](./milestones/v6.0-REQUIREMENTS.md) — 19/19 REQs satisfied.

## v7.0+ Backlog (2026-06-27 v6.0 ship)

### A. v7.0 结构性候选(v6.0 让它们更容易做)
- **TD-v3-1 上游 creative_history lineage retrofit** — v3.0 旗舰的最后一公里(script→sts→shot hash stamping)
- **hermes-agent dashboard 内嵌管线可视化** — 替代 :10588 canvas 部分依赖
- **Recipe auto-application to p10b** — v6.0 RECIPE-LIB 跑通后,可在 p03 script_design 阶段自动推荐 converged 配方(operator 可 override)。需观察 v6.0 配方库数据沉淀质量再决定。

### B. 待需求触发 — 技术上不难,但要看实际分发场景
- 多模型 A/B(Runway/Kling/Sora) — 真做对比评测时
- 多平台导出(抖音 9:16 / B站 16:9 / YouTube 横屏) — 真发多平台时
- 多语言 dubbing(HeyGen) — 真做出海时
- 字幕生成 + 烧录 + 多语言 SRT — 真需要字幕时

> 不要现在画饼。等"我真的需要发 B 站 / 做英文版 / 对比 Kling"那天再各开一个 phase。

### C. 已砍掉(v5.0 后冗余或归属错误)
- ~~独立 lip sync phase~~ — Seedance 2.0 在 p11 内建,冗余
- ~~分布式多机部署~~ — 归 kais-aigc-platform 仓库

---
*Requirements defined: (pending next milestone)*
*v6.0 shipped 2026-06-27 — see milestones/v6.0-REQUIREMENTS.md for archive*
