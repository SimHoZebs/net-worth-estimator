FROM golang:1.27-alpine AS build

WORKDIR /build/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/server \
    ./cmd/server

FROM node:24-alpine AS frontend-build

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

FROM alpine:3.22

RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app \
    && mkdir -p /app /data \
    && chown app:app /data

WORKDIR /app

COPY --from=build --chown=app:app /out/server /app/server
COPY --from=frontend-build --chown=app:app /build/frontend/dist /app/frontend

ENV HOST=0.0.0.0 \
    PORT=8787 \
    NET_WORTH_ESTIMATOR_DB=/data/net-worth-estimator.db \
    NET_WORTH_ESTIMATOR_FRONTEND_PATH=/app/frontend

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8787/healthz || exit 1

USER app:app

ENTRYPOINT ["/app/server"]
