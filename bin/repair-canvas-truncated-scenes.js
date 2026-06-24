#!/usr/bin/env node
/**
 * repair-canvas-truncated-scenes.js — 修复 canvasGraph 中被截断的剧本字段
 *
 * 背景：
 *   候选变体的 episodes[].scenes[].content / ep.hook_ending / ep.plot_twist
 *   在写入 canvasGraph 时被截断（content/hook_ending/plot_twist 截到 150，
 *   fantasy/signature_shot 截到 200，highlight = signature_shot[:100] + '...'）。
 *   源数据 step3-scripts-v2.json 中是完整内容，但 DB 中存的是截断版。
 *
 * 用法：
 *   node bin/repair-canvas-truncated-scenes.js \
 *     --projectId 1800 --episodesId 2 \
 *     --screenplay output/20260619-urban-fantasy-comedy/step3-scripts-v2.json \
 *     [--nodeId n-script] [--dry-run]
 *
 * 行为：
 *   1. 读取 screenplay JSON（alpha/beta/gamma 三个变体的完整 episodes）
 *   2. 读取 DB 中的 canvasGraph
 *   3. 找到指定节点（默认 n-script）的 candidates[] 数组
 *   4. 按变体顺序（alpha/beta/gamma）回填完整字段：
 *      - cand.highlight           ← ep[0].signature_shot 完整
 *      - cand.emotional_resonance ← ep[0].emotion 完整（保留原值，仅当被截断时覆盖）
 *      - ep.logline / emotion / fantasy / signature_shot / hook_ending / plot_twist ← 完整
 *      - scene.content            ← 完整
 *      其他字段（topic_kernel, genre_tag, score, tags, ...）保持不变。
 *   5. 写回 DB（除非 --dry-run）。
 *
 * 幂等：重跑不会改变已完整的字段（按 episode/scene 索引匹配）。
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const DB_PATH = process.env.DB_PATH || '/home/kai/workspace/kais-aigc-platform/data/db2.sqlite';
const DEFAULT_SCREENPLAY = '/data/workspace/kais-movie-agent/output/20260619-urban-fantasy-comedy/step3-scripts-v2.json';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    }
  }
  return opts;
}

// PIPE-INTEGRITY-02: strict positive-integer validation for CLI args that flow
// into sqlite3 SQL string interpolation. Two-layer guard:
//   1. /^\d+$/ regex — blocks negatives (no -), floats (no .), strings, and any
//      injection payload containing ; / space / quotes. Primary injection block.
//   2. Number.isInteger && > 0 — defense-in-depth numeric check.
// `raw === undefined || raw === true` means the flag was missing or given as a
// bare boolean (e.g. `--projectId` with no value); returns null so the caller's
// required-arg check can emit the usage message.
function assertPositiveInt(raw, label) {
  if (raw === undefined || raw === true) return null;
  const s = String(raw);
  if (!/^\d+$/.test(s)) {
    console.error(`Invalid --${label}: must be positive integer (got: ${raw})`);
    process.exit(1);
  }
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`Invalid --${label}: must be positive integer (got: ${raw})`);
    process.exit(1);
  }
  return n;
}

// execFileSync bypasses the shell — no quoting issues with SQL containing single quotes.
function loadGraph(projectId, episodesId) {
  const sql = `SELECT data FROM o_agentWorkData WHERE projectId=${projectId} AND episodesId=${episodesId} AND key='canvasGraph';`;
  const raw = execFileSync('sqlite3', [DB_PATH, sql], { encoding: 'utf8' }).trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

function saveGraph(projectId, episodesId, graph) {
  const now = Date.now();
  graph.meta = graph.meta || {};
  graph.meta.updatedAt = now;
  const tmpFile = `/tmp/canvas_graph_repair_${projectId}_${episodesId}.json`;
  writeFileSync(tmpFile, JSON.stringify(graph));
  const sql = `UPDATE o_agentWorkData SET data = readfile('${tmpFile}'), updateTime = ${now} WHERE projectId=${projectId} AND episodesId=${episodesId} AND key='canvasGraph';`;
  execFileSync('sqlite3', [DB_PATH, sql]);
}

const VARIANT_KEYS = ['alpha', 'beta', 'gamma'];

function repairCandidate(candidate, srcVariant) {
  const srcEpisodes = srcVariant.episodes || [];
  const dstEpisodes = candidate.episodes || [];
  const stats = { episodes: 0, scenes: 0, fields: {} };

  // highlight ← ep[0].signature_shot (full, no truncation)
  if (srcEpisodes[0]?.signature_shot) {
    const full = srcEpisodes[0].signature_shot;
    if (candidate.highlight !== full) {
      candidate.highlight = full;
      stats.fields.highlight = (stats.fields.highlight || 0) + 1;
    }
  }

  // emotional_resonance ← ep[0].emotion (if was truncated)
  if (srcEpisodes[0]?.emotion && srcEpisodes[0].emotion.length > (candidate.emotional_resonance || '').length) {
    candidate.emotional_resonance = srcEpisodes[0].emotion;
    stats.fields.emotional_resonance = (stats.fields.emotional_resonance || 0) + 1;
  }

  for (let i = 0; i < dstEpisodes.length && i < srcEpisodes.length; i++) {
    const sep = srcEpisodes[i];
    const dep = dstEpisodes[i];
    stats.episodes++;

    // Episode-level text fields: replace with full content
    for (const k of ['logline', 'emotion', 'fantasy', 'signature_shot', 'hook_ending', 'plot_twist']) {
      const src = sep[k];
      if (typeof src === 'string' && src !== dep[k]) {
        // Only overwrite if source is longer (defensive — don't shrink)
        if (!dep[k] || src.length >= dep[k].length) {
          dep[k] = src;
          stats.fields[`ep.${k}`] = (stats.fields[`ep.${k}`] || 0) + 1;
        }
      }
    }

    // Scene contents: full content
    const srcScenes = sep.scenes || [];
    const dstScenes = dep.scenes || [];
    for (let j = 0; j < dstScenes.length && j < srcScenes.length; j++) {
      const src = srcScenes[j];
      const dst = dstScenes[j];
      if (typeof src === 'object' && src && typeof dst === 'object' && dst) {
        const srcContent = src.content;
        if (typeof srcContent === 'string' && srcContent !== dst.content) {
          if (!dst.content || srcContent.length >= dst.content.length) {
            dst.content = srcContent;
            stats.scenes++;
          }
        }
      } else if (typeof src === 'string' && src !== dst) {
        if (!dst || src.length >= String(dst).length) {
          dst = src;
          stats.scenes++;
        }
      }
    }
  }
  return stats;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const nodeId = opts.nodeId || 'n-script';
  const screenplayPath = opts.screenplay || DEFAULT_SCREENPLAY;
  const dryRun = Boolean(opts['dry-run']);

  if (opts.projectId === undefined || opts.episodesId === undefined) {
    console.error('Usage: repair-canvas-truncated-scenes.js --projectId <id> --episodesId <id> [--screenplay <path>] [--nodeId <id>] [--dry-run]');
    process.exit(1);
  }
  const projectId = assertPositiveInt(opts.projectId, 'projectId');
  const episodesId = assertPositiveInt(opts.episodesId, 'episodesId');

  if (!existsSync(screenplayPath)) {
    console.error(`Screenplay file not found: ${screenplayPath}`);
    process.exit(1);
  }

  console.log(`📖 Reading screenplay: ${screenplayPath}`);
  const screenplay = JSON.parse(readFileSync(screenplayPath, 'utf8'));
  const scripts = screenplay.scripts || screenplay;
  console.log(`   Variants in source: ${Object.keys(scripts).join(', ')}`);

  console.log(`\n🔌 Loading canvasGraph (projectId=${projectId}, episodesId=${episodesId})`);
  const graph = loadGraph(projectId, episodesId);
  if (!graph) {
    console.error('canvasGraph not found for given projectId/episodesId');
    process.exit(1);
  }
  console.log(`   Nodes: ${graph.nodes?.length || 0}`);

  const node = (graph.nodes || []).find(n => n.id === nodeId);
  if (!node) {
    console.error(`Node "${nodeId}" not found in canvas. Available: ${(graph.nodes || []).map(n => n.id).join(', ')}`);
    process.exit(1);
  }

  const candidates = node.data?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    console.error(`Node "${nodeId}" has no candidates[] array to repair.`);
    process.exit(1);
  }
  console.log(`   Found ${candidates.length} candidates in ${nodeId}`);

  let totalScenesFixed = 0;
  let totalFieldsFixed = 0;
  for (let i = 0; i < candidates.length; i++) {
    const vk = VARIANT_KEYS[i] || Object.keys(scripts)[i];
    const src = scripts[vk];
    if (!src) {
      console.warn(`   ⚠️  Candidate[${i}] has no matching source variant "${vk}" — skipping`);
      continue;
    }
    const stats = repairCandidate(candidates[i], src);
    console.log(`   ✓ Candidate[${i}] (${vk}): ${stats.episodes} eps, ${stats.scenes} scenes, fields: ${JSON.stringify(stats.fields)}`);
    totalScenesFixed += stats.scenes;
    totalFieldsFixed += Object.values(stats.fields).reduce((a, b) => a + b, 0);
  }

  console.log(`\n📊 Total: ${totalScenesFixed} scenes + ${totalFieldsFixed} episode/candidate fields would be restored to full content.`);

  if (dryRun) {
    console.log('\n[Dry-run] No DB changes made.');
    return;
  }

  saveGraph(projectId, episodesId, graph);
  console.log(`\n✅ canvasGraph updated (projectId=${projectId}, episodesId=${episodesId})`);
}

main().catch(err => {
  console.error('Repair failed:', err);
  process.exit(1);
});
