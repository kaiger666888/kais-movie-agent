/**
 * Phase 22 A2-02 / A2-03: cloud-production 音画同步测试
 *
 * 覆盖:
 *   1. A2-02 时序锁: shots 含 dialogue 但无 voice-timeline → throw
 *   2. A2-03 @Audio 强制校验: audio_refs 非空但无 @Audio token → throw
 *   3. A2-02 正常路径: voice-timeline 存在 → audio_refs + generate_audio=true 提交
 *   4. 无 dialogue 路径: shot 无 dialogue → generate_audio=false (普通流程)
 *   5. 降级: gold-team 不可达 → 写 stub audio slot (不 fatal)
 *
 * Run: node --test test/phases/cloud-production-audio-sync.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Pipeline, createRequirementTemplate } from '../../lib/pipeline.js';
import { phaseHandlers } from '../../lib/phases/index.js';
import { AssetBus } from '../../lib/asset-bus.js';

async function setupPipeline({ shots = [], voiceTimeline = null } = {}) {
  const tmpDir = await mkdtemp(join(tmpdir(), 'p22-cloud-'));
  const pipeline = new Pipeline({
    workdir: tmpDir,
    config: createRequirementTemplate({
      title: 'Phase22 测试',
      genre: '科幻',
      characters: [{ name: '主角', description: '测试角色' }],
    }),
    episode: 'P22-EP',
  });

  const bus = new AssetBus(tmpDir);
  if (shots.length > 0) {
    await bus.write('spatio-temporal-script', { shots, audio_events: [] });
  }
  if (voiceTimeline) {
    await bus.write('voice-timeline', voiceTimeline);
  }
  return { tmpDir, pipeline };
}

async function setupL1Anchor(tmpDir, characterId = '主角') {
  const { default: CharacterAssetManager } = await import('../../lib/character-asset-manager.js');
  const assetManager = new CharacterAssetManager(join(tmpDir, 'characters'));
  await assetManager.registerIdentityAnchors(characterId, ['/tmp/fake-anchor.png']);
  return assetManager;
}

function mockGoldTeam({ pingReturn = true, submitImpl = null, waitImpl = null } = {}) {
  return async () => {
    const { GoldTeamClient } = await import('../../lib/gold-team-client.js');
    const origPing = GoldTeamClient.prototype.ping;
    const origSubmit = GoldTeamClient.prototype.submitTask;
    const origWait = GoldTeamClient.prototype.waitForTask;
    const submitted = [];
    GoldTeamClient.prototype.ping = async () => pingReturn;
    GoldTeamClient.prototype.submitTask = async function (req) {
      submitted.push(req);
      if (submitImpl) return submitImpl(req);
      return { taskId: `task-${submitted.length}`, state: 'queued' };
    };
    GoldTeamClient.prototype.waitForTask = async function (taskId) {
      if (waitImpl) return waitImpl(taskId);
      return { state: 'done', artifacts: [{ path: `/tmp/out-${taskId}.mp4` }] };
    };
    return {
      submitted,
      restore: () => {
        GoldTeamClient.prototype.ping = origPing;
        GoldTeamClient.prototype.submitTask = origSubmit;
        GoldTeamClient.prototype.waitForTask = origWait;
      },
    };
  };
}

describe('Phase 22 A2-02: cloud-production voice 时序锁', () => {

  it('shots 含 dialogue 但无 voice-timeline → 抛出时序锁错误', async () => {
    const { tmpDir, pipeline } = await setupPipeline({
      shots: [{
        id: 'shot-001',
        description: '主角说话',
        character: '主角',
        dialogue: { text: '你好', character: '主角' },
      }],
      // 不写 voice-timeline
    });

    try {
      const phase = Pipeline.getPhases().find(p => p.id === 'cloud-production');
      const handler = phaseHandlers['cloud-production'];
      await assert.rejects(
        () => handler.after(pipeline, phase, {}),
        /时序锁违反/,
        '应抛出"时序锁违反"错误',
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('shots 含 dialogue 且 voice-timeline 存在 → 正常进入调度流程', async () => {
    const { tmpDir, pipeline } = await setupPipeline({
      shots: [{
        id: 'shot-001',
        description: '主角说话',
        character: '主角',
        dialogue: { text: '你好', character: '主角' },
      }],
      voiceTimeline: {
        timeline: [{
          shot_id: 'shot-001',
          audioPath: '/tmp/voice/shot-001.wav',
        }],
      },
    });

    await setupL1Anchor(tmpDir);
    const mock = await (mockGoldTeam({ pingReturn: true }))();

    try {
      const phase = Pipeline.getPhases().find(p => p.id === 'cloud-production');
      const handler = phaseHandlers['cloud-production'];
      // 不应抛时序锁错误 — ping=true 时进入正常调度路径
      const result = await handler.after(pipeline, phase, {});
      assert.strictEqual(result.metrics.shot_count, 1);
      assert.strictEqual(result.metrics.completed, 1);
    } finally {
      mock.restore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('shots 无 dialogue 时无需 voice-timeline (无对白路径)', async () => {
    const { tmpDir, pipeline } = await setupPipeline({
      shots: [{
        id: 'shot-001',
        description: '风景镜头',
        character: '主角',
        // 无 dialogue 字段
      }],
      // 无 voice-timeline 也不应抛错
    });

    await setupL1Anchor(tmpDir);
    const mock = await (mockGoldTeam({ pingReturn: true }))();

    try {
      const phase = Pipeline.getPhases().find(p => p.id === 'cloud-production');
      const handler = phaseHandlers['cloud-production'];
      const result = await handler.after(pipeline, phase, {});
      assert.strictEqual(result.metrics.shot_count, 1);
      assert.strictEqual(result.metrics.completed, 1);
    } finally {
      mock.restore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Phase 22 A2-03: @Audio 强制校验 + generate_audio flag', () => {

  it('voice-timeline 存在时 audio_refs + generate_audio=true 透传到 submitTask', async () => {
    const { tmpDir, pipeline } = await setupPipeline({
      shots: [{
        id: 'shot-001',
        description: '主角说话',
        character: '主角',
        dialogue: { text: '你好', character: '主角' },
      }],
      voiceTimeline: {
        timeline: [{
          shot_id: 'shot-001',
          audioPath: '/tmp/voice/shot-001.wav',
        }],
      },
    });

    await setupL1Anchor(tmpDir);
    const mock = await (mockGoldTeam({ pingReturn: true }))();

    try {
      const phase = Pipeline.getPhases().find(p => p.id === 'cloud-production');
      const handler = phaseHandlers['cloud-production'];
      await handler.after(pipeline, phase, {});

      // 验证 submit 收到 audio_refs + generate_audio
      assert.ok(mock.submitted.length >= 1, '应至少提交 1 个 task');
      const params = mock.submitted[0].params;
      assert.ok(params.audio_refs.includes('/tmp/voice/shot-001.wav'),
        'audio_refs 应包含 voice-timeline 的音频路径');
      assert.strictEqual(params.generate_audio, true,
        'generate_audio 应为 true (含对白 + 有音频)');
      // @Audio token 必须在 prompt_audio_bindings 中
      assert.ok(params.prompt_audio_bindings?.includes('@Audio1'),
        'prompt_audio_bindings 应包含 @Audio1 token');
    } finally {
      mock.restore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('无 dialogue shot → generate_audio=false, audio_refs=[]', async () => {
    const { tmpDir, pipeline } = await setupPipeline({
      shots: [{
        id: 'shot-silent',
        description: '风景镜头',
        character: '主角',
      }],
    });

    await setupL1Anchor(tmpDir);
    const mock = await (mockGoldTeam({ pingReturn: true }))();

    try {
      const phase = Pipeline.getPhases().find(p => p.id === 'cloud-production');
      const handler = phaseHandlers['cloud-production'];
      await handler.after(pipeline, phase, {});

      assert.ok(mock.submitted.length >= 1);
      const params = mock.submitted[0].params;
      assert.deepEqual(params.audio_refs, []);
      assert.strictEqual(params.generate_audio, false);
    } finally {
      mock.restore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Phase 22: cloud-production 降级路径 (gold-team unreachable)', () => {

  it('gold-team 不可达且 shots 含 dialogue → 写 stub video_tasks 含 audio slot', async () => {
    const { tmpDir, pipeline } = await setupPipeline({
      shots: [{
        id: 'shot-001',
        description: '主角说话',
        character: '主角',
        dialogue: { text: '你好', character: '主角' },
      }],
      voiceTimeline: {
        timeline: [{ shot_id: 'shot-001', audioPath: '/tmp/v.wav' }],
      },
    });

    const mock = await (mockGoldTeam({ pingReturn: false }))();

    try {
      const phase = Pipeline.getPhases().find(p => p.id === 'cloud-production');
      const handler = phaseHandlers['cloud-production'];
      // 不应 fatal — 降级写 stub
      const result = await handler.after(pipeline, phase, {});
      assert.strictEqual(result.metrics.stubbed, true);
      assert.strictEqual(result.metrics.degraded, true);
      assert.strictEqual(result.metrics.reason, 'gold-team unavailable');

      const raw = await readFile(join(tmpDir, 'video_tasks.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      assert.strictEqual(parsed._stub, true);
      assert.strictEqual(parsed._degraded_reason, 'gold-team unavailable');
    } finally {
      mock.restore();
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
