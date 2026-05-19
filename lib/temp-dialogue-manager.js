/**
 * TempDialogueManager — V4.1 临时对白占位机制
 * PHASE 5: 快速推理占位对白 (CosyVoice2 默认音色)
 * PHASE 8: 精修对白 (角色克隆音色 + 情感标签)
 */
export class TempDialogueManager {
  constructor({ assetBus, goldTeamClient }) {
    this.bus = assetBus;
    this.gt = goldTeamClient;
  }

  async generateTempLines(dialogueLines) {
    const tempLines = [];

    for (const line of dialogueLines) {
      const temp = await this._quickTTS(line.text);
      tempLines.push({
        ...line,
        audio_uri: temp.audio_uri || null,
        duration: temp.duration || this._estimateDuration(line.text),
        viseme_skeleton: null,
        word_timing: null,
        status: 'TEMP',
        quality: 'PLACEHOLDER',
      });
    }

    await this.bus.write('temp-dialogue', {
      temp_lines: tempLines,
      voice_assignments: {},
      viseme_skeletons: [],
    });

    return tempLines;
  }

  async readTempDialogue() {
    const data = await this.bus.read('temp-dialogue');
    return data?.temp_lines || [];
  }

  async refineDialogue(tempDialogue, voiceSoul, emotion) {
    const refined = [];

    for (const temp of tempDialogue) {
      const speed = this.calculateEmotionSpeed(emotion || temp.emotion || 'neutral');
      const refinedLine = await this._refinedTTS(
        temp.text,
        voiceSoul?.voice_assignments,
        emotion || temp.emotion,
        speed,
        temp.duration,
      );

      refined.push({
        ...temp,
        audio_uri: refinedLine.audio_uri || temp.audio_uri,
        duration: refinedLine.duration || temp.duration,
        viseme: refinedLine.viseme || null,
        status: 'FINAL',
        quality: 'PRODUCTION',
        emotion: emotion || temp.emotion,
      });
    }

    await this.bus.write('temp-dialogue', {
      temp_lines: refined,
      voice_assignments: voiceSoul?.voice_assignments || {},
      viseme_skeletons: refined.map(r => r.viseme).filter(Boolean),
    });

    return refined;
  }

  calculateEmotionSpeed(emotion) {
    const mapping = {
      angry: 1.15,
      sad: 0.85,
      tender: 0.9,
      excited: 1.2,
      fearful: 1.1,
      neutral: 1.0,
    };
    return mapping[emotion] || 1.0;
  }

  async _quickTTS(text) {
    if (!this.gt) return { audio_uri: null, duration: this._estimateDuration(text) };

    try {
      const result = await this.gt.submitTTS({
        text,
        speed: 1.0,
        model: 'cosyvoice2',
        quality: 'fast',
      });
      return {
        audio_uri: result?.audio_url || result?.output_url || null,
        duration: result?.duration || this._estimateDuration(text),
      };
    } catch {
      return { audio_uri: null, duration: this._estimateDuration(text) };
    }
  }

  async _refinedTTS(text, voiceSpec, emotion, speed, targetDuration) {
    if (!this.gt) return { audio_uri: null, duration: targetDuration, viseme: null };

    try {
      const result = await this.gt.submitTTS({
        text,
        speed,
        emotion,
        speaker: voiceSpec?.voice_description,
        model: 'cosyvoice2',
        quality: 'high',
        target_duration: targetDuration,
      });
      return {
        audio_uri: result?.audio_url || result?.output_url || null,
        duration: result?.duration || targetDuration,
        viseme: result?.viseme || null,
      };
    } catch {
      return { audio_uri: null, duration: targetDuration, viseme: null };
    }
  }

  _estimateDuration(text) {
    // ~4 chars/sec for Chinese speech
    const charCount = (text || '').length;
    return Math.max(1.0, charCount / 4);
  }
}

export default TempDialogueManager;
