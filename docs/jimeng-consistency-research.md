# 即梦角色一致性方案调研报告

> 日期: 2026-06-18 | 方法: GSD (Goal-Structure-Decomposition) 深度调研
> 状态: 已落地到 kais-movie-agent 代码

## 执行摘要

**核心结论（3条）：**
1. **即梦 API 的 `/v1/images/compositions` 端点是角色一致性的关键武器**，`sample_strength` 参数控制参考图影响强度（0.3-0.6 推荐区间）
2. **Seedance 2.0 的 `omni_reference` 模式 + `@Image N` 标签是视频阶段角色一致性的最优解**，支持最多 9 图 + 3 视频 + 3 音频，身份锁定可达 95%+
3. **最佳实践是"双参考系统"：角色参考只传面部特写，智能参考传服装/姿势/场景**，不要混放

**关键数据：**
- 即梦图片 4.0/5.0 参考图模式，角色相似度 90-95%（社区实测）
- Seedance 2.0 omni_reference 模式，跨镜头一致性 95%+（官方 + 社区）
- 一张高质量正面参考图可撑 10+ 条视频
- 黄金比例：70% 身份参考 + 30% 动作参考

---

## 一、即梦 API 角色一致性能力全貌

### 图片生成：两个端点的差异

| 端点 | 用途 | 参考图支持 |
|------|------|-----------|
| `POST /v1/images/generations` | 文生图 | `images` 字段（软引导）|
| `POST /v1/images/compositions` | 图生图/图合成 | `images` + `sample_strength`（硬锚定）|

compositions 端点关键参数：
- `sample_strength`: 0.3（角色几乎不变）→ 0.4（推荐）→ 0.6（姿势可大幅变）

### 视频生成：Seedance 2.0 三种模式

| 模式 | 一致性 | 适用场景 |
|------|-------|---------|
| 文生视频 | ❌ 低 | 空镜/场景 |
| 图生视频 | ⚠️ 中 | 单镜头 |
| **omni_reference** | ✅ **最高** | **多角色/多场景** |

omni_reference 支持：最多 9 图 + 3 视频 + 3 音频，@Image/@Video/@Audio 绑定。

---

## 二、参考图黄金标准

| 维度 | 要求 | 原因 |
|------|------|------|
| 光线 | 柔和均匀 | 避免光影被当作角色特征 |
| 角度 | 正面或微侧（<30°） | 侧脸丢失半边五官信息 |
| 表情 | 中性，微闭嘴唇 | 大笑/皱眉会被锁定 |
| 背景 | 浅灰纯色（#D3D3D3） | 纯白可接受，严禁复杂背景 |
| 画质 | 高清，无压缩噪点 | 模糊图导致"网红脸化" |
| 遮挡 | 无墨镜、手托脸 | 遮挡物会被学习 |

---

## 三、L1-L4 分层资产库

```
L1 身份锚点 — 1-3张面部特写 → 角色参考入口，永不更换
L2 造型卡片 — 每套服装正面+侧面 → 智能参考入口
L3 姿势包 — 坐/站/走/跑 → 智能参考
L4 表情标定 — 微笑/怒/惊/泪 → 智能参考（表情戏时）
```

核心原则：一造型一卡片，不混放。

---

## 四、双参考系统

| 入口 | 内容 | 作用 |
|------|------|------|
| 角色参考 | 1-3张**面部特写** | 建立「角色ID」 |
| 智能参考 | 服装/姿势/风格图 | 传递造型、道具 |

原则：角色参考只传脸，智能参考传衣服和姿势。

---

## 五、标准工作流

### 定妆与建库
1. 文生图 20 张候选 → 选出 3 张面部特写 → L1 身份锚点
2. 以 L1 为参考，compositions API 生成每套服装全身图 → L2 造型卡片

### 分镜首帧生成
1. compositions API，images=[L1, L2]，sample_strength=0.4
2. prompt 只写动作/场景/镜头，**零面部描述**

### 视频生成
1. Seedance 2.0 omni_reference
2. @Image1~3: L1 身份锚点（70% 权重）
3. @Image4~6: 分镜首帧 + L2 造型卡片（30%）
4. prompt 零面部描述

---

## 六、避坑指南

| 崩坏场景 | 原因 | 解决方案 |
|----------|------|---------|
| 大动作面部变形 | 动态记忆追踪极限 | 减少全身剧烈运动 prompt |
| 换场景肤色漂移 | 环境光影响 | prompt 加 keep skin tone exactly same |
| 风格化过强 | 风格特征稀释身份 | 写实风最稳；风格化降低强度 |
| 多角色同框串脸 | 多主体控制局限 | 拆分单人镜头后期拼接 |
| 批量生成网红脸 | 模型倾向安全面部 | 每次都用同一 L1 参考图 |

---

## 七、已落地改动

### 新增文件
- `lib/jimeng-client.js` — 新增 `compositions()` + `omniReferenceVideo()` 方法
- `lib/character-asset-manager.js` — L1/L2/L3/L4 分层资产管理器
- `lib/reference-prompt-builder.js` — 角色一致性 prompt 模板系统
- `docs/jimeng-consistency-research.md` — 本报告

### 更新文件
- `lib/invariant-bus.js` — 扩展 L1/L2 分层资产支持 + 快捷访问方法
- `lib/prompt-injector.js` — V3: 零面部描述策略 + @Image 绑定支持
- `lib/continuity-auditor.js` — V3: L1 锚点基准对比 + auditImageVsL1()
- `lib/phases/index.js` — HERMES_DEFAULTS 更新（L1-L2 策略 + omni_reference 配置）
- `skills/kais-character-designer/SKILL.md` — 完全重写为双参考系统策略
- `README.md` — 更新架构文档

---

## 来源

1. iptag/jimeng-api — 即梦逆向 API 文档
2. Atlas Cloud: Seedance 2.0 全能参考指南
3. Morphic: Seedance 2.0 完整指南
4. EvoLink: Seedance 2.0 真人视频 API 指南
5. 即梦4.0知乎评测
6. 觉醒学院：即梦AI 3步搞定人物一致性
7. AI视频角色一致性论坛讨论
8. 人人都是产品经理：AI视频控制主体一致性
