/**
 * Phase 11 (v2.0) — HermesClient VALID_PHASES alignment with V6 PHASES
 *
 * Verifies:
 *   1. All 20 V6 phase IDs are accepted by HermesClient.decide() (no Invalid phase throw)
 *   2. Unknown phase IDs are still rejected (safety net preserved)
 *   3. VALID_PHASES stays in sync with lib/pipeline.js PHASES (drift detector)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HermesClient } from '../../lib/hermes-client.js';
import { Pipeline } from '../../lib/pipeline.js';

describe('HermesClient V6 VALID_PHASES alignment (Phase 11)', () => {
  const phases = Pipeline.getPhases();
  const client = new HermesClient('http://127.0.0.1:0'); // never actually called

  it('VALID_PHASES covers all 20 V6 PHASES ids', async () => {
    // decide() validates phase first, then fetches. Validation must pass for all 20 phases.
    // Fetch will reject (no real server) — that proves validation succeeded.
    for (const phase of phases) {
      await assert.rejects(
        () => client.decide(phase.id, {}),
        (err) => !/Invalid phase/.test(err.message),
        `${phase.id} should pass validation (got unexpected Invalid phase rejection)`,
      );
    }
  });

  it('decide() rejects unknown phase IDs (safety net preserved)', async () => {
    await assert.rejects(
      () => client.decide('nonexistent-phase-id', {}),
      /Invalid phase/,
    );
  });

  it('VALID_PHASES contains no V4.1 legacy IDs (cleanup verified)', () => {
    const v41Legacy = [
      'requirement-bible', 'soul-visual', 'soul-voice', 'geometry-bed',
      'final-production',
    ];
    // Reach into the module — VALID_PHASES is const but accessible via decide() rejection patterns.
    // Use the pipeline's V2_MIGRATION_MAP as an indirect check: legacy IDs must not be in VALID_PHASES.
    // (Direct const access is not exported, but we can infer by checking that legacy IDs reject.)
    for (const legacy of v41Legacy) {
      // legacy IDs that aren't in V6 PHASES should reject
      if (!phases.find(p => p.id === legacy)) {
        assert.rejects(() => client.decide(legacy, {}), /Invalid phase/);
      }
    }
  });

  it('audit() accepts all V6 phases (validation passes; fetch may fail)', async () => {
    // audit() validates phase first, then fetches. Validation must pass for all 20 phases.
    // Fetch will reject (no real server) — that proves validation succeeded.
    for (const phase of phases) {
      await assert.rejects(
        () => client.audit(phase.id, 'decision-fake', {}, {}),
        // Reject must be fetch-related (TypeError: fetch failed), NOT "Invalid phase"
        (err) => !/Invalid phase/.test(err.message),
        `${phase.id} audit should pass validation (got unexpected Invalid phase rejection)`,
      );
    }
  });
});
