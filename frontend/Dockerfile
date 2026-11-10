FROM node:24-alpine AS build

# Bun owns installs and script orchestration; Node stays as the runtime that
# executes the toolchain bins (vite, orval), identical to local dev.
COPY --from=oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /build

COPY package.json bun.lock ./
COPY frontend/package.json ./frontend/package.json
COPY extension/package.json ./extension/package.json
COPY auth/better-auth/package.json ./auth/better-auth/package.json
RUN bun install --frozen-lockfile --no-progress

COPY frontend/ ./frontend/
# Frontend scripts carry no pre-hooks: generate the API client explicitly so
# the image never uses a stale generated tree. Refresh the snapshot itself
# with `bun --filter ./frontend openapi:refresh` whenever the backend API changes.
RUN bun --filter ./frontend api:generate && bun --filter ./frontend typecheck && bun --filter ./frontend build

FROM nginx:alpine

ENV BACKEND_URL=http://backend:8787 \
    NGINX_ENVSUBST_FILTER=^BACKEND_URL$

COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /build/frontend/dist /usr/share/nginx/html

EXPOSE 80 81

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=6 \
    CMD wget -q -O /dev/null http://127.0.0.1/ \
      && wget -q -O /dev/null http://127.0.0.1:81/__gateway_healthz || exit 1
