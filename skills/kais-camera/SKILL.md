---
name: kais-camera
description: "视频生成执行层，基于拍摄脚本批量生成视频片段，支持Seedance异步生成、重试降级、静态图fallback"
---

# kais-camera — 摄像机（视频生成执行层）

基于拍摄脚本（ShootingScript）批量生成视频片段，封装 kais-jimeng 的底层 API 能力。

## 激活条件

用户提到 "生成视频"、"拍摄"、"camera"、"视频生成"、"production"、"executeShot"、"批量生成" 时激活。

## 架构定位

```
kais-shooting-script → [ShootingScript] → kais-camera → [VideoClip[]] → kais-editor
                                            ↓
                                      kais-jimeng (底层API)
```

- **kais-camera** = 业务层封装（重试、降级、进度追踪）
- **kais-jimeng** = 底层 API 客户端（直接调即梦接口）

## 数据契约

遵循 `/tmp/crew-v3-build/movie-schema.json`。

### 输入
- **ShootingScript** — 拍摄脚本（每个 VideoShot 含 api_params, fallback）

### 输出
```json
{
  "type": "VideoClipList",
  "version": "3.0",
  "clips": [
    {
      "shot_id": "shot_001",
      "status": "success",
      "url": "/local/path/shot_001.mp4",
      "mode": "seedance",
      "attempts": 1,
      "duration": 4,
      "cost": 0.05
    }
  ],
  "total_cost": 0.35,
  "total_duration": 28,
  "success_rate": 0.85
}
```

## 核心特性

### 1. Seedance 异步生成（推荐）
- 有 `file_paths` 的 shot → 直接调 `submitSeedanceTask` + `pollTask`
- 无 `file_paths` → 先文生图拿素材 → 再 Seedance
- prompt 自动加 `@1` 引用

### 2. 4级降级策略
1. **L1 — Seedance 完整参数**：原始 prompt + motion_strength
2. **L2 — 简化 prompt**：去除次要修饰，motion_strength -2
3. **L3 — 极简 prompt**：仅角色+核心动作，motion_strength = 2
4. **L4 — 静态图 fallback**：用 jimeng-5.0 文生图（表型可塑性）

### 3. 重试机制
- 每级最多 1 次尝试，共 3 次重试（L1→L2→L3）
- 3 次全部失败 → 降级为静态图（L4）
- 每次重试换 seed（seed + attempt * 1000）

### 4. 进度追踪
- 实时回调 `onProgress(current, total, shot_id)`
- 单镜头完成回调 `onShotComplete(clip)`
- 最终成本报告

## 执行流程

### Step 1: 解析 ShootingScript
读取每个 VideoShot 的 `api_params` 和 `fallback`。

### Step 2: 批量执行
```
for each shot in shootingScript.shots:
  result = await executeShot(shot)
  if result.status === 'success':
    clips.push(result)
  else:
    clips.push(result) // 包含 fallback 信息
```

### Step 3: 单镜头执行（executeShot）
```
1. 读取 shot.api_params
2. 如果有 file_paths → generateSeedanceVideo()
3. 如果没有 file_paths → 先 generateImage() → 再 generateSeedanceVideo()
4. 失败 → applyRetryStrategy(shot, attempt) → 重试
5. 3次失败 → fallbackToImage(shot)
6. 返回 VideoClip
```

### Step 4: 汇总报告
统计成功率、总成本、总时长。

## 并发控制

- 默认并发：1（严格单线，避免 API 限流）
- 可配置 `concurrency`：最大 3
- 使用信号量模式控制

## Prompt 增强

详见 `prompts/video-prompt-enhancer.md`。

## 工具文件

- `lib/camera.js` — CameraOperator 核心类
- `lib/video-assembler.js` — VideoAssembler 拼接类
- `prompts/video-prompt-enhancer.md` — Prompt 增强模板

## 使用示例

```js
import { JimengClient } from './lib/jimeng-client.js';
import { CameraOperator } from './lib/camera.js';

const client = new JimengClient();
const camera = new CameraOperator(client, {
  outputDir: '/tmp/output',
  maxRetries: 3,
});

const result = await camera.executeAll(shootingScript, {
  concurrency: 1,
  onProgress: (current, total, shotId) => {
    console.log(`[${current}/${total}] ${shotId}`);
  },
  onShotComplete: (clip) => {
    console.log(`✅ ${clip.shot_id} → ${clip.url}`);
  },
});

console.log(camera.getCostReport());
```
