# 线稿管线完整参数（Phase 5.3-5.6）

## 概述
两阶段生成：先线稿锁定构图（Phase 5.3），再基于线稿渲染释放风格（Phase 5.5）。

## Phase 5.3: 线稿生成

```bash
python3 LIB_SCRIPTS/sketch-generator.py \
  --prompt "场景描述" \
  --output sketches/scene_01.png \
  --style sketch \
  --negative-prompt "bad anatomy, deformed, mutated hands, extra/missing limbs, bad proportions"
```

## Phase 5.4: 解剖预检（可选）
```bash
python3 LIB_SCRIPTS/anatomy-validator.py sketches/scene_01.png --mode full --threshold 0.6
```

## Phase 5.5: 基于线稿渲染（四维锚定融合）

```bash
python3 LIB_SCRIPTS/sketch-to-render.py \
  --sketch sketches/scene_01.png \
  --prompt "场景描述 + 风格描述" \
  --output scenes/scene_01.png \
  --style-ref art_direction/mood_board.png \
  --lighting "cinematic, golden hour" \
  --depth "foreground:blur, background:blur" \
  --sample-strength 0.75
```

### 四维锚定参数
| 维度 | 参数 | 说明 |
|------|------|------|
| 线稿结构 | `--sketch` | 锁定构图 |
| 风格参考 | `--style-ref` | Mood Board 风格锚定 |
| 光影 | `--lighting` | 光影氛围控制 |
| 深度层次 | `--depth` | 前中后景模糊控制 |

## Phase 5.6: 渲染审核
```bash
python3 LIB_SCRIPTS/scene-evaluator.py scenes/scene_01.png --mode render
```

## 成本对比

| 模式 | 每场景调用 | 积分 | 空间准确性 | 适用 |
|------|----------|------|----------|------|
| 快速（--no-sketch） | ~2次 | ~2 | 基准 | 简单/快速迭代 |
| 线稿（默认） | ~3次 | ~3 | +30-50% | 正式制作 |

## 参数配置表

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--sample-strength` | 0.75 | 渲染对线稿的忠实度（0-1） |
| `--threshold` | 0.6 | 解剖检测阈值 |
| `--mode` | full | 检测模式：hands/face/body/full |
| `--style` | sketch | 线稿风格 |
| `--retry-count` | 3 | 检测失败最大重试次数 |
