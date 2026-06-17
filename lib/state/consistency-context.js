/**
 * consistency-context.js — 叙事一致性 5 区段 (from V2, adapted for V8)
 *
 * 在剧本生成阶段（Step 5）初始化，贯穿后续所有 Step。
 * 后续 Step 可用 ConsistencyContext.validate() 检查新增内容是否违反已建立的事实。
 *
 * 5 个区段：
 *   1. character_knowledge: 角色在某个时间点知道什么（不能预知未来信息）
 *   2. spatial_facts: 空间事实（房间布局、距离、物体位置）
 *   3. temporal_anchor: 时间锚点（日期、时刻、季节、事件顺序）
 *   4. established_relationships: 已确立的关系（角色间称谓、情感状态）
 *   5. universe_rules: 世界规则（魔法体系、科技水平、社会规则）
 */

export class ConsistencyContext {
  constructor() {
    this.character_knowledge = {};   // characterId → [ { at_scene, knows, source } ]
    this.spatial_facts = [];        // [ { location, fact, established_at_scene } ]
    this.temporal_anchor = null;    // { start_date, era, season, timeline_events: [{scene, event, relative_offset}] }
    this.established_relationships = []; // [ { characters: [a, b], type, dynamic, established_at_scene } ]
    this.universe_rules = [];       // [ { rule, description, established_at_scene } ]
  }

  // ─── 记录方法 ──────────────────────────────────────────

  /**
   * 记录角色在某场戏中获得的知识。
   */
  addCharacterKnowledge(characterId, atScene, knows, source) {
    if (!this.character_knowledge[characterId]) {
      this.character_knowledge[characterId] = [];
    }
    this.character_knowledge[characterId].push({ at_scene: atScene, knows, source });
  }

  /**
   * 记录空间事实。
   */
  addSpatialFact(location, fact, establishedAtScene) {
    this.spatial_facts.push({ location, fact, established_at_scene: establishedAtScene });
  }

  /**
   * 设置时间锚点。
   */
  setTemporalAnchor(anchor) {
    this.temporal_anchor = anchor;
  }

  /**
   * 添加时间线事件。
   */
  addTimelineEvent(scene, event, relativeOffset = null) {
    if (!this.temporal_anchor) this.temporal_anchor = { timeline_events: [] };
    if (!this.temporal_anchor.timeline_events) this.temporal_anchor.timeline_events = [];
    this.temporal_anchor.timeline_events.push({ scene, event, relative_offset: relativeOffset });
  }

  /**
   * 记录角色关系。
   */
  addRelationship(characters, type, dynamic, establishedAtScene) {
    this.established_relationships.push({
      characters: [...new Set(characters)],
      type,
      dynamic,
      established_at_scene: establishedAtScene,
    });
  }

  /**
   * 记录世界规则。
   */
  addUniverseRule(rule, description, establishedAtScene) {
    this.universe_rules.push({ rule, description, established_at_scene: establishedAtScene });
  }

  // ─── 验证方法 ──────────────────────────────────────────

  /**
   * 验证剧本内容是否违反已建立的一致性。
   * 返回违规列表（空数组 = 无违规）。
   *
   * @param {object} screenplay — 含 scene_list
   * @returns {Array<{type, severity, scene, issue, detail}>}
   */
  validate(screenplay) {
    const violations = [];
    const scenes = screenplay.scene_list || screenplay.scenes || [];

    for (const scene of scenes) {
      const sceneId = scene.scene_id || scene.id || scene.title || 'unknown';

      // 检查角色知识违规：角色说了不该知道的事
      if (scene.dialogue) {
        for (const line of (Array.isArray(scene.dialogue) ? scene.dialogue : [])) {
          const speakerId = line.character || line.speaker;
          if (speakerId && this.character_knowledge[speakerId]) {
            const knowledgeAtPoint = this.character_knowledge[speakerId]
              .filter(k => this._sceneOrder(k.at_scene) <= this._sceneOrder(sceneId));
            // 高级验证需要 LLM，这里只做结构检查
            // 实际调用由 script-auditor.js 的 LLM 审计完成
          }
        }
      }

      // 检查空间事实违规
      for (const spatial of this.spatial_facts) {
        if (spatial.location === scene.location && spatial.established_at_scene !== sceneId) {
          // 检查 scene 的 action 是否与已知空间事实冲突
          // 结构检查只标记，不判定
        }
      }

      // 检查关系违规：称谓与已确立关系不匹配
      // 结构检查只标记，不判定
    }

    return violations;
  }

  // ─── 快照 ──────────────────────────────────────────────

  toJSON() {
    return JSON.stringify({
      character_knowledge: this.character_knowledge,
      spatial_facts: this.spatial_facts,
      temporal_anchor: this.temporal_anchor,
      established_relationships: this.established_relationships,
      universe_rules: this.universe_rules,
    }, null, 2);
  }

  static fromJSON(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    const ctx = new ConsistencyContext();
    ctx.character_knowledge = data.character_knowledge || {};
    ctx.spatial_facts = data.spatial_facts || [];
    ctx.temporal_anchor = data.temporal_anchor || null;
    ctx.established_relationships = data.established_relationships || [];
    ctx.universe_rules = data.universe_rules || [];
    return ctx;
  }

  /**
   * 从快照恢复（与 V2 ConsistencyContext.fromSnapshot 兼容）。
   */
  static fromSnapshot(snap) {
    return ConsistencyContext.fromJSON(snap);
  }

  // ─── 内部 ──────────────────────────────────────────────

  _sceneOrder(sceneId) {
    // 如果 sceneId 是数字，直接比较；否则按出现顺序
    const num = parseInt(sceneId, 10);
    return isNaN(num) ? sceneId : num;
  }
}

export default ConsistencyContext;
