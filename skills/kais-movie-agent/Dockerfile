# =============================================================================
# kais-movie-agent (V6.0 调度中枢)
# =============================================================================
# 独立 Docker 服务，REST API 端口 8001
# 复用 lib/ 管线逻辑，server/ 为 HTTP 包装层
# =============================================================================
FROM node:20-slim

WORKDIR /app

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 应用代码（零 npm 依赖，纯 node:http）
COPY . .

# 非 root 用户
RUN groupadd -r kais && useradd -r -g kais kais && \
    chown -R kais:kais /app
USER kais

ENV NODE_ENV=production
ENV PORT=8001

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=15s \
  CMD curl -f http://localhost:8001/health || exit 1

CMD ["node", "server/index.js"]
