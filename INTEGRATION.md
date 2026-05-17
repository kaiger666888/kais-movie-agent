# kais-movie-agent 集成开发指导

> 来源: kais-aigc-integration 契约层
> 更新: 2026-05-17
> 状态: Phase 0 收尾中

## 本 Repo 的集成任务

### Task 1 [P0] 新建 GoldTeamClient.js ✅ 已完成

**已写好**: `lib/gold-team-client.js` — 213 行 ESM 模块（未提交到 git）

实现内容:
- `submitTask()` — 提交 GPU 任务（X-API-Key 认证）
- `getTask()` / `listTasks()` — 查询任务
- `waitForTask()` — 轮询等待（5s 间隔，10min 超时）
- `submitTTS()` — TTS 快捷方法
- `verifyCallback()` — HMAC 回调签名验证
- `ping()` — 健康检查
- 使用原生 `fetch()` + `AbortSignal.timeout`，零外部依赖
- ESM 模块（`import/export`），引用 `../shared/hmac_node.js`

**待做**: git add + commit

---

### Task 2 [P0] 降级逻辑 — review-platform 不可用时

**位置**: `lib/review-platform-client.js`

在 `submitReview()` 中添加降级逻辑:

```javascript
async submitReview({ type, contentRef, metadata, ... }) {
  try {
    // 正常提交审核
    return await this._doSubmit({ type, contentRef, metadata, ... });
  } catch (err) {
    if (err.isTimeout || err.statusCode >= 500) {
      // review-platform 不可用 → 降级为 AUTO
      console.warn(`[ReviewClient] 降级为 AUTO: ${err.message}`);

      // 降级模式：自动放行，记录审计日志
      this._logDegradedReview({ type, contentRef, metadata, reason: err.message });

      return {
        reviewId: null,
        state: 'DEGRADED_AUTO',
        routing: 'AUTO',
        disposition: 'APPROVED',
        degraded: true,
      };
    }
    throw err;
  }
}
```

同样对 `GoldTeamClient` 也要做降级 — gold-team 不可用时回退到本地 TTS 或跳过。

---

### Task 3 [P1] Voice Phase 集成 GoldTeamClient

**位置**: `lib/phases/index.js` 中的 voice phase handler

**改造**: 将 voice phase 的 TTS 调用改为通过 gold-team 调度:

```javascript
const { GoldTeamClient } = require('../gold-team-client');

// voice phase 中
async function executeVoicePhase(pipeline, context) {
  const gtClient = new GoldTeamClient({
    baseUrl: pipeline.config.goldTeam?.baseUrl,
    apiKey: pipeline.config.goldTeam?.apiKey,
  });

  for (const line of dialogLines) {
    const result = await gtClient.submitTTS(line.text, {
      voiceId: line.voiceId,
    });

    // 方式 A: 等待回调（异步，不阻塞管线）
    // 方式 B: 轮询等待（简单实现）
    const task = await gtClient.waitForTask(result.taskId);
    // 下载产物到 assets/tts/
  }
}
```

**契约文件**: `/home/kai/workspace/kais-aigc-integration/contracts/gold-team-api.yaml`

---

### Task 4 [P1] Review Platform 多候选审核调用

**位置**: `lib/pipeline.js` 中已有的 `ReviewPlatformClient` 集成

**改造**: 提交审核时携带 candidates:

```javascript
// 美术方向 phase 提交 3 选 1 审核
const reviewResult = await reviewClient.submitReview({
  type: 'pipeline_phase',
  contentRef: `${pipeline.projectId}:${episode}:art-direction`,
  sourceSystem: 'kais-movie-agent',
  metadata: {
    phase: 'art-direction',
    episode,
    select_mode: 'single',  // 单选
    max_select: 1,
    candidates: [
      { id: 1, image_url: `${staticUrl}/style_a.png`, description: '赛博朋克' },
      { id: 2, image_url: `${staticUrl}/style_b.png`, description: '水彩手绘' },
      { id: 3, image_url: `${staticUrl}/style_c.png`, description: '日式动画' },
    ],
    enable_scoring: true,
    score_range: { min: 1, max: 10 },
    enable_feedback: true,
  },
  callbackUrl: `${callbackBase}/callback/review`,
  callbackSecret: process.env.HMAC_SECRET_MA_RP,
});
```

**契约文件**: `/home/kai/workspace/kais-aigc-integration/contracts/review-platform-api.yaml`

---

## 环境变量（需添加到 .env）

```bash
# gold-team 集成
GOLD_TEAM_URL=http://192.168.71.140:8900
GOLD_TEAM_API_KEY=gt-movie-agent-secret-key
HMAC_SECRET_MA_GT=shared-hmac-secret-ma-gt

# review-platform 集成（已有部分）
REVIEW_PLATFORM_URL=http://192.168.71.140:8090
REVIEW_PLATFORM_API_KEY=rp-movie-agent-secret-key
HMAC_SECRET_MA_RP=shared-hmac-secret-ma-rp

# 回调服务器
CALLBACK_BASE_URL=http://192.168.71.140:3000
```

## 回调验证

`bin/callback-server.js` 已有 HMAC 验证逻辑，需要扩展处理 GPU 任务回调:

```javascript
// 在回调路由中新增
if (event === 'task.artifacts_ready') {
  // 下载产物，通知管线继续
}

if (event === 'task.failed') {
  // 标记失败，通知管线
}
```

## 开发测试

### 用 Mock Server 独立开发

```bash
# 启动两个 mock
python3 /home/kai/workspace/kais-aigc-integration/mocks/mock-gold-team.py &
python3 /home/kai/workspace/kais-aigc-integration/mocks/mock-review-platform.py &

# 设置环境变量指向 mock
export GOLD_TEAM_URL=http://localhost:8901
export GOLD_TEAM_API_KEY=gt-mock-test-key
export REVIEW_PLATFORM_URL=http://localhost:8091
export REVIEW_PLATFORM_API_KEY=rp-mock-test-key

# 运行管线（voice phase 会调 mock gold-team）
```

### HMAC 工具库

`shared/hmac_node.js` 已复制到本 repo，用法:

```javascript
const { sign, verify } = require('./shared/hmac_node');
const signature = sign(requestBody, secret);
```

## 任务优先级

| # | 任务 | 优先级 | 预估 |
|---|------|--------|------|
| 1 | GoldTeamClient.js | P0 | ✅ 已写好（需提交） |
| 2 | Review Client 降级逻辑 | P0 | 1h |
| 3 | Voice Phase 集成 GoldTeamClient | P1 | 2h |
| 4 | 多候选审核调用改造 | P1 | 1-2h |
| 5 | callback-server 扩展 GPU 任务事件处理 | P1 | 1h |

**下一步**: Task 2（降级逻辑）→ Task 3（voice phase 接入）→ 端到端联调
