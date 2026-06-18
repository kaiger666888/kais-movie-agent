/**
 * invariant-bus.js — 跨步骤不变量总线 (V2, extended with L1/L2 layered character assets)
 *
 * 替代 V8 AssetBus 的散装 JSON 传递，提供类型安全的不变量读写。
 * 与 AssetBus 共存：AssetBus 管文件持久化，InvariantBus 管运行时跨步骤传递。
 *
 * 不变量所有权：
 *   - style_genome_5d: 由 Step 2 主题选择后设定（或 Step 15 风格化更新）
 *   - character_assets: 由 Step 7 主角设计后设定（L1/L2/L3/L4 分层）
 *   - consistency_context: 由 Step 5 剧本生成时初始化
 *
 * 角色资产分层策略（2026-06-18 即梦最佳实践）：
 *   - L1 身份锚点：面部特写 1-3 张，锁定五官/骨相/发型/肤色，永不更换
 *   - L2 造型卡片：每套服装全身正面+侧面，锁定服装/道具
 *   - L3 姿势包：坐/站/走/跑等姿态
 *   - L4 表情标定：微笑/怒/惊/泪
 *   - 核心原则：角色参考只传脸（L1），智能参考传衣服/姿势（L2/L3）
 */

const REQUIRED_STYLE_DIMS = ['palette', 'composition', 'rhythm', 'texture', 'emotional_tone'];
const REQUIRED_CHAR_FIELDS = ['name', 'face', 'body', 'wardrobe', 'voice_profile', 'tics'];

export class InvariantBus {
  constructor() {
    this._style = null;
    this._characters = new Map(); // characterId → asset
    this._scenes = new Map(); // sceneId → sceneAsset
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

  // ─── character_assets（L1/L2/L3/L4 分层）───────────────

  /**
   * 添加/更新角色资产（支持 L1-L4 分层结构）。
   *
   * @param {string} characterId
   * @param {object} asset
   * @param {string} asset.name — 角色名
   * @param {object} asset.face — 面部描述
   * @param {object} asset.body — 体型描述
   * @param {object} asset.wardrobe — 服装描述
   * @param {object} asset.voice_profile — 声音特征
   * @param {object} asset.tics — 习惯动作
   * @param {object} [asset.feature_lock] — 特征锁定 { hair, eyes, clothing, distinctive }
   * @param {object} [asset.assets] — L1-L4 分层资产
   * @param {Array<{path, role, status}>} [asset.assets.L1_identity] — 身份锚点
   * @param {Object<string, {front, side}>} [asset.assets.L2_costumes] — 造型卡片
   * @param {string[]} [asset.assets.L3_poses] — 姿势包
   * @param {string[]} [asset.assets.L4_expressions] — 表情标定
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

  // ─── L1 身份锚点快捷访问 ──────────────────────────────

  /**
   * 获取角色的 L1 身份锚点路径数组。
   * 用于所有下游生成步骤的一致性锚定。
   *
   * @param {string} characterId
   * @returns {string[]} L1 身份锚点图路径
   */
  getIdentityAnchors(characterId) {
    const char = this._characters.get(characterId);
    if (!char?.assets?.L1_identity) return [];
    return char.assets.L1_identity
      .filter(img => img.status === 'approved')
      .map(img => img.path);
  }

  /**
   * 获取角色指定造型的 L2 造型卡片路径。
   *
   * @param {string} characterId
   * @param {string} [costumeId] — 造型标识（如 "default"），不传返回所有
   * @returns {string[]|Object<string, string[]>} 造型卡片路径
   */
  getCostumeImages(characterId, costumeId) {
    const char = this._characters.get(characterId);
    if (!char?.assets?.L2_costumes) return costumeId ? [] : {};

    if (costumeId) {
      const costume = char.assets.L2_costumes[costumeId];
      if (!costume) return [];
      return [costume.front?.path, costume.side?.path].filter(Boolean);
    }

    // 返回所有造型
    const result = {};
    for (const [cid, costume] of Object.entries(char.assets.L2_costumes)) {
      result[cid] = [costume.front?.path, costume.side?.path].filter(Boolean);
    }
    return result;
  }

  /**
   * 获取角色的 compositions 参考图包（L1 + L2 组合）。
   * 用于图片生成阶段传入 compositions API。
   *
   * @param {string} characterId
   * @param {string} [costumeId]
   * @returns {{ images: string[], identityImages: string[], costumeImages: string[] }}
   */
  getReferencePack(characterId, costumeId) {
    const identityImages = this.getIdentityAnchors(characterId);
    const costumeImages = costumeId
      ? (this.getCostumeImages(characterId, costumeId) || [])
      : Object.values(this.getCostumeImages(characterId) || {}).flat();

    return {
      images: [...identityImages, ...costumeImages],
      identityImages,
      costumeImages,
    };
  }

  /**
   * 获取角色的 feature_lock。
   *
   * @param {string} characterId
   * @returns {object|null} { hair, eyes, clothing, distinctive }
   */
  getFeatureLock(characterId) {
    const char = this._characters.get(characterId);
    return char?.feature_lock || null;
  }

  /**
   * 检查角色是否有完整的 L1 身份锚点（可用于下游生成）。
   *
   * @param {string} characterId
   * @returns {boolean}
   */
  hasIdentityAnchors(characterId) {
    return this.getIdentityAnchors(characterId).length >= 1;
  }

  // ─── scene_assets（场景资产）────────────────────────────

  /**
   * 设置场景资产（由 Step 9 场景设计后设定）。
   *
   * @param {string} sceneId
   * @param {object} asset — 场景资产（含 atmosphere, establishing, keyframes, props 等）
   */
  setSceneAsset(sceneId, asset) {
    if (!sceneId) throw new Error('[InvariantBus] sceneId required');
    this._scenes.set(sceneId, asset);
  }

  /**
   * 获取场景资产。
   * @param {string} sceneId
   * @returns {object|null}
   */
  getSceneAsset(sceneId) {
    return this._scenes.get(sceneId) || null;
  }

  /**
   * 获取场景的氛围定调图 URL。
   * @param {string} sceneId
   * @returns {string|null}
   */
  getSceneAtmosphere(sceneId) {
    const scene = this._scenes.get(sceneId);
    return scene?.atmosphere?.url || null;
  }

  /**
   * 获取场景的空间全景图 URL。
   * @param {string} sceneId
   * @returns {string|null}
   */
  getSceneEstablishing(sceneId) {
    const scene = this._scenes.get(sceneId);
    return scene?.establishing?.url || null;
  }

  /**
   * 获取场景的空间锚点。
   * @param {string} sceneId
   * @returns {object|null}
   */
  getSceneSpatialAnchors(sceneId) {
    const scene = this._scenes.get(sceneId);
    return scene?.spatial_anchors || null;
  }

  /**
   * 检查是否已有场景资产。
   * @returns {boolean}
   */
  hasSceneAssets() {
    return this._scenes.size > 0;
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
      scene_assets: Array.from(this._scenes.entries()).map(([id, asset]) => ({ id, ...asset })),
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
      if (snap.scene_assets) {
        for (const sa of snap.scene_assets) {
          const id = sa.id || sa.sceneName;
          if (id) bus._scenes.set(id, sa);
        }
      }
      return bus;
    } catch {
      return null; // 无快照，返回 null（不影响启动）
    }
  }
}

export default InvariantBus;
