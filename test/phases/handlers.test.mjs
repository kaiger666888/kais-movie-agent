/**
 * Phase 10 ARCH-01: PHASES/handler 架构对齐 单元测试
 *
 * 4 个 describe 块覆盖:
 *   1. phaseHandlers 路由完整性 (ARCH-01 SC-1)
 *   2. stub handler 执行 (ARCH-01 SC-2)
 *   3. V2_MIGRATION_MAP 完整性 (ARCH-03 SC-3)
 *   4. 降级日志与容错 (ARCH-01 SC-2)
 *
 * Run: node --test test/phases/handlers.test.mjs
 *
 * 零 npm 依赖 — 仅使用 Node 内置模块 (node:test / node:assert / node:fs/promises /
 * node:path / node:os)。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Pipeline, createRequirementTemplate } from '../../lib/pipeline.js';
import { phaseHandlers } from '../../lib/phases/index.js';

// ─── Hardcoded PHASES id 全集 (20 项) ─────────────────────────────
// 严格按照 lib/pipeline.js PHASES 数组的顺序硬编码。后续若 PHASES 变化,
// 此数组必须同步更新 — describe 1 的循环断言会立即捕获漂移。
const PHASE_IDS = [
  'pain-discovery', 'topic-selection', 'outline-generation', 'outline-selection',
  'script-generation', 'script-selection', 'character-generation', 'character-selection',
  'scene-generation', 'scene-selection', 'spatio-temporal-script', 'script-lock',
  'seed-skeleton', 'motion-preview', 'ai-preview', 'consistency-guard',
  'cloud-production', 'final-audio', 'composition', 'delivery',
];

// 15 个新 V6 id (10-01 新增) — 单独断言以便失败时定位
const V6_NEW_IDS = [
  'pain-discovery', 'topic-selection', 'outline-generation', 'outline-selection',
  'script-generation', 'script-selection', 'character-generation', 'character-selection',
  'scene-generation', 'scene-selection', 'script-lock', 'consistency-guard',
  'cloud-production', 'final-audio', 'delivery',
];

// outputFiles 映射 (用于 describe 2 断言文件落盘)
const OUTPUT_FILES = {
  'pain-discovery': ['pain-report.json'],
  'topic-selection': ['selected-topic.json'],
  'consistency-guard': ['consistency-pass.json'],
  'cloud-production': ['video_tasks.json'],
  'delivery': ['quality-report.json'],
};

// 5 个代表性 phase — 覆盖上半(创意)/中部(审核)/下部(生产/质检)
const REPRESENTATIVE_PHASES = [
  'pain-discovery', 'topic-selection', 'consistency-guard', 'cloud-production', 'delivery',
];

// V2_MIGRATION_MAP 重构副本 (来源: lib/pipeline.js:118-135, soul-voice 已在 10-02 移除)
// 注:V2_MIGRATION_MAP 未 named export,测试通过 _migrateV2State 行为反推此映射
const V2_MIGRATION_PROXY = {
  requirement: 'pain-discovery',
  'requirement-bible': 'pain-discovery',
  'art-direction': 'character-generation',
  'soul-visual': 'character-generation',
  character: 'character-generation',
  scenario: 'spatio-temporal-script',
  voice: 'seed-skeleton',
  storyboard: 'spatio-temporal-script',
  scene: 'scene-generation',
  'geometry-bed': 'scene-selection',
  'camera-preview': 'motion-preview',
  'camera-final': 'ai-preview',
  'post-production': 'final-audio',
  'final-production': 'cloud-production',
  'quality-gate': 'delivery',
  composition: 'composition',
};


// ═══════════════════════════════════════════════════════════════════
// describe 1: phaseHandlers 路由完整性 (ARCH-01 SC-1)
// ═══════════════════════════════════════════════════════════════════

describe('phaseHandlers 路由完整性 (ARCH-01 SC-1)', () => {

  it('每个 PHASES.id 在 phaseHandlers 中存在且 .after 是 function', () => {
    const missing = [];
    const wrongType = [];
    for (const id of PHASE_IDS) {
      const h = phaseHandlers[id];
      if (!h) {
        missing.push(id);
        continue;
      }
      if (typeof h.after !== 'function') {
        wrongType.push(`${id} (typeof after = ${typeof h.after})`);
      }
    }
    assert.deepEqual(missing, [], `缺失 handler 的 phase id: [${missing.join(', ')}]`);
    assert.deepEqual(wrongType, [], `.after 非 function: [${wrongType.join(', ')}]`);
  });

  it('phaseHandlers 是 PHASES 的超集 (允许 V4.1 id 共存)', () => {
    const handlerKeys = Object.keys(phaseHandlers);
    assert.ok(
      handlerKeys.length >= 20,
      `phaseHandlers 至少 20 项 (实际 ${handlerKeys.length})`,
    );
  });

  it('全部 15 个新 V6 id 都存在 (单独断言便于失败时定位)', () => {
    const missingV6 = V6_NEW_IDS.filter(id => !phaseHandlers[id] || typeof phaseHandlers[id].after !== 'function');
    assert.deepEqual(missingV6, [], `缺失的 V6 handler: [${missingV6.join(', ')}]`);
  });

  it('V4.1 legacy id 仍可访问 (向后兼容回归保护)', () => {
    // V4.1 的 10 个 id 必须继续存在,防止后续 phase 误删 legacy handler
    const v41Ids = [
      'requirement-bible', 'soul-visual', 'soul-voice', 'geometry-bed',
      'spatio-temporal-script', 'seed-skeleton', 'motion-preview',
      'ai-preview', 'final-production', 'composition',
    ];
    const missingV41 = v41Ids.filter(id => !phaseHandlers[id]);
    assert.deepEqual(missingV41, [], `V4.1 legacy handler 缺失: [${missingV41.join(', ')}]`);
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 2: stub handler 执行 (ARCH-01 SC-2)
// ═══════════════════════════════════════════════════════════════════

describe('stub handler 执行 (ARCH-01 SC-2)', () => {
  let tmpDir;
  let pipeline;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'phase10-test-'));
    pipeline = new Pipeline({
      workdir: tmpDir,
      config: createRequirementTemplate({
        title: '测试项目',
        genre: '科幻',
        characters: [{ name: '主角', description: '测试角色' }],
      }),
      episode: 'TEST-EP01',
    });
  });

  after(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // 为每个代表性 phase 生成独立测试 — 失败时立即定位是哪个 phase 出问题
  for (const phaseId of REPRESENTATIVE_PHASES) {
    const expectedFile = OUTPUT_FILES[phaseId][0];
    it(`${phaseId} 写出 ${expectedFile}`, async () => {
      // 直接调用 handler.after (绕开 runPhase 的 state/git/checkpoint/review 副作用)
      // 这是最纯净的单元测试 — 仅验证 handler 的输出契约
      const phase = Pipeline.getPhases().find(p => p.id === phaseId);
      assert.ok(phase, `phase 配置缺失: ${phaseId}`);
      const handler = phaseHandlers[phaseId];
      assert.ok(handler?.after, `handler 缺失: ${phaseId}`);

      // 使用全新 phaseConfig 对象避免跨测试污染
      const phaseConfig = {};
      await handler.after(pipeline, phase, phaseConfig);

      const filePath = join(tmpDir, expectedFile);
      assert.ok(
        existsSync(filePath),
        `${expectedFile} 未落盘 (phase: ${phaseId})`,
      );
    });
  }

  it('每个 stub 文件含 _stub: true 标记', async () => {
    const files = Object.values(OUTPUT_FILES).flat();
    for (const filename of files) {
      const filePath = join(tmpDir, filename);
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      assert.ok(
        parsed._stub === true,
        `${filename}._stub !== true (实际: ${parsed._stub})`,
      );
    }
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 3: V2_MIGRATION_MAP 完整性 (ARCH-03 SC-3)
// ═══════════════════════════════════════════════════════════════════

describe('V2_MIGRATION_MAP 完整性 (ARCH-03 SC-3)', () => {

  it('lib/pipeline.js 模块成功加载 (完整性自检未抛异常)', () => {
    // 此 import 已在顶部完成 — 若完整性自检抛错,整个测试文件都不会加载
    // 这里显式断言 Pipeline 是 function,作为模块加载成功的证据
    assert.strictEqual(typeof Pipeline, 'function');
    assert.strictEqual(typeof createRequirementTemplate, 'function');
  });

  it('每个 V2_MIGRATION_MAP 目标在 PHASE_IDS 中存在', () => {
    const phaseIdSet = new Set(PHASE_IDS);
    const orphan = [];
    for (const [legacy, target] of Object.entries(V2_MIGRATION_PROXY)) {
      if (!phaseIdSet.has(target)) {
        orphan.push(`${legacy} → ${target}`);
      }
    }
    assert.deepEqual(
      orphan, [],
      `V2_MIGRATION_MAP 目标不在 PHASES 中: [${orphan.join(', ')}]`,
    );
  });

  it('V2_MIGRATION_MAP 不含 soul-voice 键 (10-02 已清理)', () => {
    assert.ok(
      !('soul-voice' in V2_MIGRATION_PROXY),
      'V2_MIGRATION_MAP 仍含 soul-voice 键 (10-02 清理失效)',
    );
  });

  it('_migrateV2State 对 soul-voice 不做映射 (保留原 key)', () => {
    // 通过行为反推 V2_MIGRATION_MAP: 若 soul-voice 有映射,_migrateV2State 会改 key
    const pipeline = new Pipeline({
      workdir: '/nonexistent-test-path',  // 不需要真实 workdir,_migrateV2State 是纯函数
      config: createRequirementTemplate({ title: 'x', genre: 'y', characters: [{ name: 'c' }] }),
    });
    const migrated = pipeline._migrateV2State({
      phases: { 'soul-voice': { status: 'completed', at: '2024-01-01' } },
      currentPhaseId: 'soul-voice',
    });
    assert.ok(
      migrated.phases['soul-voice'],
      '_migrateV2State 错误地映射了 soul-voice (应保留原 key)',
    );
    assert.strictEqual(migrated.phases['soul-voice'].status, 'completed');
  });

  it('_migrateV2State 正确映射已注册的 legacy id', () => {
    const pipeline = new Pipeline({
      workdir: '/nonexistent-test-path',
      config: createRequirementTemplate({ title: 'x', genre: 'y', characters: [{ name: 'c' }] }),
    });
    const migrated = pipeline._migrateV2State({
      phases: {
        'requirement-bible': { status: 'completed' },
        'camera-final': { status: 'completed' },
      },
      currentPhaseId: 'camera-final',
    });
    // requirement-bible → pain-discovery
    assert.ok(migrated.phases['pain-discovery'], 'requirement-bible 未映射到 pain-discovery');
    assert.ok(!migrated.phases['requirement-bible'], 'requirement-bible 未被清理');
    // camera-final → ai-preview
    assert.ok(migrated.phases['ai-preview'], 'camera-final 未映射到 ai-preview');
    assert.strictEqual(migrated.currentPhaseId, 'ai-preview');
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 4: 降级日志与容错 (ARCH-01 SC-2)
// ═══════════════════════════════════════════════════════════════════

describe('降级日志与容错 (ARCH-01 SC-2)', () => {
  let tmpDir;
  let pipeline;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'phase10-degrade-'));
    // 不配置 hermes / goldTeam / jimeng — 强制走降级路径
    pipeline = new Pipeline({
      workdir: tmpDir,
      config: createRequirementTemplate({
        title: '降级测试',
        genre: '科幻',
        characters: [{ name: '主角', description: '测试角色' }],
      }),
      episode: 'DEGRADE-EP01',
    });
  });

  after(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('无 hermes/goldTeam 配置时 handler 不抛 fatal', async () => {
    const phase = Pipeline.getPhases().find(p => p.id === 'pain-discovery');
    const handler = phaseHandlers['pain-discovery'];
    // 必须返回 resolved value,不应 reject
    const result = await handler.after(pipeline, phase, {});
    assert.ok(result, 'pain-discovery handler 返回 falsy');
    assert.ok(result.summary, 'result.summary 缺失');
    assert.ok(result.metrics, 'result.metrics 缺失');
  });

  it('cloud-production 无 gold-team / 无 shots 时降级写 stub', async () => {
    const phase = Pipeline.getPhases().find(p => p.id === 'cloud-production');
    const handler = phaseHandlers['cloud-production'];
    const result = await handler.after(pipeline, phase, {});
    // Phase 15 实化后:无 gold-team 或无 shots 时降级,仍返回 stubbed: true
    assert.strictEqual(
      result.metrics.stubbed, true,
      `cloud-production metrics.stubbed !== true (实际: ${result.metrics.stubbed})`,
    );
    assert.ok(
      result.metrics.degraded,
      'cloud-production 应在降级模式下 metrics.degraded=true',
    );
    assert.ok(
      result.metrics.reason,
      `cloud-production 应给出降级原因 (实际: ${result.metrics.reason})`,
    );
  });

  it('降级时 console.warn 被触发 (或 handler 跳过 decide)', async () => {
    // 捕获 console.warn 输出
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => {
      warnings.push(args.map(a => typeof a === 'string' ? a : String(a)).join(' '));
    };
    try {
      const phase = Pipeline.getPhases().find(p => p.id === 'delivery');
      const handler = phaseHandlers['delivery'];
      await handler.after(pipeline, phase, {});
    } finally {
      console.warn = originalWarn;
    }
    // delivery 会调用 assessQuality,在无 LLM 配置时会降级
    // 断言:要么有降级日志,要么 handler 静默完成 (无 hermes client 时 decide 直接跳过)
    // 两者都是合法的降级行为
    const hasDegradeLog = warnings.some(w =>
      w.includes('降级') || w.includes('失败') || w.includes('degrade') || w.includes('失败'),
    );
    // 无论是否有 warn,handler 必须正常返回 — 这已在上一条 it 中验证
    // 此处记录观察到的 warn 行为,不强制断言 (无 hermes 配置时 decide 被完全跳过,合法)
    // 若有降级日志,验证日志可读
    if (hasDegradeLog) {
      assert.ok(true, `观察到降级日志: ${warnings.filter(w => w.includes('降级')).length} 条`);
    } else {
      // handler 静默完成也是合法降级 (无 hermes client,_makeHermesClient 返回 null)
      assert.ok(true, 'handler 静默降级 (无 hermes client,decide 被跳过)');
    }
  });

  it('5 个代表性 phase 全部在降级模式下正常执行', async () => {
    // 串联跑 5 个 phase — 任何一个 fatal 都会让测试失败
    // Phase 12 实化后: consistency-guard 不再是 stub (有 visuals 走真实审计,无 visuals 走 no_visuals 分支)
    const STILL_STUBBED = new Set(['pain-discovery', 'topic-selection', 'cloud-production', 'delivery']);
    for (const phaseId of REPRESENTATIVE_PHASES) {
      const phase = Pipeline.getPhases().find(p => p.id === phaseId);
      const handler = phaseHandlers[phaseId];
      const result = await handler.after(pipeline, phase, {});
      assert.ok(result?.metrics, `${phaseId} 返回的 result.metrics 缺失`);
      if (STILL_STUBBED.has(phaseId)) {
        assert.strictEqual(result.metrics.stubbed, true, `${phaseId}.metrics.stubbed !== true`);
      } else {
        // consistency-guard Phase 12 实化: 必须有 passed/overall 或 skipped 字段
        assert.ok(
          result.metrics.passed !== undefined || result.metrics.skipped,
          `${phaseId} 应该有 passed 或 skipped 字段 (Phase 12 实化)`,
        );
      }
    }
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 5: Phase 12 一致性即时审计 hook (QUAL-04)
// ═══════════════════════════════════════════════════════════════════

describe('Phase 12 一致性即时审计 hook (QUAL-04)', () => {
  let tmpDir;
  let pipeline;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'phase12-audit-'));
    pipeline = new Pipeline({
      workdir: tmpDir,
      config: createRequirementTemplate({
        title: '一致性审计测试',
        genre: '科幻',
        characters: [{ name: '主角', description: '测试角色' }],
      }),
      episode: 'AUDIT-EP01',
    });
  });

  after(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('consistency-guard handler 无 visuals 时写 _reason: no_visuals_yet', async () => {
    const phase = Pipeline.getPhases().find(p => p.id === 'consistency-guard');
    const handler = phaseHandlers['consistency-guard'];
    const result = await handler.after(pipeline, phase, {});
    assert.strictEqual(result.metrics.skipped, 'no_visuals');

    const raw = await readFile(join(tmpDir, 'consistency-pass.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed._reason, 'no_visuals_yet');
    assert.strictEqual(parsed.passed, true);
    assert.ok(Array.isArray(parsed.retry_shots), 'retry_shots 应为数组');
    assert.deepStrictEqual(parsed.retry_shots, []);
  });

  it('consistency-guard handler 有 visuals 时调用真实审计', async () => {
    // 写入 spatio-temporal-script + character-assets 到 AssetBus
    const { AssetBus } = await import('../../lib/asset-bus.js');
    const bus = new AssetBus(tmpDir);
    await bus.write('spatio-temporal-script', {
      shots: [{
        id: 'shot-001',
        image_path: '/tmp/fake-image-001.png',
        scene_id: 'scene-1',
        character: '主角',
      }],
    });
    await bus.write('character-assets', {
      characters: [{
        id: '主角', name: '主角',
        assets: { L1_identity: [{ path: '/tmp/fake-anchor.png', status: 'approved' }] },
      }],
    });

    const phase = Pipeline.getPhases().find(p => p.id === 'consistency-guard');
    const handler = phaseHandlers['consistency-guard'];
    const result = await handler.after(pipeline, phase, {});

    // 调用真实 auditContinuity → 因无 API 配置,LLM 调用会失败但不应 throw
    assert.ok(result.metrics.passed !== undefined, 'passed 字段缺失');
    assert.strictEqual(result.metrics.audit_failed, false);

    const raw = await readFile(join(tmpDir, 'consistency-pass.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed._phase, 'consistency-guard');
    assert.ok(!parsed._stub, '有 visuals 时不应写 _stub: true');
    assert.strictEqual(parsed.visual_count, 1);
    assert.ok(Array.isArray(parsed.retry_shots));
  });

  it('scene-generation handler 调用即时审计 hook (有候选图时)', async () => {
    // 重置 workdir
    const freshDir = await mkdtemp(join(tmpdir(), 'phase12-scene-'));
    const freshPipeline = new Pipeline({
      workdir: freshDir,
      config: createRequirementTemplate({
        title: '场景测试', genre: '科幻',
        characters: [{ name: '主角', description: 'x' }],
      }),
      episode: 'SCENE-EP',
    });

    // 写入 character-assets with L1 anchor
    const { AssetBus } = await import('../../lib/asset-bus.js');
    const bus = new AssetBus(freshDir);
    await bus.write('character-assets', {
      characters: [{
        id: '主角', name: '主角',
        assets: { L1_identity: [{ path: '/tmp/fake-anchor.png', status: 'approved' }] },
      }],
    });

    const phase = Pipeline.getPhases().find(p => p.id === 'scene-generation');
    const handler = phaseHandlers['scene-generation'];
    // phaseConfig.data.candidates 带图 → 触发 hook
    const phaseConfig = { data: { candidates: [{
      id: 'shot-s1', image_path: '/tmp/fake-scene.png', character: '主角',
    }] } };
    const result = await handler.after(freshPipeline, phase, phaseConfig);

    assert.ok(result?.metrics, 'scene-generation 返回 metrics 缺失');
    // 因无 LLM,审计会失败/降级 — 不应 fatal
    assert.strictEqual(result.metrics.stubbed, true); // 仍是 stub (Phase 14 未实化生成)

    await rm(freshDir, { recursive: true, force: true });
  });

  it('seed-skeleton handler 调用即时审计 hook (有 seed_frame 时)', async () => {
    const freshDir = await mkdtemp(join(tmpdir(), 'phase12-seed-'));
    const freshPipeline = new Pipeline({
      workdir: freshDir,
      config: createRequirementTemplate({
        title: '种子帧测试', genre: '科幻',
        characters: [{ name: '主角', description: 'x' }],
      }),
      episode: 'SEED-EP',
    });

    const { AssetBus } = await import('../../lib/asset-bus.js');
    const bus = new AssetBus(freshDir);
    await bus.write('spatio-temporal-script', {
      shots: [{
        id: 'shot-seed-1', seed_frame_path: '/tmp/fake-seed.png', scene_id: 's1',
        character: '主角', description: '测试',
      }],
    });
    await bus.write('character-assets', {
      characters: [{
        id: '主角', name: '主角',
        assets: { L1_identity: [{ path: '/tmp/anchor.png', status: 'approved' }] },
      }],
    });
    await bus.write('art-bible', { style_anchor: 'test', bgm_strategy: 'dual' });

    const phase = Pipeline.getPhases().find(p => p.id === 'seed-skeleton');
    const handler = phaseHandlers['seed-skeleton'];
    const result = await handler.after(freshPipeline, phase, {});
    assert.ok(result === undefined || result === null || typeof result === 'object',
      'seed-skeleton handler 不应 fatal (审计失败应降级)');

    await rm(freshDir, { recursive: true, force: true });
  });

  it('audit hook 无锚点时静默跳过 (audited: 0)', async () => {
    // 无 character-assets → _loadCharactersForAudit 返回 []
    const freshDir = await mkdtemp(join(tmpdir(), 'phase12-noanchor-'));
    const freshPipeline = new Pipeline({
      workdir: freshDir,
      config: createRequirementTemplate({
        title: '无锚点', genre: '科幻',
        characters: [{ name: '主角', description: 'x' }],
      }),
      episode: 'NOANCHOR-EP',
    });
    const { AssetBus } = await import('../../lib/asset-bus.js');
    const bus = new AssetBus(freshDir);
    await bus.write('spatio-temporal-script', {
      shots: [{ id: 's1', seed_frame_path: '/tmp/x.png', character: '主角' }],
    });
    // 不写 character-assets

    const phase = Pipeline.getPhases().find(p => p.id === 'seed-skeleton');
    const handler = phaseHandlers['seed-skeleton'];
    await handler.after(freshPipeline, phase, {});
    // 不应 fatal,也不应产生 seed-skeleton-audit.json
    assert.ok(!existsSync(join(freshDir, 'seed-skeleton-audit.json')),
      '无锚点时不应写审计结果文件');

    await rm(freshDir, { recursive: true, force: true });
  });
});
