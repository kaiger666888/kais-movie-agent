/**
 * consistency-context.js — 5-section schema for narrative coherence
 *
 * Per 04-LLM-CREATIVE-DISTILLATION.md §2.1, consistency_context is a
 * structured representation of established facts that downstream generation
 * nodes (screenplay, creative_source) must respect.
 *
 * 5 sections:
 *   1. character_knowledge_state — what each character knows at each scene
 *   2. timeline — event causal chain (causes + effects)
 *   3. stakes — established stakes with payoff expectations
 *   4. spatial_layout — scene spatial invariants
 *   5. emotional_arc — emotional transitions
 *
 * Used by:
 *   - screenplay (input: respects established facts; output: updated context)
 *   - script_auditor (6th dim: consistency_context_violations; threshold = 0)
 *
 * Phase 14 native v2.0 implementation.
 */

export class ConsistencyContext {
  constructor() {
    this.schema_version = 'design-2026-06-16-prfp';
    this.character_knowledge_state = new Map();
    this.timeline = { events: new Map() };
    this.stakes = new Map();
    this.spatial_layout = new Map();
    this.emotional_arc = new Map();
    this._violations = [];
  }

  /**
   * Section 1: Character knowledge state.
   * @param {string} characterId
   * @param {string} atScene
   * @param {string[]} knows — fact IDs the character knows at this scene
   * @param {string[]} doesNotKnow — fact IDs the character does NOT know
   */
  setCharacterKnowledge(characterId, atScene, { knows = [], doesNot_know = [], does_not_know = [] } = {}) {
    if (!characterId || !atScene) {
      throw new Error('[ConsistencyContext.setCharacterKnowledge] characterId + atScene required');
    }
    const doesNotKnow = does_not_know || doesNot_know;
    if (!this.character_knowledge_state.has(characterId)) {
      this.character_knowledge_state.set(characterId, new Map());
    }
    this.character_knowledge_state.get(characterId).set(atScene, {
      knows: Array.isArray(knows) ? knows : [],
      does_not_know: Array.isArray(doesNotKnow) ? doesNotKnow : [],
    });
  }

  /**
   * Section 2: Timeline event.
   * @param {object} event { id, occurs_at, causes: [], effects: [] }
   */
  addEvent(event) {
    if (!event?.id || !event.occurs_at) {
      throw new Error('[ConsistencyContext.addEvent] event.id + event.occurs_at required');
    }
    this.timeline.events.set(event.id, {
      id: event.id,
      occurs_at: event.occurs_at,
      causes: Array.isArray(event.causes) ? event.causes : [],
      effects: Array.isArray(event.effects) ? event.effects : [],
    });
  }

  /**
   * Section 3: Stake.
   * @param {object} stake { stake_id, established_at, payoff_expected_at, payoff_type }
   */
  addStake(stake) {
    if (!stake?.stake_id) {
      throw new Error('[ConsistencyContext.addStake] stake_id required');
    }
    this.stakes.set(stake.stake_id, {
      stake_id: stake.stake_id,
      established_at: stake.established_at || null,
      payoff_expected_at: stake.payoff_expected_at || 'unresolved',
      payoff_type: stake.payoff_type || 'emotional',
    });
  }

  /**
   * Section 4: Spatial layout.
   * @param {string} sceneId
   * @param {object} layout { layout, character_positions, invariant }
   */
  setSpatialLayout(sceneId, { layout = null, character_positions = {}, invariant = null } = {}) {
    if (!sceneId) throw new Error('[ConsistencyContext.setSpatialLayout] sceneId required');
    this.spatial_layout.set(sceneId, {
      layout,
      character_positions,
      invariant,
    });
  }

  /**
   * Section 5: Emotional arc entry.
   * @param {string} sceneId
   * @param {object} arc { target_emotion, transition_from, intensity }
   */
  addEmotionalArc(sceneId, { target_emotion, transition_from = null, intensity = 0.5 } = {}) {
    if (!sceneId) throw new Error('[ConsistencyContext.addEmotionalArc] sceneId required');
    if (typeof intensity !== 'number' || intensity < 0 || intensity > 1) {
      throw new Error('[ConsistencyContext.addEmotionalArc] intensity must be 0-1');
    }
    this.emotional_arc.set(sceneId, {
      target_emotion,
      transition_from,
      intensity,
    });
  }

  /**
   * Validate a screenplay against this context.
   * Returns list of violations (empty if compliant).
   *
   * Per §2.2 logic-critic checks:
   *   - no character knows fact they should not know
   *   - no event happens before its causal antecedent
   *   - no stake mentioned that was never established
   *   - no spatial-layout violation
   *   - no emotional-arc discontinuity
   *
   * @param {object} screenplay — screenplay_full from screenplay node
   * @returns {Array<{type, at, description, suggested_fix}>}
   */
  validate(screenplay) {
    const violations = [];

    // Stub validation (production: LLM + structural checks per ConStory-Bench)
    if (!screenplay?.scene_list) return violations;

    // Check 1: character knowledge state referenced in dialogue
    for (const scene of screenplay.scene_list) {
      const sceneId = scene.scene_id;
      for (const charId of scene.characters || []) {
        const knowledge = this.character_knowledge_state.get(charId)?.get(sceneId);
        if (knowledge) {
          for (const factId of knowledge.does_not_know) {
            // If dialogue mentions fact character shouldn't know → violation
            const dialogue = (scene.dialogue || []).join(' ').toLowerCase();
            if (dialogue.includes(factId.toLowerCase())) {
              violations.push({
                type: 'character_knows_forbidden_fact',
                at: { scene_id: sceneId, character_id: charId },
                description: `Character ${charId} mentions fact ${factId} in scene ${sceneId}, but per consistency_context they should not know it`,
                suggested_fix: `Remove reference to ${factId} from ${charId}'s dialogue, or revise character_knowledge_state`,
              });
            }
          }
        }
      }
    }

    // Check 2: event causal order
    // (Stub — production: full causal graph analysis)

    // Check 3: stakes payoff
    // (Stub — production: check all stakes have payoffs in expected scenes)

    // Check 4: spatial layout consistency (stub)
    // Check 5: emotional arc continuity (stub)

    this._violations = violations;
    return violations;
  }

  /**
   * Serialize to JSON for invariant bus propagation.
   */
  snapshot() {
    return {
      schema_version: this.schema_version,
      character_knowledge_state: Array.from(this.character_knowledge_state.entries()).map(
        ([charId, sceneMap]) => ({
          character_id: charId,
          scenes: Array.from(sceneMap.entries()).map(([sceneId, k]) => ({
            at_scene: sceneId,
            knows: k.knows,
            does_not_know: k.does_not_know,
          })),
        })
      ),
      timeline: { events: Array.from(this.timeline.events.values()) },
      stakes: Array.from(this.stakes.values()),
      spatial_layout: Array.from(this.spatial_layout.entries()).map(([id, l]) => ({ scene_id: id, ...l })),
      emotional_arc: Array.from(this.emotional_arc.entries()).map(([id, a]) => ({ scene_id: id, ...a })),
      violations: this._violations,
    };
  }

  toJSON() {
    return JSON.stringify(this.snapshot(), null, 2);
  }

  /**
   * Reconstruct from snapshot.
   */
  static fromSnapshot(snap) {
    const ctx = new ConsistencyContext();
    if (!snap) return ctx;
    for (const charEntry of snap.character_knowledge_state || []) {
      for (const sceneEntry of charEntry.scenes || []) {
        ctx.setCharacterKnowledge(charEntry.character_id, sceneEntry.at_scene, {
          knows: sceneEntry.knows,
          does_not_know: sceneEntry.does_not_know,
        });
      }
    }
    for (const event of snap.timeline?.events || []) ctx.addEvent(event);
    for (const stake of snap.stakes || []) ctx.addStake(stake);
    for (const sl of snap.spatial_layout || []) {
      ctx.setSpatialLayout(sl.scene_id, {
        layout: sl.layout,
        character_positions: sl.character_positions,
        invariant: sl.invariant,
      });
    }
    for (const arc of snap.emotional_arc || []) {
      ctx.addEmotionalArc(arc.scene_id, {
        target_emotion: arc.target_emotion,
        transition_from: arc.transition_from,
        intensity: arc.intensity,
      });
    }
    return ctx;
  }
}
