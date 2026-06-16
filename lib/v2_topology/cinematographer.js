/**
 * cinematographer — Layer 2 visual intent (composition_lock per Phase 7 §3.4 D3.4)
 * v2.0 PRFP core_task (per 02-NODE-SPECS §2.6):
 *   把 intent 翻译为视觉 intent (镜头列表 + 灯光 + 构图 + composition_lock)
 *
 * Sub-steps (per Phase 7 §3.4 D3.4 + migration matrix):
 *   1. mise_en_scene — scene-design (V8 Step 6 folded)
 *   2. shot_list — shooting-script / storyboard folded (V8 Steps 7-8 folded)
 *   3. composition_lock_preview — camera preview (V8 Step 10 folded)
 *
 * Inputs from upstream invariants:
 *   - screenplay_full (Layer 2 sibling)
 *   - style_genome_5d (Layer 1 invariant)
 *   - character_assets (Layer 1 invariant)
 *
 * Phase 11 native v2.0 implementation.
 */
import { NodeBase } from './_node-base.js';

export class Cinematographer extends NodeBase {
  constructor(spec) {
    super({
      id: 'cinematographer',
      layer: 2,
      role: 'visual_intent',
      v8PassthroughTargets: [],
      spec,
    });
    this.isV2Native = true;
  }

  async run(pipeline, inputs = {}) {
    const {
      screenplay_full,
      invariants = null,
    } = inputs;

    if (!screenplay_full) {
      throw new Error('[cinematographer] Missing required input: screenplay_full');
    }

    const styleGenome = invariants?.getStyleGenome?.() || null;
    const characterAssets = invariants?.getCharacterAssets?.() || [];

    // Sub-step 1: mise_en_scene
    const miseEnScene = await this._designMiseEnScene(pipeline, screenplay_full, styleGenome);

    // Sub-step 2: shot_list (storyboard folded in per D3.4)
    const shotList = await this._generateShotList(pipeline, screenplay_full, miseEnScene, styleGenome);

    // Sub-step 3: composition_lock_preview
    const compositionLock = this._lockComposition(shotList, styleGenome);

    return {
      node_id: this.id,
      is_v2_native: true,
      visual_intent: {
        mise_en_scene: miseEnScene,
        shot_list: shotList,
        composition_lock: compositionLock,
      },
      consumed_invariants: {
        style_genome: !!styleGenome,
        character_assets: characterAssets.length,
      },
      composition_lock_adherence_target: 0.85,
      axis_compliance_target: 1.0,
      schema_version: 'design-2026-06-16-prfp',
    };
  }

  async _designMiseEnScene(pipeline, screenplay, styleGenome) {
    const llm = await this._getLLM(pipeline);
    if (!llm) {
      return {
        locations: (screenplay.scene_list || []).map((s, i) => ({
          scene_id: s.scene_id || `scene_${i}`,
          setting: s.location || '[stub] location',
          lighting_setup: styleGenome?.emotional_tone?.lighting_mood || 'natural',
          color_palette: styleGenome?.palette?.primary_hex || '#3A506B',
        })),
        _stub: true,
      };
    }

    try {
      const llmOutput = await llm.call({
        prompt: `Design mise-en-scène for each scene.

Screenplay: ${JSON.stringify(screenplay)}
Style genome: ${JSON.stringify(styleGenome)}

Return JSON: { locations: [{ scene_id, setting, lighting_setup, color_palette }] }`,
        max_tokens: 1000,
      });
      return JSON.parse(llmOutput);
    } catch {
      return { locations: [], _parse_error: true };
    }
  }

  async _generateShotList(pipeline, screenplay, miseEnScene, styleGenome) {
    const llm = await this._getLLM(pipeline);
    if (!llm) {
      return (screenplay.scene_list || []).map((scene, i) => ({
        shot_id: `shot_${i + 1}`,
        scene_id: scene.scene_id || `scene_${i}`,
        shot_type: i === 0 ? 'establishing_wide' : 'medium',
        framing: styleGenome?.composition?.framing_pattern || 'rule_of_thirds',
        duration_s: scene.duration_s || 3,
        axis: '180_rule_compliant',
      }));
    }

    try {
      const llmOutput = await llm.call({
        prompt: `Generate shot list for each scene.

Screenplay: ${JSON.stringify(screenplay)}
Mise-en-scène: ${JSON.stringify(miseEnScene)}

Return JSON: array of { shot_id, scene_id, shot_type, framing, duration_s, axis }
Ensure 180° rule compliance.`,
        max_tokens: 1200,
      });
      const parsed = JSON.parse(llmOutput);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _lockComposition(shotList, styleGenome) {
    // Composition lock: freeze shot parameters before generation
    // per D3.4 "storyboard folded into composition_lock"
    return {
      locked_at: new Date().toISOString(),
      shot_count: shotList.length,
      style_genome_version: styleGenome ? 'design-2026-06-16-prfp' : null,
      locked_shots: shotList.map(s => ({
        shot_id: s.shot_id,
        framing: s.framing,
        duration_s: s.duration_s,
        axis: s.axis,
      })),
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
