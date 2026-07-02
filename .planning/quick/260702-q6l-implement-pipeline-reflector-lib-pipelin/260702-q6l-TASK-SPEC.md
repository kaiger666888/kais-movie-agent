# Quick Task 260702-q6l: Pipeline Reflector — 管线反思器 - Task Spec

**Captured:** 2026-07-02
**Status:** Ready for planning

## 任务总述

实现 kais-movie-agent V8.6 管线的反思器：从已积累的驳回/评价/失败数据中提取教训，生成结构化优化建议队列，操作者审核通过后应用到下次管线运行，形成元层面的自我进化闭环。

**核心原则：不自动修改管线** —— 所有 suggestion 必须人工 approve 后才 apply。

## 涉及仓库

- 主仓: `/data/workspace/kais-movie-agent` (Node.js ESM 项目)
- 副仓: `/data/workspace/kais-aigc-platform` (TypeScript Express 后端)

## 现有数据源（已实装，直接可用）

1. **kv_assetFeedback 表** (kais-aigc-platform MySQL) — 画布反馈 `{id, assetId, projectId, score, verdict(approve/reject/contest/note), content, tags, source, reviewer, status, createdAt, resolvedAt}`
2. **kv_audit 表** — 审核记录 `{id, projectId, action(review:approve/review:reject), result, detail("[phase] reviewId=X shotId=Y feedback=\"...\""), createTime}`
3. **reviewStatus mapping** (o_agentWorkData 表, key=`reviewStatus-{episodesId}`) — `{nodeId: {reviewStatus, rejectReason, isWinner}}`
4. **failed-shots slot** — `{workdir}/.pipeline-assets/failed-shots.json` — `{failures: [{shot_id, error, timestamp, run_id, prompt, fingerprints}], version}`
5. **evaluations.json** — `{workdir}/.pipeline-assets/evaluations.json` — `{task_id, phase, task_type, gpu_time_sec, peak_vram_gb, success, retry_count, ai_quality_score, human_cinematic, human_motion, human_consistency, parameters_used}`
6. **creative-history slot** — `{workdir}/.pipeline-assets/creative-history.json` — `{shots: [{shot_id, source_hash, derived_from, content_hash, timestamp}], version}`

## 架构设计

```
多源数据 → DataAggregator (按phase分组) → ReflectionLLM (识别模式) → SuggestionStore (pending队列)
                                                                              ↓
                                                          操作者 approve → ApplySuggestion
                                                              ├── prompt_modification
                                                              ├── threshold_adjustment
                                                              ├── parameter_change
                                                              └── workflow_redesign
```

## 文件清单（严格按此执行）

### 新建文件

#### 1. `/data/workspace/kais-movie-agent/lib/pipeline-reflector.js`

核心反思器模块 (ES Module, `export class PipelineReflector`)。

**关键方法**:
- `constructor(workdir, opts = {})` — 接收 workdir、episodeId、dbHelper(可选注入)、projectId、lookbackDays(默认30)
- `async aggregate()` — 聚合 6 个数据源，按 phase 分组返回 `{byPhase: {...}, crossPhase: {...}}`
- `async reflect(aggregatedData)` — 构建 prompt → 调用 `callLLM()` (from `./hermes-adapter.js`) → 解析 JSON
- `async storeSuggestions(reflections)` — 追加写入 `reflection-suggestions.jsonl`，每条带 `status:'pending', createdAt`
- `async readPendingSuggestions()` — 读取所有 pending 建议
- `async approveSuggestion(id)` — 根据 type 应用修改，写入 `reflection-applied.jsonl`，更新 status
- `async rejectSuggestion(id, reason)` — 更新 status='rejected' + reason
- `async readAppliedSuggestions()` — 管线启动时调用
- `async run()` — aggregate → reflect → store 的完整流程

**常量**:
```js
const SUGGESTIONS_FILE = 'reflection-suggestions.jsonl';
const APPLIED_FILE = 'reflection-applied.jsonl';
const REFLECTION_HISTORY = 'reflection-history.json';
```

**反思 prompt 模板**（中文，要求 LLM 返回纯 JSON）:
```
你是一个 AI 短剧创作管线的反思分析专家。你的任务是从历史驳回和评价数据中提取规律性的教训，提出具体的管线优化建议。

## 数据摘要
{aggregated_stats}
## 典型驳回案例
{recent_rejects_with_details}
## 失败技术数据
{failed_shots_summary}
## GPU 评估数据
{evaluation_summary}

## 分析要求
1. 重复模式 2. 根因推测 3. 可操作性 4. 优先级

## 输出格式 (只输出 JSON)
{ "reflections": [{ "id", "phase", "pattern", "evidence":[...], "severity":"high|medium|low", "confidence":0-1, "suggestion": { "type":"prompt_modification|threshold_adjustment|parameter_change|workflow_redesign", "target", "change", "expected_impact" } }], "summary": "..." }
```

**apply 策略** (在 approveSuggestion 中):
- `prompt_modification`: 在 target 文件中追加注释行标记 reflection-applied，或在专用 prompt-overrides 文件追加 override (推荐：写 `{workdir}/.pipeline-assets/prompt-overrides.json`，由 phases/index.js 注入)
- `threshold_adjustment`: 修改 `gate-config.yaml` (或写 override 文件)
- `parameter_change` / `workflow_redesign`: 仅记录到 applied.jsonl，由人工执行
- 实现优先级：先支持写入 override 文件，避免直接修改源码

#### 2. `/data/workspace/kais-aigc-platform/src/routes/v1/reflection/index.ts`

后端 API 路由 (Express, `default export`)。

**Endpoints**:
```
POST /api/v1/reflection/run          — 触发反思 (调用 PipelineReflector.run())
GET  /api/v1/reflection/pending       — 读取 pending 建议列表
POST /api/v1/reflection/approve/:id   — 批准并应用
POST /api/v1/reflection/reject/:id    — 拒绝
GET  /api/v1/reflection/history       — 读取历史
GET  /api/v1/reflection/applied       — 读取已应用建议
```

**实现细节**:
- 使用项目的 u.db helper 查询 MySQL (参考 src/routes/v1/feedback/index.ts 或 review-result.ts)
- 跨仓库调用 kais-movie-agent 的 PipelineReflector：通过 `child_process.spawn('node', ['-e', ...])` 或读取共享 .pipeline-assets 目录
- 简化方案：API 只负责 DB 查询，把 PipelineReflector 实例化时注入 dbHelper

#### 3. `/data/workspace/kais-movie-agent/test/pipeline-reflector.test.mjs`

`node --test` 单元测试，覆盖：
- mock 6 个数据源 → aggregate() 正确分组
- mock callLLM 返回固定 JSON → reflect() 正确解析
- storeSuggestions → 文件格式正确
- readPendingSuggestions → 过滤 pending
- approveSuggestion → apply + 状态更新
- rejectSuggestion → 状态更新

### 修改文件

#### 4. `/data/workspace/kais-aigc-platform/src/router.ts`

注册新路由。**重要约束:**
- import 名: `routeReflect` (描述性名，**不要重用数字编号**)
- 路径: `app.use("/api/v1/reflection", routeReflect)`
- 在合适位置插入 import 和 use，不要打乱已有路由顺序

#### 5. `/data/workspace/kais-movie-agent/lib/phases/index.js`

管线启动时注入已应用的反思建议：
- import PipelineReflector from '../pipeline-reflector.js'
- 在管线初始化阶段调用 `reflector.readAppliedSuggestions()`
- 注入到 prompt 生成器 (打印日志说明已应用 N 条建议)
- 失败 (无文件、读取错误) 不影响管线运行 — 静默降级

## 实现约束

1. **不自动修改管线** — 所有 suggestion 必须人工 approve 后才 apply
2. **不阻塞管线** — 反思是离线/异步操作
3. **LLM 调用复用** — 使用 `lib/hermes-adapter.js` 的 `callLLM()`
4. **数据库访问** — 通过注入的 dbHelper (kais-aigc-platform 端)，或通过 HTTP API
5. **数据格式** — JSONL (append-friendly)
6. **ES Module** — 全部用 import/export
7. **代码风格** — 参考 lib/evaluation-collector.js 和 lib/quality-gate.js
8. **零新依赖** — 不引入新的 npm 包

## 验证步骤

1. `node -e "import('./lib/pipeline-reflector.js').then(m => console.log('OK'))"` — 模块加载
2. mock 数据运行 `PipelineReflector.run()` — 完整流程
3. `node --test test/pipeline-reflector.test.mjs` — 单元测试通过
4. router.ts git diff — 确认没改变已有路由绑定
5. 验证 phases/index.js 注入逻辑：构造 applied suggestions 文件，启动管线，确认日志打印

## 风险与注意事项

- **跨仓库**: kais-aigc-platform 是 TypeScript 项目，kais-movie-agent 是 ESM JavaScript。PipelineReflector 必须能在 kais-movie-agent 独立运行，后端 API 通过子进程或共享文件触发
- **callLLM 接口**: planner/executor 必须先读 `lib/hermes-adapter.js` 确认 callLLM 签名 (prompt, opts) => string
- **数据库注入**: dbHelper 注入是可选的 — 若未提供，aggregate() 跳过 DB 数据源，只用本地 .pipeline-assets 文件
- **prompt override 机制**: 为避免直接改源码，建议 approveSuggestion 写入 `{workdir}/.pipeline-assets/prompt-overrides.json`，由 phases/index.js 读取并合并到 prompt 生成
