/**
 * story-synopsis-builder.js — 多剧集故事梗概生成器
 *
 * 核心能力：根据剧集数 × 单集时长，动态生成能支撑总时长的故事梗概。
 *
 * 设计原则：
 *   - 总时长 = episode_count × duration_sec_per_episode
 *   - 每分钟至少 2 个故事节拍点（story beats）
 *   - 多集时给出每集故事线 + 集间关联
 *   - 故事量必须匹配时长，不能"大纲很大但每集只有30秒内容"
 *
 * 使用方式：
 *   buildTopicPrompt(requirement) → 传给 hermes_llm 生成主题候选
 *   buildOutlinePrompt(requirement, selectedTopic) → 传给 hermes_llm 生成大纲候选
 */

/**
 * 计算故事所需的最低节拍点数。
 *
 * @param {number} episodeCount — 剧集数
 * @param {number} durationSecPerEpisode — 每集时长（秒）
 * @param {number} [minBeatsPerMinute=2] — 每分钟最低节拍点
 * @returns {{ totalDurationSec, totalMinutes, minStoryBeats, beatsPerEpisode, episodeCount }}
 */
export function calculateStoryCapacity(episodeCount, durationSecPerEpisode, minBeatsPerMinute = 2) {
  const totalDurationSec = episodeCount * durationSecPerEpisode;
  const totalMinutes = totalDurationSec / 60;
  const minStoryBeats = Math.ceil(totalMinutes * minBeatsPerMinute);
  const beatsPerEpisode = Math.ceil((durationSecPerEpisode / 60) * minBeatsPerMinute);

  return {
    totalDurationSec,
    totalMinutes: Math.round(totalMinutes * 10) / 10,
    minStoryBeats,
    beatsPerEpisode,
    episodeCount,
    durationSecPerEpisode,
  };
}

/**
 * 生成主题选择阶段的 prompt（用于 hermes_llm）。
 *
 * 要求每个主题候选的故事梗概能支撑总时长。
 *
 * @param {object} requirement
 * @param {string} requirement.title — 标题
 * @param {string} requirement.genre — 类型
 * @param {string} requirement.theme — 主题方向
 * @param {number} requirement.episode_count — 剧集数
 * @param {number} requirement.duration_sec_per_episode — 每集时长
 * @param {object} [options]
 * @param {number} [options.candidateCount=3] — 候选数量
 * @returns {string} prompt
 */
export function buildTopicPrompt(requirement, options = {}) {
  const { candidateCount = 3 } = options;
  const cap = calculateStoryCapacity(
    requirement.episode_count || 1,
    requirement.duration_sec_per_episode || 60,
  );

  const isMultiEpisode = cap.episodeCount > 1;

  const episodeGuidance = isMultiEpisode
    ? `这是一个 ${cap.episodeCount} 集系列短片，每集约 ${cap.durationSecPerEpisode} 秒，总计 ${cap.totalMinutes} 分钟。
故事梗概必须能支撑 ${cap.totalMinutes} 分钟的内容量：
- 整体故事线需要足够的情节深度和角色发展空间
- 每集需要有独立的叙事单元（起承转合），同时服务于全局主线
- 集与集之间需要有剧情连贯性（悬念、伏笔、角色成长弧线）
- 每集至少 ${cap.beatsPerEpisode} 个故事节拍点（动作/转折/对话/高潮等）`
    : `这是一个单集短片，时长 ${cap.durationSecPerEpisode} 秒。
故事梗概必须能支撑 ${cap.totalMinutes} 分钟的内容量：
- 需要完整的叙事结构（起承转合）
- 至少 ${cap.beatsPerEpisode} 个故事节拍点`;

  return `你是一位专业短片编剧和故事架构师。

## 项目需求
- 标题：${requirement.title || '待定'}
- 类型：${requirement.genre || '待定'}
- 主题方向：${requirement.theme || '待定'}
- 角色：${(requirement.characters || []).map(c => `${c.name}（${c.role || c.description || '未定义'}）`).join('、') || '待定'}

## 故事容量要求
${episodeGuidance}
- 最低故事节拍点总数：${cap.minStoryBeats}

## 输出要求
请生成 ${candidateCount} 个不同的主题故事候选，每个候选必须包含：

### 单集模式输出格式：
1. **主题名**：简洁有力的主题名
2. **一句话梗概**：用一句话概括核心冲突和情感
3. **故事梗概**：${cap.totalMinutes > 2 ? '详细的' : '精炼的'}故事梗概（${Math.max(100, cap.minStoryBeats * 20)}-${Math.max(200, cap.minStoryBeats * 40)} 字），必须包含完整的起承转合
4. **节拍点分解**：列出所有故事节拍点（至少 ${cap.beatsPerEpisode} 个），标注每个节拍的预估秒数
5. **视觉关键词**：3-5 个核心视觉意象
6. **情感曲线**：开场→发展→高潮→结局的情感走向

### 多集模式额外要求：
7. **全局故事线**：跨集的主线剧情（主角的成长弧线、核心冲突的演变）
8. **每集梗概**：为 EP01 到 EP${cap.episodeCount} 分别给出独立梗概（每集 ${cap.durationSecPerEpisode} 秒）
9. **集间关联**：标注集与集之间的剧情钩子（悬念延续、角色关系演变、伏笔回收）
10. **分集节拍点**：每集至少 ${cap.beatsPerEpisode} 个节拍点 + 预估秒数分配

### 质量标准
- 故事容量必须匹配 ${cap.totalMinutes} 分钟的时长
- 节拍点总预估秒数应接近 ${cap.totalDurationSec} 秒（允许 ±20% 误差）
- 不要生成"头重脚轻"的故事（前30秒塞满，后30秒空白）
- 多集时每集的叙事节奏应当有起伏（不是每集都是同一节奏）

请以 JSON 数组格式输出 ${candidateCount} 个候选。`;
}

/**
 * 生成大纲阶段的 prompt（用于 hermes_llm）。
 *
 * 基于选定的主题，展开为完整大纲。
 *
 * @param {object} requirement
 * @param {object} selectedTopic — 用户选定的主题（from topic-selection 阶段输出）
 * @param {object} [options]
 * @param {number} [options.candidateCount=3] — 大纲候选数量
 * @returns {string} prompt
 */
export function buildOutlinePrompt(requirement, selectedTopic, options = {}) {
  const { candidateCount = 3 } = options;
  const cap = calculateStoryCapacity(
    requirement.episode_count || 1,
    requirement.duration_sec_per_episode || 60,
  );

  const isMultiEpisode = cap.episodeCount > 1;

  const topicSummary = JSON.stringify(selectedTopic, null, 0);

  const outlineGuidance = isMultiEpisode
    ? `## 多集大纲要求
为 ${cap.episodeCount} 集系列短片展开完整大纲：
- 每集独立大纲：场景、角色、对话要点、情感节奏
- 集间关联标注：哪些情节跨集、哪些是集内独立
- 每集时间分配：开场(Xs)→发展(Xs)→高潮(Xs)→结尾(Xs)
- 角色弧线追踪：每个主要角色在每集中的状态变化`
    : `## 单集大纲要求
为 ${cap.durationSecPerEpisode} 秒短片展开完整大纲：
- 场景分解：每个场景的时长、地点、角色
- 情感节奏标注
- 关键对话要点`;

  return `你是一位专业短片编剧。

## 已选定主题
${topicSummary}

## 项目参数
- 总时长：${cap.totalMinutes} 分钟（${cap.episodeCount} 集 × ${cap.durationSecPerEpisode} 秒/集）
- 类型：${requirement.genre || '未指定'}
- 角色：${(requirement.characters || []).map(c => c.name).join('、') || '未指定'}

${outlineGuidance}

## 输出格式
请生成 ${candidateCount} 个大纲候选，每个候选为 JSON 对象：

${isMultiEpisode ? `{
  "title": "大纲标题",
  "global_arc": { "setup": "...", "escalation": "...", "climax": "...", "resolution": "..." },
  "episodes": [
    {
      "episode_id": "EP01",
      "duration_sec": ${cap.durationSecPerEpisode},
      "synopsis": "本集梗概",
      "time_allocation": { "opening": 10, "development": 20, "climax": 15, "ending": 15 },
      "scenes": [
        { "scene_id": "S01", "location": "...", "characters": [...], "action": "...", "emotion": "...", "duration_sec": 10 }
      ],
      "beats": [
        { "time_sec": 5, "beat": "...", "type": "action|dialogue|revelation|climax" }
      ],
      "cross_episode_hooks": { "sets_up": "EP02中...", "resolves_from": null }
    }
  ]
}` : `{
  "title": "大纲标题",
  "duration_sec": ${cap.durationSecPerEpisode},
  "synopsis": "梗概",
  "time_allocation": { "opening": 10, "development": 20, "climax": 15, "ending": 15 },
  "scenes": [
    { "scene_id": "S01", "location": "...", "characters": [...], "action": "...", "emotion": "...", "duration_sec": 10 }
  ],
  "beats": [
    { "time_sec": 5, "beat": "...", "type": "action|dialogue|revelation|climax" }
  ]
}`}

质量标准：
- 所有场景的 duration_sec 总和应接近 ${cap.totalDurationSec} 秒（±10%）
- 每个场景的时长必须合理（最短 3 秒，最长不超过总时长的 30%）
- 节拍点数量不少于 ${cap.minStoryBeats}
${isMultiEpisode ? '- 每集必须有独立的叙事完整性，不是纯"承上启下"的过渡集' : ''}
`;
}

/**
 * 验证故事梗概/大纲的容量是否足够支撑目标时长。
 *
 * @param {object} outline — 大纲对象
 * @param {number} targetDurationSec — 目标总时长
 * @param {number} [tolerance=0.2] — 允许误差（20%）
 * @returns {{ sufficient: boolean, actualSec: number, gapSec: number, details: string }}
 */
export function validateStoryCapacity(outline, targetDurationSec, tolerance = 0.2) {
  let actualSec = 0;

  if (outline.episodes) {
    // 多集模式
    for (const ep of outline.episodes) {
      if (ep.scenes) {
        actualSec += ep.scenes.reduce((sum, s) => sum + (s.duration_sec || 0), 0);
      } else if (ep.duration_sec) {
        actualSec += ep.duration_sec;
      }
    }
  } else if (outline.scenes) {
    // 单集模式
    actualSec += outline.scenes.reduce((sum, s) => sum + (s.duration_sec || 0), 0);
  } else if (outline.beats) {
    // 仅节拍点（估算每个节拍 5 秒）
    actualSec = outline.beats.length * 5;
  }

  const minAllowed = targetDurationSec * (1 - tolerance);
  const maxAllowed = targetDurationSec * (1 + tolerance);
  const sufficient = actualSec >= minAllowed && actualSec <= maxAllowed;
  const gapSec = actualSec - targetDurationSec;

  return {
    sufficient,
    actualSec: Math.round(actualSec),
    targetDurationSec,
    minAllowed: Math.round(minAllowed),
    maxAllowed: Math.round(maxAllowed),
    gapSec: Math.round(gapSec),
    gapPercent: Math.round((gapSec / targetDurationSec) * 100),
    details: sufficient
      ? `✅ 故事容量 ${actualSec}s 匹配目标 ${targetDurationSec}s（误差 ${Math.abs(Math.round((gapSec / targetDurationSec) * 100))}%）`
      : actualSec < minAllowed
        ? `❌ 故事容量不足：${actualSec}s < ${Math.round(minAllowed)}s（缺少 ${Math.round(minAllowed - actualSec)}s 内容）`
        : `⚠️ 故事容量溢出：${actualSec}s > ${Math.round(maxAllowed)}s（超出 ${Math.round(actualSec - maxAllowed)}s）`,
  };
}

export default {
  calculateStoryCapacity,
  buildTopicPrompt,
  buildOutlinePrompt,
  validateStoryCapacity,
};
