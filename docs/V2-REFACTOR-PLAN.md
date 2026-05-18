# V2 架构重构计划

> 来源: Notion "架构V2" 页面
> 日期: 2026-05-18

## 七大核心变更

| # | 变更 | v1 问题 | v2 解法 |
|---|------|---------|---------|
| 1 | 剧本 AI 熔断 | scenario 无审核 | AI 五维评分，<60 阻断 |
| 2 | 音频驱动分镜 | voice 在 scene 后 | voice 前置到 storyboard 前 |
| 3 | 角色资产化 | character 无结构化传递 | character-assets.json 强制注入 |
| 4 | 美术圣经锁定 | art-direction 无机器约束 | art-bible.json 自动拼接前缀 |
| 5 | 动态预览熔断 | camera 直接高参 | preview(33f/10step) → final(81f/20step) |
| 6 | 场景按需生成 | scene 先批量 | scene 基于 shot-list 按需去重 |
| 7 | 结构化运镜 | storyboard 静态图 | shot-list.json 枚举运镜参数 |

## V2 管线顺序

```
1.requirement → 2.art-direction → 3.character → 4.scenario
    → 5.voice → 6.storyboard → 7.scene → 8.camera-preview
    → 9.camera-final → 10.post-production → 11.quality-gate → 交付
```

## 新增模块

1. `lib/asset-bus.js` — 跨 Phase 资产总线 (.pipeline-assets/)
2. `lib/prompt-injector.js` — Prompt 自动注入器
3. `lib/shot-list-parser.js` — 运镜指令解析器
4. `lib/ai-scorer.js` — 剧本 AI 五维评分

## 新增核心资产文件

- `art-bible.json` — 全局风格/光影/色彩/构图规则
- `character-assets.json` — 角色参考图 + core_prompt + LoRA + 种子
- `voice-timeline.json` — 台词时间轴 + 情绪标注 + 停顿点
- `shot-list.json` — 结构化运镜指令（枚举值）
- `scene-assets.json` — 场景背景图 + 光影设置

## 受控运镜词空间

- shot_size: extreme_wide | wide | medium | medium_close_up | close_up | extreme_close_up
- movement: static | push_in | pull_out | pan_left | pan_right | orbit_cw | dolly_left | crane_up
- angle: eye_level | low_angle | high_angle | dutch_tilt
- lens: 24mm | 35mm | 50mm | 85mm | 135mm

## 迁移顺序 (渐进式)

1. ✅ 新增 asset-bus.js + prompt-injector.js (纯新增)
2. ✅ scenario 增加 AI 评分
3. ✅ Phase 顺序调整: voice → storyboard 之前
4. ✅ camera 拆分: preview → final
5. ✅ storyboard 增加 shot-list 输出
6. 全量验证
