"""
hermes_helper.py — Python 端 Hermes 路由辅助

movie-agent 的 Python 脚本 (anatomy-validator, scene-evaluator) 通过此模块
路由 LLM 调用到 Hermes MCP server，替代直接调用 ZHIPU API。

环境变量:
  HERMES_MCP_URL: Hermes server HTTP 地址 (如 http://localhost:8080)
  HERMES_MCP_API_KEY: 可选 API key

如果 HERMES_MCP_URL 未设置，自动降级到直接 ZHIPU API 调用。
"""

import json
import os
import urllib.request

HERMES_URL = os.environ.get("HERMES_MCP_URL", "")
HERMES_KEY = os.environ.get("HERMES_MCP_API_KEY", "")
ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"


def _default_vision_model() -> str:
    """Phase 19 D1-02: 视觉模型名经 env var 覆盖(单一来源,与 JS 侧 ZHIPU_VISION_MODEL 一致)。"""
    return os.environ.get("ZHIPU_VISION_MODEL", "glm-4.6v")


def call_hermes_vision(prompt: str, images_b64: list, api_key: str, model: str = None) -> str:
    """Route vision LLM call through Hermes or fall back to direct API."""
    if model is None:
        model = _default_vision_model()
    if HERMES_URL:
        try:
            return _call_hermes_tool("hermes_llm_vision", {
                "prompt": prompt,
                "images": images_b64,
                "model": model,
            })
        except Exception as e:
            print(f"[hermes_helper] Hermes 调用失败, 降级直连: {e}")

    # Fallback: direct ZHIPU API call
    return _call_zhipu_vision(prompt, images_b64, api_key, model)


def call_hermes_text(prompt: str, system: str = "", api_key: str = "",
                     model: str = "glm-5.1", temperature: float = 0.3) -> str:
    """Route text LLM call through Hermes or fall back to direct API."""
    if HERMES_URL:
        try:
            return _call_hermes_tool("hermes_llm", {
                "prompt": prompt,
                "system": system,
                "model": model,
                "temperature": temperature,
            })
        except Exception as e:
            print(f"[hermes_helper] Hermes 调用失败, 降级直连: {e}")

    # Fallback: direct ZHIPU API call
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload = {"model": model, "messages": messages, "temperature": temperature}
    return _raw_api_call(payload, api_key)


def _call_hermes_tool(tool_name: str, arguments: dict) -> str:
    """Call an MCP tool via Hermes HTTP endpoint."""
    headers = {"Content-Type": "application/json"}
    if HERMES_KEY:
        headers["Authorization"] = f"Bearer {HERMES_KEY}"

    payload = json.dumps({
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    }).encode()

    req = urllib.request.Request(
        f"{HERMES_URL}/mcp/tools/call",
        data=payload,
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read())
        # MCP tool response: { content: [{ type: "text", text: "..." }] }
        if data.get("content") and data["content"][0].get("text"):
            return data["content"][0]["text"]
        raise RuntimeError(f"Unexpected Hermes response: {str(data)[:200]}")


def _call_zhipu_vision(prompt: str, images_b64: list, api_key: str, model: str) -> str:
    """Direct ZHIPU vision API call."""
    content = [{"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img}"}} for img in images_b64]
    content.append({"type": "text", "text": prompt})

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.3,
    }
    return _raw_api_call(payload, api_key)


def _raw_api_call(payload: dict, api_key: str) -> str:
    """Raw API call to ZHIPU/OpenAI-compatible endpoint."""
    api_base = os.environ.get("OPENAI_BASE_URL", "https://open.bigmodel.cn/api/paas/v4")
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{api_base}/chat/completions",
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.loads(r.read())
        return resp["choices"][0]["message"]["content"]
