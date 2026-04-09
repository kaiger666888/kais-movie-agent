# Video Generation Prompt Template

## 变量

| 变量 | 来源 | 说明 |
|------|------|------|
| `{character_desc}` | CharacterBible.appearance | 角色外观描述 |
| `{action}` | Shot.action | 动作描述 |
| `{scene}` | SceneDesign.location + atmosphere | 场景环境 |
| `{camera}` | Shot.camera.angle + movement | 摄影机运动 |
| `{style}` | ArtDirection.style_name + texture | 美术风格 |
| `{motion}` | ArtDirection.light_quality + texture | 光影质感 |

## Prompt 结构（英文，即梦效果最佳）

```
{style}, {character_desc}, {action}, in {scene}, {camera} shot, {motion}, cinematic lighting, high quality, 4K
```

## 中文 Prompt 结构（备选）

```
{style}风格，{character_desc}，{action}，{scene}场景，{camera}镜头，{motion}，电影级光影，高质量
```

## 镜头类型 → motion_strength 推荐

| camera.angle | 默认 motion | camera.movement 时 | 说明 |
|-------------|------------|-------------------|------|
| extreme-close-up | 1 | 2 | 眼睛/嘴唇特写 |
| close-up | 1-2 | 3 | 面部特写 |
| medium-close-up | 2 | 3-4 | 胸部以上 |
| medium-shot | 2-3 | 4-5 | 半身 |
| medium-full-shot | 3 | 5-6 | 膝盖以上 |
| full-shot | 3-4 | 6-7 | 全身 |
| long-shot | 4-5 | 7-8 | 远景 |
| extreme-long-shot | 2 | 5-6 | 大远景（运动少更稳定）|
| low-angle | +1 | +2 | 仰拍增加动态感 |
| high-angle | +0 | +1 | 俯拍 |
| dutch-angle | +1 | +2 | 倾斜构图 |
| over-the-shoulder | 2 | 3 | 过肩镜头 |
| bird-eye-view | 1 | 3 | 鸟瞰 |

## 特殊场景调整

- **对话场景**: motion_strength ≤ 3，保持自然
- **战斗场景**: motion_strength 7-9，强调冲击力
- **情感场景**: motion_strength 1-2，缓慢、克制
- **转场/过渡**: motion_strength 5-6，中等动感
- **片头/片尾**: motion_strength 3-4，沉稳大气
