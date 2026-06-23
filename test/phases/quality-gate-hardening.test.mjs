/**
 * Phase 18 QUAL-02 单元测试补充 — quality-gate 加固覆盖
 *
 * 覆盖 Phase 13 引入但未直接单测的 QUAL-02 行为:
 *   1. 全维度 LLM 失败 → 抛 QUALITY_GATE_ALL_DIMENSIONS_FAILED
 *   2. 部分维度 null + 部分有分 → 总分按已成功维度归一化到 100
 *   3. 单维度极低分 → decide() 触发一票否决 (veto)
 *   4. 全维度有分 → 正常路径 (approve/warn/reject)
 *
 * Run: node --test test/phases/quality-gate-hardening.test.mjs
 *
 * 零 npm 依赖 — 仅 node:test / node:assert。
 * 不实际调用 LLM API — 直接构造 QualityGate 实例,monkey-patch scoreDimension。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { QualityGate } from '../../lib/quality-gate.js';

// ─── Helper: 构造一个 QualityGate 子类,跳过 _loadConfig 文件依赖 ───
function makeGate(opts = {}) {
  const dir = opts._workdir;
  const gate = new QualityGate({
    workdir: dir,
    config: {},
    configPath: '/nonexistent/path/to/force-defaults.yaml', // 强制使用默认阈值
    ...opts,
  });
  return gate;
}

// Monkey-patch scoreDimension: 直接返回预设分数 (跳过 LLM 调用)
function patchScorer(gate, dimScores) {
  gate.scoreDimension = async (dim) => {
    const s = dimScores[dim];
    if (s === null || s === undefined) return null;
    return {
      score: s,
      reasons: [`test reason for ${dim}`],
      highlights: [],
      suggestions: [],
    };
  };
}


// ═══════════════════════════════════════════════════════════════════
// describe 1: 全维度失败 → QUALITY_GATE_ALL_DIMENSIONS_FAILED
// ═══════════════════════════════════════════════════════════════════

describe('QUAL-02: 全维度 LLM 失败 → QUALITY_GATE_ALL_DIMENSIONS_FAILED', () => {
  let tmpDir;

  before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'qg-all-fail-')); });
  after(async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); });

  it('所有 6 维度评分失败 → 抛 QUALITY_GATE_ALL_DIMENSIONS_FAILED', async () => {
    const gate = makeGate({ _workdir: tmpDir });
    // 6 维度全部返回 null
    patchScorer(gate, {
      hook: null, structure: null, realism: null,
      title_cover: null, duration: null, engagement: null,
    });

    await assert.rejects(
      () => gate.evaluate({ script: null, title: 'test' }),
      (err) => {
        assert.strictEqual(err.code, 'QUALITY_GATE_ALL_DIMENSIONS_FAILED',
          `期望 code=QUALITY_GATE_ALL_DIMENSIONS_FAILED (实际: ${err.code})`);
        assert.match(err.message, /所有维度.*失败/);
        return true;
      },
    );
  });

  it('错误信息说明无法生成可信分数', async () => {
    const gate = makeGate({ _workdir: tmpDir });
    patchScorer(gate, {
      hook: null, structure: null, realism: null,
      title_cover: null, duration: null, engagement: null,
    });
    try {
      await gate.evaluate({});
      assert.fail('应抛 QUALITY_GATE_ALL_DIMENSIONS_FAILED');
    } catch (err) {
      assert.strictEqual(err.code, 'QUALITY_GATE_ALL_DIMENSIONS_FAILED');
      assert.match(err.message, /无法生成可信分数/);
    }
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 2: 部分维度 null + 部分有分 → 总分归一化到 100
// ═══════════════════════════════════════════════════════════════════

describe('QUAL-02: 部分维度 null → 总分按已成功维度归一化到 100', () => {
  let tmpDir;

  before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'qg-partial-')); });
  after(async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); });

  it('3/6 维度有分 (满分),3 维度 null → totalScore = 100 (不是 50)', async () => {
    const gate = makeGate({ _workdir: tmpDir });
    // hook(25) + structure(20) + realism(20) 有分且满分
    // title_cover(15) + duration(10) + engagement(10) = null
    patchScorer(gate, {
      hook: 25, structure: 20, realism: 20,
      title_cover: null, duration: null, engagement: null,
    });

    const result = await gate.evaluate({ title: 'partial-test' });
    // 已成功维度 raw_sum = 25+20+20 = 65, raw_max = 25+20+20 = 65
    // 归一化: 65/65 * 100 = 100
    assert.strictEqual(result.totalScore, 100,
      `期望 totalScore=100 (归一化),实际 ${result.totalScore}`);
  });

  it('3/6 维度部分分 → totalScore 按比例归一化', async () => {
    const gate = makeGate({ _workdir: tmpDir });
    // hook(13/25) + structure(10/20) + realism(10/20)
    // 其余 null
    patchScorer(gate, {
      hook: 13, structure: 10, realism: 10,
      title_cover: null, duration: null, engagement: null,
    });

    const result = await gate.evaluate({ title: 'partial-2' });
    // raw_sum = 13+10+10 = 33, raw_max = 25+20+20 = 65
    // 归一化: 33/65 * 100 ≈ 51
    assert.ok(
      result.totalScore >= 50 && result.totalScore <= 52,
      `期望 totalScore≈51 (33/65 归一化),实际 ${result.totalScore}`,
    );
  });

  it('失败维度 score=null,_failed=true', async () => {
    const gate = makeGate({ _workdir: tmpDir });
    patchScorer(gate, {
      hook: 25, structure: 20, realism: 20,
      title_cover: null, duration: null, engagement: null,
    });
    const result = await gate.evaluate({ title: 'failed-flag' });
    assert.strictEqual(result.dimensions.title_cover.score, null);
    assert.strictEqual(result.dimensions.title_cover._failed, true);
    assert.strictEqual(result.dimensions.hook.score, 25);
    assert.strictEqual(result.dimensions.hook._failed, undefined);
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 3: 单维度极低分 → 一票否决 (veto)
// ═══════════════════════════════════════════════════════════════════

describe('QUAL-02: 单维度极低分 → 一票否决 (veto)', () => {
  let tmpDir;

  before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'qg-veto-')); });
  after(async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); });

  it('hook 维度 5/25 (20%) → veto (低于 critical 40%)', async () => {
    const gate = makeGate({ _workdir: tmpDir });
    // hook 维度极低分,其他都满分
    patchScorer(gate, {
      hook: 5,        // 5/25 = 20% < critical(40%) → veto
      structure: 20, realism: 20, title_cover: 15, duration: 10, engagement: 10,
    });

    const result = await gate.evaluate({ title: 'veto-test' });
    assert.strictEqual(result.decision.action, 'veto',
      `期望 action=veto (hook 20% < critical 40%),实际 ${result.decision.action}`);
    assert.match(result.decision.reason, /黄金3秒钩子.*一票否决/);
    // passed 必须为 false
    assert.strictEqual(result.passed, false);
  });

  it('realism 维度 5/20 (25%) → veto', async () => {
    const gate = makeGate({ _workdir: tmpDir });
    patchScorer(gate, {
      hook: 25, structure: 20,
      realism: 5,   // 5/20 = 25% < 40%
      title_cover: 15, duration: 10, engagement: 10,
    });
    const result = await gate.evaluate({ title: 'veto-realism' });
    assert.strictEqual(result.decision.action, 'veto');
    assert.match(result.decision.reason, /AIGC真实感/);
  });

  it('null 维度不触发 veto (跳过一票否决)', async () => {
    const gate = makeGate({ _workdir: tmpDir });
    // 全部维度 null 不会 veto (会抛 all-failed)
    // 这里: hook=null (跳过 veto 检查),其他高分
    patchScorer(gate, {
      hook: null, structure: 20, realism: 20,
      title_cover: 15, duration: 10, engagement: 10,
    });
    const result = await gate.evaluate({ title: 'no-veto-null' });
    // hook=null 不参与 veto 检查 → 其他全满分 → approve
    assert.notStrictEqual(result.decision.action, 'veto',
      'null 维度不应触发 veto');
  });
});


// ═══════════════════════════════════════════════════════════════════
// describe 4: 全维度有分 → 正常路径 (approve/warn/reject)
// ═══════════════════════════════════════════════════════════════════

describe('QUAL-02: 全维度有分 → 正常门控路径', () => {
  let tmpDir;

  before(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'qg-normal-')); });
  after(async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); });

  it('全维度满分 → approve (totalScore >= warning 75)', async () => {
    const gate = makeGate({ _workdir: tmpDir });
    patchScorer(gate, {
      hook: 25, structure: 20, realism: 20,
      title_cover: 15, duration: 10, engagement: 10,
    });
    const result = await gate.evaluate({ title: 'perfect' });
    assert.strictEqual(result.totalScore, 100);
    assert.strictEqual(result.decision.action, 'approve');
    assert.strictEqual(result.passed, true);
  });

  it('全维度中等分 (65) → warn (在 total-warning 区间)', async () => {
    const gate = makeGate({ _workdir: tmpDir });
    // 按权重比例算出 totalScore=65 (在 65-74 区间 → warn)
    // 65/100 乘以各维度 max: hook=16.25/25, structure=13/20, realism=13/20,
    // title_cover=9.75/15, duration=6.5/10, engagement=6.5/10
    patchScorer(gate, {
      hook: 16, structure: 13, realism: 13,
      title_cover: 10, duration: 7, engagement: 7,
    });
    const result = await gate.evaluate({ title: 'warn-test' });
    // raw_sum = 16+13+13+10+7+7 = 66, raw_max = 100 → 66
    assert.strictEqual(result.totalScore, 66);
    assert.strictEqual(result.decision.action, 'warn',
      `期望 action=warn (66 在 65-74 区间),实际 ${result.decision.action}`);
    assert.strictEqual(result.passed, true, 'warn 也是 passed=true (放行)');
  });

  it('全维度低分 (< 65) → reject', async () => {
    const gate = makeGate({ _workdir: tmpDir });
    // 5 个维度刚过 critical(40%),但总分 < 65 → reject
    patchScorer(gate, {
      hook: 11,       // 44%
      structure: 9,   // 45%
      realism: 9,     // 45%
      title_cover: 7, // 47%
      duration: 4,    // 40%
      engagement: 4,  // 40%
    });
    const result = await gate.evaluate({ title: 'reject-test' });
    // raw_sum = 11+9+9+7+4+4 = 44, raw_max = 100 → 44
    assert.strictEqual(result.totalScore, 44);
    assert.strictEqual(result.decision.action, 'reject',
      `期望 action=reject (44 < 65),实际 ${result.decision.action}`);
    assert.strictEqual(result.passed, false);
  });

  it('generateReport 正确展示 null 维度为 "--/max"', async () => {
    const gate = makeGate({ _workdir: tmpDir });
    patchScorer(gate, {
      hook: 25, structure: null, realism: 20,
      title_cover: 15, duration: 10, engagement: 10,
    });
    const result = await gate.evaluate({ title: 'report-test' });
    assert.match(result.report, /内容结构节奏.*--\/20.*评分失败/);
    assert.match(result.report, /黄金3秒钩子.*25\/25/);
  });
});
