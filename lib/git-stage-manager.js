// Git Stage Manager — 阶段级 git 管理工具
// 为 AIGC 电影管线提供 checkpoint / rollback / diff 能力

import { exec } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** 标准阶段定义 */
export const STAGES = {
  'scenario':        { label: '剧本创作',   patterns: ['scenario.json', 'story_bible.json'] },
  'character':       { label: '角色设计',   patterns: ['characters.json', '*_ref.png'] },
  'art-direction':   { label: '艺术指导',   patterns: ['art_direction.json', 'mood_board.png'] },
  'scene-design':    { label: '场景设计',   patterns: ['scene_design.json'] },
  'storyboard':      { label: '分镜设计',   patterns: ['storyboard.json', 'shots.json'] },
  'shooting-script': { label: '拍摄脚本',   patterns: ['shooting_script.json'] },
  'camera':          { label: '视频生成',   patterns: ['video_tasks.json', 'output/*.mp4'] },
  'review':          { label: '审核修改',   patterns: ['*.json'] },
};

/** 阶段执行顺序 */
export const STAGE_ORDER = [
  'scenario', 'character', 'art-direction', 'scene-design',
  'storyboard', 'shooting-script', 'camera', 'review',
];

const GITIGNORE_CONTENT = `# dependencies
node_modules/

# OS files
.DS_Store
Thumbs.db

# temp files
*.tmp
*.bak
*.swp
*~

# logs
*.log

# env
.env
.env.local
`;

/**
 * 封装 child_process.exec 为 Promise
 */
function run(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(`git command failed: ${err.message}`);
        e.stderr = stderr?.trim() || '';
        reject(e);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * GitStageManager — 管理项目工作目录的 git 阶段提交
 */
export class GitStageManager {

  /**
   * @param {string} workdir - 项目工作目录
   */
  constructor(workdir) {
    this.workdir = workdir;
  }

  // ── init ──────────────────────────────────────────────

  /**
   * 确保 workdir 是一个 git repo，并写入标准 .gitignore
   */
  async init(workdir) {
    const dir = workdir || this.workdir;
    await mkdir(dir, { recursive: true });

    // 检查是否已有 git repo
    try {
      await run('git rev-parse --git-dir', dir);
    } catch {
      await run('git init', dir);
      // 设置默认用户（避免 commit 失败）
      try {
        await run('git config user.email', dir);
      } catch {
        await run('git config user.email "kais-movie-agent@local"', dir);
        await run('git config user.name "KAIS Movie Agent"', dir);
      }
    }

    // 写入 .gitignore
    const gitignorePath = join(dir, '.gitignore');
    let existing = '';
    try {
      existing = await readFile(gitignorePath, 'utf-8');
    } catch {
      // 文件不存在，直接写入
    }
    if (!existing.includes('node_modules')) {
      await writeFile(gitignorePath, GITIGNORE_CONTENT, 'utf-8');
    }

    return { initialized: true, dir };
  }

  // ── checkpoint ────────────────────────────────────────

  /**
   * 阶段完成后创建 git checkpoint
   * @param {string} stageName - 阶段名称（STAGES 中的 key）
   * @param {object} [metadata] - 可选元数据
   * @param {string} [metadata.description] - 阶段描述
   * @param {string[]} [metadata.files] - 产出文件列表
   * @param {object} [metrics] - 关键指标
   */
  async checkpoint(stageName, metadata = {}) {
    const dir = this.workdir;
    const stageDef = STAGES[stageName];
    if (!stageDef) {
      throw new Error(`Unknown stage: ${stageName}. Valid: ${STAGE_ORDER.join(', ')}`);
    }

    // 确保 repo 已初始化
    await this.init(dir);

    // git add 所有产出文件
    await run('git add -A', dir);

    // 检查是否有变更
    let hasChanges;
    try {
      const status = await run('git status --porcelain', dir);
      hasChanges = status.length > 0;
    } catch {
      hasChanges = true;
    }

    if (!hasChanges) {
      return { committed: false, reason: 'no changes to commit' };
    }

    // 构建 commit message
    const desc = metadata.description || stageDef.label;
    const msg = `[stage] ${stageName} - ${desc}`;

    // 构建 commit body（metadata）
    const body = {
      stage: stageName,
      timestamp: new Date().toISOString(),
      files: metadata.files || stageDef.patterns,
      ...(metadata.metrics ? { metrics: metadata.metrics } : {}),
    };
    const bodyStr = JSON.stringify(body, null, 2);

    const fullMsg = `${msg}\n\n${bodyStr}`;
    await run(`git commit -m ${shellQuote(fullMsg)}`, dir);

    return {
      committed: true,
      stage: stageName,
      message: msg,
    };
  }

  // ── log ───────────────────────────────────────────────

  /**
   * 查看所有阶段提交历史
   * @param {string} [workdir]
   * @returns {Array<{hash: string, stage: string, message: string, date: string, metadata: object}>}
   */
  async log(workdir) {
    const dir = workdir || this.workdir;

    const format = '%H%n%s%n%ci%n%b%n---COMMIT-END---';
    let raw;
    try {
      raw = await run(`git log --format=${shellQuote(format)}`, dir);
    } catch {
      return [];
    }

    if (!raw) return [];

    const commits = [];
    for (const block of raw.split('---COMMIT-END---')) {
      const lines = block.trim().split('\n');
      if (lines.length < 3 || !lines[0]) continue;

      const hash = lines[0];
      const subject = lines[1];
      const date = lines[2];
      const bodyLines = lines.slice(3);

      // 解析 stage name
      const stageMatch = subject.match(/^\[stage\]\s+(\S+)/);
      const stage = stageMatch ? stageMatch[1] : null;

      // 解析 metadata JSON body
      let metadata = {};
      const jsonStr = bodyLines.join('\n').trim();
      if (jsonStr.startsWith('{')) {
        try {
          metadata = JSON.parse(jsonStr);
        } catch {
          // 非 JSON body，忽略
        }
      }

      commits.push({ hash, stage, message: subject, date, metadata });
    }

    return commits;
  }

  // ── rollback ──────────────────────────────────────────

  /**
   * 回滚到指定阶段
   * @param {string} [workdir]
   * @param {string} targetStage - 目标阶段名
   * @returns {{ hash: string, stage: string }}
   */
  async rollback(workdir, targetStage) {
    const dir = workdir || this.workdir;
    const stage = targetStage;

    // 查找目标阶段的最后一次 commit
    const commits = await this.log(dir);
    const target = commits.find(c => c.stage === stage);
    if (!target) {
      throw new Error(`No checkpoint found for stage: ${stage}`);
    }

    // 检查是否有未提交的变更
    let dirty = false;
    try {
      const status = await run('git status --porcelain', dir);
      dirty = status.length > 0;
    } catch {
      // ignore
    }

    if (dirty) {
      // 先 stash 未提交的变更
      await run('git stash push -m "auto-stash-before-rollback"', dir);
    }

    // hard reset 到目标 commit
    await run(`git reset --hard ${target.hash}`, dir);

    return { hash: target.hash, stage, stashed: dirty };
  }

  // ── diff ──────────────────────────────────────────────

  /**
   * 比较两个阶段的文件差异
   * @param {string} [workdir]
   * @param {string} stageA
   * @param {string} stageB
   */
  async diff(workdir, stageA, stageB) {
    const dir = workdir || this.workdir;
    const commits = await this.log(dir);

    const commitA = commits.find(c => c.stage === stageA);
    const commitB = commits.find(c => c.stage === stageB);

    if (!commitA) throw new Error(`No checkpoint found for stage: ${stageA}`);
    if (!commitB) throw new Error(`No checkpoint found for stage: ${stageB}`);

    let result;
    try {
      result = await run(`git diff ${commitA.hash} ${commitB.hash} --stat`, dir);
    } catch {
      result = '(no diff available)';
    }

    return {
      stageA: { name: stageA, hash: commitA.hash },
      stageB: { name: stageB, hash: commitB.hash },
      stat: result,
    };
  }

  // ── getCurrentStage ───────────────────────────────────

  /**
   * 获取当前阶段（最近一次 checkpoint 的阶段）
   * @param {string} [workdir]
   * @returns {{ stage: string, label: string, hash: string, date: string } | null}
   */
  async getCurrentStage(workdir) {
    const dir = workdir || this.workdir;
    const commits = await this.log(dir);

    const latest = commits.find(c => c.stage && STAGES[c.stage]);
    if (!latest) return null;

    return {
      stage: latest.stage,
      label: STAGES[latest.stage]?.label || latest.stage,
      hash: latest.hash,
      date: latest.date,
    };
  }
}

// ── helpers ──────────────────────────────────────────────

/**
 * 简易 shell 引用（处理换行和特殊字符）
 */
function shellQuote(str) {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

export default GitStageManager;
