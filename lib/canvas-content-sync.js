/**
 * canvas-content-sync.js — 将管线产出物内容同步到无限画布
 *
 * 弥补 canvas-sync-hook.js 只同步 phase 状态不同步内容的缺口。
 * 支持：剧本→剧集节点、角色→角色卡片节点、场景→场景卡片节点
 *
 * 使用方式：
 *   import { syncScreenplayToCanvas, syncCharactersToCanvas } from './canvas-content-sync.js';
 *   await syncScreenplayToCanvas({ projectId: 1800, episodesId: 2, screenplay });
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';

const DB_PATH = '/home/kai/workspace/kais-aigc-platform/data/db2.sqlite';

/**
 * 直接通过 SQLite 读写画布图（绕过 HTTP API，性能更好）
 * 注意：仅在本机运行时可用
 */

async function loadGraph(projectId, episodesId) {
  // 使用 sqlite3 CLI（零依赖）
  const raw = execSync(`sqlite3 "${DB_PATH}" "SELECT data FROM o_agentWorkData WHERE projectId=${projectId} AND episodesId=${episodesId} AND key='canvasGraph';"`, { encoding: 'utf8' });
  const trimmed = raw.trim();
  if (!trimmed) return { nodes: [], edges: [], meta: { version: '2', projectId, episodesId } };
  return JSON.parse(trimmed);
}

async function saveGraph(projectId, episodesId, graph) {
  const now = Date.now();
  graph.meta = graph.meta || {};
  graph.meta.updatedAt = now;
  const jsonStr = JSON.stringify(graph);
  // Write to temp file to avoid shell escaping issues
  const tmpFile = `/tmp/canvas_graph_${projectId}_${episodesId}.json`;
  writeFileSync(tmpFile, jsonStr);
  execSync(`sqlite3 "${DB_PATH}" "UPDATE o_agentWorkData SET data = readfile('${tmpFile}'), updateTime = ${now} WHERE projectId=${projectId} AND episodesId=${episodesId} AND key='canvasGraph';"`);
}

/**
 * 同步剧本到画布：为每集创建一个节点
 * @param {object} options
 * @param {number} options.projectId
 * @param {number} options.episodesId
 * @param {object} options.screenplay - step3-scripts-v2.json 的内容
 * @param {string} options.variantKey - 'alpha' | 'beta' | 'gamma'
 * @param {string} options.parentNodeId - 剧集节点的父节点（Step3节点）
 */
export async function syncScreenplayToCanvas({ projectId, episodesId, screenplay, variantKey = 'alpha', parentNodeId = 'n-script' }) {
  const graph = await loadGraph(projectId, episodesId);
  
  const variant = screenplay.scripts[variantKey];
  if (!variant) throw new Error(`Variant "${variantKey}" not found`);
  
  const episodes = variant.episodes;
  
  // Remove existing episode nodes (idempotent)
  const epNodeIds = new Set();
  for (let i = 1; i <= 20; i++) epNodeIds.add(`n-ep${i}`);
  graph.nodes = graph.nodes.filter(n => !epNodeIds.has(n.id));
  // Remove edges to/from old ep nodes
  graph.edges = graph.edges.filter(e => {
    const isEpEdge = (e.source || '').match(/^n-ep\d+$/) || (e.target || '').match(/^n-ep\d+$/);
    return !isEpEdge || (epNodeIds.has(e.source) && epNodeIds.has(e.target));
  });
  // Remove all old ep edges for clean slate
  graph.edges = graph.edges.filter(e => {
    return !e.source?.startsWith('n-ep') && !e.target?.startsWith('n-ep');
  });
  
  // Create episode nodes
  const xBase = 80;
  const yBase = 800;
  const epW = 340;
  const epH = 200;
  const gap = 20;
  let prevId = parentNodeId;
  
  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    const node_id = `n-ep${i + 1}`;
    const scenes_count = ep.scenes?.length || 0;
    
    graph.nodes.push({
      id: node_id,
      type: 'script',
      branchId: 'main',
      phaseIndex: 3,
      phaseName: '剧本',
      position: { x: xBase + i * (epW + gap), y: yBase },
      size: { width: epW, height: epH },
      data: {
        label: `${ep.ep}: ${ep.title}`,
        description: `${ep.logline?.slice(0, 80) || ''}...\n🎬 定格: ${(ep.signature_shot || '').slice(0, 60)}...\n✨ 奇幻: ${(ep.fantasy || '').slice(0, 60)}...`,
        tags: [ep.emotion || '', `${scenes_count}场`],
        state: 'success',
        category: 'episode',
        ep: ep.ep,
        title: ep.title,
        logline: ep.logline,
        hook_ending: ep.hook_ending,
        plot_twist: ep.plot_twist,
        fantasy: ep.fantasy,
        signature_shot: ep.signature_shot,
        comedy_beat: ep.comedy_beat,
      },
    });
    
    graph.edges.push({
      id: `e-${prevId}-${node_id}`,
      source: prevId,
      target: node_id,
      animated: true,
    });
    
    prevId = node_id;
  }
  
  // Update parent node status
  for (const n of graph.nodes) {
    if (n.id === parentNodeId) {
      n.data.state = 'success';
      n.data.reviewStatus = 'approved';
      n.data.label = `Step3: 剧本锁定 ✅ (${variantKey})`;
      n.data.description = `${episodes.length}集 × ${graph.nodes.filter(x => x.data?.category === 'episode').length}场 | ${screenplay.common_notes?.slice(0, 60) || ''}`;
    }
  }
  
  await saveGraph(projectId, episodesId, graph);
  return { episodeNodes: episodes.length, totalNodes: graph.nodes.length };
}

/**
 * 同步角色到画布：为每个角色创建卡片节点
 */
export async function syncCharactersToCanvas({ projectId, episodesId, characters, parentNodeId = 'n-step4' }) {
  const graph = await loadGraph(projectId, episodesId);
  
  // Remove existing character nodes
  graph.nodes = graph.nodes.filter(n => !n.id?.startsWith('n-char-'));
  graph.edges = graph.edges.filter(e => !e.source?.startsWith('n-char-') && !e.target?.startsWith('n-char-'));
  
  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    const node_id = `n-char-${char.name_en || char.name}`;
    
    graph.nodes.push({
      id: node_id,
      type: 'asset',
      branchId: 'main',
      phaseIndex: 4,
      phaseName: '角色设计',
      position: { x: 80 + i * 360, y: 1100 },
      size: { width: 340, height: 240 },
      data: {
        label: `👤 ${char.name}`,
        description: `${char.age}岁 ${char.occupation}\n${char.personality}\nL1-L4资产库`,
        tags: ['character', char.role || ''],
        state: char.assets ? 'success' : 'pending',
        category: 'character',
        ...char,
      },
    });
    
    graph.edges.push({
      id: `e-${parentNodeId}-${node_id}`,
      source: parentNodeId,
      target: node_id,
    });
  }
  
  await saveGraph(projectId, episodesId, graph);
  return { characterNodes: characters.length };
}
