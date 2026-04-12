/**
 * image-backup.js — 图片本地备份与标记系统
 *
 * 所有生成的图片自动备份到 .backup/images/ 并附带元数据 JSON。
 * 目录结构：
 *   .backup/images/
 *     2026-04-12/
 *       phase2-art-direction/
 *         001-sunset-cityscape.png
 *         001-sunset-cityscape.meta.json
 *         002-neon-rain.png
 *         002-neon-rain.meta.json
 *       phase3-character/
 *         ...
 */

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join, basename, dirname } from "node:path";

// ─── 备份管理器 ─────────────────────────────────────────

export class ImageBackup {
  /**
   * @param {object} options
   * @param {string} options.workdir — 项目工作目录（默认 cwd）
   * @param {string} options.backupDir — 备份根目录（默认 {workdir}/.backup/images）
   */
  constructor(options = {}) {
    this.workdir = options.workdir || process.cwd();
    this.backupDir = options.backupDir || join(this.workdir, ".backup", "images");
  }

  /**
   * 备份单张图片
   * @param {string} sourcePath — 原始图片路径（本地文件或 URL）
   * @param {object} meta — 元数据
   * @param {string} meta.phase — 阶段标识（如 "phase2-art-direction"）
   * @param {string} meta.prompt — 生成用的 prompt
   * @param {string} [meta.model] — 生成模型
   * @param {string} [meta.ratio] — 比例
   * @param {string} [meta.style] — 风格
   * @param {string} [meta.character] — 角色名（角色设计阶段）
   * @param {string} [meta.scene] — 场景名（场景图阶段）
   * @param {string} [meta.shot] — 镜头号（分镜/视频阶段）
   * @param {string} [meta.variant] — 变体标识（如 "A"/"B"）
   * @param {number} [meta.score] — 评分（审核后填写）
   * @param {string} [meta.selected] — 是否被选中（审核后填写）
   * @param {string} [meta.status] — 状态: generated / approved / rejected / used
   * @param {string} [meta.sourceUrl] — 原始 URL（如果是下载的图片）
   * @returns {Promise<{backupPath: string, metaPath: string}>}
   */
  async backup(sourcePath, meta = {}) {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const phase = meta.phase || "unknown";
    const dir = join(this.backupDir, date, phase);
    await mkdir(dir, { recursive: true });

    // 自动编号
    const existing = await this._listFiles(dir, ".png");
    const idx = String(existing.length + 1).padStart(3, "0");

    // 文件名：编号-简短描述.png
    const desc = this._sanitize(meta.prompt?.slice(0, 40) || basename(sourcePath, ".png"));
    const ext = sourcePath.endsWith(".jpg") || sourcePath.endsWith(".jpeg") ? ".jpg" : ".png";
    const fileName = `${idx}-${desc}${ext}`;
    const backupPath = join(dir, fileName);
    const metaPath = backupPath + ".meta.json";

    // 复制图片
    if (sourcePath.startsWith("http")) {
      const res = await fetch(sourcePath);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(backupPath, buf);
    } else {
      await copyFile(sourcePath, backupPath);
    }

    // 写元数据
    const metaData = {
      ...meta,
      backupPath,
      originalPath: sourcePath,
      backedUpAt: new Date().toISOString(),
      fileSize: (await import("node:fs/promises")).stat(backupPath).then(s => s.size),
    };
    metaData.fileSize = await metaData.fileSize;
    await writeFile(metaPath, JSON.stringify(metaData, null, 2));

    return { backupPath, metaPath };
  }

  /**
   * 批量备份
   * @param {Array<{path: string, meta: object}>} items
   * @returns {Promise<Array<{backupPath: string, metaPath: string}>>}
   */
  async backupBatch(items) {
    const results = [];
    for (const item of items) {
      try {
        const result = await this.backup(item.path, item.meta);
        results.push(result);
      } catch (e) {
        console.warn(`[image-backup] 备份失败: ${item.path} — ${e.message}`);
        results.push({ backupPath: null, metaPath: null, error: e.message });
      }
    }
    return results;
  }

  /**
   * 更新元数据（如审核后更新 score/selected/status）
   * @param {string} backupPath — 备份图片路径
   * @param {object} updates — 要更新的字段
   */
  async updateMeta(backupPath, updates) {
    const metaPath = backupPath + ".meta.json";
    try {
      const raw = await readFile(metaPath, "utf-8");
      const meta = JSON.parse(raw);
      Object.assign(meta, updates, { updatedAt: new Date().toISOString() });
      await writeFile(metaPath, JSON.stringify(meta, null, 2));
      return meta;
    } catch (e) {
      console.warn(`[image-backup] 元数据更新失败: ${metaPath} — ${e.message}`);
      return null;
    }
  }

  /**
   * 查询备份（按日期、阶段、状态筛选）
   * @param {object} filter
   * @param {string} [filter.date] — 日期 YYYY-MM-DD
   * @param {string} [filter.phase] — 阶段
   * @param {string} [filter.status] — 状态
   * @returns {Promise<Array<object>>}
   */
  async query(filter = {}) {
    const { readdir, readFile } = await import("node:fs/promises");
    const results = [];

    const dateDir = filter.date
      ? join(this.backupDir, filter.date)
      : this.backupDir;

    let dateDirs;
    try {
      dateDirs = filter.date ? [dateDir] : (await readdir(this.backupDir));
    } catch { return results; }

    for (const dd of dateDirs) {
      const fullPath = join(this.backupDir, dd);
      let phaseDirs;
      try {
        phaseDirs = await readdir(fullPath);
      } catch { continue; }

      for (const pd of phaseDirs) {
        if (filter.phase && pd !== filter.phase) continue;
        const phasePath = join(fullPath, pd);
        let files;
        try {
          files = await readdir(phasePath);
        } catch { continue; }

        for (const f of files.filter(f => f.endsWith(".meta.json"))) {
          try {
            const raw = await readFile(join(phasePath, f), "utf-8");
            const meta = JSON.parse(raw);
            if (filter.status && meta.status !== filter.status) continue;
            results.push(meta);
          } catch { /* skip */ }
        }
      }
    }

    return results.sort((a, b) => a.backedUpAt.localeCompare(b.backedUpAt));
  }

  /**
   * 生成备份统计
   */
  async stats() {
    const all = await this.query();
    const byPhase = {};
    const byStatus = {};
    for (const m of all) {
      byPhase[m.phase] = (byPhase[m.phase] || 0) + 1;
      byStatus[m.status || "untagged"] = (byStatus[m.status || "untagged"] || 0) + 1;
    }
    return { total: all.length, byPhase, byStatus, backupDir: this.backupDir };
  }

  // ─── 内部工具 ──────────────────────────────────────────

  async _listFiles(dir, ext) {
    try {
      const { readdir } = await import("node:fs/promises");
      return (await readdir(dir)).filter(f => f.endsWith(ext));
    } catch { return []; }
  }

  _sanitize(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30);
  }
}

export default ImageBackup;
