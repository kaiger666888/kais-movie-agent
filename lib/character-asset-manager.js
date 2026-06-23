/**
 * character-asset-manager.js — L1/L2/L3/L4 分层角色资产管理器
 *
 * 基于"双参考系统"策略：
 *   L1 身份锚点（Identity Anchor）— 面部特写 1-3 张，永不更换
 *   L2 造型卡片（Costume Sheet）— 全身正面+侧面，每套服装独立一组
 *   L3 姿势包（Pose Pack）— 坐/站/走/跑等姿态参考
 *   L4 表情标定（Expression）— 表情特写，表情戏时使用
 *
 * 核心原则：
 *   - 角色参考只传脸（L1）
 *   - 智能参考传衣服/姿势（L2/L3）
 *   - 一造型一卡片，不混放
 */

import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { computePHash, hammingDistance, pHashSimilarity } from './perceptual-hash.js';

/** 参考图黄金标准 */
const GOLDEN_STANDARD = {
  lighting: '柔和均匀，无强烈侧光/顶光',
  angle: '正面或微侧（<30°），平视',
  expression: '中性，微闭嘴唇',
  background: '浅灰纯色（#D3D3D3）或柔光白',
  quality: '高清，无压缩噪点，无滤镜',
  occlusion: '无墨镜、手托脸、前景遮挡',
};

export class CharacterAssetManager {
  /**
   * @param {string} baseDir — 角色资产根目录（如项目 workdir/characters/）
   * @param {object} [opts]
   * @param {string} [opts.libraryRoot] — 跨剧集资产库根路径
   *   默认: {dirname(baseDir)}/.shared/character-library/
   * @param {object} [opts.gtClient] — gold-team client (DINOv2 embedding 注入, 测试用)
   * @param {function} [opts.fetchPixels] — pHash resize+grayscale provider
   *   (gold-team image_resize wrapper), 测试用 mock
   * @param {number} [opts.dinov2Threshold=0.92] — DINOv2 cosine 命中阈值
   * @param {number} [opts.phashThreshold=0.85] — pHash similarity 命中阈值 (hamming<=10)
   * @param {boolean} [opts.skipHumanGate=false] — 紧急关闭 human gate
   */
  constructor(baseDir, opts = {}) {
    this.baseDir = baseDir;
    this._gtClient = opts.gtClient || null;
    this._fetchPixels = opts.fetchPixels || null;
    this.dinov2Threshold = opts.dinov2Threshold ?? 0.92;
    this.phashThreshold = opts.phashThreshold ?? 0.85;  // 1 - 10/64 ≈ 0.844
    this.skipHumanGate = opts.skipHumanGate === true;

    // 跨剧集资产库根路径: 默认 {baseDir 父目录}/.shared/character-library/
    this.libraryRoot = opts.libraryRoot || join(dirname(baseDir), '.shared', 'character-library');
  }

  // ─── L1 身份锚点 ─────────────────────────────────────────

  /**
   * 获取角色的 L1 身份锚点图列表。
   * L1 是锁定五官的核心参考，在所有生成中保持不变。
   *
   * 优先从 manifest.json 读取 (路径可能是 URL, 不在本地文件系统),
   * 若 manifest 不存在则降级到目录扫描。
   *
   * @param {string} characterId
   * @returns {Promise<string[]>} L1 图片路径数组
   */
  async getIdentityAnchors(characterId) {
    const dir = join(this.baseDir, characterId, 'L1_identity');
    // 优先读 manifest (支持 URL 路径, 幂等检测)
    try {
      const manifestPath = join(dir, 'manifest.json');
      const raw = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(raw);
      if (Array.isArray(manifest.images) && manifest.images.length) {
        return manifest.images.map(img => (typeof img === 'string' ? img : img.path));
      }
    } catch { /* manifest missing — fall through */ }
    return this._listImages(dir);
  }

  /**
   * 注册 L1 身份锚点。
   * 将已生成的面部特写图标记为角色的身份锚点。
   *
   * @param {string} characterId
   * @param {string[]} imagePaths — 1-3 张面部特写图路径
   */
  async registerIdentityAnchors(characterId, imagePaths) {
    if (!imagePaths?.length) throw new Error('L1 身份锚点至少需要 1 张图');
    if (imagePaths.length > 3) throw new Error('L1 身份锚点最多 3 张图');

    const manifest = {
      level: 'L1',
      type: 'identity_anchor',
      characterId,
      description: '面部/半身特写，用于锁定五官/骨相/发型/肤色',
      goldenStandard: GOLDEN_STANDARD,
      images: imagePaths.map(p => ({ path: p, registeredAt: new Date().toISOString() })),
    };

    const manifestPath = join(this.baseDir, characterId, 'L1_identity', 'manifest.json');
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return manifest;
  }

  // ─── L2 造型卡片 ─────────────────────────────────────────

  /**
   * 获取角色的所有造型卡片。
   *
   * @param {string} characterId
   * @param {string} [costumeId] — 指定造型（如 "casual"、"formal"），不传返回所有
   * @returns {Promise<Array<{costumeId, images}>>}
   */
  async getCostumeSheets(characterId, costumeId) {
    const charDir = join(this.baseDir, characterId, 'L2_costumes');
    const costumes = [];

    try {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(charDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

      const targetDirs = costumeId ? dirs.filter(d => d === costumeId) : dirs;

      for (const dir of targetDirs) {
        const images = await this._listImages(join(charDir, dir));
        if (images.length) {
          costumes.push({ costumeId: dir, images });
        }
      }
    } catch { /* dir not found */ }

    return costumes;
  }

  /**
   * 注册 L2 造型卡片。
   *
   * @param {string} characterId
   * @param {string} costumeId — 造型标识（如 "school_uniform"、"battle_armor"）
   * @param {string[]} imagePaths — 全身正面+侧面图（2张）
   */
  async registerCostumeSheet(characterId, costumeId, imagePaths) {
    if (!costumeId) throw new Error('costumeId 必填');
    if (!imagePaths?.length) throw new Error('造型卡片至少需要 1 张图');

    const manifest = {
      level: 'L2',
      type: 'costume_sheet',
      characterId,
      costumeId,
      description: '全身正面+侧面，锁定服装/道具/造型',
      rule: '一造型一卡片，不混放多套服装',
      images: imagePaths.map(p => ({ path: p, registeredAt: new Date().toISOString() })),
    };

    const manifestPath = join(this.baseDir, characterId, 'L2_costumes', costumeId, 'manifest.json');
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return manifest;
  }

  // ─── L3 姿势包 ───────────────────────────────────────────

  async getPosePack(characterId) {
    const dir = join(this.baseDir, characterId, 'L3_poses');
    return this._listImages(dir);
  }

  async registerPosePack(characterId, imagePaths) {
    const manifest = {
      level: 'L3',
      type: 'pose_pack',
      characterId,
      images: imagePaths.map(p => ({ path: p })),
    };
    const manifestPath = join(this.baseDir, characterId, 'L3_poses', 'manifest.json');
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return manifest;
  }

  // ─── L4 表情标定 ─────────────────────────────────────────

  async getExpressions(characterId) {
    const dir = join(this.baseDir, characterId, 'L4_expressions');
    return this._listImages(dir);
  }

  // ─── 组合查询 ─────────────────────────────────────────────

  /**
   * 获取角色的完整资产快照。
   *
   * @param {string} characterId
   * @returns {Promise<object>} 分层资产结构
   */
  async getAssetSnapshot(characterId) {
    const [identity, costumes, poses, expressions] = await Promise.all([
      this.getIdentityAnchors(characterId),
      this.getCostumeSheets(characterId),
      this.getPosePack(characterId),
      this.getExpressions(characterId),
    ]);

    return {
      characterId,
      L1_identity: identity,
      L2_costumes: costumes,
      L3_poses: poses,
      L4_expressions: expressions,
      summary: {
        identityCount: identity.length,
        costumeCount: costumes.length,
        poseCount: poses.length,
        expressionCount: expressions.length,
        ready: identity.length >= 1, // 至少需要 L1
      },
    };
  }

  /**
   * 为 compositions API 组装参考图列表。
   * L1 在前（身份锚点），L2 在后（造型参考）。
   *
   * @param {string} characterId
   * @param {string} [costumeId] — 当前造型
   * @returns {Promise<{images: string[], identityImages: string[], costumeImages: string[]}>}
   */
  async getReferencePack(characterId, costumeId) {
    const identity = await this.getIdentityAnchors(characterId);
    if (!identity.length) {
      throw new Error(`角色 ${characterId} 缺少 L1 身份锚点，请先生成定妆照`);
    }

    let costumeImages = [];
    if (costumeId) {
      const costumes = await this.getCostumeSheets(characterId, costumeId);
      costumeImages = costumes.flatMap(c => c.images);
    }

    return {
      images: [...identity, ...costumeImages],
      identityImages: identity,
      costumeImages,
    };
  }

  /**
   * 为 Seedance omni_reference 组装参考文件列表。
   * 排列顺序：L1 身份锚点 → L2 造型 → 分镜首帧 → 动作参考视频 → 音频参考
   *
   * Phase 22 (Seedance 2.0 音画同步):
   *   - 新增 audioRefs opt，产出 @Audio 绑定 + hasAudio 标志
   *   - @Audio token 是关键 — Seedance 2.0 若 audio_refs 非空但 prompt 无 @Audio，
   *     会静默忽略 audio，生成无声视频 (Pitfalls 陷阱 1)
   *
   * @param {string} characterId
   * @param {object} opts — { costumeId, sceneFrame, actionVideos, audioRefs }
   *   audioRefs: Array<{ path, character?, shot_id? }>
   * @returns {Promise<object>} { identityImages, sceneImages, actionVideos, audioRefs,
   *   allFiles, promptBindings, hasAudio }
   */
  async getOmniReferencePack(characterId, opts = {}) {
    const { costumeId, sceneFrame, actionVideos = [], audioRefs = [] } = opts;

    const identity = await this.getIdentityAnchors(characterId);
    if (!identity.length) {
      throw new Error(`角色 ${characterId} 缺少 L1 身份锚点`);
    }

    const sceneImages = [];
    if (sceneFrame) sceneImages.push(sceneFrame);

    if (costumeId) {
      const costumes = await this.getCostumeSheets(characterId, costumeId);
      sceneImages.push(...costumes.flatMap(c => c.images));
    }

    // 构建 @Image 绑定提示
    const promptBindings = [];
    identity.forEach((_, i) => {
      promptBindings.push(`@Image${i + 1} 提供人物身份（面部特征、发型、肤色）`);
    });
    const sceneStart = identity.length + 1;
    sceneImages.forEach((_, i) => {
      promptBindings.push(`@Image${sceneStart + i} 提供当前场景服装和构图`);
    });
    if (actionVideos.length) {
      const videoStart = identity.length + sceneImages.length + 1;
      actionVideos.forEach((_, i) => {
        promptBindings.push(`@Video${i + 1} 仅用于动作参考（30% 权重），不得改变角色面部`);
      });
    }

    // Phase 22 A2-01: 构建 @Audio 绑定（Seedance 2.0 音画同步核心）
    // @Audio token 必须显式声明，否则模型会忽略 audio_refs
    const validAudioRefs = Array.isArray(audioRefs)
      ? audioRefs.filter(a => a && a.path)
      : [];
    validAudioRefs.forEach((audio, i) => {
      const audioIdx = i + 1;
      const charLabel = audio.character || '主角色';
      promptBindings.push(
        `@Audio${audioIdx} 为角色 ${charLabel} 提供对白音频，严格匹配口型与情感节奏`,
      );
    });

    return {
      identityImages: identity,
      sceneImages,
      actionVideos,
      audioRefs: validAudioRefs,
      allFiles: [
        ...identity,
        ...sceneImages,
        ...actionVideos,
        ...validAudioRefs.map(a => a.path),
      ],
      promptBindings: promptBindings.join('. '),
      hasAudio: validAudioRefs.length > 0,
      goldenRatio: '70% 身份参考 + 30% 动作参考',
    };
  }

  // ─── 内部工具 ─────────────────────────────────────────────

  async _listImages(dir) {
    try {
      await access(dir);
    } catch {
      return [];
    }

    const { readdir } = await import('node:fs/promises');
    const files = await readdir(dir);
    const imageExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    return files
      .filter(f => imageExts.some(ext => f.toLowerCase().endsWith(ext)))
      .sort()
      .map(f => join(dir, f));
  }

  // ─── Phase 24: CrossEpisodeAssetIndex ─────────────────────

  /**
   * 通过 gold-team 计算 DINOv2 embedding (768-dim 向量).
   * gold-team 不可用 → 返回 null (degraded 信号).
   *
   * @param {string} imagePath
   * @returns {Promise<number[]|null>}
   */
  async _computeDinoFingerprint(imagePath) {
    const client = this._gtClient;
    if (!client || typeof client.submitTask !== 'function') return null;
    try {
      const task = await client.submitTask({
        taskType: 'dinov2_embedding',
        params: { image_path: imagePath },
        priority: 3,
        description: `character-asset:embed:${imagePath}`,
      });
      const completed = await client.waitForTask(task.taskId || task.task_id, {
        pollIntervalMs: 2000,
        timeoutMs: 60000,
      });
      const vector = completed?.artifacts?.[0]?.embedding ||
        completed?.output?.embedding ||
        completed?.embedding;
      if (!Array.isArray(vector)) return null;
      return vector;
    } catch (err) {
      console.warn(`[CharacterAssetManager] DINOv2 不可用,降级 pHash: ${err.message}`);
      return null;
    }
  }

  /**
   * Phase 24 B2-01: computeCostumeFingerprint 重写
   *   - 主: DINOv2 embedding (768-dim 余弦可对比)
   *   - 降级: pHash (64-bit hamming 可对比)
   *   - gold-team 与 fetchPixels 都不可用 → 返回 null (上层识别)
   *
   * 输出 schema:
   *   { type: 'dinov2', vector: number[], source_image: string } |
   *   { type: 'phash',  hash: string,    source_image: string } |
   *   null
   *
   * @param {string} characterId
   * @returns {Promise<object|null>}
   */
  async _computeCostumeFingerprint(characterId) {
    const anchors = await this.getIdentityAnchors(characterId);
    if (!anchors.length) return null;
    const sourceImage = anchors[0];

    // Stage 1: DINOv2 (primary)
    const dinoVec = await this._computeDinoFingerprint(sourceImage);
    if (Array.isArray(dinoVec) && dinoVec.length > 0) {
      return { type: 'dinov2', vector: dinoVec, source_image: sourceImage };
    }

    // Stage 2: pHash (degraded fallback)
    if (this._fetchPixels) {
      try {
        const hash = await computePHash(sourceImage, { fetchPixels: this._fetchPixels });
        if (hash) {
          return { type: 'phash', hash, source_image: sourceImage };
        }
      } catch (err) {
        console.warn(`[CharacterAssetManager] pHash 计算失败: ${err.message}`);
      }
    }

    // 两者都不可用
    return null;
  }

  /**
   * Cosine similarity of two numeric vectors.
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number} [-1, 1]; 0 for empty/unequal
   */
  _cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
      return 0;
    }
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      const av = a[i] || 0;
      const bv = b[i] || 0;
      dot += av * bv;
      na += av * av;
      nb += bv * bv;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /**
   * Phase 24 B2-03: 跨剧集查询 — 通过身份指纹查找已注册角色.
   *
   * 两阶段匹配 (防误判, Pitfalls 陷阱 3):
   *   Stage 1 hash retrieve:
   *     - dinov2 vs dinov2 → cosine (>= dinov2Threshold 通过)
   *     - phash vs phash → similarity (>= phashThreshold 通过)
   *     - dinov2 vs phash (mixed) → 不可比,跳过
   *   Stage 2 DINOv2 confirmation:
   *     - 仅 dinov2 命中允许写入 library
   *     - 单独 pHash 命中 → 不写入 (仅返回候选标记 degraded)
   *
   * 首次匹配 → 写入 pending-approvals/, 触发 human gate.
   *
   * @param {object} fingerprint — { type: 'dinov2'|'phash', vector|hash, source_image }
   * @param {number} [threshold] — 覆盖默认阈值 (测试用)
   * @returns {Promise<object>} { status: 'no_match'|'matched'|'pending_approval'|'degraded',
   *   matches: Array<{characterId, similarity, fingerprint_type}>, pending? }
   */
  async findByIdentity(fingerprint, threshold) {
    if (!fingerprint || !fingerprint.type) {
      throw new Error('findByIdentity: fingerprint.type 必填');
    }

    const index = await this._loadLibraryIndex();
    if (!index.entries || index.entries.length === 0) {
      return { status: 'no_match', matches: [], reason: 'empty_library' };
    }

    const dinoThr = threshold ?? this.dinov2Threshold;
    const phashThr = this.phashThreshold;

    // Stage 1: hash retrieve
    const candidates = [];
    for (const entry of index.entries) {
      const entryFp = entry.fingerprint;
      if (!entryFp) continue;

      if (fingerprint.type === 'dinov2' && entryFp.type === 'dinov2') {
        const sim = this._cosineSimilarity(fingerprint.vector, entryFp.vector);
        if (sim >= dinoThr) {
          candidates.push({
            characterId: entry.characterId,
            similarity: sim,
            fingerprint_type: 'dinov2',
            episode_origin: entry.episode_origin,
          });
        }
      } else if (fingerprint.type === 'phash' && entryFp.type === 'phash') {
        const sim = pHashSimilarity(fingerprint.hash, entryFp.hash);
        if (sim >= phashThr) {
          candidates.push({
            characterId: entry.characterId,
            similarity: sim,
            fingerprint_type: 'phash',
            episode_origin: entry.episode_origin,
          });
        }
      }
      // dinov2 vs phash: 不可比, 跳过
    }

    if (candidates.length === 0) {
      return { status: 'no_match', matches: [], reason: 'no_candidate_above_threshold' };
    }

    // Stage 2: DINOv2 确认 (library write requires it)
    const confirmed = candidates.filter(c => c.fingerprint_type === 'dinov2');
    const phashOnly = candidates.filter(c => c.fingerprint_type === 'phash');

    if (confirmed.length === 0 && phashOnly.length > 0) {
      // 单独 pHash 命中 → 不写入 library, 标记 degraded
      return {
        status: 'degraded',
        matches: phashOnly,
        reason: 'phash_only_match_not_writable',
        note: 'pHash 单独命中不允许写入 library (Pitfalls 陷阱 3)',
      };
    }

    // Human gate: 首次匹配入 pending-approvals/
    if (!this.skipHumanGate) {
      const top = confirmed[0];
      const approvalId = await this._queueForApproval(top, fingerprint);
      await this._writeAuditLog('find_identity_pending_approval', {
        characterId: top.characterId,
        similarity: top.similarity,
        approval_id: approvalId,
      });
      return {
        status: 'pending_approval',
        matches: confirmed,
        pending: { approvalId, match: top },
      };
    }

    await this._writeAuditLog('find_identity_matched', {
      matches: confirmed.map(c => ({ characterId: c.characterId, similarity: c.similarity })),
    });
    return { status: 'matched', matches: confirmed };
  }

  /**
   * Phase 24 B2-04: 将角色注册到跨剧集资产库.
   *
   * Human gate 强制:
   *   - 默认 approved=false → 只写 pending-approvals/,不写 index.json
   *   - approved=true (operator 审批后) → 写入 index.json + audit log
   *
   * @param {string} characterId
   * @param {object} fingerprint — { type, vector|hash, source_image }
   * @param {object} episodeOrigin — { project, episode_id, registered_at }
   * @param {object} [opts] — { approved: false, reviewed_by: null }
   * @returns {Promise<object>} { registered, approval_id?, entry? }
   */
  async registerToLibrary(characterId, fingerprint, episodeOrigin, opts = {}) {
    if (!characterId) throw new Error('registerToLibrary: characterId 必填');
    if (!fingerprint?.type) throw new Error('registerToLibrary: fingerprint.type 必填');

    const approved = opts.approved === true;
    const reviewedBy = opts.reviewed_by || null;

    if (!approved) {
      // 入 pending-approvals/ 等待 operator 审批
      const approvalId = await this._queueForApproval(
        { characterId, fingerprint_type: fingerprint.type, episode_origin: episodeOrigin },
        fingerprint,
        { episodeOrigin, action: 'register' },
      );
      await this._writeAuditLog('register_pending_approval', {
        characterId,
        approval_id: approvalId,
        fingerprint_type: fingerprint.type,
      });
      return { registered: false, approval_id: approvalId, reason: 'awaiting_human_approval' };
    }

    // approved=true → 写入 index.json
    const index = await this._loadLibraryIndex();
    const entry = {
      characterId,
      fingerprint: {
        type: fingerprint.type,
        ...(fingerprint.vector ? { vector: fingerprint.vector } : {}),
        ...(fingerprint.hash ? { hash: fingerprint.hash } : {}),
        source_image: fingerprint.source_image || null,
      },
      episode_origin: episodeOrigin,
      approved_at: new Date().toISOString(),
      approved_by: reviewedBy,
    };

    // 去重: 同 characterId 已存在 → 更新
    const existingIdx = index.entries.findIndex(e => e.characterId === characterId);
    if (existingIdx >= 0) {
      index.entries[existingIdx] = entry;
    } else {
      index.entries.push(entry);
    }
    index.version = (index.version || 1) + 1;
    index.updated_at = new Date().toISOString();

    await this._writeLibraryIndex(index);
    await this._writeAuditLog('register_approved', {
      characterId,
      fingerprint_type: fingerprint.type,
      approved_by: reviewedBy,
      index_version: index.version,
    });

    return { registered: true, entry };
  }

  /**
   * Phase 24 B2-06: 批准 pending-approvals/ 中的请求 → 写入 index.json.
   *
   * @param {string} approvalId
   * @param {object} opts — { reviewed_by: 'operator-name' }
   * @returns {Promise<object>} { registered, entry }
   */
  async approvePending(approvalId, opts = {}) {
    const pending = await this._readPendingApproval(approvalId);
    if (!pending) {
      throw new Error(`approvePending: approval ${approvalId} 不存在`);
    }

    const result = await this.registerToLibrary(
      pending.characterId || pending.match?.characterId,
      pending.fingerprint,
      pending.episode_origin || pending.match?.episode_origin,
      { approved: true, reviewed_by: opts.reviewed_by },
    );

    // 审批完成后删除 pending 记录
    await this._deletePendingApproval(approvalId);
    await this._writeAuditLog('approval_granted', {
      approval_id: approvalId,
      characterId: pending.characterId || pending.match?.characterId,
      reviewed_by: opts.reviewed_by,
    });

    return result;
  }

  // ─── Phase 24: 内部 helpers ───────────────────────────────

  /**
   * 加载跨剧集资产库 index.json.
   * 不存在则返回空骨架 (version=1).
   */
  async _loadLibraryIndex() {
    const indexPath = join(this.libraryRoot, 'index.json');
    try {
      const raw = await readFile(indexPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.entries)) parsed.entries = [];
      return parsed;
    } catch {
      return { entries: [], version: 1, updated_at: null };
    }
  }

  async _writeLibraryIndex(index) {
    const indexPath = join(this.libraryRoot, 'index.json');
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  }

  /**
   * 将首次匹配/注册请求写入 pending-approvals/.
   * @returns {Promise<string>} approvalId
   */
  async _queueForApproval(matchInfo, fingerprint, extra = {}) {
    const approvalsDir = join(this.libraryRoot, 'pending-approvals');
    await mkdir(approvalsDir, { recursive: true });
    const approvalId = `appr-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const payload = {
      approval_id: approvalId,
      requested_at: new Date().toISOString(),
      match: matchInfo,
      fingerprint: {
        type: fingerprint.type,
        ...(fingerprint.vector ? { vector: fingerprint.vector } : {}),
        ...(fingerprint.hash ? { hash: fingerprint.hash } : {}),
        source_image: fingerprint.source_image || null,
      },
      ...extra,
    };
    await writeFile(join(approvalsDir, `${approvalId}.json`), JSON.stringify(payload, null, 2), 'utf-8');
    return approvalId;
  }

  async _readPendingApproval(approvalId) {
    try {
      const raw = await readFile(join(this.libraryRoot, 'pending-approvals', `${approvalId}.json`), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async _deletePendingApproval(approvalId) {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(join(this.libraryRoot, 'pending-approvals', `${approvalId}.json`));
    } catch { /* ignore */ }
  }

  /**
   * 追加写 audit-log.jsonl.
   */
  async _writeAuditLog(action, details = {}) {
    try {
      const logPath = join(this.libraryRoot, 'audit-log.jsonl');
      await mkdir(dirname(logPath), { recursive: true });
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        action,
        ...details,
      }) + '\n';
      const { appendFile } = await import('node:fs/promises');
      await appendFile(logPath, entry, 'utf-8');
    } catch (err) {
      console.warn(`[CharacterAssetManager] audit log 写入失败: ${err.message}`);
    }
  }

  /**
   * 读 audit log (测试/调试用).
   */
  async _readAuditLog() {
    try {
      const raw = await readFile(join(this.libraryRoot, 'audit-log.jsonl'), 'utf-8');
      return raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    } catch {
      return [];
    }
  }
}

export default CharacterAssetManager;
