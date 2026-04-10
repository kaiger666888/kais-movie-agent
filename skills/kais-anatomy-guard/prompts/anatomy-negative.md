# Anatomy Negative Prompt 片段

## 预防层（Pre-generation）

在每次图片生成的 negative_prompt 中追加以下片段，预防常见解剖变形：

```
多余手指, 手指融合, 多指, 六指, 手指数量错误, 异常手指, extra finger, merged fingers,
肢体变形, 比例失调, 手臂过长, 手臂过短, 腿部扭曲, 腿部长度异常, 躯干扭曲,
头身比失调, 头部过大, 头部过小, 身体比例异常,
面部不对称, 五官变形, 眼睛大小不一,
人体畸形, 解剖错误, 身体扭曲, bad anatomy,
mutated hands, poorly drawn hands, ugly hands,
extra digits, fewer digits, malformed limbs
```

## 修复层（Post-generation）

根据 GLM-4V 检测结果，针对性增强 negative prompt：

| 检测问题 | 追加 negative | 追加 prompt |
|---------|-------------|------------|
| 手指问题 | 多指, 手指粘连, 手指融合 | 每只手严格5根手指，手指清晰分开 |
| 比例问题 | 比例失调, 头身比异常 | 正常人体比例，头身比约1:7 |
| 面部问题 | 面部不对称, 五官变形 | 面部五官对称，左右两侧大小比例一致 |

## 使用方式

```js
import { getAnatomyNegative, buildRepairPrompt, buildRepairNegative } from './lib/guard.js';

// 预防
const negative = getAnatomyNegative();

// 检测
const result = await validate(imageUrl);
if (!isPass(result)) {
  // 修复 prompt
  const repairPrompt = buildRepairPrompt(result);
  const repairNeg = buildRepairNegative(result);
  // 重试生成...
}
```
