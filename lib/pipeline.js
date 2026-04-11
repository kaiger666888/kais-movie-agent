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
  },
  {
    id: 'art-direction',
    name: '美术方向',
    stage: 'art-direction',
    stageOrder: 2,
    outputFiles: ['art_direction.json', 'mood_board.png', 'color_palette.json'],
  },
  {
    id: 'character',
    name: '角色设计',
    stage: 'character',
    stageOrder: 3,
    outputFiles: ['characters.json', 'assets/characters/'],
  },
  {
    id: 'scenario',
    name: '剧本编写',
    stage: 'scenario',
    stageOrder: 4,
    outputFiles: ['scenario.json', 'story_bible.json'],
  },
  {
    id: 'voice',
    name: '配音',
    stage: 'voice',
    stageOrder: 4.5,
    outputFiles: ['voice_assignments.json', 'assets/tts/'],
  },
  {
    id: 'scene',
    name: '场景图生成',
    stage: 'scene',
    stageOrder: 5,
    outputFiles: ['scene_design.json', 'assets/scenes/'],
  },
  {
    id: 'storyboard',
    name: '分镜板',
    stage: 'storyboard',
    stageOrder: 6,
    outputFiles: ['storyboard.json', 'shots.json'],
  },
  {
    id: 'camera',
    name: '视频生成',
    stage: 'camera',
    stageOrder: 7,
    outputFiles: ['video_tasks.json', 'output/'],
  },
  {
    id: 'post-production',
    name: '后期合成',
    stage: 'delivery',
    stageOrder: 8,
    outputFiles: ['final.mp4', 'qc_report.json'],
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

      // Git checkpoint
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
