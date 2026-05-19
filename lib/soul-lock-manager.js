/**
 * SoulLockManager — V4.1 两步灵魂定稿
 * Step 1: 即梦 API → 视觉灵魂帧 (3选1)
 * Step 2: GLM → 声音样本 (匹配视觉气质)
 */
import { callLLM } from './hermes-adapter.js';

export class SoulLockManager {
  constructor({ jimengClient, assetBus }) {
    this.jimeng = jimengClient;
    this.bus = assetBus;
  }

  async generateVisualSoul(characterDesc, artBible) {
    const prompt = `${artBible.style_anchor || ''}, ${characterDesc}, character portrait, front view, soul frame`;
    const candidates = [];

    for (let i = 0; i < 3; i++) {
      try {
        const result = await this.jimeng.generateImage(prompt, { aspect_ratio: '1:1', n: 1 });
        if (result?.data?.[0]?.url) {
          candidates.push({ url: result.data[0].url, index: i });
        }
      } catch {
        // degrade silently, try next
      }
    }

    if (candidates.length === 0) {
      return { status: 'FAILED', error: 'No visual soul candidates generated' };
    }

    return {
      status: 'CANDIDATES_READY',
      candidates,
      prompt,
    };
  }

  async generateVoiceSoul(visualSoul, characterDesc) {
    const visualTags = visualSoul.visual_tags || [];
    const voiceMood = this.inferVoiceMood(visualTags, characterDesc);

    const prompt = `Based on this character description: "${characterDesc}"
Visual appearance tags: ${visualTags.join(', ')}
Inferred voice mood: ${voiceMood}

Generate a voice description for this character. Return JSON:
{"voice_description": "...", "pitch": "low/mid/high", "timbre": "...", "speed": "slow/normal/fast", "emotional_tone": "..."}`;

    const result = await callLLM(prompt, {
      system: 'You are a voice casting director for animated short films. Describe voice characteristics that match the visual appearance of the character.',
      responseFormat: 'json',
    });

    let voiceSpec;
    try {
      voiceSpec = typeof result === 'string' ? JSON.parse(result) : result;
    } catch {
      voiceSpec = { voice_description: result, pitch: 'mid', timbre: 'warm', speed: 'normal', emotional_tone: 'neutral' };
    }

    // Generate 3 voice sample candidates via TTS
    const candidates = [];
    const emotions = ['neutral', 'emotional', 'dramatic'];
    for (const emotion of emotions) {
      candidates.push({
        text: this._sampleDialogue(characterDesc),
        voice_spec: { ...voiceSpec, emotion },
        mood: voiceMood,
      });
    }

    return {
      status: 'VOICE_CANDIDATES_READY',
      voice_mood: voiceMood,
      voice_spec: voiceSpec,
      candidates,
    };
  }

  inferVoiceMood(visualTags, characterDesc) {
    const tags = visualTags.join(' ').toLowerCase();
    const desc = (characterDesc || '').toLowerCase();

    if (tags.includes('young') || desc.includes('少女') || desc.includes('少年')) return 'youthful_clear';
    if (tags.includes('elderly') || desc.includes('老人') || desc.includes('老')) return 'hoarse_mature';
    if (tags.includes('military') || tags.includes('uniform') || desc.includes('军')) return 'firm_authoritative';
    if (desc.includes('温柔') || desc.includes('温')) return 'soft_gentle';
    if (desc.includes('冷酷') || desc.includes('冷')) return 'cold_sharp';
    return 'neutral_warm';
  }

  _sampleDialogue(characterDesc) {
    return '这段台词用于测试音色，请仔细听我的语气和情感表达。';
  }

  async lockVisualSoul(selectedIndex, candidates) {
    const selected = candidates[selectedIndex];
    if (!selected) throw new Error(`Invalid selection index: ${selectedIndex}`);

    const visualSoul = {
      soul_frame_url: selected.url,
      selected_index: selectedIndex,
      visual_tags: [],
      status: 'VISUAL_LOCKED',
    };

    await this.bus.write('visual-soul', visualSoul);
    return visualSoul;
  }

  async lockVoiceSoul(selectedCandidate, visualSoul) {
    const voiceSoul = {
      voice_assignments: selectedCandidate.voice_spec,
      matched_visual_index: visualSoul.selected_index,
      voice_mood: selectedCandidate.mood,
      status: 'FULLY_LOCKED',
    };

    await this.bus.write('voice-soul', voiceSoul);
    return voiceSoul;
  }
}

export default SoulLockManager;
