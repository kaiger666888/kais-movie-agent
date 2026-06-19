/**
 * canvas-sync-hook.js — Pipeline → Canvas 自动同步适配器
 *
 * 设计原则:
 * 1. Agent-agnostic: 通过 phaseMapper 配置任意 agent 的 phase → canvas node 映射
 * 2. Fail-open: 画布写入失败不阻塞管线
 * 3. Zero-dependency: 纯 Node.js fetch
 *
 * 用法 (kais-movie-agent):
 *   import { createCanvasSync } from './lib/canvas-sync-hook.js';
 *   const canvasSync = createCanvasSync({
 *     baseUrl: 'http://192.168.71.176:10588',
 *     projectId: 1,
 *     episodesId: 1,
 *   });
 *   const pipeline = new KaisPipeline({
 *     workdir, episode,
 *     onProgress: canvasSync.onProgress,
 *     onPhaseComplete: canvasSync.onPhaseComplete,
 *     onPhaseFail: canvasSync.onPhaseFail,
 *     onCanvasPush: canvasSync.onCanvasPush,
 *   });
 *
 * 用法 (其他 agent):
 *   const sync = createCanvasSync({
 *     baseUrl, projectId, episodesId,
 *     phaseMapper: (agentPhase) => ({ ...custom mapping... }),
 *   });
 *   // 手动调用
 *   sync.reportPhaseStart({ id: 'step1', name: '主题选择', stage: 'topic-selection', stageOrder: 1 });
 *   sync.reportPhaseDone({ id: 'step1', name: '主题选择', stage: 'topic-selection' }, { summary, metrics });
 */

// ─── Phase → Canvas Node 映射器 ────────────────────────

/**
 * 默认 phaseMapper: 将 kais-movie-agent 的 phase 定义映射为画布节点数据
 * @param {object} phase - Pipeline phase 对象 { id, name, stage, stageOrder, review, outputFiles }
 * @returns {object} Canvas node data { label, phase, description, tags, filePath }
 */
export function defaultPhaseMapper(phase) {
  // 根据 stage 前缀推断 phase 分组
  const stage = phase.stage || phase.id || '';
  let phaseGroup = 'production';
  if (/^(pain|topic|outline|script|character|scene|spatio)/.test(stage)) {
    phaseGroup = phase.stageOrder <= 5 ? 'research' : 'story';
  } else if (/^(seed|motion|ai-preview|consistency|render|final)/.test(stage)) {
    phaseGroup = 'production';
  }

  return {
    label: phase.name || phase.id,
    phase: phaseGroup,
    tags: phase.review ? ['需审核'] : [],
    filePath: (phase.outputFiles || []).join(', ') || undefined,
  };
}

// ─── 核心 Sync 类 ──────────────────────────────────────

/**
 * createCanvasSync — 创建画布同步适配器
 *
 * @param {object} options
 * @param {string} options.baseUrl - 画布服务地址 (e.g. 'http://192.168.71.176:10588')
 * @param {number} options.projectId - 画布项目 ID
 * @param {number} options.episodesId - 画布剧集 ID
 * @param {Function} [options.phaseMapper] - 自定义 phase → node 映射器
 * @param {string} [options.agentName] - Agent 名称 (用于节点标签前缀)
 * @param {number} [options.timeout] - HTTP 超时 ms
 * @returns {object} { onProgress, onPhaseComplete, onPhaseFail, onCanvasPush, reportPhaseStart, reportPhaseDone, reportPhaseFail, reportReviewCandidates }
 */
export function createCanvasSync({
  baseUrl = 'http://192.168.71.176:10588',
  projectId,
  episodesId,
  phaseMapper = defaultPhaseMapper,
  agentName = '',
  timeout = 10000,
} = {}) {
  if (!projectId || !episodesId) {
    throw new Error('createCanvasSync: projectId 和 episodesId 必填');
  }

  const api = baseUrl.replace(/\/$/, '');
  const nodeMap = new Map(); // phaseId → { nodeId, prevPhaseId }

  // ─── HTTP helper ──────────────────────────────────

  async function request(path, body) {
    try {
      const resp = await fetch(`${api}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      if (!resp.ok) {
        console.warn(`[CanvasSync] HTTP ${resp.status}: ${path}`);
        return null;
      }
      const raw = await resp.text();
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.warn(`[CanvasSync] Request failed (${path}): ${err.message}`);
      return null;
    }
  }

  // ─── Graph load/save ──────────────────────────────

  async function loadGraph() {
    const res = await request('/api/v2/canvas/load', { projectId, episodesId });
    return res?.data || null;
  }

  async function saveGraph(graph) {
    // Ensure required v2 fields
    if (!graph.meta) {
      graph.meta = {
        version: '2',
        projectId,
        episodesId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }
    graph.meta.updatedAt = Date.now();
    // Ensure every node has required fields
    for (const n of graph.nodes) {
      if (!n.branchId) n.branchId = 'main';
      if (n.phaseIndex === undefined) n.phaseIndex = 0;
      if (!n.phaseName) n.phaseName = n.data?.phaseName || n.id;
      if (!n.size) n.size = { width: 260, height: 180 };
    }
    return request('/api/v2/canvas/save', { projectId, episodesId, graph });
  }

  // ─── 节点位置计算 (泳道布局) ─────────────────────

  function computeNodePosition(phaseGroup, stageOrder) {
    const laneX = {
      research: 100,
      story: 1200,
      production: 2000,
      post: 2800,
    };
    const x = (laneX[phaseGroup] || 2000) + (stageOrder % 3) * 350;
    const y = 100 + Math.floor(stageOrder / 3) * 200;
    return { x, y };
  }

  // ─── 核心: upsertNode ─────────────────────────────

  async function upsertNode(nodeData) {
    const graph = await loadGraph() || { nodes: [], links: [], branches: [], variantGroups: [] };

    // 找到或创建节点
    const existingIdx = graph.nodes.findIndex(n => n.id === nodeData.id);
    if (existingIdx >= 0) {
      // 更新现有节点
      graph.nodes[existingIdx] = {
        ...graph.nodes[existingIdx],
        ...nodeData,
        data: { ...graph.nodes[existingIdx].data, ...nodeData.data },
        position: nodeData.position || graph.nodes[existingIdx].position,
      };
    } else {
      // 新增节点
      graph.nodes.push(nodeData);
    }

    await saveGraph(graph);
  }

  // ─── 核心: addLink ──────────────────────────────

  async function ensureLink(linkId, sourceId, targetId) {
    const graph = await loadGraph() || { nodes: [], links: [], branches: [], variantGroups: [] };
    if (graph.links.some(l => l.id === linkId)) return;
    graph.links.push({
      id: linkId,
      source: sourceId,
      target: targetId,
      branchId: 'main',
      dataType: 'flow',
    });
    await saveGraph(graph);
  }

  // ─── Pipeline 回调适配器 ─────────────────────────

  /**
   * onProgress — 管线进度回调
   * @param {string} phaseId
   * @param {string} phaseName
   * @param {string} status - running | reviewing | completed | failed | awaiting_review
   */
  function onProgress(phaseId, phaseName, status) {
    const stateMap = {
      running: 'running',
      reviewing: 'pending',
      completed: 'success',
      failed: 'error',
      awaiting_review: 'pending',
    };
    const nodeState = stateMap[status] || 'idle';

    // 异步更新，不阻塞
    upsertNode({
      id: `n-${phaseId}`,
      type: 'script',
      position: nodeMap.get(phaseId)?.position,
      state: nodeState,
      data: { state: nodeState },
    }).catch(() => {});
  }

  /**
   * onPhaseComplete — Phase 完成
   * @param {object} phase - { id, name, stage, stageOrder, review, outputFiles }
   * @param {object} result - { summary, metrics, review }
   */
  function onPhaseComplete(phase, result) {
    const mapped = phaseMapper(phase);
    const phaseGroup = mapped.phase || 'production';
    const position = computeNodePosition(phaseGroup, phase.stageOrder || 0);

    // 构建丰富描述
    const descParts = [];
    if (result?.summary) {
      const s = result.summary;
      if (s.description) descParts.push(s.description);
      if (s.selectedTopic) descParts.push(`选定: ${s.selectedTopic}`);
      if (s.score) descParts.push(`评分: ${s.score}`);
      if (s.variantCount) descParts.push(`${s.variantCount} 个变体`);
    }
    if (result?.metrics) {
      const m = result.metrics;
      if (m.duration) descParts.push(`耗时 ${m.duration}`);
    }
    if (result?.review?.action === 'awaiting_review') {
      descParts.push('⏳ 等待审核');
    }

    // 记录节点信息
    const prevPhaseId = nodeMap.get(phaseId)?.prevPhaseId;
    nodeMap.set(phase.id, { nodeId: `n-${phase.id}`, position, prevPhaseId });

    // 异步写入
    upsertNode({
      id: `n-${phase.id}`,
      type: 'script',
      position,
      size: { width: 260, height: 180 },
      state: result?.review?.action === 'awaiting_review' ? 'pending' : 'success',
      branchId: 'main',
      data: {
        label: mapped.label,
        phase: phaseGroup,
        description: descParts.join('\n') || mapped.label,
        tags: mapped.tags || [],
        filePath: mapped.filePath,
        score: result?.metrics?.score || result?.summary?.score,
        content: descParts.join('\n') || mapped.label,
        state: result?.review?.action === 'awaiting_review' ? 'pending' : 'success',
        reviewStatus: result?.review?.action === 'awaiting_review' ? 'awaiting_audit' :
                      phase.review ? 'approved' : undefined,
        phaseName: `${phase.id}`,
      },
    }).then(async () => {
      // 连线到上一个节点
      if (prevPhaseId) {
        await ensureLink(`l-${prevPhaseId}-${phase.id}`, `n-${prevPhaseId}`, `n-${phase.id}`);
      }
    }).catch(() => {});

    // 更新下一个 phase 的 prevPhaseId
    // (通过 stageOrder 找下一个 phase)
  }

  /**
   * onPhaseFail — Phase 失败
   * @param {object} phase
   * @param {Error} error
   */
  function onPhaseFail(phase, error) {
    const mapped = phaseMapper(phase);
    const position = computeNodePosition(mapped.phase || 'production', phase.stageOrder || 0);

    upsertNode({
      id: `n-${phase.id}`,
      type: 'script',
      position,
      size: { width: 260, height: 180 },
      state: 'error',
      branchId: 'main',
      data: {
        label: mapped.label,
        phase: mapped.phase || 'production',
        description: `❌ ${error.message}`,
        tags: ['失败'],
        content: `❌ ${error.message}`,
        state: 'error',
      },
    }).catch(() => {});
  }

  /**
   * onCanvasPush — 审核候选项推送到画布
   * @param {object} phase
   * @param {Array} candidates
   */
  function onCanvasPush(phase, candidates) {
    // 可以在这里创建变体组节点
    // 目前只更新 phase 节点的 description
    const descLines = candidates.map((c, i) =>
      `候选${i + 1}: ${c.label || c.id || '未命名'}`
    );

    upsertNode({
      id: `n-${phase.id}`,
      type: 'script',
      data: {
        description: `${descLines.join('\n')}\n共 ${candidates.length} 个候选`,
        content: `${descLines.join('\n')}\n共 ${candidates.length} 个候选`,
        tags: ['审核中'],
        reviewStatus: 'awaiting_audit',
      },
    }).catch(() => {});
  }

  // ─── 手动 API (供非 movie-agent 使用) ────────────

  /**
   * reportPhaseStart — 手动报告 phase 开始
   */
  async function reportPhaseStart(phaseInfo) {
    const mapped = phaseMapper(phaseInfo);
    const position = computeNodePosition(mapped.phase || 'production', phaseInfo.stageOrder || 0);

    // 找到上一个 phase 用于连线
    const knownPhases = [...nodeMap.entries()].sort((a, b) => {
      const aOrder = a[1]?.stageOrder || 0;
      const bOrder = b[1]?.stageOrder || 0;
      return aOrder - bOrder;
    });
    const prevPhaseId = knownPhases.length > 0 ? knownPhases[knownPhases.length - 1][0] : null;

    nodeMap.set(phaseInfo.id, { nodeId: `n-${phaseInfo.id}`, position, prevPhaseId, stageOrder: phaseInfo.stageOrder });

    await upsertNode({
      id: `n-${phaseInfo.id}`,
      type: 'script',
      position,
      size: { width: 260, height: 180 },
      state: 'running',
      branchId: 'main',
      data: {
        label: mapped.label,
        phase: mapped.phase || 'production',
        description: '运行中...',
        tags: mapped.tags || [],
        filePath: mapped.filePath,
        content: '运行中...',
        state: 'running',
      },
    });

    if (prevPhaseId) {
      await ensureLink(`l-${prevPhaseId}-${phaseInfo.id}`, `n-${prevPhaseId}`, `n-${phaseInfo.id}`);
    }
  }

  /**
   * reportPhaseDone — 手动报告 phase 完成
   */
  async function reportPhaseDone(phaseInfo, result = {}) {
    const mapped = phaseMapper(phaseInfo);
    const descParts = [];
    if (result.description) descParts.push(result.description);
    if (result.score) descParts.push(`评分: ${result.score}`);
    if (result.tags) result.tags.forEach(t => descParts.push(`#${t}`));

    await upsertNode({
      id: `n-${phaseInfo.id}`,
      type: 'script',
      state: 'success',
      data: {
        label: mapped.label,
        phase: mapped.phase || 'production',
        description: descParts.join('\n') || '完成',
        tags: result.tags || mapped.tags || [],
        score: result.score,
        filePath: result.filePath || mapped.filePath,
        content: descParts.join('\n') || '完成',
        state: 'success',
        reviewStatus: result.reviewStatus || (phaseInfo.review ? 'approved' : undefined),
      },
    });
  }

  /**
   * reportPhaseFail — 手动报告 phase 失败
   */
  async function reportPhaseFail(phaseInfo, errorMessage) {
    await upsertNode({
      id: `n-${phaseInfo.id}`,
      type: 'script',
      state: 'error',
      data: {
        description: `❌ ${errorMessage}`,
        content: `❌ ${errorMessage}`,
        tags: ['失败'],
        state: 'error',
      },
    });
  }

  /**
   * reportReviewCandidates — 手动推送审核候选项
   */
  async function reportReviewCandidates(phaseInfo, candidates) {
    const descLines = candidates.map((c, i) =>
      `候选${i + 1}: ${c.label || c.id || '未命名'}`
    );
    await upsertNode({
      id: `n-${phaseInfo.id}`,
      type: 'script',
      data: {
        description: `${descLines.join('\n')}\n共 ${candidates.length} 个候选`,
        content: `${descLines.join('\n')}\n共 ${candidates.length} 个候选`,
        tags: ['审核中'],
        reviewStatus: 'awaiting_audit',
        state: 'pending',
      },
    });
  }

  /**
   * initProject — 初始化项目画布 (可选)
   */
  async function initProject(name, intro) {
    // 确保 load 返回有效 graph
    const graph = await loadGraph();
    if (graph && graph.nodes.length > 0) return; // 已有数据

    await saveGraph({
      nodes: [{
        id: 'n-project-root',
        type: 'script',
        position: { x: 50, y: 50 },
        size: { width: 260, height: 120 },
        state: 'success',
        branchId: 'main',
        data: {
          label: `${agentName || 'Project'}: ${name}`,
          phase: 'research',
          description: intro || '',
          content: intro || '',
          state: 'success',
          tags: [agentName].filter(Boolean),
        },
      }],
      links: [],
      branches: [{
        id: 'main',
        label: '主线',
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }],
      variantGroups: [],
    });

    // 注册根节点
    nodeMap.set('project-root', { nodeId: 'n-project-root', position: { x: 50, y: 50 }, prevPhaseId: null, stageOrder: -1 });
  }

  return {
    // Pipeline 回调 (直接传给 KaisPipeline 构造函数)
    onProgress,
    onPhaseComplete,
    onPhaseFail,
    onCanvasPush,

    // 手动 API (供其他 agent 或脚本使用)
    reportPhaseStart,
    reportPhaseDone,
    reportPhaseFail,
    reportReviewCandidates,
    initProject,

    // 底层工具
    loadGraph,
    saveGraph,
    upsertNode,
    ensureLink,

    // 配置
    _config: { baseUrl: api, projectId, episodesId, agentName },
  };
}

export default createCanvasSync;
