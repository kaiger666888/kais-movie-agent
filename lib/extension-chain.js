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

/**
 * 构建全能参考模式的 prompt，正确描述参考物关系
 *
 * 即梦 Seedance 全能参考：file_paths 按顺序对应 @1 @2 @3...
 *
 * 首个镜头的 file_paths 顺序：[首帧, 目标尾帧, TTS音频, BGM音频]
 *   @1 = 首帧（画面起点）
 *   @2 = 目标尾帧（画面终点）
 *   @3 = TTS音频段
 *   @4 = BGM音频段
 *
 * 后续镜头的 file_paths 顺序：[上一段视频, 目标尾帧, TTS音频, BGM音频]
 *   @1 = 上一段视频（保持连续性）
 *   @2 = 目标尾帧（画面终点）
 *   @3 = TTS音频段
 *   @4 = BGM音频段
 */

export function buildSeedPrompt(shot) {
  // 首个镜头：@1首帧 @2尾帧
  const motion = shot.motion || shot.prompt_detail || '';
  return `@1作为画面起点，@2作为画面终点。从@1的画面开始，${motion}，最终过渡到@2的画面状态。保持角色外观和视觉风格一致。`;
}

export function buildExtensionPrompt(shot) {
  // 后续镜头：@1上一段视频 @2尾帧
  const motion = shot.motion || '';
  const style = shot.extension_style || 'continue';

  const styleMap = {
    continue: '自然延续',
    transition: '平滑过渡',
    maintain: '保持氛围',
    slow_build: '缓慢推进',
    intensify: '逐步加强',
  };
  const styleText = styleMap[style] || '自然延续';

  return `@1是上一段视频，从@1的结尾画面开始${styleText}，${motion}，最终过渡到@2的画面状态。保持与@1中角色外观和视觉风格完全一致。`;
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
      // prompt：区分首个和后续
      prompt: isFirst
        ? buildSeedPrompt(shot)
        : buildExtensionPrompt(shot),
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
    generateTTS,       // 可选: TTS 生成回调 (dialogueLines, outputDir) => ttsPath
    dialogueLines,     // 可选: 对白列表，传给 generateTTS
    retryCount = 2,
    onProgress,
  } = options;

  const result = { success: true, videos: [], failed: [], totalDuration: plan.totalDuration };

  // TTS 生成：如果提供了 generateTTS 回调且无 ttsPath，先用回调生成完整 TTS
  let resolvedTtsPath = ttsPath;
  if (!resolvedTtsPath && generateTTS && dialogueLines) {
    const ttsDir = join(dirname(plan.shots[0]?.dir || '/tmp'), 'audio_tts');
    await mkdir(ttsDir, { recursive: true });
    resolvedTtsPath = await generateTTS(dialogueLines, ttsDir);
    if (resolvedTtsPath) {
      console.log(`[ext-chain] TTS 生成完成: ${resolvedTtsPath}`);
    }
  }

  // 预切割 TTS 和 BGM
  const ttsSegments = await prebindAudio(
    resolvedTtsPath,
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

// ─── file_paths 构建 ─────────────────────────────────

/**
 * 为 Seedance API 构建 file_paths 数组，顺序与 @1 @2 @3... 对应
 *
 * 首个镜头：[首帧, 目标尾帧, TTS段?, BGM段?]
 * 后续镜头：[上一段视频, 目标尾帧, TTS段?, BGM段?]
 *
 * @param {object} shot - 计划中的镜头对象
 * @returns {string[]} file_paths 数组
 */
export function buildFilePaths(shot) {
  const paths = [];

  if (shot.isFirst) {
    // 首个镜头：首帧 + 目标尾帧
    if (shot.start_frame) paths.push(shot.start_frame);
    if (shot.end_frame) paths.push(shot.end_frame);
  } else {
    // 后续镜头：上一段视频 + 目标尾帧
    if (shot.referenceVideo) paths.push(shot.referenceVideo);
    if (shot.end_frame) paths.push(shot.end_frame);
  }

  // 音频段
  if (shot.ttsSegment) paths.push(shot.ttsSegment);
  if (shot.bgmSegment) paths.push(shot.bgmSegment);

  return paths;
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
