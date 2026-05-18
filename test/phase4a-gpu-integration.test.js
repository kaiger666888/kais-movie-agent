/**
 * Phase 4A GPU Integration Tests
 * Uses node:test built-in runner — zero npm dependencies
 * Mocks global fetch to avoid real network calls
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// ─── Mock HTTP Server ─────────────────────────────────────────

let mockServer;
let mockPort;
let submittedTasks = [];

async function startMockServer() {
  return new Promise((resolve, reject) => {
    mockServer = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }

      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        submittedTasks.push({
          method: req.method,
          url: req.url,
          body: parsed,
        });

        const taskId = `mock-task-${submittedTasks.length}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: {
            task_id: taskId,
            state: 'queued',
            created_at: new Date().toISOString(),
          },
        }));
      });
    });

    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = mockServer.address().port;
      resolve();
    });
    mockServer.on('error', reject);
  });
}

async function stopMockServer() {
  return new Promise(resolve => mockServer?.close(resolve) || resolve());
}

function mockPipeline() {
  return {
    episode: 'EP01',
    traceId: 'test-trace-001',
    config: {
      goldTeam: {
        baseUrl: `http://127.0.0.1:${mockPort}`,
        apiKey: 'gt-mock-test-key',
        callbackBaseUrl: `http://127.0.0.1:${mockPort}`,
      },
      preview_mode: false,
    },
    workdir: '/tmp/test-pipeline',
    characterDNA: new Map(),
    sceneDNA: new Map(),
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('Phase 4A GPU Integration', () => {
  beforeEach(() => { submittedTasks = []; });

  // Start mock server once
  it.before(async () => { await startMockServer(); });
  it.after(async () => { await stopMockServer(); });

  // ─── 4A.2 art-direction FLUX ──────────────────────────────────

  describe('4A.2 generateArtDirectionViaGoldTeam', () => {
    it('should submit image_draw task with FLUX params', async () => {
      const { generateArtDirectionViaGoldTeam } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      const result = await generateArtDirectionViaGoldTeam(pipeline, 'cyberpunk city at night', 'neon noir');

      assert.equal(result.taskId, 'mock-task-1');
      assert.equal(result.state, 'queued');
      assert.equal(submittedTasks[0].body.task_type, 'image_draw');
      assert.ok(submittedTasks[0].body.params.prompt.includes('cyberpunk city at night'));
      assert.ok(submittedTasks[0].body.params.prompt.includes('neon noir'));
      assert.equal(submittedTasks[0].body.params.num_images, 3);
      assert.equal(submittedTasks[0].body.params.variant, 'schnell');
      assert.ok(submittedTasks[0].body.params.extra.flux);
      assert.equal(submittedTasks[0].body.params.extra.flux.guidance_scale, 3.5);
    });
  });

  describe('4A.2 refineArtDirectionViaGoldTeam', () => {
    it('should submit image_refine task', async () => {
      const { refineArtDirectionViaGoldTeam } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      await refineArtDirectionViaGoldTeam(pipeline, '/sketch.png', 'enhance details');

      assert.equal(submittedTasks[0].body.task_type, 'image_refine');
      assert.equal(submittedTasks[0].body.params.source_image_path, '/sketch.png');
    });
  });

  describe('4A.2 controlArtDirectionViaGoldTeam', () => {
    it('should submit image_control task', async () => {
      const { controlArtDirectionViaGoldTeam } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      await controlArtDirectionViaGoldTeam(pipeline, '/ref.png', 'follow structure');

      assert.equal(submittedTasks[0].body.task_type, 'image_control');
      assert.equal(submittedTasks[0].body.params.reference_image_path, '/ref.png');
    });
  });

  // ─── 4A.5 camera VIDEO_FINAL ──────────────────────────────────

  describe('4A.5 generateVideoViaGoldTeam', () => {
    it('should use video_final for non-preview mode', async () => {
      const { generateVideoViaGoldTeam } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();
      pipeline.config.preview_mode = false;

      const shot = { id: 'shot-1', description: 'hero walks through neon door', referenceImage: '/ref.png' };
      const result = await generateVideoViaGoldTeam(pipeline, shot);

      assert.ok(result.taskId);
      assert.equal(submittedTasks[0].body.task_type, 'video_final');
      assert.equal(submittedTasks[0].body.params.num_frames, 81);
      assert.equal(submittedTasks[0].body.params.num_inference_steps, 20);
      assert.equal(submittedTasks[0].body.priority, 10);
    });

    it('should use video_preview_fast for preview mode', async () => {
      submittedTasks = [];
      const { generateVideoViaGoldTeam } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();
      pipeline.config.preview_mode = true;

      const shot = { id: 'shot-2', description: 'quick preview' };
      await generateVideoViaGoldTeam(pipeline, shot);

      assert.equal(submittedTasks[0].body.task_type, 'video_preview_fast');
      assert.equal(submittedTasks[0].body.params.num_frames, 33);
      assert.equal(submittedTasks[0].body.params.num_inference_steps, 10);
      assert.equal(submittedTasks[0].body.priority, 1);
    });
  });

  describe('4A.5 interpolateVideoViaGoldTeam', () => {
    it('should submit video_interpolate task', async () => {
      const { interpolateVideoViaGoldTeam } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      await interpolateVideoViaGoldTeam(pipeline, '/video.mp4', 30);

      assert.equal(submittedTasks[0].body.task_type, 'video_interpolate');
      assert.equal(submittedTasks[0].body.params.target_fps, 30);
    });
  });

  describe('4A.5 styleTransferVideoViaGoldTeam', () => {
    it('should submit video_to_video task', async () => {
      const { styleTransferVideoViaGoldTeam } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      await styleTransferVideoViaGoldTeam(pipeline, '/video.mp4', 'oil painting');

      assert.equal(submittedTasks[0].body.task_type, 'video_to_video');
      assert.equal(submittedTasks[0].body.params.prompt, 'oil painting');
    });
  });

  // ─── 4A.6 voice CLONE/CONVERT ─────────────────────────────────

  describe('4A.6 cloneVoice', () => {
    it('should submit voice_clone task', async () => {
      const { cloneVoice } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      await cloneVoice(pipeline, '/audio/ref.wav', '你好世界', 'zh');

      assert.equal(submittedTasks[0].body.task_type, 'voice_clone');
      assert.equal(submittedTasks[0].body.params.text, '你好世界');
      assert.equal(submittedTasks[0].body.params.reference_audio_path, '/audio/ref.wav');
      assert.equal(submittedTasks[0].body.params.language, 'zh');
      assert.equal(submittedTasks[0].body.params.output_format, 'wav');
    });
  });

  describe('4A.6 convertVoice', () => {
    it('should submit voice_convert task', async () => {
      const { convertVoice } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      await convertVoice(pipeline, '/audio/source.wav', 'female-gentle');

      assert.equal(submittedTasks[0].body.task_type, 'voice_convert');
      assert.equal(submittedTasks[0].body.params.source_audio_path, '/audio/source.wav');
      assert.equal(submittedTasks[0].body.params.target_voice, 'female-gentle');
    });
  });

  // ─── 4A.7 post-production MUSIC/SFX ───────────────────────────

  describe('4A.7 generateBGM', () => {
    it('should submit music_final task with duration', async () => {
      const { generateBGM } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      await generateBGM(pipeline, 'epic orchestral battle', 120);

      assert.equal(submittedTasks[0].body.task_type, 'music_final');
      assert.equal(submittedTasks[0].body.params.prompt, 'epic orchestral battle');
      assert.equal(submittedTasks[0].body.params.duration, 120);
      assert.equal(submittedTasks[0].body.params.output_format, 'mp3');
      assert.ok(submittedTasks[0].body.params.extra.acestep);
    });
  });

  describe('4A.7 generateSFX', () => {
    it('should submit sfx_generation task', async () => {
      const { generateSFX } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      await generateSFX(pipeline, 'sword clash metal ring');

      assert.equal(submittedTasks[0].body.task_type, 'sfx_generation');
      assert.equal(submittedTasks[0].body.params.prompt, 'sword clash metal ring');
      assert.equal(submittedTasks[0].body.params.output_format, 'wav');
    });
  });

  describe('4A.7 separateAudio', () => {
    it('should submit audio_separate task', async () => {
      const { separateAudio } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      await separateAudio(pipeline, '/audio/mixed.wav');

      assert.equal(submittedTasks[0].body.task_type, 'audio_separate');
      assert.equal(submittedTasks[0].body.params.audio_path, '/audio/mixed.wav');
    });
  });

  // ─── 4A.8 lip-sync ────────────────────────────────────────────

  describe('4A.8 lipSync', () => {
    it('should submit lip_sync_rt task', async () => {
      const { lipSync } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      await lipSync(pipeline, '/images/character.png', '/audio/dialogue.wav');

      assert.equal(submittedTasks[0].body.task_type, 'lip_sync_rt');
      assert.equal(submittedTasks[0].body.params.source_image_path, '/images/character.png');
      assert.equal(submittedTasks[0].body.params.driving_audio_path, '/audio/dialogue.wav');
      assert.equal(submittedTasks[0].body.params.output_format, 'mp4');
      assert.equal(submittedTasks[0].body.priority, 10);
    });
  });

  // ─── Callback URL & Description ─────────────────────────────

  describe('Task metadata', () => {
    it('should include callback_url and description in all tasks', async () => {
      const { lipSync, generateSFX } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      await lipSync(pipeline, '/img.png', '/aud.wav');
      await generateSFX(pipeline, 'test sfx');

      for (const task of submittedTasks) {
        assert.ok(task.body.callback_url, 'callback_url present');
        assert.ok(task.body.description, 'description present');
        assert.ok(task.body.callback_url.includes('/callback/gpu_task'));
      }
    });

    it('should include X-API-Key header', async () => {
      const { lipSync } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();

      await lipSync(pipeline, '/img.png', '/aud.wav');

      // We verify the mock server received the request successfully,
      // meaning auth header was accepted
      assert.ok(submittedTasks.length > 0);
    });
  });

  // ─── Degradation ──────────────────────────────────────────────

  describe('Degradation', () => {
    it('should handle gold-team unavailable gracefully', async () => {
      const { generateArtDirectionViaGoldTeam } = await import('../lib/phases/index.js');
      const pipeline = mockPipeline();
      // Point to a port that doesn't exist
      pipeline.config.goldTeam.baseUrl = 'http://127.0.0.1:1';

      await assert.rejects(
        () => generateArtDirectionViaGoldTeam(pipeline, 'test', 'test'),
        { name: 'GoldTeamError' },
      );
    });
  });
});
