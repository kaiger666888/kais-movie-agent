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
const VALID_PHASES = [
  'requirement-bible', 'soul-visual', 'soul-voice', 'geometry-bed',
  'spatio-temporal-script', 'seed-skeleton', 'motion-preview',
  'ai-preview', 'final-production', 'composition',
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
