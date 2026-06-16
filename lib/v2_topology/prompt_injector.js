/**
 * prompt_injector — Layer 3 cross-cutting consistency context (NEW, no V8 precedent)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.7):
 *   把 intent 翻译为 model-ready prompt + cross-call consistency context
 *
 * AI-native node — translates visual_intent into concrete model prompts
 * while carrying style + identity invariants across calls.
 *
 * Inputs from upstream invariants:
 *   - visual_intent (Layer 2 sibling)
 *   - style_genome_5d (Layer 1 invariant)
 *   - character_assets (Layer 1 invariant)
 *
 * Outputs:
 *   - model_prompts: per-shot prompts with embedded invariants
 *   - consistency_context: cross-call carry context
 *
 * Phase 11 native v2.0 implementation.
 */
import { NodeBase } from './_node-base.js';

const MAX_TOKENS_PER_CALL = 4000;

export class PromptInjector extends NodeBase {
  constructor(spec) {
    super({
      id: 'prompt_injector',
      layer: 3,
      role: 'cross_cutting',
      v8PassthroughTargets: [], // NEW node, no V8 precedent
      spec,
    });
    this.isV2Native = true;
  }

  async run(pipeline, inputs = {}) {
    const {
      visual_intent,
      invariants = null,
    } = inputs;

    if (!visual_intent) {
      throw new Error('[prompt_injector] Missing required input: visual_intent');
    }

    const styleGenome = invariants?.getStyleGenome?.() || null;
    const characterAssets = invariants?.getCharacterAssets?.() || [];

    const modelPrompts = this._buildModelPrompts(visual_intent, styleGenome, characterAssets);
    const consistencyContext = this._buildConsistencyContext(styleGenome, characterAssets);

    return {
      node_id: this.id,
      is_v2_native: true,
      model_prompts: modelPrompts,
      consistency_context: consistencyContext,
      prompt_token_efficiency: {
        max_per_call: MAX_TOKENS_PER_CALL,
        estimated_per_call: this._estimateTokens(modelPrompts),
      },
      cross_call_consistency_target: 0.85,
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  /**
   * Build per-shot model prompts with embedded invariants.
   * Strategy: combine shot metadata + style descriptors + character anchors
   * into a single prompt per shot.
   */
  _buildModelPrompts(visualIntent, styleGenome, characterAssets) {
    const shots = visualIntent.shot_list || [];
    const styleSuffix = this._renderStyleSuffix(styleGenome);
    const characterSuffix = this._renderCharacterSuffix(characterAssets);

    return shots.map(shot => {
      const basePrompt = this._renderShotBase(shot);
      const fullPrompt = `${basePrompt}\n\nStyle invariants:\n${styleSuffix}\n\nCharacter identity:\n${characterSuffix}`;
      const negativePrompt = this._renderNegativePrompt(styleGenome);

      return {
        shot_id: shot.shot_id,
        scene_id: shot.scene_id,
        prompt: fullPrompt,
        negative_prompt: negativePrompt,
        estimated_tokens: this._estimateTokens({ prompt: fullPrompt }),
        token_efficient: this._estimateTokens({ prompt: fullPrompt }) <= MAX_TOKENS_PER_CALL,
      };
    });
  }

  _renderShotBase(shot) {
    const parts = [
      `Shot: ${shot.shot_type || 'medium'}`,
      `Framing: ${shot.framing || 'rule_of_thirds'}`,
      `Duration: ${shot.duration_s || 3}s`,
    ];
    if (shot.axis) parts.push(`Axis: ${shot.axis}`);
    return parts.join('\n');
  }

  _renderStyleSuffix(styleGenome) {
    if (!styleGenome) return '[no style invariants carried]';
    return [
      `Palette: ${styleGenome.palette?.primary_hex || '?'}/${styleGenome.palette?.secondary_hex || '?'}/${styleGenome.palette?.accent_hex || '?'}`,
      `Composition: ${styleGenome.composition?.framing_pattern || '?'} (${styleGenome.composition?.dominant_technique || '?'})`,
      `Rhythm: ${styleGenome.rhythm?.pacing_pattern || '?'} @ ${styleGenome.rhythm?.avg_shot_duration_s || '?'}s avg`,
      `Texture: ${styleGenome.texture?.finish_quality || '?'} (grain ${styleGenome.texture?.grain_level || '?'})`,
      `Emotional tone: ${styleGenome.emotional_tone?.lighting_mood || '?'} @ ${styleGenome.emotional_tone?.color_temperature_k || '?'}K`,
    ].join('\n');
  }

  _renderCharacterSuffix(characterAssets) {
    if (!characterAssets || characterAssets.length === 0) return '[no characters defined]';
    return characterAssets.map(c => [
      `${c.name} (${c.id}):`,
      `  Face: ${c.face?.ethnicity || '?'} ${c.face?.age_range || '?'}, ${c.face?.hair || '?'}`,
      `  Body: ${c.body?.build || '?'} ${c.body?.posture || '?'}`,
      `  Wardrobe: ${c.wardrobe?.primary_outfit || '?'} (${(c.wardrobe?.color_palette || []).join('/')})`,
      `  Voice: ${c.voice_profile?.tone || '?'} ${c.voice_profile?.pitch || '?'}`,
      `  Tics: ${(c.tics || []).slice(0, 2).join('; ')}`,
    ].join('\n')).join('\n\n');
  }

  _renderNegativePrompt(styleGenome) {
    const base = 'low quality, blurry, distorted, extra limbs, watermark';
    const moodNeg = styleGenome?.emotional_tone?.lighting_mood === 'cheerful'
      ? ', dark, gloomy'
      : ', oversaturated';
    return base + moodNeg;
  }

  /**
   * Build cross-call consistency context.
   * This is what gets carried between generation calls to prevent drift.
   */
  _buildConsistencyContext(styleGenome, characterAssets) {
    return {
      schema_version: 'design-2026-06-16-prfp',
      style_fingerprint: styleGenome ? {
        palette_hash: this._hash(JSON.stringify(styleGenome.palette)),
        composition_hash: this._hash(JSON.stringify(styleGenome.composition)),
      } : null,
      character_fingerprints: characterAssets.map(c => ({
        id: c.id,
        name: c.name,
        identity_anchor_4d: c.identity_anchor_4d,
      })),
      carry_strategy: 'per_shot_prompt_suffix',
    };
  }

  _estimateTokens(obj) {
    // Rough estimate: 1 token ~ 4 chars
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return Math.ceil(text.length / 4);
  }

  _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return `fp_${Math.abs(h).toString(36)}`;
  }
}
