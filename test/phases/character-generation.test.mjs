/**
 * Phase 14 ARCH-04: character-generation 真实实现 单元测试
 *
 * 验证范围:
 *   1. _buildL1Prompt / _buildL2Prompt 构造 (GOLDEN_STANDARD)
 *   2. _generateL1Anchors: 20 候选 -> 打分 -> top-3 过滤 (>= 0.7)
 *   3. _generateL2Costumes: compositions API + L1 锚点引用
 *   4. _computeFaceEmbeddingHash / _computeCostumeFingerprint
 *   5. _loadCharactersForGeneration: requirement.json 读取
 *   6. 完整 handler:
 *      - 降级路径 (Jimeng API 不可达 -> degraded mode, 无 fatal)
 *      - 真实路径 (mock JimengClient methods -> 正常生成)
 *      - 幂等性 (已有 L1 锚点时跳过)
 *      - 阈值过滤 (所有候选 < 0.7 时该角色 degraded)
 *
 * 所有 JimengClient / LLM 调用全部 mock,不触达真实 API。
 *
 * Run: node --test test/phases/character-generation.test.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Pipeline, createRequirementTemplate } from '../../lib/pipeline.js';
import { phaseHandlers, _characterGenerationInternals as internals } from '../../lib/phases/index.js';
import { CharacterAssetManager } from '../../lib/character-asset-manager.js';

const {
  _buildL1Prompt, _buildL2Prompt,
  _generateL1Anchors, _generateL2Costumes,
  _loadCharactersForGeneration,
  _computeFaceEmbeddingHash, _computeCostumeFingerprint,
} = internals;


// ═══════════════════════════════════════════════════════════════════
// describe 1: prompt 构造 (L1/L2)
// ═══════════════════════════════════════════════════════════════════
describe('Phase 14: prompt 构造', () => {

  it('_buildL1Prompt 包含 GOLDEN_STANDARD 关键词', () => {
    const char = { name: '小明', face: '短发,大眼睛', body: '瘦高' };
    const prompt = _buildL1Prompt(char);
    assert.ok(prompt.includes('小明'), 'prompt 应包含角色名');
    assert.ok(prompt.includes('面部特写'), 'L1 必须是面部特写');
    assert.ok(prompt.includes('正面'), 'L1 必须正面');
    assert.ok(prompt.includes('中性表情'), 'L1 必须中性表情');
    assert.ok(prompt.includes('浅灰色背景'), 'L1 须符合 GOLDEN_STANDARD 背景');
    assert.ok(prompt.includes('柔和均匀光'), 'L1 须柔和均匀光');
    assert.ok(!prompt.includes('全身'), 'L1 不应是全身');
  });

  it('_buildL1Prompt 无 face 字段时降级到 description/name', () => {
    const prompt = _buildL1Prompt({ name: '主角' });
    assert.ok(prompt.includes('主角'));
  });

  it('_buildL2Prompt 正面视图包含全身正面', () => {
    const char = { name: '小明', body: '瘦高' };
    const prompt = _buildL2Prompt(char, '校服', 'front');
    assert.ok(prompt.includes('正面全身'));
    assert.ok(prompt.includes('校服'));
    assert.ok(!prompt.includes('侧面'));
  });

  it('_buildL2Prompt 侧面视图包含侧面全身', () => {
    const char = { name: '小明' };
    const prompt = _buildL2Prompt(char, { name: '战斗装', description: '铠甲' }, 'side');
    assert.ok(prompt.includes('侧面全身'));
    assert.ok(prompt.includes('战斗装'));
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 2: 指纹计算
// ═══════════════════════════════════════════════════════════════════
describe('Phase 14: 指纹计算', () => {

  it('_computeFaceEmbeddingHash 返回 16 位 hex', () => {
    const hash = _computeFaceEmbeddingHash('/path/to/img.png');
    assert.match(hash, /^[a-f0-9]{16}$/, '应为 16 位 hex');
  });

  it('_computeFaceEmbeddingHash 相同输入相同输出 (确定性)', () => {
    const a = _computeFaceEmbeddingHash('/same.png');
    const b = _computeFaceEmbeddingHash('/same.png');
    assert.strictEqual(a, b);
  });

  it('_computeFaceEmbeddingHash 不同输入不同输出', () => {
    const a = _computeFaceEmbeddingHash('/a.png');
    const b = _computeFaceEmbeddingHash('/b.png');
    assert.notStrictEqual(a, b);
  });

  it('_computeCostumeFingerprint 基于多图路径聚合', () => {
    const fp1 = _computeCostumeFingerprint(['/front.png', '/side.png']);
    const fp2 = _computeCostumeFingerprint(['/front.png', '/side.png']);
    assert.strictEqual(fp1, fp2, '相同输入应得相同指纹');
    assert.match(fp1, /^[a-f0-9]{16}$/);
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 3: _generateL1Anchors 候选生成 + 打分 + 过滤
// ═══════════════════════════════════════════════════════════════════
describe('Phase 14: _generateL1Anchors', () => {

  it('生成 20 候选, 按分数排序, 保留 top-3 (score >= 0.7)', async () => {
    // Mock jimeng: generateImage 返回 20 张假图
    const fakeJimeng = {
      generateImage: async () => [{ url: `http://fake/cand-${Math.random()}.png`, seed: 123 }],
    };
    // Mock scorer: 偶数 index 高分, 奇数低分
    const scorer = async (imagePath) => {
      const idx = parseInt(imagePath.match(/cand-(\d)/)?.[1] || '0', 10);
      return { score: idx % 2 === 0 ? 0.9 : 0.4, details: 'mock' };
    };

    const result = await _generateL1Anchors(
      { name: 'test', face: 'desc' },
      fakeJimeng, scorer,
      { candidates: 10, threshold: 0.7, maxAnchors: 3 },
    );

    assert.ok(Array.isArray(result.candidates), '应返回候选数组');
    assert.ok(result.candidates.length <= 10, '候选数不超过请求数');
    assert.ok(result.selected.length <= 3, '最多 3 个选定');
    assert.ok(result.selected.every(s => s.score >= 0.7), '所有选定项 score >= 0.7');
    assert.ok(result.anchors.length === result.selected.length, 'anchors 长度 = selected 长度');
    // 排序验证 (高分在前)
    for (let i = 1; i < result.selected.length; i++) {
      assert.ok(result.selected[i - 1].score >= result.selected[i].score, 'selected 应按分数降序');
    }
    // 每个候选应含 face_embedding_hash
    assert.ok(result.candidates.every(c => typeof c.face_embedding_hash === 'string'),
      '所有候选应含 face_embedding_hash');
  });

  it('所有候选低于阈值时返回空 anchors (不抛 fatal)', async () => {
    const fakeJimeng = {
      generateImage: async () => [{ url: 'http://fake/low.png' }],
    };
    const scorer = async () => ({ score: 0.3, details: 'all low quality' });

    const result = await _generateL1Anchors(
      { name: 'test' }, fakeJimeng, scorer,
      { candidates: 5, threshold: 0.7, maxAnchors: 3 },
    );

    assert.strictEqual(result.selected.length, 0, '应无选定项');
    assert.strictEqual(result.anchors.length, 0, '应无 anchors');
    assert.ok(result.candidates.length > 0, '候选列表应保留 (供 audit trail)');
  });

  it('部分候选生成失败时丢弃失败项', async () => {
    let callCount = 0;
    const fakeJimeng = {
      generateImage: async () => {
        callCount++;
        if (callCount % 3 === 0) throw new Error('network error');
        return [{ url: `http://fake/ok-${callCount}.png` }];
      },
    };
    const scorer = async () => ({ score: 0.85, details: 'mock' });

    const result = await _generateL1Anchors(
      { name: 'test' }, fakeJimeng, scorer,
      { candidates: 6, threshold: 0.7, maxAnchors: 3 },
    );

    assert.ok(result.candidates.length < 6, '失败的候选应被丢弃');
    assert.ok(result.candidates.length > 0, '至少应有部分成功');
  });

  it('scorer 抛异常时该项得 0 分', async () => {
    const fakeJimeng = { generateImage: async () => [{ url: 'http://fake/x.png' }] };
    const scorer = async () => { throw new Error('LLM down'); };

    const result = await _generateL1Anchors(
      { name: 'test' }, fakeJimeng, scorer,
      { candidates: 2, threshold: 0.7, maxAnchors: 3 },
    );

    assert.ok(result.candidates.every(c => c.score === 0), 'scorer 失败时 score 应为 0');
    assert.strictEqual(result.selected.length, 0, '0 分不应通过阈值');
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 4: _generateL2Costumes compositions API
// ═══════════════════════════════════════════════════════════════════
describe('Phase 14: _generateL2Costumes', () => {

  it('对每个 costume 调用 compositions 2 次 (front + side)', async () => {
    let callCount = 0;
    const calls = [];
    const fakeJimeng = {
      compositions: async (prompt, opts) => {
        callCount++;
        calls.push({ prompt, sample_strength: opts.sample_strength, imagesCount: opts.images.length });
        return [{ url: `http://fake/l2-${callCount}.png` }];
      },
    };

    const l1Anchors = ['/path/anchor1.png', '/path/anchor2.png'];
    const costumes = ['school_uniform', 'casual'];
    const result = await _generateL2Costumes(
      { name: 'test', body: 'desc' },
      l1Anchors, fakeJimeng, costumes,
      { sampleStrength: 0.3 },
    );

    assert.strictEqual(result.length, 2, '应生成 2 套 costume');
    assert.strictEqual(callCount, 4, '2 costumes × 2 views = 4 次 compositions 调用');
    // 每次 sample_strength 都是 0.3
    assert.ok(calls.every(c => c.sample_strength === 0.3), 'sample_strength 必须 0.3');
    // 每次调用都引用 L1 锚点
    assert.ok(calls.every(c => c.imagesCount >= 1), 'compositions 必须传 L1 锚点');
    // 验证 costumeId + frontPath + sidePath + costume_fingerprint
    for (const c of result) {
      assert.ok(c.costumeId, '每个 costume 应有 costumeId');
      assert.ok(c.frontPath, '应有 frontPath');
      assert.ok(c.sidePath, '应有 sidePath');
      assert.ok(c.costume_fingerprint, '应有 costume_fingerprint');
      assert.ok(c.imagePaths.length === 2, 'imagePaths 应含 2 张');
    }
  });

  it('无 L1 锚点时抛错 (一致性硬约束)', async () => {
    const fakeJimeng = { compositions: async () => [{ url: 'x' }] };
    await assert.rejects(
      () => _generateL2Costumes({ name: 'test' }, [], fakeJimeng, ['default']),
      /缺少 L1 身份锚点/,
    );
  });

  it('costume 默认为字符串 "default"', async () => {
    const fakeJimeng = {
      compositions: async () => [{ url: 'http://fake/l2.png' }],
    };
    const result = await _generateL2Costumes(
      { name: 'test' },
      ['/a.png'], fakeJimeng, ['default'],
    );
    assert.strictEqual(result[0].costumeId, 'default');
  });

  it('compositions 失败时 frontPath/sidePath 部分缺失但不 fatal', async () => {
    let callCount = 0;
    const fakeJimeng = {
      compositions: async () => {
        callCount++;
        if (callCount === 1) throw new Error('API 500'); // front 失败
        return [{ url: 'http://fake/side.png' }];
      },
    };
    const result = await _generateL2Costumes(
      { name: 'test' },
      ['/a.png'], fakeJimeng, ['default'],
    );
    assert.strictEqual(result.length, 1);
    assert.ok(!result[0].frontPath || result[0].frontPath === null, 'front 失败应为 null');
    assert.ok(result[0].sidePath, 'side 应成功');
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 5: _loadCharactersForGeneration
// ═══════════════════════════════════════════════════════════════════
describe('Phase 14: _loadCharactersForGeneration', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'phase14-loadchar-'));
  });
  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('tier 2: 当 pain-report.json 缺失时降级到 requirement.json (legacy)', async () => {
    const reqChars = [{ id: 'c1', name: 'A', face: 'fa', body: 'ba', costumes: ['uniform'] }];
    await writeFile(
      join(tmpDir, 'requirement.json'),
      JSON.stringify({ title: 't', genre: 'g', characters: reqChars }),
    );
    const pipeline = { workdir: tmpDir, config: { characters: [{ name: 'fallback' }] } };
    const chars = await _loadCharactersForGeneration(pipeline);
    assert.strictEqual(chars.length, 1);
    assert.strictEqual(chars[0].name, 'A');
    assert.ok(chars[0].costumes.includes('uniform'), '应保留 costumes');
  });

  it('requirement.json 缺失时降级到 pipeline.config.characters', async () => {
    const pipeline = {
      workdir: join(tmpDir, 'nonexistent-subdir'),
      config: { characters: [{ name: 'FB', description: 'desc' }] },
    };
    const chars = await _loadCharactersForGeneration(pipeline);
    assert.strictEqual(chars.length, 1);
    assert.strictEqual(chars[0].name, 'FB');
    assert.ok(chars[0].face.includes('desc'), '应将 description 填入 face');
  });

  it('为缺 id 的角色生成 char-N', async () => {
    const pipeline = {
      workdir: join(tmpDir, 'another-missing'),
      config: { characters: [{ name: 'X' }, { name: 'Y' }] },
    };
    const chars = await _loadCharactersForGeneration(pipeline);
    assert.strictEqual(chars[0].id, 'char-1');
    assert.strictEqual(chars[1].id, 'char-2');
  });

  it('无 costumes 字段时填默认 ["default"]', async () => {
    const pipeline = {
      workdir: join(tmpDir, 'no-costumes'),
      config: { characters: [{ name: 'Z' }] },
    };
    const chars = await _loadCharactersForGeneration(pipeline);
    assert.deepEqual(chars[0].costumes, ['default']);
  });

  // ─── Phase 26: pain-report.json tier coverage (PIPE-DATA-01) ───

  it('tier 1: 优先读 pain-report.json 的 requirement.characters', async () => {
    const t = await mkdtemp(join(tmpdir(), 'phase26-pain-report-'));
    try {
      await writeFile(
        join(t, 'pain-report.json'),
        JSON.stringify({ requirement: { characters: [{ id: 'p1', name: 'P', face: 'pf', body: 'pb', costumes: ['c'] }] } }),
      );
      await writeFile(
        join(t, 'requirement.json'),
        JSON.stringify({ characters: [{ name: 'LEGACY' }] }),
      );
      const chars = await _loadCharactersForGeneration({ workdir: t, config: { characters: [] } });
      assert.strictEqual(chars[0].name, 'P');
      assert.strictEqual(chars[0].id, 'p1');
    } finally {
      await rm(t, { recursive: true, force: true });
    }
  });

  it('tier 1: pain-report.json 存在但 requirement.characters 为空时降级到 requirement.json', async () => {
    const t = await mkdtemp(join(tmpdir(), 'phase26-empty-'));
    try {
      await writeFile(
        join(t, 'pain-report.json'),
        JSON.stringify({ requirement: { characters: [] } }),
      );
      await writeFile(
        join(t, 'requirement.json'),
        JSON.stringify({ characters: [{ name: 'RL' }] }),
      );
      const chars = await _loadCharactersForGeneration({ workdir: t, config: { characters: [] } });
      assert.strictEqual(chars[0].name, 'RL');
    } finally {
      await rm(t, { recursive: true, force: true });
    }
  });

  it('tier 1: pain-report.json 存在但缺 requirement 字段时降级到 requirement.json', async () => {
    const t = await mkdtemp(join(tmpdir(), 'phase26-noreq-'));
    try {
      await writeFile(
        join(t, 'pain-report.json'),
        JSON.stringify({ pain_points: [] }),
      );
      await writeFile(
        join(t, 'requirement.json'),
        JSON.stringify({ characters: [{ name: 'RL2' }] }),
      );
      const chars = await _loadCharactersForGeneration({ workdir: t, config: { characters: [] } });
      assert.strictEqual(chars[0].name, 'RL2');
    } finally {
      await rm(t, { recursive: true, force: true });
    }
  });

  it('tier 1: pain-report.json 解析失败 (损坏 JSON) 降级到 requirement.json', async () => {
    const t = await mkdtemp(join(tmpdir(), 'phase26-broken-'));
    try {
      await writeFile(join(t, 'pain-report.json'), '{ not valid json');
      await writeFile(
        join(t, 'requirement.json'),
        JSON.stringify({ characters: [{ name: 'FROMREQ' }] }),
      );
      const chars = await _loadCharactersForGeneration({ workdir: t, config: { characters: [] } });
      assert.strictEqual(chars[0].name, 'FROMREQ');
    } finally {
      await rm(t, { recursive: true, force: true });
    }
  });

  it('normalization 一致性: pain-report tier 保留 costumes / face-from-description / id 默认值', async () => {
    const t = await mkdtemp(join(tmpdir(), 'phase26-norm-'));
    try {
      await writeFile(
        join(t, 'pain-report.json'),
        JSON.stringify({ requirement: { characters: [{ name: 'NN', description: 'fd' }] } }),
      );
      const chars = await _loadCharactersForGeneration({ workdir: t, config: { characters: [] } });
      assert.strictEqual(chars[0].id, 'char-1');
      assert.ok(chars[0].face.includes('fd'), 'face should fall back to description');
      assert.deepEqual(chars[0].costumes, ['default']);
    } finally {
      await rm(t, { recursive: true, force: true });
    }
  });

  it('tier 2 fallback emits observable console.warn (SC#4)', async () => {
    const t = await mkdtemp(join(tmpdir(), 'phase26-warn2-'));
    const originalWarn = console.warn;
    const warns = [];
    console.warn = (msg, ...rest) => { warns.push(String(msg)); originalWarn(msg, ...rest); };
    try {
      await writeFile(
        join(t, 'requirement.json'),
        JSON.stringify({ characters: [{ name: 'RW' }] }),
      );
      const chars = await _loadCharactersForGeneration({ workdir: t, config: { characters: [] } });
      assert.strictEqual(chars[0].name, 'RW');
      assert.ok(
        warns.some(w => w.includes('legacy') && w.includes('requirement.json')),
        'expected legacy warn not emitted: ' + JSON.stringify(warns),
      );
    } finally {
      console.warn = originalWarn;
      await rm(t, { recursive: true, force: true });
    }
  });

  it('tier 3 fallback emits observable console.warn (SC#4)', async () => {
    const t = await mkdtemp(join(tmpdir(), 'phase26-warn3-'));
    const originalWarn = console.warn;
    const warns = [];
    console.warn = (msg, ...rest) => { warns.push(String(msg)); originalWarn(msg, ...rest); };
    try {
      const config = { characters: [{ id: 'c1', name: 'CF', face: 'f', body: 'b', costumes: ['x'] }] };
      const chars = await _loadCharactersForGeneration({ workdir: t, config });
      assert.strictEqual(chars[0].name, 'CF');
      assert.ok(
        warns.some(w => w.includes('pipeline.config.characters fallback in use')),
        'expected tier3 warn not emitted: ' + JSON.stringify(warns),
      );
    } finally {
      console.warn = originalWarn;
      await rm(t, { recursive: true, force: true });
    }
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 6: 完整 handler — 降级路径
// ═══════════════════════════════════════════════════════════════════
describe('Phase 14: handler 降级模式 (Jimeng API 不可达)', () => {
  let tmpDir;
  let pipeline;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'phase14-degrade-'));
    pipeline = new Pipeline({
      workdir: tmpDir,
      config: createRequirementTemplate({
        title: '测试降级', genre: '科幻',
        characters: [{ name: '主角', description: 'desc' }],
      }),
      episode: 'DEGRADE-EP',
    });
    // 指向不存在的 Jimeng API — ping 会失败
    process.env.JIMENG_BASE_URL = 'http://127.0.0.1:1';
  });

  after(async () => {
    delete process.env.JIMENG_BASE_URL;
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('Jimeng 不可达时 handler 不抛 fatal, 写 degraded 标记', async () => {
    const phase = Pipeline.getPhases().find(p => p.id === 'character-generation');
    const handler = phaseHandlers['character-generation'];

    const result = await handler.after(pipeline, phase, {});

    assert.ok(result, 'handler 应返回结果 (不 fatal)');
    assert.ok(result.summary.degraded === true, 'summary.degraded 应为 true');
    assert.ok(result.summary.characters.length > 0, '应包含角色列表 (空候选)');
    assert.ok(result.metrics.degraded === true, 'metrics.degraded 应为 true');

    // 验证文件落盘
    const candidatesPath = join(tmpDir, 'character-candidates.json');
    assert.ok(existsSync(candidatesPath), 'character-candidates.json 应落盘');
    const parsed = JSON.parse(await readFile(candidatesPath, 'utf-8'));
    assert.ok(parsed.degraded === true, '文件 degraded 标记应 true');
    assert.ok(parsed._phase === 'character-generation');
    assert.ok(!parsed._stub, '不应再有 _stub 标记');
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 7: 完整 handler — 真实路径 (mock JimengClient)
// ═══════════════════════════════════════════════════════════════════
describe('Phase 14: handler 真实路径 (mock JimengClient)', () => {
  let tmpDir;
  let pipeline;
  let originalJimengClient;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'phase14-real-'));
    pipeline = new Pipeline({
      workdir: tmpDir,
      config: createRequirementTemplate({
        title: '真实路径测试', genre: '科幻',
        characters: [{
          name: '小明', description: '短发大眼',
          costumes: ['校服', '便装'],
        }],
      }),
      episode: 'REAL-EP',
    });

    // 通过模块 mock 替换 JimengClient: 顶层 import 已经把 JimengClient 解析
    // 由于 handler 内部 new JimengClient(baseUrl), 我们改用环境变量 + 启动一个 fake HTTP server
    // 或更简单: 替换 prototype 方法 (因为 handler 内部 new 的也是同一个类)
    const { JimengClient } = await import('../../lib/jimeng-client.js');
    originalJimengClient = JimengClient;

    // Mock 全局 JimengClient.prototype 方法
    JimengClient.prototype.ping = async () => true;
    JimengClient.prototype.generateImage = async (opts) => {
      const idx = Math.floor(Math.random() * 10000);
      return [{ url: `http://mock/l1-${idx}.png`, seed: idx }];
    };
    JimengClient.prototype.compositions = async (prompt, opts) => {
      // 校验调用方传入了 L1 锚点
      if (!opts.images?.length) throw new Error('compositions 需参考图');
      return [{ url: `http://mock/l2-${Date.now()}-${Math.random()}.png`, seed: 999 }];
    };

    // 同时 mock LLM 评分 (callLLMJson) — 通过设置 hermes-adapter 内部降级
    // 由于 scorer 在 handler 内部通过动态 import hermes-adapter 调用,
    // 我们通过让 fetch 返回假数据来 mock callLLMJson 的底层调用
    // 最简单: 设 HERMES_URL 为空,触发降级 (返回 0.75 分)
  });

  after(async () => {
    // 恢复 JimengClient 原型
    const { JimengClient } = await import('../../lib/jimeng-client.js');
    delete JimengClient.prototype.ping;
    delete JimengClient.prototype.generateImage;
    delete JimengClient.prototype.compositions;
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('正常路径生成 L1 + L2 + 落盘 character-candidates.json', async () => {
    // 关闭 Hermes, 让 scorer 走降级 (0.75 分 — 通过阈值)
    delete process.env.HERMES_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    const phase = Pipeline.getPhases().find(p => p.id === 'character-generation');
    const handler = phaseHandlers['character-generation'];

    const result = await handler.after(pipeline, phase, {});

    assert.ok(result, 'handler 应返回结果');
    assert.strictEqual(result.summary.degraded, false, '不应进入 degraded 模式');
    assert.ok(result.summary.characters.length === 1, '应有 1 个角色');

    const charData = result.summary.characters[0];
    assert.ok(charData.name === '小明');
    assert.ok(charData.l1_anchors.length > 0, '应有 L1 锚点');
    assert.ok(charData.l1_anchors.length <= 3, 'L1 最多 3 个');
    assert.ok(charData.l2_costumes.length === 2, '应有 2 套 costume (校服+便装)');

    // character-candidates.json 应含完整 audit trail
    const parsed = JSON.parse(await readFile(join(tmpDir, 'character-candidates.json'), 'utf-8'));
    assert.ok(parsed.characters[0].l1_candidates.length > 0, '应保留全部候选 (audit trail)');
    assert.ok(parsed.characters[0].l1_selected.length > 0, '应保留选定项');
  });

  it('幂等: 第二次运行跳过已有 L1 锚点', async () => {
    // 先记录第一次的锚点
    const firstParsed = JSON.parse(await readFile(join(tmpDir, 'character-candidates.json'), 'utf-8'));
    const firstAnchors = firstParsed.characters[0].l1_anchors.slice();

    // 第二次运行
    const phase = Pipeline.getPhases().find(p => p.id === 'character-generation');
    const handler = phaseHandlers['character-generation'];
    await handler.after(pipeline, phase, {});

    const secondParsed = JSON.parse(await readFile(join(tmpDir, 'character-candidates.json'), 'utf-8'));
    assert.ok(secondParsed.characters[0].l1_reused === true, '应标记为 reused');
    assert.deepEqual(
      secondParsed.characters[0].l1_anchors,
      firstAnchors,
      'L1 锚点应保持不变 (幂等)',
    );
  });

  it('CharacterAssetManager 注册了 L1 manifest 和 L2 manifest', async () => {
    const charactersDir = join(tmpDir, 'assets/characters');
    const assetManager = new CharacterAssetManager(charactersDir);

    // 找到角色 id
    const parsed = JSON.parse(await readFile(join(tmpDir, 'character-candidates.json'), 'utf-8'));
    const charId = parsed.characters[0].id || 'char-1';

    // L1 manifest
    const l1ManifestPath = join(charactersDir, charId, 'L1_identity', 'manifest.json');
    assert.ok(existsSync(l1ManifestPath), 'L1 manifest.json 应存在');
    const l1Manifest = JSON.parse(await readFile(l1ManifestPath, 'utf-8'));
    assert.strictEqual(l1Manifest.level, 'L1');
    assert.strictEqual(l1Manifest.type, 'identity_anchor');
    assert.ok(l1Manifest.images.length > 0);

    // L2 manifests (每个 costume)
    for (const costume of ['校服', '便装']) {
      const l2ManifestPath = join(charactersDir, charId, 'L2_costumes', costume, 'manifest.json');
      assert.ok(existsSync(l2ManifestPath), `L2 manifest for ${costume} 应存在`);
      const l2Manifest = JSON.parse(await readFile(l2ManifestPath, 'utf-8'));
      assert.strictEqual(l2Manifest.level, 'L2');
      assert.strictEqual(l2Manifest.type, 'costume_sheet');
      assert.strictEqual(l2Manifest.costumeId, costume);
      assert.ok(l2Manifest.images.length >= 1);
    }
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 8: handler — 阈值过滤降级 (所有候选 < 0.7)
// ═══════════════════════════════════════════════════════════════════
describe('Phase 14: handler 阈值过滤 (全部低质 -> 角色降级)', () => {
  let tmpDir;
  let pipeline;
  let originalFetch;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'phase14-threshold-'));
    pipeline = new Pipeline({
      workdir: tmpDir,
      config: createRequirementTemplate({
        title: '阈值测试', genre: '科幻',
        characters: [{ name: '低质角色', description: 'x' }],
      }),
      episode: 'THRESHOLD-EP',
    });

    const { JimengClient } = await import('../../lib/jimeng-client.js');
    JimengClient.prototype.ping = async () => true;
    JimengClient.prototype.generateImage = async () => [{ url: `http://mock/low-${Date.now()}.png` }];
    JimengClient.prototype.compositions = async () => [{ url: 'http://mock/l2.png' }];

    // Mock fetch 让 LLM 评分返回低分 (0.3)
    // callLLMJson 走 fetch POST /chat/completions, 我们拦截 ZHIPU 直连请求
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      const body = typeof opts?.body === 'string' ? opts.body : '';
      // 拦截 ZHIPU chat/completions 调用 (含评分 prompt)
      if (urlStr.includes('/chat/completions') && body.includes('候选面部特写')) {
        // 注意: content 中不能含数组 (callLLMJson 的 [\s\S]* 正则会优先匹配数组)
        const scoreJson = '{"score": 0.3, "details": "mock 低分"}';
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{
              message: { content: scoreJson },
            }],
          }),
          text: async () => JSON.stringify({
            choices: [{ message: { content: scoreJson } }],
          }),
        };
      }
      // 其他 fetch 走原实现
      return originalFetch(url, opts);
    };
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    const { JimengClient } = await import('../../lib/jimeng-client.js');
    delete JimengClient.prototype.ping;
    delete JimengClient.prototype.generateImage;
    delete JimengClient.prototype.compositions;
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('所有候选低于阈值时该角色进入 degraded (不 fatal)', async () => {
    const phase = Pipeline.getPhases().find(p => p.id === 'character-generation');
    const handler = phaseHandlers['character-generation'];

    const result = await handler.after(pipeline, phase, {});

    assert.ok(result, 'handler 不应 fatal');
    const charData = result.summary.characters[0];
    assert.ok(charData.degraded === true, '角色级应 degraded');
    assert.strictEqual(charData.l1_anchors.length, 0, '无候选通过阈值时无 anchors');
    assert.ok(charData.l1_candidates.length > 0, '但应保留全部候选 audit trail');
    assert.ok(
      charData.l1_candidates.every(c => c.score < 0.7),
      '所有候选分数应 < 0.7',
    );
  });
});
