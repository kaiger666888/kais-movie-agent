/**
 * Hermes Adapter — LLM 调用路由层
 *
 * 将 movie-agent 的 LLM 调用路由到 Hermes MCP server（hermes_llm tool），
 * 替代直接调用 ZHIPU GLM API。
 *
 * 两种模式：
 * 1. Hermes 模式（HERMES_MCP_URL 已设置）→ 通过 HTTP 调用 Hermes MCP server
 * 2. 直连模式（默认）→ 直接调用 ZHIPU GLM API（兼容旧模式）
 *
 * 环境变量：
 * - HERMES_MCP_URL: Hermes MCP server HTTP 地址（如 http://localhost:8080）
 * - HERMES_MCP_API_KEY: 可选的 API key
 *
 * 注: MCP stdio 模式通过 OpenClaw 桥接，movie-agent 不直接用 stdio。
 *     此适配器通过 HTTP 调用 Hermes 的 streamable-http transport。
 */

const HERMES_URL = process.env.HERMES_MCP_URL || '';
const HERMES_KEY = process.env.HERMES_MCP_API_KEY || '';
const HERMES_TIMEOUT = 60000;

/**
 * 通过 Hermes MCP 调用 LLM（推荐路径）
 *
 * @param {string} prompt - 用户 prompt
 * @param {object} options
 * @param {string} [options.system] - 系统 prompt
 * @param {string} [options.model] - 模型名称
 * @param {string} [options.responseFormat] - 'text' 或 'json'
 * @param {number} [options.temperature] - 温度
 * @returns {Promise<string>} LLM 响应文本或 JSON 字符串
 */
export async function callViaHermes(prompt, options = {}) {
  if (!HERMES_URL) {
    return null; // Signal to fall back to direct call
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (HERMES_KEY) headers['Authorization'] = `Bearer ${HERMES_KEY}`;

    const resp = await fetch(`${HERMES_URL}/mcp/tools/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        method: 'tools/call',
        params: {
          name: 'hermes_llm',
          arguments: {
            prompt,
            system: options.system || '',
            model: options.model || '',
            response_format: options.responseFormat || 'text',
            temperature: options.temperature ?? 0.3,
          },
        },
      }),
      signal: AbortSignal.timeout(HERMES_TIMEOUT),
    });

    if (!resp.ok) {
      throw new Error(`Hermes HTTP ${resp.status}: ${await resp.text().then(t => t.substring(0, 200))}`);
    }

    const json = await resp.json();
    // MCP tool response format: { content: [{ type: "text", text: "..." }] }
    if (json.content?.[0]?.text) {
      return json.content[0].text;
    }
    throw new Error('Unexpected Hermes response format');
  } catch (err) {
    console.warn(`[hermes-adapter] Hermes 调用失败, 降级到直连: ${err.message}`);
    return null; // Signal to fall back
  }
}

/**
 * 智能路由 LLM 调用
 * 优先走 Hermes，不可用时降级到直连 ZHIPU API
 *
 * @param {string} prompt - 用户 prompt
 * @param {object} options
 * @param {string} [options.apiBase] - ZHIPU API 地址（降级用）
 * @param {string} [options.apiKey] - ZHIPU API Key（降级用）
 * @param {string} [options.model] - 模型名称
 * @param {number} [options.temperature] - 温度
 * @param {string} [options.system] - 系统 prompt
 * @returns {Promise<string>}
 */
export async function callLLM(prompt, options = {}) {
  // Try Hermes first
  const hermesResult = await callViaHermes(prompt, options);
  if (hermesResult !== null) return hermesResult;

  // Fallback: direct ZHIPU API call (original lib/llm.js behavior)
  const apiBase = options.apiBase || process.env.OPENAI_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4';
  const apiKey = options.apiKey || process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || '';
  const model = options.model || 'glm-5.1';
  const temperature = options.temperature ?? 0.8;

  const messages = [];
  if (options.system) messages.push({ role: 'system', content: options.system });
  messages.push({ role: 'user', content: prompt });

  const res = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature }),
  });

  if (!res.ok) throw new Error(`LLM 调用失败: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

/**
 * 智能路由 LLM 调用（返回 JSON）
 */
export async function callLLMJson(prompt, options = {}) {
  const content = await callLLM(prompt, { ...options, responseFormat: 'json' });
  const match = content.match(/\[[\s\S]*\]/) || content.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }
  throw new Error('LLM 返回内容无法解析为 JSON');
}

/**
 * 检测 Hermes 是否可用
 * @returns {Promise<boolean>}
 */
export async function isHermesAvailable() {
  if (!HERMES_URL) return false;
  try {
    const resp = await fetch(`${HERMES_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return resp.ok;
  } catch {
    return false;
  }
}

export default { callLLM, callLLMJson, callViaHermes, isHermesAvailable };
