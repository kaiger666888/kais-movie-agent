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

// ─── Phase → Canvas Node + Asset Type 映射器 ─────────────

/**
 * PHASE_ASSET_MAP — 将 kais-movie-agent 的 phase ID 映射为
 *   - nodeType: 画布上的节点类型 (给前端渲染用)
 *   - assetType: assets-registry 中的资产类型 (给 o_assets 注册用)
 *   - phaseGroup: 泳道分组 (research/story/production/post)
 *
 * 这是"创作过程资产化"的核心映射表。
 * 每一个管线步骤的产出物都被视为一种资产。
 */
const PHASE_ASSET_MAP = {
  // 上半部分：创意立项
  'pain-discovery':       { nodeType: 'script',      assetType: 'topic',        phaseGroup: 'research' },
  'topic-selection':      { nodeType: 'script',      assetType: 'topic',        phaseGroup: 'research' },
  'outline-generation':   { nodeType: 'script',      assetType: 'outline',      phaseGroup: 'research' },
  'outline-selection':    { nodeType: 'script',      assetType: 'outline',      phaseGroup: 'research' },
  'script-generation':    { nodeType: 'script',      assetType: 'script_phase', phaseGroup: 'story' },
  'script-selection':     { nodeType: 'script',      assetType: 'script_phase', phaseGroup: 'story' },
  'character-generation': { nodeType: 'asset',       assetType: 'character',    phaseGroup: 'story' },
  'character-selection':  { nodeType: 'asset',       assetType: 'character',    phaseGroup: 'story' },
  'spatio-temporal-script':{ nodeType: 'script',     assetType: 'script_phase', phaseGroup: 'story' },
  'scene-generation':     { nodeType: 'storyboard',  assetType: 'scene',        phaseGroup: 'story' },
  'scene-selection':      { nodeType: 'storyboard',  assetType: 'scene',        phaseGroup: 'story' },
  'script-lock':          { nodeType: 'script',      assetType: 'script_phase', phaseGroup: 'story' },

  // 下半部分：生产执行
  'seed-skeleton':        { nodeType: 'storyboard',  assetType: 'storyboard',   phaseGroup: 'production' },
  'motion-preview':       { nodeType: 'storyboard',  assetType: 'storyboard',   phaseGroup: 'production' },
  'ai-preview':           { nodeType: 'storyboard',  assetType: 'storyboard',   phaseGroup: 'production' },
  'consistency-guard':    { nodeType: 'script',      assetType: 'delivery',     phaseGroup: 'production' },
  'cloud-production':     { nodeType: 'video',       assetType: 'video',        phaseGroup: 'production' },
  'final-audio':          { nodeType: 'audio',       assetType: 'voice',        phaseGroup: 'post' },
  'composition':          { nodeType: 'video',       assetType: 'video',        phaseGroup: 'post' },
  'delivery':             { nodeType: 'video',       assetType: 'delivery',     phaseGroup: 'post' },
};

/**
 * 默认 phaseMapper: 将 phase 定义映射为画布节点数据
 * 现在基于 PHASE_ASSET_MAP，不再用正则猜测。
 * @param {object} phase - Pipeline phase 对象
 * @returns {object} Canvas node data { label, phase, nodeType, assetType, tags, filePath }
 */
export function defaultPhaseMapper(phase) {
  const mapping = PHASE_ASSET_MAP[phase.id] || { nodeType: 'script', assetType: 'script_phase', phaseGroup: 'production' };
  return {
    label: phase.name || phase.id,
    phase: mapping.phaseGroup,
    nodeType: mapping.nodeType,
    assetType: mapping.assetType,
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
    const res = await request('/api/canvas/v2/load-v2', { projectId, episodesId });
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
    return request('/api/canvas/v2/save-v2', { projectId, episodesId, graph });
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

  // ─── 资产注册 (Phase 产出物 → o_assets) ────────────

  /**
   * registerPhaseAsset — 将管线 phase 产出物注册为 o_assets 记录
   * 返回 { id, uuid } 或 null（失败时 warn 但不 throw）
   *
   * 幂等：如果该 phase 在同一 project 下已有资产（按 name+type 查找），
   * 返回已有资产 ID 而不重复创建。
   */
  async function registerPhaseAsset(phase, mapped, result) {
    const label = mapped.label || phase.name || phase.id;
    const assetType = mapped.assetType || 'script_phase';
    const filePath = mapped.filePath || '';

    // 构建描述
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
    const describe = descParts.join('\n') || label;

    try {
      // 幂等检查：按 name + type + projectId 查找已有资产
      const searchResp = await request('/api/v1/assets-registry/search', {
        query: label,
        type: assetType,
        projectId,
        limit: 5,
        includeFile: false,
      });
      if (searchResp?.data?.assets) {
        const existing = searchResp.data.assets.find(a => a.name === label);
        if (existing) {
          // 已有记录，更新 meta（不重复创建）
          await request('/api/v1/assets-registry/update-meta', {
            id: existing.id,
            describe,
            tags: `phase:${phase.id}`,
          }).catch(() => {});
          return { id: existing.id, uuid: existing.uuid };
        }
      }

      // 注册新资产
      const resp = await request('/api/v1/assets-registry', {
        asset: {
          name: label,
          type: assetType,
          prompt: '',
          describe,
          projectId,
          tags: `phase:${phase.id}`,
          meta: {
            phaseId: phase.id,
            stage: phase.stage,
            stageOrder: phase.stageOrder,
            filePath,
            reviewRequired: !!phase.review,
          },
          createdBy: 'pipeline-sync',
        },
      });
      if (resp?.data?.id) {
        console.log(`[CanvasSync] 资产已注册: ${label} → o_assets#${resp.data.id} (type=${assetType})`);
        return { id: resp.data.id, uuid: resp.data.uuid };
      }
      console.warn(`[CanvasSync] 资产注册无返回 ID: ${label}`);
      return null;
    } catch (e) {
      console.warn(`[CanvasSync] 资产注册失败 "${label}": ${e.message}`);
      return null;
    }
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

    // 查找已缓存的 nodeType（从 nodeMap 或默认 script）
    const cached = nodeMap.get(phaseId);
    const nodeType = cached?.nodeType || 'script';

    // 异步更新，不阻塞
    upsertNode({
      id: `n-${phaseId}`,
      type: nodeType,
      position: cached?.position,
      state: nodeState,
      data: { state: nodeState },
    }).catch(() => {});
  }

  /**
   * onPhaseComplete — Phase 完成
   * 1. 注册产出物为 o_assets（拿到 assetId）
   * 2. 写画布节点（带 assetId + 正确的 nodeType）
   * 3. 连线到上一个节点
   *
   * @param {object} phase - { id, name, stage, stageOrder, review, outputFiles }
   * @param {object} result - { summary, metrics, review }
   */
  async function onPhaseComplete(phase, result) {
    const mapped = phaseMapper(phase);
    const phaseGroup = mapped.phase || 'production';
    const nodeType = mapped.nodeType || 'script';
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
    const prevPhaseId = nodeMap.get(phase.id)?.prevPhaseId;
    nodeMap.set(phase.id, { nodeId: `n-${phase.id}`, position, prevPhaseId });

    // ★ 核心：先注册资产到 o_assets，拿到 assetId
    const asset = await registerPhaseAsset(phase, mapped, result);

    // ★ 写画布节点（用正确 nodeType + 带上 assetId）
    await upsertNode({
      id: `n-${phase.id}`,
      type: nodeType,
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
        reviewStatus: result?.review?.action === 'awaiting_review' ? 'pending' :
                      phase.review ? 'approved' : undefined,
        phaseName: `${phase.id}`,
        assetId: asset?.id || undefined,
        uuid: asset?.uuid || undefined,
        assetType: mapped.assetType || undefined,
      },
    });

    // 连线到上一个节点
    if (prevPhaseId) {
      await ensureLink(`l-${prevPhaseId}-${phase.id}`, `n-${prevPhaseId}`, `n-${phase.id}`);
    }

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
      type: mapped.nodeType || 'script',
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
    const mapped = phaseMapper(phase);
    // 可以在这里创建变体组节点
    // 目前只更新 phase 节点的 description
    const descLines = candidates.map((c, i) =>
      `候选${i + 1}: ${c.label || c.id || '未命名'}`
    );

    upsertNode({
      id: `n-${phase.id}`,
      type: mapped.nodeType || 'script',
      data: {
        description: `${descLines.join('\n')}\n共 ${candidates.length} 个候选`,
        content: `${descLines.join('\n')}\n共 ${candidates.length} 个候选`,
        tags: ['审核中'],
        reviewStatus: 'pending',
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

    nodeMap.set(phaseInfo.id, { nodeId: `n-${phaseInfo.id}`, position, prevPhaseId, stageOrder: phaseInfo.stageOrder, nodeType: mapped.nodeType });

    await upsertNode({
      id: `n-${phaseInfo.id}`,
      type: mapped.nodeType || 'script',
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
      type: mapped.nodeType || 'script',
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
    const mapped = phaseMapper(phaseInfo);
    await upsertNode({
      id: `n-${phaseInfo.id}`,
      type: mapped.nodeType || 'script',
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
    const mapped = phaseMapper(phaseInfo);
    const descLines = candidates.map((c, i) =>
      `候选${i + 1}: ${c.label || c.id || '未命名'}`
    );
    await upsertNode({
      id: `n-${phaseInfo.id}`,
      type: mapped.nodeType || 'script',
      data: {
        description: `${descLines.join('\n')}\n共 ${candidates.length} 个候选`,
        content: `${descLines.join('\n')}\n共 ${candidates.length} 个候选`,
        tags: ['审核中'],
        reviewStatus: 'pending',
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
