/**
 * Phase 15 PERF-01 / PERF-02: cloud-production handler 实化测试
 *
 * 覆盖:
 *   1. 幂等: 已完成 shot 被跳过,不重复提交
 *   2. 并行调度: 多 shot 使用 ShotParallelScheduler
 *   3. 降级: gold-team ping 失败 → 写 stub,不 fatal
 *
 * 测试用 monkey-patch 的方式 mock GoldTeamClient (无需 HTTP server)
 *
 * Run: node --test test/phases/cloud-production.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Pipeline, createRequirementTemplate } from '../../lib/pipeline.js';
import { phaseHandlers } from '../../lib/phases/index.js';
import { AssetBus } from '../../lib/asset-bus.js';

// 创建一个临时目录 + 配好 spatio-temporal-script 的 pipeline
async function setupPipeline({ shots = [], previousVideoTasks = null } = {}) {
  const tmpDir = await mkdtemp(join(tmpdir(), 'p15-cloud-'));
  const pipeline = new Pipeline({
    workdir: tmpDir,
    config: createRequirementTemplate({
      title: 'Phase15 测试',
      genre: '科幻',
      characters: [{ name: '主角', description: '测试角色' }],
    }),
    episode: 'P15-EP01',
  });

  const bus = new AssetBus(tmpDir);
  if (shots.length > 0) {
    await bus.write('spatio-temporal-script', { shots, audio_events: [] });
  }

  if (previousVideoTasks) {
    await writeFile(join(tmpDir, 'video_tasks.json'), JSON.stringify(previousVideoTasks, null, 2));
  }

  return { tmpDir, pipeline };
}

describe('Phase 15 cloud-production 实化', () => {

  // ═══════════════════════════════════════════════════════════════
  // 1. gold-team 不可用 → 降级写 stub,不抛 fatal
  // ═══════════════════════════════════════════════════════════════
  it('gold-team ping 失败时降级写 stub,metrics.degraded=true', async () => {
    const { tmpDir, pipeline } = await setupPipeline({
      shots: [{ id: 'shot-001', description: '测试' }],
    });

    // Monkey-patch GoldTeamClient.prototype.ping 强制返回 false
    const { GoldTeamClient } = await import('../../lib/gold-team-client.js');
    const origPing = GoldTeamClient.prototype.ping;
    GoldTeamClient.prototype.ping = async () => false;

    try {
      const phase = Pipeline.getPhases().find(p => p.id === 'cloud-production');
      const handler = phaseHandlers['cloud-production'];
      const result = await handler.after(pipeline, phase, {});

      assert.strictEqual(result.metrics.stubbed, true);
      assert.strictEqual(result.metrics.degraded, true);
      assert.strictEqual(result.metrics.reason, 'gold-team unavailable');

      const raw = await readFile(join(tmpDir, 'video_tasks.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      assert.strictEqual(parsed._stub, true);
      assert.strictEqual(parsed._degraded_reason, 'gold-team unavailable');
      assert.deepEqual(parsed.tasks, []);
    } finally {
      GoldTeamClient.prototype.ping = origPing;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. 无 shots → 降级写 stub
  // ═══════════════════════════════════════════════════════════════
  it('无 shots 时降级写 stub,reason=no shots', async () => {
    const { tmpDir, pipeline } = await setupPipeline({ shots: [] });

    try {
      const phase = Pipeline.getPhases().find(p => p.id === 'cloud-production');
      const handler = phaseHandlers['cloud-production'];
      const result = await handler.after(pipeline, phase, {});

      assert.strictEqual(result.metrics.stubbed, true);
      assert.strictEqual(result.metrics.reason, 'no shots');
      assert.strictEqual(result.metrics.shot_count, 0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. 幂等: 已完成 shot 被跳过
  // ═══════════════════════════════════════════════════════════════
  it('已完成的 shot 在重跑时被跳过 (幂等)', async () => {
    // 先准备 characters 目录 + L1 anchor (assetManager.getOmniReferencePack 依赖)
    const { tmpDir, pipeline } = await setupPipeline({
      shots: [
        { id: 'shot-001', description: '已完成', character: '主角' },
        { id: 'shot-002', description: '新增', character: '主角' },
      ],
      previousVideoTasks: {
        _phase: 'cloud-production',
        tasks: [
          { shot_id: 'shot-001', task_id: 'prev-task-1', status: 'completed', video_path: '/tmp/old.mp4' },
        ],
      },
    });

    // 写 L1 anchor (避免 getOmniReferencePack 抛错)
    const { default: CharacterAssetManager } = await import('../../lib/character-asset-manager.js');
    const assetManager = new CharacterAssetManager(join(tmpDir, 'characters'));
    await assetManager.registerIdentityAnchors('主角', ['/tmp/fake-anchor.png']);

    // Mock GoldTeamClient: ping=true, submitTask 返回 taskId, waitForTask 返回 artifacts
    const { GoldTeamClient } = await import('../../lib/gold-team-client.js');
    const origPing = GoldTeamClient.prototype.ping;
    const origSubmit = GoldTeamClient.prototype.submitTask;
    const origWait = GoldTeamClient.prototype.waitForTask;

    let submitCount = 0;
    const submittedShotIds = [];

    GoldTeamClient.prototype.ping = async () => true;
    GoldTeamClient.prototype.submitTask = async function ({ params }) {
      submitCount++;
      submittedShotIds.push(params.prompt);
      return { taskId: `new-task-${submitCount}`, state: 'queued' };
    };
    GoldTeamClient.prototype.waitForTask = async function (taskId) {
      return {
        state: 'done',
        artifacts: [{ path: `/tmp/output-${taskId}.mp4` }],
      };
    };

    try {
      const phase = Pipeline.getPhases().find(p => p.id === 'cloud-production');
      const handler = phaseHandlers['cloud-production'];
      const result = await handler.after(pipeline, phase, {});

      // 幂等: shot-001 跳过,只提交 shot-002
      assert.strictEqual(submitCount, 1, '应只提交 1 个新 shot (shot-002), shot-001 幂等跳过');
      assert.match(submittedShotIds[0], /新增/);

      // 返回的 metrics
      assert.strictEqual(result.metrics.shot_count, 2);
      assert.strictEqual(result.metrics.completed, 2, '两个 shot 都应标记完成');
      assert.strictEqual(result.metrics.skipped_idempotent, 1, '应跳过 1 个已完成 shot');
      assert.strictEqual(result.metrics.failed, 0);

      // video_tasks.json 包含两个 task (保留之前的 + 新增的)
      const raw = await readFile(join(tmpDir, 'video_tasks.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      assert.strictEqual(parsed.tasks.length, 2);
      assert.deepEqual(
        parsed.tasks.map(t => t.shot_id).sort(),
        ['shot-001', 'shot-002'],
      );
      // 之前的 task_id 应被保留
      assert.ok(parsed.tasks.find(t => t.task_id === 'prev-task-1'));
    } finally {
      GoldTeamClient.prototype.ping = origPing;
      GoldTeamClient.prototype.submitTask = origSubmit;
      GoldTeamClient.prototype.waitForTask = origWait;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. 并行调度 + 错误隔离: 一个 shot 失败,其他继续
  // ═══════════════════════════════════════════════════════════════
  it('多个 shot 并行提交,单个失败被记录到 failed_shots 不阻塞其他', async () => {
    const { tmpDir, pipeline } = await setupPipeline({
      shots: [
        { id: 'shot-A', description: 'A', character: '主角' },
        { id: 'shot-B', description: 'B-fail', character: '主角' },
        { id: 'shot-C', description: 'C', character: '主角' },
      ],
    });

    const { default: CharacterAssetManager } = await import('../../lib/character-asset-manager.js');
    const assetManager = new CharacterAssetManager(join(tmpDir, 'characters'));
    await assetManager.registerIdentityAnchors('主角', ['/tmp/anchor.png']);

    const { GoldTeamClient } = await import('../../lib/gold-team-client.js');
    const origPing = GoldTeamClient.prototype.ping;
    const origSubmit = GoldTeamClient.prototype.submitTask;
    const origWait = GoldTeamClient.prototype.waitForTask;

    GoldTeamClient.prototype.ping = async () => true;
    GoldTeamClient.prototype.submitTask = async function ({ params }) {
      if (params.prompt === 'B-fail') {
        throw new Error('GPU OOM on shot B');
      }
      return { taskId: `task-${params.prompt}`, state: 'queued' };
    };
    GoldTeamClient.prototype.waitForTask = async function (taskId) {
      return { state: 'done', artifacts: [{ path: `/tmp/${taskId}.mp4` }] };
    };

    try {
      const phase = Pipeline.getPhases().find(p => p.id === 'cloud-production');
      const handler = phaseHandlers['cloud-production'];
      const result = await handler.after(pipeline, phase, {});

      assert.strictEqual(result.metrics.shot_count, 3);
      assert.strictEqual(result.metrics.completed, 2, 'shot-A + shot-C 应完成');
      assert.strictEqual(result.metrics.failed, 1, 'shot-B 应失败');
      assert.strictEqual(result.metrics.degraded, true, '有失败应标记 degraded');

      const raw = await readFile(join(tmpDir, 'video_tasks.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      assert.strictEqual(parsed.failed_shots.length, 1);
      assert.strictEqual(parsed.failed_shots[0].shot_id, 'shot-B');
    } finally {
      GoldTeamClient.prototype.ping = origPing;
      GoldTeamClient.prototype.submitTask = origSubmit;
      GoldTeamClient.prototype.waitForTask = origWait;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
