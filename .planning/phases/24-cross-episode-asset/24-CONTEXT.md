# Phase 24: CrossEpisodeAssetIndex (并行 track) - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Auto-generated (research-grade matching — discuss skipped, design from SUMMARY.md)

<domain>
## Phase Boundary

新增跨剧集角色资产复用能力。同主角系列剧第二集起,L1/L2 阶段命中 library 复用资产,避免重复生成。

**核心交付**:
1. `_computeCostumeFingerprint` 从 `SHA-256(paths)` 重写为 DINOv2 embedding(主)+ pHash(降级)
2. 新增 `lib/perceptual-hash.js`(DCT-II,~80 LOC,零 npm 依赖)
3. `CharacterAssetManager.findByIdentity(fingerprint, threshold)` 跨 episode 查询
4. 跨剧集资产库根路径约定 `projects/.shared/character-library/`
5. 50+50 pair 评估集 + human gate

**核心问题**: v2.0 `_computeCostumeFingerprint` 是 `SHA-256(paths.join(','))`,对路径变化敏感,无法跨 episode 匹配。

</domain>

<decisions>

## Implementation Decisions

### Perceptual Hash (pHash) 自实现

```javascript
// lib/perceptual-hash.js (DCT-II, ~80 LOC, zero npm deps)
import { createHash } from 'node:crypto';

/**
 * 计算 8x8 DCT-II pHash
 * 算法: resize → grayscale → DCT → top-left 8x8 → median threshold
 * @param {string} imagePath
 * @returns {Promise<string>} 64-bit hash as hex string
 */
export async function computePHash(imagePath) {
  // 1. 读取图片(via sharp if available, else 降级到 gold-team)
  // 2. Resize to 32x32
  // 3. Grayscale
  // 4. Compute DCT-II 8x8 from top-left
  // 5. Median threshold → 64-bit
  // 6. Return hex
}

/**
 * Hamming distance between two pHash hex strings
 */
export function hammingDistance(hashA, hashB) {
  if (hashA.length !== hashB.length) throw new Error('length mismatch');
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    const x = parseInt(hashA[i], 16) ^ parseInt(hashB[i], 16);
    dist += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return dist;
}

/**
 * 0-1 相似度,0=完全不同,1=完全相同
 */
export function pHashSimilarity(hashA, hashB) {
  const dist = hammingDistance(hashA, hashB);
  return 1 - dist / 64;
}
```

**注**: Node 无内置 image processing。两个方案:
- 方案 A(推荐): 用 gold-team API 做 resize+grayscale,pHash 算法本地
- 方案 B: 依赖 `sharp` npm(违反零依赖原则,拒绝)

### DINOv2 Embedding (主索引)

复用 `lib/continuity-auditor.js:309-441` 已实现的 DINOv2 调用:
```javascript
// lib/character-asset-manager.js
async _computeDinoFingerprint(imagePath) {
  const gtClient = this._makeGtClient();
  if (!gtClient) return null;  // degraded
  // POST to gold-team /api/v1/tasks { task_type: 'dinov2_embedding', image: imagePath }
  // 返回 768-dim float vector
  return await gtClient.embedDinoV2(imagePath);
}

async _computeCostumeFingerprint(characterId, costumeId) {
  const anchors = await this.getIdentityAnchors(characterId);
  if (!anchors.length) return null;
  
  // 优先 DINOv2
  const dinoVec = await this._computeDinoFingerprint(anchors[0]);
  if (dinoVec) {
    return { type: 'dinov2', vector: dinoVec, source_image: anchors[0] };
  }
  
  // 降级 pHash
  const phash = await computePHash(anchors[0]);
  return { type: 'phash', hash: phash, source_image: anchors[0] };
}
```

### CrossEpisodeAssetIndex

```javascript
// lib/character-asset-manager.js 新增方法
async findByIdentity(fingerprint, threshold = 0.92) {
  // 1. 加载 projects/.shared/character-library/index.json
  //    [{characterId, fingerprint: {type, vector|hash, source_image}, episode_origin, approved_at}]
  // 2. 对每条 entry 计算相似度
  //    - dinov2 vs dinov2: cosine similarity
  //    - phash vs phash: 1 - hamming/64
  //    - dinov2 vs phash: 不可比,跳过(降级到 metadata match)
  // 3. 返回所有 similarity >= threshold 的 entries
  // 4. 如有命中,记录到 audit log (first match 触发 human gate)
}

async registerToLibrary(characterId, fingerprint, episodeOrigin) {
  // human gate: 只有 approved=true 才写入
  // 加入 index.json + 写 audit log
}
```

### 跨剧集资产库结构

```
projects/.shared/character-library/
├── index.json                    # 索引(每条 character 一行)
├── characters/
│   ├── <character-id>/
│   │   ├── L1_identity/*.png    # 复用源
│   │   ├── L2_costumes/<costume>/{front,side}.png
│   │   └── manifest.json         # 指纹 + 元数据
├── audit-log.jsonl               # 操作日志
└── pending-approvals/            # 待 operator 审批的新匹配
    └── <request-id>.json
```

### 两阶段匹配(防误判)

```javascript
async findByIdentity(fingerprint, threshold = 0.92) {
  // Stage 1: hash 检索(快,DINOv2 cosine 或 pHash hamming)
  const candidates = await this._hashRetrieve(fingerprint, threshold);
  
  // Stage 2: DINOv2 二次确认(必须,即使 stage 1 是 pHash)
  const confirmed = [];
  for (const c of candidates) {
    if (c.fingerprint.type === 'dinov2' && fingerprint.type === 'dinov2') {
      const cosine = this._cosine(fingerprint.vector, c.fingerprint.vector);
      if (cosine >= 0.92) confirmed.push({ ...c, similarity: cosine });
    }
    // 单独 pHash 命中不写入 library(Pitfalls 陷阱 3 防御)
  }
  
  // 首次匹配 → 写 pending-approvals/,触发 human gate
  if (confirmed.length > 0 && !this._skipHumanGate) {
    await this._queueForApproval(confirmed[0]);
    return { status: 'pending_approval', match: confirmed[0] };
  }
  
  return { status: 'matched', matches: confirmed };
}
```

### Claude's Discretion

- **gold-team image resize**: 通过 `task_type: 'image_resize'` 提交,等结果(同 Phase 22 降级路径)
- **pHash 单元测试**: 用 mock 数据(已知 pHash 对),不依赖真实图片
- **DINOv2 mock**: 测试用 mock gold-team 返回固定向量
- **human gate**: 默认强制开启,`config.cross_episode.skip_human_gate: true` 紧急关闭

</decisions>

<code_context>

### Reusable Assets
- `lib/continuity-auditor.js:309-441` — DINOv2 embedding 已实现,直接调用
- `lib/character-asset-manager.js:228` getOmniReferencePack(Phase 22 已扩展 audio)
- `lib/asset-bus.js` envelope format(Phase 20 已就位)
- `lib/blacklist-engine.js` `_cosineSimilarity` helper(Phase 21 已实现)

### Integration Points
- character-generation handler 末尾调 `findByIdentity`(查 library 是否已有)
- character-selection handler 末尾调 `registerToLibrary`(新角色入库)

</code_context>

<specifics>

- **阈值**: DINOv2 cosine ≥ 0.92,pHash similarity ≥ 0.85(hamming ≤ 10)
- **库根路径**: `projects/.shared/character-library/`
- **50+50 pair 评估集**: 框架就位,operator 补真实标注
- **human gate**: pending-approvals/ 目录 + audit-log.jsonl

</specifics>

<deferred>

- DINOv2 batch embedding(gold-team batch API) → v3.1
- pHash 升级到 16x16(更高精度) → v3.1
- 跨 workdir library 共享 → v3.1

</deferred>
