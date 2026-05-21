/**
 * E2E GPU Integration Tests — Real gold-team service
 *
 * Run with: GOLD_TEAM_URL=http://192.168.71.140:8900 node --test test/e2e-gold-team.test.js
 * Skip if env vars not set (safe for CI without gold-team access).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { GoldTeamClient, GoldTeamError } from '../lib/gold-team-client.js';
import {
  generateArtDirectionViaGoldTeam,
  refineArtDirectionViaGoldTeam,
  controlArtDirectionViaGoldTeam,
  generateVideoViaGoldTeam,
  interpolateVideoViaGoldTeam,
  styleTransferVideoViaGoldTeam,
  cloneVoice,
  convertVoice,
  generateBGM,
  generateSFX,
  separateAudio,
  lipSync,
} from '../lib/phases/index.js';

const BASE_URL = process.env.GOLD_TEAM_URL;
const SKIP = !BASE_URL;

function skipIfUnavailable() {
  if (SKIP) {
    console.log('[E2E] GOLD_TEAM_URL not set, skipping real E2E tests');
    return true;
  }
  return false;
}

function makeClient() {
  return new GoldTeamClient({ baseUrl: BASE_URL, timeout: 30000 });
}

function mockPipeline() {
  return {
    episode: 'E2E-TEST',
    traceId: 'e2e-trace-001',
    config: {
      goldTeam: {
        baseUrl: BASE_URL,
        callbackBaseUrl: process.env.CALLBACK_BASE_URL || 'http://127.0.0.1:3000',
      },
      preview_mode: false,
    },
    workdir: '/tmp/e2e-test',
    characterDNA: new Map(),
    sceneDNA: new Map(),
  };
}

// ─── Health Check ──────────────────────────────────────────

describe('E2E: gold-team health', { skip: SKIP }, () => {
  it('should ping successfully', async () => {
    const client = makeClient();
    const ok = await client.ping(10000);
    assert.ok(ok, 'gold-team health check failed — is the service running?');
  });

  it('should list tasks', async () => {
    const client = makeClient();
    const tasks = await client.listTasks({ limit: 5 });
    assert.ok(Array.isArray(tasks) || typeof tasks === 'object');
  });
});

// ─── TTS — previously untested ─────────────────────────────

describe('E2E: submitTTS', { skip: SKIP }, () => {
  it('should submit TTS task and return task ID', async () => {
    const client = makeClient();
    const result = await client.submitTTS('你好，这是一个端到端测试。', {
      voiceId: 'Vivian',
      language: 'zh',
      outputFormat: 'wav',
    });
    assert.ok(result.taskId, 'should return a task ID');
    assert.equal(result.state, 'queued');
  });

  it('should submit TTS with degraded mode when service unavailable', async () => {
    const badClient = new GoldTeamClient({
      baseUrl: 'http://127.0.0.1:1',
      timeout: 3000,
    });
    const result = await badClient.submitTTSDegraded('test', {
      voiceId: 'Vivian',
      language: 'zh',
    });
    assert.equal(result.degraded, true);
    assert.equal(result.state, 'DEGRADED_SKIPPED');
  });
});

// ─── Art Direction FLUX ────────────────────────────────────

describe('E2E: art-direction FLUX', { skip: SKIP }, () => {
  it('should submit image_draw task', async () => {
    const pipeline = mockPipeline();
    const result = await generateArtDirectionViaGoldTeam(
      pipeline, 'a dark cyberpunk street at night', 'neon noir cinematic',
    );
    assert.ok(result.taskId);
  });
});

// ─── Video Generation ──────────────────────────────────────

describe('E2E: video generation', { skip: SKIP }, () => {
  it('should submit video_final task for shot', async () => {
    const pipeline = mockPipeline();
    pipeline.config.preview_mode = false;
    const shot = { id: 'e2e-shot-1', description: 'slow zoom into a neon sign' };
    const result = await generateVideoViaGoldTeam(pipeline, shot);
    assert.ok(result.taskId);
  });

  it('should submit video_preview_fast for preview mode', async () => {
    const pipeline = mockPipeline();
    pipeline.config.preview_mode = true;
    const shot = { id: 'e2e-shot-preview', description: 'quick test preview' };
    const result = await generateVideoViaGoldTeam(pipeline, shot);
    assert.ok(result.taskId);
  });

  it('should submit video_interpolate task', async () => {
    const pipeline = mockPipeline();
    const result = await interpolateVideoViaGoldTeam(pipeline, '/tmp/test-video.mp4', 30);
    assert.ok(result.taskId);
  });

  it('should submit video_to_video task', async () => {
    const pipeline = mockPipeline();
    const result = await styleTransferVideoViaGoldTeam(pipeline, '/tmp/test-video.mp4', 'watercolor style');
    assert.ok(result.taskId);
  });
});

// ─── Voice Clone/Convert ───────────────────────────────────

describe('E2E: voice clone/convert', { skip: SKIP }, () => {
  it('should submit voice_clone task', async () => {
    const pipeline = mockPipeline();
    const result = await cloneVoice(pipeline, '/tmp/ref-voice.wav', '测试克隆', 'zh');
    assert.ok(result.taskId);
  });

  it('should submit voice_convert task', async () => {
    const pipeline = mockPipeline();
    const result = await convertVoice(pipeline, '/tmp/source-voice.wav', 'male-deep');
    assert.ok(result.taskId);
  });
});

// ─── Post-Production ───────────────────────────────────────

describe('E2E: post-production', { skip: SKIP }, () => {
  it('should submit music_final task', async () => {
    const pipeline = mockPipeline();
    const result = await generateBGM(pipeline, 'epic cinematic orchestral', 60);
    assert.ok(result.taskId);
  });

  it('should submit sfx_generation task', async () => {
    const pipeline = mockPipeline();
    const result = await generateSFX(pipeline, 'heavy thunder with rain');
    assert.ok(result.taskId);
  });

  it('should submit audio_separate task', async () => {
    const pipeline = mockPipeline();
    const result = await separateAudio(pipeline, '/tmp/mixed-audio.wav');
    assert.ok(result.taskId);
  });
});

// ─── Lip Sync ──────────────────────────────────────────────

describe('E2E: lip sync', { skip: SKIP }, () => {
  it('should submit lip_sync_rt task', async () => {
    const pipeline = mockPipeline();
    const result = await lipSync(pipeline, '/tmp/character.png', '/tmp/dialogue.wav');
    assert.ok(result.taskId);
  });
});

// ─── Degradation ───────────────────────────────────────────

describe('E2E: degradation', () => {
  it('should degrade gracefully when gold-team unreachable', async () => {
    const client = new GoldTeamClient({
      baseUrl: 'http://127.0.0.1:1',
      timeout: 2000,
    });
    const result = await client.submitTaskDegraded({
      taskType: 'sfx_generation',
      params: { prompt: 'test' },
    });
    assert.equal(result.degraded, true);
    assert.equal(result.state, 'DEGRADED_SKIPPED');
  });
});
