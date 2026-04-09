---
name: kais-camera
description: "视频生成执行层。基于拍摄脚本批量生成视频片段，支持Seedance异步生成、4级降级策略、静态图fallback。触发词：'生成视频'、'拍摄'、'视频生成'、'制作视频'、'批量生成'、'AI视频'、'镜头生成'、'视频制作'、'generate video'、'camera'、'video production'、'shoot'、'render'、'executeShot'。触发场景：用户提供拍摄脚本后需要批量生成视频、需要将分镜/脚本转化为视频片段、需要AI视频批量渲染、用户说'帮我拍/生成/制作视频'。"
---

# kais-camera — 摄像机（视频生成执行层）

基于拍摄脚本（ShootingScript）批量生成视频片段，封装 kais-jimeng 的底层 API 能力。

## 架构定位

```
kais-shooting-script → [ShootingScript] → kais-camera → [VideoClip[]] → kais-editor
                                            ↓
                                      kais-jimeng (底层API)
```

- **kais-camera** = 业务层封装（重试、降级、进度追踪）
- **kais-jimeng** = 底层 API 客户端（直接调即梦接口）

## 数据契约

遵循 `/tmp/crew-v3-build/movie-schema.json`。输出格式见 `references/output-schema.json`。

## 核心特性

<!-- FREEDOM:low -->

### 1. Seedance 异步生成（推荐）
- 有 `file_paths` 的 shot → 直接调 `submitSeedanceTask` + `pollTask`
- 无 `file_paths` → 先文生图拿素材 → 再 Seedance
- prompt 自动加 `@1` 引用

### 2. 4级降级策略
1. **L1** — Seedance 完整参数：原始 prompt + motion_strength
2. **L2** — 简化 prompt：去除次要修饰，motion_strength -2
3. **L3** — 极简 prompt：仅角色+核心动作，motion_strength = 2
4. **L4** — 静态图 fallback：用 jimeng-5.0 文生图

### 3. 重试机制
- 每级最多 1 次尝试，共 3 次重试（L1→L2→L3），全部失败 → 降级 L4
- 每次重试换 seed（seed + attempt * 1000）

### 4. 进度追踪
- 实时回调 `onProgress(current, total, shot_id)`
- 单镜头完成回调 `onShotComplete(clip)`

## 执行流程

### Step 1: 解析 ShootingScript
读取每个 VideoShot 的 `api_params` 和 `fallback`。

### Step 2: 批量执行
遍历 shots，对每个调用 `executeShot`，收集结果。

### Step 3: 单镜头执行（executeShot）
1. 读取 shot.api_params
2. 有 file_paths → `generateSeedanceVideo()`；无 → 先 `generateImage()` 再 Seedance
3. 失败 → `applyRetryStrategy()` 重试（最多 3 次）
4. 3 次失败 → `fallbackToImage()`
5. 返回 VideoClip

### Step 4: 汇总报告
统计成功率、总成本、总时长。

## 并发控制

- 默认并发 1（避免 API 限流），可配置最大 3，信号量模式。

## Prompt 增强

详见 `prompts/video-prompt-enhancer.md`。

## 文件索引

- `lib/camera.js` — CameraOperator 核心类
- `lib/video-assembler.js` — VideoAssembler 拼接类
- `prompts/video-prompt-enhancer.md` — Prompt 增强模板
- `references/output-schema.json` — 输出数据结构
- `references/usage-example.js` — 使用示例
