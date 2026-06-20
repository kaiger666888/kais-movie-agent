#!/usr/bin/env node
/**
 * project-manager.js — kais-movie-agent 项目管理工具
 *
 * 用法:
 *   node bin/project-manager.js list              # 列出所有项目
 *   node bin/project-manager.js create <dirName> <displayName> [intro]  # 创建新项目
 *   node bin/project-manager.js info <projectId>  # 查看项目详情
 *   node bin/project-manager.js register <projectId> <dirName> <displayName>  # 注册已有项目
 *   node bin/project-manager.js verify            # 一致性检查
 *
 * projectId 规则:
 *   - 1-999:    测试/临时项目
 *   - 1000+:    正式项目 (从 registry.json nextProjectId 分配)
 *   - 写入 o_project 表 + registry.json 双写
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REGISTRY_PATH = join(ROOT, 'projects', 'registry.json');
const PROJECTS_DIR = join(ROOT, 'projects');
const DB_PATH = '/home/kai/workspace/kais-aigc-platform/data/db2.sqlite';

// ─── SQLite via CLI ────────────────────────────────────────────

function sql(query, ...params) {
  // Build command with proper escaping
  const escaped = query.replace(/\?/g, () => {
    const p = params.shift();
    if (p === null || p === undefined) return 'NULL';
    if (typeof p === 'number') return String(p);
    return `'${String(p).replace(/'/g, "''")}'`;
  });
  return execSync(`sqlite3 "${DB_PATH}" "${escaped}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function sqlJSON(query, ...params) {
  const raw = sql(query, ...params);
  if (!raw.trim()) return [];
  // Parse pipe-separated rows into objects
  return raw.trim().split('\n').map(line => {
    const parts = line.split('|');
    return parts;
  });
}

// ─── Registry ──────────────────────────────────────────────────

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    console.error(`❌ 项目注册表不存在: ${REGISTRY_PATH}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
}

function saveRegistry(registry) {
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

// ─── Commands ──────────────────────────────────────────────────

function cmdList() {
  const registry = loadRegistry();

  console.log('\n📦 项目列表\n');
  console.log('ID    | 状态     | 目录名                 | 名称');
  console.log('------|----------|------------------------|----------');

  for (const p of registry.projects) {
    // Verify DB has this project
    const row = sql(`SELECT id FROM o_project WHERE id = ${p.projectId};`).trim();
    const dbOk = row ? '✅' : '❌ 缺失';
    console.log(`${String(p.projectId).padEnd(5)} | ${p.status.padEnd(8)} | ${p.dirName.padEnd(22)} | ${p.displayName} ${dbOk}`);
  }

  // Check for orphaned DB projects
  const dbProjectsRaw = sql('SELECT id, name FROM o_project ORDER BY id;');
  const registryIds = new Set(registry.projects.map(p => p.projectId));
  for (const line of dbProjectsRaw.trim().split('\n').filter(Boolean)) {
    const [id, name] = line.split('|');
    if (!registryIds.has(Number(id))) {
      console.log(`${id.padEnd(5)} | ORPHAN   | (不在注册表)            | ${name} ⚠️`);
    }
  }

  console.log(`\n下一个可用 projectId: ${registry.nextProjectId}\n`);
}

function cmdCreate(dirName, displayName, intro = '') {
  const registry = loadRegistry();

  if (registry.projects.find(p => p.dirName === dirName)) {
    console.error(`❌ 目录名 "${dirName}" 已存在`);
    process.exit(1);
  }

  const projectId = registry.nextProjectId;

  // Create project directory
  const projectDir = join(PROJECTS_DIR, dirName);
  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true });
    for (const sub of ['scripts', 'characters', 'scenes', 'storyboards', 'assets', 'audio', 'video']) {
      mkdirSync(join(projectDir, sub), { recursive: true });
    }
    writeFileSync(join(projectDir, 'STATUS.md'),
      `# ${displayName} 项目状态\n\n> 创建时间: ${new Date().toISOString().split('T')[0]}\n> 当前步骤: 未开始\n\n## Step 完成记录\n\n| Step | 状态 | 产出物 | 审核结果 |\n|------|------|--------|----------|\n`);
  }

  // Write to o_project
  const now = Date.now();
  sql(`INSERT OR IGNORE INTO o_project (id, name, intro, type, mode, createTime, userId) VALUES (${projectId}, '${displayName.replace(/'/g, "''")}', '${intro.replace(/'/g, "''")}', 'movie-pipeline', 'canvas-v2', ${now}, 1);`);

  // Update registry
  registry.projects.push({
    projectId,
    dirName,
    displayName,
    type: 'movie-pipeline',
    mode: 'canvas-v2',
    status: 'active',
    intro,
    createdAt: new Date().toISOString().split('T')[0],
    note: ''
  });
  registry.nextProjectId = projectId + 1;
  saveRegistry(registry);

  console.log(`✅ 项目创建成功`);
  console.log(`   projectId: ${projectId}`);
  console.log(`   目录: projects/${dirName}`);
  console.log(`   名称: ${displayName}`);
  console.log(`\n   管线使用:`);
  console.log(`   CANVAS_PROJECT_ID=${projectId} node bin/pipeline.js ...`);
}

function cmdInfo(projectId) {
  const registry = loadRegistry();
  const project = registry.projects.find(p => p.projectId === Number(projectId));

  if (!project) {
    console.error(`❌ projectId ${projectId} 不在注册表中`);
    process.exit(1);
  }

  // Project record
  const rowRaw = sql(`SELECT id, name, artStyle, imageModel, videoModel FROM o_project WHERE id = ${projectId};`).trim();

  console.log(`\n📋 项目详情: ${project.displayName}\n`);
  console.log(`  projectId:    ${project.projectId}`);
  console.log(`  目录:         projects/${project.dirName}`);
  console.log(`  状态:         ${project.status}`);
  console.log(`  类型:         ${project.type}`);
  console.log(`  模式:         ${project.mode}`);
  console.log(`  简介:         ${project.intro || '(无)'}`);
  console.log(`  创建时间:     ${project.createdAt}`);
  console.log(`  备注:         ${project.note || '(无)'}`);

  if (rowRaw) {
    console.log(`  DB记录:       ✅ 存在`);
    const [, , artStyle, imageModel, videoModel] = rowRaw.split('|');
    if (artStyle) console.log(`  美术风格:     ${artStyle}`);
    if (imageModel) console.log(`  图像模型:     ${imageModel}`);
    if (videoModel) console.log(`  视频模型:     ${videoModel}`);
  } else {
    console.log(`  DB记录:       ❌ 缺失`);
  }

  // Canvas data
  const canvasRaw = sql(`SELECT episodesId, key, length(data), COALESCE(updateTime, '') FROM o_agentWorkData WHERE projectId = ${projectId} ORDER BY episodesId, key;`).trim();
  if (canvasRaw) {
    console.log(`\n  画布数据:`);
    for (const line of canvasRaw.split('\n')) {
      const [ep, key, dataLen, updateTime] = line.split('|');
      const time = updateTime ? new Date(Number(updateTime)).toISOString().split('T')[0] : '?';
      console.log(`    ep${ep} ${key}: ${dataLen} bytes (${time})`);
    }
  } else {
    console.log(`\n  画布数据: (无)`);
  }

  console.log('');
}

function cmdRegister(projectId, dirName, displayName) {
  const registry = loadRegistry();

  if (registry.projects.find(p => p.projectId === Number(projectId))) {
    console.error(`❌ projectId ${projectId} 已在注册表中`);
    process.exit(1);
  }

  const now = Date.now();
  sql(`INSERT OR IGNORE INTO o_project (id, name, type, mode, createTime, userId) VALUES (${projectId}, '${displayName.replace(/'/g, "''")}', 'movie-pipeline', 'canvas-v2', ${now}, 1);`);

  registry.projects.push({
    projectId: Number(projectId),
    dirName,
    displayName,
    type: 'movie-pipeline',
    mode: 'canvas-v2',
    status: 'active',
    intro: '',
    createdAt: new Date().toISOString().split('T')[0],
    note: '手动注册已有项目'
  });
  if (Number(projectId) >= registry.nextProjectId) {
    registry.nextProjectId = Number(projectId) + 1;
  }
  saveRegistry(registry);

  console.log(`✅ 项目注册成功: ${displayName} (ID: ${projectId})`);
}

function cmdVerify() {
  const registry = loadRegistry();
  let errors = 0;

  console.log('\n🔍 一致性检查\n');

  // Check all registry projects exist in DB
  for (const p of registry.projects) {
    const row = sql(`SELECT id FROM o_project WHERE id = ${p.projectId};`).trim();
    if (!row) {
      console.log(`❌ ${p.projectId} ${p.displayName}: o_project 记录缺失`);
      errors++;
    }

    const projectDir = join(PROJECTS_DIR, p.dirName);
    if (!existsSync(projectDir) && p.status !== 'archived') {
      console.log(`⚠️  ${p.projectId} ${p.displayName}: 目录不存在 ${projectDir}`);
      errors++;
    }
  }

  // Check DB projects all in registry
  const dbProjectsRaw = sql('SELECT id, name FROM o_project;').trim();
  const regIds = new Set(registry.projects.map(p => p.projectId));
  for (const line of dbProjectsRaw.split('\n').filter(Boolean)) {
    const [id] = line.split('|');
    if (!regIds.has(Number(id))) {
      console.log(`⚠️  DB有但注册表没有: ${line}`);
      errors++;
    }
  }

  // Check canvas data orphans
  const canvasRaw = sql(`SELECT DISTINCT projectId FROM o_agentWorkData WHERE key = 'canvasGraph';`).trim();
  for (const line of canvasRaw.split('\n').filter(Boolean)) {
    const pid = Number(line);
    if (!regIds.has(pid)) {
      console.log(`⚠️  画布数据孤儿: projectId=${pid} 有画布数据但无项目记录`);
      errors++;
    }
  }

  if (errors === 0) {
    console.log('✅ 全部一致，无异常\n');
  } else {
    console.log(`\n共 ${errors} 个问题\n`);
  }
}

// ─── CLI ───────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'list':
    cmdList();
    break;
  case 'create':
    if (args.length < 2) {
      console.error('用法: project-manager.js create <dirName> <displayName> [intro]');
      process.exit(1);
    }
    cmdCreate(args[0], args[1], args[2] || '');
    break;
  case 'info':
    if (!args[0]) {
      console.error('用法: project-manager.js info <projectId>');
      process.exit(1);
    }
    cmdInfo(args[0]);
    break;
  case 'register':
    if (args.length < 3) {
      console.error('用法: project-manager.js register <projectId> <dirName> <displayName>');
      process.exit(1);
    }
    cmdRegister(args[0], args[1], args[2]);
    break;
  case 'verify':
    cmdVerify();
    break;
  default:
    console.log(`kais-movie-agent 项目管理工具

用法:
  node bin/project-manager.js list                                         列出所有项目
  node bin/project-manager.js create <dirName> <displayName> [intro]       创建新项目
  node bin/project-manager.js info <projectId>                             查看项目详情
  node bin/project-manager.js register <projectId> <dirName> <displayName> 注册已有项目
  node bin/project-manager.js verify                                       一致性检查

projectId 规则:
  1-999:    测试/临时项目
  1000+:    正式项目 (自动从 nextProjectId 分配)
  双写:     o_project 表 + projects/registry.json`);
}
