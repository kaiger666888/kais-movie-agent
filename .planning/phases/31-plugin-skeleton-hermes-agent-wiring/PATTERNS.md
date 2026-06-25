# Phase 31 Patterns: hermes-agent Plugin Pattern Mapping

**Source:** Research against `/data/workspace/hermes-agent/plugins/` (spotify, image_gen/*, disk-cleanup, security-guidance) + loader code in `/data/workspace/hermes-agent/hermes_cli/plugins.py`.

This document maps the existing hermes-agent plugin pattern to the three new plugins (kais_aigc, pipeline_state, review_gates) so that executors can mirror the pattern without re-exploring the codebase.

## Reference Plugins Consulted

| Plugin | Path | Why Consulted | Pattern Extracted |
|--------|------|---------------|-------------------|
| spotify | `plugins/spotify/` | Multi-tool standalone plugin with check_fn gating | Schema format, register() loop, check_fn pattern |
| image_gen/fal | `plugins/image_gen/fal/` | Backend provider (kind: backend) — ABC registration | Provider ABC pattern (NOT used by Phase 31, which uses standalone) |
| disk-cleanup | `plugins/disk-cleanup/` | Hook-only standalone plugin | Minimal plugin.yaml shape |
| security-guidance | `plugins/security-guidance/` | Hook-only standalone with version string | Plugin.yaml with version as quoted string |

## Adopted Pattern (spotify-like standalone, NOT image_gen backend)

**Decision:** Phase 31's three plugins follow the **standalone multi-tool** pattern (spotify), NOT the **backend provider** pattern (image_gen). Rationale:

1. `image_gen/fal` registers an `ImageGenProvider` ABC via `ctx.register_image_gen_provider(...)` — that API is for pluggable backends of an *existing core tool* (`image_generate`). Our three plugins expose *new* tool surfaces, not backends of an existing tool.
2. `spotify` registers distinct tools via `ctx.register_tool(...)` — exactly what GPU-DIRECT-06 demands ("kais_aigc plugin 暴露统一工具面: kais_gold_team_submit / kais_review_submit / ...").
3. Standalone plugins are opt-in (won't disrupt existing hermes-agent sessions during the v5.0 migration rollout).

## plugin.yaml Schema (Adopted)

Mirrors `plugins/spotify/plugin.yaml` + `plugins/security-guidance/plugin.yaml`:

```yaml
name: <plugin_name>            # Required, matches directory name
version: "0.1.0"               # Required, quoted string (security-guidance pattern)
description: "<one-line>"      # Required
author: kais-movie-agent       # Recommended
kind: standalone               # Optional (default). DO NOT use "backend" — not a core-tool provider
provides_tools:                # Optional but recommended — documents the tool surface
  - <tool_name_1>
  - <tool_name_2>
```

**Fields NOT used in Phase 31:**
- `requires_env` — real env vars come in Phase 32 (KAIS_GOLD_TEAM_URL etc.). Skeleton has no env requirements.
- `provides_hooks` — Phase 31 registers no lifecycle hooks. Hook registration is Phase 34 (gate framework) / Phase 37 (canvas sync subscriber).
- `kind: backend` / `kind: exclusive` / `kind: platform` — wrong plugin type.

## __init__.py register() Pattern (Adopted)

Mirrors `plugins/spotify/__init__.py:56-66`:

```python
from __future__ import annotations
from typing import Any, Callable

from plugins.<name>.tools import (
    TOOL_A_SCHEMA, _handle_tool_a,
    TOOL_B_SCHEMA, _handle_tool_b,
    # ...
)

_TOOLS = (
    ("tool_a", TOOL_A_SCHEMA, _handle_tool_a, "X"),
    ("tool_b", TOOL_B_SCHEMA, _handle_tool_b, "Y"),
    # ...
)


def register(ctx) -> None:
    """Plugin entry point — called once by the hermes-agent plugin loader."""
    for name, schema, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="<plugin_name>",      # toolset grouping = plugin name
            schema=schema,
            handler=handler,
            check_fn=None,                 # Phase 31: no availability gate (stubs always "available")
            emoji=emoji,
        )
```

**Why a loop, not individual calls:** matches spotify's DRY pattern. Adding/removing a tool is a one-line tuple change. Phase 32/33/34 will iterate on this same tuple list when filling in real handlers.

## Tool Schema Format (Adopted)

Mirrors `plugins/spotify/tools.py:328-353`:

```python
TOOL_A_SCHEMA = {
    "name": "tool_a",
    "description": "<one-line description for the LLM tool catalog>",
    "parameters": {
        "type": "object",
        "properties": {
            "required_param": {"type": "string", "description": "..."},
            "optional_param": {"type": "integer", "description": "..."},
        },
        "required": ["required_param"],
    },
}
```

**For Phase 31 stubs:** schemas should declare the *target* parameter shape (what Phase 32/33/34 will eventually accept), so Phase 32+ only needs to fill in handler bodies without renegotiating the schema. This is the "interface-first" pattern from the planner playbook.

## Handler Stub Pattern (Adopted)

```python
from tools.registry import tool_result, tool_error


def _handle_tool_a(args: dict, **kw) -> str:
    """Phase 31 skeleton stub — Phase 32 implements real behavior."""
    return tool_result({
        "status": "not_implemented",
        "plugin": "<plugin_name>",
        "tool": "tool_a",
        "implementing_phase": "Phase 32",   # or 33 / 34
        "args_received": args,
    })
```

**Why `tool_result(...)` instead of `raise NotImplementedError`:**
1. `register()` calls `ctx.register_tool(handler=...)` at discovery time — if the handler raised during registration, the plugin would fail to load. We avoid that by returning a JSON string.
2. Hermes' degrade-first ethos (PROJECT.md principle) prefers graceful degradation over exceptions.
3. Phase 32/33/34 executors can grep for `"status": "not_implemented"` to find every stub they need to fill in.

## File Layout Per Plugin (Adopted)

Mirrors spotify's self-contained layout:

```
plugins/<plugin_name>/
├── plugin.yaml              # manifest
├── __init__.py              # exports register(ctx)
├── tools.py                 # schema dicts + handler stubs
├── README.md                # 1-paragraph description + phase pointer
└── tests/
    └── test_smoke.py        # import + register + tool-name assertions
```

**Why no separate `client.py`/`state.py`/`gates.py` at the top level of Phase 31:**
- The phase_context suggested these names. Spotify's analogous file is `client.py` (the actual API client), with `tools.py` holding schemas+handlers.
- For Phase 31 (skeleton), all we need is `tools.py` holding schemas + stub handlers. The named implementation modules (`client.py`, `state.py`, `gates.py`) get created in Phase 32/33/34 when real logic arrives — at that point the handlers in `tools.py` will import from them.
- Creating empty `client.py` files now would be premature abstraction (anti-pattern called out in phase_context). Resist.

## Test Pattern (Adopted)

Tests must verify three things without spinning up a full agent:

1. **Plugin module imports cleanly** — `importlib.import_module` of the plugin's synthetic namespace module
2. **`register(ctx)` runs without error and registers the expected tools** — use a mock `ctx` that captures `register_tool` calls
3. **Manifest parses** — load `plugin.yaml` with `yaml.safe_load` and assert required fields

```python
import importlib.util
from pathlib import Path
import yaml

PLUGIN_DIR = Path(__file__).resolve().parent.parent


def test_manifest_valid():
    manifest = yaml.safe_load((PLUGIN_DIR / "plugin.yaml").read_text())
    assert manifest["name"] == "<plugin_name>"
    assert manifest["version"]
    assert manifest["description"]
    assert manifest.get("kind", "standalone") == "standalone"


def test_register_smoke():
    # Import via file path (mirrors how PluginManager loads directory plugins)
    spec = importlib.util.spec_from_file_location(
        "test_<plugin_name>_init", PLUGIN_DIR / "__init__.py",
        submodule_search_locations=[str(PLUGIN_DIR)],
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    registered = []
    class _FakeCtx:
        def register_tool(self, **kwargs):
            registered.append(kwargs)

    mod.register(_FakeCtx())

    tool_names = [r["name"] for r in registered]
    assert "<expected_tool_1>" in tool_names
    assert "<expected_tool_2>" in tool_names
    # ... one assert per declared tool
```

**Why a fake ctx instead of `PluginManager.discover_and_load()`:** the full manager scans ALL plugins and mutates the global tool registry (side effects leak across tests). A fake ctx isolates the test to this one plugin's `register()` behavior. The discovery-integration test (does the manager find the plugin?) is a single Phase 31 acceptance test, not a per-plugin unit test.

## Differences From Reference Plugins (Documented)

| Aspect | spotify (reference) | Phase 31 plugins | Why |
|--------|---------------------|------------------|-----|
| `check_fn` | `_check_spotify_available` gates on auth | `None` (stubs always "available") | No auth/env requirements in skeleton |
| `client.py` | Real Spotify Web API client | Not created in Phase 31 | Phase 32+ adds real clients |
| `requires_env` | None in plugin.yaml (auth via separate system) | None | Real env vars arrive Phase 32 |
| `is_async` | Some handlers async | All sync | Stubs are sync JSON returns |
| Toolset name | `"spotify"` | `"<plugin_name>"` (e.g. `"kais_aigc"`) | Matches convention: toolset = plugin name |
