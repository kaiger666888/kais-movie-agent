/**
 * character_designer — Layer 1 intent_parallel (character identity)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.5):
 *   定义 + 维护角色 identity asset (face, body, wardrobe, voice, tics)
 *   + 4D anchor system (per STACK §3.4 — 4D Blender anchor for identity lock)
 *
 * Cross-cutting invariant owner: character identity
 * Downstream consumers: cinematographer, prompt_injector, visual_executor, continuity_auditor
 *
 * Phase 11 native v2.0 implementation.
 */
import { NodeBase } from './_node-base.js';

export class CharacterDesigner extends NodeBase {
  constructor(spec) {
    super({
      id: 'character_designer',
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
      throw new Error('[character_designer] Missing required input: story_kernel');
    }

    const characterAssets = await this._defineCharacterAssets(pipeline, story_kernel);

    // Publish each character to invariant bus
    if (invariants && typeof invariants.setCharacterAsset === 'function') {
      for (const asset of characterAssets) {
        invariants.setCharacterAsset(asset.id, asset);
      }
    }

    return {
      node_id: this.id,
      is_v2_native: true,
      character_assets: characterAssets,
      published_to_invariants: !!invariants,
      identity_match_target: 0.85, // per spec success criterion
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  async _defineCharacterAssets(pipeline, kernel) {
    const llm = await this._getLLM(pipeline);

    if (!llm) {
      return this._stubAssets(kernel);
    }

    try {
      const llmOutput = await llm.call({
        prompt: `Define character identity assets for this story kernel.

Kernel: ${JSON.stringify(kernel)}

Return JSON: array of characters, each with:
- id: stable character ID (snake_case)
- name: display name
- face: { ethnicity, age_range, hair, distinguishing_features }
- body: { height_range, build, posture }
- wardrobe: { primary_outfit, color_palette, accessories }
- voice_profile: { tone, pitch, accent, pace }
- tics: behavioral_tics (array of 2-3 specific gestures)
- identity_anchor_4d: { anchor_type: 'blender_pose', reference_pose_id }

Focus on 2-4 main characters.`,
        max_tokens: 1500,
      });
      const parsed = JSON.parse(llmOutput);
      return Array.isArray(parsed) ? parsed.map(this._normalizeAsset) : [];
    } catch {
      return this._stubAssets(kernel);
    }
  }

  _stubAssets(kernel) {
    return [
      {
        id: 'protagonist',
        name: 'Protagonist',
        face: { ethnicity: 'unspecified', age_range: '30-40', hair: 'unspecified', distinguishing_features: [] },
        body: { height_range: 'average', build: 'average', posture: 'upright' },
        wardrobe: { primary_outfit: 'everyday casual', color_palette: ['neutral'], accessories: [] },
        voice_profile: { tone: 'measured', pitch: 'mid', accent: 'neutral', pace: 'medium' },
        tics: ['pauses before answering', 'rubs temple when stressed'],
        identity_anchor_4d: { anchor_type: 'blender_pose', reference_pose_id: 't-pose-default' },
        _stub: true,
      },
    ];
  }

  _normalizeAsset(asset) {
    return {
      id: asset.id || `char_${Math.random().toString(36).slice(2, 8)}`,
      name: asset.name || 'Unnamed',
      face: asset.face || {},
      body: asset.body || {},
      wardrobe: asset.wardrobe || {},
      voice_profile: asset.voice_profile || {},
      tics: Array.isArray(asset.tics) ? asset.tics : [],
      identity_anchor_4d: asset.identity_anchor_4d || { anchor_type: 'blender_pose' },
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
