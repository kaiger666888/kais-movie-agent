/**
 * Quick Task 260702-q6l: PipelineReflector unit tests
 *
 * Covers:
 *   - module load
 *   - aggregate() with mocked DB + local sources, and with dbHelper absent
 *   - aggregate() with missing local files (silent skip)
 *   - reflect() parses fixed LLM JSON output
 *   - reflect() throws on malformed LLM output
 *   - storeSuggestions() writes JSONL with status:'pending', createdAt, id
 *   - readPendingSuggestions() filters status==='pending'
 *   - approveSuggestion() for prompt_modification writes prompt-overrides.json
 *   - approveSuggestion() for threshold_adjustment writes threshold override
 *   - approveSuggestion() for parameter_change/workflow_redesign → applied only
 *   - approveSuggestion() unknown id throws
 *   - rejectSuggestion() updates status with reason
 *   - readAppliedSuggestions()
 *   - run() end-to-end returns suggestion count
 *
 * Run: node --test test/pipeline-reflector.test.mjs
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PipelineReflector } from '../lib/pipeline-reflector.js';

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'q6l-reflector-'));
}

/** Build an in-memory dbHelper stub mimicking knex query builder chains. */
function makeDbHelper(tables) {
  return (tableName) => {
    const rows = tables[tableName] || [];
    // Minimal builder: supports .where(prop, val), .andWhere(prop, val),
    // .orderBy(), .select() (ignored), .first() (returns first match or undefined),
    // and terminal await (returns array).
    let predicates = [];
    let order = null;
    let firstOnly = false;
    const applyFilter = (arr) => arr.filter((r) => predicates.every(([k, v]) => r[k] === v));
    const builder = {
      where(kOrObj, v) {
        if (typeof kOrObj === 'string') predicates.push([kOrObj, v]);
        else if (kOrObj && typeof kOrObj === 'object') {
          for (const [k, v] of Object.entries(kOrObj)) predicates.push([k, v]);
        }
        return builder;
      },
      andWhere(k, v) { predicates.push([k, v]); return builder; },
      orderBy() { return builder; },
      select() { return builder; },
      first() { firstOnly = true; return builder; },
      then(resolve, reject) {
        try {
          const filtered = applyFilter(rows);
          const out = firstOnly ? filtered[0] : filtered;
          return Promise.resolve(out).then(resolve, reject);
        } catch (e) { return Promise.reject(e).then(undefined, reject); }
      },
    };
    return builder;
  };
}

describe('PipelineReflector', () => {
  let tmpDir;

  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  describe('module load', () => {
    it('PipelineReflector is a class and constructs', () => {
      assert.strictEqual(typeof PipelineReflector, 'function');
      const r = new PipelineReflector(tmpDir);
      assert.ok(r instanceof PipelineReflector);
    });
  });

  describe('aggregate()', () => {
    it('groups DB + local sources by phase with dbHelper', async () => {
      // Seed local files
      const assetsDir = join(tmpDir, '.pipeline-assets');
      await mkdir(assetsDir, { recursive: true });
      await writeFile(join(assetsDir, 'failed-shots.json'), JSON.stringify({
        failures: [{ shot_id: 'p5_render-shot-001', error: 'oom', timestamp: '2026-01-01', run_id: 'r1' }],
        version: 1,
      }));
      await writeFile(join(assetsDir, 'evaluations.json'), JSON.stringify([
        { task_id: 't1', phase: 'p5_render', task_type: 'render', gpu_time_sec: 60, success: true, retry_count: 0, ai_quality_score: 80 },
      ]));
      await writeFile(join(assetsDir, 'creative-history.json'), JSON.stringify({
        shots: [{ shot_id: 'p5_render-shot-001', source_hash: 'a', derived_from: [], content_hash: 'h', timestamp: '2026-01-01' }],
        version: 1,
      }));

      const dbHelper = makeDbHelper({
        kv_assetFeedback: [
          { id: 'fb1', assetId: 'p5_render-shot-001', projectId: 1, score: 0.3, verdict: 'reject', content: 'bad', tags: '[]', source: 'human', reviewer: 'op', status: 'open', createdAt: 1 },
        ],
        kv_audit: [
          { id: 'a1', projectId: 1, action: 'review:reject', result: 'rejected', detail: '[p5_render] reviewId=r1 shotId=p5_render-shot-001 feedback="bad"', createTime: 2 },
        ],
        o_agentWorkData: [
          { projectId: '1', key: 'reviewStatus-1', data: JSON.stringify({ n1: { reviewStatus: 'rejected', rejectReason: 'blurry', isWinner: false } }) },
        ],
      });

      const r = new PipelineReflector(tmpDir, { dbHelper, projectId: 1, episodeId: 'ep1' });
      const agg = await r.aggregate();

      assert.ok(agg.byPhase);
      assert.ok(agg.byPhase['p5_render'], 'phase p5_render should be present');
      const phase = agg.byPhase['p5_render'];
      assert.ok(Array.isArray(phase.rejects));
      assert.ok(Array.isArray(phase.evaluations));
      assert.ok(Array.isArray(phase.failures));
      assert.ok(Array.isArray(phase.creativeHistory));
      assert.ok(Array.isArray(phase.feedback));
      assert.ok(Array.isArray(phase.reviewStatus));
      assert.ok(phase.failures.length >= 1, 'at least one failure');
      assert.ok(phase.evaluations.length >= 1);
      assert.ok(phase.feedback.length >= 1);
      assert.ok(agg.crossPhase, 'crossPhase present');
    });

    it('still aggregates local sources when dbHelper absent (no throw)', async () => {
      const assetsDir = join(tmpDir, '.pipeline-assets');
      await mkdir(assetsDir, { recursive: true });
      await writeFile(join(assetsDir, 'failed-shots.json'), JSON.stringify({
        failures: [{ shot_id: 'p3-shot-002', error: 'timeout' }],
        version: 1,
      }));

      const r = new PipelineReflector(tmpDir);  // no dbHelper
      const agg = await r.aggregate();
      assert.doesNotThrow(() => agg);
      const phase = agg.byPhase['p3'];
      assert.ok(phase, 'p3 phase present from shot_id prefix');
      assert.ok(phase.failures.length === 1);
      // DB sources empty arrays, not undefined
      assert.ok(Array.isArray(phase.feedback));
      assert.ok(phase.feedback.length === 0);
    });

    it('silent skip on missing local files (no throw, empty result)', async () => {
      const r = new PipelineReflector(tmpDir);
      const agg = await r.aggregate();
      assert.ok(agg.byPhase);
      assert.ok(agg.crossPhase);
      // No phases present
      assert.strictEqual(Object.keys(agg.byPhase).length, 0);
    });
  });

  describe('reflect()', () => {
    it('parses LLM JSON into reflections[] with required keys', async () => {
      const llmPayload = {
        reflections: [
          {
            id: 'r-001',
            phase: 'p5_render',
            pattern: 'OOM on long shots',
            evidence: ['shot-001 oom', 'shot-002 oom'],
            severity: 'high',
            confidence: 0.8,
            suggestion: {
              type: 'parameter_change',
              target: 'resolution',
              change: 'reduce to 720p',
              expected_impact: 'fewer oom',
            },
          },
        ],
        summary: 'oom pattern detected',
      };

      const r = new PipelineReflector(tmpDir, {
        llmCaller: async () => JSON.stringify(llmPayload),
      });
      const out = await r.reflect({ byPhase: {}, crossPhase: {} });
      assert.ok(Array.isArray(out.reflections));
      assert.strictEqual(out.reflections.length, 1);
      const ref = out.reflections[0];
      for (const key of ['id', 'phase', 'pattern', 'evidence', 'severity', 'confidence']) {
        assert.ok(key in ref, `reflection missing ${key}`);
      }
      assert.ok(ref.evidence instanceof Array);
      assert.ok(ref.suggestion && typeof ref.suggestion === 'object');
      for (const key of ['type', 'target', 'change', 'expected_impact']) {
        assert.ok(key in ref.suggestion, `suggestion missing ${key}`);
      }
      assert.strictEqual(out.summary, 'oom pattern detected');
    });

    it('throws on malformed LLM output (not JSON)', async () => {
      const r = new PipelineReflector(tmpDir, {
        llmCaller: async () => 'sorry I cannot help',
      });
      await assert.rejects(() => r.reflect({ byPhase: {}, crossPhase: {} }), Error);
    });

    it('throws when reflections missing required keys', async () => {
      const r = new PipelineReflector(tmpDir, {
        llmCaller: async () => JSON.stringify({
          reflections: [{ id: 'r1', phase: 'p5' /* missing pattern etc */ }],
          summary: 'x',
        }),
      });
      await assert.rejects(() => r.reflect({ byPhase: {}, crossPhase: {} }), Error);
    });

    it('strips markdown code fences defensively', async () => {
      const payload = { reflections: [{
        id: 'r1', phase: 'p1', pattern: 'pat', evidence: ['e'],
        severity: 'low', confidence: 0.5,
        suggestion: { type: 'prompt_modification', target: 't', change: 'c', expected_impact: 'i' },
      }], summary: 's' };
      const r = new PipelineReflector(tmpDir, {
        llmCaller: async () => '```json\n' + JSON.stringify(payload) + '\n```',
      });
      const out = await r.reflect({ byPhase: {}, crossPhase: {} });
      assert.strictEqual(out.reflections.length, 1);
    });
  });

  describe('storeSuggestions() & readPendingSuggestions()', () => {
    it('writes JSONL rows with status pending, createdAt, id', async () => {
      const r = new PipelineReflector(tmpDir);
      const reflections = [{
        id: 'orig-1', phase: 'p1', pattern: 'pat', evidence: ['e'],
        severity: 'low', confidence: 0.5,
        suggestion: { type: 'prompt_modification', target: 't', change: 'c', expected_impact: 'i' },
      }];
      await r.storeSuggestions(reflections);
      const file = join(tmpDir, '.pipeline-assets', 'reflection-suggestions.jsonl');
      assert.ok(existsSync(file));
      const raw = await readFile(file, 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean).map(JSON.parse);
      assert.strictEqual(lines.length, 1);
      const row = lines[0];
      assert.strictEqual(row.status, 'pending');
      assert.ok(row.createdAt);
      assert.ok(row.id && row.id.startsWith('refl-'));
    });

    it('readPendingSuggestions returns only status=pending rows', async () => {
      const r = new PipelineReflector(tmpDir);
      const file = join(tmpDir, '.pipeline-assets', 'reflection-suggestions.jsonl');
      await mkdir(join(tmpDir, '.pipeline-assets'), { recursive: true });
      await writeFile(file, [
        JSON.stringify({ id: 'refl-a', status: 'pending', createdAt: '2026-01-01', suggestion: { type: 'prompt_modification', target: 't', change: 'c', expected_impact: 'i' } }),
        JSON.stringify({ id: 'refl-b', status: 'applied', createdAt: '2026-01-02', suggestion: { type: 'parameter_change', target: 't', change: 'c', expected_impact: 'i' } }),
        JSON.stringify({ id: 'refl-c', status: 'rejected', createdAt: '2026-01-03', suggestion: { type: 'prompt_modification', target: 't', change: 'c', expected_impact: 'i' } }),
      ].join('\n') + '\n');

      const pending = await r.readPendingSuggestions();
      assert.strictEqual(pending.length, 1);
      assert.strictEqual(pending[0].id, 'refl-a');
    });
  });

  describe('approveSuggestion()', () => {
    it('prompt_modification writes prompt-overrides.json keyed by target', async () => {
      const r = new PipelineReflector(tmpDir);
      const file = join(tmpDir, '.pipeline-assets', 'reflection-suggestions.jsonl');
      await mkdir(join(tmpDir, '.pipeline-assets'), { recursive: true });
      await writeFile(file, JSON.stringify({
        id: 'refl-pm1', status: 'pending', createdAt: '2026-01-01',
        suggestion: { type: 'prompt_modification', target: 'requirement-bible/system', change: 'add foobar', expected_impact: 'better' },
      }) + '\n');

      await r.approveSuggestion('refl-pm1');

      const overridesFile = join(tmpDir, '.pipeline-assets', 'prompt-overrides.json');
      assert.ok(existsSync(overridesFile));
      const overrides = JSON.parse(await readFile(overridesFile, 'utf-8'));
      assert.ok(overrides['requirement-bible/system'], 'override keyed by target');

      // Status updated
      const pending = await r.readPendingSuggestions();
      assert.strictEqual(pending.length, 0, 'no longer pending');

      // Applied file gets an entry
      const applied = await r.readAppliedSuggestions();
      assert.ok(applied.some((a) => a.id === 'refl-pm1' && a.status === 'applied'));
    });

    it('threshold_adjustment writes threshold override (no source change)', async () => {
      const r = new PipelineReflector(tmpDir);
      const file = join(tmpDir, '.pipeline-assets', 'reflection-suggestions.jsonl');
      await mkdir(join(tmpDir, '.pipeline-assets'), { recursive: true });
      await writeFile(file, JSON.stringify({
        id: 'refl-th1', status: 'pending', createdAt: '2026-01-01',
        suggestion: { type: 'threshold_adjustment', target: 'cinematic_score', change: '0.6->0.55', expected_impact: 'more pass' },
      }) + '\n');

      await r.approveSuggestion('refl-th1');
      const overridesFile = join(tmpDir, '.pipeline-assets', 'prompt-overrides.json');
      assert.ok(existsSync(overridesFile));
      const overrides = JSON.parse(await readFile(overridesFile, 'utf-8'));
      assert.ok(overrides.thresholds && overrides.thresholds['cinematic_score']);
      // gate-config.yaml is NOT created by reflector
      assert.ok(!existsSync(join(tmpDir, 'gate-config.yaml')));
    });

    it('parameter_change and workflow_redesign record only (no override write)', async () => {
      const r = new PipelineReflector(tmpDir);
      const file = join(tmpDir, '.pipeline-assets', 'reflection-suggestions.jsonl');
      await mkdir(join(tmpDir, '.pipeline-assets'), { recursive: true });
      await writeFile(file, [
        JSON.stringify({ id: 'refl-pc1', status: 'pending', createdAt: '2026-01-01', suggestion: { type: 'parameter_change', target: 't', change: 'c', expected_impact: 'i' } }),
        JSON.stringify({ id: 'refl-wr1', status: 'pending', createdAt: '2026-01-02', suggestion: { type: 'workflow_redesign', target: 't', change: 'c', expected_impact: 'i' } }),
      ].join('\n') + '\n');

      await r.approveSuggestion('refl-pc1');
      await r.approveSuggestion('refl-wr1');

      // Overrides file may not exist for these types
      const overridesFile = join(tmpDir, '.pipeline-assets', 'prompt-overrides.json');
      assert.ok(!existsSync(overridesFile), 'no override file for non-prompt/threshold types');

      const applied = await r.readAppliedSuggestions();
      assert.strictEqual(applied.length, 2);
    });

    it('throws on unknown id', async () => {
      const r = new PipelineReflector(tmpDir);
      await mkdir(join(tmpDir, '.pipeline-assets'), { recursive: true });
      await writeFile(join(tmpDir, '.pipeline-assets', 'reflection-suggestions.jsonl'), '');
      await assert.rejects(() => r.approveSuggestion('does-not-exist'), Error);
    });
  });

  describe('rejectSuggestion()', () => {
    it('updates status to rejected with reason', async () => {
      const r = new PipelineReflector(tmpDir);
      const file = join(tmpDir, '.pipeline-assets', 'reflection-suggestions.jsonl');
      await mkdir(join(tmpDir, '.pipeline-assets'), { recursive: true });
      await writeFile(file, JSON.stringify({
        id: 'refl-rj1', status: 'pending', createdAt: '2026-01-01',
        suggestion: { type: 'prompt_modification', target: 't', change: 'c', expected_impact: 'i' },
      }) + '\n');

      await r.rejectSuggestion('refl-rj1', 'not applicable');
      const pending = await r.readPendingSuggestions();
      assert.strictEqual(pending.length, 0);

      // Verify the row mutated
      const raw = await readFile(file, 'utf-8');
      const row = JSON.parse(raw.trim().split('\n')[0]);
      assert.strictEqual(row.status, 'rejected');
      assert.strictEqual(row.reason, 'not applicable');
    });
  });

  describe('readAppliedSuggestions()', () => {
    it('returns rows from reflection-applied.jsonl', async () => {
      const r = new PipelineReflector(tmpDir);
      const file = join(tmpDir, '.pipeline-assets', 'reflection-applied.jsonl');
      await mkdir(join(tmpDir, '.pipeline-assets'), { recursive: true });
      await writeFile(file, [
        JSON.stringify({ id: 'a1', status: 'applied', appliedAt: '2026-01-01' }),
        JSON.stringify({ id: 'a2', status: 'applied', appliedAt: '2026-01-02' }),
      ].join('\n') + '\n');

      const applied = await r.readAppliedSuggestions();
      assert.strictEqual(applied.length, 2);
    });

    it('returns empty array when file missing', async () => {
      const r = new PipelineReflector(tmpDir);
      const applied = await r.readAppliedSuggestions();
      assert.deepStrictEqual(applied, []);
    });
  });

  describe('run()', () => {
    it('aggregate -> reflect -> storeSuggestions returns count', async () => {
      const payload = {
        reflections: [
          {
            id: 'r-1', phase: 'p1', pattern: 'pat', evidence: ['e1'],
            severity: 'medium', confidence: 0.7,
            suggestion: { type: 'prompt_modification', target: 't', change: 'c', expected_impact: 'i' },
          },
          {
            id: 'r-2', phase: 'p2', pattern: 'pat2', evidence: ['e2'],
            severity: 'low', confidence: 0.6,
            suggestion: { type: 'parameter_change', target: 't2', change: 'c2', expected_impact: 'i2' },
          },
        ],
        summary: 'two patterns',
      };
      const mockFn = null;
      const r = new PipelineReflector(tmpDir, {
        llmCaller: async () => JSON.stringify(payload),
      });
      const count = await r.run();
      assert.strictEqual(count, 2);
      const pending = await r.readPendingSuggestions();
      assert.strictEqual(pending.length, 2);
    });
  });
});
