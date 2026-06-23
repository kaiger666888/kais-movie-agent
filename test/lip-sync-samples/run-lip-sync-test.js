#!/usr/bin/env node
/**
 * Phase 22 A2-05: 中文 lip sync 测试集 runner
 *
 * 加载 samples.json, 为每个样本提交 cloud-production 任务, 收集实际 lip sync 分数,
 * 产出 lip-sync-report.json 报告 (含平均分 + 推荐阈值)。
 *
 * 使用方式:
 *   1. operator 补充 test/lip-sync-samples/audio/*.wav + anchors/*.png
 *   2. 设置 GOLD_TEAM_URL 环境变量
 *   3. 运行: node test/lip-sync-samples/run-lip-sync-test.js
 *
 * 输出: test/lip-sync-samples/lip-sync-report.json
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = __dirname;
const SAMPLES_FILE = join(SAMPLES_DIR, 'samples.json');
const REPORT_FILE = join(SAMPLES_DIR, 'lip-sync-report.json');

/**
 * Validate samples.json against the Phase 22 schema.
 * Throws on schema violation.
 */
function validateSamplesSchema(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    throw new Error('samples.json: root must be an object');
  }
  if (data._schema_version !== '1.0') {
    errors.push(`_schema_version must be "1.0" (got ${data._schema_version})`);
  }
  if (!Array.isArray(data.samples)) {
    errors.push('samples must be an array');
    throw new Error(`samples.json schema errors: ${errors.join('; ')}`);
  }
  if (data.samples.length === 0) {
    errors.push('samples array is empty');
  }
  const seenIds = new Set();
  for (let i = 0; i < data.samples.length; i++) {
    const s = data.samples[i];
    const prefix = `samples[${i}]`;
    if (!s.id || typeof s.id !== 'string') errors.push(`${prefix}.id missing or non-string`);
    if (seenIds.has(s.id)) errors.push(`${prefix}.id duplicate: ${s.id}`);
    seenIds.add(s.id);
    if (!s.prompt || typeof s.prompt !== 'string') errors.push(`${prefix}.prompt missing`);
    if (!s.audio_path || typeof s.audio_path !== 'string') errors.push(`${prefix}.audio_path missing`);
    if (!s.anchor_path || typeof s.anchor_path !== 'string') errors.push(`${prefix}.anchor_path missing`);
    if (typeof s.expected_threshold !== 'number' ||
        s.expected_threshold < 0 || s.expected_threshold > 1) {
      errors.push(`${prefix}.expected_threshold must be number in [0,1]`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`samples.json schema errors:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Load + validate samples.json.
 * @returns {Promise<object>}
 */
export async function loadSamples(filePath = SAMPLES_FILE) {
  const raw = await readFile(filePath, 'utf-8');
  const data = JSON.parse(raw);
  validateSamplesSchema(data);
  return data;
}

/**
 * Check that audio/anchor files exist for each sample.
 * Returns array of missing file paths.
 */
async function findMissingAssets(data) {
  const missing = [];
  for (const s of data.samples) {
    const audioAbs = join(SAMPLES_DIR, s.audio_path);
    const anchorAbs = join(SAMPLES_DIR, s.anchor_path);
    try { await access(audioAbs); } catch { missing.push(s.audio_path); }
    try { await access(anchorAbs); } catch { missing.push(s.anchor_path); }
  }
  return missing;
}

/**
 * Submit a single sample to cloud-production via GoldTeamClient and return its score.
 * Stub: real submission path requires gold-team + the operator's project workdir.
 * Returns { id, score, passed, error? }.
 */
async function runSample(sample, goldTeamUrl) {
  if (!goldTeamUrl) {
    return {
      id: sample.id,
      score: null,
      passed: false,
      error: 'GOLD_TEAM_URL not set — skipping submission',
    };
  }
  // Dynamic import to avoid loading gold-team-client when skipped
  const { GoldTeamClient } = await import('../../lib/gold-team-client.js');
  const { CharacterAssetManager } = await import('../../lib/character-asset-manager.js');
  const client = new GoldTeamClient(goldTeamUrl);

  const audioAbs = join(SAMPLES_DIR, sample.audio_path);
  const anchorAbs = join(SAMPLES_DIR, sample.anchor_path);
  const tmpCharDir = await import('node:fs/promises').then(m => m.mkdtemp('lip-sync-char-'));
  try {
    // Register L1 anchor for the sample's character
    const mgr = new CharacterAssetManager(tmpCharDir);
    await mgr.registerIdentityAnchors(sample.character, [anchorAbs]);
    const pack = await mgr.getOmniReferencePack(sample.character, {
      audioRefs: [{ path: audioAbs, character: sample.character }],
    });

    const task = await client.submitTask({
      taskType: 'seedance_omni_reference',
      params: {
        prompt: sample.prompt,
        identity_refs: pack.identityImages,
        audio_refs: pack.audioRefs.map(a => a.path),
        prompt_audio_bindings: pack.promptBindings,
        generate_audio: true,
      },
      priority: 5,
      description: `lip-sync-test:${sample.id}`,
    });
    const completed = await client.waitForTask(task.taskId, {
      pollIntervalMs: 5000,
      timeoutMs: 600000,
    });
    const score = completed?.metrics?.lip_sync_score ?? completed?.output?.lip_sync_score ?? null;
    return {
      id: sample.id,
      score,
      passed: typeof score === 'number' && score >= sample.expected_threshold,
    };
  } catch (e) {
    return { id: sample.id, score: null, passed: false, error: e.message };
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(tmpCharDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Build the report object from per-sample results.
 */
function buildReport(data, results) {
  const validScores = results.filter(r => typeof r.score === 'number').map(r => r.score);
  const sum = validScores.reduce((a, b) => a + b, 0);
  const average = validScores.length > 0 ? sum / validScores.length : null;
  const passedCount = results.filter(r => r.passed).length;
  // Recommended threshold: average - 0.05 (allow 5% margin below mean)
  const suggested = average !== null ? Math.max(0.5, Math.round((average - 0.05) * 100) / 100) : null;
  return {
    _schema_version: '1.0',
    _generatedAt: new Date().toISOString(),
    _language: data._language,
    samples: results,
    summary: {
      total: results.length,
      scored: validScores.length,
      skipped: results.length - validScores.length,
      average_score: average,
      pass_rate: results.length > 0 ? passedCount / results.length : 0,
    },
    recommendation: {
      suggested_threshold: suggested,
      current_default: 0.75,
      note: '建议 lip_sync_threshold = average_score - 0.05 (5% 安全余量)',
    },
  };
}

/**
 * Main runner entry point.
 */
async function main() {
  const goldTeamUrl = process.env.GOLD_TEAM_URL || '';

  console.log('[lip-sync-test] 加载 samples.json ...');
  const data = await loadSamples();
  console.log(`[lip-sync-test] 已加载 ${data.samples.length} 个样本`);

  const missing = await findMissingAssets(data);
  if (missing.length > 0) {
    console.warn(`[lip-sync-test] 警告: ${missing.length} 个资产文件缺失 (operator 待补):`);
    for (const m of missing) console.warn(`  - ${m}`);
    if (!goldTeamUrl) {
      console.warn('[lip-sync-test] GOLD_TEAM_URL 未设置 + 资产缺失 → 仅产出占位报告');
    }
  }

  console.log(`[lip-sync-test] gold-team URL: ${goldTeamUrl || '(未配置)'}`);
  const results = [];
  for (const s of data.samples) {
    process.stdout.write(`[lip-sync-test] 运行 ${s.id} ... `);
    const r = await runSample(s, goldTeamUrl);
    if (r.error) console.log(`SKIP (${r.error})`);
    else console.log(`score=${r.score} passed=${r.passed}`);
    results.push(r);
  }

  const report = buildReport(data, results);
  await writeFile(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`[lip-sync-test] 报告写入: ${REPORT_FILE}`);
  if (report.summary.average_score !== null) {
    console.log(`[lip-sync-test] 平均分: ${report.summary.average_score.toFixed(3)}`);
    console.log(`[lip-sync-test] 推荐阈值: ${report.recommendation.suggested_threshold}`);
  }
}

// Export for unit testing
export { validateSamplesSchema, buildReport, SAMPLES_FILE };

// Run main if invoked directly
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    console.error(`[lip-sync-test] fatal: ${e.message}`);
    process.exit(1);
  });
}
