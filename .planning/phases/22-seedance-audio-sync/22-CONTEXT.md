# Phase 22: Seedance 2.0 Audio-Visual Sync - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-generated (integration phase — discuss skipped, research deferred to operator)

<domain>
## Phase Boundary

让 `cloud-production` handler 用 Seedance 2.0 原生音画同步替代 v2.0 的"先生成视频再 dub"两步流程。

**核心变化**:
1. `CharacterAssetManager.getOmniReferencePack()` 扩展 `audioRefs` 参数
2. `cloud-production` handler 接入 voice phase 输出(时序锁)
3. Seedance 任务提交时强制校验 `@Audio1` prompt 绑定存在(避免 Pitfalls 陷阱 1)
4. 中文 lip sync 测试集 + lip_sync_threshold 现实化

**核心问题(Pitfalls research 陷阱 1,最隐蔽失败)**:
Seedance 2.0 若 audio_refs 非空但 prompt 无 `@Audio` token,**会静默忽略 audio**,生成无声视频。degraded mode 看不出来,只有真实 GPU run 才暴露。

</domain>

<decisions>

## Implementation Decisions

### getOmniReferencePack 扩展

```javascript
// lib/character-asset-manager.js
async getOmniReferencePack(characterId, opts = {}) {
  const { costumeId, sceneFrame, actionVideos = [], audioRefs = [] } = opts;  // 新增 audioRefs
  
  // ... existing identity/scene/action collection ...
  
  const promptBindings = [];
  // ... existing identity/scene/action bindings ...
  
  // 新增 audio bindings (A2-01)
  if (audioRefs.length > 0) {
    audioRefs.forEach((audio, i) => {
      const audioIdx = i + 1;
      promptBindings.push(`@Audio${audioIdx} 为角色 ${audio.character || '主角色'} 提供对白音频,严格匹配口型`);
    });
  }
  
  return {
    identityImages, sceneImages, actionVideos,
    audioRefs,  // 新增
    allFiles: [...identity, ...sceneImages, ...actionVideos, ...audioRefs.map(a => a.path)],
    promptBindings: promptBindings.join('. '),
    hasAudio: audioRefs.length > 0,
  };
}
```

### cloud-production voice 时序锁

```javascript
// lib/phases/index.js cloud-production handler
'cloud-production': {
  after: async (pipeline, phase, phaseConfig) => {
    const stsScript = await bus.read('spatio-temporal-script') || {};
    const voiceTimeline = await bus.read('voice-timeline');  // v2.0 Phase 5 产出
    
    // A2-02 时序锁:有 dialogue 但无 voice-timeline → 显式报错
    const hasDialogue = (stsScript.shots || []).some(s => s.dialogue?.text);
    if (hasDialogue && !voiceTimeline) {
      throw new Error('cloud-production 时序锁违反: shots 含对白但 voice-timeline 未就绪(voice phase 未完成)');
    }
    
    // ... 收集 audio refs ...
    for (const shot of shots) {
      if (shot.dialogue?.text && voiceTimeline?.[shot.id]?.audioPath) {
        shotAudioRefs.push({
          path: voiceTimeline[shot.id].audioPath,
          character: shot.dialogue.character,
        });
      }
    }
    
    // ShotParallelScheduler with audio
    const results = await scheduler.runWithRetry(shots, async (shot) => {
      const refPack = await assetManager.getOmniReferencePack(shot.character_id, {
        costumeId: shot.costume_id,
        sceneFrame: shot.scene_frame_path,
        audioRefs: shotAudioRefs.filter(a => a.shot_id === shot.id),  // 按镜头过滤
      });
      
      // A2-03 强制 @Audio 校验
      if (refPack.hasAudio && !refPack.promptBindings.includes('@Audio')) {
        throw new Error(`Shot ${shot.id} audio_refs 非空但 prompt 无 @Audio 绑定`);
      }
      
      return gtClient.submitTask({
        task_type: 'seedance_omni_reference',  // 假设 gold-team 服务端支持 audio 字段
        params: {
          ...refPack,
          generate_audio: refPack.hasAudio,  // Seedance 2.0 flag
        },
      });
    }, { maxRetries: 3, blacklist });
    
    // ... write video_tasks.json + audio sync report ...
  },
},
```

### 中文 lip sync 测试集

```
test/lip-sync-samples/
├── README.md           # operator 补充说明
├── samples.json        # 测试集 metadata
│   [{ id, prompt, audio_path, expected_threshold, scenario }]
├── audio/              # 实际中文对白音频(operator 补)
└── anchors/            # L1 身份锚点(operator 补)
```

- 框架就位,实际音频 operator 补
- `scripts/run-lip-sync-test.js` 跑全测试集,产出 `lip-sync-report.json`
- 报告含每样本的实际 lip_sync 分数 + 平均 + 推荐 threshold

### lip_sync_threshold 现实化

```javascript
// HERMES_DEFAULTS.delivery (lib/phases/index.js)
delivery: {
  lip_sync_threshold: 0.75,  // 从 1.0 降到 0.75(based on 测试集预期)
  // ... rest unchanged
}
```

### Claude's Discretion

- **降级**:gold-team 不可达 → cloud-production 写 stub video_tasks.json(audio 字段占位)
- **不强制 voice**:无 dialogue 镜头正常跑(不加 audio_refs)
- **测试**:时序锁 / @Audio 校验 / 降级 / 无 dialogue 路径

</decisions>

<code_context>

### Reusable Assets
- `lib/character-asset-manager.js:228` getOmniReferencePack(扩展点)
- `lib/phases/index.js` cloud-production handler(已实化于 Phase 15)
- `lib/asset-bus.js` voice-timeline slot(v2.0 已有,由 Phase 5 voice 写入)
- `lib/shot-parallel-scheduler.js` runWithRetry(Phase 21 已加 blacklist hook)

### Integration Points
- voice phase 完成后,voice-timeline.json 必须就位
- cloud-production 提交 Seedance 任务时透传 audio_refs
- delivery handler 读 lip-sync-report.json 校验 lip_sync_threshold

</code_context>

<specifics>

- **Seedance audio API**: 字节官方支持 up to 3 audio segments,15s total,格式 wav/mp3 ≤15MB
- **@Audio token**: prompt 中显式声明,否则模型忽略 audio
- **中文偏见**: Seedance 2.0 英文优于中文,中文 threshold 0.75(英文 0.85)
- **不做**: 不实现 gold-team 服务端 task_type 升级(假设已支持,operator 验证)

</specifics>

<deferred>

- 实际 GPU 跑测试集 → operator
- gold-team task_type: 'seedance_omni_reference_pro' 验证 → operator
- 上游 voice phase 实化(当前是 stub,Phase 22 假设 voice-timeline.json 已存在)→ Phase 22 不依赖,降级路径处理

</deferred>
