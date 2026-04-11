/**
 * kais-review — Canvas 交互式审查系统
 * ES Module
 *
 * 为管线中涉及图像的阶段生成多方案 Canvas 审查页，
 * 用户在浏览器中对比、打分、写意见，提交后结构化回传。
 *
 * 使用方式：
 * 1. 生成多个候选方案（图片）
 * 2. 调用 generateReviewPage() 生成 HTML
 * 3. 用 canvas 工具展示给用户
 * 4. 用户在浏览器中审核并提交
 * 5. 通过 callback 或 poll 获取审核结果
 */

import { writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify((await import('node:child_process')).execFile);

// ─── 审查数据结构 ──────────────────────────────────

/**
 * 创建审查会话
 * @param {object} options
 * @param {string} options.phase - 阶段标识
 * @param {string} options.title - 审查标题
 * @param {string} options.description - 审查说明
 * @param {string} options.selectMode - 选择模式 'single'(单选) | 'multi'(多选) | 'rank'(排序)
 * @param {number} options.minSelect - 最少选几个（multi/rank 模式）
 * @param {number} options.maxSelect - 最多选几个
 * @param {boolean} options.enableScoring - 是否启用评分
 * @param {boolean} options.enableFeedback - 是否启用文字反馈
 * @param {number} options.timeoutSeconds - 超时时间（默认 3600）
 * @returns {object} 审查会话
 */
export function createReviewSession(options = {}) {
  const id = `review_${Date.now()}_${randomUUID().slice(0, 8)}`;
  return {
    id,
    phase: options.phase || 'unknown',
    title: options.title || '审核',
    description: options.description || '请审核以下方案',
    selectMode: options.selectMode || 'single',
    minSelect: options.minSelect || 1,
    maxSelect: options.maxSelect || 1,
    enableScoring: options.enableScoring !== false,
    enableFeedback: options.enableFeedback !== false,
    timeoutSeconds: options.timeoutSeconds || 3600,
    items: [],
    createdAt: new Date().toISOString(),
    status: 'pending', // pending | submitted | expired
    result: null,
  };
}

/**
 * 添加审核项（图片候选方案）
 * @param {object} session - 审查会话
 * @param {object} item
 * @param {string} item.id - 候选方案 ID
 * @param {string} item.label - 显示名称
 * @param {string} item.imagePath - 图片本地路径（会被 base64 内嵌）
 * @param {string} [item.description] - 方案描述
 * @param {object} [item.metadata] - 附加数据
 */
export function addReviewItem(session, item) {
  session.items.push({
    id: item.id || `item_${session.items.length + 1}`,
    label: item.label || `方案 ${session.items.length + 1}`,
    imagePath: item.imagePath,
    description: item.description || '',
    metadata: item.metadata || {},
  });
}

/**
 * 批量添加审核项
 */
export function addReviewItems(session, items) {
  for (const item of items) addReviewItem(session, item);
}

// ─── HTML 生成 ────────────────────────────────────────

/**
 * 生成 Canvas 审查 HTML 页面
 * @param {object} session - 审查会话
 * @param {object} options
 * @param {string} options.outputDir - HTML 输出目录
 * @param {string} [options.callbackUrl] - 提交回调 URL
 * @returns {Promise<string>} HTML 文件路径
 */
export async function generateReviewPage(session, options = {}) {
  const { outputDir = '/tmp/kais-reviews', callbackUrl } = options;
  await mkdir(outputDir, { recursive: true });

  // 将所有图片转为 base64
  const itemsWithBase64 = [];
  for (const item of session.items) {
    let base64 = '';
    if (item.imagePath) {
      try {
        const data = await readFile(item.imagePath);
        base64 = `data:image/${getImageMime(item.imagePath)};base64,${data.toString('base64')}`;
      } catch (e) {
        console.warn(`[kais-review] 图片读取失败: ${item.imagePath}`);
        base64 = '';
      }
    }
    itemsWithBase64.push({ ...item, base64 });
  }

  const html = buildReviewHTML(session, itemsWithBase64, callbackUrl);
  const filePath = join(outputDir, `${session.id}.html`);
  await writeFile(filePath, html);

  return filePath;
}

function getImageMime(filePath) {
  const ext = (filePath || '').split('.').pop()?.toLowerCase();
  const mimeMap = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif' };
  return mimeMap[ext] || 'jpeg';
}

function buildReviewHTML(session, items, callbackUrl) {
  const isMulti = session.selectMode === 'multi';
  const isRank = session.selectMode === 'rank';
  const canMulti = isMulti || isRank;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${session.title} — 审核</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, 'SF Pro Display', sans-serif; background: #0d0d12; color: #e0e0e0; min-height: 100vh; }

.header { position: sticky; top: 0; z-index: 100; background: rgba(13,13,18,0.95); backdrop-filter: blur(20px); border-bottom: 1px solid #2d2d4a; padding: 20px 32px; }
.header h1 { font-size: 20px; color: #fff; margin-bottom: 4px; }
.header .phase { font-size: 12px; color: #888; }
.header .desc { font-size: 13px; color: #aaa; margin-top: 4px; }
.header .timer { position: absolute; right: 32px; top: 50%; transform: translateY(-50%); font-size: 14px; color: #888; font-variant-numeric: tabular-nums; }

.hint { background: rgba(108,92,231,0.1); border: 1px solid rgba(108,92,231,0.3); border-radius: 8px; padding: 12px 20px; margin: 16px 32px; font-size: 13px; color: #a29bfe; }
.hint strong { color: #fff; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; padding: 16px 32px; }

.card {
  background: #1a1a2e; border: 2px solid #2d2d4a; border-radius: 12px;
  overflow: hidden; transition: border-color 0.2s, transform 0.2s; cursor: pointer; position: relative;
}
.card:hover { border-color: #6c5ce7; transform: translateY(-2px); }
.card.selected { border-color: #00b894; box-shadow: 0 0 20px rgba(0,184,148,0.2); }
.card.rejected { border-color: #ff6b6b; opacity: 0.5; }

.card-check {
  position: absolute; top: 12px; left: 12px; z-index: 10;
  width: 28px; height: 28px; border-radius: 50%; border: 2px solid #555;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
  transition: all 0.2s;
}
.card.selected .card-check { border-color: #00b894; background: rgba(0,184,148,0.2); }
.card.rejected .card-check { border-color: #ff6b6b; background: rgba(255,107,107,0.2); }

.card-rank {
  position: absolute; top: 12px; right: 12px; z-index: 10;
  background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
  border: 1px solid #444; border-radius: 20px; padding: 2px 10px;
  font-size: 12px; color: #fdcb6e; font-weight: 700;
}

.card-img { width: 100%; aspect-ratio: 9/16; object-fit: cover; display: block; background: #111; }
.card-img-placeholder { width: 100%; aspect-ratio: 9/16; display: flex; align-items: center; justify-content: center; background: #111; color: #444; font-size: 13px; }

.card-body { padding: 12px 16px; }
.card-label { font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 4px; }
.card-desc { font-size: 12px; color: #888; line-height: 1.5; margin-bottom: 8px; }

.card-score { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.card-score label { font-size: 12px; color: #aaa; }
.score-bar { flex: 1; height: 6px; background: #2d2d4a; border-radius: 3px; overflow: hidden; }
.score-fill { height: 100%; background: linear-gradient(90deg, #6c5ce7, #a29bfe); border-radius: 3px; transition: width 0.2s; }
.score-num { font-size: 12px; color: #a29bfe; font-weight: 700; min-width: 20px; text-align: right; }

.card-feedback { margin-bottom: 8px; }
.card-feedback textarea {
  width: 100%; background: #111; border: 1px solid #2d2d4a; border-radius: 8px;
  color: #e0e0e0; font-size: 12px; padding: 8px 10px; resize: vertical;
  font-family: inherit;
}
.card-feedback textarea:focus { outline: none; border-color: #6c5ce7; }
.card-feedback textarea::placeholder { color: #555; }

.card-actions { display: flex; gap: 6px; }
.card-actions button {
  flex: 1; padding: 6px 0; border: 1px solid #2d2d4a; border-radius: 6px;
  background: transparent; color: #aaa; font-size: 11px; cursor: pointer; transition: all 0.2s;
}
.card-actions button:hover { border-color: #6c5ce7; color: #fff; }
.card-actions button.approve:hover { border-color: #00b894; color: #00b894; background: rgba(0,184,148,0.1); }
.card-actions button.reject:hover { border-color: #ff6b6b; color: #ff6b6b; background: rgba(255,107,107,0.1); }

.footer {
  position: sticky; bottom: 0; background: rgba(13,13,18,0.98); backdrop-filter: blur(20px);
  border-top: 1px solid #2d2d4a; padding: 16px 32px;
  display: flex; gap: 12px; justify-content: center; align-items: center;
}
.footer-info { font-size: 12px; color: #666; }
.footer button {
  padding: 10px 24px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
}
.btn-submit { background: #6c5ce7; color: #fff; }
.btn-submit:hover { background: #5a4bd6; }
.btn-approve-all { background: #00b894; color: #fff; }
.btn-approve-all:hover { background: #00a381; }
.btn-reject-all { background: transparent; color: #ff6b6b; border: 1px solid #ff6b6b !important; }
.btn-reject-all:hover { background: rgba(255,107,107,0.1); }
.btn-disabled { opacity: 0.3; cursor: not-allowed; pointer-events: none; }

.toast {
  position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
  background: #00b894; color: #fff; padding: 10px 24px; border-radius: 8px;
  font-size: 14px; font-weight: 600; z-index: 1000; opacity: 0;
  transition: opacity 0.3s;
}
.toast.show { opacity: 1; }
.toast.error { background: #ff6b6b; }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>${session.title}</h1>
    <div class="phase">${session.phase}</div>
    <div class="desc">${session.description}</div>
  </div>
  <div class="timer" id="timer"></div>
</div>

${canMulti
  ? `<div class="hint">💡 ${isRank ? '按偏好排序：拖动或点击排号设置顺序' : '可多选：点击卡片选中/取消'} · ${session.enableScoring ? '可评分' : ''} · ${session.enableFeedback ? '可写意见' : ''}</div>`
  : `<div class="hint">💡 点击选择你最满意的方案 · ${session.enableScoring ? '可评分' : ''} · ${session.enableFeedback ? '可写修改意见' : ''}</div>`
}

<div class="grid" id="grid">
${items.map((item, i) => `
  <div class="card" data-id="${item.id}" onclick="handleCardClick(this, '${item.id}')">
    ${canMulti ? `<div class="card-check" id="check-${item.id}">${i + 1}</div>` : ''}
    ${isRank ? `<div class="card-rank" id="rank-${item.id}">#${i + 1}</div>` : ''}
    ${item.base64
      ? `<img class="card-img" src="${item.base64}" alt="${item.label}" loading="lazy">`
      : `<div class="card-img-placeholder">无图片</div>`
    }
    <div class="card-body">
      <div class="card-label">${item.label}</div>
      ${item.description ? `<div class="card-desc">${item.description}</div>` : ''}
      ${session.enableScoring ? `
      <div class="card-score">
        <label>评分</label>
        <div class="score-bar"><div class="score-fill" id="fill-${item.id}" style="width:0%"></div></div>
        <span class="score-num" id="score-${item.id}">-</span>
      </div>
      <input type="range" min="1" max="10" value="" class="score-slider" data-item="${item.id}" style="display:none"
        oninput="handleScore('${item.id}', this.value)">
      ` : ''}
      ${session.enableFeedback ? `
      <div class="card-feedback">
        <textarea placeholder="修改意见（可选）..." data-item="${item.id}" rows="2"></textarea>
      </div>
      ` : ''}
      <div class="card-actions">
        <button class="approve" onclick="quickAction(event, '${item.id}', 'approve')">👍</button>
        <button class="reject" onclick="quickAction(event, '${item.id}', 'reject')">👎</button>
      </div>
    </div>
  </div>
`).join('\n')}
</div>

<div class="footer">
  <div class="footer-info" id="status">
    ${session.enableScoring ? '评分模式' : '单选模式'} · 已选 <span id="sel-count">0</span>/${session.minSelect}起
  </div>
  <button class="btn-reject-all" onclick="rejectAll()">❌ 全部重做</button>
  <button class="btn-submit btn-disabled" id="btn-submit" onclick="submitReview()">📝 提交审核</button>
  <button class="btn-approve-all btn-disabled" id="btn-approve-all" onclick="approveAll()">✅ 全部通过</button>
</div>

<div class="toast" id="toast"></div>

<script>
const CONFIG = {
  selectMode: '${session.selectMode}',
  minSelect: ${session.minSelect},
  maxSelect: ${session.maxSelect},
  enableScoring: ${session.enableScoring},
  enableFeedback: ${session.enableFeedback},
  sessionId: '${session.id}',
  callbackUrl: '${callbackUrl || ''}',
  isMulti: ${canMulti},
  isRank: ${isRank},
  itemCount: ${items.length},
};

const state = {
  selected: new Set(),
  rejected: new Set(),
  scores: {},
  feedback: {},
  rankings: Array.from({length: items.length}, (_, i) => i),
};

// ── 计时器 ──
let timeLeft = ${session.timeoutSeconds};
const timerEl = document.getElementById('timer');
function updateTimer() {
  if (timeLeft <= 0) { timerEl.textContent = '⏰ 已超时'; timerEl.style.color = '#ff6b6b'; return; }
  const m = Math.floor(timeLeft / 60), s = timeLeft % 60;
  timerEl.textContent = \`\${m}:\${String(s).padStart(2, '0')}\`;
  timeLeft--;
  setTimeout(updateTimer, 1000);
}
updateTimer();

// ── 卡片交互 ──
function handleCardClick(el, id) {
  if (!CONFIG.isMulti) {
    // 单选：点击即选中
    document.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    state.selected.clear();
    state.selected.add(id);
  } else {
    el.classList.toggle('selected');
    if (el.classList.contains('selected')) {
      state.selected.add(id);
      state.rejected.delete(id);
    } else {
      state.selected.delete(id);
    }
  }
  updateUI();
}

function quickAction(e, id, action) {
  e.stopPropagation();
  if (action === 'approve') {
    document.querySelectorAll('.card').forEach(c => c.classList.remove('selected', 'rejected'));
    const card = document.querySelector(\`.card[data-id="\${id}"]\`);
    card.classList.add('selected');
    state.selected.clear(); state.rejected.clear();
    state.selected.add(id);
  } else {
    document.querySelectorAll('.card').forEach(c => c.classList.remove('selected', 'rejected'));
    const card = document.querySelector(\`.card[data-id="\${id}"]\`);
    card.classList.add('rejected');
    state.selected.clear(); state.rejected.clear();
    state.rejected.add(id);
  }
  updateUI();
}

function approveAll() {
  document.querySelectorAll('.card').forEach(c => { c.classList.remove('selected', 'rejected'); });
  state.selected.clear(); state.rejected.clear();
  for (const item of ${JSON.stringify(items.map(i => i.id))}) state.selected.add(item);
  updateUI();
}

function rejectAll() {
  document.querySelectorAll('.card').forEach(c => { c.classList.remove('selected', 'rejected'); c.classList.add('rejected'); });
  state.selected.clear(); state.rejected.clear();
  updateUI();
}

function handleScore(id, val) {
  val = parseInt(val);
  if (val < 1 || val > 10) return;
  state.scores[id] = val;
  const fill = document.getElementById('fill-' + id);
  const num = document.getElementById('score-' + id);
  fill.style.width = (val * 10) + '%';
  num.textContent = val;
  // 更新排号
  if (CONFIG.isRank) {
    const scores = Object.entries(state.scores).sort((a, b) => b[1] - a[1]);
    scores.forEach(([id, _], i) => {
      const el = document.getElementById('rank-' + id);
      if (el) el.textContent = '#' + (i + 1);
    });
  }
}

// ── UI 更新 ──
function updateUI() {
  const count = state.selected.size;
  document.getElementById('sel-count').textContent = count;
  const enough = count >= CONFIG.minSelect;
  document.getElementById('btn-submit').classList.toggle('btn-disabled', !enough);
  document.getElementById('btn-approve-all').classList.toggle('btn-disabled', !enough);
  
  // 更新 check 显示
  if (CONFIG.isMulti) {
    state.selected.forEach(id => {
      const el = document.getElementById('check-' + id);
      if (el) el.textContent = '';
    });
  }
  
  // 更新卡片样式
  document.querySelectorAll('.card').forEach(c => {
    c.classList.remove('selected', 'rejected');
    const id = c.dataset.id;
    if (state.selected.has(id)) c.classList.add('selected');
    if (state.rejected.has(id)) c.classList.add('rejected');
  });
}

// ── 提交 ──
function submitReview() {
  if (state.selected.size < CONFIG.minSelect) { showToast('请至少选择 ' + CONFIG.minSelect + ' 个方案', true); return; }

  const result = {
    session_id: CONFIG.sessionId,
    phase: '${session.phase}',
    timestamp: new Date().toISOString(),
    action: state.rejected.size > 0 ? 'mixed' : 'approved',
    selected: CONFIG.isRank
      ? state.rankings.map((_, i) => {
          const sorted = Object.entries(state.scores).sort((a, b) => b[1] - a[1]);
          return sorted[i]?.[0] || null;
        }).filter(Boolean)
      : Array.from(state.selected),
    rejected: Array.from(state.rejected),
    scores: { ...state.scores },
    feedback: { ...state.feedback },
  };

  // 收集反馈
  document.querySelectorAll('[data-item]').forEach(el => {
    const id = el.dataset.item;
    if (el.value && el.value.trim()) result.feedback[id] = el.value.trim();
  });

  // 发送结果
  if (CONFIG.callbackUrl) {
    fetch(CONFIG.callbackUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    }).then(r => {
      if (r.ok) {
        showToast('✅ 审核已提交！');
        document.getElementById('btn-submit').disabled = true;
        document.getElementById('btn-approve-all').disabled = true;
      } else {
        showToast('提交失败，请重试', true);
      }
    }).catch(() => showToast('网络错误，请重试', true));
  } else {
    // 无 callback，显示结果供复制
    console.log('Review result:', JSON.stringify(result, null, 2));
    showToast('✅ 审核结果已生成（见控制台）');
    document.getElementById('btn-submit').disabled = true;
  }
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.className = 'toast', 3000);
}

// 初始化
updateUI();
</script>
</body>
</html>`;
}

// ─── 结果解析 ────────────────────────────────────────

/**
 * 解析审核结果（从 callback 或手动输入）
 */
export function parseReviewResult(result) {
  return {
    selected: result.selected || [],
    rejected: result.rejected || [],
    scores: result.scores || {},
    feedback: result.feedback || {},
    action: result.action || 'approved',
  };
}

// ─── 快捷：为管线阶段创建标准审查 ─────────────────

/**
 * 创建标准多方案审查（5选1）
 * @param {string} phase - 阶段
 * @param {string} title - 标题
 * @param {Array<{id: string, label: string, imagePath: string, description?: string}>} candidates - 候选方案
 * @param {object} options - 可选配置
 * @returns {Promise<{session: object, htmlPath: string}>}
 */

export async function createStandardReview(phase, title, candidates, options = {}) {
  const session = createReviewSession({
    phase,
    title,
    description: options.description || `请选择最满意的${title.toLowerCase()}`,
    selectMode: options.selectMode || 'single',
    minSelect: options.minSelect || 1,
    maxSelect: options.maxSelect || 1,
    enableScoring: options.enableScoring !== false,
    enableFeedback: options.enableFeedback !== false,
    timeoutSeconds: options.timeoutSeconds || 3600,
  });
  addReviewItems(session, candidates);
  const htmlPath = await generateReviewPage(session, {
    outputDir: options.outputDir,
    callbackUrl: options.callbackUrl,
  });
  return { session, htmlPath };
}


