# Phase 31 Context: Plugin Skeleton + Hermes-Agent Wiring

**Captured:** 2026-06-25
**Source:** User-provided phase context + research against `/data/workspace/hermes-agent/`

## Architectural Decisions (LOCKED — do not revisit)

### D-01: Deliverable location
All Phase 31 code lives under `/data/workspace/hermes-agent/plugins/` (NOT under `kais-movie-agent/`). The planning root (`kais-movie-agent/.planning/`) documents and tracks this work, but the actual artifacts are written to the hermes-agent repository. PLAN.md tasks must reference absolute paths under `/data/workspace/hermes-agent/`.

### D-02: Python only, no Node.js bridges
Three new plugins are pure Python. No `child_process.spawn`, no `subprocess.run`, no Node.js runtime dependency. This aligns with `OPENCLAW-REMOVE-03` (v5.0 has zero Node.js runtime deps in new deliverables).

### D-03: Mirror existing hermes-agent plugin conventions
The three plugins follow the exact patterns already established in `/data/workspace/hermes-agent/plugins/`. No novel plugin system is introduced. The pattern reference is captured in `PATTERNS.md`.

### D-04: Tool registration via existing plugin loader mechanism
Plugins register tools through the existing `PluginContext.register_tool(...)` API exposed by `hermes_cli/plugins.py`. No modifications to hermes-agent's plugin loader code. The loader's `discover_and_load()` will discover the new plugins automatically because they live in the bundled plugins directory.

### D-05: Skeleton scope — stubs only, no real implementations
Tool handlers in Phase 31 are **skeleton stubs**. Each returns a `NotImplementedError`-wrapped or degrade-mode stub response. Real HTTP client implementations belong to Phase 32 (kais_aigc), Phase 33 (pipeline_state), Phase 34 (review_gates). This phase only proves the wiring works.

## Critical Research Findings (corrections to phase_context)

### CRITICAL-FINDING-01: Manifest is `plugin.yaml`, NOT `plugin.json`

The phase_context instructed scaffolding `plugin.json` manifests. **This is incorrect.** The hermes-agent plugin loader (`hermes_cli/plugins.py:1363-1365`) only looks for `plugin.yaml` then `plugin.yml`:

```python
manifest_file = child / "plugin.yaml"
if not manifest_file.exists():
    manifest_file = child / "plugin.yml"
```

There is **no `plugin.json` support** anywhere in the loader. Writing `plugin.json` would result in the plugin being silently skipped (no manifest found → directory treated as a category namespace → recursed one level deeper → no children with manifests → plugin never loads).

**PLAN.md MUST specify `plugin.yaml` (YAML format)**, not `plugin.json`. This overrides the phase_context instructions per the planner's authority to honor codebase evidence over assumed patterns.

### CRITICAL-FINDING-02: Entry module is `__init__.py`, NOT a separate `client.py`/`state.py`/`gates.py` entry

The phase_context proposed `client.py` / `state.py` / `gates.py` as entry modules. The loader (`hermes_cli/plugins.py:1607-1609`) only invokes `register()` from the plugin's `__init__.py`:

```python
init_file = plugin_dir / "__init__.py"
if not init_file.exists():
    raise FileNotFoundError(f"No __init__.py in {plugin_dir}")
```

The pattern across all reference plugins (spotify, image_gen/*, disk-cleanup, security-guidance) is:
- `__init__.py` exports `register(ctx)` — this is the loader entry point
- Implementation modules (`client.py`, `tools.py`, etc.) hold the actual logic
- `__init__.py` imports from those modules and registers tools

**PLAN.md keeps the `client.py`/`state.py`/`gates.py` module names for implementation, but `register(ctx)` MUST live in `__init__.py`.** The phase_context's implication that the entry module is a separate file was ambiguous — the resolution is: implementation in named module, `register()` in `__init__.py` that imports from it.

### CRITICAL-FINDING-03: Plugin `kind` determines auto-load behavior

Plugins with `kind: standalone` (the default when `kind` is omitted) are **opt-in** — they require explicit `plugins.enabled` config entry to load. Plugins with `kind: backend` auto-load when bundled (source=bundled).

For Phase 31, the three new plugins are **skeleton scaffolds** for future phases. They should:
- Use `kind: standalone` (default — opt-in, won't disrupt existing hermes-agent sessions)
- Tests verify discovery + manual registration, NOT auto-loading into a live session

This matches the pattern of `disk-cleanup`, `security-guidance`, `spotify` (all standalone). The image_gen backends use `kind: backend` because they're pluggable providers for a core tool — that's not what these three plugins are.

### CRITICAL-FINDING-04: Tool registration signature

`ctx.register_tool(...)` signature (from `hermes_cli/plugins.py:320-353`):

```python
ctx.register_tool(
    name: str,           # Tool name (e.g. "kais_gold_team_submit")
    toolset: str,        # Toolset grouping (e.g. "kais_aigc")
    schema: dict,        # JSON Schema dict with name/description/parameters
    handler: Callable,   # Callable(args: dict, **kw) -> str (JSON result)
    check_fn: Callable | None = None,  # Availability gate
    requires_env: list | None = None,
    is_async: bool = False,
    description: str = "",
    emoji: str = "",
    override: bool = False,
)
```

**Schema format** (from `plugins/spotify/tools.py:328-353`): dict with `name`, `description`, `parameters` (JSON Schema object).

### CRITICAL-FINDING-05: No new Python dependencies

Confirmed by reading `/data/workspace/hermes-agent/pyproject.toml`:
- Python `>=3.11,<3.14`
- All skeleton stubs use stdlib only (`logging`, `typing`, `json`)
- No new entries in `dependencies`, `[project.optional-dependencies]`, or `pyproject.toml` of any kind
- Phase 32+ may add deps (httpx is already present); Phase 31 adds zero

### CRITICAL-FINDING-06: Plugin slug derivation for module import

When the loader imports a directory-based plugin, it creates a synthetic module under `hermes_plugins.<slug>` namespace (`hermes_cli/plugins.py:1618-1620`):

```python
key = manifest.key or manifest.name
slug = key.replace("/", "__").replace("-", "_")
module_name = f"{_NS_PARENT}.{slug}"
```

For our plugins:
- `kais_aigc` → `hermes_plugins.kais_aigc` (underscore preserved, no dashes)
- `pipeline_state` → `hermes_plugins.pipeline_state`
- `review_gates` → `hermes_plugins.review_gates`

Smoke test imports must use these synthetic module paths OR import via filesystem path. The safer smoke-test approach is: invoke `PluginManager.discover_and_load()` and assert the plugin appears in `manager.list_plugins()` with `enabled=True`, rather than relying on direct `import` of a synthetic namespace module.

## Deferred Ideas (NOT in Phase 31 scope)

- Real HTTP clients (Phase 32)
- AssetBus / PipelineStateStore / CreativeHistoryTracker implementations (Phase 33)
- Gate lifecycle logic — submit/wait/resolve state machine (Phase 34)
- 8-gate YAML config (Phase 34)
- Integration with hermes-agent delegate_task approval callback (Phase 34)
- Canvas sync event subscriber (Phase 37)
- Any external HTTP calls, even mocked (Phase 32 covers mocked HTTP tests)

## Claude's Discretion

- **Stub return shape:** Stubs may return either `raise NotImplementedError("Phase 32 implements ...")` or a degrade-style JSON `{"status": "not_implemented", "phase": 32}`. PLAN.md picks one for consistency — degrade-style JSON is preferred (matches hermes-agent's degrade-first ethos and lets `register()` succeed without runtime errors).
- **README content:** 1-paragraph description per plugin with a pointer to the implementing phase. No extensive docs.
- **Test file location:** Tests live alongside the plugin under `plugins/<name>/tests/test_smoke.py` (mirrors hermes-agent's bundled layout where each plugin is self-contained).
