# Phase 15: 镜头级并行 + 工程安全 - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>

## Phase Boundary

落实三个 P1 工业化能力:

1. **镜头级并行 (PERF-01, PERF-02)**: `cloud-production` / `ai-preview` / `final-production` 中的多 shot 生成必须真正 Promise.all 并发(`parallel_shots: 4`),且 GPU 任务 `waitForTask` 阻塞 pipeline(不再"提交即 completed")

2. **CompositionEngine 安全 (SAFE-01, SAFE-02, SAFE-03)**: 
   - `execSync(cmd_string)` → `execFile(ffmpegPath, args_array)`
   - 路径 sanitize(拒绝含 `"`, `` ` ``, `$`, `;`, `\n` 的路径)
   - 删除 fallback 中的二次字符串拼接降级链

**核心问题**:
- `lib/phases/index.js` 的 `cloud-production` 是 Phase 10 stub,从未真实生成视频
- `lib/composition-engine.js:65-87` 的 ffmpeg 命令用字符串拼接,路径含特殊字符会爆
- 配置中声明 `parallel_shots: 4` 但代码从未实现

</domain>

<decisions>

## Implementation Decisions

### 镜头级并行调度器 (新增 `lib/shot-parallel-scheduler.js`)

```javascript
export class ShotParallelScheduler {
  constructor({ parallelism = 4, pipeline }) {
    this.parallelism = parallelism;
    this.pipeline = pipeline;
  }

  /**
   * 并行执行 shot-level 任务,等所有完成才返回
   * @param {Array<Shot>} shots
   * @param {(shot) => Promise<Result>} taskFn
   * @returns {Promise<Array<Result>>}
   */
  async runAll(shots, taskFn) {
    const results = new Array(shots.length);
    let nextIndex = 0;
    
    const workers = Array.from({ length: Math.min(this.parallelism, shots.length) }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= shots.length) break;
        try {
          results[i] = await taskFn(shots[i]);
        } catch (err) {
          results[i] = { shot_id: shots[i].id, error: err.message };
        }
      }
    });
    
    await Promise.all(workers);
    return results;
  }
}
```

### cloud-production handler 实化

```javascript
'cloud-production': {
  after: async (pipeline, phase, phaseConfig) => {
    const bus = new AssetBus(pipeline.workdir);
    const stsScript = await bus.read('spatio-temporal-script') || {};
    const shots = stsScript.shots || [];
    
    if (!shots.length) {
      // 降级:无 shots 写 stub
      await writeFile(...);
      return { summary: { skipped: 'no shots' }, metrics: {} };
    }
    
    const scheduler = new ShotParallelScheduler({
      parallelism: HERMES_DEFAULTS['cloud-production'].parallel_shots,
      pipeline,
    });
    
    // 真实 Seedance omni_reference 视频生成
    const results = await scheduler.runAll(shots, async (shot) => {
      // 1. 组装 omni_reference pack
      const refPack = await assetManager.getOmniReferencePack(shot.character_id, {
        costumeId: shot.costume_id,
        sceneFrame: shot.scene_frame_path,
      });
      
      // 2. 提交 Seedance 任务
      const gtClient = _makeGtClient(pipeline);
      const task = await gtClient.submitTask({
        task_type: 'seedance_omni_reference',
        params: {
          prompt: shot.description,
          identity_refs: refPack.identityImages,
          scene_refs: refPack.sceneImages,
          action_refs: refPack.actionVideos,
          identity_weight: 0.7,
          action_weight: 0.3,
        },
      });
      
      // 3. waitForTask 阻塞(5s 轮询,10min 超时)
      const completed = await gtClient.waitForTask(task.task_id, {
        pollIntervalMs: 5000,
        timeoutMs: 600000,
      });
      
      return {
        shot_id: shot.id,
        task_id: task.task_id,
        video_path: completed.artifacts?.[0]?.path,
        status: 'completed',
      };
    });
    
    await writeFile(join(pipeline.workdir, 'video_tasks.json'), JSON.stringify({ tasks: results }, null, 2));
    // ...
  },
},
```

### CompositionEngine execFile 重写

```javascript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);

// 路径 sanitize
function sanitizePath(p) {
  if (!p || typeof p !== 'string') throw new Error('Invalid path');
  if (/["`\$\n;|]/.test(p)) {
    throw new Error(`Path contains forbidden characters: ${p}`);
  }
  return p;
}

async compose(inputs) {
  // ... 检查路径 ...
  for (const p of [videoPath, dialoguePath, bgmAmbientPath, ...]) {
    if (p) sanitizePath(p);
  }
  
  // 用 execFile + args 数组
  const args = ['-y', '-i', videoPath];
  for (const audio of audioInputs) {
    args.push('-i', audio);
  }
  args.push('-filter_complex', filterComplex, '-map', '0:v', '-map', '[out]',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', output);
  
  try {
    await execFileP(this.ffmpegPath, args, { timeout: 300000 });
  } catch (err) {
    // 单一降级:无音频直接复制视频
    if (audioInputs.length === 0) {
      await execFileP(this.ffmpegPath, ['-y', '-i', videoPath, '-c', 'copy', output], { timeout: 120000 });
    } else {
      throw err;  // 不再二次字符串拼接
    }
  }
  
  return { output, audio_tracks: audioInputs.length };
}
```

### Claude's Discretion

- **降级**: gold-team 不可用 → cloud-production 写 stub video_tasks.json(为 Phase 17 E2E 留空降级)
- **并发控制**: scheduler 实现 backpressure(失败 shot 不阻塞其他)
- **waitForTask 接口**: lib/gold-team-client.js 已有 `waitForTask()` 方法(line 311 of phases/index.js 已调用过),直接用
- **不做**: 不实现真实 Seedance API 调用(假设 gold-team task_type: 'seedance_omni_reference' 已支持,实际可不可用留给 E2E 验证)
- **测试**: 
  - ShotParallelScheduler 单元测试(并发度、错误隔离)
  - CompositionEngine 单元测试(sanitize 拒绝特殊字符,execFile 调用)

</decisions>

<code_context>

## Existing Code Insights

### Reusable Assets
- `lib/gold-team-client.js` — `GoldTeamClient.waitForTask()` 已存在
- `lib/character-asset-manager.js:228-269` — `getOmniReferencePack()` 已实现
- `lib/composition-engine.js` — 现有引擎(本 phase 重写)
- `lib/asset-bus.js`
- `lib/phases/index.js` 的 `cloud-production` (Phase 10 stub, 本 phase 替换)

### Established Patterns
- V4.1 `ai-preview` handler 使用串行 `for...of`(本 phase 升级为并行)
- V4.1 `final-production` handler 同样串行

### Integration Points
- `lib/phases/index.js` 的 `cloud-production` / `ai-preview` / `final-production`
- `lib/composition-engine.js` 被 `composition` handler 调用

</code_context>

<specifics>

## Specific Ideas

- **parallelism 来源**: HERMES_DEFAULTS['cloud-production'].parallel_shots = 4
- **超时**: 单 shot 最长 10 分钟,超过则该 shot 失败但不阻塞其他
- **失败 shot 处理**: 写入 `failed_shots` 数组,Phase 16 的重试预算会处理
- **execFile**: `node:child_process` + `promisify`
- **sanitize 规则**: 拒绝 `"`, `` ` ``, `$`, `;`, `|`, `\n`, `\r` (常见 shell 元字符)
- **不做**: 不实现真实 Seedance 模型接入,留给 v3.0

</specifics>

<deferred>

## Deferred Ideas

- gold-team Seedance omni_reference 真实接入(本 phase 假设 task_type 已支持)→ v3.0
- 镜头级 A/B 测试 → v3.0
- 跨 episode 并发调度 → v3.0

</deferred>
