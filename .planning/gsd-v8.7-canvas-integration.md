# GSD Blueprint: kais-movie-agent V8.7 — 无限画布全管线集成

> 版本: v8.7 · 日期: 2026-06-19 · 方法论: theory_critic + compliance_gate 双专家审视 · 范围: CanvasClient ↔ OpenClaw 管线 ↔ SKILL.md ↔ 前端深链
> 配套: 本蓝图已对原始需求做**真相校正**(见 §0)。所有结论基于实测代码与运行态，非假设。

---

## §0 ⚠️ 真相校正（必读：原始需求中 3/5 条前提已被实测推翻）

设计蓝图前，我对 `kais-aigc-platform` 与 `kais-movie-agent` 两仓做了实测。原始 GSD 需求的若干"问题"**实际不存在**，若按原计划执行会重复劳动甚至引入回归。逐条对账：

| # | 原始需求假设 | 实测真相 | 影响 |
|---|------------|---------|------|
| 1 | "v2 路由未在 app.ts 注册 → API 404" | ❌ **已注册且 LIVE**。`src/router.ts:248-253` import、`:505-511` 挂载于 `/api/v2/canvas/{nodes,branches,links,load,save,layout}`。`core.ts` 的 `generateRouter()` 自动 glob `src/routes/**/*.ts` 生成 `router.ts`。实测 `curl -X POST http://localhost:10588/api/v2/canvas/load -d '{"projectId":1,"episodesId":1}'` → **HTTP 200 + 真实图数据** | **工作项 1 删除**（无需注册路由） |
| 2 | "o_agentWorkData 可能未创建 → 需 migration" | ❌ **表已存在**。`src/lib/initDB.ts:508 name:"o_agentWorkData"` 由 DB 初始化器创建，且已有多行数据 | **工作项 2 删除**（无需 migration） |
| 3 | "DEFAULT_BASE_URL 是旧 166:3000，应改 176:10588" | ✅ **属实**。`lib/canvas-client.js:34` = `'http://192.168.71.166:3000'` | **保留**（W1） |
| 4 | "ESM import 可能不支持" | ❌ kais-movie-agent `package.json` 已 `"type":"module"` + 依赖含 `socket.io-client`。CanvasClient 全文件 ESM，环境完全支持 | **删除**（无需适配） |
| 5 | "SKILL.md 规定同步画布但无自动化代码" | ⚠️ **半真**。`lib/pipeline.js:195/357` 已有 `onCanvasPush(phase, candidates)` 钩子并带 fail-open 降级，但**未接到 CanvasClient**；SKILL.md:622 同步段指向失效的 `localhost:8000` v1 API、仅覆盖 Step5/6 | **保留并重写**（W2/W3） |

**额外发现（原需求未提及但必须处理）：**
- 🔴 **节点类型枚举硬约束**：`nodes.ts:61-65` 用 zod 校验 `node.type`，仅允许 11 值枚举（`script|asset|storyboard|video|audio|3d|variant|reference|upscale|face_restore|suggestion`）。原提案想用 "style-genome/scene/节奏/运镜方案" 作为 node.type → **会被 API 400 拒绝**。必须走"语义下沉到 data 字段"的映射（见 §2 theory_critic 分析 + W4 映射表）。
- ✅ CanvasClient 方法面已**相当完备**：`loadCanvas/saveCanvas/patchCanvas/addNode/addNodes/updateNodeState/addLink/createBranch/updateBranchStatus/createVariantGroup/selectVariantWinner/approveNode`，且内置 `_failOpen`(L218) 与 404/405→patchCanvas 降级。真正缺的是**接线**与**base URL**，而非方法实现。

**净结论**：真实工作量约为原始需求的 40%。重心从"建后端"转移到"接线 + 合规门 + 同步规范 + 前端深链"。

---

## §1 目标（校正后）

1. **W1** — CanvasClient: 修正 base URL，硬化 fail-open 覆盖到所有调用点
2. **W2** — 新建 `lib/canvas-sync.js` 适配器：把 `pipeline.onCanvasPush(phase, candidates)` 接到 CanvasClient 的 addNode/selectVariantWinner/approveNode
3. **W3** — 重写 `SKILL.md` 画布同步规范（13 步全覆盖，替换失效 v1 curl 段）
4. **W4** — 节点类型映射表：node.type(枚举) ↔ data.category(语义) 双层建模
5. **W5** — 前端无限画布支持 `?projectId=` 深链（源码改动 + 重新构建 + 回填 `data/web/`）
6. **W6 (compliance)** — 在自动 approveNode 流程中插入人工合规断点 + fail-open 审计日志 + AIGC 标识字段

> 后端路由注册(W原1)、DB migration(W原2)、ESM 适配(W原5) —— **明确不做**（实测已完成/已满足）。

---

## §2 theory_critic 视角：图结构叙事自洽性审视

> 作为 theory_critic（形式主义/叙事结构/作者论框架），我对原提案的 Step→节点映射做结构诊断。判定标准：节点图是否忠实建模创作因果链，而非机械地把 Step 复制为节点。

### 2.1 创意分支应建模为 variant group 还是 branch？—— **视语义二分**

原提案把"10 候选主题 / 3 框架 / 3 剧本"一律做成 variant group，把"叙事分叉"与"同目标备选"混为一谈。这是**形式主义层面的建模错误**：

| 创作现实 | 正确建模 | 原提案 | 判定 |
|---------|---------|--------|------|
| 同一选题下 10 个主题钩子，最终选 1 | **variant group**（同目标竞品） | variant group ✅ | 正确 |
| 3 个叙事框架（三幕/英雄之旅/环形），选 1 | variant group | variant group ✅ | 正确 |
| 3 版剧本（A 线/B 线/混合线），可能**并行拍摄** | **branch**（叙事分叉，各自成片） | variant group ❌ | **应建模为 branch** |
| 角色 L1-L4 资产 | 父子节点 + 连线（非变体） | 子节点 ✅ | 正确 |

**判定规则**：`最终只保留一个 → variant group`；`可能各自存活成片 → branch`。剧本节点尤其关键：短片管线里剧本分歧常对应不同的成片取向，用 branch 才能保留回溯与 A/B 测试能力。→ 写入 W4 映射表的"建模决策列"。

### 2.2 缺失的结构性节点 —— "主角弧光/冲突"节点缺失

原提案是**生产工序节点图**（主题→框架→剧本→资产→场景→运镜→视频），而非**叙事结构图**。从叙事理论看，它缺一个代表"戏剧引擎"的节点层：

- 🔸 **缺失：冲突/弧光节点**。Step1 选主题、Step4 出主角，但"主角要解决的冲突"无处落点。建议在 Step3 剧本节点之后补一个 `data.category: "conflict_arc"` 的 script 类节点，承载"主角Want/Need/障碍"，作为后续所有镜头的情绪锚。
- 🔸 **混淆：节奏节点 vs 运镜节点**。原提案 Step6=运镜方案节点、Step8=节奏节点。但运镜(cinematography)与节奏(editing/pacing)是**两个专业域**，不应都叫"节点"。建议：Step6→`storyboard` 类节点(分镜表，含运镜语言)，Step8→`storyboard` 类节点但 `data.category:"pacing"`(剪辑节奏/时长/转场)。两者都是 storyboard 枚举，靠 data 区分。

### 2.3 节点 enum 充分性 —— 11 值够用，但必须"语义下沉"

`script|asset|storyboard|video|audio|3d|variant|reference|upscale|face_restore|suggestion` 这 11 类是**生产阶段分类法**，不是叙事分类法。从理论建模角度它**够用**，因为语义细节本就该走 `data` 字段。证据：现有 SKILL.md:645 示例已经这么做了——`node.type:"asset"` + `data.type:"role"`/`data.type:"scene"`。

**因此用户想要的 style-genome/scene/节奏 不应进 enum，而应进 `data.category`。** 这与后端 zod 约束天然契合，零改动。→ 见 W4 完整映射表。

### 2.4 approveNode 语义过刚 —— 建议保留"软锁定 + 可回溯分支"

创作论上"通过=锁定"过于刚性。资深剪辑师常在终审后回退到某个中间版本。建议 `approveNode` 的语义定义为**"标记当前主线胜出"而非"物理删除其他变体"**：
- `selectVariantWinner(groupId, winnerId)` 只设 `isWinner:true`，**不删除**落选节点（前端折叠即可）
- `approveNode` 后落选分支保留为 `branch.status:"archived"`，可随时复活
- 这与 §2.1 的 branch 建模一致——保留创作可回溯性

> theory_critic 结论：**图结构基本自洽，但需修正 3 处**（剧本分支→branch、补冲突弧光节点、节奏/运镜归 storyboard+data 区分），并通过 data.category 把语义层与 enum 层解耦。

---

## §3 compliance_gate 视角：合规门 + 数据/审计风险

> 作为 compliance_gate（CN 内容规则 + AIGC 标识办法 2025-09-01 + AI 漫剧备案 2026-04-01 + 8 类红线），我审视 A–E 五个敏感点。区分**内网工具现状可接受** vs **对外前必须修**。

### 3.1 风险定级（P0 阻断上线 / P1 上线前修 / P2 记录待办）

| 点 | 风险 | 内网现状 | 对外前 | 依据 |
|----|------|---------|--------|------|
| **A 自动审核** | AI 自动 approveNode 绕过人工内容门（政治/暴力/色情/未成年/历史虚无/民族） | 🟡 P1（内网有人盯着可接受，但自动 approve 留痕不可少） | 🔴 P0 | 《生成式AI服务管理暂行办法》§内容审核义务 + 深度合成规定 |
| **B fail-open 审计** | 画布降级本地存储无日志 → 事后无法追溯节点是否过内容门 | 🟡 P1 | 🔴 P0 | 备案/执法追溯要求 |
| **C 无鉴权 + 深链** | `?projectId=` + `/api/` 全放行(app.ts:171) → 凭 projectId 读他人剧本/资产/视频 | 🟢 P2（内网可信） | 🔴 P0 | 个人信息保护法 + 数据安全法 |
| **D 变体选择留痕** | selectVariantWinner 无 who/when/why | 🟡 P1 | 🔴 P0 | 内容追责取证 |
| **E AIGC 标识** | AI 生成的剧本/角色/视频节点直接上画布展示，无 AI 标识 | 🟡 P1 | 🔴 P0 | **AI 标识办法 2025-09-01**（强制） |

### 3.2 自动 approveNode 的人工断点设计

**绝不**让管线自动 approveNode 后即视为内容合规。合规门与画布 approveNode 是**两件事**：

```
[Step 产出] → onCanvasPush(addNode + variant group, state:"pending_review")
            ↓
[compliance_gate 自动预检]  ← 8 类红线机检 + AIGC 标识注入（硬门，fail 阻断）
            ↓ pass / 🟡降级方案 / 🔴阻断重生
[人工审核门 用户确认]        ← 必须有人 in-loop
            ↓ 用户通过
[canvas.approveNode + selectVariantWinner + state:"success"]  ← 这一步才是"画布 approved"
```

**gate 插入位置（对齐 V8.6 的 8 审核门）**：Step1后(选题红线)、Step3后(剧本合规+AIGC)、Step6后(终审前整体合规)、Step10后(成片分发合规)。画布 approveNode **必须晚于**这 4 个 compliance_gate 触发点，不可前置。

### 3.3 fail-open 审计最小日志 schema

降级存储必须同时写一行 append-only 审计日志，保证"不阻塞管线"且"可追溯"：

```jsonc
// projects/<pid>/canvas-audit.log  (append-only, 每次降级/每次 approve 一行)
{
  "ts": 1781847162329,
  "traceId": "pipe_abc",
  "projectId": 123, "episodesId": 1,
  "nodeId": "n-step3-script",
  "op": "approve|addNode|selectVariantWinner",
  "channel": "canvas_api" | "fail_open_local",
  "complianceGate": { "passed": true, "verdict": "🟢", "checker": "compliance_gate", "categoriesChecked": 8 },
  "humanGate": { "actor": "kai", "decisionAt": 1781847200000, "note": "可选" },
  "degradedReason": null | "ECONNREFUSED 192.168.71.176:10588"
}
```

硬指标：**任何 `op:"approve"` 若 `complianceGate.passed != true` 或 `humanGate` 缺失 → 审计视为无效，前端画布该节点标红**。

### 3.4 无鉴权 API + 深链的最小加固（不破坏内网体验）

对外前必修；内网可推迟。最小方案（从轻到重，按对外时点叠加）：
1. **projectId 混淆**：前端深链改用不可枚举的 `shareToken`（projectId 的 HMAC），后端 `/api/v2/canvas/load` 增 `shareToken` 校验分支（内网直传 projectId 仍放行）。
2. **网络层**：将 10588 端口置于反向代理后，仅内网网段 `192.168.71.0/24` 直连；对外走带鉴权的网关。
3. **数据层**：FlowGraph 的 `data.assetUrl` / 剧本全文在前端默认脱敏（点击展开需确认），降低泄露面。

### 3.5 AIGC 标识写入 FlowGraph 的 data 字段建议

按 AI 标识办法（2025-09-01），所有 AI 生成/显著修改内容须显著标识。在画布层，标识写入节点的 `data`：

```jsonc
// video / asset / storyboard 类节点统一加 data.aigc
{
  "data": {
    "aigc": {
      "generated": true,
      "model": "<image_gen_primary>",
      "disclosure": "本画面由 AI 生成",
      "explicit_label_spec": { "height_pct": 5, "position": "br", "opacity": 0.7, "duration": "full" },
      "implicit_meta": { "dc:creator": "kais-movie-agent", "digi:source": "aigc", "digi:ai_disclosure_present": true },
      "filing_triggered": false
    }
  }
}
```

> compliance_gate 结论：**内网现状可上线，但有 4 个 P1 必须在首轮修（A 审计、B 日志、D 留痕、E 标识）；C 鉴权记 P2 待办，对外前升级 P0。** 自动 approveNode 必须晚于 compliance_gate + 人工门。

---

## §4 变更清单（文件级，可执行）

### W1 — `lib/canvas-client.js`：base URL + fail-open 硬化

**W1a base URL**
```diff
- const DEFAULT_BASE_URL = 'http://192.168.71.166:3000';
+ const DEFAULT_BASE_URL = process.env.CANVAS_BASE_URL || 'http://192.168.71.176:10588';
```
同步更新文件内 docstring 注释（L61、L74 两处示例 URL）。

**W1b fail-open 覆盖审计**：当前 `_failOpen`(L218) 已定义，但 `addNode/addNodes/updateNodeState/addLink/approveNode` 等是**直接 throw**（仅 404/405 降级到 patchCanvas）。新增一个 `safe*` 包装层，供管线层选择性调用：
```js
async safeAddNode(node){ return this._failOpen(()=>this.addNode(node),'addNode'); }
async safeApprove(nodeId){ return this._failOpen(()=>this.approveNode(nodeId),'approveNode'); }
async safeSelectWinner(gid,wid){ return this._failOpen(()=>this.selectVariantWinner(gid,wid),'selectWinner'); }
```
管线层默认走 `safe*`，确保画布宕机永不阻塞（与现有 onCanvasPush 降级语义一致）。

---

### W2 — 新建 `lib/canvas-sync.js`：onCanvasPush ↔ CanvasClient 适配器

pipeline.js L357 当前只调 `this.onCanvasPush(phase, candidates)`，不知道 CanvasClient 的丰富方法。新建适配器把 `(phase, candidates)` 翻译为画布操作：

```js
// lib/canvas-sync.js (新建, ESM)
import { CanvasClient } from './canvas-client.js';

export function createCanvasSync({ baseUrl, projectId, episodesId, pipelineId }) {
  const client = new CanvasClient({ baseUrl, projectId, episodesId, pipelineId });
  let booted = false;

  async function _ensureProjectNode() {
    if (booted) return;
    const g = await client.loadCanvas().catch(() => null);
    if (!g) await client.safeAddNode(_projectNode(projectId));
    booted = true;
  }

  return async function onCanvasPush(phase, candidates) {
    await _ensureProjectNode();
    const mapping = PHASE_TO_CANVAS[phase.id];           // 见 W4 映射表
    if (!mapping) return;
    if (mapping.model === 'variant') {
      const nodes = candidates.map((c, i) => _toNode(mapping, c, i));
      const res = await client.addNodes(nodes);
      if (nodes.length > 1) await client.createVariantGroup(_variantGroup(mapping, nodes));
      return res;
    }
    if (mapping.model === 'branch') {
      for (const c of candidates) {
        const br = await client.createBranch({ id: `br-${phase.id}-${c.id}`, label: c.label, status: 'candidate' });
        await client.safeAddNode(_toNode(mapping, c, 0, br.id));
      }
      return;
    }
    const node = _toNode(mapping, candidates[0], 0);
    return client.safeAddNode(node);
  };
}
```

**pipeline.js 接线**（构造 Pipeline 时注入）：
```js
import { createCanvasSync } from './canvas-sync.js';
const onCanvasPush = config.canvasBaseUrl
  ? createCanvasSync({ baseUrl: config.canvasBaseUrl, projectId, episodesId, pipelineId: this.traceId })
  : null;
this.onCanvasPush = config.onCanvasPush || onCanvasPush;
```
> pipeline.js L357-364 的 try/catch 降级**保留不变**，适配器内部再走 `safe*`，双层 fail-open。

**审核门通过后的同步**（pipeline.js review 通过分支，约 L366 附近）：通过后追加
```js
if (this.onCanvasApprove) await this.onCanvasApprove(phase, selectedWinnerId);
```
并新增对应 `onCanvasApprove` 钩子 → 适配器内 `client.safeApprove + safeSelectWinner + updateNodeState('success')`。**注意：此处必须确认 compliance_gate 已 pass + 人工门已确认（见 §3.2）后才触发。**

---

### W3 — `SKILL.md` 画布同步规范重写（替换 L622-650 失效段）

删除现有指向 `localhost:8000/api/canvas/save` 的 v1 curl 段，替换为 v2 全管线同步规范：

```markdown
### 画布 FlowGraph 同步（V8.7，全管线）

每个 Step 产出 + 审核门通过后，管线自动经 lib/canvas-sync.js 同步到无限画布。
**禁止**再用 curl 直调；**禁止**用 v1 /api/canvas/save。

基址：CANVAS_BASE_URL（默认 http://192.168.71.176:10588），前缀 /api/v2/canvas。

| Step | 产出 | 画布操作 | node.type | data.category | 建模 |
|------|------|---------|-----------|--------------|------|
| 1 主题 | 10 候选主题 | addNodes + variantGroup | suggestion | topic | variant |
| 2 框架 | 3 候选框架 | addNodes + variantGroup + 连线 | script | framework | variant |
| 2B 风格 | style-genome | addNode | reference | style_genome | single |
| 3 剧本 | 3 候选剧本 + 审计分 | createBranch ×3 + 审计子节点 | script | screenplay+audit | **branch** |
| 4 主角 | 角色 + L1-L4 | addNode(父) + addNodes(子) + 连线 | asset | character_L1..L4 | tree |
| 5 场景 | 场景 + 5视图 | addNode(父) + addNodes(子) | asset | scene_5view | tree |
| 6 时空剧本 | 分镜表 | addNode | storyboard | shotlist | single |
| 7 视觉种子 | 种子 + 变体 | addNode + variantGroup | reference | visual_seed | variant |
| 8 节奏 | 剪辑节奏 | addNode | storyboard | pacing | single |
| 10 终版 | 视频 | addNode | video | final_cut | single |

审核门通过 → client.approveNode + selectVariantWinner + updateNodeState('success')
（**前提**：compliance_gate 已 pass 且人工门已确认，见 §3.2）
```

---

### W4 — 节点类型映射表（node.type 枚举 ↔ data.category 语义）

> 解耦关键：node.type 必须落在 11 值枚举内（否则 400）；所有语义/工序细节进 data.category。

| 管线语义 | node.type(枚举) | data.category | data.aigc? | 备注 |
|---------|----------------|---------------|-----------|------|
| 选题主题 | `suggestion` | topic | — | variant group |
| 叙事框架 | `script` | framework | — | variant group |
| 风格基因 | `reference` | style_genome | — | 全局参考，连到所有下游 |
| **剧本(分歧)** | `script` | screenplay | ✅ | **branch** 非 variant(§2.1) |
| 剧本审计分 | `script` | audit_score | — | script_auditor 5 维 |
| **冲突/弧光**(补) | `script` | conflict_arc | — | theory_critic 建议(§2.2) |
| 角色锚点 L1 | `asset` | character_L1 | ✅ | 面部身份 |
| 角色造型 L2-L4 | `asset` | character_L2..L4 | ✅ | 服装/姿势/表情 |
| 场景 | `asset` | scene | ✅ | 5 视图子节点 |
| 分镜/运镜 | `storyboard` | shotlist | ✅ | 含运镜语言 |
| 剪辑节奏 | `storyboard` | pacing | — | 镜头数/时长/转场 |
| 视觉种子 | `reference` | visual_seed | ✅ | variant group |
| 终版视频 | `video` | final_cut | ✅ | data.aigc 强制(§3.5) |
| 3D 空间 | `3d` | spatial | ✅ | 可选 |

**建模决策列**（§2.1 规则）：
- `variant` = 同目标竞品，最终选 1（主题/框架/视觉种子）
- `branch` = 叙事分叉，可能各自成片（**剧本**）
- `tree` = 父子聚合（角色/场景）
- `single` = 唯一产出（节奏/终版）

---

### W5 — 前端 `?projectId=` 深链（源码 + 重新构建）

源码在 `packages/infinite-canvas/src/`（React + Zustand 状态管理）。当前 projectId 来自 `ProjectSelector.tsx` 用户选择。

**改动**（`src/main.tsx` 启动逻辑）：
```ts
const params = new URLSearchParams(location.search);
const urlPid = params.get('projectId');
const urlEid = params.get('episodesId');
if (urlPid) {
  canvasStore.getState().loadProject(Number(urlPid), Number(urlEid) || 1);
} else {
  render(<ProjectSelector />, ...);   // 现状：无数据时显示"无项目"
}
```
**重新构建并回填**（按该 package 的 package.json 中声明的构建脚本执行，产出 dist/，再回填到 ../../data/web/infinite-canvas/）。

**空数据提示**：`canvasStore.loadProject` 返回 null 时，FlowCanvas 渲染"📭 无项目，请从 OpenClaw 创建项目后访问"。

> ⚠️ 合规联动(§3.4)：深链 projectId 对外前必须改 shareToken；本次先实现内网直链。

---

### W6 — 合规门接线（§3 落地）

- **审核门顺序锁**：pipeline.js 中 `onCanvasApprove` 触发前，断言 `complianceResult.passed === true && humanConfirmed === true`，否则 `updateNodeState('blocked')` 不 approve。
- **审计日志**：canvas-sync.js 每次写操作 append `projects/<pid>/canvas-audit.log`（schema 见 §3.3）。
- **AIGC 标识**：canvas-sync.js 的 `_toNode()` 对 video/asset/reference(storyboard) 类自动注入 `data.aigc`（§3.5）。

---

## §5 关键决策点（含 variant，供 Kai 选择）

> 按 Kai 工作流，给出需决策处的差异化方案。

**决策 1：剧本分歧的画布建模**
- **A（推荐, theory_critic 倾向）**：branch —— 每个 candidate 独立 branch，支持 A/B 成片与回溯。代价：前端需渲染分支切换 UI。
- **B（原提案）**：variant group —— 实现简单，但丢失叙事分叉语义，无法并行成片。

**决策 2：fail-open 在管线层的力度**
- **A（推荐）**：双层 fail-open（pipeline try/catch + client safe*），画布全宕也永不阻塞。
- **B**：仅 pipeline 层 fail-open，client 层 throw —— 更早暴露问题，但生产环境有阻塞风险。

**决策 3：AIGC 标识注入时机**
- **A（推荐, compliance_gate 倾向）**：canvas-sync 建节点时即注入 data.aigc（生成即合规）。
- **B**：终版前由 compliance_gate 统一回填 —— 集中但易漏。

---

## §6 验收标准

- [ ] `grep "192.168.71.166" lib/canvas-client.js` 无残留；`CANVAS_BASE_URL` 可覆盖
- [ ] 跑一遍 13 步管线（内网），画布前端 `/infinite-canvas/?projectId=<pid>` 实时出现节点树 + 变体组 + 连线
- [ ] 断网模拟：停掉 10588，管线仍跑完不报错，`canvas-audit.log` 出现 `channel:"fail_open_local"` 行
- [ ] compliance_gate fail 时（构造一个红线剧本），对应节点 state 不变 success，前端标红
- [ ] 任意 video/asset 节点 `data.aigc` 三件套字段齐全
- [ ] `POST /api/v2/canvas/nodes` 用 `node.type:"style_genome"` → 预期 400（验证枚举约束生效）；用 `node.type:"reference" + data.category:"style_genome"` → 200

---

## §7 风险与降级

| 风险 | 降级 |
|------|------|
| 画布服务不可用 | 双层 fail-open → 本地 canvas-audit.log，管线继续 |
| 节点 type 误用枚举外值 | _toNode() 内置白名单校验 + 映射表，越界回退到 `suggestion` |
| 合规门与 approve 时序错乱 | pipeline 加断言锁，blocked 态前端标红，必须人工解锁 |
| 前端重新构建破坏现有 bundle | 先备份 data/web/infinite-canvas 再回填 |

---

## §8 明确不做（避免重复劳动）

- ❌ 在 app.ts / router.ts 注册 v2 路由 —— **已 LIVE**（router.ts:505-511，实测 200）
- ❌ 创建 o_agentWorkData migration —— **表已由 initDB.ts:508 创建**
- ❌ ESM/CJS 互转 —— 项目已 `"type":"module"`
- ❌ 重新实现 CanvasClient 的 addNode/approveNode 等方法 —— **已完备**

---

## 附录 A：实测命令复现（真相校正依据）

```bash
grep -n "api/v2/canvas" src/router.ts          # → :505-511 六条挂载
curl -X POST http://localhost:10588/api/v2/canvas/load \
  -H 'Content-Type: application/json' -d '{"projectId":1,"episodesId":1}'   # → 200 + 图数据
grep -n 'name: "o_agentWorkData"' src/lib/initDB.ts   # → :508
grep -n "192.168.71.166" lib/canvas-client.js          # → :34
grep -n "onCanvasPush" lib/pipeline.js                 # → :195, :357
sed -n '622,630p' SKILL.md                             # → localhost:8000 v1
```

## 附录 B：专家来源

- **theory_critic**（formalism/realism + 叙事结构 + 作者论）：§2 图结构自洽性诊断、variant vs branch 二分、冲突弧光节点建议、data 语义下沉。
- **compliance_gate**（CN 8 类红线 + AIGC 标识办法 2025-09-01 + AI 漫剧备案 2026-04-01）：§3 风险定级、人工门断点、fail-open 审计 schema、深链加固、AIGC data 字段。
