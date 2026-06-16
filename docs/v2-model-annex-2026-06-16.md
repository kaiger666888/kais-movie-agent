# v2.0 Model Instantiation Annex — 2026-06-16

> **Status:** dated annex per NODE-08 + PITFALLS §1.3
> **Binding:** non-binding recommendation (per HANDOFF-01)
> **Stability:** Models evolve; canonical capability-spec layer (lib/v2_topology/) is model-agnostic
>
> ⚠ **This annex is the ONLY place model names appear in the v2.0 spec suite.**
> The canonical capability-spec layer (lib/v2_topology/*.js) is model-agnostic.
> The DAG must remain valid even if every model below is swapped.

---

## Stability Legend

- **stable_2026** — ≥2 year persistence; production-ready
- **evolving** — quarterly updates expected; integrate with fallback paths
- **research_bet** — may fail; do not depend on for production

---

## Per-Node Current Instantiation

| Node | Model | Role in node | Verified | Stability | Swap alternatives |
|---|---|---|---|---|---|
| creative_source | Claude Sonnet 4.5 | Kernel expansion from creator anecdote + structured interview | 2026-06-16 | evolving | GPT-5, GLM-4.6 |
| style_genome | Claude Sonnet 4.5 | Style extraction + 5D encoding | 2026-06-16 | stable_2026 | GPT-5, Gemini 3 Pro |
| screenplay | Claude Sonnet 4.5 | Screenplay generation (scene list + dialogue + form) | 2026-06-16 | evolving | GPT-5, GLM-4.6 |
| script_auditor | Claude Haiku 4.5 | 5-dim quantitative audit | 2026-06-16 | stable_2026 | GPT-5-mini |
| character_designer | FLUX 2 + IP-Adapter | Face/body generation | 2026-06-16 | evolving | SD4 + IP-Adapter |
| character_designer | CosyVoice 2 | Voice cloning (voice_profile) | 2026-06-16 | stable_2026 | ElevenLabs VC |
| cinematographer | Claude Sonnet 4.5 | Visual intent + composition_lock | 2026-06-16 | evolving | GPT-5 |
| prompt_injector | Template + few-shot | Prompt engineering | 2026-06-16 | stable_2026 | N/A (engineering, not model) |
| visual_executor (drawer) | FLUX 2 | Image generation | 2026-06-16 | evolving | SD4, Ideogram |
| visual_executor (animator) | Sora 2 / Kling 2.0 | Video generation | 2026-06-16 | evolving | Veo 4, Runway Gen-5 |
| audio_pipeline (voicer) | CosyVoice 2 / ElevenLabs v3 | TTS | 2026-06-16 | evolving | Azure TTS, OpenAI TTS-2 |
| audio_pipeline (composer) | Suno V5 / Udio 2 | Music generation | 2026-06-16 | evolving | MusicGen-Large |
| audio_pipeline (foley) | Stable Audio Open | Foley generation | 2026-06-16 | evolving | AudioLDM-3 |
| audio_pipeline (mixer) | DSP engineering (ffmpeg) | LUFS targeting | 2026-06-16 | stable_2026 | N/A (engineering) |
| editor | Claude Sonnet 4.5 | Cut-point suggestions | 2026-06-16 | evolving | GPT-5 |
| colorist | DaVinci Resolve + AI LUT | Color grading | 2026-06-16 | stable_2026 | Baseline AI Color |
| hook_retention | Claude Sonnet 4.5 | Hook + retention analysis | 2026-06-16 | evolving | GPT-5, GLM-4.6 |
| quality_gate | Claude Sonnet 4.5 + custom rubric | Multi-dim verdict | 2026-06-16 | stable_2026 | GPT-5, ensemble |
| compliance_gate | Claude Sonnet 4.5 + rules engine | CN compliance | 2026-06-16 | stable_2026 | GLM-4.6, CN API |
| theory_critic | Claude Opus 4.7 | Theory consultation | 2026-06-16 | evolving | GPT-5, Gemini 3 Pro |

---

## v2.0 Implementation Status (kais-movie-agent)

**Current instantiation in lib/v2_topology/ nodes:** Model-agnostic.
Nodes use `await this._getLLM(pipeline)` to fetch LLM dispatch wrapper. The actual model binding happens in lib/llm.js (or production equivalent).

**Verified by:** `test/v2-canonical-clean.mjs` (Phase 13 lint check) — asserts ZERO hard-coded model names in lib/v2_topology/ + lib/v2_pipeline.js.

**Migration path:** When swapping a model:
1. Update lib/llm.js dispatch to use the new model
2. Update this annex table with new verified_date
3. No changes needed in lib/v2_topology/ (canonical capability-spec layer)

---

## Future Dated Annexes

As models evolve, new dated annexes will be created (e.g., `v2-model-annex-2026-09-15.md`). The most recent annex is authoritative for production instantiation; older annexes are retained for traceability.

---

*Annex version: design-2026-06-16-prfp*
*Phase 13 of v2.0 milestone*
