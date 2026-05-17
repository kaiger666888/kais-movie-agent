/**
 * ReviewPlatformClient — 审核平台 Node.js 客户端
 *
 * 零 npm 依赖，使用原生 fetch + AbortSignal.timeout
 * 镜像 Python gold-team client.py 的 API 设计
 */

/**
 * Custom error class for review platform client operations.
 * Wraps all fetch/network errors with descriptive messages including status codes.
 */
export class ReviewClientError extends Error {
  constructor(message, { status, url, cause } = {}) {
    super(message);
    this.name = 'ReviewClientError';
    this.status = status || null;
    this.url = url || null;
    this.cause = cause || null;
  }
}

/**
 * ReviewPlatformClient — authenticated HTTP client for the review platform REST API.
 *
 * Supports JWT token exchange, review submission, and status queries.
 * All methods use native fetch with AbortSignal.timeout for zero-dependency operation.
 */
export class ReviewPlatformClient {
  /**
   * @param {object} options
   * @param {string} [options.baseUrl='http://192.168.71.140:8090'] - Review platform base URL
   * @param {string} [options.apiKey=''] - API key for JWT token exchange (or set REVIEW_PLATFORM_API_KEY env)
   * @param {number} [options.timeout=10000] - Request timeout in ms
   */
  constructor({ baseUrl = 'http://192.168.71.140:8090', apiKey = '', timeout = 10000 } = {}) {
    this._baseUrl = baseUrl.replace(/\/$/, '');
    this._apiKey = apiKey || process.env.REVIEW_PLATFORM_API_KEY || '';
    this._timeout = timeout;
    this._token = null;
    this._tokenExpires = 0;
  }

  /**
   * Ensure a valid JWT token is cached. Exchanges API key for JWT via POST /api/v1/auth/token.
   * Caches token with 60-second safety margin before expiry.
   * @returns {Promise<string>} Valid JWT access token
   * @throws {ReviewClientError} If authentication fails
   */
  async _ensureToken() {
    if (this._token && Date.now() < this._tokenExpires) return this._token;

    const url = `${this._baseUrl}/api/v1/auth/token`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this._apiKey, client_id: 'kais-movie-agent' }),
        signal: AbortSignal.timeout(this._timeout),
      });

      if (!resp.ok) {
        throw new ReviewClientError(`Auth failed: ${resp.status} ${resp.statusText}`, {
          status: resp.status, url,
        });
      }

      const { data } = await resp.json();
      this._token = data.access_token;
      // 60-second safety margin before expiry (same pattern as gold-team client)
      this._tokenExpires = Date.now() + (data.expires_in - 60) * 1000;
      return this._token;
    } catch (err) {
      if (err instanceof ReviewClientError) throw err;
      throw new ReviewClientError(`Auth request failed: ${err.message}`, { url, cause: err });
    }
  }

  /**
   * Submit a review to the review platform.
   * POST /api/v1/reviews with JWT Bearer auth.
   *
   * @param {object} params
   * @param {string} params.type - Review type (e.g., "pipeline_phase")
   * @param {string} params.contentRef - Content reference (e.g., "EP01:art-direction")
   * @param {object} [params.metadata] - Additional metadata (phase info, preview images)
   * @param {string} [params.callbackUrl] - URL for approval/rejection callback
   * @param {string} [params.callbackSecret] - HMAC shared secret for callback verification
   * @param {string} [params.priority='normal'] - Priority: low|normal|high|critical
   * @param {number} [params.riskScore=0.5] - Risk score 0.0-1.0
   * @returns {Promise<{reviewId: number, state: string, routing: string}>}
   * @throws {ReviewClientError} If submission fails
   */
  async submitReview({ type, contentRef, metadata, callbackUrl, callbackSecret, priority, riskScore }) {
    const body = {
      type,
      content_ref: contentRef,
      source_system: 'kais-movie-agent',
      metadata: metadata || null,
      priority: priority || 'normal',
      risk_score: riskScore ?? 0.5,
    };
    if (callbackUrl) body.callback_url = callbackUrl;
    if (callbackSecret) body.callback_secret = callbackSecret;

    const url = `${this._baseUrl}/api/v1/reviews`;
    try {
      const token = await this._ensureToken();

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this._timeout),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');

        // Degrade to AUTO on server errors (5xx) — service unavailable
        if (resp.status >= 500) {
          console.warn(`[ReviewClient] 审核服务不可用 (${resp.status}), 降级为 AUTO`);
          return { reviewId: null, state: 'DEGRADED_AUTO', routing: 'AUTO', degraded: true };
        }

        throw new ReviewClientError(
          `Submit review failed: ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ''}`,
          { status: resp.status, url },
        );
      }

      const { data } = await resp.json();
      return {
        reviewId: data.review_id,
        state: data.state,
        routing: data.routing,
      };
    } catch (err) {
      // Degrade to AUTO on timeout / network errors
      if (err.name === 'TimeoutError' || err.code === 'UND_ERR_CONNECT_TIMEOUT') {
        console.warn('[ReviewClient] 审核服务不可用 (超时), 降级为 AUTO');
        return { reviewId: null, state: 'DEGRADED_AUTO', routing: 'AUTO', degraded: true };
      }
      if (err instanceof ReviewClientError) throw err;
      // Degrade to AUTO on any other network / fetch errors
      if (err.type === 'system' || err.cause?.code === 'ECONNREFUSED' || err.cause?.code === 'ENOTFOUND') {
        console.warn(`[ReviewClient] 审核服务不可用 (${err.cause?.code || err.message}), 降级为 AUTO`);
        return { reviewId: null, state: 'DEGRADED_AUTO', routing: 'AUTO', degraded: true };
      }
      throw new ReviewClientError(`Submit request failed: ${err.message}`, { url, cause: err });
    }
  }

  /**
   * Query the status of a previously submitted review.
   * GET /api/v1/reviews/{reviewId} with JWT auth.
   *
   * @param {number|string} reviewId - The review ID returned from submitReview
   * @returns {Promise<{reviewId: number, state: string, disposition: string|null, version: number}>}
   * @throws {ReviewClientError} If query fails
   */
  async queryReviewStatus(reviewId) {
    const token = await this._ensureToken();
    const url = `${this._baseUrl}/api/v1/reviews/${reviewId}`;

    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(this._timeout),
      });

      if (!resp.ok) {
        throw new ReviewClientError(`Query review failed: ${resp.status} ${resp.statusText}`, {
          status: resp.status, url,
        });
      }

      const { data } = await resp.json();
      return {
        reviewId: data.review_id || data.id,
        state: data.state,
        disposition: data.disposition || null,
        version: data.version,
      };
    } catch (err) {
      if (err instanceof ReviewClientError) throw err;
      throw new ReviewClientError(`Query request failed: ${err.message}`, { url, cause: err });
    }
  }
}
