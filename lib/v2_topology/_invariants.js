/**
 * _invariants.js — Cross-cutting invariant bus for v2.0 PRFP DAG
 *
 * Per Phase 8 §1.4 (cross_cutting_invariant edges): style_genome +
 * character_designer outputs flow to all downstream consumers as invariants.
 *
 * This replaces V8's JSON asset bus pattern with explicit invariant ownership:
 *   - style_genome OWNS style_genome_5d (5D vector: palette + composition + rhythm + texture + emotional_tone)
 *   - character_designer OWNS character_assets (identity asset)
 *   - Phase 14 will add: creative_source owns consistency_context
 *
 * Lifecycle:
 *   1. v2_pipeline creates fresh InvariantBus per run
 *   2. style_genome node calls bus.setStyleGenome(...) after computing 5D vector
 *   3. character_designer node calls bus.setCharacterAssets(...) after defining identities
 *   4. All downstream nodes call bus.getStyleGenome() / bus.getCharacterAssets()
 *   5. Final state is written to workdir/invariants.json for traceability
 */
export class InvariantBus {
  constructor() {
    this._style = null;
    this._characters = new Map(); // character_id → asset
    this._consistencyContext = null; // Phase 14
    this._provenance = {
      style_set_at: null,
      character_count: 0,
      consistency_context_set_at: null,
    };
  }

  /**
   * style_genome node sets 5D vector.
   * @param {object} styleGenome5d { palette, composition, rhythm, texture, emotional_tone }
   */
  setStyleGenome(styleGenome5d) {
    if (!styleGenome5d || typeof styleGenome5d !== 'object') {
      throw new Error('[InvariantBus] style_genome_5d must be an object');
    }
    for (const dim of ['palette', 'composition', 'rhythm', 'texture', 'emotional_tone']) {
      if (!(dim in styleGenome5d)) {
        throw new Error(`[InvariantBus] style_genome_5d missing dimension: ${dim}`);
      }
    }
    this._style = styleGenome5d;
    this._provenance.style_set_at = new Date().toISOString();
  }

  /**
   * Get style_genome for downstream consumers.
   * @returns {object|null}
   */
  getStyleGenome() {
    return this._style;
  }

  /**
   * character_designer node adds/updates a character asset.
   * @param {string} characterId
   * @param {object} asset { name, face, body, wardrobe, voice_profile, tics }
   */
  setCharacterAsset(characterId, asset) {
    if (!characterId) throw new Error('[InvariantBus] characterId required');
    if (!asset || !asset.name) throw new Error('[InvariantBus] asset.name required');
    this._characters.set(characterId, asset);
    this._provenance.character_count = this._characters.size;
  }

  /**
   * Get a specific character asset by ID.
   */
  getCharacterAsset(characterId) {
    return this._characters.get(characterId) || null;
  }

  /**
   * Get all character assets as an array.
   */
  getCharacterAssets() {
    return Array.from(this._characters.values());
  }

  /**
   * Phase 14: creative_source sets consistency_context.
   * Stubbed here; Phase 14 will fully implement.
   */
  setConsistencyContext(ctx) {
    this._consistencyContext = ctx;
    this._provenance.consistency_context_set_at = new Date().toISOString();
  }

  getConsistencyContext() {
    return this._consistencyContext;
  }

  /**
   * Snapshot for debugging / trace.
   */
  snapshot() {
    return {
      style_genome_5d: this._style,
      character_assets: this.getCharacterAssets(),
      consistency_context: this._consistencyContext,
      provenance: { ...this._provenance },
    };
  }

  /**
   * Serialize to JSON for workdir persistence.
   */
  toJSON() {
    return JSON.stringify(this.snapshot(), null, 2);
  }
}
