/**
 * kais-extension-chain — 基于首尾帧的延长链引擎
 * ES Module
 *
 * 即梦 API 不支持视频延长，采用"首尾帧桥接"模拟：
 * 用上一镜头的末帧截图作为下一镜头的图生视频参考图，实现视觉连续性。
 *
 * 核心概念：
 * - Seed Clip：首个生成的视频片段
 * - Extension Chain：连续的镜头链，每个镜头用上一镜头末帧作为参考
 * - Breakpoint：断点续传，支持从任意镜头重新生成
 * - Audio Pre-binding：音频预切割，每个镜头绑定对应音频片段
 */

import { execFile } from 'node:child_process';
import { writeFile, readFile, mkdir, access, copyFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ─── 帧提取 ─────────────────────────────────────────

/**
 * 从视频提取指定时间的帧
 * @param {string} videoPath - 视频文件路径
 * @param {number} timeSeconds - 时间点（秒）
 * @param {string} outputPath - 输出图片路径
 */
export async function extractFrame(videoPath, timeSeconds, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  const { stderr } = await execFileAsync('ffmpeg', [
    '-ss', String(timeSeconds),
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '2',
    '-y',
    outputPath,
  ]);
  if (stderr && !stderr.includes('Output file')) {
    console.warn(`[ext-chain] ffmpeg warning: ${stderr.slice(0, 200)}`);
  }
  return outputPath;
}

/**
 * 提取视频末帧
 */
export async function extractLastFrame(videoPath, outputPath) {
  // 获取视频时长
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', videoPath,
  ]);
  const duration = parseFloat(stdout.trim());
  if (isNaN(duration) || duration <= 0) {
    throw new Error(`无法获取视频时长: ${videoPath}`);
  }
  // 取末帧（提前 0.1s 避免黑帧）
  return extractFrame(videoPath, Math.max(0, duration - 0.1), outputPath);
}

// ─── 音频预切割 ──────────────────────────────────────

/**
 * 预切割音频为多个片段，绑定到延长链
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
    const duration = end - start;

    try {
      await execFileAsync('ffmpeg', [
        '-i', audioPath,
        '-ss', String(start),
        '-t', String(duration),
        '-acodec', 'copy',
        '-y',
        outputPath,
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
 * 构建延长链的帧桥接计划
 * @param {Array<object>} shots - 分镜列表，每个 shot 含 { shot_id, duration, motion, audio_start, audio_end }
 * @param {string} outputDir - 工作目录
 * @returns {object} 延长链执行计划
 */
export function buildChainPlan(shots, outputDir) {
  const plan = {
    shots: [],
    breakpoints: [],
    totalDuration: 0,
  };

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
      // 帧桥接：非首个镜头需要上一镜头的末帧
      bridgeFrame: isFirst ? null : null, // 运行时填充
      audioSegment: null, // 运行时填充
      isFirst,
      status: 'pending', // pending | generating | done | failed
      cumulativeStart: cumulativeTime,
    });

    // 断点：每个镜头都是潜在的断点
    plan.breakpoints.push({
      shotIndex: i,
      shotId: shot.shot_id,
      cumulativeTime,
      restartFrom: i, // 从这个镜头重新开始
    });

    cumulativeTime += shot.duration;
  }

  plan.totalDuration = cumulativeTime;
  return plan;
}

// ─── 延长链执行器 ────────────────────────────────────

/**
 * 执行延长链生成
 * @param {object} plan - buildChainPlan 的返回值
 * @param {object} options
 * @param {Function} options.generateVideo - 视频生成函数 (shot, bridgeFrame) => videoUrl
 * @param {string} options.audioPath - 完整音频路径
 * @param {number} options.retryCount - 重试次数（默认 2）
 * @param {Function} options.onProgress - 进度回调 (current, total, shotId)
 * @returns {Promise<object>} 执行结果
 */
export async function executeChain(plan, options = {}) {
  const {
    generateVideo,
    audioPath,
    retryCount = 2,
    onProgress,
  } = options;

  const result = {
    success: true,
    videos: [],
    failed: [],
    totalDuration: plan.totalDuration,
  };

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
        const videoUrl = await generateVideo(shot, shot.bridgeFrame);

        if (!videoUrl) {
          throw new Error('生成返回空 URL');
        }

        shot.status = 'done';
        result.videos.push({
          shotId: shot.shot_id,
          index: i,
          videoUrl,
          duration: shot.duration,
        });

        // 提取末帧作为下一个镜头的桥接帧
        if (i < plan.shots.length - 1) {
          const lastFramePath = join(shot.dir, 'last_frame.png');
          try {
            await extractLastFrame(/* need to download first */ videoUrl, lastFramePath);
            plan.shots[i + 1].bridgeFrame = lastFramePath;
          } catch (e) {
            console.warn(`[ext-chain] 末帧提取失败 shot ${shot.shot_id}: ${e.message}`);
          }
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

      // 断点续传标记：后续镜头标记为 skipped
      for (let j = i + 1; j < plan.shots.length; j++) {
        plan.shots[j].status = 'skipped';
      }
      break; // 链断裂，停止后续
    }
  }

  return result;
}

// ─── 断点续传 ────────────────────────────────────────

/**
 * 从断点恢复执行
 * @param {object} plan - 原始计划
 * @param {number} fromIndex - 从哪个镜头开始重新执行
 * @param {object} options - 同 executeChain
 */
export async function resumeFromBreakpoint(plan, fromIndex, options = {}) {
  // 重新构建从断点开始的子计划
  const subPlan = {
    ...plan,
    shots: plan.shots.slice(fromIndex).map((shot, i) => ({
      ...shot,
      index: i,
      isFirst: i === 0,
      bridgeFrame: i === 0
        ? join(plan.shots[fromIndex - 1]?.dir || '/tmp', 'last_frame.png')
        : null,
    })),
  };

  return executeChain(subPlan, options);
}

// ─── 最终合并 ────────────────────────────────────────

/**
 * 合并所有视频片段 + 音频为最终输出
 * @param {string[]} videoPaths - 视频片段路径
 * @param {string} audioPath - 完整音频路径（可选）
 * @param {string} outputPath - 输出路径
 */
export async function assembleFinal(videoPaths, audioPath, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });

  // 创建 concat 列表
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

/**
 * 重生成策略
 * @param {'single'|'breakpoint'|'full'} granularity - 重生成粒度
 * @param {object} plan - 延长链计划
 * @param {number} targetIndex - 目标镜头索引
 */
export function getRetryPlan(granularity, plan, targetIndex) {
  switch (granularity) {
    case 'single':
      // 只重新生成一个镜头，保留桥接帧
      return {
        mode: 'single',
        shot: plan.shots[targetIndex],
        bridgeFrame: targetIndex > 0
          ? join(plan.shots[targetIndex - 1].dir, 'last_frame.png')
          : null,
      };

    case 'breakpoint':
      // 从断点重新延长
      return {
        mode: 'breakpoint',
        fromIndex: targetIndex,
        completedShots: plan.shots.slice(0, targetIndex),
      };

    case 'full':
      // 全链重新生成
      return { mode: 'full', plan };

    default:
      throw new Error(`未知重生成粒度: ${granularity}`);
  }
}
