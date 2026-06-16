/**
 * Review Callback Handler — 处理 review-platform 审核回调
 *
 * 验证 HMAC 签名，更新管线状态，自动恢复管线。
 */

import { createHmac } from 'node:crypto';
import { PHASES_V6 } from '../pipeline/phase-registry.js';

const REVIEW_HMAC_SECRET = process.env.REVIEW_CALLBACK_SECRET || '';

/**
 * 验证审核回调 HMAC 签名
 */
function verifyReviewHmac(body, signature) {
  if (!REVIEW_HMAC_SECRET) return true; // Dev mode
  // body may be object — stringify for HMAC
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const expected = createHmac('sha256', REVIEW_HMAC_SECRET).update(bodyStr).digest('hex');
  return `sha256=${expected}` === signature;
}

/**
 * 处理审核回调 — 委托给 PipelineManager.handleReviewDecision()
 * @param {import('../pipeline/state-machine.js').PipelineManager} manager
 * @param {object} body - 回调数据
 */
export async function handleReviewCallback(manager, body) {
  const { review_id, pipeline_id, phase, decision, items } = body;

  if (!pipeline_id) throw new Error('pipeline_id is required');
  if (!decision) throw new Error('decision is required');

  console.log(JSON.stringify({
    event: 'review_callback_received',
    review_id,
    pipeline_id,
    phase,
    decision,
    ts: new Date().toISOString(),
  }));

  const result = await manager.handleReviewDecision(pipeline_id, phase, decision, {
    source: 'review-platform',
    selectedItems: items || [],
  });

  const entry = manager._get(pipeline_id);

  return {
    pipeline_status: entry?.status,
    next_phase: result.nextPhase,
  };
}

/**
 * 验证签名
 */
export function verifySignature(body, signature) {
  return verifyReviewHmac(body, signature);
}
