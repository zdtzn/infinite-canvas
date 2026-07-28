# Build the Vite frontend with the committed Bun lockfile.
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# Run the static frontend and Bun monolith as an unprivileged user.
FROM oven/bun:1.3.13-alpine

WORKDIR /app
ARG APP_COMMIT=unknown
COPY --from=web-build /app/web/dist /app/web
COPY --from=web-build /app/VERSION /app/VERSION
COPY server /app/server
RUN mkdir -p /data && chown -R bun:bun /app /data

USER bun
ENV PORT=3000 DATA_DIR=/data WEB_ROOT=/app/web APP_COMMIT=${APP_COMMIT}
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD bun -e "const r=await fetch('http://127.0.0.1:3000/health');if(!r.ok)process.exit(1)"
CMD ["bun", "run", "/app/server/index.ts"]
