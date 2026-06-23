/**
 * Phase 22 A2-01: CharacterAssetManager.getOmniReferencePack audio extension 测试
 *
 * 覆盖 Seedance 2.0 音画同步核心契约:
 *   1. 无 audioRefs → hasAudio=false, promptBindings 不含 @Audio
 *   2. 单 audio ref → hasAudio=true, @Audio1 绑定存在, allFiles 含音频路径
 *   3. 多 audio refs → @Audio1/@Audio2 绑定, allFiles 含全部音频路径
 *   4. character 标签透传到 promptBindings
 *
 * Run: node --test test/phases/character-asset-manager.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CharacterAssetManager } from '../../lib/character-asset-manager.js';

async function setupCharacterWithL1(baseDir, characterId = 'hero') {
  const l1Dir = join(baseDir, characterId, 'L1_identity');
  await mkdir(l1Dir, { recursive: true });
  const manifest = {
    level: 'L1',
    type: 'identity_anchor',
    characterId,
    images: [{ path: `/tmp/fixtures/${characterId}-anchor.png` }],
  };
  await writeFile(join(l1Dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

describe('Phase 22 A2-01: getOmniReferencePack audio extension', () => {
  let tmpDir;
  let manager;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'p22-cam-'));
    await setupCharacterWithL1(tmpDir, 'hero');
    manager = new CharacterAssetManager(tmpDir);
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('无 audioRefs → hasAudio=false, promptBindings 不含 @Audio', async () => {
    const pack = await manager.getOmniReferencePack('hero');
    assert.strictEqual(pack.hasAudio, false);
    assert.deepEqual(pack.audioRefs, []);
    assert.ok(!pack.promptBindings.includes('@Audio'),
      '无音频时 promptBindings 不应包含 @Audio token');
    // allFiles 不应包含音频路径
    assert.ok(!pack.allFiles.includes('/tmp/audio/hero-line.wav'));
  });

  it('单 audio ref → hasAudio=true, @Audio1 绑定存在, allFiles 含音频', async () => {
    const pack = await manager.getOmniReferencePack('hero', {
      audioRefs: [
        { path: '/tmp/audio/hero-line.wav', character: 'hero' },
      ],
    });
    assert.strictEqual(pack.hasAudio, true);
    assert.strictEqual(pack.audioRefs.length, 1);
    assert.match(pack.promptBindings, /@Audio1 为角色 hero 提供对白音频/);
    assert.ok(pack.allFiles.includes('/tmp/audio/hero-line.wav'),
      'allFiles 应包含音频路径');
  });

  it('多 audio refs → @Audio1/@Audio2 绑定, allFiles 含全部音频', async () => {
    const pack = await manager.getOmniReferencePack('hero', {
      audioRefs: [
        { path: '/tmp/audio/line1.wav', character: 'hero' },
        { path: '/tmp/audio/line2.wav', character: 'partner' },
      ],
    });
    assert.strictEqual(pack.hasAudio, true);
    assert.strictEqual(pack.audioRefs.length, 2);
    assert.match(pack.promptBindings, /@Audio1 为角色 hero 提供对白音频/);
    assert.match(pack.promptBindings, /@Audio2 为角色 partner 提供对白音频/);
    assert.ok(pack.allFiles.includes('/tmp/audio/line1.wav'));
    assert.ok(pack.allFiles.includes('/tmp/audio/line2.wav'));
  });

  it('audioRefs 无 character 字段 → promptBindings 使用默认"主角色"', async () => {
    const pack = await manager.getOmniReferencePack('hero', {
      audioRefs: [{ path: '/tmp/audio/anon.wav' }],
    });
    assert.strictEqual(pack.hasAudio, true);
    assert.match(pack.promptBindings, /@Audio1 为角色 主角色 提供对白音频/);
  });

  it('audioRefs 含空 path 条目 → 过滤掉，不产出 @Audio', async () => {
    const pack = await manager.getOmniReferencePack('hero', {
      audioRefs: [
        { path: '/tmp/audio/valid.wav', character: 'hero' },
        { path: '', character: 'silent' },          // 空 path 应被过滤
        { character: 'no-path' },                    // 无 path 应被过滤
        null,                                         // null 应被过滤
      ],
    });
    assert.strictEqual(pack.hasAudio, true);
    assert.strictEqual(pack.audioRefs.length, 1);
    assert.match(pack.promptBindings, /@Audio1 为角色 hero/);
    assert.ok(!/@Audio2/.test(pack.promptBindings),
      '过滤掉无效条目后不应出现 @Audio2');
  });

  it('audioRefs 与现有 Image/Video 绑定共存 — 索引独立', async () => {
    const pack = await manager.getOmniReferencePack('hero', {
      sceneFrame: '/tmp/scene.png',
      actionVideos: ['/tmp/action.mp4'],
      audioRefs: [{ path: '/tmp/audio.wav', character: 'hero' }],
    });
    // 各类型绑定都存在
    assert.match(pack.promptBindings, /@Image1/);
    assert.match(pack.promptBindings, /@Video1/);
    assert.match(pack.promptBindings, /@Audio1 为角色 hero/);
    // allFiles 包含全部类型
    assert.ok(pack.allFiles.includes('/tmp/audio.wav'));
    assert.ok(pack.allFiles.some(f => f === '/tmp/action.mp4'));
  });
});
