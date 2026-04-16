/**
 * kais-pipeline — 管线编排器（纯编排，<200 行）
 * 业务逻辑在 lib/phases/ 和 lib/hooks/ 中
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { GitStageManager } from './git-stage-manager.js';
import { phaseHandlers } from './phases/index.js';

// ─── Phase 定义 ──────────────────────────────────────────

const PHASES = [
  { id: 'requirement', name: '需求确认', stage: 'requirement', stageOrder: 1,
    outputFiles: ['requirement.json', 'brief.md', 'blueprint.json'], review: false },
  { id: 'art-direction', name: '美术方向', stage: 'art-direction', stageOrder: 2,
    outputFiles: ['art_direction.json', 'mood_board.png', 'color_palette.json'],
    review: { title: '美术风格选择（3选1）', selectMode: 'single', maxSelect: 1, enableScoring: true, enableFeedback: true, minCandidates: 3, maxCandidates: 3 } },
  { id: 'character', name: '角色设计', stage: 'character', stageOrder: 3,
    outputFiles: ['characters.json', 'assets/characters/'],
    review: { title: '角色设计审核', selectMode: 'multi', enableScoring: true, enableFeedback: true } },
  { id: 'scenario', name: '剧本编写', stage: 'scenario', stageOrder: 4,
    outputFiles: ['scenario.json', 'story_bible.json'], review: false },
  { id: 'voice', name: '配音', stage: 'voice', stageOrder: 4.5,
    outputFiles: ['voice_assignments.json', 'assets/tts/'],
    review: { title: '音色试听选择', selectMode: 'single', enableScoring: false, enableFeedback: true } },
  { id: 'scene', name: '场景图生成', stage: 'scene', stageOrder: 5,
    outputFiles: ['scene_design.json', 'assets/scenes/'],
    review: { title: '场景图审核', selectMode: 'multi', enableScoring: true, enableFeedback: true } },
  { id: 'storyboard', name: '分镜板', stage: 'storyboard', stageOrder: 6,
    outputFiles: ['storyboard.json', 'shots.json'],
    review: { title: '分镜板审核', selectMode: 'multi', enableScoring: true, enableFeedback: true } },
  { id: 'camera', name: '视频生成', stage: 'camera', stageOrder: 7,
    outputFiles: ['video_tasks.json', 'output/'],
    review: { title: '视频片段审核', selectMode: 'multi', enableScoring: true, enableFeedback: true } },
  { id: 'post-production', name: '后期合成', stage: 'delivery', stageOrder: 8,
    outputFiles: ['final.mp4', 'qc_report.json'], review: false },
  { id: 'quality-gate', name: '质量门控', stage: 'quality-gate', stageOrder: 8.5,
    outputFiles: ['quality_report.json'], review: false, autoEvaluate: true },
];

// ─── 需求模板 ────────────────────────────────────────────

const REQUIREMENT_SCHEMA = {
  title: '', genre: '', duration_sec: 60, theme: '', characters: [],
  style_preference: '',
  audio_preference: { tts: '', bgm: '', sfx: '' },
  output_format: { ratio: '9:16', resolution: '2k' },
};

export function createRequirementTemplate(overrides = {}) {
  return {
    ...REQUIREMENT_SCHEMA, ...overrides,
    characters: overrides.characters || [],
    audio_preference: { ...REQUIREMENT_SCHEMA.audio_preference, ...overrides.audio_preference },
    output_format: { ...REQUIREMENT_SCHEMA.output_format, ...overrides.output_format },
  };
}

export function validateRequirement(req) {
  const errors = [];
  if (!req.title) errors.push('title 不能为空');
  if (!req.genre) errors.push('genre 不能为空');
  if (!req.duration_sec || req.duration_sec < 5) errors.push('duration_sec 至少 5 秒');
  if (!req.characters?.length) errors.push('characters 至少一个角色');
  for (const c of req.characters || []) if (!c.name) errors.push('角色缺少 name');
  return { valid: !errors.length, errors };
}

// ─── Pipeline 类 ─────────────────────────────────────────

export class Pipeline {
  constructor(config = {}) {
    this.workdir = config.workdir || process.cwd();
    this.episode = config.episode || 'EP01';
    this.config = config.config || {};
    this.onPhaseComplete = config.onPhaseComplete || null;
    this.onPhaseFail = config.onPhaseFail || null;
    this.onProgress = config.onProgress || null;
    this.onReviewReady = config.onReviewReady || null;
    this.blueprint = null;
    this.characterDNA = new Map();
    this.sceneDNA = new Map();
    this._state = null;
    this._git = new GitStageManager(this.workdir);
  }

  async _loadState() {
    try {
      return JSON.parse(await readFile(join(this.workdir, '.pipeline-state.json'), 'utf-8'));
    } catch {
      return { episode: this.episode, phases: {}, currentPhaseId: null, startedAt: null, completedAt: null };
    }
  }

  async _saveState(state) {
    await writeFile(join(this.workdir, '.pipeline-state.json'), JSON.stringify(state, null, 2));
    this._state = state;
  }

  async _runReview(phase, phaseConfig = {}) {
    const { createReviewSession, addReviewItems, generateReviewPage } = await import('./interactive-review.js');
    const { createServer } = await import('node:http');
    const { readFile } = await import('node:fs/promises');

    const reviewConfig = phase.review;
    const candidates = phaseConfig.reviewCandidates || reviewConfig.buildCandidates?.(this.workdir) || [];
    if (!candidates.length) return { action: 'approved', selected: [], rejected: [], scores: {}, feedback: {}, skipped: true };

    const session = createReviewSession({
      phase: `Phase ${phase.stageOrder} · ${phase.name}`,
      title: reviewConfig.title || `${phase.name}审核`,
      selectMode: reviewConfig.selectMode || 'single',
      minSelect: reviewConfig.minSelect || 1, maxSelect: reviewConfig.maxSelect || 1,
      enableScoring: reviewConfig.enableScoring !== false,
      enableFeedback: reviewConfig.enableFeedback !== false,
      timeoutSeconds: Infinity,
    });
    addReviewItems(session, candidates);

    const htmlPath = await generateReviewPage(session, { outputDir: join(this.workdir, '.review') });
    const PORT = phaseConfig.reviewPort || 8765;

    return new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        if (req.url === '/' || req.url === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(await readFile(htmlPath, 'utf-8'));
        } else if (req.url === '/submit' && req.method === 'POST') {
          let body = '';
          req.on('data', c => body += c);
          req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); server.close(); resolve(JSON.parse(body)); });
        } else { res.writeHead(404); res.end('Not found'); }
      });
      server.on('error', err => {
        if (err.code === 'EADDRINUSE') {
          server.listen(0, '0.0.0.0', () => { this.onReviewReady?.(phase, `http://0.0.0.0:${server.address().port}`); });
        } else reject(err);
      });
      server.listen(PORT, '0.0.0.0', () => { this.onReviewReady?.(phase, `http://localhost:${server.address().port}`); });
    });
  }

  async runPhase(phaseId, phaseConfig = {}) {
    const phase = PHASES.find(p => p.id === phaseId);
    if (!phase) throw new Error(`未知阶段: ${phaseId}`);

    const state = await this._loadState();
    this.onProgress?.(phaseId, phase.name, 'running');

    try {
      const handler = phaseHandlers[phaseId];
      if (handler?.before) await handler.before(this, phase);

      let result;
      if (phaseConfig.execute) {
        result = await phaseConfig.execute(this, phase);
      } else if (handler?.after) {
        await mkdir(this.workdir, { recursive: true });
        result = await handler.after(this, phase, phaseConfig);
      } else {
        if (phaseConfig.data) {
          await mkdir(this.workdir, { recursive: true });
          await writeFile(join(this.workdir, phaseConfig.outputFile || `${phase.id}.json`), JSON.stringify(phaseConfig.data, null, 2));
        }
        result = { summary: phaseConfig.data || {}, metrics: phaseConfig.metrics || {} };
      }

      state.phases[phaseId] = { status: 'completed', completedAt: new Date().toISOString(), result: result.summary || {} };
      state.currentPhaseId = phaseId;
      await this._saveState(state);

      if (phase.review) {
        this.onProgress?.(phaseId, phase.name, 'reviewing');
        const reviewResult = await this._runReview(phase, phaseConfig);
        result.review = reviewResult;
        if (reviewResult.action === 'rejected') {
          const err = new Error(`审核未通过: ${phase.name}`);
          err.code = 'REVIEW_REJECTED'; err.reviewResult = reviewResult;
          throw err;
        }
      }

      await this._git.init();
      await this._git.checkpoint(phase.stage, { description: phase.name, metrics: result.metrics || {} });
      this.onPhaseComplete?.(phase, result);
      this.onProgress?.(phaseId, phase.name, 'completed');
      return result;
    } catch (error) {
      state.phases[phaseId] = { status: 'failed', failedAt: new Date().toISOString(), error: error.message };
      await this._saveState(state);
      this.onPhaseFail?.(phase, error);
      this.onProgress?.(phaseId, phase.name, 'failed');
      throw error;
    }
  }

  async run(phasesConfig = {}) {
    const state = await this._loadState();
    state.startedAt = new Date().toISOString();
    await this._saveState(state);
    const results = {};
    for (const phase of PHASES) {
      try { results[phase.id] = await this.runPhase(phase.id, phasesConfig[phase.id] || {}); }
      catch (error) { results[phase.id] = { error: error.message }; break; }
    }
    state.completedAt = new Date().toISOString();
    await this._saveState(state);
    return { episode: this.episode, phases: results, success: Object.values(results).every(r => !r.error) };
  }

  async resume(fromPhaseId, phasesConfig = {}) {
    const startIdx = PHASES.findIndex(p => p.id === fromPhaseId);
    if (startIdx === -1) throw new Error(`未知阶段: ${fromPhaseId}`);
    const state = await this._loadState();
    state.startedAt = state.startedAt || new Date().toISOString();
    await this._saveState(state);
    const results = {};
    for (let i = startIdx; i < PHASES.length; i++) {
      const phase = PHASES[i];
      try { results[phase.id] = await this.runPhase(phase.id, phasesConfig[phase.id] || {}); }
      catch (error) { results[phase.id] = { error: error.message }; break; }
    }
    state.completedAt = new Date().toISOString();
    await this._saveState(state);
    return { episode: this.episode, resumedFrom: fromPhaseId, phases: results, success: Object.values(results).every(r => !r.error) };
  }

  async getStatus() {
    const state = await this._loadState();
    return { episode: state.episode, startedAt: state.startedAt, completedAt: state.completedAt,
      phases: PHASES.map(p => ({ id: p.id, name: p.name, order: p.stageOrder, status: state.phases[p.id]?.status || 'pending' })) };
  }

  static getPhases() { return PHASES; }
}

export default Pipeline;
