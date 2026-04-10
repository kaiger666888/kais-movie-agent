/**
 * kais-extension-chain — 基于全能参考的延长链引擎
 * ES Module
 *
 * 即梦 Seedance 全能参考模式，每个镜头的多参考输入：
 * - 首个镜头：首帧 + 目标尾帧 + TTS段 + BGM段
 * - 后续镜头：上一段视频 + 目标尾帧 + TTS段 + BGM段
 *
 * 目标尾帧来自分镜图（storyboard），确保每个镜头有明确的视觉终点。
 * TTS 和 BGM 按镜头时间切分预绑定，最终合并时音频自然连续。
 */

import { execFile } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ─── 延长 Prompt 模板 ────────────────────────────────

const EXTENSION_PROMPTS = {
  continue: '继续之前的动作和场景，{motion}，保持视觉风格和角色外观一致',
  transition: '从当前画面自然过渡到{motion}，保持连续性',
  maintain: '保持当前场景氛围，{motion}，画面平稳过渡',
  slow_build: '在当前基础上缓慢推进，{motion}，节奏舒缓',
  intensify: '在当前基础上逐步加强，{motion}，张力递增',
};

export function buildExtensionPrompt(motion, style = 'continue') {
  const tpl = EXTENSION_PROMPTS[style] || EXTENSION_PROMPTS.continue;
  return tpl.replace('{motion}', motion || '继续当前动作');
}

// ─── 音频预切割 ──────────────────────────────────────

/**
 * 预切割音频（TTS 或 BGM）为多个片段
 */
export async function prebindAudio(audioPath, segments, outputDir) {
  if (!audioPath) return segments.map(() => null);
  await mkdir(outputDir, { recursive: true });
  const results = [];

  for (let i = 0; i < segments.length; i++) {
    const { start, end } = segments[i];
    const outputPath = join(outputDir, `audio_${String(i).padStart(3, '0')}.${audioPath.match(/\.(\w+)$/)?.[1] || 'mp3'}`);
    try {
      await execFileAsync('ffmpeg', [
        '-i', audioPath, '-ss', String(start), '-t', String(end - start),
        '-acodec', 'copy', '-y', outputPath,
      ]);
      results.push(outputPath);
    } catch (e) {
      console.warn(`[ext-chain] 音频切割失败 segment ${i}: ${e.message}`);
      results.push(null);
    }
  }
  return results;
}

// ─── 延长链构建 ──────────────────────────────────────

/**
 * 构建延长链执行计划
 *
 * @param {Array<object>} shots - 分镜列表
 *   每个 shot:
 *   {
 *     shot_id: string,
 *     duration: number,        // 秒
 *     motion: string,          // 运动描述（如"缓慢推进"）
 *     prompt_detail: string,   // 详细描述（首个镜头用）
 *     end_frame: string,       // 目标尾帧图片路径（from storyboard）
 *     tts_start: number,       // TTS 起始时间
 *     tts_end: number,         // TTS 结束时间
 *     bgm_start: number,       // BGM 起始时间
 *     bgm_end: number,         // BGM 结束时间
 *     extension_style?: string // 延长风格（后续镜头用）
 *   }
 * @param {string} outputDir - 工作目录
 * @returns {object} 延长链执行计划
 */
export function buildChainPlan(shots, outputDir) {
  const plan = { shots: [], breakpoints: [], totalDuration: 0 };
  let cumulativeTime = 0;

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const isFirst = i === 0;
    const shotDir = join(outputDir, `shot_${String(i).padStart(3, '0')}_${shot.shot_id}`);

    plan.shots.push({
      ...shot,
      index: i,
      dir: shotDir,
      videoPath: join(shotDir, 'video.mp4'),
      // 参考资源（运行时填充）
      referenceVideo: null,    // 上一段视频路径（非首个镜头）
      ttsSegment: null,        // TTS 音频片段路径
      bgmSegment: null,        // BGM 音频片段路径
      // prompt
      prompt: isFirst
        ? shot.prompt_detail || shot.motion
        : buildExtensionPrompt(shot.motion, shot.extension_style),
      isFirst,
      status: 'pending',
      cumulativeStart: cumulativeTime,
    });

    plan.breakpoints.push({
      shotIndex: i,
      shotId: shot.shot_id,
      cumulativeTime,
    });

    cumulativeTime += shot.duration;
  }

  plan.totalDuration = cumulativeTime;
  return plan;
}

// ─── 延长链执行器 ────────────────────────────────────

/**
 * 执行延长链生成
 *
 * 每个镜头的参考输入：
 * - 首个镜头：end_frame(目标尾帧) + ttsSegment + bgmSegment
 * - 后续镜头：referenceVideo(上一段视频) + end_frame(目标尾帧) + ttsSegment + bgmSegment
 *
 * @param {object} plan
 * @param {object} options
 * @param {Function} options.generate - 生成函数 (shot) => videoUrl
 *   shot 中包含：prompt, end_frame, referenceVideo, ttsSegment, bgmSegment, isFirst
 *   生成函数应将这些资源作为 file_paths 传给即梦 Seedance API
 * @param {string} options.ttsPath - 完整 TTS 音频路径
 * @param {string} options.bgmPath - 完整 BGM 音频路径
 * @param {number} options.retryCount
 * @param {Function} options.onProgress
 */
export async function executeChain(plan, options = {}) {
  const {
    generate,
    ttsPath,
    bgmPath,
    retryCount = 2,
    onProgress,
  } = options;

  const result = { success: true, videos: [], failed: [], totalDuration: plan.totalDuration };

  // 预切割 TTS 和 BGM
  const ttsSegments = await prebindAudio(
    ttsPath,
    plan.shots.map(s => ({ start: s.tts_start, end: s.tts_end })),
    join(dirname(plan.shots[0]?.dir || '/tmp'), 'audio_tts'),
  );

  const bgmSegments = await prebindAudio(
    bgmPath,
    plan.shots.map(s => ({ start: s.bgm_start, end: s.bgm_end })),
    join(dirname(plan.shots[0]?.dir || '/tmp'), 'audio_bgm'),
  );

  for (let i = 0; i < plan.shots.length; i++) {
    const shot = plan.shots[i];
    shot.status = 'generating';
    shot.ttsSegment = ttsSegments[i];
    shot.bgmSegment = bgmSegments[i];
    onProgress?.(i + 1, plan.shots.length, shot.shot_id);

    let lastError = null;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        const videoUrl = await generate(shot);
        if (!videoUrl) throw new Error('生成返回空 URL');

        shot.status = 'done';
        result.videos.push({ shotId: shot.shot_id, index: i, videoUrl, duration: shot.duration });

        // 标记下一段的参考视频
        if (i < plan.shots.length - 1) {
          plan.shots[i + 1].referenceVideo = shot.videoPath;
        }

        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        console.warn(`[ext-chain] shot ${shot.shot_id} attempt ${attempt + 1} failed: ${e.message}`);
      }
    }

    if (lastError) {
      shot.status = 'failed';
      result.failed.push({ shotId: shot.shot_id, index: i, error: lastError.message });
      result.success = false;
      for (let j = i + 1; j < plan.shots.length; j++) plan.shots[j].status = 'skipped';
      break;
    }
  }

  return result;
}

// ─── 断点续传 ────────────────────────────────────────

export async function resumeFromBreakpoint(plan, fromIndex, options = {}) {
  const subPlan = {
    ...plan,
    shots: plan.shots.slice(fromIndex).map((shot, i) => ({
      ...shot,
      index: i,
      isFirst: i === 0,
      referenceVideo: i === 0 ? plan.shots[fromIndex - 1]?.videoPath || null : null,
    })),
  };
  return executeChain(subPlan, options);
}

// ─── 最终合并 ────────────────────────────────────────

export async function assembleFinal(videoPaths, audioPath, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  const concatList = videoPaths.map(p => `file '${p}'`).join('\n');
  const listPath = join(dirname(outputPath), 'concat_list.txt');
  await writeFile(listPath, concatList);

  const args = ['-f', 'concat', '-safe', '0', '-i', listPath];
  if (audioPath) {
    args.push('-i', audioPath, '-c:v', 'copy', '-c:a', 'aac', '-shortest');
  } else {
    args.push('-c', 'copy');
  }
  args.push('-y', outputPath);

  await execFileAsync('ffmpeg', args);
  return outputPath;
}

// ─── 重生成粒度 ──────────────────────────────────────

export function getRetryPlan(granularity, plan, targetIndex) {
  switch (granularity) {
    case 'single':
      return {
        mode: 'single',
        shot: plan.shots[targetIndex],
        referenceVideo: targetIndex > 0 ? plan.shots[targetIndex - 1].videoPath : null,
      };
    case 'breakpoint':
      return { mode: 'breakpoint', fromIndex: targetIndex };
    case 'full':
      return { mode: 'full', plan };
    default:
      throw new Error(`未知粒度: ${granularity}`);
  }
}
