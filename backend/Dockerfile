FROM golang:1.27.3-alpine AS build

WORKDIR /build/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/ \
    ./cmd/server ./cmd/setupdb ./cmd/importcsv ./cmd/refreshmodel

FROM alpine:3.22

RUN apk add --no-cache ca-certificates busybox-extras sqlite \
    && addgroup -S -g 10001 app \
    && adduser -S -D -h /home/app -s /bin/sh -u 10001 -G app app \
    && mkdir -p /app /data /home/app/.ssh \
    && chmod 0700 /home/app/.ssh \
    && chown -R app:app /data /home/app

WORKDIR /app

COPY --from=build --chown=app:app /out/ /app/
COPY --chown=app:app backend/render-free-boot.sh /app/render-free-boot.sh
COPY --chown=app:app deploy/migrate.sh /app/migrate.sh
RUN chmod 0555 /app/render-free-boot.sh /app/migrate.sh

ENV HOST=0.0.0.0 \
    PORT=8787 \
    NET_WORTH_ESTIMATOR_DB=/data/net-worth-estimator.db

EXPOSE 8787

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
    CMD wget -q -O - "http://127.0.0.1:${PORT}/readyz" || exit 1

USER app:app

# CMD lets an operator select a separate maintenance process without rebuilding.
CMD ["/app/server"]
