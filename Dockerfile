FROM golang:1.27-alpine AS build

WORKDIR /src/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/server \
    ./cmd/server

FROM alpine:3.22

RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app \
    && mkdir -p /app /data \
    && chown app:app /data

WORKDIR /app

COPY --from=build --chown=app:app /out/server /app/server
COPY --chown=app:app public/configs /app/public/configs
COPY --chown=app:app public/data/income /app/public/data/income

ENV HOST=0.0.0.0 \
    PORT=8787 \
    NET_WORTH_ESTIMATOR_DB=/data/net-worth-estimator.db \
    NET_WORTH_ESTIMATOR_MODEL_PATH=/app/public/configs \
    NET_WORTH_ESTIMATOR_INCOME_PATH=/app/public/data/income

EXPOSE 8787

USER app:app

ENTRYPOINT ["/app/server"]
