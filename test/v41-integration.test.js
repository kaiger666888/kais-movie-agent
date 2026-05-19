/**
 * V4.1 Integration Tests — Audio-Visual Fusion Pipeline
 *
 * Run: node --test test/v41-integration.test.js
 * With gold-team: GOLD_TEAM_URL=http://... node --test test/v41-integration.test.js
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { AssetBus } from '../lib/asset-bus.js';
import { SoulLockManager } from '../lib/soul-lock-manager.js';
import { TempDialogueManager } from '../lib/temp-dialogue-manager.js';
import { BGMStrategy } from '../lib/bgm-strategy.js';
import { SceneReverbManager } from '../lib/scene-reverb-manager.js';
import { SFXManager } from '../lib/sfx-manager.js';
import { CompositionEngine } from '../lib/composition-engine.js';
import { Pipeline, createRequirementTemplate, validateRequirement } from '../lib/pipeline.js';

let tmpDir;
before(() => { tmpDir = mkdtempSync(join(tmpdir(), 'v41-test-')); });

// ─── 1. Pipeline PHASES Structure ──────────────────────────

describe('V4.1 Pipeline Structure', () => {
  const phases = Pipeline.getPhases();

  it('has 10 phases', () => {
    assert.equal(phases.length, 10);
  });

  it('has correct phase IDs in order', () => {
    const ids = phases.map(p => p.id);
    assert.deepEqual(ids, [
      'requirement-bible', 'soul-visual', 'soul-voice', 'geometry-bed',
      'spatio-temporal-script', 'seed-skeleton', 'motion-preview',
      'ai-preview', 'final-production', 'composition',
    ]);
  });

  it('has stageOrder 0-9', () => {
    const orders = Pipeline.getPhases().map(p => p.stageOrder);
    assert.deepEqual(orders, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('review phases have review config', () => {
    for (const p of phases) {
      if (['requirement-bible', 'geometry-bed', 'composition'].includes(p.id)) {
        assert.equal(p.review, false, `${p.id} should not have review`);
      } else {
        assert.ok(p.review, `${p.id} should have review config`);
      }
    }
  });
});

// ─── 2. AssetBus V4.1 Schemas ──────────────────────────────

describe('AssetBus V4.1', () => {
  it('writes and reads visual-soul', async () => {
    const bus = new AssetBus(tmpDir);
    await bus.write('visual-soul', { soul_frame_url: 'http://test.jpg', selected_index: 0, visual_tags: ['young'] });
    const data = await bus.read('visual-soul');
    assert.equal(data.soul_frame_url, 'http://test.jpg');
    assert.equal(data.selected_index, 0);
  });

  it('writes and reads voice-soul', async () => {
    const bus = new AssetBus(tmpDir);
    await bus.write('voice-soul', { voice_mood: 'youthful_clear', status: 'FULLY_LOCKED' });
    const data = await bus.read('voice-soul');
    assert.equal(data.voice_mood, 'youthful_clear');
  });

  it('writes and reads geometry-bed', async () => {
    const bus = new AssetBus(tmpDir);
    await bus.write('geometry-bed', { character_models: [], acoustic_rt60: { scene1: { rt60: 0.8 } } });
    const data = await bus.read('geometry-bed');
    assert.ok(data.acoustic_rt60);
  });

  it('writes and reads spatio-temporal-script', async () => {
    const bus = new AssetBus(tmpDir);
    await bus.write('spatio-temporal-script', { shots: [{ id: 's1' }], audio_events: [], duration_coupling: {} });
    const data = await bus.read('spatio-temporal-script');
    assert.equal(data.shots.length, 1);
  });

  it('writes and reads temp-dialogue', async () => {
    const bus = new AssetBus(tmpDir);
    await bus.write('temp-dialogue', { temp_lines: [{ text: '测试', status: 'TEMP' }] });
    const data = await bus.read('temp-dialogue');
    assert.equal(data.temp_lines[0].status, 'TEMP');
  });

  it('writes and reads bgm-skeleton', async () => {
    const bus = new AssetBus(tmpDir);
    await bus.write('bgm-skeleton', { ambient_segments: [], signature_segments: [], bpm: 88 });
    const data = await bus.read('bgm-skeleton');
    assert.equal(data.bpm, 88);
  });

  it('writes and reads audio-reverb', async () => {
    const bus = new AssetBus(tmpDir);
    await bus.write('audio-reverb', { scene_ir_profiles: { s1: { rt60: 0.4 } }, shot_transitions: [] });
    const data = await bus.read('audio-reverb');
    assert.equal(data.scene_ir_profiles.s1.rt60, 0.4);
  });

  it('legacy V2 assets still work', async () => {
    const bus = new AssetBus(tmpDir);
    await bus.write('art-bible', { style_anchor: 'cinematic' });
    const data = await bus.read('art-bible');
    assert.equal(data.style_anchor, 'cinematic');
  });
});

// ─── 3. SceneReverbManager ─────────────────────────────────

describe('SceneReverbManager', () => {
  it('calculates RT60 for a room', () => {
    const mgr = new SceneReverbManager({ assetBus: new AssetBus(tmpDir) });
    const rt60 = mgr.calculateRT60({ width: 5, height: 3, depth: 5 });
    assert.ok(rt60 > 0 && rt60 < 5, `RT60=${rt60} out of range`);
  });

  it('larger rooms have longer RT60', () => {
    const mgr = new SceneReverbManager({ assetBus: new AssetBus(tmpDir) });
    const small = mgr.calculateRT60({ width: 3, height: 2, depth: 3 });
    const large = mgr.calculateRT60({ width: 20, height: 8, depth: 30 });
    assert.ok(large > small, `Large RT60=${large} should be > Small RT60=${small}`);
  });

  it('absorbent materials reduce RT60', () => {
    const mgr = new SceneReverbManager({ assetBus: new AssetBus(tmpDir) });
    const bare = mgr.calculateRT60({ width: 5, height: 3, depth: 5 }, []);
    const carpeted = mgr.calculateRT60({ width: 5, height: 3, depth: 5 },
      [{ type: 'carpet', area: 50 }, { type: 'curtain', area: 10 }]);
    assert.ok(carpeted < bare, `Carpeted RT60=${carpeted} should be < bare RT60=${bare}`);
  });

  it('generates IR profile', () => {
    const mgr = new SceneReverbManager({ assetBus: new AssetBus(tmpDir) });
    const profile = mgr.generateIRProfile(0.8, 'urban_alley_night');
    assert.equal(profile.ir_file, 'urban_alley_night.wav');
    assert.equal(profile.calculated_rt60, 0.8);
  });

  it('plans shot transitions', () => {
    const mgr = new SceneReverbManager({ assetBus: new AssetBus(tmpDir) });
    const shots = [
      { id: 's1', scene_id: 'A' }, { id: 's2', scene_id: 'A' }, { id: 's3', scene_id: 'B' },
    ];
    const transitions = mgr.planShotTransitions(shots, {});
    assert.equal(transitions.length, 2);
    assert.equal(transitions[0].same_scene, true);
    assert.equal(transitions[1].same_scene, false);
    assert.equal(transitions[1].crossfade_duration, 0.5);
  });
});

// ─── 4. SFXManager ─────────────────────────────────────────

describe('SFXManager', () => {
  it('generates SFX hints for preview', () => {
    const mgr = new SFXManager({ goldTeamClient: null, assetBus: new AssetBus(tmpDir) });
    const hint = mgr.generateSFXHints([
      { type: 'sfx', description: 'high heels on concrete' },
      { type: 'sfx', description: 'door slam' },
      { type: 'sfx', description: 'rain' },
      { type: 'sfx', description: 'thunder' },
    ]);
    assert.ok(hint.includes('high heels'));
    assert.ok(hint.includes('door slam'));
    assert.ok(!hint.includes('thunder'), 'Should be limited to 3 hints');
  });

  it('returns empty string for no events', () => {
    const mgr = new SFXManager({ goldTeamClient: null, assetBus: new AssetBus(tmpDir) });
    assert.equal(mgr.generateSFXHints([]), '');
    assert.equal(mgr.generateSFXHints(null), '');
  });
});

// ─── 5. CompositionEngine ──────────────────────────────────

describe('CompositionEngine', () => {
  it('generates quality radar SVG', () => {
    const engine = new CompositionEngine({ workdir: tmpDir });
    const svg = engine.generateQualityRadar({
      hook: { score: 20, max: 25 },
      structure: { score: 15, max: 20 },
      realism: { score: 18, max: 20 },
    });
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes('hook'));
    assert.ok(svg.includes('structure'));
  });
});

// ─── 6. BGMStrategy ────────────────────────────────────────

describe('BGMStrategy', () => {
  it('determines BGM type correctly', () => {
    const bus = new AssetBus(tmpDir);
    const mgr = new BGMStrategy({ assetBus: bus, goldTeamClient: null });
    assert.equal(mgr.determineBGMType({ is_signature: true }), 'signature');
    assert.equal(mgr.determineBGMType({ type: 'leitmotif' }), 'signature');
    assert.equal(mgr.determineBGMType({ type: 'climax' }), 'signature');
    assert.equal(mgr.determineBGMType({ type: 'ambient' }), 'ambient');
    assert.equal(mgr.determineBGMType(null), 'none');
    assert.equal(mgr.determineBGMType({}), 'ambient');
  });
});

// ─── 7. TempDialogueManager ────────────────────────────────

describe('TempDialogueManager', () => {
  it('estimates duration from text length', () => {
    const bus = new AssetBus(tmpDir);
    const mgr = new TempDialogueManager({ assetBus: bus, goldTeamClient: null });
    assert.ok(mgr._estimateDuration('这是一段测试台词') > 0);
    assert.equal(mgr._estimateDuration(''), 1.0);
  });

  it('calculates emotion speed', () => {
    const bus = new AssetBus(tmpDir);
    const mgr = new TempDialogueManager({ assetBus: bus, goldTeamClient: null });
    assert.equal(mgr.calculateEmotionSpeed('angry'), 1.15);
    assert.equal(mgr.calculateEmotionSpeed('sad'), 0.85);
    assert.equal(mgr.calculateEmotionSpeed('neutral'), 1.0);
    assert.equal(mgr.calculateEmotionSpeed('unknown'), 1.0);
  });
});

// ─── 8. Requirement Template ───────────────────────────────

describe('V4.1 Requirement Template', () => {
  it('has audio_preference with V4.1 fields', () => {
    const req = createRequirementTemplate();
    assert.equal(req.audio_preference.bgm_strategy, 'dual');
    assert.equal(req.audio_preference.sfx_mode, 'prompt-driven');
    assert.equal(req.audio_preference.reverb_profile, 'auto');
    assert.ok(req.audio_preference.voice_style !== undefined);
  });

  it('validates basic requirements', () => {
    const result = validateRequirement({ title: 'Test', genre: 'drama', duration_sec: 60, characters: [{ name: 'A' }] });
    assert.ok(result.valid);
  });
});

// ─── 9. V2 State Migration ─────────────────────────────────

describe('V2 State Migration', () => {
  it('migrates V2 phase IDs to V4.1', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'v41-migrate-'));
    const state = {
      episode: 'EP01', startedAt: '2026-01-01',
      phases: {
        requirement: { status: 'completed' },
        'art-direction': { status: 'completed' },
        character: { status: 'completed' },
        voice: { status: 'awaiting_review' },
      },
      currentPhaseId: 'voice',
    };
    writeFileSync(join(workdir, '.pipeline-state.json'), JSON.stringify(state));

    const p = new Pipeline({ workdir, episode: 'EP01' });
    const loaded = await p._loadState();

    assert.equal(loaded.phases['requirement-bible']?.status, 'completed');
    assert.equal(loaded.phases['soul-visual']?.status, 'completed');
    assert.equal(loaded.phases['soul-voice']?.status, 'completed');
    assert.equal(loaded.phases['seed-skeleton']?.status, 'awaiting_review');
    assert.equal(loaded.currentPhaseId, 'seed-skeleton');
    // Old keys should not exist
    assert.equal(loaded.phases.requirement, undefined);
    assert.equal(loaded.phases['art-direction'], undefined);

    rmSync(workdir, { recursive: true });
  });
});
