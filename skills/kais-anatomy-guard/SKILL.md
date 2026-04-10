# kais-anatomy-guard — 肢体解剖修复守卫

## 触发词
`anatomy guard`, `肢体修复`, `手部畸形`, `手指修复`, `比例检查`, `解剖检查`, `变形检测`

## 定位
原子能力层 — 在生成前注入结构约束，生成后检测并尝试修复肢体变形。作为 kais-storyboard-designer 的内置守卫能力。

## 核心思想
**检测优先，修复为辅** — 即梦 API 不支持 OpenPose/ADetailer，采用三级防御：
1. **预防层**：negative_prompt 预置变形排除词
2. **检测层**：GLM-4V 视觉模型检测变形
3. **修复层**：基于检测结果调整 prompt 重试

## 架构

```
生成前（预防）
  ↓ negative_prompt 预置变形排除词
  ↓ 参考图骨骼提示注入 prompt
生成中
  ↓ 即梦 API 生成图片
生成后（检测+修复）
  ↓ GLM-4V 比例验证
  ↓ PASS → 输出
  ↓ FAIL → 分析变形类型 → 调整 prompt 重试
```

## 三级防御

### 第一级：预防（Pre-generation）
在 negative_prompt 中预置常见变形排除词：
```
多余手指, 手指融合, 多指, 六指, 手指数量错误, 肢体变形,
比例失调, 手臂过长, 腿部扭曲, 头身比失调, 面部不对称
```

### 第二级：检测（Post-generation）
使用 GLM-4V 视觉模型检测生成图中的变形：
- 手指数量（是否为 5 根）
- 肢体比例（头身比、手臂长度）
- 面部对称性
- 手脚大小

### 第三级：修复（Retry）
基于检测结果生成针对性修复 prompt：
- 手指问题 → negative_prompt 增强 + 提示"5根手指清晰分开"
- 比例问题 → 调整构图提示
- 面部问题 → 增强对称性描述
- 最多 2 次修复重试，超过则降级

## 降级策略
1. 改变拍摄角度（如从正面改为侧面，避开手部）
2. 景深模糊（模糊变形区域）
3. 构图裁切（裁掉变形区域）
4. 标记 anatomy_pass: false，下游知晓

## 输出 Schema

```json
{
  "anatomy_pass": true,
  "deformation_log": {
    "hands": { "score": 0.9, "issues": [] },
    "proportions": { "score": 0.85, "issues": ["左臂略长"] },
    "face": { "score": 0.95, "issues": [] }
  },
  "repair_attempts": 0
}
```

## 与现有 Skill 的集成

### kais-storyboard-designer / kais-scene-designer
- `sketch-generator.py` negative_prompt 已追加 anatomy 排除词
- `sketch-to-render.py` negative_prompt 已追加 anatomy 排除词
- `scene-evaluator.py` 线稿和渲染审核已追加肢体完整性检查维度
- 生成后可调用 `anatomy-validator.py` 做专项检测

### kais-shooting-script
- output schema 增加 anatomy 相关 negative_prompt 片段

### kais-camera
- 视频生成前的静态帧同样经过 anatomy 检查

## 检测工具

### anatomy-validator.py（推荐）
位于 `lib/scripts/anatomy-validator.py`，使用 GLM-4V-Flash 视觉模型：

```bash
# 完整检测
python3 lib/scripts/anatomy-validator.py render.png --mode full --threshold 0.6

# 仅检测手部
python3 lib/scripts/anatomy-validator.py render.png --mode hands

# 仅检测面部
python3 lib/scripts/anatomy-validator.py render.png --mode face

# 仅检测身体比例
python3 lib/scripts/anatomy-validator.py render.png --mode body
```

输出 JSON 报告到 `<image>.anatomy.json`。

### guard.js（Node.js API）
```javascript
import { validate, appendAnatomyNegative, buildRepairPrompt } from './skills/kais-anatomy-guard/lib/guard.js';

// 预防：追加 anatomy negative prompt
const negative = appendAnatomyNegative(existingNegative);

// 检测：运行 anatomy-validator.py
const result = await validate('./render.png', { mode: 'full', threshold: 0.6 });

// 修复：基于检测结果生成修复 prompt
const repairPrompt = buildRepairPrompt(result);
```

## 方案选择说明

即梦 API 不支持 ADetailer/OpenPose/ControlNet，因此采用：
- **GLM-4V-Flash 检测** — 零部署成本，复用已有视觉模型
- **negative_prompt 增强** — 预防式减少变形生成
- **参数调整重试** — 降低 sample_strength + 增强 prompt 重试生成
- **构图降级** — 最后手段，通过构图规避问题

未来可扩展：本地 ComfyUI + ControlNet OpenPose（需 GPU）

## 文件结构
```
kais-anatomy-guard/
├── SKILL.md
├── lib/
│   └── guard.js
└── prompts/
    └── anatomy-negative.md
```
