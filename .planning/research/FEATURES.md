# Feature Research

**Domain:** AIGC 短视频工业化流水线 (v3.0 Industrial Pipeline Alignment)
**Researched:** 2026-06-22
**Confidence:** MEDIUM-HIGH (官方文档 + 工业 analog 对标,部分接口需 operator 验证)

## Scope

本研究**只覆盖 v3.0 新增的 5 大能力**(参考 PROJECT.md `Active` 区段):

| ID | 能力 | 工业对标 |
|----|------|---------|
| A2 | Seedance 2.0 音频驱动口型同步 | Seedance 2.0 Multi-Reference w/ Audio |
| B2 | 跨剧集角色资产复用 (fingerprint) | Kling O1 Element Library / SkyReels V4 |
| B4 | 镜头级 creative_history trace | USD/Halie/Sprite customData + provenance |
| B5 | Bad case 黑名单 + 生成时拒绝 | Hard Negative Mining (GeNIe 等) + LLM 标签检索 |
| B6 | 数据回流 fine-tuning 闭环 | Data Flywheel (NVIDIA/W&B) + Rejection Sampling |

**不在本研究范围** (v2.0 已交付):20-phase pipeline、L1-L4 asset 分层、ShotParallelScheduler、CompositionEngine、Hermes 闭环、E2E degraded-mode。

---

## Feature Landscape

### Table Stakes (2026 工业产线必预期)

2026 H2 进入"工业产线标准"门槛意味着:不补齐这些能力,pipeline 会被竞品当成 demo。

| Feature | Why Expected | Complexity | Notes / v2.0 Hook |
|---------|--------------|------------|-------|
| **A2: 音频驱动口型同步** | Seedance 2.0 / SkyReels V4 / Veo 3.1 / Sora 2 全部原生支持 `@Audio1` 驱动口型;业界已默认"音频进、嘴动出"是基础能力,不做就是上一代产品 | MEDIUM | v2.0 已有 `cloud-production` 的 `seedance_omni_reference` 调度和 `lip_sync_rt` (Phase 4A.8) — 但二者未打通;需在 omni_reference 参数里补 `audio_refs` 字段,且依赖 phase 顺序 (`final-audio` → 重跑 `cloud-production` 或前置 voice 合成) |
| **B2: 跨剧集角色资产复用** | Kling O1 Element Library "one-click reuse"、SkyReels V4 multi-modal references、Runway Act-One 都已将"角色一次定义、多集复用"作为基础叙事;系列剧 (如本项目 p1800-time-capsule) 必须此能力才能控制成本 | MEDIUM | v2.0 `CharacterAssetManager` 已有 manifest.json + L1-L4 分层,但 fingerprint 仅是 `sha256(path).slice(0,16)` (`_computeFaceEmbeddingHash`/`_computeCostumeFingerprint`) — 不是感知哈希,无法跨项目去重。需升级为 pHash + 向量 embedding 双索引 |
| **B4: 镜头级 creative_history trace** | 传统 VFX 管线 USD/Halie/BMD 全部带 provenance metadata;AIGC 时代 DeepMind Sprite、Sora C2PA、Adobe Content Credentials 都在推"每个像素可溯源"。改剧本自动定位受影响镜头 = 工业级 trace 的最低门槛 | HIGH | 当前 `pipeline.workdir` 下每个阶段写独立 JSON,但**没有任何 phase 生成 `creative_history` 字段**;需在 `AssetBus.write` 增量追加 `derived_from` + `affected_shots` 图 |
| **B5: Bad case 黑名单 + 生成时拒绝** | Stable Diffusion 生态 (negative prompts)、Midjourney `--no`、_runway_ML Safety Checker 全部默认;AIGC 视频流水线不卡 bad case = 反复烧 GPU | MEDIUM | v2.0 `video_tasks.json` 已收集 `failed_shots` 和 `permanent_failures`,但**没有持久化到下一次 run**;需要在 `cloud-production` before-hook 读 blacklist → 注入 negative prompt 或直接跳过 |
| **B6: 数据回流 fine-tuning** | NVIDIA Data Flywheel Blueprint (GTC 2025) 已成 MLOps 标准实践;闭源 Sora/Veo 不暴露此能力正是开源/自建产线的差异化机会 | HIGH | Hermes audit (`_hermesAudit`) 已收集所有 phase 的 metrics,但 metrics 只回写到 Hermes 决策,未回流到 prompt 模板或角色 LoRA;需新增 `data-flywheel` 模块 + 训练数据导出器 |

### Differentiators (Competitive Advantage)

补齐 table stakes 后,以下差异化能力将让本 pipeline 对齐甚至超越 SOTA:

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Per-shot creative_history 改剧本重渲** | 用户改剧本一行 → 自动定位下游 N 个镜头 → 只重渲受影响镜头(而不是整集重跑)。SkyReels V4 / Runway 都还在"整段重生成"阶段;这是 Git-for-AIGC-movies 的入口 | HIGH | 依赖 B4 trace 链;实现要点是给每个 shot 打 `content_hash(prompt+script_segment)` + 反向索引到剧本行号 |
| **Bad case 向量检索 (语义拒绝)** | 业界 negative prompt 只能字符串拼接;我们可基于 embedding 在 prompt 空间相似度 >0.85 时直接拒绝。GeNIe (arXiv 2312.02548) 证明 hard negative mining 显著提升扩散模型质量 | MEDIUM-HIGH | 依赖 DINOv2 embedding (`_tryDINOv2Embedding` 已在 continuity-auditor 里探测 gold-team 能力);v3.0 需确认 gold-team 暴露该接口 |
| **数据回流自动 LoRA 训练** | Failed shot + 对话音频 + 锚点图 → 自动组装训练 pair → 角色 LoRA 迭代。NVIDIA AITL (arXiv 2510.06674) 显示 Agent-in-the-Loop 训练可将模型尺寸降 10x、精度升 3.7% | HIGH | 需 GPU operator 配合 (无法纯 Node.js 实现);建议输出"训练数据 manifest",由 operator 触发训练 |
| **Cross-episode 角色 fingerprint 库 (pHash + face embedding)** | Kling O1 Element Library 只在自家平台;我们做项目级私有 Element 库。同主角系列剧(如 p1800-time-capsule 多集)首集建库、后续集直接调取,显著降本 | MEDIUM | 实测 `_computeCostumeFingerprint = sha256(paths.join(','))` 完全不可用 (只哈希路径字符串),必须重写为感知哈希 |
| **Seedance omni + audio 同步生成** | Seedance 2.0 官方 `Text + Image + Video + Audio` 四模态组合,up to 9 imgs + 3 videos + 3 audios。本项目可把 L1 anchor + L2 costume + 角色 TTS audio 全打包给 Seedance 一次性生成口型同步视频,省掉 `lip_sync_rt` 二次调用 | MEDIUM | Seedance 计费:1080p + video input = 20 credits/sec,5s 输出 + 3s video input = 160 credits ≈ $2;需评估 vs 两阶段 (video + 后期 lip sync) 的成本/质量权衡 |

### Anti-Features (容易想做但不该做)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **全量 GPU E2E 验证 (在 v3.0)** | 团队想看真实成片质量 | GPU E2E 单集成本数千元、operator 配置依赖、不阻塞 v3.0 能力交付;PROJECT.md 已明确 "Out of Scope" | v3.0 维持 degraded-mode E2E + 单元测试覆盖新模块;真实 GPU 留 v4.0 operator 协作 |
| **实时 bad case 监控前端** | "看着 pipeline 跑"很爽 | 增加 Web 层依赖、偏离 Node.js 零依赖原则;Pipeline 不是监控产品 | 把 bad_case 写 JSONL + 跑完后输出 markdown 报告;operator 用 `tail -f` 即可 |
| **自动训练触发 (cron 触发 LoRA 训练)** | "完全无人值守" 听起来性感 | 训练烧 GPU、数据质量未审就训 = 灾难;业界 NVIDIA Flywheel Blueprint 也有人审环节 | v3.0 只做"训练数据 manifest 导出"+ 推荐报告;operator 触发训练 |
| **多模型 A/B 测试 (Runway/Kling/Sora)** | 想对标业界 | v3.0 PROJECT.md 已 Out of Scope;且每接一个新模型 = 新 client + 新 adapter,scope creep | v3.0 先在 `GoldTeamClient` 抽象层留 `provider` 字段,v4.0 多模型对比 |
| **C2PA provenance 标准合规** | Adobe Content Credentials 听起来工业级 | C2PA 主要服务于版权/真伪鉴别,不是创作溯源;对我们核心价值(改剧本定位镜头)无帮助 | 自建 `creative_history` JSON schema,字段更贴合 pipeline;后续如需对外分发再补 C2PA 包装 |
| **通用 perceptual hash 库 (imagehash npm)** | 想用现成库 | 违反"零 npm 依赖"原则;imagehash 包 8 年未更新、无 ESM 支持 | 自己实现 pHash (DCT-II 8x8 → 64bit hamming);约 50 行代码 |
| **向量数据库 (Qdrant/Pinecone)** | bad case 检索听起来需要 | 额外基础设施、运维成本;我们 bad case 库规模 < 10K 条,暴力搜索足够 | JSON 文件 + 启动时加载到内存;查询时遍历计算余弦相似度 |

---

## Feature Dependencies

```
[A2: Seedance audio lip sync]
    └──requires──> [voice synthesis phase output (TTS audio per shot)]
    └──requires──> [gold-team supports seedance_omni_reference + audio_refs]
    └──enhances──> [B5: bad case (lip drift 可标记为 bad case)]

[B2: Cross-episode asset reuse]
    └──requires──> [perceptual hash implementation (pHash)]
    └──requires──> [face embedding via DINOv2 (gold-team)]
    └──requires──> [cross-project asset registry path (~/.kai/assets/ or shared dir)]
    └──enhances──> [B4: creative_history (asset 复用关系可追溯)]
    └──enhances──> [B6: fine-tuning (复用资产作为训练样本基线)]

[B4: Per-shot creative_history trace]
    └──requires──> [AssetBus extended schema (derived_from, content_hash)]
    └──requires──> [shot ↔ script_segment 反向索引]
    └──requires──> [script-lock phase 输出 script line → shot mapping]
    └──enables──> [改剧本自动定位受影响镜头 (killer feature)]

[B5: Bad case blacklist + generation-time rejection]
    └──requires──> [failed_shots 持久化到 ~/.kai/blacklist.jsonl]
    └──requires──> [B2 fingerprint (用于匹配相似 bad case)]
    └──requires──> [DINOv2 embedding for semantic similarity]
    └──enhances──> [B6: fine-tuning data source]

[B6: Data feedback fine-tuning]
    └──requires──> [B5 bad case 持久化 (作为训练负样本)]
    └──requires──> [Hermes audit data export (已有 _hermesAudit)]
    └──requires──> [evaluation-collector 输出 (已有 EvaluationCollector)]
    └──requires──> [训练数据 manifest schema]
    └──requires──> [operator 触发训练 (out-of-process)]

[D1: GLM-4.6v 升级] (PROJECT.md 已列,本研究附带覆盖)
    └──requires──> [glm-4.6v API key (operator)]
    └──enhances──> [continuity-auditor identity_match 准确性]
    └──enhances──> [B5 bad case LLM 标签化精度]
```

### Dependency Notes

- **A2 requires TTS-first ordering:** 当前 pipeline `voice` phase 在 `cloud-production` 之后,v3.0 需要调整顺序或新增 `voice-prerelease` 子阶段,为 Seedance audio_refs 提前合成对白音频。`final-audio` 仍处理 BGM/SFX/master。
- **B2 pHash 必须自实现:** 零 npm 依赖原则下,需要约 50-80 行实现 DCT-II + Hamming distance。已有的 `_computeFaceEmbeddingHash = sha256(path)` 必须保留为 fallback (gold-team 不支持 DINOv2 时降级)。
- **B4 AssetBus schema 升级要向后兼容:** 现有 `AssetBus.read/write` 是字符串 key → JSON value;需扩展为 `{ value, derived_from, content_hash, generated_at }` envelope。老数据读出来 `derived_from = null` 不影响。
- **B5 与 B6 共享 DINOv2 依赖:** 两个能力都需要 face/visual embedding。建议在 `character-asset-manager.js` 新增 `computeEmbedding(imagePath)` 方法,B5 和 B6 共享。
- **B6 不在 v3.0 触发训练:** v3.0 只产出 manifest + 推荐报告,operator 拿到后用脚本喂 trainer;这与"分布式多机部署 Out of Scope"一致。

---

## MVP Definition

### Launch With (v3.0 必交付)

最小可宣称"工业产线对齐"的交付集:

- [ ] **A2-lite: Seedance omni + audio_refs 字段打通** — 即使 operator 不立即启用,接口和 phase 顺序要就位;支持 `final-audio` → `cloud-production` 的二次合成路径
- [ ] **B2: pHash fingerprint + cross-episode manifest** — 至少跑通"首集建库 → 第二集查库 → hit 则复用 L1/L2 资产"
- [ ] **B4: creative_history JSON schema + shot ↔ script 反向索引** — 改一行剧本,系统能输出"受影响 shot_id 列表"(不一定自动重渲,只输出报告)
- [ ] **B5: failed_shots 持久化 + 启动时加载 + 生成时 prompt 注入** — bad case 库支持字符串标签和 pHash 相似度双查询
- [ ] **B6: 训练数据 manifest 导出器** — 跑完一集后,导出 `(failed_shot, anchor, audio, recommended_action)` JSONL,供 operator 评估
- [ ] **D1: GLM-4.6v API 替换 glm-4v-flash** — continuity-auditor 和 ai-scorer 模型字段切换

### Add After Validation (v3.1+)

- [ ] **A2-full: 自动化口型同步重试** — 检测到 lip drift 时自动 resubmit with stronger audio weight (依赖 B5 bad case 检测)
- [ ] **B2-anime: anime-style character 复用** — 当前 pHash 对动漫线条敏感度低,需调参或换 embedding
- [ ] **B4-auto-rerender: 改剧本自动触发受影响 shot 重渲** — v3.0 只输出列表,v3.1 接 `pipeline.rerunShots(shotIds)` 自动重跑
- [ ] **B5-vector-search: 向量检索替代暴力扫描** — bad case 库 > 10K 条时性能瓶颈
- [ ] **B6-auto-train: LoRA 训练触发** — operator 审批后自动调 trainer API

### Future Consideration (v4.0+)

- [ ] **C2PA provenance 合规** — 对外分发场景 (YouTube/B 站) 才需要
- [ ] **多模型 A/B** — PROJECT.md 已列 v4.0 候选
- [ ] **分布式多机部署** — PROJECT.md 已列 v4.0 候选;B6 训练阶段受益最大

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | 依赖 v2.0 模块 |
|---------|------------|---------------------|----------|---------|
| A2-lite (Seedance audio_refs 接口) | HIGH (业界 SOTA 基础门槛) | MEDIUM | **P1** | gold-team-client, cloud-production handler, final-audio ordering |
| B2 (pHash + cross-episode) | HIGH (系列剧成本核心) | MEDIUM (50-80 行 pHash + 索引文件) | **P1** | CharacterAssetManager, AssetBus |
| B4 (creative_history trace) | HIGH (差异化 killer feature) | HIGH (AssetBus schema 升级 + 反向索引) | **P1** | AssetBus, pipeline.js, script-lock handler |
| B5 (bad case blacklist) | MEDIUM-HIGH (GPU 成本节约) | MEDIUM (持久化 + prompt 注入) | **P1** | ShotParallelScheduler, cloud-production handler, video_tasks.json |
| B6 (fine-tuning manifest) | MEDIUM (operator 后置触发) | MEDIUM (manifest schema + exporter) | **P2** | EvaluationCollector, Hermes audit, B5 输出 |
| D1 (GLM-4.6v 升级) | MEDIUM (评分稳定性) | LOW (改 model 字符串) | **P1** | continuity-auditor, ai-scorer, hermes-adapter |

**Priority key:**
- P1: v3.0 必交付 (6 项,其中 D1 是 LOW cost 顺带做)
- P2: v3.0 内尽量交付 (B6)
- P3: v3.1+ (auto-rerender / auto-train 等)

---

## Competitor Feature Analysis

| Feature | Kling O1 (Kuaishou) | SkyReels V4 (Kunlun) | Seedance 2.0 (ByteDance) | 本项目 v3.0 目标 |
|---------|---------------------|----------------------|--------------------------|-----------|
| **多模态输入** | Text+Img+Vid (Element Library) | Text+Img (up to 3) + Vid | Text+Img(9)+Vid(3)+Audio(3) | 依赖 Seedance 2.0 API (gold-team 接入) |
| **角色一致性** | Element Library (1 主图 + 3 补充, `@element` 引用) | Grid image reference 系统 | L1 anchor + L2 costume (本项目原创) | **超越**:L1-L4 分层 + pHash 跨集复用 |
| **音频驱动口型** | 不支持原生 (需后期合成) | V4 修复了音画同步 (HackerNoon 报道) | 原生支持,1-3 speakers | A2 直接用 Seedance 2.0 原生能力 |
| **跨集复用** | Element Library (平台账号绑定,最多 100 个) | 无明确跨集复用机制 | 无明确跨集复用机制 | **差异化**:本地私有库,无 100 上限 |
| **provenance / trace** | 无公开 API | 无公开 API | 无公开 API | **强差异化**:B4 creative_history 链 |
| **bad case 拒绝** | 无 (negative prompt 字符串) | 无 | 无 | **差异化**:pHash + DINOv2 embedding 双索引 |
| **fine-tuning 回流** | 闭源不开放 | 闭源不开放 | 闭源不开放 | **强差异化**:开源/自建产线的核心价值 |
| **定价模型** | Credit-based (5 credit/AI multi-shot) | Subscription + credit | Credit ($0.012-0.040/sec) | 自有 GPU 池 (gold-team),无 per-credit 成本 |

**战略结论:** Kling/SkyReels/Seedance 都是闭源 SaaS,核心差异化在于"私有资产库 + 自建回流"。本项目 v3.0 的 B2/B4/B5/B6 组合正是 SaaS 无法触达的能力栈,值得作为 milestone 核心价值传递。

---

## Implementation Hooks in v2.0 Codebase

本研究针对每个 v3.0 feature,定位了 v2.0 现有的接入点:

| Feature | v2.0 Hook | 修改点 |
|---------|-----------|-------|
| **A2** | `lib/phases/index.js` line 3061 (`seedance_omni_reference` 任务),line 3693 (`lip_sync_rt` 独立函数) | `params` 增加 `audio_refs` 字段;在 `cloud-production` after-hook 检测 lip drift,失败时触发 `lip_sync_rt` 兜底 |
| **B2** | `lib/character-asset-manager.js` (整个类),`lib/phases/index.js` line 284/288 (`_computeFaceEmbeddingHash` / `_computeCostumeFingerprint` 占位) | 替换占位为真实 pHash;新增 `AssetRegistry` 类管理跨项目 manifest |
| **B4** | `lib/asset-bus.js` (未读但被广泛使用),`lib/git-stage-manager.js` (已有 git 集成) | `AssetBus.write` 增加 `derived_from` 参数;新增 `creative-history-tracer.js` |
| **B5** | `lib/phases/index.js` line 3100 (`failed_shots` 已收集),`lib/continuity-auditor.js` (评分但未持久化 bad case) | 新增 `bad-case-blacklist.js`;`cloud-production` before-hook 调用 |
| **B6** | `lib/evaluation-collector.js`,line 196 (`_hermesAudit` 全 phase 调用) | 新增 `data-flywheel-exporter.js`;`delivery` phase 调用导出 |
| **D1** | `lib/continuity-auditor.js` line 398 (`model: 'glm-4v-flash'`),`lib/hermes-adapter.js` (callLLMJson) | 全局 model 字符串替换;hermes-adapter 默认模型升级 |

---

## Confidence Assessment

| Feature | Confidence | 来源 | 需 operator 验证点 |
|---------|-----------|------|-------|
| A2 Seedance audio | **HIGH** | Seedance 官方文档明确 "up to 3 audio files, mp3/wav, ≤15s" + `@Audio1` prompt 引用 | gold-team 是否暴露 audio_refs 参数 |
| B2 pHash 跨集复用 | **HIGH** (原理), **MEDIUM** (实现) | Kling O1 Element Library 证明可行;DCT-II pHash 是 20 年成熟技术 | gold-team DINOv2 接口是否暴露 |
| B4 creative_history | **MEDIUM** | USD/Halie 是 VFX 工业标准,但 AIGC 管线无公开参考;本项目 schema 自研 | 无外部依赖 |
| B5 bad case blacklist | **HIGH** | Hard negative mining (GeNIe, ECCV 2020)、negative prompts 是行业标准 | gold-team embedding 接口 |
| B6 数据回流 | **HIGH** (概念), **MEDIUM** (执行) | NVIDIA Data Flywheel Blueprint、arXiv 2510.06674 AITL 框架 | LoRA 训练流程由 operator 控制 |
| D1 GLM-4.6v | **HIGH** | GLM 官方模型升级路径明确 | operator API key 配额 |

---

## Sources

### 官方文档 (HIGH confidence)
- [Seedance 2.0 官方站 — Multi Reference + Audio 模态规格](https://seedance2.ai/)
- [Kling O1 Element Library Release Note — 跨集复用机制](https://kling.ai/release-note/release-notes/u3o4p73f2h)
- [SkyReels V4 arXiv 论文 — 双流架构多模态生成](https://arxiv.org/html/2602.21818v1)
- [SkyReels.ai 官方站 — 多模态 reference 特性](https://www.skyreels.ai/)
- [USD Universal Scene Description 官方介绍 — 工业 provenance 标准](https://openusd.org/release/intro.html)
- [USD/Halie metadata — NVIDIA Developer Forums](https://forums.developer.nvidia.com/t/understanding-types-of-meta-data-and-what-travels-with-usd-file/223663)

### 学术研究 (HIGH confidence)
- [GeNIe: Generative Hard Negative Images Through Diffusion (arXiv 2312.02548)](https://arxiv.org/html/2312.02548v1)
- [A Data Flywheel for Continuous Improvement in LLM-based Customer Service (arXiv 2510.06674)](https://arxiv.org/html/2510.06674v2)
- [Learn from Failure: Fine-Tuning LLMs with Trial-and-Error Data (ACL 2024)](https://aclanthology.org/2024.acl-long.45.pdf)
- [Hard Negative Examples Are Hard, But Useful (ECCV 2020)](https://www.ecva.net/papers/eccv_2020/papers_ECCV/papers/123590120.pdf)

### MLOps 实践 (MEDIUM-HIGH confidence)
- [Data Flywheels for LLM Applications — Tian Pan](https://tianpan.co/blog/2025-09-28-data-flywheels-llm-applications)
- [The Data Flywheel Effect in AI Model Improvement — Gradient Flow](https://gradientflow.substack.com/p/the-data-flywheel-effect-in-ai-model)
- [More Design Patterns For Machine Learning Systems — Eugene Yan](https://eugeneyan.com/writing/more-patterns/)
- [NVIDIA Tool-Calling Data Flywheel — Cobus Greyling](https://cobusgreyling.medium.com/nvidia-tool-calling-data-flywheel-for-smarter-smaller-language-models-a-practical-guide-b6f551b29980)
- [W&B Data Flywheel Blueprint for NVIDIA](https://github.com/wandb/data-flywheel-nvidia)

### 第三方教程 (MEDIUM confidence)
- [SkyReels V4 Tutorial - Create Consistent AI Characters (YouTube)](https://www.youtube.com/watch?v=YVdsO8VWWfU)
- [Top 5 Seedance 2.0 Lip Sync Techniques (YouTube)](https://www.youtube.com/watch?v=EvjY-9pmNZE)
- [Testing Seedance 2.0 Audio Reference Mode (YouTube)](https://www.youtube.com/watch?v=m8FZKMRCoyw)
- [HackerNoon: SkyReels V4 Fixes Audio Sync](https://hackernoon.com/skyreels-v4-fixes-the-most-uncanny-part-of-ai-video-bad-sound-sync)
- [Zilliz: What Is Hard Negative Mining?](https://zilliz.com/ai-faq/what-is-hard-negative-mining-and-how-does-it-improve-embeddings)

### 本地代码考古 (HIGH confidence,v2.0 现状)
- `lib/character-asset-manager.js` — L1-L4 分层已就位,fingerprint 是占位
- `lib/continuity-auditor.js` — DINOv2 探测已实现,缓存机制可复用
- `lib/phases/index.js` — phaseHandlers 全 20 phase 已实化,Hermes audit 已覆盖
- `.planning/PROJECT.md` — v3.0 Active 区段明确列出 5 大能力

---
*Feature research for: AIGC 短视频工业化流水线 v3.0*
*Researched: 2026-06-22*
