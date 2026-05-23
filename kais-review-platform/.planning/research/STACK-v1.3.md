# Technology Stack: v1.3

**Project:** Kai's Review Platform -- v1.3 AI Scoring & Escalation
**Researched:** 2026-05-10

## Recommended Stack Changes

### New: None Required

v1.3 adds zero new dependencies. All four features are implemented with existing libraries.

| Feature | Library Used | Already in pyproject.toml? |
|---------|-------------|---------------------------|
| Plugin bus (ABC + registry) | stdlib (abc, dataclasses) | Yes (stdlib) |
| CLIP GPU client | httpx | Yes (httpx>=0.28.0) |
| Scoring arq task | arq | Yes (arq>=0.26.0) |
| ReviewScore model | sqlalchemy + aiosqlite | Yes (both listed) |
| PWA static files | FastAPI StaticFiles | Yes (fastapi includes it) |
| Service worker | Vanilla JS | No library needed |

### Config Additions

```python
# app/core/config.py -- new Settings fields
class Settings(BaseSettings):
    # ... existing fields ...

    # AI Scoring
    gpu_inference_url: str = ""              # http://192.168.71.38:8001
    gpu_inference_timeout: float = 30.0     # seconds
    ai_scoring_enabled: bool = False         # feature flag
    ai_auto_approve_threshold: float = 0.85  # score >= this -> auto-approve
    ai_escalate_threshold: float = 0.3       # score <= this -> escalate to HUMAN
```

### New Static Files

```
app/static/
  manifest.json        # PWA manifest (~500 bytes)
  sw.js                # Service worker (~500 bytes)
  icons/
    icon-192.png       # PWA icon
    icon-512.png       # PWA icon
```

### New Python Package

```
app/scoring/
  __init__.py          # Package init
  base.py              # MetricPlugin ABC, ScoreResult dataclass
  bus.py               # ScoringBus singleton
  noop.py              # NoOpMetricPlugin
  clip_client.py       # CLIPMetricPlugin (httpx client)
```

## Why No New Dependencies

| Considered | Why Not |
|------------|---------|
| pluggy (pytest plugin system) | Overkill for single-process, single-team app. ABC + dict is simpler. |
| importlib.metadata entry points | No third-party plugin consumers. All plugins are in-tree. |
| torch / transformers | Violates 400MB RAM constraint. GPU server handles this. |
| Pillow (PIL) | No image processing in review platform. GPU server does this. |
| workbox (Google SW library) | Our service worker is 20 lines. No need for a build tool. |

## Sources

- Existing pyproject.toml verified (HIGH confidence)
- Python stdlib abc, dataclasses available in 3.12+ (HIGH confidence)
- FastAPI StaticFiles built-in (HIGH confidence)
- httpx AsyncClient already used for webhooks (HIGH confidence)

---
*Stack research for: v1.3 AI Scoring, Escalation, and PWA*
*Researched: 2026-05-10*
