/**
 * BGMStrategy — V4.1 双轨 BGM 策略
 * 环境音轨: Stable Audio 分段 (4s×N, 智能拼接)
 * 标志性音轨: YuE 7B (主题曲/角色动机/高潮配乐)
 */
import { execSync } from 'node:child_process';
import { join } from 'node:path';

export class BGMStrategy {
  constructor({ assetBus, goldTeamClient }) {
    this.bus = assetBus;
    this.gt = goldTeamClient;
  }

  determineBGMType(bgmEvent) {
    if (!bgmEvent) return 'none';
    if (bgmEvent.is_signature || bgmEvent.type === 'signature') return 'signature';
    if (bgmEvent.type === 'leitmotif') return 'signature';
    if (bgmEvent.type === 'climax') return 'signature';
    return 'ambient';
  }

  async generateAmbientSkeleton(bgmPrompt, durationSec) {
    const segmentDuration = 4.0;
    const numSegments = Math.ceil(durationSec / segmentDuration);
    const segments = [];

    for (let i = 0; i < numSegments; i++) {
      let segmentPrompt = `${bgmPrompt}, segment ${i + 1}/${numSegments}`;
      if (i === 0) segmentPrompt += ', intro, establishing mood';
      else if (i === numSegments - 1) segmentPrompt += ', outro, fading atmosphere';
      else segmentPrompt += ', continuation, maintaining atmosphere';

      const seg = await this._generateAudioSegment(segmentPrompt, segmentDuration, 50);
      segments.push(seg);
    }

    return { segments, type: 'ambient', model: 'stable_audio', duration: durationSec };
  }

  async generateSignatureBGM(bgmPrompt, durationSec, structure = 'AABA') {
    if (!this.gt) {
      return { uri: null, type: 'signature', model: 'yue_7b', duration: durationSec, error: 'no gold-team' };
    }

    try {
      const task = await this.gt.submitTask({
        task_type: 'music_final',
        params: {
          prompt: bgmPrompt,
          duration: durationSec,
          structure,
          model: 'yue_7b',
          output_format: 'mp3',
        },
        priority: 8,
      });

      const result = await this.gt.waitForTask(task.task_id, { pollInterval: 10000, maxWait: 600000 });
      return {
        uri: result?.output_url || result?.audio_url || null,
        type: 'signature',
        model: 'yue_7b',
        duration: result?.duration || durationSec,
      };
    } catch (err) {
      return { uri: null, type: 'signature', model: 'yue_7b', duration: durationSec, error: err.message };
    }
  }

  async generateForEpisode(spatioTemporalScript, artBible) {
    const shots = spatioTemporalScript.shots || [];
    const bgmTracks = [];

    for (const shot of shots) {
      const bgmEvent = shot.bgm_event;
      if (!bgmEvent) continue;

      const bgmType = this.determineBGMType(bgmEvent);

      if (bgmType === 'signature') {
        const track = await this.generateSignatureBGM(
          bgmEvent.description,
          shot.duration_seconds || shot.duration_sec || 8,
          bgmEvent.musical_structure || 'AABA',
        );
        bgmTracks.push({ ...track, shot_id: shot.id || shot.shot_id });
      } else {
        const track = await this.generateAmbientSkeleton(
          bgmEvent.description,
          shot.duration_seconds || shot.duration_sec || 8,
        );
        bgmTracks.push({ ...track, shot_id: shot.id || shot.shot_id });
      }
    }

    await this.bus.write('bgm-skeleton', {
      ambient_segments: bgmTracks.filter(t => t.type === 'ambient'),
      signature_segments: bgmTracks.filter(t => t.type === 'signature'),
      bpm: artBible?.bgm_bpm || 88,
      key: artBible?.music_key || 'auto',
    });

    return bgmTracks;
  }

  crossfadeSegments(segmentUris, targetDuration, overlap = 0.5) {
    if (!segmentUris || segmentUris.length === 0) return null;
    if (segmentUris.length === 1) return segmentUris[0];

    // Return a command descriptor — actual FFmpeg execution in CompositionEngine
    return {
      type: 'crossfade_composition',
      inputs: segmentUris,
      overlap_seconds: overlap,
      target_duration: targetDuration,
    };
  }

  async _generateAudioSegment(prompt, duration, steps) {
    if (!this.gt) return { uri: null, duration };

    try {
      const task = await this.gt.submitTask({
        task_type: 'sfx_generation',
        params: { prompt, duration, steps, model: 'stable_audio', output_format: 'wav' },
        priority: 5,
      });

      const result = await this.gt.waitForTask(task.task_id, { pollInterval: 5000, maxWait: 300000 });
      return {
        uri: result?.output_url || result?.audio_url || null,
        duration: result?.duration || duration,
      };
    } catch {
      return { uri: null, duration };
    }
  }
}

export default BGMStrategy;
