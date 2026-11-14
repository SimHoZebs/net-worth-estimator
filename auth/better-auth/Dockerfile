FROM oven/bun:1.4.4 AS build
WORKDIR /app
# Keep in sync with .github/workflows/images.yml reuse paths for the auth
# component. deploy/images.test.mjs parses these COPY sources and verifies
# the workflow list covers each one (Dockerfile is the single source).
COPY package.json bun.lock ./
COPY frontend/package.json frontend/package.json
COPY extension/package.json extension/package.json
COPY auth/better-auth/package.json auth/better-auth/package.json
RUN bun install --frozen-lockfile
COPY auth/better-auth auth/better-auth
COPY frontend/src/styles frontend/src/styles
COPY frontend/src/components/ui/control-styles.ts frontend/src/components/ui/control-styles.ts
RUN bun --filter @waypoint/auth build

FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY --from=build --chown=bun:bun /app /app
ENV HOST=0.0.0.0 PORT=8000 AUTH_DATABASE=/data/identity.db
USER bun
EXPOSE 8000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD bun -e 'const r = await fetch(`http://127.0.0.1:${process.env.PORT}/healthz`); process.exit(r.ok ? 0 : 1)'
CMD ["bun", "run", "auth/better-auth/src/server.ts"]
