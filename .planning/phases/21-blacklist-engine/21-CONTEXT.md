# Phase 21: BlacklistEngine + bad case 持久化 - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

新增 `lib/blacklist-engine.js`,让 cloud-production 提交前自动过滤已知坏模式 shot,跨 run 累积。

**核心变化**:
1. `failed-shots` slot 累积写入(Phase 20 已就位基础设施)
2. 语义匹配:GLM-4.6v embedding 相似度 ≥0.92 命中(非 regex 子串)
3. cloud-production before-hook:命中走 `skip`(≠ retry、≠ fail)
4. Escape hatch / TTL 30d / 操作日志

</domain>

<decisions>

## Implementation Decisions

### BlacklistEngine API

```javascript
// lib/blacklist-engine.js
export class BlacklistEngine {
  constructor({ assetBus, visionModel = 'glm-4.6v', threshold = 0.92 }) { ... }
  
  /**
   * 记录一个 failed shot(供下次 run 黑名单匹配)
   */
  async record({ shot_id, error, prompt, imagePath, audioPath?, run_id }) {
    // 1. 计算 prompt 的 embedding (via GLM-4.6v)
    // 2. 写入 AssetBus failed-shots slot (envelope + content_hash + timestamp)
    // 3. 写入 audit log
  }
  
  /**
   * 检查给定 shot 是否命中黑名单
   * @returns {'hit'|'miss'|'disabled'|'degraded'}
   */
  async check({ prompt, imagePath }) {
    if (this.disabled) return 'disabled';
    // 1. 加载 failed-shots + 过滤 TTL 过期
    // 2. 计算 query embedding
    // 3. cosine similarity 与每条 failure 比
    // 4. 任意 ≥ threshold → 'hit'
    // 5. GLM 不可达 → 'degraded' (默认 allow)
  }
  
  /** TTL 清理 */
  async pruneExpired() { ... }
  
  /** 操作日志(谁/何时/为何) */
  async _writeAuditLog(action, details) { ... }
}

// ShotParallelScheduler 集成
async runWithRetry(shots, taskFn, opts = {}) {
  const blacklist = opts.blacklist;
  const results = [];
  for (const shot of shots) {
    if (blacklist) {
      const status = await blacklist.check({ prompt: shot.description, imagePath: shot.referenceImage });
      if (status === 'hit') {
        results.push({ shot_id: shot.id, status: 'blacklisted', reason: 'blacklist hit' });
        continue;
      }
    }
    // ... normal retry flow ...
  }
}
```

### Embedding 缓存

避免每次 check 都跑 GLM-4.6v embedding:
- AssetBus 增加 `embeddings-cache` slot(可选,Phase 20 schema 已就位)
- key: SHA-256(prompt + imagePath)
- value: { vector: number[], model, timestamp }
- TTL 7 天(embedding 模型升级后失效)

### GLM-4.6v Embedding API

智谱 GLM-4.6v 支持 embedding(通过 `embedding-3` 模型):
```javascript
// lib/hermes-adapter.js 新增
export async function callEmbedding(text, { model = 'embedding-3' }) {
  // POST /api/paas/v4/embeddings
  // 返回: { data: [{ embedding: number[1024] }] }
}
```

### Claude's Discretion

- **降级优先**:GLM 不可达 → `'degraded'` 状态,pipeline 继续(默认 allow)
- **TTL 默认 30d**:可通过 `config.blacklist.ttl_days` 配置
- **首次加载**:启动时全量加载到内存,后续增量更新
- **测试**:语义匹配 / TTL 过期 / escape hatch / 降级 / skip ≠ retry

</decisions>

<code_context>

### Reusable Assets
- `lib/asset-bus.js` (Phase 20 已加 failed-shots slot)
- `lib/hermes-adapter.js` (callLLM 已支持 multimodal)
- `lib/shot-parallel-scheduler.js` (Phase 15 已有 runWithRetry)

### Integration Points
- ShotParallelScheduler.runWithRetry 接入 blacklist before-hook
- cloud-production handler 传入 blacklist 实例
- AssetBus failed-shots slot 累积读写

</code_context>

<specifics>

- **匹配阈值**: 0.92 (基于 promptfoo + v3.0 research SUMMARY.md)
- **TTL**: 30 天默认
- **escape hatch**: `config.blacklist.disabled: true` 或 `BLACKLIST_DISABLED=1` env
- **操作日志**: `.pipeline-assets/blacklist-audit.jsonl`(append-only)

</specifics>

<deferred>

- 自动学习阈值(based on false positive rate) → v3.1
- 跨 episode blacklist 共享 → v3.1
- 多模态 embedding(image + audio) → v3.1

</deferred>
