/**
 * kais-pipeline — 管线编排器
 * ES Module
 *
 * 串行执行 Phase 1→8，每个 Phase 完成后自动 checkpoint。
 * 支持断点恢复、单阶段执行、进度回调。
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { GitStageManager } from './git-stage-manager.js';

// ─── Phase 定义 ──────────────────────────────────────────

const PHASES = [
  {
    id: 'requirement',
    name: '需求确认',
    stage: 'requirement',
    stageOrder: 1,
    outputFiles: ['requirement.json', 'brief.md'],
    review: false, // 需求确认是对话式，不需要图片审核
  },
  {
    id: 'art-direction',
    name: '美术方向',
    stage: 'art-direction',
    stageOrder: 2,
    outputFiles: ['art_direction.json', 'mood_board.png', 'color_palette.json'],
    review: {
      title: '美术风格选择（4生2选）',
      selectMode: 'multi',
      minSelect: 2,
      maxSelect: 2,
      enableScoring: true,
      enableFeedback: true,
      minCandidates: 4,
      maxCandidates: 4,
      description: '即梦每次生成4张，请选择最满意的2张作为美术参考',
    },
  },
  {
    id: 'character',
    name: '角色设计',
    stage: 'character',
    stageOrder: 3,
    outputFiles: ['characters.json', 'assets/characters/'],
    review: {
      title: '角色设计审核（4生2选）',
      selectMode: 'multi',
      minSelect: 2,
      maxSelect: 2,
      enableScoring: true,
      enableFeedback: true,
      description: '即梦每次生成4张，请选择最满意的2张作为角色参考',
    },
  },
  {
    id: 'scenario',
    name: '剧本编写',
    stage: 'scenario',
    stageOrder: 4,
    outputFiles: ['scenario.json', 'story_bible.json'],
    review: false, // 剧本是文本，用对话审核更合适
  },
  {
    id: 'voice',
    name: '配音',
    stage: 'voice',
    stageOrder: 4.5,
    outputFiles: ['voice_assignments.json', 'assets/tts/'],
    review: {
      title: '音色试听选择',
      selectMode: 'single',
      enableScoring: false, // 音色选择不需要评分
      enableFeedback: true,
    },
  },
  {
    id: 'scene',
    name: '场景图生成',
    stage: 'scene',
    stageOrder: 5,
    outputFiles: ['scene_design.json', 'assets/scenes/'],
    review: {
      title: '场景图审核（4生2选）',
      selectMode: 'multi',
      minSelect: 2,
      maxSelect: 2,
      enableScoring: true,
      enableFeedback: true,
      description: '即梦每次生成4张，请选择最满意的2张作为场景参考',
    },
  },
  {
    id: 'storyboard',
    name: '分镜板',
    stage: 'storyboard',
    stageOrder: 6,
    outputFiles: ['storyboard.json', 'shots.json'],
    review: {
      title: '分镜板审核',
      selectMode: 'multi', // 每个镜头可单独确认
      enableScoring: true,
      enableFeedback: true,
    },
  },
  {
    id: 'camera',
    name: '视频生成',
    stage: 'camera',
    stageOrder: 7,
    outputFiles: ['video_tasks.json', 'output/'],
    review: {
      title: '视频片段审核',
      selectMode: 'multi',
      enableScoring: true,
      enableFeedback: true,
    },
  },
  {
    id: 'post-production',
    name: '后期合成',
    stage: 'delivery',
    stageOrder: 8,
    outputFiles: ['final.mp4', 'qc_report.json'],
    review: false, // 最终成品，用对话确认
  },
];

// ─── Phase 1: 需求确认模板 ───────────────────────────────

const REQUIREMENT_SCHEMA = {
  title: '',
  genre: '',
  duration_sec: 60,
  theme: '',
  characters: [],
  style_preference: '',
  audio_preference: { tts: '', bgm: '', sfx: '' },
  output_format: { ratio: '9:16', resolution: '2k' },
};

/**
 * 生成需求确认模板
 * @param {object} overrides - 用户提供的初始值
 * @returns {object} 需求配置对象
 */
export function createRequirementTemplate(overrides = {}) {
  return {
    ...REQUIREMENT_SCHEMA,
    ...overrides,
    characters: overrides.characters || [],
    audio_preference: { ...REQUIREMENT_SCHEMA.audio_preference, ...overrides.audio_preference },
    output_format: { ...REQUIREMENT_SCHEMA.output_format, ...overrides.output_format },
  };
}

/**
 * 验证需求配置完整性
 * @param {object} req
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRequirement(req) {
  const errors = [];
  if (!req.title) errors.push('title 不能为空');
  if (!req.genre) errors.push('genre 不能为空');
  if (!req.duration_sec || req.duration_sec < 5) errors.push('duration_sec 至少 5 秒');
  if (!req.characters || req.characters.length === 0) errors.push('characters 至少一个角色');
  for (const char of req.characters || []) {
    if (!char.name) errors.push('角色缺少 name');
  }
  return { valid: errors.length === 0, errors };
}

// ─── Pipeline 类 ─────────────────────────────────────────

export class Pipeline {
  /**
   * @param {object} config
   * @param {string} config.workdir - 项目工作目录
   * @param {string} config.episode - 集号（如 EP01）
   * @param {object} [config.config] - 需求配置
   * @param {Function} [config.onPhaseComplete] - 阶段完成回调 (phase, result)
   * @param {Function} [config.onPhaseFail] - 阶段失败回调 (phase, error)
   * @param {Function} [config.onProgress] - 进度回调 (phaseId, phaseName, status)
   */
  constructor(config = {}) {
    this.workdir = config.workdir || process.cwd();
    this.episode = config.episode || 'EP01';
    this.config = config.config || {};
    this.onPhaseComplete = config.onPhaseComplete || null;
    this.onPhaseFail = config.onPhaseFail || null;
    this.onProgress = config.onProgress || null;
    this.onReviewReady = config.onReviewReady || null; // 审核页就绪回调 (phase, url)

    this._state = null;
    this._git = new GitStageManager(this.workdir);
  }

  // ─── 状态管理 ──────────────────────────────────────────

  async _loadState() {
    const statePath = join(this.workdir, '.pipeline-state.json');
    try {
      const raw = await readFile(statePath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {
        episode: this.episode,
        phases: {},
        currentPhaseId: null,
        startedAt: null,
        completedAt: null,
      };
    }
  }

  async _saveState(state) {
    const statePath = join(this.workdir, '.pipeline-state.json');
    await writeFile(statePath, JSON.stringify(state, null, 2));
    this._state = state;
  }

  /**
   * 执行审核流程
   * 启动 HTTP 服务器，生成审查页，等待用户提交结果
   * @param {object} phase - 阶段定义
   * @param {object} phaseConfig - 阶段配置
   * @returns {Promise<object>} 审核结果 { action, selected, rejected, scores, feedback }
   */
  async _runReview(phase, phaseConfig = {}) {
    const { createReviewSession, addReviewItems, generateReviewPage } = await import('./interactive-review.js');
    const { createServer } = await import('node:http');
    const { readFile } = await import('node:fs/promises');

    const reviewConfig = phase.review;
    const candidates = phaseConfig.reviewCandidates || reviewConfig.buildCandidates?.(this.workdir) || [];

    if (!candidates.length) {
      // 没有候选方案，跳过审核
      return { action: 'approved', selected: [], rejected: [], scores: {}, feedback: {}, skipped: true };
    }

    const session = createReviewSession({
      phase: `Phase ${phase.stageOrder} · ${phase.name}`,
      title: reviewConfig.title || `${phase.name}审核`,
      description: reviewConfig.description || `请审核 ${phase.name} 的产出`,
      selectMode: reviewConfig.selectMode || 'single',
      minSelect: reviewConfig.minSelect || 1,
      maxSelect: reviewConfig.maxSelect || 1,
      enableScoring: reviewConfig.enableScoring !== false,
      enableFeedback: reviewConfig.enableFeedback !== false,
      timeoutSeconds: reviewConfig.timeoutSeconds || 7200,
    });
    addReviewItems(session, candidates);

    const outputDir = join(this.workdir, '.review');
    const htmlPath = await generateReviewPage(session, { outputDir });

    // 启动 HTTP 服务器等待用户审核
    const PORT = phaseConfig.reviewPort || 8765;
    const result = await new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        if (req.url === '/' || req.url === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(await readFile(htmlPath, 'utf-8'));
        } else if (req.url === '/submit' && req.method === 'POST') {
          let body = '';
          req.on('data', c => body += c);
          req.on('end', () => {
            const data = JSON.parse(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
            server.close();
            resolve(data);
          });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          // 端口被占用，尝试下一个
          server.listen(0, '0.0.0.0', () => {
            const actualPort = server.address().port;
            this.onProgress?.(phase.id, phase.name, 'review-waiting');
            if (this.onReviewReady) {
              this.onReviewReady(phase, `http://0.0.0.0:${actualPort}`);
            }
          });
        } else {
          reject(err);
        }
      });

      server.listen(PORT, '0.0.0.0', () => {
        const addr = server.address();
        this.onProgress?.(phase.id, phase.name, 'review-waiting');
        // 通知调用方审核页地址
        if (this.onReviewReady) {
          this.onReviewReady(phase, `http://localhost:${addr.port}`);
        }
      });
    });

    return result;
  }

  // ─── Phase 执行 ────────────────────────────────────────

  /**
   * 执行单个阶段
   * @param {string} phaseId - 阶段 ID
   * @param {object} phaseConfig - 阶段配置（传递给具体执行函数）
   * @returns {Promise<object>} 阶段执行结果
   */
  async runPhase(phaseId, phaseConfig = {}) {
    const phase = PHASES.find(p => p.id === phaseId);
    if (!phase) throw new Error(`未知阶段: ${phaseId}`);

    const state = await this._loadState();
    this.onProgress?.(phaseId, phase.name, 'running');

    try {
      // 执行阶段（具体逻辑由 phaseConfig 中的 execute 回调或内部逻辑处理）
      let result;
      if (phaseConfig.execute) {
        result = await phaseConfig.execute(this, phase);
      } else {
        result = await this._executeDefaultPhase(phase, phaseConfig);
      }

      // 更新状态
      state.phases[phaseId] = {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result: result.summary || {},
      };
      state.currentPhaseId = phaseId;
      await this._saveState(state);

      // 审核环节（如果配置了 review）
      if (phase.review) {
        this.onProgress?.(phaseId, phase.name, 'reviewing');
        const reviewResult = await this._runReview(phase, phaseConfig);
        result.review = reviewResult;

        // 如果用户拒绝全部（action=rejected），抛错让上层处理
        if (reviewResult.action === 'rejected') {
          const err = new Error(`审核未通过: ${phase.name} — 全部方案被拒选`);
          err.code = 'REVIEW_REJECTED';
          err.reviewResult = reviewResult;
          throw err;
        }
      }
      await this._git.init();
      await this._git.checkpoint(phase.stage, {
        description: phase.name,
        metrics: result.metrics || {},
      });

      this.onPhaseComplete?.(phase, result);
      this.onProgress?.(phaseId, phase.name, 'completed');
      return result;

    } catch (error) {
      state.phases[phaseId] = {
        status: 'failed',
        failedAt: new Date().toISOString(),
        error: error.message,
      };
      await this._saveState(state);

      this.onPhaseFail?.(phase, error);
      this.onProgress?.(phaseId, phase.name, 'failed');
      throw error;
    }
  }

  /**
   * 默认阶段执行：写 requirement.json / 保存数据
   */
  async _executeDefaultPhase(phase, phaseConfig) {
    await mkdir(this.workdir, { recursive: true });

    // Phase 1: 需求确认
    if (phase.id === 'requirement') {
      const req = createRequirementTemplate(this.config);
      const { valid, errors } = validateRequirement(req);
      if (!valid) {
        throw new Error(`需求验证失败: ${errors.join('; ')}`);
      }
      await writeFile(
        join(this.workdir, 'requirement.json'),
        JSON.stringify(req, null, 2),
      );
      return { summary: { title: req.title, genre: req.genre }, metrics: { characterCount: req.characters.length } };
    }

    // 其他阶段：如果 phaseConfig 有 data，写入 JSON
    if (phaseConfig.data) {
      const outputFile = phaseConfig.outputFile || `${phase.id}.json`;
      await writeFile(
        join(this.workdir, outputFile),
        JSON.stringify(phaseConfig.data, null, 2),
      );
    }

    return { summary: phaseConfig.data || {}, metrics: phaseConfig.metrics || {} };
  }

  /**
   * 执行全部阶段
   * @param {object} phasesConfig - 每个阶段的配置 { phaseId: config }
   * @returns {Promise<object>} 执行结果
   */
  async run(phasesConfig = {}) {
    const state = await this._loadState();
    state.startedAt = new Date().toISOString();
    await this._saveState(state);

    const results = {};
    for (const phase of PHASES) {
      const phaseConfig = phasesConfig[phase.id] || {};
      try {
        results[phase.id] = await this.runPhase(phase.id, phaseConfig);
      } catch (error) {
        results[phase.id] = { error: error.message };
        break;  // 阶段失败则停止
      }
    }

    state.completedAt = new Date().toISOString();
    await this._saveState(state);

    return {
      episode: this.episode,
      phases: results,
      success: Object.values(results).every(r => !r.error),
    };
  }

  /**
   * 从断点恢复执行
   * @param {string} fromPhaseId - 从哪个阶段开始恢复
   * @param {object} phasesConfig - 阶段配置
   * @returns {Promise<object>} 执行结果
   */
  async resume(fromPhaseId, phasesConfig = {}) {
    const startIdx = PHASES.findIndex(p => p.id === fromPhaseId);
    if (startIdx === -1) throw new Error(`未知阶段: ${fromPhaseId}`);

    const state = await this._loadState();
    state.startedAt = state.startedAt || new Date().toISOString();
    await this._saveState(state);

    const results = {};
    for (let i = startIdx; i < PHASES.length; i++) {
      const phase = PHASES[i];
      const phaseConfig = phasesConfig[phase.id] || {};
      try {
        results[phase.id] = await this.runPhase(phase.id, phaseConfig);
      } catch (error) {
        results[phase.id] = { error: error.message };
        break;
      }
    }

    state.completedAt = new Date().toISOString();
    await this._saveState(state);

    return {
      episode: this.episode,
      resumedFrom: fromPhaseId,
      phases: results,
      success: Object.values(results).every(r => !r.error),
    };
  }

  /**
   * 获取当前管线状态
   */
  async getStatus() {
    const state = await this._loadState();
    return {
      episode: state.episode,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      phases: PHASES.map(p => ({
        id: p.id,
        name: p.name,
        order: p.stageOrder,
        status: state.phases[p.id]?.status || 'pending',
      })),
    };
  }

  /**
   * 获取阶段列表
   */
  static getPhases() {
    return PHASES;
  }
}

export default Pipeline;
