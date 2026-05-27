# V8 Architecture — OpenClaw Agent 纯驱动

> 2026-05-28 | 从 V7 迁移：废弃 movie-agent 容器，编排收归 OpenClaw

---

## 三层架构

```
┌─────────────────────────────────────────────────┐
│                 Layer 1: 编排层                    │
│              OpenClaw Agent (唯一 LLM)             │
│                                                   │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  │
│  │hermes_llm│  │hermes_llm_   │  │ image tool │  │
│  │ 创意生成  │  │vision 图像分析│  │  图像分析   │  │
│  └──────────┘  └──────────────┘  └────────────┘  │
│                                                   │
│  状态管理：session 上下文 + 文件系统                  │
│  审核交互：Telegram inline buttons / Toonflow      │
└────────────────────┬────────────────────────────┘
                     │ exec curl
                     ▼
┌─────────────────────────────────────────────────┐
│              Layer 2: GPU 调度层                    │
│            gold-team (localhost:8002)              │
│                                                   │
│  POST /api/v1/tasks  → 提交任务                    │
│  GET  /api/v1/tasks/:id → 查询状态                 │
│                                                   │
│  引擎：ComfyUI / edge-tts / cloud-jimeng /         │
│        Seedance 2.0 / Wan 14B                     │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│              Layer 3: 前端展示层                     │
│            Toonflow (localhost:3000)               │
│                                                   │
│  审核页面 / 产出物展示 / 项目管理                     │
└─────────────────────────────────────────────────┘
```

---

## 调用链路

```
用户消息 → OpenClaw Agent
              │
              ├─ Step 创意生成 ──→ hermes_llm(prompt, system)
              │                       ↓
              │              展示给用户 → 等审核确认
              │
              ├─ Step GPU 任务 ──→ exec curl POST gold-team:8002/api/v1/tasks
              │                       ↓
              │              exec curl GET gold-team:8002/api/v1/tasks/:id (轮询)
              │                       ↓
              │              展示结果 → 等审核确认
              │
              └─ Step 下一步 ...（循环 20 步）
```

### 典型 GPU 任务调用

```bash
# 提交文生图任务
TASK_ID="ma-$(date +%s)"
curl -X POST http://localhost:8002/api/v1/tasks \
  -H 'Content-Type: application/json' \
  -d "{\"task_id\": \"$TASK_ID\", \"type\": \"image_draw\", \"params\": {...}}"

# 轮询状态（Agent 用 exec 间隔查询）
curl http://localhost:8002/api/v1/tasks/$TASK_ID

# 获取产出文件
curl http://localhost:8002/api/v1/files/$TASK_ID/output.png -o output.png
```

---

## 与 V7 的差异

| 维度 | V7 | V8 |
|------|----|----|
| **LLM 调用** | OpenClaw 为主，movie-agent 可 fallback | OpenClaw 唯一，无 fallback |
| **状态管理** | movie-agent Pipeline API (`:8001`) | OpenClaw session + 文件系统 |
| **GPU 调度** | movie-agent → gold-team | Agent 直接 → gold-team (`:8002`) |
| **movie-agent 容器** | 必需 | **废弃** |
| **core-backend** | `:8000` | **废弃** |
| **文件存储** | movie-agent workdir | 项目目录（文件系统） |
| **审核界面** | review-platform `:8091` | Toonflow `:3000` |
| **Pipeline API** | 有（创建/启动/恢复/取消） | **无**，Agent 逐步执行 |
| **模式** | 模式 A（Agent 直接）+ 模式 B（Pipeline） | 仅 Agent 直接驱动 |

### 核心变更

1. **movie-agent Docker 容器废弃**：不再构建、部署、依赖
2. **编排收归 OpenClaw**：所有状态和流程控制在 Agent session 内
3. **gold-team 直连**：Agent 通过 `exec curl` 直接调用，无中间层
4. **环境变量简化**：API Key 只需配在 gold-team 的 `.env`，skill 层无需任何 key

---

## 迁移指南（V7 → V8）

### 1. 移除 movie-agent 容器

```bash
docker stop movie-agent && docker rm movie-agent
# 如有 docker-compose，移除 movie-agent 和 core-backend 服务
```

### 2. 确认 gold-team 独立运行

```bash
curl http://localhost:8002/health
# 应返回 gold-team 健康状态
```

### 3. 确认 Toonflow 运行

```bash
curl http://localhost:3000
# 应返回 Toonflow 前端页面
```

### 4. 更新 SKILL.md 引用

已自动更新。所有管线 Step 的编号和逻辑不变，只是底层实现从 Pipeline API 改为 Agent 直接 exec curl。

### 5. 状态持久化

V7 的 pipeline 状态存在 movie-agent 内存/DB 中。V8 中：
- **管线进度**：Agent session 上下文（对话内自然保持）
- **产出物文件**：项目 workdir 文件系统
- **断点恢复**：基于 workdir 中的 checkpoint 文件 + git stage manager

### 6. 无需代码改动

如果已有子 skill（kais-script-agent 等），它们的接口不变——仍然通过 gold-team `:8002` 提交任务。只是不再有 `:8001` 的 pipeline 调用。

---

## 保留不变的部分

- ✅ 20 步管线流程（Step 1-20）
- ✅ 审核门规则（不可跳过）
- ✅ 两处审核入口（Telegram inline buttons + Toonflow）
- ✅ gold-team GPU 任务 API
- ✅ 反馈回流机制（最多 3 次迭代）
- ✅ GPU Runtime Manager Stage 映射
- ✅ Git 版本管理（git-stage-manager.js）
- ✅ 先线稿后渲染原则
- ✅ 所有子 skill
