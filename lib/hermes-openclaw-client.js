/**
 * Hermes OpenClaw Bridge Client (ESM) — movie-agent 通过 OpenClaw gateway 调用 Hermes 决策
 *
 * 桥接策略：
 *   1. HTTP 桥接：通过 OpenClaw gateway HTTP API 调用 hermes-cognitive tools
 *   2. 降级：所有方式失败时返回 null，调用方使用 HERMES_DEFAULTS
 *
 * 接口与 hermes-client.js 完全兼容，可互换使用。
 *
 * 用法:
 *   import { HermesOpenClawClient } from './hermes-openclaw-client.js';
 *   const hermes = new HermesOpenClawClient();
 *   const decision = await hermes.decide('art-direction', { scene_description: '...' });
 *   await hermes.audit('art-direction', decision.decision_id, { aesthetic_score: 8.5 });
 */

import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const VALID_PHASES = [
  'requirement-bible', 'soul-visual', 'soul-voice', 'geometry-bed',
  'spatio-temporal-script', 'seed-skeleton', 'motion-preview',
  'ai-preview', 'final-production', 'composition',
];

// Gateway URL: explicit env > auto-detected
function _gatewayUrl() {
  if (process.env.OPENCLAW_GATEWAY_URL) {
    return process.env.OPENCLAW_GATEWAY_URL.replace(/\/$/, '');
  }
  // Default OpenClaw gateway
  return 'http://127.0.0.1:3578';
}

async function _httpPost(url, body, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    try { return JSON.parse(text); } catch { return null; }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// File-based bridge fallback: write request to .hermes-requests/
async function _fileBridgeRequest(type, payload) {
  const dir = join(process.cwd(), '.hermes-requests');
  try {
    await mkdir(dir, { recursive: true });
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    await writeFile(join(dir, `${type}-${id}.json`), JSON.stringify(payload, null, 2));
    return true;
  } catch {
    return false;
  }
}

export class HermesOpenClawClient {
  constructor(config = {}) {
    this.gatewayUrl = config.gatewayUrl || _gatewayUrl();
    this.disabled = false;
    this._failCount = 0;
    this._maxFails = 5; // circuit breaker threshold
  }

  // Try gateway HTTP bridge for hermes tool invocation
  async _gatewayCall(tool, args) {
    if (this.disabled || this._failCount >= this._maxFails) return null;

    try {
      // OpenClaw gateway exposes tool calls via POST /api/tools/:toolName
      const url = `${this.gatewayUrl}/api/tools/${tool}`;
      const result = await _httpPost(url, args, 25000);
      if (result) {
        this._failCount = 0;
        return result;
      }
    } catch { /* fall through */ }

    this._failCount++;
    return null;
  }

  async decide(phase, context = {}) {
    if (!VALID_PHASES.includes(phase)) {
      return null; // silent degradation instead of throw
    }

    const decisionId = `d-${phase}-${Date.now()}-${randomUUID().slice(0, 8)}`;

    // 1. Try HTTP gateway bridge
    const gwResult = await this._gatewayCall('hermes_plan', {
      intent: `Movie pipeline decision for phase '${phase}'`,
      context: { phase, ...context },
    });
    if (gwResult) {
      return {
        decision_id: decisionId,
        decision: gwResult.decision || gwResult,
        confidence: gwResult.confidence || 0.7,
        experts_consulted: gwResult.experts_consulted || [],
      };
    }

    // 2. Try file bridge fallback
    await _fileBridgeRequest('decide', { decision_id: decisionId, phase, context });

    // 3. Degraded: return null — caller uses HERMES_DEFAULTS
    return null;
  }

  async audit(phase, decisionId, metrics = {}, parametersUsed = {}) {
    // Audit never blocks the pipeline

    // 1. Try gateway bridge (hermes_reflect)
    await this._gatewayCall('hermes_reflect', {
      project_id: 'kais-movie-agent',
      work_id: decisionId,
      audit_data: { phase, outcome: 'completed', metrics, parameters_used: parametersUsed },
    });

    // 2. File bridge
    await _fileBridgeRequest('audit', {
      phase, decision_id: decisionId,
      outcome: 'completed', metrics, parameters_used: parametersUsed,
    });

    // Always succeed silently
    return { ok: true };
  }

  async auditFailure(phase, decisionId, error, metrics = {}) {
    // 1. Try gateway bridge
    await this._gatewayCall('hermes_reflect', {
      project_id: 'kais-movie-agent',
      work_id: decisionId,
      audit_data: { phase, outcome: 'failed', metrics: { ...metrics, error: String(error) } },
    });

    // 2. File bridge
    await _fileBridgeRequest('audit', {
      phase, decision_id: decisionId,
      outcome: 'failed', metrics: { ...metrics, error: String(error) },
    });

    return { ok: true };
  }

  async health() {
    // Check if gateway is reachable
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.gatewayUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);
      return { ok: res.ok, gateway: this.gatewayUrl };
    } catch {
      return { ok: false, gateway: this.gatewayUrl, note: 'gateway unreachable' };
    }
  }
}

export default HermesOpenClawClient;
