FROM node:24-alpine AS build

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
# `npm run build` regenerates the API client from the checked-in snapshot
# via `prebuild`, so the image never uses a stale generated tree. Refresh
# the snapshot itself with `npm run openapi:pull` whenever the backend API
# changes.
RUN npm run build

FROM nginx:alpine

ENV BACKEND_URL=http://backend:8787 \
    NGINX_ENVSUBST_FILTER=^BACKEND_URL$

COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /build/frontend/dist /usr/share/nginx/html

EXPOSE 80 81

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=6 \
    CMD wget -q -O /dev/null http://127.0.0.1/ \
      && wget -q -O /dev/null http://127.0.0.1:81/__gateway_healthz || exit 1
