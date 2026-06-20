/**
 * project-resolver.js — 从 registry.json 或环境变量解析 projectId
 *
 * 解析优先级:
 *   1. --project <dirName|projectId> 命令行参数
 *   2. CANVAS_PROJECT_ID 环境变量
 *   3. 从 workdir 路径推断 dirName，查 registry.json
 *   4. 报错（不再静默 fallback 到 1800）
 */

import { readFileSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '..', 'projects', 'registry.json');

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    return null;
  }
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
}

/**
 * @param {object} opts - 解析后的命令行参数
 * @param {string} [opts.project] - --project 参数 (dirName 或 projectId)
 * @param {string} [opts.workdir] - --workdir 参数
 * @returns {{projectId: number, dirName: string, error?: string}}
 */
export function resolveProjectId(opts = {}) {
  const registry = loadRegistry();

  if (!registry) {
    return {
      projectId: 0,
      dirName: '',
      error: '❌ projects/registry.json 不存在。请先运行: node bin/project-manager.js create <dir> <name>',
    };
  }

  // 1. --project 参数
  if (opts.project) {
    // Try as number first
    const asNum = Number(opts.project);
    if (!isNaN(asNum)) {
      const found = registry.projects.find(p => p.projectId === asNum);
      if (found) return { projectId: found.projectId, dirName: found.dirName };
      return { projectId: 0, dirName: '', error: `❌ projectId ${asNum} 不在 registry.json 中` };
    }
    // Try as dirName
    const found = registry.projects.find(p => p.dirName === opts.project);
    if (found) return { projectId: found.projectId, dirName: found.dirName };
    return { projectId: 0, dirName: '', error: `❌ 项目目录 "${opts.project}" 不在 registry.json 中` };
  }

  // 2. CANVAS_PROJECT_ID 环境变量
  if (process.env.CANVAS_PROJECT_ID) {
    const pid = parseInt(process.env.CANVAS_PROJECT_ID, 10);
    const found = registry.projects.find(p => p.projectId === pid);
    if (found) return { projectId: pid, dirName: found.dirName };
    // Env var exists but not in registry — warn but allow (backward compat)
    console.warn(`⚠️  CANVAS_PROJECT_ID=${pid} 不在 registry.json，建议运行: node bin/project-manager.js register ${pid} <dir> <name>`);
    return { projectId: pid, dirName: '' };
  }

  // 3. 从 workdir 推断
  const workdir = opts.workdir || process.cwd();
  const dirName = basename(workdir);
  const found = registry.projects.find(p => p.dirName === dirName);
  if (found) return { projectId: found.projectId, dirName: found.dirName };

  // 4. 报错
  return {
    projectId: 0,
    dirName: '',
    error: `❌ 无法确定 projectId。\n   请使用 --project <dirName> 或设置 CANVAS_PROJECT_ID 环境变量。\n   当前 workdir: ${workdir} (basename: ${dirName})\n   可用项目: ${registry.projects.map(p => `${p.dirName}(${p.projectId})`).join(', ')}`,
  };
}
