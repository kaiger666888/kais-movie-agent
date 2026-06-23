/**
 * Phase 22 A2-05: 中文 lip sync 测试集框架测试
 *
 * 覆盖:
 *   1. samples.json schema 验证 (字段齐全 + 类型正确)
 *   2. loadSamples 成功加载合法 samples.json
 *   3. validateSamplesSchema 拒绝不合规数据
 *   4. buildReport 正确聚合分数 → 推荐阈值
 *
 * Run: node --test test/phases/lip-sync-samples.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateSamplesSchema,
  buildReport,
  SAMPLES_FILE,
} from '../lip-sync-samples/run-lip-sync-test.js';
import { readFile } from 'node:fs/promises';

describe('Phase 22 A2-05: samples.json schema 验证', () => {

  it('仓库内 samples.json 通过 schema 验证 (operator 占位合法)', async () => {
    const raw = await readFile(SAMPLES_FILE, 'utf-8');
    const data = JSON.parse(raw);
    // 不抛即为通过
    validateSamplesSchema(data);
    assert.ok(data.samples.length >= 3, '至少 3 个 placeholder 样本');
    assert.strictEqual(data._schema_version, '1.0');
    assert.strictEqual(data._language, 'zh-CN');
  });

  it('每个样本含必填字段: id/prompt/audio_path/anchor_path/expected_threshold', async () => {
    const data = JSON.parse(await readFile(SAMPLES_FILE, 'utf-8'));
    for (const s of data.samples) {
      assert.ok(s.id, 'sample.id 缺失');
      assert.ok(s.prompt, 'sample.prompt 缺失');
      assert.ok(s.audio_path, 'sample.audio_path 缺失');
      assert.ok(s.anchor_path, 'sample.anchor_path 缺失');
      assert.ok(typeof s.expected_threshold === 'number' &&
        s.expected_threshold >= 0 && s.expected_threshold <= 1,
        'expected_threshold 应在 [0,1]');
    }
  });

  it('expected_threshold 都在中文合理范围 [0.65, 0.85]', async () => {
    const data = JSON.parse(await readFile(SAMPLES_FILE, 'utf-8'));
    for (const s of data.samples) {
      assert.ok(s.expected_threshold >= 0.65 && s.expected_threshold <= 0.85,
        `${s.id}.expected_threshold=${s.expected_threshold} 超出 [0.65, 0.85]`);
    }
  });

  it('样本 id 唯一', async () => {
    const data = JSON.parse(await readFile(SAMPLES_FILE, 'utf-8'));
    const ids = data.samples.map(s => s.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'sample id 有重复');
  });
});

describe('Phase 22 A2-05: validateSamplesSchema 拒绝不合规数据', () => {

  it('缺少 _schema_version → 抛错', () => {
    assert.throws(
      () => validateSamplesSchema({ samples: [] }),
      /_schema_version/,
    );
  });

  it('samples 为空数组 → 抛错', () => {
    assert.throws(
      () => validateSamplesSchema({ _schema_version: '1.0', samples: [] }),
      /empty/,
    );
  });

  it('expected_threshold 越界 → 抛错', () => {
    assert.throws(
      () => validateSamplesSchema({
        _schema_version: '1.0',
        samples: [{
          id: 'x', prompt: 'p', audio_path: 'a', anchor_path: 'b',
          expected_threshold: 1.5,
        }],
      }),
      /expected_threshold/,
    );
  });

  it('id 重复 → 抛错', () => {
    assert.throws(
      () => validateSamplesSchema({
        _schema_version: '1.0',
        samples: [
          { id: 'dup', prompt: 'p', audio_path: 'a', anchor_path: 'b', expected_threshold: 0.7 },
          { id: 'dup', prompt: 'p', audio_path: 'a', anchor_path: 'b', expected_threshold: 0.7 },
        ],
      }),
      /duplicate/,
    );
  });
});

describe('Phase 22 A2-05: buildReport 聚合逻辑', () => {

  it('全部分数有效 → 计算 average + suggested_threshold', () => {
    const data = { _language: 'zh-CN' };
    const results = [
      { id: 'a', score: 0.80, passed: true },
      { id: 'b', score: 0.70, passed: true },
      { id: 'c', score: 0.60, passed: false },
    ];
    const report = buildReport(data, results);
    assert.strictEqual(report.summary.total, 3);
    assert.strictEqual(report.summary.scored, 3);
    assert.strictEqual(report.summary.skipped, 0);
    // (0.80 + 0.70 + 0.60) / 3 = 0.7 (rounded)
    assert.ok(Math.abs(report.summary.average_score - 0.7) < 0.001);
    // suggested = avg - 0.05 = 0.65
    assert.strictEqual(report.recommendation.suggested_threshold, 0.65);
    assert.strictEqual(report.summary.pass_rate, 2 / 3);
  });

  it('部分样本跳过 (score=null) → 不计入 average', () => {
    const results = [
      { id: 'a', score: 0.80, passed: true },
      { id: 'b', score: null, passed: false, error: 'no gpu' },
    ];
    const report = buildReport({ _language: 'zh-CN' }, results);
    assert.strictEqual(report.summary.scored, 1);
    assert.strictEqual(report.summary.skipped, 1);
    assert.strictEqual(report.summary.average_score, 0.80);
  });

  it('suggested_threshold 不低于 0.5 下限', () => {
    // avg 很低 → suggested 被 floor 到 0.5
    const results = [
      { id: 'a', score: 0.50, passed: false },
    ];
    const report = buildReport({ _language: 'zh-CN' }, results);
    // 0.50 - 0.05 = 0.45 → floor to 0.5
    assert.strictEqual(report.recommendation.suggested_threshold, 0.5);
  });

  it('全部分数为 null → average=null, suggested=null', () => {
    const results = [
      { id: 'a', score: null, passed: false, error: 'skip' },
    ];
    const report = buildReport({ _language: 'zh-CN' }, results);
    assert.strictEqual(report.summary.average_score, null);
    assert.strictEqual(report.recommendation.suggested_threshold, null);
  });
});
