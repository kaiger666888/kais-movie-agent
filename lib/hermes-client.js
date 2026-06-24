/**
 * Hermes Decision Client (ESM) — movie-agent 调用 Hermes 决策
 *
 * 用法:
 *   import { HermesClient } from './hermes-client.js';
 *   const hermes = new HermesClient();
 *   const decision = await hermes.decide('art-direction', { scene_description: '...' });
 *   await hermes.audit('art-direction', decision.decision_id, { aesthetic_score: 8.5 });
 */

const DEFAULT_URL = process.env.HERMES_URL || 'http://192.168.71.140:8080';

// V6 VALID_PHASES — must stay 1:1 in sync with lib/pipeline.js PHASES array.
// Phase 11 (v2.0): migrated from 10 V4.1 IDs to 20 V6 IDs.
// When PHASES changes, update this array and run `npm test` to catch drift.
const VALID_PHASES = [
  // Upper half — creative ideation (Steps 1-11)
  'pain-discovery', 'topic-selection', 'outline-generation', 'outline-selection',
  'script-generation', 'script-selection', 'character-generation', 'character-selection',
  // Phase 26 PIPE-DATA-02: spatio-temporal-script moved before scene-generation (matches PHASES)
  'spatio-temporal-script', 'scene-generation', 'scene-selection',
  // Lower half — production execution (Steps 12-20)
  'script-lock', 'seed-skeleton', 'motion-preview', 'ai-preview',
  'consistency-guard', 'cloud-production', 'final-audio', 'composition', 'delivery',
];

async function _request(method, url, body, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      signal: controller.signal,
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`Hermes ${res.status}: ${text.slice(0, 200)}`);
      err.statusCode = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export class HermesClient {
  constructor(baseUrl = DEFAULT_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async decide(phase, context = {}) {
    if (!VALID_PHASES.includes(phase)) {
      throw new Error(`Invalid phase '${phase}'`);
    }
    return _request('POST', `${this.baseUrl}/decide`, { phase, context }, 30000);
  }

  async audit(phase, decisionId, metrics = {}, parametersUsed = {}) {
    return _request('POST', `${this.baseUrl}/audit`, {
      phase,
      decision_id: decisionId,
      outcome: 'completed',
      metrics,
      parameters_used: parametersUsed,
    }, 10000);
  }

  async auditFailure(phase, decisionId, error, metrics = {}) {
    return _request('POST', `${this.baseUrl}/audit`, {
      phase,
      decision_id: decisionId,
      outcome: 'failed',
      metrics: { ...metrics, error: String(error) },
      parameters_used: {},
    }, 10000);
  }

  async health() {
    return _request('GET', `${this.baseUrl}/health`, null, 5000);
  }
}

export default HermesClient;
