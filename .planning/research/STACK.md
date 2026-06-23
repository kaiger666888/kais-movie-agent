# Stack Research

**Domain:** AIGC movie pipeline — v3.0 Industrial Pipeline Alignment (audio-visual sync, cross-episode reuse, history trace, bad-case blacklist, fine-tuning feedback, vision eval upgrade)
**Researched:** 2026-06-22
**Confidence:** HIGH (most decisions align with already-shipped code + 2026 official docs verified)

## Executive Summary — The v3.0 Stack Verdict

**The defining constraint:** `package.json` declares a hard "zero npm dependencies" principle (only `socket.io-client` today). All stack additions must either be (a) out-of-process services, (b) native Node.js (crypto/fs/child_process), or (c) a minimal self-implemented utility. This rules out most off-the-shelf libraries (image-hash, faiss-node, qdrant-client, hnswlib-wasm, dependency-graph).

The good news: **most v3.0 capability is already latent in the codebase.** The stack "additions" are therefore mostly (1) **wiring existing APIs** (Seedance audio, GLM-4.6v upgrade), (2) **extending existing patterns** (InvariantBus `_provenance` → creative_history, `failed_shots.json` → blacklist DB), and (3) **two small self-contained utilities** (pHash ~80 lines, vector match ~30 lines).

Only **one new external dependency** is recommended: the **Seedance 2.0 multimodal content API** via the existing `jimeng-client` (which already stubs `audioFiles`). No new npm packages.

## Recommended Stack

### Core Technologies (Services / APIs — NOT npm packages)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Seedance 2.0 (火山方舟 / ark API)** | `doubao-seedance-2.0` / `doubao-seedance-2.0-fast` | 视频生成 with 原生 audio-driven lip-sync | 官方原生支持 `content[].type=audio_url` + `role=reference_audio` (最多3段)，无需外挂 lip-sync 模型。`generate_audio: true` 开启后自动合成对白/音效/BGM 与口型。代码侧只需扩展现有 `omniReferenceVideo` 的 `audioFiles` 字段并添加 `generate_audio` 透传。**[HIGH — volcengine.com/docs/82379/1520757 官方API参考]** |
| **GLM-4.6V (智谱 bigmodel)** | `glm-4.6v` / `glm-4.6v-flash` (免费) | 替换 `glm-4v-flash` 做视觉评价 | 128k 上下文，原生 Function Call，视觉理解 SOTA。**关键发现：`quality-gate.js` 已默认 `glm-4.6v`，`scripts/*.py` 已使用 `glm-4.6v` — 唯一遗留是 `continuity-auditor.js:398` 的 `glm-4v-flash` 硬编码**。修复点极小：替换一个字符串 + 加 thinking 参数。OpenAI 兼容，无需改 `callLLMJson` 调用层。**[HIGH — docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v]** |
| **GoldTeamClient DINOv2 Embedding** | 现有 gold-team `task_type='dinov2_embedding'` | 角色资产指纹 + 跨剧集复用匹配 | `continuity-auditor.js:412-441` **已实现完整的 DINOv2 embedding 调用 + cosine similarity**（含降级 GLM-4V 兜底）。v3.0 复用此路径做 fingerprint index。DINOv2 在角色身份保持上优于 CLIP（patch-level dense features vs global text-aligned features），是 IP-Adapter / StoryDiffusion 等社区方案的默认 backbone。**[HIGH — 代码已验证]** |
| **GLM-4.6V Image2Prompt** | `glm-4.6v` | Bad case 模式描述（blacklist 文本生成） | GLM-4.6V 原生 Image2Prompt 能力可把"失败镜头图"翻译为可索引的失败模式描述（如 "low quality hands, extra fingers, warped eye"），写入 blacklist JSON 供下次生成时 negative_prompt 注入。无需额外 OCR/CLIP。**[MEDIUM — 官方 capability 表]** |

### Self-Implemented Utilities (NO new npm — follow existing pattern)

| Utility | LOC Estimate | Purpose | Why Self-Implement |
|---------|--------------|---------|--------------------|
| **`lib/perceptual-hash.js`** | ~80 LOC | 图像 pHash 指纹（快速重复检测） | `image-hash` npm 包功能简单（DCT-based pHash），纯 Node.js 可实现：用 `sharp` CLI (gold-team side) 或 canvas-free DCT 算法对 32×32 灰度图算 64-bit hash。Hamming distance ≤ 5 视为同图。**仅在 gold-team DINOv2 不可用（offline degraded mode）时作为 fingerprint fallback**。**[MEDIUM]** |
| **`lib/asset-fingerprint.js`** | ~150 LOC | 跨剧集资产复用索引 | 组合：sha256(文件内容) + DINOv2 embedding(语义) + pHash(感知)。索引格式 JSON：`{fingerprint_db.json: {sha256, phash, dino_vec_id, character_id, project_id, episode, registered_at}}`。复用流程：新角色生成 → 查 phash 命中 → 校验 DINOv2 cosine ≥ 0.92 → 复用 L1 锚点。**[HIGH — 设计清晰]** |
| **`lib/creative-history.js`** | ~200 LOC | 镜头级 lineage DAG trace | **扩展现有 `InvariantBus._provenance` 模式** (`invariant-bus.js:29-55`)。每个 artifact (shot_id) 维护 `{inputs: [parent_ids], produced_at_step, prompt_snapshot, model, seed, refs_used}`。JSON 序列化到 `creative-history.jsonl` (append-only)。**改剧本 → 反查 inputs 含 episode_N → 标记受影响 shot**：纯 JS Map + Set 即可，无需 DAG 库。**[HIGH]** |
| **`lib/bad-case-blacklist.js`** | ~120 LOC | 持久化 bad case 黑名单 + 生成时拒绝 | **扩展现有 `shot-parallel-scheduler.js:246` 写入的 `failed_shots.json`**。新模块维护 `{bad_cases.json: [{shot_id, project, episode, failure_mode_tags, pattern_phash, pattern_dino_vec_id, negative_prompt_hint, banned_at}]}`。生成前 hook：查询 phash + 标签命中 → 注入 negative_prompt 或拒绝。**[HIGH]** |
| **`lib/lineage-graph.js`** (可选) | ~100 LOC | 若需 topological "影响传播" 查询 | 自实现 Kahn's algorithm (~30 LOC) 对 `creative-history.jsonl` 做反向 BFS。**不推荐引入 `dependency-graph` / `toposort` npm** — 当前规模 (单机、单项目、单 episode ≤ 200 shot) 下纯 Map 足够。**[LOW — 仅在 shot 数 > 1000 时考虑]** |

### Out-of-Process Tools (gold-team GPU 侧)

| Tool | Version | Purpose | Why Recommended |
|------|---------|---------|-----------------|
| **kohya-ss / kohya_ss GUI** | 2026 release (`bmaltais/kohya_ss`) | SDXL/FLUX.1 LoRA 微调 (data feedback 闭环) | 视频生成管线不直接调用 LoRA 训练；v3.0 的"数据回流"产出训练数据集（failed case + corrected pair），由 operator 手动在 gold-team GPU 节点上跑 kohya_ss。集成层只生成 dataset.json + caption + 训练参数模板。**[HIGH — 2026 LoRA Training Guide 推荐]** |
| **OneTrainer** | 2026 release | 备选 LoRA 训练 (SDXL ~10.3 GiB peak VRAM) | 作为 kohya 备选：对低 VRAM GPU (8GB) 节点更友好。两者输出的 .safetensors 都能被 ComfyUI 加载到生图流程。v3.0 不绑定具体工具，仅定义数据集格式契约。**[HIGH]** |
| **GoldTeamClient** (现有) | v1.0 | 训练任务远程调度 (kohya → GoldTeamClient.submitTask) | 已验证用于 FLUX/VIDEO/VOICE 等 GPU 任务。LoRA 训练作为新 task_type `lora_training` 加入即可。**[HIGH]** |

### Supporting Libraries (NIL — 零新增 npm)

**关键决策：v3.0 不引入任何新 npm 依赖。** 现有 `package.json` 维持 `{socket.io-client}`。

| 候选库 | 推荐替代方案 | 理由 |
|--------|-------------|------|
| ~~`image-hash`~~ | 自实现 `perceptual-hash.js` (~80 LOC) | pHash 算法简单，无 native 依赖；项目原则 |
| ~~`hnswlib-wasm`~~ / ~~`faiss-node`~~ | DINOv2 via gold-team + brute-force cosine in JS | 规模小 (单项目 ≤ 1000 角色)，O(n) cosine 足够；现有 `_cosineSimilarity()` (`continuity-auditor.js:443`) 已实现 |
| ~~`qdrant` / `milvus`~~ | JSON 文件 + 线性扫描 | 部署复杂度过高，与降级优先原则冲突；规模无需专用向量库 |
| ~~`dependency-graph` / `toposort`~~ | 自实现反向 BFS (~30 LOC) | 创作历史图规模小，纯 Map 即可 |
| ~~`chroma` / `lancedb`~~ | 同上 JSON 文件 | 同上 |

### Development Tools (NIL — 维持现有)

| Tool | Purpose | Notes |
|------|---------|-------|
| `node --test` (现有) | 测试运行 | v3.0 新模块需补 unit test |
| ffmpeg (现有调用) | 视频帧抽取 / 音频提取 | Seedance audio reference 需从 TTS 输出抽前 15s（API 限制） |

## Installation

```bash
# ⚠️ 不需要 npm install 任何新包
# v3.0 全部能力通过以下方式获得：
#   1. 扩展现有 lib/jimeng-client.js 的 omniReferenceVideo 调用 (Seedance audio)
#   2. 替换 lib/continuity-auditor.js:398 的 'glm-4v-flash' → 'glm-4.6v' (GLM 升级)
#   3. 新增 ~5 个 lib/*.js 模块 (~650 LOC 总计，纯 Node.js ES module)
#   4. 配置 operator 在 gold-team GPU 侧安装 kohya_ss (out-of-process)

# 唯一环境变量新增:
export SEEDANCE_AUDIO_MAX_DURATION=15     # Seedance API 音频时长上限
export GLM46V_THINKING=enabled            # 启用 GLM-4.6V thinking 模式 (评分稳定性)
export LORA_TRAINING_DATASET_DIR=/data/projects/_lora_datasets  # 数据回流产物
```

## Alternatives Considered

| Category | Recommended | Alternative | When to Use Alternative |
|----------|-------------|-------------|-------------------------|
| **音画同步** | Seedance 2.0 原生 audio input | Wav2Lip / SadTalker 外挂 | 当必须使用非 Seedance 视频模型时 (Runway/Kling)；v3.0 范围内用 Seedance 原生即可 |
| **视觉评价** | GLM-4.6V (升级自 4v-flash) | GPT-4V / Gemini 2.0 | 仅当脱离智谱生态时；当前代码已深度集成智谱 api/paas/v4 |
| **资产指纹** | DINOv2 via gold-team (主) + pHash 自实现 (degraded fallback) | CLIP ViT-L/14 | DINOv2 在身份保持任务上 patch-level 特征更细，CLIP 偏全局语义；IP-Adapter faceID 默认 DINOv2 |
| **向量索引** | JSON + O(n) cosine (≤1000 向量) | hnswlib-wasm | 当角色库 > 10k 时；当前单项目规模下线性扫描 < 5ms |
| **LoRA 训练** | kohya-ss (推荐主路径) | OneTrainer (低 VRAM 备选) / 公司内部工具 | VRAM < 10GB 选 OneTrainer；已有内部训练 pipeline 用内部工具 |
| **Trace 存储** | `creative-history.jsonl` (append-only) | SQLite | 当需要复杂 SQL 查询时；当前只需反向 BFS，JSONL 足够 |
| **Blacklist 匹配** | JSON + phash + tag 双索引 | Milvus / Qdrant | 仅当 blacklist 规模 > 10k 条；当前每项目 ≤ 100 bad case |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| ~~`image-hash` npm~~ | 违反零 npm 依赖原则；pHash 算法 80 LOC 可自实现 | `lib/perceptual-hash.js` 自实现 |
| ~~`faiss-node` / `@faiss-node/native`~~ | Native 编译复杂 (Windows 难装)，early-stage，规模未达 | DINOv2 via gold-team + JSON 索引 |
| ~~Milvus / Qdrant 部署~~ | 客户端-服务端架构违反"降级优先"原则；规模远未达 | JSON 文件 + 线性扫描 |
| ~~`dependency-graph` / `toposort` npm~~ | DAG 库规模小，自实现更可控 | `lib/creative-history.js` 内联 BFS |
| ~~Wav2Lip / SadTalker 集成~~ | 多一个模型依赖；Seedance 2.0 原生支持更稳定 | Seedance 2.0 `audio_url` + `generate_audio: true` |
| ~~独立向量数据库进程~~ | 多进程协调成本，违反单进程 Node 设计 | 进程内 Map + JSON 持久化 |
| ~~直接修改 `lib/llm.js` 全局默认模型~~ | 可能影响其他调用方；应就地替换 `continuity-auditor.js` | `callLLMJson({...model: 'glm-4.6v'})` 显式覆盖 |

## Stack Patterns by Variant

**If GoldTeamClient available (online mode):**
- 资产指纹走 DINOv2 embedding (`task_type='dinov2_embedding'`)
- 视觉评价走 GLM-4.6V (`callLLMJson` with `model: 'glm-4.6v'`)
- LoRA 训练数据集由 GoldTeamClient.submitTask 远程调度
- 一致性审计走 `_tryDINOv2Embedding()` 主路径 (已实现)

**If GoldTeamClient unavailable (degraded mode):**
- 资产指纹降级 pHash (自实现)
- 视觉评价降级 LLM 文本分析 (现有 `_llmIdentityScore` 路径)
- LoRA 训练跳过（仅生成 dataset.json 待后续）
- 一致性审计降级 GLM-4V-Flash 文本对比 (现有 fallback)
- **关键原则：系统必须仍可运行产出 final.mp4** (符合 v2.0 降级优先原则)

**If 单 episode 长视频 (shot > 100):**
- creative-history 启用 JSONL append-only，避免全量重写
- bad-case-blacklist 启用增量索引

**If 跨剧集系列剧 (multi-episode):**
- asset-fingerprint 跨项目查找（共享 fingerprint_db.json）
- LoRA 微调数据集按角色 ID 分目录

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `glm-4.6v` (智谱 paas/v4) | 现有 `callLLMJson` (OpenAI 兼容) | 仅需显式 `model` 字段，API 路径不变；建议加 `thinking: {type: 'enabled'}` 提升评分稳定性 |
| Seedance 2.0 multimodal content API | 现有 `JimengClient.omniReferenceVideo` | 需扩展：`audioFiles` 已在 refs 解构，只需透传 `generate_audio` 到 body |
| DINOv2 embedding (gold-team) | 现有 `continuity-auditor._tryDINOv2Embedding` | 已完整实现，无改动；v3.0 复用做 asset fingerprint |
| kohya-ss LoRA 输出 (.safetensors) | ComfyUI / FLUX web UIs | 标准格式；v3.0 不直接加载，仅生成训练契约 |
| Node.js ≥ 20 (现有) | 所有自实现模块 | 使用 `node:crypto`, `node:fs/promises`, `AbortController.timeout` |

## Integration Points (for roadmap)

1. **`lib/jimeng-client.js::omniReferenceVideo`** — 扩展 `options.generate_audio` 透传 + 在 `prompt` 中注入双引号对白语法（Seedance 官方建议："将对话部分置于双引号内，以优化音频生成效果"）
2. **`lib/continuity-auditor.js:398`** — 单行字符串替换 `'glm-4v-flash'` → `'glm-4.6v'`
3. **`lib/character-asset-manager.js`** — 新增 `getCrossEpisodeMatches(phashOrEmbedding)` 方法，查询 `fingerprint_db.json`
4. **`lib/invariant-bus.js::_provenance`** — 扩展为 `creative_history` 字段，每个 set* 操作记录 inputs[]
5. **`lib/shot-parallel-scheduler.js::failed_shots.json`** — 新增 reader 方法供 `bad-case-blacklist.js` 调用
6. **`lib/hermes-adapter.js::callLLMJson`** — 不需修改，已支持 `model` 覆盖
7. **新 phase handler 集成点**：data-feedback phase 产出 dataset.json + lora_training_task

## Sources

- **Seedance 2.0 API 官方文档** — https://www.volcengine.com/docs/82379/1520757 [HIGH confidence — 字段定义、`generate_audio`、`audio_url`、`reference_audio` role、时长/大小限制全部官方原文]
- **GLM-4.6V 官方文档** — https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v [HIGH — API 示例、`thinking` 参数、`image_url/video_url/file_url` content type、OCR/Image2Prompt/Function Call 能力列表]
- **GLM-4.6V 发布信息 (智谱 2025-12-08)** — IT之家报道 + ModelScope 页面 [MEDIUM — 发布日期、MoE 106B-A12B 架构、API 降价 50%、开源]
- **kohya_ss GitHub (bmaltais/kohya_ss)** — SDXL/FLUX LoRA 训练 [HIGH]
- **OneTrainer Reddit 个人经验指南** — r/StableDiffusion SDXL LoRA training guide [MEDIUM]
- **LoRA Training Guide 2026** — sanj.dev/post/lora-training-2025-ultimate-guide [MEDIUM]
- **DINOv2 vs CLIP 对比** — Meta AI blog + arXiv 2304.07193 + CVPR 2025 poster [HIGH — 学术权威]
- **hnswlib-wasm vs faiss-node 对比** — NPM + Hacker News 社区共识 [MEDIUM]
- **代码内验证** — `lib/continuity-auditor.js` (`_tryDINOv2Embedding`, `_cosineSimilarity`, `glm-4v-flash` 遗留点), `lib/quality-gate.js:152` (`glm-4.6v` 已默认), `lib/character-asset-manager.js` (manifest 结构), `lib/invariant-bus.js` (`_provenance` 模式), `lib/shot-parallel-scheduler.js:246` (`failed_shots.json` 写入), `lib/jimeng-client.js::omniReferenceVideo` (`audioFiles` 已解构) [HIGH — 一手代码]
- **package.json** — 零依赖原则 [HIGH — 项目契约]

---
*Stack research for: v3.0 Industrial Pipeline Alignment (audio-visual sync + asset reuse + history trace + bad-case blacklist + fine-tuning feedback + GLM-4.6v upgrade)*
*Researched: 2026-06-22*
