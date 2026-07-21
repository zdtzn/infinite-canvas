# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 运行镜像：Bun 同时提供静态页面、登录鉴权、密钥代理与持久任务队列。
FROM oven/bun:1.3.13-alpine

WORKDIR /app
COPY --from=web-build /app/web/dist /app/web
COPY server /app/server
RUN mkdir -p /data && chown -R bun:bun /app /data

USER bun
ENV PORT=3000 DATA_DIR=/data WEB_ROOT=/app/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD bun -e "const r=await fetch('http://127.0.0.1:3000/health');if(!r.ok)process.exit(1)"
CMD ["bun", "run", "/app/server/index.ts"]
