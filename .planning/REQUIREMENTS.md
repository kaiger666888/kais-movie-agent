# Milestone v2.0 Requirements — Pipeline Remediation

> **Goal:** 修复评估发现的 P0 架构断裂 + P1 工业化缺失,让 20 阶段 workflow 端到端可执行并产出首支成片
>
> **Scope driver:** 2026-06-22 工业化评估报告(P0+P1 全面整改)

---

## Requirements

### ARCH — 架构对齐(P0 致命)

- [ ] **ARCH-01**: 补完 PHASES 数组中 14 个空 handler,使 `phaseHandlers` 与 `PHASES` 100% 对齐(20/20)
  - 涉及: `pain-discovery`, `topic-selection`, `outline-generation`, `outline-selection`, `script-generation`, `script-selection`, `character-generation`, `character-selection`, `scene-generation`, `scene-selection`, `script-lock`, `consistency-guard`, `cloud-production`, `final-audio`, `delivery`
- [ ] **ARCH-02**: `HermesClient.VALID_PHASES` 与新 `PHASES` 数组同步,或改为服务端开放枚举
- [ ] **ARCH-03**: 验证 `V2_MIGRATION_MAP` 旧→新 ID 映射正确性,清理 stale 引用
- [ ] **ARCH-04**: `character-generation` handler 实际调用 `CharacterAssetManager` 生成 L1 身份锚点(20选3) + L2 造型卡片(compositions API)

### QUAL — 质量保障实化(P0 致命)

- [ ] **QUAL-01**: `_getDINOv2Score` 接入真实视觉模型(智谱 GLM-4V 或 gold-team DINOv2),删除 `return 0.85` 假数据
- [ ] **QUAL-02**: 删除 `quality-gate.js` 默认 80% 兜底(`Math.round(meta.max * 0.8)`),LLM 失败立即标记评分异常
- [ ] **QUAL-03**: `consistency-guard` 阶段实际调用 `auditContinuity()` 并阻断不合格 shot(不再 silent pass)
- [ ] **QUAL-04**: `auditImageVsL1` 在场景图/分镜首帧生成后即时触发,阈值 < 0.7 重试

### PERF — 镜头级并行与成本核算(P1)

- [ ] **PERF-01**: 实现 `parallel_shots: 4` 真正的 `Promise.all` 镜头级并行调度
- [ ] **PERF-02**: GPU 任务 `waitForTask` 阻塞 pipeline(不再"提交即 completed"),轮询间隔 5s,超时 10min
- [ ] **PERF-03**: 单集 GPU-分钟成本核算报表(`evaluation-collector` 聚合,产出 `cost-report.json`)
- [ ] **PERF-04**: 镜头级失败重试预算(`max_retries: 1` 自适应至 3)

### SAFE — 工程安全(P1)

- [ ] **SAFE-01**: `CompositionEngine.compose()` 改用 `execFile` + args 数组,禁止 shell 字符串拼接
- [ ] **SAFE-02**: FFmpeg 输入路径与 filter_complex 字符 sanitize(拒绝含 `"`, `` ` ``, `$`, `;` 的路径)
- [ ] **SAFE-03**: 删除 CompositionEngine fallback 中的二次字符串拼接降级链

### E2E — 端到端验证(P0 验收)

- [ ] **E2E-01**: 至少 1 集 60s 短剧从 `requirement` 阶段跑到 `final.mp4` 产出
- [ ] **E2E-02**: 在 `projects/` 目录产出可播放成片(mp4 + wav 音轨)
- [ ] **E2E-03**: 整改前后回归测试 — 确保 v1.0 的 9 phases 不被破坏
- [ ] **E2E-04**: 一致性审计在 E2E 中实际触发并产出非空 `consistency-pass.json`

---

## Future Requirements (deferred to v3.0+)

- 多机分布式部署(Redis 队列 + N workers)
- TypeScript 迁移(至少 lib/ 核心模块)
- CI/CD pipeline(GitHub Actions)
- 资产指纹去重 + 跨剧集复用(SHA256 hash)
- 镜头级 A/B 测试(同镜头多模型选优)
- 失败 case 库 + bad case 黑名单

---

## Out of Scope (this milestone)

- 非 Node.js 运行时支持
- 非 GPU 任务类型
- 审核平台 UI 改造(review-platform 不动)
- 新增 gold-team 引擎类型(只用现有 44 种)

---

## Traceability

(filled by roadmapper)

| REQ-ID | Phase | Success Criterion |
|--------|-------|-------------------|
| ARCH-01 | TBD | TBD |
| ARCH-02 | TBD | TBD |
| ... | ... | ... |
