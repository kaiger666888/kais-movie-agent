/**
 * kais-voice — 语音合成引擎（TTS Adapter）
 * ES Module
 *
 * 默认使用 GLM-TTS，保留接口可切换其他 TTS 引擎。
 * 核心能力：
 * - 多音色选择（根据角色特征自动匹配 + 人工审核）
 * - 情感语调（根据剧情场景调整）
 * - 批量生成（按剧本分镜逐段合成）
 * - 音频预切割（对接延长链 extension-chain）
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// ─── 音色库 ──────────────────────────────────────────

const VOICE_LIBRARY = {
  // GLM-TTS 内置音色
  'tongtong': {
    name: '彤彤',
    provider: 'glm-tts',
    gender: 'female',
    age_range: 'young',
    tone: '温柔、亲和',
    best_for: ['旁白', '温柔女声', '日常对话', '故事讲述'],
    emotion_range: ['neutral', 'happy', 'sad', 'warm'],
    default_speed: 1.0,
  },
  'xiaochen': {
    name: '小陈',
    provider: 'glm-tts',
    gender: 'male',
    age_range: 'young',
    tone: '阳光、活泼',
    best_for: ['年轻男性', '热血主角', '日常对话', '轻喜剧'],
    emotion_range: ['neutral', 'happy', 'excited', 'curious'],
    default_speed: 1.0,
  },
  'chuichui': {
    name: '锤锤',
    provider: 'glm-tts',
    gender: 'male',
    age_range: 'middle',
    tone: '沉稳、可靠',
    best_for: ['成熟男性', '领导/长辈', '严肃场景', '内心独白'],
    emotion_range: ['neutral', 'serious', 'calm', 'thoughtful'],
    default_speed: 0.95,
  },
  'jam': {
    name: 'Jam',
    provider: 'glm-tts',
    gender: 'male',
    age_range: 'young',
    tone: '潮流、活力',
    best_for: ['说唱/旁白', '年轻潮流', '广告配音'],
    emotion_range: ['neutral', 'excited', 'energetic'],
    default_speed: 1.05,
  },
  'kazi': {
    name: 'Kazi',
    provider: 'glm-tts',
    gender: 'female',
    age_range: 'young',
    tone: '知性、优雅',
    best_for: ['专业女声', '新闻/解说', '商务场景', '纪录片'],
    emotion_range: ['neutral', 'calm', 'professional'],
    default_speed: 0.95,
  },
  'douji': {
    name: 'Douji',
    provider: 'glm-tts',
    gender: 'male',
    age_range: 'young',
    tone: '少年、清亮',
    best_for: ['少年角色', '学生', '纯真场景'],
    emotion_range: ['neutral', 'happy', 'innocent', 'curious'],
    default_speed: 1.0,
  },
  'luodo': {
    name: 'Luodo',
    provider: 'glm-tts',
    gender: 'male',
    age_range: 'middle',
    tone: '低沉、磁性',
    best_for: ['反派', '深沉男声', '悬疑旁白', '电影预告'],
    emotion_range: ['neutral', 'dark', 'mysterious', 'intense'],
    default_speed: 0.9,
  },
};

// ─── TTS Provider 接口 ───────────────────────────────

/**
 * TTS Provider 抽象接口
 * 所有 TTS 引擎必须实现此接口
 */
class TTSProvider {
  /**
   * @param {string} text - 要合成的文本
   * @param {object} options
   * @param {string} options.voice - 音色 ID
   * @param {number} options.speed - 语速 (0.5-2.0)
   * @param {number} options.volume - 音量 (0.0-1.0)
   * @param {string} options.emotion - 情感 (neutral/happy/sad/angry/...)
   * @param {string} options.outputFormat - 输出格式 (mp3/pcm/wav)
   * @returns {Promise<Buffer>} 音频数据
   */
  async synthesize(text, options = {}) {
    throw new Error('子类必须实现 synthesize()');
  }

  /**
   * 获取可用音色列表
   * @returns {Promise<Array<{id: string, name: string, gender: string}>>}
   */
  async listVoices() {
    throw new Error('子类必须实现 listVoices()');
  }

  /**
   * 为指定文本和角色推荐音色
   * @param {object} character - 角色信息 { name, gender, age, personality }
   * @param {string} scene - 场景描述
   * @returns {Promise<Array<{voice_id: string, score: number, reason: string}>>}
   */
  async recommendVoices(character, scene) {
    throw new Error('子类必须实现 recommendVoices()');
  }
}

// ─── GLM-TTS Provider ────────────────────────────────

class GLMTTSProvider extends TTSProvider {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = 'https://open.bigmodel.cn/api/paas/v4/audio/speech';
  }

  async synthesize(text, options = {}) {
    const {
      voice = 'tongtong',
      speed = 1.0,
      volume = 1.0,
      outputFormat = 'mp3',
      stream = false,
    } = options;

    const body = {
      model: 'glm-tts',
      input: text,
      voice,
      response_format: outputFormat,
      encode_format: 'base64',
      stream,
      speed,
      volume,
    };

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`GLM-TTS API 错误 ${res.status}: ${err}`);
    }

    const json = await res.json();

    if (json.error) {
      throw new Error(`GLM-TTS: ${json.error.message}`);
    }

    // 非流式返回 base64 音频
    if (json.data?.audio) {
      return Buffer.from(json.data.audio, 'base64');
    }

    throw new Error('GLM-TTS: 返回数据格式异常');
  }

  async listVoices() {
    return Object.entries(VOICE_LIBRARY).map(([id, v]) => ({
      id,
      name: v.name,
      gender: v.gender,
      age_range: v.age_range,
      tone: v.tone,
      best_for: v.best_for,
    }));
  }

  async recommendVoices(character = {}, scene = '') {
    const { gender, age, personality } = character;
    const results = [];

    for (const [id, voice] of Object.entries(VOICE_LIBRARY)) {
      let score = 0;
      const reasons = [];

      // 性别匹配
      if (gender && voice.gender === gender) {
        score += 40;
        reasons.push(`性别匹配(${voice.gender})`);
      }

      // 年龄匹配
      if (age) {
        const ageNum = parseInt(age) || 0;
        if (ageNum < 25 && voice.age_range === 'young') { score += 20; reasons.push('年龄段匹配'); }
        if (ageNum >= 25 && ageNum < 45 && voice.age_range === 'middle') { score += 20; reasons.push('年龄段匹配'); }
      }

      // 性格匹配
      if (personality) {
        const personalityLower = personality.toLowerCase();
        if (voice.tone.split('、').some(t => personalityLower.includes(t))) {
          score += 25;
          reasons.push(`性格匹配(${voice.tone})`);
        }
        if (voice.best_for.some(b => personalityLower.includes(b) || scene.includes(b))) {
          score += 15;
          reasons.push('场景适配');
        }
      }

      // 情感范围匹配
      if (scene) {
        const sceneLower = scene.toLowerCase();
        const emotionMap = {
          '开心': 'happy', '悲伤': 'sad', '愤怒': 'angry',
          '紧张': 'intense', '温暖': 'warm', '平静': 'calm',
        };
        for (const [keyword, emotion] of Object.entries(emotionMap)) {
          if (sceneLower.includes(keyword) && voice.emotion_range.includes(emotion)) {
            score += 10;
            reasons.push(`情感适配(${emotion})`);
          }
        }
      }

      results.push({
        voice_id: id,
        voice_name: voice.name,
        score,
        reason: reasons.join(', '),
      });
    }

    return results.sort((a, b) => b.score - a.score);
  }
}

// ─── 音色审核（生成多个选项供用户选择）────────────────

/**
 * 为指定文本生成多个音色样本，供用户审核选择
 * @param {string} text - 示例文本（建议用角色的一句对白）
 * @param {object} character - 角色信息
 * @param {string} scene - 场景描述
 * @param {object} options
 * @param {TTSProvider} options.provider - TTS 引擎
 * @param {number} options.topN - 返回前 N 个推荐（默认 3）
 * @param {string} options.outputDir - 样本输出目录
 * @returns {Promise<object>} 审核结果
 */
export async function generateVoiceAudition(text, character, scene, options = {}) {
  const {
    provider,
    topN = 3,
    outputDir = '/tmp/voice-audition',
  } = options;

  if (!provider) throw new Error('需要提供 TTS provider');

  // 推荐音色
  const recommendations = await provider.recommendVoices(character, scene);
  const topVoices = recommendations.slice(0, topN);

  // 生成样本
  await mkdir(outputDir, { recursive: true });
  const samples = [];

  for (const rec of topVoices) {
    try {
      const audioBuffer = await provider.synthesize(text, {
        voice: rec.voice_id,
      });

      const outputPath = join(outputDir, `${rec.voice_id}_sample.mp3`);
      await writeFile(outputPath, audioBuffer);

      samples.push({
        voice_id: rec.voice_id,
        voice_name: rec.voice_name,
        score: rec.score,
        reason: rec.reason,
        sample_path: outputPath,
      });
    } catch (e) {
      console.warn(`[kais-voice] 音色 ${rec.voice_id} 样本生成失败: ${e.message}`);
    }
  }

  return {
    character: character.name || 'unknown',
    sample_text: text,
    scene,
    recommendations: topVoices,
    samples,
    // 用户选择后调用 confirmVoice() 锁定
    select_prompt: '请试听以上样本，回复音色 ID 确认选择（如 tongtong）',
  };
}

// ─── 批量合成（按剧本分镜）────────────────────────────

/**
 * 按剧本批量合成语音
 * @param {Array<object>} dialogueLines - 对白列表
 *   每个: { line_id, character, text, emotion, scene }
 * @param {object} voiceAssignments - 角色→音色映射 { characterName: voiceId }
 * @param {TTSProvider} provider
 * @param {string} outputDir
 * @param {Function} onProgress - (current, total, line_id)
 * @returns {Promise<object>} 合成结果
 */
export async function batchSynthesize(dialogueLines, voiceAssignments, provider, outputDir, onProgress) {
  await mkdir(outputDir, { recursive: true });

  const results = [];
  let current = 0;

  for (const line of dialogueLines) {
    const voiceId = voiceAssignments[line.character];
    if (!voiceId) {
      results.push({ line_id: line.line_id, status: 'skipped', reason: `角色 ${line.character} 未分配音色` });
      current++;
      onProgress?.(current, dialogueLines.length, line.line_id);
      continue;
    }

    try {
      const audioBuffer = await provider.synthesize(line.text, {
        voice: voiceId,
        speed: VOICE_LIBRARY[voiceId]?.default_speed || 1.0,
        emotion: line.emotion,
      });

      const outputPath = join(outputDir, `${String(line.line_id).padStart(4, '0')}_${line.character}.mp3`);
      await writeFile(outputPath, audioBuffer);

      results.push({
        line_id: line.line_id,
        character: line.character,
        voice_id: voiceId,
        status: 'done',
        audio_path: outputPath,
        duration_estimate: estimateDuration(line.text),
      });
    } catch (e) {
      results.push({ line_id: line.line_id, status: 'failed', error: e.message });
    }

    current++;
    onProgress?.(current, dialogueLines.length, line.line_id);
  }

  return {
    total: dialogueLines.length,
    done: results.filter(r => r.status === 'done').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    lines: results,
  };
}

// ─── 辅助 ────────────────────────────────────────────

function estimateDuration(text) {
  // 中文约 4 字/秒，考虑停顿
  const charCount = text.replace(/[，。！？、；：""''（）\s]/g, '').length;
  return Math.ceil(charCount / 4);
}

// ─── 导出 ────────────────────────────────────────────

export { GLMTTSProvider, TTSProvider, VOICE_LIBRARY };
