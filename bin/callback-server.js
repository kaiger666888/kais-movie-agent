#!/usr/bin/env node
/**
 * callback-server.js — Review platform + GPU task callback receiver
 *
 * Lightweight node:http server that receives HMAC-SHA256 signed callbacks
 * from the review platform (review results) and gold-team (GPU task events)
 * and spawns pipeline resume or rollback as child processes.
 *
 * Routes:
 *   POST /callback/review_result — Review platform approval/rejection callbacks
 *   POST /callback/gpu_task      — Gold-team GPU task completion/failure callbacks
 *
 * Usage:
 *   REVIEW_CALLBACK_SECRET=shared-secret HMAC_SECRET_MA_GT=gpu-secret node bin/callback-server.js
 *
 * Environment:
 *   REVIEW_CALLBACK_SECRET — HMAC shared secret for review callbacks (must match callback_secret in review submission)
 *   HMAC_SECRET_MA_GT      — HMAC shared secret for GPU task callbacks from gold-team
 *   CALLBACK_PORT          — HTTP listen port (default: 8766)
 *   PIPELINE_WORKDIR       — Base directory for pipeline projects (default: process.cwd())
 */

import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ─── Configuration ──────────────────────────────────────────

const CALLBACK_SECRET = process.env.REVIEW_CALLBACK_SECRET || '';
const GPU_HMAC_SECRET = process.env.HMAC_SECRET_MA_GT || '';
const PORT = parseInt(process.env.CALLBACK_PORT || '8766', 10);
const PIPELINE_WORKDIR = process.env.PIPELINE_WORKDIR || process.cwd();

// ─── HMAC Verification ──────────────────────────────────────

/**
 * Verify HMAC-SHA256 signature from callback payload.
 * Returns true if signature matches, false otherwise.
 * In dev mode (no CALLBACK_SECRET set), always returns true.
 *
 * @param {string} body - Raw request body
 * @param {string} signature - Value from X-Callback-Signature header
 * @returns {boolean}
 */
function verifyHmac(body, signature) {
  if (!CALLBACK_SECRET) return true; // Dev mode: no verification
  const expected = createHmac('sha256', CALLBACK_SECRET).update(body).digest('hex');
  return `sha256=${expected}` === signature;
}

/**
 * Verify HMAC-SHA256 signature for GPU task callbacks.
 * Uses HMAC_SECRET_MA_GT env variable as the shared secret.
 * In dev mode (no HMAC_SECRET_MA_GT set), always returns true.
 *
 * @param {string} body - Raw request body
 * @param {string} signature - Value from X-Callback-Signature header
 * @returns {boolean}
 */
function verifyGpuHmac(body, signature) {
  if (!GPU_HMAC_SECRET) return true; // Dev mode: no verification
  const expected = createHmac('sha256', GPU_HMAC_SECRET).update(body).digest('hex');
  return `sha256=${expected}` === signature;
}

// ─── State File Lookup ──────────────────────────────────────

/**
 * Find the .pipeline-state.json that contains the matching review_id.
 * Uses the workdir from review metadata to locate the correct project directory.
 *
 * @param {number} reviewId - The review ID from the callback
 * @param {object} payload - Full callback payload (may contain metadata with workdir)
 * @returns {Promise<{stateFilePath: string, state: object, phaseId: string}|null>}
 */
async function findPipelineState(reviewId, payload) {
  // Strategy 1: Use workdir from payload metadata if available
  const metadata = payload.metadata || {};
  const workdir = metadata.workdir;

  if (workdir) {
    const stateFilePath = join(workdir, '.pipeline-state.json');
    try {
      const state = JSON.parse(await readFile(stateFilePath, 'utf-8'));
      for (const [phaseId, phaseState] of Object.entries(state.phases || {})) {
        if (phaseState.review_id === reviewId) {
          return { stateFilePath, state, phaseId };
        }
      }
    } catch {
      // State file not found or invalid at this path, continue to search
    }
  }

  // Strategy 2: Search PIPELINE_WORKDIR direct children for matching review_id
  try {
    const entries = await readdir(PIPELINE_WORKDIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const stateFilePath = join(PIPELINE_WORKDIR, entry.name, '.pipeline-state.json');
      try {
        const raw = await readFile(stateFilePath, 'utf-8');
        const state = JSON.parse(raw);
        for (const [phaseId, phaseState] of Object.entries(state.phases || {})) {
          if (phaseState.review_id === reviewId) {
            return { stateFilePath, state, phaseId };
          }
        }
      } catch {
        // Skip unreadable/missing state files
      }
    }
  } catch {
    // Workdir may not be readable
  }

  return null;
}

// ─── Callback Handler ────────────────────────────────────────

/**
 * Process a verified callback payload. Spawns pipeline resume or rollback
 * as a detached child process.
 *
 * @param {object} payload - Verified callback payload
 */
async function handleCallback(payload) {
  const { review_id, new_state, disposition_action, source_system } = payload;

  console.log(`[callback] Processing review_id=${review_id} action=${disposition_action} state=${new_state} source=${source_system}`);

  // Retry logic for review_id lookup (handles race condition from Pitfall 4)
  let found = null;
  const maxAttempts = 3;
  const delays = [0, 1000, 3000]; // immediate, 1s, 3s

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
    found = await findPipelineState(review_id, payload);
    if (found) break;
    if (attempt < maxAttempts - 1) {
      console.log(`[callback] review_id=${review_id} not found, retrying in ${delays[attempt + 1]}ms (attempt ${attempt + 1}/${maxAttempts})`);
    }
  }

  if (!found) {
    console.error(`[callback] ERROR: review_id=${review_id} not found in any pipeline state after ${maxAttempts} attempts`);
    return;
  }

  const { stateFilePath, state, phaseId } = found;
  const workdir = state.workdir || join(stateFilePath, '..');
  console.log(`[callback] Found review_id=${review_id} in phase=${phaseId} at ${stateFilePath}`);

  const isApproved = disposition_action === 'approve' || (new_state === 'COMPLETE' && disposition_action !== 'reject');

  if (isApproved) {
    // Approval: spawn pipeline resume as detached child process
    const phase = phaseId;
    console.log(`[callback] Approved — spawning pipeline resume for phase=${phase} workdir=${workdir}`);

    // Update state: mark phase as approved
    state.phases[phaseId].status = 'approved';
    state.phases[phaseId].approved_at = new Date().toISOString();
    await writeFile(stateFilePath, JSON.stringify(state, null, 2));

    const child = execFile(
      'node',
      ['lib/pipeline.js', 'resume', phase, '--workdir', workdir],
      { cwd: PIPELINE_WORKDIR, detached: true, stdio: 'ignore' },
    );
    child.unref();
    console.log(`[callback] Pipeline resume spawned (PID: ${child.pid})`);

  } else if (disposition_action === 'reject') {
    // Rejection: rollback to previous stage checkpoint
    console.log(`[callback] Rejected — rolling back phase=${phaseId} workdir=${workdir}`);

    // Find the previous stage to rollback to
    // Import PHASES order to find previous stage
    const PHASES_ORDER = [
      'requirement', 'art-direction', 'character', 'scenario',
      'voice', 'scene', 'storyboard', 'camera', 'post-production', 'quality-gate',
    ];
    const currentIdx = PHASES_ORDER.indexOf(phaseId);
    const previousStage = currentIdx > 0 ? PHASES_ORDER[currentIdx - 1] : null;

    if (previousStage) {
      // Spawn git rollback via bin/git-stage.js
      const child = execFile(
        'node',
        ['bin/git-stage.js', 'rollback', workdir, previousStage],
        { cwd: PIPELINE_WORKDIR, detached: true, stdio: 'ignore' },
      );
      child.unref();
      console.log(`[callback] Git rollback spawned for stage=${previousStage} (PID: ${child.pid})`);
    } else {
      console.warn(`[callback] No previous stage to rollback to for phase=${phaseId}`);
    }

    // Update state: mark phase as rejected
    state.phases[phaseId].status = 'rejected';
    state.phases[phaseId].rejected_at = new Date().toISOString();
    state.phases[phaseId].review_id = null;
    await writeFile(stateFilePath, JSON.stringify(state, null, 2));

  } else {
    console.log(`[callback] Unknown disposition_action=${disposition_action}, ignoring`);
  }
}

// ─── GPU Task Callback Handler ──────────────────────────────

/**
 * Process a verified GPU task callback payload.
 * Dispatches based on event type: task.artifacts_ready or task.failed.
 *
 * @param {object} payload - Verified callback payload
 */
async function handleGpuCallback(payload) {
  const { event, task_id, error } = payload;

  if (event === 'task.artifacts_ready') {
    console.log(`[GPU] 任务 ${task_id} 产物就绪`);

    // Save event to state file
    const stateFilePath = join(PIPELINE_WORKDIR, '.gpu-task-state.json');
    let state = {};
    try {
      state = JSON.parse(await readFile(stateFilePath, 'utf-8'));
    } catch {
      // File doesn't exist yet, start fresh
    }
    if (!state.tasks) state.tasks = {};
    state.tasks[task_id] = state.tasks[task_id] || {};
    state.tasks[task_id].status = 'artifacts_ready';
    state.tasks[task_id].updated_at = new Date().toISOString();
    await writeFile(stateFilePath, JSON.stringify(state, null, 2));

  } else if (event === 'task.failed') {
    console.log(`[GPU] 任务 ${task_id} 失败: ${error || 'unknown error'}`);

    // Save event to state file
    const stateFilePath = join(PIPELINE_WORKDIR, '.gpu-task-state.json');
    let state = {};
    try {
      state = JSON.parse(await readFile(stateFilePath, 'utf-8'));
    } catch {
      // File doesn't exist yet, start fresh
    }
    if (!state.tasks) state.tasks = {};
    state.tasks[task_id] = state.tasks[task_id] || {};
    state.tasks[task_id].status = 'failed';
    state.tasks[task_id].error = error || null;
    state.tasks[task_id].updated_at = new Date().toISOString();
    await writeFile(stateFilePath, JSON.stringify(state, null, 2));

  } else {
    console.warn(`[GPU] Unknown event=${event}, ignoring`);
  }
}

// ─── HTTP Server ─────────────────────────────────────────────

const server = createServer((req, res) => {
  // Route: Review platform callbacks
  if (req.url === '/callback/review_result' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });

    req.on('end', () => {
      // Verify HMAC signature
      const signature = req.headers['x-callback-signature'] || '';
      if (!verifyHmac(body, signature)) {
        console.warn(`[callback] HMAC verification failed for request from ${req.socket.remoteAddress}`);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end('{"error":"invalid signature"}');
        return;
      }

      // Parse payload
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (err) {
        console.error(`[callback] Invalid JSON payload: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"invalid json"}');
        return;
      }

      // Return 200 immediately (don't block callback delivery)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');

      // Process callback in background
      handleCallback(payload).catch(err => {
        console.error(`[callback] Unhandled error in handleCallback: ${err.message}`);
      });
    });

    req.on('error', err => {
      console.error(`[callback] Request error: ${err.message}`);
    });
    return;
  }

  // Route: GPU task callbacks from gold-team
  if (req.url === '/callback/gpu_task' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });

    req.on('end', () => {
      // Verify GPU HMAC signature
      const signature = req.headers['x-callback-signature'] || '';
      if (!verifyGpuHmac(body, signature)) {
        console.warn(`[GPU] HMAC verification failed for request from ${req.socket.remoteAddress}`);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end('{"error":"invalid signature"}');
        return;
      }

      // Parse payload
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (err) {
        console.error(`[GPU] Invalid JSON payload: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"invalid json"}');
        return;
      }

      // Return 200 immediately (don't block callback delivery)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');

      // Process GPU callback in background
      handleGpuCallback(payload).catch(err => {
        console.error(`[GPU] Unhandled error in handleGpuCallback: ${err.message}`);
      });
    });

    req.on('error', err => {
      console.error(`[GPU] Request error: ${err.message}`);
    });
    return;
  }

  // All other routes: 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Callback server listening on port ${PORT}`);
});

server.on('error', err => {
  console.error(`[callback] Server error: ${err.message}`);
  process.exit(1);
});
