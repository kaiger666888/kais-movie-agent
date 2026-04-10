# kais-movie-agent — AI 短片制作全流程管线

## 触发词
`movie agent`, `短片制作`, `AI短片`, `视频管线`, `film pipeline`, `movie-wuji`

## 管线流程

```
Phase 1: 需求确认
  ↓
Phase 2: 美术方向 (kais-art-direction)
  ↓
Phase 3: 角色设计 (kais-character-designer)
  ↓
Phase 4: 剧本编写 (kais-scenario-writer)
  ↓
Phase 5: 场景图生成 (kais-scene-designer)
  ↓
Phase 5.3: 线稿生成 ← NEW: sketch-generator.py
  ↓
Phase 5.4: 线稿审核 ← NEW: scene-evaluator.py --mode sketch
  ↓
Phase 5.5: 基于线稿渲染 ← NEW: sketch-to-render.py
  ↓
Phase 5.6: 渲染审核 ← NEW: scene-evaluator.py --mode render
  ↓
Phase 6: 分镜板 (kais-storyboard-designer)
  ↓
Phase 7: 视频生成 (kais-camera)
  ↓
Phase 8: 后期合成 + 交付
```

## 线稿控制管线（Phase 5.3-5.6）

两阶段生成策略：先线稿锁定构图，再基于线稿渲染释放风格。

### Phase 5.3: 线稿生成
```bash
python3 lib/scripts/sketch-generator.py \
  --prompt "角色坐在桌前吃面，看着面前的屏幕" \
  --space "SUBJECT:角色正面坐姿，双手持筷;PROPS:碗、筷子、屏幕;COMPOSITION:中景" \
  --ref assets/characters/char_wuji/front-source.png \
  --output assets/sketches/B03-eating.png
```

参数：
- `--sample-strength 0.35`：角色参考图影响强度
- `--model jimeng-5.0`：默认模型
- `--ratio 9:16`：竖屏视频比例

### Phase 5.4: 线稿审核
```bash
python3 lib/scripts/scene-evaluator.py --mode sketch spec.json assets/sketches/
```
检查：构图合理性、纯黑白、关键元素完整、线条清晰。FAIL 则重新生成。

### Phase 5.5: 基于线稿渲染
```bash
python3 lib/scripts/sketch-to-render.py \
  --sketch assets/sketches/B03-eating.png \
  --prompt "赛博朋克风格，霓虹灯光，暗色调" \
  --ref assets/characters/char_wuji/front-source.png \
  --output assets/scenes/B03-eating.png
```

参数：
- `--sample-strength 0.25`：线稿结构保留强度
- images 顺序：[线稿(结构), 角色参考图(外观)]
- `--style` 可额外指定风格关键词

### Phase 5.6: 渲染审核
```bash
python3 lib/scripts/scene-evaluator.py --mode render spec.json assets/scenes/
```
检查：无残留线稿、风格统一、角色一致、构图保持。

## 跳过线稿管线
对于简单场景或快速迭代，可跳过线稿阶段直接生成：
在 prompt 中添加 `--no-sketch` 或直接使用 Phase 5 的直接生成模式。

## 子 Skill 列表

| Skill | Phase | 功能 |
|-------|-------|------|
| kais-art-direction | 2 | 美术方向/视觉风格定义 |
| kais-character-designer | 3 | 角色设计 + 参考图生成 |
| kais-scenario-writer | 4 | 剧本/分镜编写 |
| kais-scene-designer | 5 | 场景图生成 |
| kais-storyboard-designer | 6 | 分镜板设计 |
| kais-camera | 7 | 视频生成 + 合成 |
| kais-shooting-script | - | 拍摄脚本生成 |

## 共享工具

| 工具 | 路径 | 功能 |
|------|------|------|
| sketch-generator.py | lib/scripts/ | 线稿生成 |
| sketch-to-render.py | lib/scripts/ | 线稿→渲染 |
| scene-evaluator.py | lib/scripts/ | 场景图评价（支持 sketch/render/default 模式）|
| jimeng-client.js | lib/ | 即梦 API 客户端（Node.js）|
| cost-scheduler.js | lib/ | 积分/成本调度 |

## 底层依赖
- **文生图**: 即梦 API (jimeng-5.0)
- **视频生成**: Seedance 2.0
- **评价**: 智谱 GLM-4V-Flash
- **合成**: FFmpeg

## 环境变量
- `JIMENG_SESSION_ID`: 即梦 session ID
- `JIMENG_API_URL`: 即梦 API 地址（默认 http://localhost:8000）
