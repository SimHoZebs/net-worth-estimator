FROM golang:1.27.3-alpine AS build

WORKDIR /build/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/ \
    ./cmd/server ./cmd/setupdb ./cmd/refreshmodel ./cmd/syncaudit ./cmd/authzctl

# Independent one-time operator tools. Neither server nor setupdb imports them.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/upgrade-transaction-sim-split ./scripts/one-time/transaction-sim-split
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/upgrade-planned-purchases ./scripts/one-time/planned-purchases
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/simplefin-v2-keys ./scripts/one-time/simplefin-v2-keys
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/upgrade-transaction-rename ./scripts/one-time/transaction-rename
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/import-casdoor-authz ./scripts/one-time/casdoor-authz

FROM alpine:3.22 AS standalone

RUN apk add --no-cache ca-certificates busybox-extras sqlite \
    && addgroup -S -g 10001 app \
    && adduser -S -D -h /home/app -s /bin/sh -u 10001 -G app app \
    && mkdir -p /app /data /home/app/.ssh \
    && chmod 0700 /home/app/.ssh \
    && chown -R app:app /data /home/app

WORKDIR /app

COPY --from=build --chown=app:app /out/ /app/
COPY --chown=app:app backend/api-boot.sh /app/api-boot.sh
COPY --chown=app:app deploy/migrate.sh /app/migrate.sh
COPY --chown=app:app deploy/analysis-schema.sql /app/analysis-schema.sql
RUN chmod 0555 /app/api-boot.sh /app/migrate.sh

ENV HOST=0.0.0.0 \
    PORT=8787 \
    NET_WORTH_ESTIMATOR_DB=/data/net-worth-estimator.db

EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
    CMD wget -q -O - "http://127.0.0.1:${PORT}/readyz" || exit 1

USER app:app

# CMD lets an operator select a separate maintenance process without rebuilding.
CMD ["/app/server"]

# Northflank Sandbox packaging only. The default backend image remains Go-only.
FROM python:3.12-slim AS northflank
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates sqlite3 busybox-static \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /bin/busybox /usr/local/bin/busybox-extras \
    && groupadd -g 10001 app && useradd -u 10001 -g app -m app \
    && mkdir -p /app /data /home/app/.ssh && chmod 0700 /home/app/.ssh \
    && chown -R app:app /data /home/app
WORKDIR /app
COPY ml/pyproject.toml ml/uv.lock /app/ml/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv export --frozen --no-dev --no-hashes --no-emit-project --project /app/ml -o /tmp/requirements.txt && \
    uv pip install --system --no-cache --compile-bytecode -r /tmp/requirements.txt && \
    rm /tmp/requirements.txt
COPY --from=standalone /app/ /app/
COPY ml/*.py /app/ml/
COPY ml/seed.sqlite3 /app/ml/seed.sqlite3
COPY deploy/northflank/runtime.py /app/northflank-runtime.py
ENV HOST=0.0.0.0 PORT=8787 NET_WORTH_ESTIMATOR_DB=/data/net-worth-estimator.db \
    ML_JUDGMENT_URL=http://127.0.0.1:8766 ML_MODEL_PATH=/data/ml.sqlite3 \
    ML_SEED_PATH=/app/ml/seed.sqlite3 \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 GOMEMLIMIT=96MiB
USER app:app
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=90s --retries=6 \
    CMD python -c 'import os,urllib.request; urllib.request.urlopen("http://127.0.0.1:"+os.environ["PORT"]+"/readyz",timeout=2); urllib.request.urlopen("http://127.0.0.1:8766/health",timeout=2)'
CMD ["python", "/app/northflank-runtime.py"]

FROM standalone AS default
