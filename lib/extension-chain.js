/**
 * kais-extension-chain — 基于视频参考的延长链引擎
 * ES Module
 *
 * 即梦 Seedance 使用"全能参考"模式：上传上一段视频作为参考，
 * 在 prompt 中描述延长内容，实现视觉连续性。
 *
 * 核心概念：
 * - Seed Clip：首个生成的视频片段
 * - Extension Chain：每个新片段以上一段视频为参考 + 延长 prompt
 * - Breakpoint：断点续传，支持从任意镜头重新生成
 * - Audio Pre-binding：音频预切割，每个镜头绑定对应音频片段
 */

import { execFile } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ─── 延长 Prompt 模板 ────────────────────────────────

const EXTENSION_PROMPT_TEMPLATES = {
  continue: '继续之前的动作和场景，{description}，保持视觉风格和角色外观一致',
  transition: '从当前画面自然过渡到{description}，保持连续性',
  maintain: '保持当前场景氛围，{description}，画面平稳过渡',
  slow_build: '在当前基础上缓慢推进，{description}，节奏舒缓',
  intensify: '在当前基础上逐步加强，{description}，张力递增',
};

/**
 * 构建延长 prompt
 * @param {string} motion - 运动描述
 * @param {string} style - 延长风格（continue/transition/maintain/slow_build/intensify）
 * @returns {string}
 */
export function buildExtensionPrompt(motion, style = 'continue') {
  const template = EXTENSION_PROMPT_TEMPLATES[style] || EXTENSION_PROMPT_TEMPLATES.continue;
  return template.replace('{description}', motion);
}

// ─── 音频预切割 ──────────────────────────────────────

/**
 * 预切割音频为多个片段
 * @param {string} audioPath - 完整音频文件路径
 * @param {Array<{start: number, end: number}>} segments - 时间段数组
 * @param {string} outputDir - 输出目录
 * @returns {Promise<string[]>} 切割后的音频片段路径数组
 */
export async function prebindAudio(audioPath, segments, outputDir) {
  await mkdir(outputDir, { recursive: true });
  const results = [];

  for (let i = 0; i < segments.length; i++) {
    const { start, end } = segments[i];
    const outputPath = join(outputDir, `audio_${String(i).padStart(3, '0')}.mp3`);

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
 * @param {Array<object>} shots - 分镜列表
 *   每个 shot: { shot_id, duration, motion, prompt_detail, audio_start, audio_end, extension_style? }
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
      // 全能参考：非首个镜头需要上一段视频作为参考
      referenceVideo: null, // 运行时填充
      extensionPrompt: isFirst
        ? shot.prompt_detail || shot.motion
        : buildExtensionPrompt(shot.motion || shot.prompt_detail, shot.extension_style),
      audioSegment: null,
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
 * 核心逻辑：
 * - shot_0: 图生视频（参考图 from storyboard）
 * - shot_1+: 全能参考模式（上一段视频 + 延长 prompt）
 *
 * @param {object} plan - buildChainPlan 的返回值
 * @param {object} options
 * @param {Function} options.generateSeed - 种子视频生成 (shot, imageRefs) => videoUrl
 * @param {Function} options.generateExtension - 延长生成 (shot, referenceVideoPath) => videoUrl
 * @param {string} options.audioPath - 完整音频路径
 * @param {number} options.retryCount - 重试次数
 * @param {Function} options.onProgress - 进度回调
 * @returns {Promise<object>}
 */
export async function executeChain(plan, options = {}) {
  const {
    generateSeed,
    generateExtension,
    audioPath,
    retryCount = 2,
    onProgress,
  } = options;

  const result = { success: true, videos: [], failed: [], totalDuration: plan.totalDuration };

  // 预切割音频
  const audioSegments = audioPath
    ? await prebindAudio(
        audioPath,
        plan.shots.map(s => ({ start: s.cumulativeStart, end: s.cumulativeStart + s.duration })),
        join(dirname(plan.shots[0]?.dir || '/tmp'), 'audio_segments'),
      )
    : [];

  for (let i = 0; i < plan.shots.length; i++) {
    const shot = plan.shots[i];
    shot.status = 'generating';
    shot.audioSegment = audioSegments[i] || null;
    onProgress?.(i + 1, plan.shots.length, shot.shot_id);

    let lastError = null;

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        let videoUrl;

        if (shot.isFirst) {
          // 种子片段：图生视频
          videoUrl = await generateSeed(shot);
        } else {
          // 延长片段：全能参考模式（上一段视频 + 延长 prompt）
          videoUrl = await generateExtension(shot, shot.referenceVideo);
        }

        if (!videoUrl) throw new Error('生成返回空 URL');

        shot.status = 'done';
        result.videos.push({ shotId: shot.shot_id, index: i, videoUrl, duration: shot.duration });

        // 下载并保存，作为下一段的参考
        // （实际由调用方负责下载到 shot.videoPath）
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
      // 链断裂，后续标记为 skipped
      for (let j = i + 1; j < plan.shots.length; j++) plan.shots[j].status = 'skipped';
      break;
    }
  }

  return result;
}

// ─── 断点续传 ────────────────────────────────────────

/**
 * 从断点恢复
 * @param {object} plan - 原始计划
 * @param {number} fromIndex - 从哪个镜头重新开始
 * @param {object} options - 同 executeChain
 */
export async function resumeFromBreakpoint(plan, fromIndex, options = {}) {
  const subPlan = {
    ...plan,
    shots: plan.shots.slice(fromIndex).map((shot, i) => ({
      ...shot,
      index: i,
      isFirst: i === 0,
      referenceVideo: i === 0
        ? plan.shots[fromIndex - 1]?.videoPath || null
        : null,
    })),
  };
  return executeChain(subPlan, options);
}

// ─── 最终合并 ────────────────────────────────────────

/**
 * 合并视频片段 + 音频
 */
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
        referenceVideo: targetIndex > 0
          ? plan.shots[targetIndex - 1].videoPath
          : null,
      };
    case 'breakpoint':
      return { mode: 'breakpoint', fromIndex: targetIndex };
    case 'full':
      return { mode: 'full', plan };
    default:
      throw new Error(`未知粒度: ${granularity}`);
  }
}
