/**
 * invariant-bus.js — 跨步骤不变量总线 (from V2, adapted for V8)
 *
 * 替代 V8 AssetBus 的散装 JSON 传递，提供类型安全的不变量读写。
 * 与 AssetBus 共存：AssetBus 管文件持久化，InvariantBus 管运行时跨步骤传递。
 *
 * 不变量所有权：
 *   - style_genome_5d: 由 Step 2 主题选择后设定（或 Step 15 风格化更新）
 *   - character_assets: 由 Step 7 主角设计后设定
 *   - consistency_context: 由 Step 5 剧本生成时初始化
 *
 * 生命周期：
 *   1. pipeline.js 在 run() 开头创建 InvariantBus 实例
 *   2. 各 Step handler 通过 bus.set...() 写入
 *   3. 后续 Step 通过 bus.get...() 读取
 *   4. 最终快照写入 workdir/invariants.json
 */

const REQUIRED_STYLE_DIMS = ['palette', 'composition', 'rhythm', 'texture', 'emotional_tone'];
const REQUIRED_CHAR_FIELDS = ['name', 'face', 'body', 'wardrobe', 'voice_profile', 'tics'];

export class InvariantBus {
  constructor() {
    this._style = null;
    this._characters = new Map(); // characterId → asset
    this._consistencyContext = null;
    this._provenance = {
      style_set_at: null,
      style_set_by_step: null,
      character_count: 0,
      consistency_context_set_at: null,
    };
  }

  // ─── style_genome_5d ───────────────────────────────────

  /**
   * 设置 5D 风格向量。
   * @param {object} styleGenome5d { palette, composition, rhythm, texture, emotional_tone }
   * @param {string} [fromStep] 记录来源步骤
   */
  setStyleGenome(styleGenome5d, fromStep = null) {
    if (!styleGenome5d || typeof styleGenome5d !== 'object') {
      throw new Error('[InvariantBus] style_genome_5d must be an object');
    }
    for (const dim of REQUIRED_STYLE_DIMS) {
      if (!(dim in styleGenome5d)) {
        throw new Error(`[InvariantBus] style_genome_5d missing dimension: ${dim}`);
      }
    }
    this._style = styleGenome5d;
    this._provenance.style_set_at = new Date().toISOString();
    this._provenance.style_set_by_step = fromStep;
  }

  getStyleGenome() {
    return this._style;
  }

  hasStyleGenome() {
    return this._style !== null;
  }

  // ─── character_assets ──────────────────────────────────

  /**
   * 添加/更新角色资产。
   * @param {string} characterId
   * @param {object} asset { name, face, body, wardrobe, voice_profile, tics }
   */
  setCharacterAsset(characterId, asset) {
    if (!characterId) throw new Error('[InvariantBus] characterId required');
    if (!asset || !asset.name) throw new Error('[InvariantBus] asset.name required');
    this._characters.set(characterId, asset);
    this._provenance.character_count = this._characters.size;
  }

  getCharacterAsset(characterId) {
    return this._characters.get(characterId) || null;
  }

  getCharacterAssets() {
    return Array.from(this._characters.values());
  }

  getCharacterIds() {
    return Array.from(this._characters.keys());
  }

  // ─── consistency_context ──────────────────────────────

  /**
   * 设置叙事一致性上下文（5区段）。
   * @param {object} ctx { character_knowledge, spatial_facts, temporal_anchor, established_relationships, universe_rules }
   */
  setConsistencyContext(ctx) {
    this._consistencyContext = ctx;
    this._provenance.consistency_context_set_at = new Date().toISOString();
  }

  getConsistencyContext() {
    return this._consistencyContext;
  }

  // ─── 工具方法 ─────────────────────────────────────────

  snapshot() {
    return {
      style_genome_5d: this._style,
      character_assets: this.getCharacterAssets(),
      consistency_context: this._consistencyContext,
      provenance: { ...this._provenance },
    };
  }

  toJSON() {
    return JSON.stringify(this.snapshot(), null, 2);
  }

  /**
   * 将快照持久化到文件。
   */
  async persistTo(workdir) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const dir = join(workdir, '.pipeline-assets');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'invariants.json'), this.toJSON());
  }

  /**
   * 从快照恢复（用于断点续跑）。
   */
  static async restoreFrom(workdir) {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    try {
      const raw = await readFile(join(workdir, '.pipeline-assets', 'invariants.json'), 'utf-8');
      const snap = JSON.parse(raw);
      const bus = new InvariantBus();
      if (snap.style_genome_5d) {
        bus._style = snap.style_genome_5d;
        bus._provenance = snap.provenance || bus._provenance;
      }
      if (snap.character_assets) {
        for (const asset of snap.character_assets) {
          if (asset.id || asset.name) {
            const id = asset.id || asset.name;
            bus._characters.set(id, asset);
          }
        }
      }
      if (snap.consistency_context) {
        bus._consistencyContext = snap.consistency_context;
      }
      return bus;
    } catch {
      return null; // 无快照，返回 null（不影响启动）
    }
  }
}

export default InvariantBus;
