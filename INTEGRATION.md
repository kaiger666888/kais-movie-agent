# kais-movie-agent 集成状态

> 更新: 2026-05-18
> 状态: **V1.0 已交付** — Phase 0-4A 全部完成

## V1.0 交付物

### GPU 引擎对接 (13 函数)

| 函数 | 任务类型 | Phase | 降级 |
|------|----------|-------|------|
| `generateArtDirectionViaGoldTeam()` | image_draw | art-direction | 即梦 API |
| `refineArtDirectionViaGoldTeam()` | image_refine | art-direction | 即梦 API |
| `controlArtDirectionViaGoldTeam()` | image_control | art-direction | 即梦 API |
| `generateVideoViaGoldTeam()` | video_final / video_preview_fast | camera | 即梦 API |
| `interpolateVideoViaGoldTeam()` | video_interpolate | camera | 跳过 |
| `styleTransferVideoViaGoldTeam()` | video_to_video | camera | 跳过 |
| `cloneVoice()` | voice_clone | voice | ZHIPU TTS |
| `convertVoice()` | voice_convert | voice | 跳过 |
| `generateBGM()` | music_final | post-production | 跳过 |
| `generateSFX()` | sfx_generation | post-production | 跳过 |
| `separateAudio()` | audio_separate | post-production | 跳过 |
| `lipSync()` | lip_sync_rt | (预留) | 跳过 |
| `submitTTS()` | tts_generation | voice | ZHIPU GLM-TTS |

### 新增模块

| 模块 | 职责 |
|------|------|
| `lib/asset-bus.js` | 跨 phase 资产总线 (.pipeline-assets/) |
| `lib/ai-scorer.js` | 剧本质量评分（注入 LLM 函数） |
| `lib/prompt-injector.js` | 从 asset-bus 自动组装 GPU prompt |
| `lib/shot-list-parser.js` | 镜头参数 → GPU 参数映射 |
| `test/phase4a-gpu-integration.test.js` | 16 tests |

### 外部服务依赖

| 服务 | 认证 | 用途 |
|------|------|------|
| gold-team (:8900) | X-API-Key | GPU 任务调度 |
| review-platform (:8090) | JWT | 审核+回调 |
| 即梦 API | API Key | 图像/视频降级 |
| 智谱 GLM | API Key | LLM 文本/视觉/TTS |
| Telegram Bot | Token | 通知 |

### GPU 功能开关

```javascript
pipeline.config.goldTeam = {
  baseUrl: 'http://192.168.71.140:8900',
  apiKey: process.env.GOLD_TEAM_API_KEY,
  enableFluxArt: true,       // art-direction FLUX
  enableVideoGpu: true,      // camera GPU video
  enableVoiceClone: true,    // voice clone/convert
  enableBGM: true,           // post-production BGM
  enableSFX: true,           // post-production SFX
}
```

## LLM 调用点 (6 处，全部智谱 GLM)

计划迁移至 openclaw/hermes-agent:

| 文件 | 模型 | 用途 | 迁移优先级 |
|------|------|------|-----------|
| `lib/llm.js` | glm-4-flash | 通用补全 | P1 |
| `lib/1st-director.js` | glm-4-flash | 四维蓝图 | P1 |
| `lib/quality-gate.js` | glm-4.6v-flash | 质量评分 | P1 |
| `lib/scripts/anatomy-validator.py` | glm-4.6v | 人体检测 | P2 |
| `lib/scripts/scene-evaluator.py` | glm-4.6v | 场景评估 | P2 |
| `lib/phases/index.js` | glm-4-voice | TTS 回退 | P2 |

## 待办

### P0 — gold-team Worker 镜像对齐 ✅ 已完成 (2026-05-19)
- [x] FLUX (kais-forge) — Dockerfile + adapter + build script + YAML 就绪
- [x] Wan/LTX 视频生成 — Dockerfile + adapter + build script + YAML 就绪
- [x] GPT-SoVITS / RVC — Dockerfile + adapter + build script + YAML 就绪
- [x] Stable Audio — Dockerfile + adapter + build script + YAML 就绪
- [x] UVR5 音频分离 — Dockerfile + adapter + build script + YAML 就绪
- [x] LivePortrait — Dockerfile + adapter + build script + YAML 就绪
- 注: 全部 25 个引擎均已完成（含 Blender, FaceFusion, ACE-Step, Woosh, Parallax 等）

### P1 — 真实联调 ✅ 已完成 (2026-05-19)
- [x] E2E 测试框架 — test/e2e-gold-team.test.js（14 GPU 函数 + submitTTS 覆盖）
- [x] 双模式测试 — 无 gold-team 自动跳过，有服务时运行全量测试
- [x] 降级测试 — submitTaskDegraded / submitTTSDegraded 验证

### P2 — LLM 迁移 ✅ 已完成 (2026-05-19)
- [x] Hermes MCP Server — hermes-worker-agent/hermes/server.py（6 tools: memory/plan/reflect/learn/llm/llm_vision）
- [x] lib/llm.js — 重新导出自 hermes-adapter.js，透明路由
- [x] lib/1st-director.js — _callLLM 改用 hermes-adapter.callLLM
- [x] lib/quality-gate.js — _callLLM 改用 hermes-adapter.callLLM
- [x] lib/scripts/anatomy-validator.py — 改用 hermes_helper.call_hermes_vision
- [x] lib/scripts/scene-evaluator.py — evaluate_single + evaluate_depth 改用 hermes_helper
- [x] lib/hermes-adapter.js — Node.js Hermes 路由层（自动降级到直连 ZHIPU）
- [x] lib/scripts/hermes_helper.py — Python Hermes 路由层（vision + text）
