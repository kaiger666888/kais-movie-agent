/**
 * kais-anatomy-guard — 肢体解剖修复守卫
 * ES Module
 *
 * 三级防御：预防（negative_prompt）→ 检测（GLM-4V）→ 修复（prompt 重试）
 * 即梦 API 不支持 OpenPose/ADetailer，采用视觉模型检测 + prompt 重试方案。
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

// ─── 预防层：Negative Prompt 片段 ─────────────────────

const ANATOMY_NEGATIVE = [
  // 手部
  '多余手指', '多指', '六指', '七指', '手指融合', '手指粘连',
  '手指数量错误', '异常手指', 'extra finger', 'merged fingers',
  // 肢体
  '肢体变形', '比例失调', '手臂过长', '手臂过短',
  '腿部扭曲', '腿部长度异常', '躯干扭曲',
  // 头身比
  '头身比失调', '头部过大', '头部过小', '身体比例异常',
  // 面部
  '面部不对称', '五官变形', '眼睛大小不一',
  // 通用
  '人体畸形', '解剖错误', '身体扭曲', 'bad anatomy',
  'mutated hands', 'poorly drawn hands', 'ugly hands',
  'extra digits', 'fewer digits', 'malformed limbs',
].join(', ');

/**
 * 获取解剖预防 negative prompt
 */
export function getAnatomyNegative() {
  return ANATOMY_NEGATIVE;
}

/**
 * 将解剖 negative prompt 追加到现有 negative prompt
 */
export function appendAnatomyNegative(existingNegative) {
  if (!existingNegative) return ANATOMY_NEGATIVE;
  return `${existingNegative}, ${ANATOMY_NEGATIVE}`;
}

// ─── 检测层：GLM-4V 视觉检测 ─────────────────────────

const VALIDATION_PROMPT = `你是AI图像解剖结构审核员。请仔细检查图片中的人物解剖结构，返回严格的JSON格式。

检查维度：
1. hands - 手指：检查每只手的手指数量是否为5根，手指是否清晰分开无粘连
2. proportions - 比例：头身比是否正常（约1:7），四肢长度比例是否协调
3. face - 面部：五官是否对称，大小比例是否协调

评分标准：
- 1.0 = 完美，无任何解剖问题
- 0.8-0.9 = 轻微问题（如手指略模糊但不影响整体）
- 0.5-0.7 = 明显问题（多指、比例失调等）
- 0.0-0.4 = 严重变形

请返回JSON（不要其他文字）：
{
  "overall_score": 0.0-1.0,
  "hands": { "score": 0.0-1.0, "finger_count": "5/5", "issues": ["描述问题"] },
  "proportions": { "score": 0.0-1.0, "head_body_ratio": "正常/偏大/偏小", "issues": ["描述问题"] },
  "face": { "score": 0.0-1.0, "symmetry": "良好/轻微不对称/明显不对称", "issues": ["描述问题"] },
  "anatomy_pass": true/false,
  "repair_suggestions": ["修复建议1", "修复建议2"]
}`;

/**
 * 使用 anatomy-validator.py (GLM-4V) 检测图片中的解剖变形
 * @param {string} imagePath - 图片本地路径
 * @param {object} [options] - 选项
 * @param {string} [options.mode='full'] - 检测模式: full|hands|face|body
 * @param {number} [options.threshold=0.6] - 通过阈值
 * @returns {Promise<object>} 检测结果
 */
export async function validate(imagePath, { mode = 'full', threshold = 0.6 } = {}) {
  const scriptPath = new URL('../../../../lib/scripts/anatomy-validator.py', import.meta.url).pathname;

  return new Promise((resolve) => {
    const args = [scriptPath, imagePath, '--mode', mode, '--threshold', String(threshold)];
    execFile('python3', args, { timeout: 90_000 }, (err, stdout, stderr) => {
      const reportPath = imagePath + '.anatomy.json';

      // 无论成功/失败，尝试读取 JSON 报告
      try {
        const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
        resolve(report);
      } catch (_) {
        if (err) {
          // 检测脚本执行失败
          console.error('[anatomy-guard] 检测失败:', stderr || err.message);
          resolve({ pass: false, score: 0, issues: ['检测执行失败'], error: err.message,
                   regions: {}, retry_hint: '重新生成', negative_boost: 'bad anatomy, deformed' });
        } else {
          // 通过但无报告
          resolve({
            pass: true, score: 1.0, issues: [], regions: {},
            retry_hint: '', negative_boost: '',
          });
        }
      }
    });
  });
}

// ─── 修复层：基于检测结果的 Prompt 重试 ──────────────────

const REPAIR_PROMPTS = {
  hands: [
    '每只手严格5根手指，手指清晰分开，不粘连不融合',
    '双手自然姿态，五指分明，指甲清晰可见',
  ],
  proportions: [
    '正常人体比例，头身比约1:7，四肢长度协调',
    '标准人体骨架，身体各部分比例自然',
  ],
  face: [
    '面部五官对称，左右两侧大小比例一致',
    '端正的面部，双眼等大等距，鼻子居中',
  ],
};

/**
 * 根据检测结果生成修复 prompt 片段
 * @param {object} validationResult - validate() 的返回值
 * @returns {string|null} 修复 prompt 片段，无需修复时返回 null
 */
export function buildRepairPrompt(validationResult) {
  if (!validationResult || validationResult.anatomy_pass) return null;

  const suggestions = [];

  if (validationResult.hands?.score < 0.8) {
    const idx = Math.floor(Math.random() * REPAIR_PROMPTS.hands.length);
    suggestions.push(REPAIR_PROMPTS.hands[idx]);
  }
  if (validationResult.proportions?.score < 0.8) {
    const idx = Math.floor(Math.random() * REPAIR_PROMPTS.proportions.length);
    suggestions.push(REPAIR_PROMPTS.proportions[idx]);
  }
  if (validationResult.face?.score < 0.8) {
    const idx = Math.floor(Math.random() * REPAIR_PROMPTS.face.length);
    suggestions.push(REPAIR_PROMPTS.face[idx]);
  }

  if (suggestions.length === 0) return null;

  return `人体结构修正：${suggestions.join('；')}。严格保持正常人体解剖结构。`;
}

/**
 * 根据检测结果增强 negative prompt
 * @param {object} validationResult
 * @returns {string} 增强的 negative prompt 片段
 */
export function buildRepairNegative(validationResult) {
  const extras = [];

  if (validationResult.hands?.score < 0.8) {
    extras.push('多指, 手指粘连, 手指融合');
  }
  if (validationResult.proportions?.score < 0.8) {
    extras.push('比例失调, 头身比异常');
  }
  if (validationResult.face?.score < 0.8) {
    extras.push('面部不对称, 五官变形');
  }

  return extras.length > 0 ? extras.join(', ') : '';
}

/**
 * 判断整体是否通过
 */
export function isPass(validationResult) {
  if (!validationResult) return true;
  if (validationResult.error) return true; // 检测失败时放行
  return validationResult.anatomy_pass !== false;
}

/**
 * 获取降级建议
 * @param {object} validationResult
 * @returns {string[]} 降级建议列表
 */
export function getFallbackStrategies(validationResult) {
  const strategies = [];

  if (validationResult.hands?.score < 0.6) {
    strategies.push('改变拍摄角度：从正面改为侧面，减少手部暴露');
    strategies.push('景深模糊：模糊手部区域，降低变形可见度');
  }
  if (validationResult.proportions?.score < 0.6) {
    strategies.push('调整构图：使用中景或全景，降低比例敏感度');
    strategies.push('构图裁切：裁掉变形明显的身体区域');
  }

  return strategies;
}
