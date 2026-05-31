/**
 * Skill Router — 路由分发到下游服务
 *
 * toonflow/*    → core-backend:8000
 * jellyfish/*   → core-backend:8000
 * hermes/*      → hermes-worker-agent:3100 (专家决策 /decide /audit /pipeline)
 * hermes-llm/*  → core-backend:8000 (LLM 代理，向后兼容)
 * gold-team/*   → gold-team:8002
 *
 * 自动降级：下游不可用时返回错误而非崩溃
 */

const SERVICE_MAP = {
  'toonflow': {
    baseUrl: () => process.env.CORE_BACKEND_URL || 'http://kais-core-backend:8000',
    pathPrefix: '/api/v1/toonflow',
  },
  'jellyfish': {
    baseUrl: () => process.env.CORE_BACKEND_URL || 'http://kais-core-backend:8000',
    pathPrefix: '/api/v1/jellyfish',
  },
  'hermes': {
    baseUrl: () => process.env.HERMES_WORKER_URL || 'http://localhost:3100',
    pathPrefix: '',
  },
  'hermes-llm': {
    baseUrl: () => process.env.CORE_BACKEND_URL || 'http://kais-core-backend:8000',
    pathPrefix: '/api/v1/llm',
  },
  'gold-team': {
    baseUrl: () => process.env.GOLD_TEAM_URL || 'http://kais-gold-team:8002',
    pathPrefix: '/api/v1',
  },
};

/**
 * 路由请求到对应下游服务
 * @param {string} skill - 技能名称 (toonflow/jellyfish/hermes/gold-team)
 * @param {string} action - 操作名称
 * @param {object} body - 请求体
 * @returns {Promise<object>}
 */
export async function routeSkillRequest(skill, action, body = {}) {
  const service = SERVICE_MAP[skill];
  if (!service) {
    return { ok: false, error: `Unknown skill: ${skill}` };
  }

  const baseUrl = service.baseUrl();
  const targetPath = `${service.pathPrefix}/${action}`;
  const url = `${baseUrl}${targetPath}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        error: `Upstream ${skill} returned ${response.status}: ${text.slice(0, 200)}`,
        status: response.status,
      };
    }

    const data = await response.json().catch(() => ({}));
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: `Upstream ${skill} unreachable: ${err.message}`,
    };
  }
}

/**
 * Ping 下游服务检查可用性
 */
export async function pingService(serviceName) {
  const service = SERVICE_MAP[serviceName];
  if (!service) return false;

  const baseUrl = service.baseUrl();
  try {
    const r = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * 获取所有下游服务健康状态
 */
export async function getDownstreamHealth() {
  const results = {};
  for (const name of Object.keys(SERVICE_MAP)) {
    results[name] = await pingService(name);
  }
  return results;
}

// ─────────────────────────────────────────────────────────
// hermes-worker-agent 辅助函数
// ─────────────────────────────────────────────────────────

const HERMES_WORKER_BASE = () =>
  process.env.HERMES_WORKER_URL || 'http://localhost:3100';

/**
 * 向 hermes-worker-agent 请求专家决策
 *
 * POST /decide  →  { stage, experts_consulted, decision, confidence }
 *
 * @param {string} phase   - 当前阶段 (e.g. 'storyboard', 'render', 'finalize')
 * @param {object} context - 项目上下文 (title, style, constraints …)
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<{ok:boolean, data?:object, error?:string}>}
 */
export async function askHermesDecide(phase, context, timeoutMs = 10000) {
  const url = `${HERMES_WORKER_BASE()}/decide`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase, context }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        ok: false,
        error: `hermes /decide returned ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = await response.json().catch(() => ({}));
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: `hermes /decide unreachable: ${err.message}`,
    };
  }
}

/**
 * 向 hermes-worker-agent 汇报阶段审计结果（fire-and-forget）
 *
 * POST /audit  — 不等待响应，错误仅打日志
 *
 * @param {string} phase      - 阶段名
 * @param {string} decisionId - 对应的决策 ID
 * @param {string} outcome    - 执行结果 (success / fail / partial)
 * @param {object} [metrics]  - 可选指标
 */
export function reportHermesAudit(phase, decisionId, outcome, metrics) {
  const url = `${HERMES_WORKER_BASE()}/audit`;
  const payload = JSON.stringify({ phase, decisionId, outcome, metrics });

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    signal: AbortSignal.timeout(5000),
  }).catch((err) => {
    console.error(`[hermes-audit] fire-and-forget failed: ${err.message}`);
  });
  // fire-and-forget — 不 return promise
}
