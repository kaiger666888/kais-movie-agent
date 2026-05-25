# kais-movie-agent × Hermes 集成开发计划

> 创建: 2026-05-25
> 状态: **规划中**

## 一、现状分析

### 已完成

| 层级 | 状态 | 说明 |
|------|------|------|
| hermes-adapter.js | ✅ 已实现 | LLM 调用路由（Hermes 优先 → ZHIPU 降级） |
| hermes-client.js | ✅ 已实现 | decide/audit HTTP 客户端 |
| phases/index.js | ⚠️ 部分集成 | soul-voice、spatio-temporal-script 等 4 个 phase 有 `_hermesDecide` 调用 |
| OpenClaw hermes tools | ✅ 可用 | hermes_llm/hermes_llm_vision/hermes_plan/hermes_reflect/hermes_memory/hermes_learn/hermes_evolve |
| hermes-worker-agent | ⚠️ 代码完成 | TypeScript 项目，有 MCP bridge、executor、personas、queue、storage，**但未运行** |

### 未完成 / 断裂点

1. **hermes-worker-agent 未部署**：代码在 `workspace/hermes-worker-agent/`，但 `localhost:3100` 无服务运行
2. **decide/audit 接口断裂**：`hermes-client.js` 调用 `/decide` 和 `/audit`，但 hermes-worker-agent 只有 `/tasks` 路由，**没有 decide/audit 路由**
3. **Replay 系统缺失**：REQUIREMENTS.md 规划了三层系统，但代码中无实现
4. **Evaluation 数据缺失**：GPU 任务完成后无结构化评估写入
5. **Skill Graph 缺失**：仅 JSON 设计文档，无实现
6. **OpenClaw hermes tools 未被 movie-agent 使用**：movie-agent 通过 HTTP 直连 hermes-worker-agent，绕过了 OpenClaw 内置的认知工具

### 架构问题

```
当前流程（断裂）:
movie-agent pipeline → hermes-client.js → HTTP :3100/decide → ❌ 无此路由

期望流程:
movie-agent pipeline → OpenClaw hermes tools → hermes-cognitive → decide/memory/reflect/learn
                         ↓（并行）
                    hermes-worker-agent → 任务队列 → executor → personas → skill evolution
```

---

## 二、开发计划

### Phase A: 决策通道打通（P0，1-2天）

**目标**：movie-agent 每个管线的 GPU 参数决策都能走 Hermes 认知系统

#### A1: hermes-client.js 适配 OpenClaw 内置工具

当前 `hermes-client.js` 用 HTTP 直连 hermes-worker-agent，但 hermes-worker-agent 未运行。
改为调用 OpenClaw 内置的 hermes-cognitive 工具：

```javascript
// 新增: hermes-openclaw-client.js
// 通过 OpenClaw session 注入的方式调用 hermes tools
// hermes_plan → 决策（替代 /decide）
// hermes_reflect → 审计（替代 /audit）
// hermes_memory → 经验存取
// hermes_learn → 学习提案
```

**具体步骤**：
1. 创建 `lib/hermes-openclaw-client.js`
2. 实现 `decide(phase, context)` → 映射到 `hermes_plan` + `hermes_memory` 读取历史经验
3. 实现 `audit(phase, decisionId, metrics)` → 映射到 `hermes_reflect` + `hermes_memory` 写入评估
4. 修改 `phases/index.js` 中的 `_makeHermesClient()` 使用新客户端
5. 保留 `hermes-client.js` 作为 HTTP fallback（未来 hermes-worker-agent 部署后可用）

#### A2: 每个 Phase 接入 Hermes 决策

当前只有 4 个 phase 接入 Hermes，需扩展到全部 10 个：

| Phase | 决策类型 | Hermes 工具 | 参数空间 |
|-------|---------|-------------|---------|
| requirement-bible | 选题策略 | hermes_plan + hermes_memory | 目标受众、题材匹配度 |
| soul-visual | 视觉参数 | hermes_plan | FLUX variant/size/steps/guidance |
| soul-voice | 音色参数 | hermes_plan | 音色风格、语速、情感基调 |
| geometry-bed | 3D生成参数 | hermes_plan | 模型选择、精度、格式 |
| spatio-temporal-script | 剧本结构 | hermes_plan + hermes_reflect | 镜头时长、转场节奏 |
| seed-skeleton | 音画骨架 | hermes_plan | BGM策略、对白节奏、SFX触发点 |
| motion-preview | 运镜参数 | hermes_plan | camera运动类型、速度、焦距 |
| ai-preview | 风格化参数 | hermes_plan + hermes_memory | wan参数、帧数、步数 |
| final-production | 终版参数 | hermes_plan | 高质量渲染参数 |
| composition | 合成策略 | hermes_plan + hermes_reflect | 转场、调色、音画同步 |

---

### Phase B: 评估数据闭环（P1，2-3天）

**目标**：每个 GPU 任务完成后自动采集评估数据，写入 Hermes 记忆

#### B1: 评估数据模型

```javascript
// lib/evaluation-collector.js
{
  task_id, phase, task_type,
  timestamp,
  // GPU 指标
  gpu_time_sec, peak_vram_gb, success, retry_count,
  // 质量指标（人工 + AI）
  human_cinematic, human_motion, human_consistency,
  ai_quality_score,
  // Hermes 决策关联
  hermes_decision_id, hermes_confidence,
  // 使用的参数
  parameters_used,
  // 产出物路径
  output_path,
}
```

#### B2: 自动采集钩子

在 `phases/index.js` 每个 phase 的 after 钩子中：
1. 采集 GPU 执行指标（从 gold-team-client 返回值提取）
2. 调用 `hermes_reflect` 进行自动反思
3. 调用 `hermes_memory` 写入经验（scope=expert, expert_id=kais-movie-agent）
4. 如果质量评分低于阈值，自动调用 `hermes_learn` 生成改进提案

#### B3: 质量门控增强

`lib/quality-gate.js` 的 6 维度评分完成后：
- 将评分结果同步到 Hermes 记忆
- 用 `hermes_llm_vision` 对产出物做视觉评估（替代 `scene-evaluator.py`）

---

### Phase C: 经验学习系统（P2，3-5天）

**目标**：跨项目的经验积累和自动优化

#### C1: 经验记忆结构

通过 `hermes_memory` 建立三层记忆：

```
scope=expert, expert_id=kais-movie-agent
  ├─ phase-experiences/{phase_id}
  │   ├─ 成功案例（评分 ≥ 4 的参数组合）
  │   ├─ 失败案例（评分 < 3 的参数组合）
  │   └─ 推荐参数（加权平均）
  ├─ gpu-performance/{task_type}
  │   ├─ 平均耗时
  │   ├─ OOM 风险参数
  │   └─ 最优 batch size
  └─ style-presets/{style_name}
      ├─ 风格锚点参数
      ├─ 推荐模型组合
      └─ 历史评分
```

#### C2: 决策优化循环

```
1. 新任务开始 → hermes_memory 读取历史经验
2. hermes_plan 生成决策 → 注入历史最优参数
3. 执行 → 采集评估数据
4. hermes_reflect 反思 → 提取改进建议
5. hermes_memory 写入新经验
6. 定期 hermes_learn → 蒸馏最佳实践
7. hermes_evolve → 进化管理（需人类审批）
```

#### C3: 跨项目知识迁移

通过 Hermes 全局记忆实现：
- kais-movie-agent 的视觉参数经验 → 可被 kais-parallax-scene 借鉴
- kais-blender-engine 的 3D 渲染经验 → 可被 geometry-bed phase 借鉴
- 统一的质量评估标准 → 跨项目可比

---

### Phase D: hermes-worker-agent 对接（P3，5-7天）

**目标**：将 hermes-worker-agent 作为独立认知引擎部署和对接

#### D1: 补齐 decide/audit API

在 hermes-worker-agent 中新增：
```typescript
// src/api/routes/hermes-cognitive.ts
POST /decide   → 路由到 router.ts + persona 选择
POST /audit    → 写入 evaluation store + 触发 skill extraction
GET  /memory   → 读取 skill memory
POST /learn    → 触发 learning cycle
```

#### D2: 部署 hermes-worker-agent

```bash
# 1. 编译 TypeScript
cd workspace/hermes-worker-agent && npm run build

# 2. Docker 部署或直接运行
node dist/index.js

# 3. 配置端口 3100
```

#### D3: 双通道路由

movie-agent 同时支持：
- **快速路径**：OpenClaw 内置 hermes tools（同步调用，低延迟）
- **深度路径**：hermes-worker-agent HTTP（异步队列，支持复杂认知任务）

---

## 三、优先级排序

| 优先级 | Phase | 工作量 | 价值 |
|--------|-------|--------|------|
| **P0** | A1-A2 | 1-2天 | 打通决策通道，立即可用 |
| **P1** | B1-B3 | 2-3天 | 数据闭环，开始积累经验 |
| **P2** | C1-C3 | 3-5天 | 学习系统，自动优化 |
| **P3** | D1-D3 | 5-7天 | 独立认知引擎，长期架构 |

**建议执行顺序**：A → B → C → D

---

## 四、A Phase 详细任务清单

### A1: hermes-openclaw-client.js

- [ ] 创建 `lib/hermes-openclaw-client.js`
- [ ] 实现 `decide(phase, context)` 方法
  - 从 hermes_memory 读取该 phase 历史经验
  - 调用 hermes_plan 生成结构化决策
  - 返回 `{ params, decisionId, confidence }`
- [ ] 实现 `audit(phase, decisionId, metrics)` 方法
  - 调用 hermes_reflect 进行反思
  - 将评估结果写入 hermes_memory
- [ ] 实现 `queryMemory(phase, query)` 方法
  - 读取历史最优参数
- [ ] 单元测试

### A2: 全 Phase 接入

- [ ] 修改 `_makeHermesClient()` 使用 OpenClaw 客户端
- [ ] 10 个 phase handler 全部接入 hermes decide
- [ ] 保留降级逻辑（hermes 不可用时用 HERMES_DEFAULTS）
- [ ] 集成测试

---

## 五、技术决策

| 决策 | 选择 | 原因 |
|------|------|------|
| LLM 调用路由 | hermes-adapter.js（已实现） | Hermes 优先 → ZHIPU 降级 |
| 决策引擎 | OpenClaw hermes-cognitive tools | 已内置，无需额外部署 |
| 记忆存储 | hermes_memory（scope=expert） | 统一管理，支持跨项目 |
| 学习引擎 | hermes_learn + hermes_evolve | 提案制，需人类审批 |
| 长期架构 | hermes-worker-agent 独立服务 | 支持异步队列和复杂任务 |

---

## 六、风险和缓解

| 风险 | 概率 | 缓解 |
|------|------|------|
| OpenClaw hermes tools 调用延迟高 | 中 | 降级到 HERMES_DEFAULTS 硬编码参数 |
| hermes_memory 容量限制 | 低 | 定期 consolidation，只保留高分经验 |
| Phase 参数空间不匹配 | 中 | A Phase 先用 hermes_plan 生成，逐步收敛参数模板 |
| hermes-worker-agent 部署复杂 | 高 | P0-P2 先用 OpenClaw 内置工具，P3 再对接独立服务 |
