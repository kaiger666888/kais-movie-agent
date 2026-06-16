/**
 * canvas-push — 将管线阶段产出推送到无限画布
 *
 * 提供两个工厂函数：
 *   - createOnCanvasPush:     审核阶段产出 → 画布候选节点（含 variant group + 连线）
 *   - createOnCanvasProgress: runPhase 期间推送阶段进度状态（running/success/error）
 *
 * 设计原则（与 lib/canvas-client.js 一致）：
 *   - fail-open：所有 Canvas 调用 try-catch，画布挂了不影响管线
 *   - 不修改现有审核流程：Telegram / review-platform 通道保持不变
 *
 * 数据流：
 *   pipeline._runRemoteReview()
 *     → onCanvasPush(phase, candidates)
 *       → 遍历 candidates
 *         → CanvasClient.addNode({...})
 *         → CanvasClient.registerNode(nodeId, { pipelineId, phaseId })
 *         → CanvasClient.addLink(prevPhaseWinner → candidate.id)
 *     → 画布前端通过 WS 收到 node:created，渲染节点组件
 *     → 用户审核 → WS 广播 → canvas-review-handler.js → handleReviewDecision
 */

import { basename } from 'node:path';

/**
 * phase.id → 画布节点类型 + asset 子类型映射
 *
 * 同时覆盖 legacy V2 phase IDs（与 lib/pipeline.js 的 V2_MIGRATION_MAP 对齐）
 * 与 V6 phase IDs（lib/pipeline.js 的 PHASES）。
 */
const PHASE_NODE_MAP = {
  // Legacy V2 phase IDs（spec 指定）
  'art-direction':     { nodeType: 'asset',      assetSubtype: 'art-direction' },
  'character':         { nodeType: 'asset',      assetSubtype: 'character' },
  'scenario':          { nodeType: 'script',     assetSubtype: null },
  'soul-visual':       { nodeType: 'asset',      assetSubtype: 'soul-frame' },
  'soul-voice':        { nodeType: 'audio',      assetSubtype: 'voice' },
  'voice':             { nodeType: 'audio',      assetSubtype: 'voice' },
  'storyboard':        { nodeType: 'storyboard', assetSubtype: null },
  'scene':             { nodeType: 'asset',      assetSubtype: 'scene' },
  'camera-preview':    { nodeType: 'video',      assetSubtype: 'preview' },
  'camera-final':      { nodeType: 'video',      assetSubtype: 'final' },
  'post-production':   { nodeType: 'video',      assetSubtype: 'composed' },
  'composition':       { nodeType: 'video',      assetSubtype: 'composed' },

  // V6 phase IDs（lib/pipeline.js PHASES）— 补齐运行期实际 phase.id
  'pain-discovery':        { nodeType: 'script', assetSubtype: 'pain-report' },
  'topic-selection':       { nodeType: 'script', assetSubtype: 'topic' },
  'outline-generation':    { nodeType: 'script', assetSubtype: 'outline' },
  'outline-selection':     { nodeType: 'script', assetSubtype: 'outline' },
  'script-generation':     { nodeType: 'script', assetSubtype: 'script' },
  'script-selection':      { nodeType: 'script', assetSubtype: 'script' },
  'character-generation':  { nodeType: 'asset',  assetSubtype: 'character' },
  'character-selection':   { nodeType: 'asset',  assetSubtype: 'character' },
  'scene-generation':      { nodeType: 'asset',  assetSubtype: 'scene' },
  'scene-selection':       { nodeType: 'asset',  assetSubtype: 'scene' },
  'spatio-temporal-script':{ nodeType: 'storyboard', assetSubtype: null },
  'script-lock':           { nodeType: 'script', assetSubtype: 'locked-script' },
  'seed-skeleton':         { nodeType: 'storyboard', assetSubtype: 'seed' },
  'motion-preview':        { nodeType: 'video',  assetSubtype: 'preview' },
  'ai-preview':            { nodeType: 'video',  assetSubtype: 'preview' },
  'consistency-guard':     { nodeType: 'asset',  assetSubtype: 'consistency' },
  'cloud-production':      { nodeType: 'video',  assetSubtype: 'final' },
  'final-audio':           { nodeType: 'audio',  assetSubtype: 'mix' },
  'delivery':              { nodeType: 'asset',  assetSubtype: 'delivery' },
};

/**
 * 默认文件 URL 前缀（kais-aigc-platform 的 /oss/ 静态路由）
 */
const DEFAULT_OUTPUT_BASE_URL = 'http://192.168.71.166:8000/oss';

/**
 * 默认本地文件路径前缀（剥离此段后拼接到 outputBaseUrl）
 */
const DEFAULT_LOCAL_PREFIX = '/mnt/agents/output';

/**
 * 根据本地绝对路径 + outputBaseUrl 构建可访问的 HTTP URL
 *
 * 规则：
 *   - 已是 http(s) URL → 原样返回
 *   - 绝对路径以 localPrefix 开头 → 剥离前缀，拼接到 outputBaseUrl
 *   - 其他绝对路径 → 取 basename 拼接到 outputBaseUrl
 *   - 相对路径 → 直接拼接到 outputBaseUrl
 *
 * @param {string} raw
 * @param {object} opts
 * @param {string} opts.outputBaseUrl
 * @param {string} opts.localPrefix
 * @returns {string|null}
 */
export function buildAssetUrl(raw, { outputBaseUrl, localPrefix } = {}) {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 已是完整 URL — 直接使用
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const base = (outputBaseUrl || DEFAULT_OUTPUT_BASE_URL).replace(/\/$/, '');
  const prefix = localPrefix || DEFAULT_LOCAL_PREFIX;

  // 绝对路径以 localPrefix 开头 → 剥离前缀
  if (trimmed.startsWith(prefix)) {
    const rest = trimmed.slice(prefix.length).replace(/^\/+/, '');
    return rest ? `${base}/${rest}` : null;
  }

  // 其他绝对路径 → 取 basename 拼接（保守策略，避免泄露完整本地路径）
  if (trimmed.startsWith('/')) {
    const name = basename(trimmed);
    return name ? `${base}/${name}` : null;
  }

  // 相对路径 → 直接拼接
  return `${base}/${trimmed.replace(/^\.?\//, '')}`;
}

/**
 * 解析 candidate 的所有可能路径/URL 字段，返回首个有效的 (filePath, url) 对
 *
 * 字段优先级：imageUrl > imagePath > videoUrl > videoPath > audioUrl > audioPath > path
 *
 * @param {object} candidate
 * @param {object} opts — 透传给 buildAssetUrl
 * @returns {{filePath: string|null, url: string|null, thumbnailUrl: string|null, kind: 'image'|'video'|'audio'|null}}
 */
function resolveCandidateAsset(candidate, opts) {
  if (!candidate || typeof candidate !== 'object') {
    return { filePath: null, url: null, thumbnailUrl: null, kind: null };
  }

  const tryFields = [
    { urlField: 'imageUrl', pathField: 'imagePath', kind: 'image', isThumb: true },
    { urlField: 'videoUrl', pathField: 'videoPath', kind: 'video', isThumb: false },
    { urlField: 'audioUrl', pathField: 'audioPath', kind: 'audio', isThumb: false },
    { urlField: null,       pathField: 'path',      kind: null,   isThumb: false },
  ];

  for (const f of tryFields) {
    const urlRaw = f.urlField ? candidate[f.urlField] : null;
    if (urlRaw) {
      const url = buildAssetUrl(urlRaw, opts);
      if (url) {
        return {
          filePath: candidate[f.pathField] || urlRaw,
          url,
          thumbnailUrl: f.isThumb ? url : (candidate.imagePath ? buildAssetUrl(candidate.imagePath, opts) : null),
          kind: f.kind,
        };
      }
    }
    const pathRaw = candidate[f.pathField];
    if (pathRaw) {
      const url = buildAssetUrl(pathRaw, opts);
      if (url) {
        return {
          filePath: pathRaw,
          url,
          thumbnailUrl: f.isThumb ? url : null,
          kind: f.kind,
        };
      }
    }
  }

  return { filePath: null, url: null, thumbnailUrl: null, kind: null };
}

/**
 * 创建 onCanvasPush 回调
 *
 * @param {import('./canvas-client.js').CanvasClient} canvasClient
 * @param {object} options
 * @param {string} [options.branchId='main']
 * @param {string} [options.outputBaseUrl]
 * @param {string} [options.localPrefix]
 * @param {string} [options.workdir]
 * @param {string} [options.pipelineId]
 * @returns {Promise<(phase: object, candidates: Array) => Promise<{pushed: number, errors: number}>>}
 */
export function createOnCanvasPush(canvasClient, options = {}) {
  if (!canvasClient) throw new Error('createOnCanvasPush: canvasClient 必填');

  const {
    branchId = 'main',
    outputBaseUrl = DEFAULT_OUTPUT_BASE_URL,
    localPrefix = DEFAULT_LOCAL_PREFIX,
    workdir = null,
    pipelineId = null,
  } = options;

  const urlOpts = { outputBaseUrl, localPrefix };

  // 闭包状态：phase 顺序与每 phase 的 winner 节点（用于 addLink）
  /** @type {Map<string, string>} phaseId → winnerNodeId */
  const phaseWinners = new Map();
  /** @type {string[]} 已推送 phase 的顺序（用于查找"前一个 phase"） */
  const phaseOrder = [];

  /**
   * @param {object} phase
   * @param {Array} candidates
   */
  return async function onCanvasPush(phase, candidates) {
    if (!phase?.id) {
      console.warn('[canvas-push] phase.id 缺失，跳过');
      return { pushed: 0, errors: 0 };
    }
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return { pushed: 0, errors: 0 };
    }

    const phaseId = phase.id;
    const nodeMeta = PHASE_NODE_MAP[phaseId] || { nodeType: 'asset', assetSubtype: phaseId };
    const variantGroupId = `vg-${phaseId}`;
    const ctxPipelineId = pipelineId || canvasClient._pipelineId || 'pipeline';

    // 找前一个 phase 的 winner 节点（用于 addLink）
    let prevWinnerNodeId = null;
    if (phaseOrder.length > 0) {
      const prevPhaseId = phaseOrder[phaseOrder.length - 1];
      prevWinnerNodeId = phaseWinners.get(prevPhaseId) || null;
    }

    let pushed = 0;
    let errors = 0;
    /** @type {string[]} 本 phase 创建的节点 ID（用于选 winner） */
    const createdNodeIds = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i] || {};
      const candidateId = candidate.id || `${phaseId}-cand-${i + 1}`;

      const asset = resolveCandidateAsset(candidate, urlOpts);

      const position = canvasClient.suggestCandidatePosition
        ? canvasClient.suggestCandidatePosition(i)
        : { x: 0, y: i * 280 };

      const node = {
        id: candidateId,
        type: nodeMeta.nodeType,
        branchId,
        phaseIndex: typeof phase.stageOrder === 'number' ? phase.stageOrder : phase.order,
        phaseName: phase.name || phaseId,
        phaseId,
        position,
        data: {
          label: candidate.label || candidateId,
          description: candidate.description || '',
          filePath: asset.filePath,
          url: asset.url,
          thumbnailUrl: asset.thumbnailUrl,
          assetType: nodeMeta.assetSubtype,
          kind: asset.kind,
          episode: options.episode || null,
        },
        state: 'success',
        reviewStatus: 'pending',
        variantGroupId,
        variantOf: null,
      };

      try {
        await canvasClient.addNode(node);
        createdNodeIds.push(candidateId);
        pushed++;

        // 注册 nodeId → { pipelineId, phaseId } 映射（审核回调反查用）
        canvasClient.registerNode(candidateId, { pipelineId: ctxPipelineId, phaseId });

        // 连线到前一个 phase 的 winner
        if (prevWinnerNodeId) {
          try {
            await canvasClient.addLink({
              id: `link-${prevWinnerNodeId}-${candidateId}`,
              source: prevWinnerNodeId,
              target: candidateId,
              dataType: nodeMeta.nodeType,
            });
          } catch (linkErr) {
            console.warn(`[canvas-push] addLink 失败 (降级): ${linkErr.message}`);
          }
        }
      } catch (err) {
        errors++;
        console.warn(`[canvas-push] addNode 失败 candidate=${candidateId} (降级): ${err.message}`);
      }
    }

    // 更新 phase 顺序与 winner（首个 candidate 作为本 phase 的默认 winner）
    if (createdNodeIds.length > 0) {
      if (!phaseOrder.includes(phaseId)) phaseOrder.push(phaseId);
      phaseWinners.set(phaseId, createdNodeIds[0]);
    }

    console.log(JSON.stringify({
      event: 'canvas_push',
      phase: phaseId,
      pushed,
      errors,
      variantGroupId,
      ts: new Date().toISOString(),
    }));

    return { pushed, errors };
  };
}

/**
 * 创建 onCanvasProgress 回调（runPhase 期间推送阶段状态）
 *
 * 用法：
 *   const pushProgress = createOnCanvasProgress(canvasClient, { phaseId, ... });
 *   await pushProgress('running');   // phase 开始
 *   await pushProgress('success');   // phase 完成
 *   await pushProgress('error');     // phase 失败
 *
 * 创建一个占位节点（id = `phase-progress-{phaseId}`），随状态变化更新。
 * 真正的候选节点由 onCanvasPush 单独创建（不冲突）。
 *
 * @param {import('./canvas-client.js').CanvasClient} canvasClient
 * @param {object} options
 * @param {string} options.phaseId
 * @param {string} [options.branchId='main']
 * @param {string} [options.phaseName]
 * @param {number} [options.phaseIndex]
 * @param {string} [options.episode]
 * @returns {(state: 'running'|'success'|'error', progress?: number) => Promise<void>}
 */
export function createOnCanvasProgress(canvasClient, options = {}) {
  if (!canvasClient) throw new Error('createOnCanvasProgress: canvasClient 必填');
  if (!options.phaseId) throw new Error('createOnCanvasProgress: options.phaseId 必填');

  const {
    phaseId,
    branchId = 'main',
    phaseName,
    phaseIndex,
    episode,
  } = options;

  const nodeId = `phase-progress-${phaseId}`;
  let initialized = false;

  return async function onCanvasProgress(state, progress) {
    try {
      if (!initialized && state === 'running') {
        // 首次：创建占位节点
        const nodeMeta = PHASE_NODE_MAP[phaseId] || { nodeType: 'asset', assetSubtype: phaseId };
        const groupPos = canvasClient.suggestGroupPosition
          ? canvasClient.suggestGroupPosition(typeof phaseIndex === 'number' ? phaseIndex : 0)
          : { x: 0, y: 0 };

        try {
          await canvasClient.addNode({
            id: nodeId,
            type: nodeMeta.nodeType,
            branchId,
            phaseIndex: typeof phaseIndex === 'number' ? phaseIndex : 0,
            phaseName: phaseName || phaseId,
            phaseId,
            position: groupPos,
            data: {
              label: phaseName || phaseId,
              description: `阶段进度: ${phaseName || phaseId}`,
              episode: episode || null,
              assetType: nodeMeta.assetSubtype,
              isProgressPlaceholder: true,
            },
            state: 'running',
            reviewStatus: null,
          });
          canvasClient.registerNode(nodeId, {
            pipelineId: canvasClient._pipelineId || 'pipeline',
            phaseId,
          });
          initialized = true;
        } catch (err) {
          console.warn(`[canvas-push] progress addNode 失败 (降级): ${err.message}`);
          initialized = true; // 避免反复尝试 addNode
        }
      } else {
        // 后续：更新节点状态
        try {
          await canvasClient.updateNodeState(nodeId, state, progress);
        } catch (err) {
          console.warn(`[canvas-push] progress updateNodeState 失败 (降级): ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`[canvas-push] progress 推送失败 state=${state} (降级): ${err.message}`);
    }
  };
}

export default { createOnCanvasPush, createOnCanvasProgress, buildAssetUrl, PHASE_NODE_MAP };
