/**
 * Canvas Review Handler — 处理来自 Canvas WS 事件的审核决定
 *
 * 监听 CanvasClient 的 review:approved / review:rejected WS 事件，
 * 等价于 review-platform 的 HTTP 回调，走统一的 handleReviewDecision() 入口。
 */

/**
 * 注册 Canvas 审核事件监听器
 * @param {import('../../../lib/canvas-client.js').CanvasClient} canvasClient
 * @param {import('../pipeline/state-machine.js').PipelineManager} manager
 */
export function registerCanvasReviewListener(canvasClient, manager) {
  // review:approved → 推进管线
  canvasClient.on('review:approved', async (payload) => {
    const { nodeId, winnerId, selectedItems } = payload;
    console.log(JSON.stringify({
      event: 'canvas_review_approved',
      nodeId,
      winnerId,
      ts: new Date().toISOString(),
    }));

    const lookups = canvasClient.lookupNode(nodeId);
    if (!lookups.length) {
      console.warn(`[CanvasReview] nodeId=${nodeId} 无管线映射，跳过`);
      return;
    }

    for (const { pipelineId, phaseId } of lookups) {
      try {
        await manager.handleReviewDecision(pipelineId, phaseId, 'approved', {
          source: 'canvas',
          nodeId,
          selectedItems: selectedItems || (winnerId ? [winnerId] : []),
        });
      } catch (err) {
        console.error(`[CanvasReview] handleReviewDecision failed: ${err.message}`);
      }
    }
  });

  // review:rejected → 标记 failed + 记录 suggestion
  canvasClient.on('review:rejected', async (payload) => {
    const { nodeId, reason } = payload;
    console.log(JSON.stringify({
      event: 'canvas_review_rejected',
      nodeId,
      reason,
      ts: new Date().toISOString(),
    }));

    const lookups = canvasClient.lookupNode(nodeId);
    if (!lookups.length) {
      console.warn(`[CanvasReview] nodeId=${nodeId} 无管线映射，跳过`);
      return;
    }

    for (const { pipelineId, phaseId } of lookups) {
      try {
        await manager.handleReviewDecision(pipelineId, phaseId, 'rejected', {
          source: 'canvas',
          nodeId,
          reason: reason || '',
        });
      } catch (err) {
        console.error(`[CanvasReview] handleReviewDecision failed: ${err.message}`);
      }
    }
  });
}
