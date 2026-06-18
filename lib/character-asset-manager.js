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

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';

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
   */
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  // ─── L1 身份锚点 ─────────────────────────────────────────

  /**
   * 获取角色的 L1 身份锚点图列表。
   * L1 是锁定五官的核心参考，在所有生成中保持不变。
   *
   * @param {string} characterId
   * @returns {Promise<string[]>} L1 图片路径数组
   */
  async getIdentityAnchors(characterId) {
    const dir = join(this.baseDir, characterId, 'L1_identity');
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
   * 排列顺序：L1 身份锚点 → L2 造型 → 分镜首帧 → 动作参考视频
   *
   * @param {string} characterId
   * @param {object} opts — { costumeId, sceneFrame, actionVideos }
   * @returns {Promise<object>} { identityImages, sceneImages, allFiles, promptBindings }
   */
  async getOmniReferencePack(characterId, opts = {}) {
    const { costumeId, sceneFrame, actionVideos = [] } = opts;

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

    return {
      identityImages: identity,
      sceneImages,
      actionVideos,
      allFiles: [...identity, ...sceneImages, ...actionVideos],
      promptBindings: promptBindings.join('. '),
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
}

export default CharacterAssetManager;
