/**
 * style_genome — Layer 1 intent_parallel (visual DNA)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.2):
 *   提取 + 编码 + 复用视觉 DNA (5D style genome)
 *
 * 5D vector dimensions:
 *   - palette (色调): color palette as hex codes + emotional tone tags
 *   - composition (构图): framing patterns, rule-of-thirds vs centered, etc.
 *   - rhythm (节奏): pacing/shot duration patterns
 *   - texture (材质): visual texture qualities (film grain, smooth, painterly)
 *   - emotional_tone (情感基调): lighting mood + emotional color theory
 *
 * Phase 11 native v2.0 implementation. OWNS the style_genome_5d invariant.
 */
import { NodeBase } from './_node-base.js';

export class StyleGenome extends NodeBase {
  constructor(spec) {
    super({
      id: 'style_genome',
      layer: 1,
      role: 'intent_parallel',
      v8PassthroughTargets: [],
      spec,
    });
    this.isV2Native = true;
  }

  /**
   * @param {object} pipeline
   * @param {object} inputs
   * @param {object} inputs.story_kernel — from creative_source
   * @param {object} [inputs.invariants] — InvariantBus to publish to
   */
  async run(pipeline, inputs = {}) {
    const { story_kernel, invariants } = inputs;

    if (!story_kernel) {
      throw new Error('[style_genome] Missing required input: story_kernel');
    }

    const styleGene = story_kernel.style_gene || {};
    const genome5d = await this._extractGenome5d(pipeline, story_kernel, styleGene);

    // Publish to invariant bus (downstream consumers: cinematographer, prompt_injector,
    // visual_executor, editor, colorist, audio_pipeline per edges.yaml)
    if (invariants && typeof invariants.setStyleGenome === 'function') {
      invariants.setStyleGenome(genome5d);
    }

    return {
      node_id: this.id,
      is_v2_native: true,
      style_genome_5d: genome5d,
      published_to_invariants: !!invariants,
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  /**
   * Extract 5D style genome from story kernel.
   * Strategy: LLM-assisted extraction from kernel.style_gene (mood + genre + tone)
   *           → expand to 5 dimensions with concrete references.
   */
  async _extractGenome5d(pipeline, kernel, styleGene) {
    const llm = await this._getLLM(pipeline);

    if (!llm) {
      // Stub for test mode
      return this._stubGenome5d(kernel);
    }

    try {
      const llmOutput = await llm.call({
        prompt: `Extract a 5D style genome from this story kernel.

Kernel: ${JSON.stringify(kernel)}
Style gene: ${JSON.stringify(styleGene)}

Return JSON with 5 dimensions:
- palette: { primary_hex, secondary_hex, accent_hex, emotional_tags: [] }
- composition: { framing_pattern, dominant_technique, reference_films: [] }
- rhythm: { avg_shot_duration_s, pacing_pattern, energy_level_1to10 }
- texture: { grain_level, finish_quality, surface_quality }
- emotional_tone: { lighting_mood, color_temperature_k, emotional_color_theory }`,
        max_tokens: 800,
      });
      const parsed = JSON.parse(llmOutput);
      return this._normalizeGenome(parsed);
    } catch {
      return this._stubGenome5d(kernel);
    }
  }

  _stubGenome5d(kernel) {
    const mood = kernel?.style_gene?.mood || 'neutral';
    const genre = kernel?.style_gene?.genre || 'drama';
    return {
      palette: {
        primary_hex: '#3A506B',
        secondary_hex: '#1C3349',
        accent_hex: '#5BC0BE',
        emotional_tags: [mood],
      },
      composition: {
        framing_pattern: genre === 'action' ? 'dynamic_off_center' : 'rule_of_thirds',
        dominant_technique: 'shallow_dof',
        reference_films: [],
      },
      rhythm: {
        avg_shot_duration_s: genre === 'action' ? 2.5 : 5.0,
        pacing_pattern: mood === 'tense' ? 'staccato' : 'legato',
        energy_level_1to10: 6,
      },
      texture: {
        grain_level: 0.3,
        finish_quality: 'cinematic_glossy',
        surface_quality: 'smooth',
      },
      emotional_tone: {
        lighting_mood: mood,
        color_temperature_k: 5500,
        emotional_color_theory: 'complementary',
      },
      _stub: true,
    };
  }

  _normalizeGenome(parsed) {
    return {
      palette: parsed.palette || {},
      composition: parsed.composition || {},
      rhythm: parsed.rhythm || {},
      texture: parsed.texture || {},
      emotional_tone: parsed.emotional_tone || {},
    };
  }

  async _getLLM(pipeline) {
    try {
      const mod = await import('../llm.js');
      return mod.llm || mod.default || null;
    } catch {
      return null;
    }
  }
}
