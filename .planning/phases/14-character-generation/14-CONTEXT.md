# Phase 14: character-generation 真实实现 - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure + business logic — discuss skipped)

<domain>

## Phase Boundary

将 Phase 10 添加的 `character-generation` stub handler 替换为真实实现:
- 调用 `CharacterAssetManager` 
- L1 身份锚点: 生成 20 张候选,按质量阈值保留 1-3 张(20 选 3)
- L2 造型卡片: 用 compositions API(sample_strength=0.3)基于 L1 锚点生成全身正面+侧面
- 资产含 `face_embedding_hash` / `costume_fingerprint`,供 Phase 12 一致性审计使用
- 写入 `character-candidates.json` + `assets/characters/<id>/L1_identity/*.png` + `L2_costumes/<costume>/...`

**核心问题**: Phase 10 stub 只写空 JSON,从未调用 `CharacterAssetManager` / 即梦 API。

</domain>

<decisions>

## Implementation Decisions

### L1 身份锚点生成 (20 选 3)

```javascript
// 1. 解析 requirement.json 的 characters[]
// 2. 对每个 character,生成 20 张面部特写候选
// 3. 调用 quality-gate 对每张打分(GLM-4V),保留 score >= 0.7 的前 3 张
// 4. 调用 CharacterAssetManager.registerIdentityAnchors(charId, top3)
// 5. 资产路径写入 character-candidates.json

for (const char of requirement.characters) {
  const candidates = [];
  for (let i = 0; i < 20; i++) {
    const prompt = buildL1Prompt(char);  // 面部特写,正面,中性表情,浅灰背景
    const img = await jimengClient.generateImage({ prompt, model: 'jimeng-5.0', ratio: '3:4' });
    candidates.push({ path: img.path, index: i });
  }
  // 质量评分
  const scored = await Promise.all(candidates.map(async c => {
    const score = await auditImageVsL1(c.path, [GOLDEN_STANDARD_REFERENCE]);
    return { ...c, score };
  }));
  // 保留 top-3 by score, threshold >= 0.7
  const top3 = scored.filter(s => s.score >= 0.7).sort((a, b) => b.score - a.score).slice(0, 3);
  if (!top3.length) throw new Error(`L1 generation failed for ${char.name}: 0/20 candidates passed threshold`);
  
  await assetManager.registerIdentityAnchors(char.id, top3.map(t => t.path));
}
```

### L2 造型卡片生成 (compositions API)

```javascript
// 对每个 character 的每套 costume,生成全身正面 + 侧面
// 使用 compositions API,L1 锚点作为参考图,sample_strength=0.3

for (const char of requirement.characters) {
  for (const costume of char.costumes || ['default']) {
    const l1Anchors = await assetManager.getIdentityAnchors(char.id);
    
    // 正面
    const frontPrompt = buildL2Prompt(char, costume, 'front');
    const frontImg = await jimengClient.compositions({
      images: l1Anchors,
      prompt: frontPrompt,
      sample_strength: 0.3,
    });
    
    // 侧面(基于正面图再 compositions)
    const sidePrompt = buildL2Prompt(char, costume, 'side');
    const sideImg = await jimengClient.compositions({
      images: [frontImg.path, ...l1Anchors],
      prompt: sidePrompt,
      sample_strength: 0.3,
    });
    
    await assetManager.registerCostumeSheet(char.id, costume, [frontImg.path, sideImg.path]);
  }
}
```

### Claude's Discretion

- **降级**: 即梦 API 失败 → 退化为 stub 模式(写空候选 + 警告),不阻塞 pipeline
- **并发**: 20 张 L1 候选可以并行生成(Promise.all),但注意 API rate limit
- **缓存**: 同 character 跨 episode 复用 L1(注册一次永不更换),L2 按 costume 缓存
- **指纹**: `face_embedding_hash` 可用简单的 image hash(perceptual hash),`costume_fingerprint` 同理
- **不做**: 不实现 gold-team FLUX 接入(留给 v3.0),只用即梦 compositions
- **测试**: 单元测试 mock 即梦 client,验证候选生成逻辑 + 阈值过滤 + assetManager 调用

</decisions>

<code_context>

## Existing Code Insights

### Reusable Assets
- `lib/character-asset-manager.js` — `CharacterAssetManager` 类(L1/L2/L3/L4 接口已就绪)
- `lib/jimeng-client.js` — `JimengClient` 类,compositions API 已实现
- `lib/continuity-auditor.js` — `auditImageVsL1` 函数(Phase 12 已实化)
- `lib/phases/index.js` 的 `character-generation` handler(Phase 10 stub,本 phase 替换)
- `lib/prompt-injector.js` — `_buildConsistencyLockText` 可复用

### Established Patterns
- Phase 10 stub handler 结构:hermes decide → 业务 → audit → collector → return
- JimengClient 调用见 `lib/phases/index.js:319-325` (soul-visual handler)
- CharacterAssetManager 用法见 `lib/phases/index.js:208-215`

### Integration Points
- `lib/phases/index.js` 的 `character-generation` handler(替换)
- 输出消费方:`lib/continuity-auditor.js:198-209`(读 `c.assets.L1_identity`)
- 输出消费方:`lib/prompt-injector.js`(读 character-assets for feature_lock)

</code_context>

<specifics>

## Specific Ideas

- **L1 prompt 模板**: `面部特写,正面,中性表情,浅灰色背景,柔和均匀光,高清无压缩,无墨镜遮挡` (符合 GOLDEN_STANDARD)
- **L2 prompt 模板**: `<costume_description>, 全身正面/侧面, 自然站姿, <scene_context if any>`
- **质量评分 prompt**: 复用 `auditImageVsL1` 的 prompt 模板,基准图用 GOLDEN_STANDARD 占位
- **资产结构**:
  ```
  assets/characters/
    <char_id>/
      L1_identity/
        manifest.json (CharacterAssetManager 自动写)
        001.png 002.png 003.png (top 3)
      L2_costumes/
        default/
          manifest.json
          front.png
          side.png
  ```
- **character-candidates.json**: 含每个 character 的 candidates 列表(20 张)+ 最终选定的 top3 路径 + scores

</specifics>

<deferred>

## Deferred Ideas

- gold-team FLUX 接入(性能/质量优化)→ v3.0
- L3 姿势包(留给 v3.0,本 phase 只做 L1+L2)
- L4 表情标定 → v3.0
- 跨剧集角色指纹库 → v3.0

</deferred>
