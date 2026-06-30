#!/usr/bin/env node
/**
 * sync.js — 手动同步 P1800 剧本到无限画布
 *
 * 用法：node sync.js
 * 读取 output/20260619-urban-fantasy-comedy/step3-scripts-v3.json
 * 调用 syncScreenplayToCanvas 同步 EP1-EP8 到画布。
 */

import { readFileSync } from 'fs';
import { syncScreenplayToCanvas } from './lib/canvas-content-sync.js';

const PROJECT_ID = 1800;
const EPISODES_ID = 2;
const SCREENPLAY_PATH =
  './output/20260619-urban-fantasy-comedy/step3-scripts-v3.json';

async function main() {
  console.log('[sync] 读取剧本:', SCREENPLAY_PATH);
  const raw = readFileSync(SCREENPLAY_PATH, 'utf8');
  const screenplay = JSON.parse(raw);

  const variantKey = 'alpha';
  const variant = screenplay.scripts?.[variantKey];
  if (!variant) {
    throw new Error(`Variant "${variantKey}" not found in screenplay`);
  }
  console.log(
    `[sync] 变体 "${variantKey}": ${variant.variant_name}, ${variant.episodes?.length || 0} 集`,
  );

  console.log(
    `[sync] 调用 syncScreenplayToCanvas(projectId=${PROJECT_ID}, episodesId=${EPISODES_ID})`,
  );
  const result = await syncScreenplayToCanvas({
    projectId: PROJECT_ID,
    episodesId: EPISODES_ID,
    screenplay,
    variantKey,
    parentNodeId: 'n-script',
  });

  console.log('[sync] ✅ 同步完成:', JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('[sync] ❌ 失败:', err);
  process.exit(1);
});
