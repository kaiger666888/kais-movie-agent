# V6 Architecture (from Notion)
> Source: https://www.notion.so/V6-36b11082af8e80ebb857c19c61afbfa3
> Retrieved: 2026-05-25

This file contains the full V6 architecture spec for reference by development workers.

## Key Changes from Current Pipeline

### Current (V4.1): 10 phases
1. requirement-bible → 2. soul-visual → 3. soul-voice → 4. geometry-bed → 5. spatio-temporal-script → 6. seed-skeleton → 7. motion-preview → 8. ai-preview → 9. final-production → 10. composition

### V6: 20 steps in 2 halves
**上半部分：创意立项 (Steps 1-11)**
1. 调查痛点 (kais-soul-radar)
2. 选择主题 (human)
3. 生成大纲 (kais-script-agent)
4. 选择大纲 (AI+human)
5. 生成剧本 (kais-script-agent)
6. 选择剧本 (AI+human)
7. 生成主角 3图一体 (AI)
8. 选择主角 → soul-pack.json (DINOv2 + human)
9. 生成场景 6图一体 (AI)
10. 选择场景 → geometry-bed.json (AI + human)
11. 生成时空剧本 (kais-spatio-temporal-agent)

**下半部分：生产执行 (Steps 12-20)**
12. 剧本锁定审核 (Script Lock)
13. 生成种子骨架 (Seed-and-Skeleton) - 13A视觉种子 + 13B声音骨架
14. 运镜定稿与动态预览 (Motion Preview) - 14A运镜定稿 + 14B动态预览
15. AI风格化预览与 Seedance 生产包定稿
16. 一致性守护检查 (Consistency Guard)
17. 云端终版视频生产 (Seedance 2.0) - 17A对白 + 17B视频
18. 本地 BGM 与声音闭环 (Final Audio)
19. 剪辑合成 (Composition)
20. 质检与交付 (Delivery & Archive)

### Major New Components
- **Seedance 2.0** audio-driven video generation (cloud)
- **CosyVoice2** voice locking (local)
- **kais-soul-radar** pain point discovery
- **kais-script-agent** outline + script generation
- **kais-consistency-agent** cross-shot consistency guard
- **GPU Runtime Manager V5.1** stage-based scheduling
- **3060Ti** IO-only GPU (NVENC/ffmpeg, no inference)
- **Feedback loops** (max 3 iterations)
- **Asset library** (seedance-template, voice-model, soul-pack, music-stem)

### GPU Stage Mapping (V5.1)
| Phase | Stage | 3090 (所有推理) | 3060Ti (IO) |
|-------|-------|-----------|--------|
| 角色 | 3d_character | TRELLIS ~18G | NVENC |
| 场景 | 3d_scene | Hunyuan3D ~12G | - |
| 视觉种子 | image_refine | Kontext/FLUX ~16G | - |
| BGM骨架 | music_base | ACE Step base ~8G | - |
| 预览 | video_preview | LTX-Video ~12G | NVENC/ffmpeg |
| 视觉终版 | video_final | Wan 14B ~18G | NVENC/ffmpeg |
| 标志性BGM | music_final | ACE Step xl-sft ~17G | - |
| 对口型 | lip_sync | LatentSync ~7G | - |
