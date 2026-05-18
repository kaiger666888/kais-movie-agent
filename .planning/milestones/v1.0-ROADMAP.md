# ROADMAP — kais-movie-agent 集成

> Milestone: v1.0 — AIGC Integration
> Created: 2026-05-17

## Phase 1: GoldTeamClient 创建
- status: complete
- goal: 新建 lib/gold-team-client.js，GPU 任务调度客户端，参考 review-platform-client.js 模式
- requirements:
  - submitTask / getTask / listTasks / waitForTask / submitTTS 方法
  - X-API-Key 认证，HMAC 回调验证
  - ES module + native fetch
  - GoldTeamError 错误类
- success_criteria:
  - [x] GoldTeamClient.js 文件存在且可正常 import
  - [x] 所有方法符合 INTEGRATION.md Task 1 规范

## Phase 2: Review Client 降级逻辑
- status: complete
- goal: 在 review-platform-client.js 的 submitReview 中添加降级逻辑，服务不可用时自动放行
- requirements:
  - submitReview 捕获超时/5xx 错误，降级返回 DEGRADED_AUTO
  - 记录降级审计日志
  - GoldTeamClient 也需降级（不可用时回退本地或跳过）
- success_criteria:
  - [ ] review-platform-client.js submitReview 有降级路径
  - [ ] 降级时返回 DEGRADED_AUTO + APPROVED
  - [ ] gold-team-client.js 有降级方法
  - [ ] 不影响正常流程

## Phase 3: Voice Phase 集成 GoldTeamClient
- status: complete
- goal: 将 voice phase 的 TTS 调用改为通过 gold-team 调度
- requirements:
  - voice phase handler 使用 GoldTeamClient.submitTTS
  - 支持 waitForTask 轮询模式
  - 下载产物到 assets/tts/
- success_criteria:
  - [ ] voice phase 通过 GoldTeamClient 调度 TTS
  - [ ] TTS 产物正确保存
  - [ ] 支持 gold-team 配置传入

## Phase 4: 多候选审核调用改造
- status: complete
- goal: 提交审核时携带 candidates（3选1等），支持评分和反馈
- requirements:
  - submitReview 支持 candidates 参数
  - metadata 包含 select_mode, max_select, candidates, enable_scoring
  - 契约: review-platform-api.yaml
- success_criteria:
  - [ ] 审核提交可携带 candidates 数组
  - [ ] 支持 enable_scoring 和 enable_feedback 配置
  - [ ] 不破坏现有 submitReview 接口

## Phase 5: art-direction FLUX 图像生成 (4A.2)
- status: complete
- priority: P0
- goal: 增加 art-direction phase 通过 gold-team FLUX 引擎生成高质量图像
- requirements:
  - 新增 generateArtDirectionViaGoldTeam 函数
  - 使用 image_draw (FLUX) / image_refine / image_control 任务类型
  - 支持 num_images 多候选生成
  - 带降级回退
- success_criteria:
  - [x] art-direction phase 可通过 gold-team 生成 FLUX 图像
  - [x] 支持多候选输出
  - [x] gold-team 不可用时优雅降级

## Phase 6: camera VIDEO_FINAL 视频生成 (4A.5)
- status: complete
- priority: P0
- goal: 增加 camera phase 通过 gold-team VIDEO_FINAL 引擎生成视频
- requirements:
  - 新增 generateVideoViaGoldTeam 函数
  - 支持 video_preview_fast / video_preview / video_final / video_to_video / video_interpolate
  - preview_mode 切换快速/正式模式
  - 带降级回退
- success_criteria:
  - [x] camera phase 可通过 gold-team 生成视频
  - [x] 支持 preview/final 模式切换
  - [x] gold-team 不可用时优雅降级

## Phase 7: voice VOICE_CLONE/CONVERT (4A.6)
- status: complete
- priority: P1
- goal: 增加 voice phase 声音克隆和变声能力
- requirements:
  - 新增 cloneVoice 函数 (voice_clone)
  - 新增 convertVoice 函数 (voice_convert)
  - 带降级回退
- success_criteria:
  - [x] voice phase 支持声音克隆
  - [x] voice phase 支持变声
  - [x] gold-team 不可用时优雅降级

## Phase 8: post-production MUSIC/SFX (4A.7)
- status: complete
- priority: P0
- goal: 通过 gold-team 生成配乐、音效、音频分离
- requirements:
  - 新增 generateBGM 函数 (music_final)
  - 新增 generateSFX 函数 (sfx_generation)
  - 新增 separateAudio 函数 (audio_separate)
  - 带降级回退
- success_criteria:
  - [x] post-production phase 支持配乐生成
  - [x] 支持音效生成
  - [x] 支持音频分离
  - [x] gold-team 不可用时优雅降级

## Phase 9: lip-sync LIP_SYNC_RT (4A.8)
- status: complete
- priority: P2
- goal: 后期口型同步
- requirements:
  - 新增 lipSync 函数 (lip_sync_rt)
  - 带降级回退
- success_criteria:
  - [x] lip-sync 可通过 gold-team 执行口型同步
  - [x] gold-team 不可用时优雅降级
