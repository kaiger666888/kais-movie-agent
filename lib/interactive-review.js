/**
 * interactive-review.js — kais-movie-agent 交互式审查引擎
 *
 * 支持两种模式:
 *   1. message 模式 — 通过 sendMessage/waitForReply 回调与用户实时交互
 *   2. file 模式    — 通过 .review-state.json 文件轮询（CLI 或外部触发）
 *
 * ES Module
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

// ─── 审查等级 ────────────────────────────────────────────

export const REVIEW_LEVELS = {
  REQUIRED: 'required',   // 必须人工确认
  OPTIONAL: 'optional',   // 可选确认，超时自动通过
  AUTO: 'auto',           // 自动审核（外部 evaluator 处理）
};

// ─── 审查决策 ────────────────────────────────────────────

export const DECISIONS = {
  APPROVED: 'approved',
  REDO: 'redo',
  MODIFIED: 'modified',
  SKIPPED: 'skipped',
  ROLLED_BACK: 'rolled_back',
  TIMEOUT: 'timeout',
  SELECT_A: 'select_a',
  SELECT_B: 'select_b',
};

// ─── 默认审查选项 ────────────────────────────────────────

const DEFAULT_OPTIONS = {
  approve: { label: '通过', emoji: '✅', keywords: ['通过', '好的', '可以', 'approve', 'ok', 'yes'] },
  redo:    { label: '重做', emoji: '🔄', keywords: ['重做', '重新生成', 'redo', 'regenerate', 'retry'] },
  modify:  { label: '修改', emoji: '✏️', keywords: ['修改', '调整', 'modify', 'change', 'fix'] },
  skip:    { label: '跳过', emoji: '⏭️', keywords: ['跳过', 'skip', 'pass'] },
  rollback:{ label: '回滚', emoji: '⏪', keywords: ['回滚', 'rollback', 'revert'] },
  select_a:{ label: '选A',  emoji: '🅰️', keywords: ['A', 'a', '版本A'] },
  select_b:{ label: '选B',  emoji: '🅱️', keywords: ['B', 'b', '版本B'] },
};

// ─── 各 Phase 审查配置 ───────────────────────────────────

export const REVIEW_CONFIGS = {
  'art-direction': {
    level: REVIEW_LEVELS.REQUIRED,
    timeout_seconds: 0,
    title: '美术方向确认',
    options: ['approve', 'redo', 'modify'],
    collectItems: (workdir) => [
      { id: 'mood_board', type: 'image', label: '情绪板', path: join(workdir, 'mood_board.png') },
      { id: 'color_palette', type: 'data', label: '色彩方案', path: join(workdir, 'color_palette.json') },
    ],
  },
  'character': {
    level: REVIEW_LEVELS.REQUIRED,
    timeout_seconds: 0,
    title: '角色设计确认',
    options: ['approve', 'redo', 'modify'],
    collectItems: (workdir) => [
      { id: 'front', type: 'image', label: '正面视角', path: join(workdir, 'assets/characters/front.png') },
      { id: 'three_quarter', type: 'image', label: '3/4 视角', path: join(workdir, 'assets/characters/three_quarter.png') },
      { id: 'side', type: 'image', label: '侧面视角', path: join(workdir, 'assets/characters/side.png') },
    ],
  },
  'scenario': {
    level: REVIEW_LEVELS.OPTIONAL,
    timeout_seconds: 1800,
    title: '剧本版本选择',
    options: ['select_a', 'select_b', 'redo'],
    ab_test: true,
    collectItems: (workdir) => [
      { id: 'variant_a', type: 'text', variant: 'A', label: '喜剧版本', path: join(workdir, 'scenario.json') },
      { id: 'variant_b', type: 'text', variant: 'B', label: '戏剧版本', path: join(workdir, 'scenario_b.json') },
    ],
  },
  'voice': {
    level: REVIEW_LEVELS.OPTIONAL,
    timeout_seconds: 1800,
    title: '配音音色选择',
    options: ['approve', 'redo'],
    collectItems: (workdir) => [
      { id: 'voice_assignments', type: 'data', label: '音色分配', path: join(workdir, 'voice_assignments.json') },
    ],
  },
  'scene': {
    level: REVIEW_LEVELS.OPTIONAL,
    timeout_seconds: 600,
    title: '场景图确认',
    options: ['approve', 'redo', 'modify'],
    collectItems: (workdir) => [
      { id: 'scene_design', type: 'data', label: '场景设计', path: join(workdir, 'scene_design.json') },
    ],
  },
  'storyboard': {
    level: REVIEW_LEVELS.OPTIONAL,
    timeout_seconds: 1800,
    title: '分镜板确认',
    options: ['approve', 'redo', 'modify'],
    collectItems: (workdir) => [
      { id: 'storyboard', type: 'data', label: '分镜序列', path: join(workdir, 'storyboard.json') },
      { id: 'shots', type: 'data', label: '镜头列表', path: join(workdir, 'shots.json') },
    ],
  },
  'camera': {
    level: REVIEW_LEVELS.REQUIRED,
    timeout_seconds: 0,
    title: '视频片段确认',
    options: ['approve', 'redo', 'modify'],
    collectItems: (workdir) => [
      { id: 'rough_cut', type: 'video', label: '粗剪视频', path: join(workdir, 'output/rough_cut.mp4') },
    ],
  },
};

// ─── InteractiveReviewer 类 ──────────────────────────────

export class InteractiveReviewer {
  /**
   * @param {object} options
   * @param {string} options.workdir - 项目工作目录
   * @param {'message'|'file'} [options.mode='file'] - 交互模式
   * @param {Function} [options.sendMessage] - 消息发送回调 (message: string) => Promise<void>
   * @param {Function} [options.waitForReply] - 等待回复回调 (timeoutMs: number) => Promise<string>
   * @param {number} [options.defaultTimeout=1800] - 默认超时秒数
   */
  constructor(options = {}) {
    this.workdir = options.workdir || process.cwd();
    this.mode = options.mode || 'file';
    this.sendMessage = options.sendMessage || null;
    this.waitForReply = options.waitForReply || null;
    this.defaultTimeout = options.defaultTimeout || 1800;

    this._statePath = join(this.workdir, '.review-state.json');
  }

  // ─── 核心方法 ──────────────────────────────────────────

  /**
   * 发起审查
   * @param {object} request
   * @param {string} request.phase_id - Phase ID
   * @param {string} request.phase_name - Phase 显示名
   * @param {string} request.level - 审查等级
   * @param {string} request.title - 审查标题
   * @param {Array} request.items - 审查项目
   * @param {Array} [request.options] - 可选操作 ID 列表
   * @param {number} [request.timeout_seconds] - 超时秒数
   * @returns {Promise<ReviewResult>}
   */
  async review(request) {
    const reviewId = `phase-${request.phase_id}`;
    const timeoutSec = request.timeout_seconds ?? this.defaultTimeout;

    // 构建完整审查请求
    const fullRequest = {
      review_id: reviewId,
      phase_id: request.phase_id,
      phase_name: request.phase_name,
      level: request.level,
      title: request.title,
      items: request.items || [],
      options: request.options || ['approve', 'redo', 'modify'],
      timeout_seconds: timeoutSec,
      created_at: new Date().toISOString(),
      context: {
        workdir: this.workdir,
      },
    };

    // 持久化审查请求
    await this._savePendingReview(fullRequest);

    // 发送审查消息
    const message = this._formatReviewMessage(fullRequest);

    if (this.mode === 'message' && this.sendMessage) {
      await this.sendMessage(message);
      // 等待用户回复
      const timeoutMs = timeoutSec > 0 ? timeoutSec * 1000 : 24 * 3600 * 1000; // required = 24h
      const reply = await this.waitForReply(timeoutMs);
      const result = this._parseResponse(reply, fullRequest);
      await this._saveResult(fullRequest.review_id, result);
      return result;
    }

    // file 模式: 等待外部 respond() 调用
    if (this.mode === 'file') {
      return this._waitForFileResponse(fullRequest);
    }

    // 无通道时自动通过
    return {
      review_id: fullRequest.review_id,
      decision: DECISIONS.TIMEOUT,
      responded_at: new Date().toISOString(),
      auto_approved: true,
    };
  }

  /**
   * 外部回复审查（CLI / 消息通道调用）
   * @param {string} reviewId
   * @param {object} response - { decision, feedback?, selected_variant?, selected_index? }
   * @returns {Promise<void>}
   */
  async respond(reviewId, response) {
    const state = await this._loadState();
    const pending = state.pending?.[reviewId];
    if (!pending) {
      throw new Error(`未找到待审查项: ${reviewId}`);
    }

    const result = {
      review_id: reviewId,
      decision: response.decision,
      feedback: response.feedback || null,
      selected_variant: response.selected_variant || null,
      selected_index: response.selected_index ?? null,
      responded_at: new Date().toISOString(),
      auto_approved: false,
    };

    pending.status = 'responded';
    pending.result = result;

    // 写入响应文件，通知等待中的管线
    const responsePath = join(this.workdir, `.review-response-${reviewId}.json`);
    await writeFile(responsePath, JSON.stringify(result, null, 2));

    // 更新状态
    state.history.push(result);
    delete state.pending[reviewId];
    await this._saveState(state);
  }

  /**
   * 列出所有待审查项
   * @returns {Promise<Array>}
   */
  async listPending() {
    const state = await this._loadState();
    return Object.entries(state.pending || {}).map(([id, entry]) => ({
      review_id: id,
      title: entry.request.title,
      level: entry.request.level,
      created_at: entry.request.created_at,
      status: entry.status,
    }));
  }

  /**
   * 获取审查历史
   * @returns {Promise<Array>}
   */
  async getHistory() {
    const state = await this._loadState();
    return state.history || [];
  }

  // ─── 消息格式化 ────────────────────────────────────────

  _formatReviewMessage(request) {
    const lines = [];

    lines.push(`🎬 审查请求 — ${request.phase_name}`);
    lines.push(`📋 ${request.title}`);
    lines.push('');

    // 审查项目
    for (const item of request.items) {
      const icon = { image: '🖼️', video: '🎥', audio: '🎵', text: '📝', data: '📊' }[item.type] || '📎';
      const variant = item.variant ? ` [版本${item.variant}]` : '';
      lines.push(`${icon} ${item.label}${variant}`);
      if (item.description) {
        lines.push(`   ${item.description}`);
      }
      if (item.path) {
        lines.push(`   📁 ${basename(item.path)}`);
      }
    }

    lines.push('');

    // 操作选项
    lines.push('请选择操作:');
    for (const optId of request.options) {
      const opt = DEFAULT_OPTIONS[optId];
      if (opt) {
        lines.push(`  ${opt.emoji} 回复 "${opt.label}" → ${this._describeOption(optId)}`);
      }
    }

    // 超时提示
    if (request.timeout_seconds > 0 && request.level === REVIEW_LEVELS.OPTIONAL) {
      const min = Math.round(request.timeout_seconds / 60);
      lines.push('');
      lines.push(`⏱️ ${min} 分钟无回复将自动通过`);
    }

    return lines.join('\n');
  }

  _describeOption(optId) {
    const descriptions = {
      approve: '确认通过，继续下一阶段',
      redo: '回滚当前阶段，重新生成',
      modify: '提供修改意见，调整后重新审查',
      skip: '接受当前结果，跳过审查',
      rollback: '回滚到指定历史阶段',
      select_a: '使用版本 A',
      select_b: '使用版本 B',
    };
    return descriptions[optId] || optId;
  }

  // ─── 回复解析 ──────────────────────────────────────────

  _parseResponse(text, request) {
    const normalized = text.trim().toLowerCase();

    // 检查每个选项的关键词
    for (const optId of request.options) {
      const opt = DEFAULT_OPTIONS[optId];
      if (!opt) continue;

      for (const keyword of opt.keywords) {
        if (normalized.includes(keyword.toLowerCase())) {
          const result = {
            review_id: request.review_id,
            decision: this._mapOptionToDecision(optId),
            responded_at: new Date().toISOString(),
            auto_approved: false,
          };

          // 提取修改意见
          if (optId === 'modify') {
            const modifyPatterns = [
              /修改[:：]\s*(.+)/,
              /调整[:：]\s*(.+)/,
              /modify[:：]?\s*(.+)/i,
              /change[:：]?\s*(.+)/i,
            ];
            for (const pattern of modifyPatterns) {
              const match = text.match(pattern);
              if (match) {
                result.feedback = match[1].trim();
                break;
              }
            }
            if (!result.feedback) {
              // 整条消息作为反馈
              result.feedback = text;
            }
          }

          // 回滚目标
          if (optId === 'rollback') {
            const rollbackMatch = text.match(/回滚到\s*(\S+)/);
            if (rollbackMatch) {
              result.feedback = rollbackMatch[1];
            }
          }

          return result;
        }
      }
    }

    // 无法识别，视为修改意见
    return {
      review_id: request.review_id,
      decision: DECISIONS.MODIFIED,
      feedback: text,
      responded_at: new Date().toISOString(),
      auto_approved: false,
    };
  }

  _mapOptionToDecision(optId) {
    const map = {
      approve: DECISIONS.APPROVED,
      redo: DECISIONS.REDO,
      modify: DECISIONS.MODIFIED,
      skip: DECISIONS.SKIPPED,
      rollback: DECISIONS.ROLLED_BACK,
      select_a: DECISIONS.SELECT_A,
      select_b: DECISIONS.SELECT_B,
    };
    return map[optId] || DECISIONS.APPROVED;
  }

  // ─── 文件模式等待 ──────────────────────────────────────

  async _waitForFileResponse(request) {
    const responsePath = join(this.workdir, `.review-response-${request.review_id}.json`);
    const timeoutMs = request.timeout_seconds > 0
      ? request.timeout_seconds * 1000
      : 24 * 3600 * 1000;
    const startTime = Date.now();
    const pollInterval = 3000; // 3 秒轮询

    while (Date.now() - startTime < timeoutMs) {
      try {
        const raw = await readFile(responsePath, 'utf-8');
        const result = JSON.parse(raw);
        // 清理响应文件
        try { await import('node:fs').then(fs => fs.promises.unlink(responsePath)); } catch {}
        return result;
      } catch {
        // 文件不存在，继续等待
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }

    // 超时
    const result = {
      review_id: request.review_id,
      decision: request.level === REVIEW_LEVELS.OPTIONAL ? DECISIONS.APPROVED : DECISIONS.TIMEOUT,
      responded_at: new Date().toISOString(),
      auto_approved: true,
    };
    await this._saveResult(request.review_id, result);
    return result;
  }

  // ─── 状态持久化 ────────────────────────────────────────

  async _loadState() {
    try {
      const raw = await readFile(this._statePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { pending: {}, history: [] };
    }
  }

  async _saveState(state) {
    await mkdir(this.workdir, { recursive: true });
    await writeFile(this._statePath, JSON.stringify(state, null, 2));
  }

  async _savePendingReview(request) {
    const state = await this._loadState();
    if (!state.pending) state.pending = {};
    state.pending[request.review_id] = {
      request,
      status: 'pending',
      created_at: request.created_at,
    };
    await this._saveState(state);
  }

  async _saveResult(reviewId, result) {
    const state = await this._loadState();
    if (state.pending?.[reviewId]) {
      state.pending[reviewId].status = 'responded';
      state.pending[reviewId].result = result;
    }
    if (!state.history) state.history = [];
    state.history.push(result);
    await this._saveState(state);
  }
}

// ─── CLI 入口 ────────────────────────────────────────────

// Usage:
//   node lib/interactive-review.js list <workdir>
//   node lib/interactive-review.js respond <workdir> <review_id> --approve [--feedback "xxx"]
//   node lib/interactive-review.js respond <workdir> <review_id> --redo
//   node lib/interactive-review.js respond <workdir> <review_id> --modify --feedback "具体意见"
//   node lib/interactive-review.js respond <workdir> <review_id> --select A|B
//   node lib/interactive-review.js history <workdir>

async function cli() {
  const [,, command, workdir, reviewId] = process.argv;

  if (!command || !workdir) {
    console.log('Usage:');
    console.log('  node interactive-review.js list <workdir>');
    console.log('  node interactive-review.js respond <workdir> <review_id> --approve [--feedback "xxx"]');
    console.log('  node interactive-review.js respond <workdir> <review_id> --redo');
    console.log('  node interactive-review.js respond <workdir> <review_id> --modify --feedback "意见"');
    console.log('  node interactive-review.js respond <workdir> <review_id> --select A|B');
    console.log('  node interactive-review.js history <workdir>');
    process.exit(1);
  }

  const reviewer = new InteractiveReviewer({ workdir, mode: 'file' });

  switch (command) {
    case 'list': {
      const pending = await reviewer.listPending();
      if (pending.length === 0) {
        console.log('✅ 没有待审查项');
      } else {
        console.log(`📋 待审查项 (${pending.length}):`);
        for (const item of pending) {
          console.log(`  ${item.review_id} — ${item.title} [${item.level}] (${item.created_at})`);
        }
      }
      break;
    }

    case 'respond': {
      if (!reviewId) {
        console.error('❌ 缺少 review_id');
        process.exit(1);
      }

      const args = process.argv.slice(5);
      let decision = null;
      let feedback = null;
      let selectedVariant = null;

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--approve') decision = DECISIONS.APPROVED;
        else if (args[i] === '--redo') decision = DECISIONS.REDO;
        else if (args[i] === '--modify') decision = DECISIONS.MODIFIED;
        else if (args[i] === '--skip') decision = DECISIONS.SKIPPED;
        else if (args[i] === '--select') {
          selectedVariant = args[++i]?.toUpperCase();
          decision = selectedVariant === 'A' ? DECISIONS.SELECT_A : DECISIONS.SELECT_B;
        }
        else if (args[i] === '--feedback') feedback = args[++i];
      }

      if (!decision) {
        console.error('❌ 缺少操作选项: --approve / --redo / --modify / --skip / --select A|B');
        process.exit(1);
      }

      await reviewer.respond(reviewId, { decision, feedback, selected_variant: selectedVariant });
      console.log(`✅ 已回复: ${decision}${feedback ? ` (${feedback})` : ''}`);
      break;
    }

    case 'history': {
      const history = await reviewer.getHistory();
      if (history.length === 0) {
        console.log('📭 暂无审查历史');
      } else {
        console.log(`📜 审查历史 (${history.length}):`);
        for (const item of history) {
          const autoTag = item.auto_approved ? ' [自动]' : '';
          console.log(`  ${item.review_id} → ${item.decision}${autoTag} (${item.responded_at})`);
          if (item.feedback) {
            console.log(`    💬 ${item.feedback}`);
          }
        }
      }
      break;
    }

    default:
      console.error(`❌ 未知命令: ${command}`);
      process.exit(1);
  }
}

// Run CLI if executed directly
const isMainModule = process.argv[1] && (
  import.meta.url.endsWith(basename(process.argv[1])) ||
  import.meta.url.includes('interactive-review')
);
if (isMainModule) {
  cli().catch(err => {
    console.error('❌', err.message);
    process.exit(1);
  });
}

export default InteractiveReviewer;
