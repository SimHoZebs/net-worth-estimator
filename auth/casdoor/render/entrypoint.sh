#!/bin/sh
# Boot-time Casdoor config. Secrets and deployment URLs never live in the
# image; templates carry __TOKENS__ only. Runs as the image user (1000), so
# everything goes under /tmp. With a persistent volume mounted at
# /tmp/casdoor-state, the database and sessions survive restarts.
set -eu

STATE=/tmp/casdoor-state
mkdir -p "$STATE/conf" "$STATE/db" "$STATE/tmp"

: "${AUTH_CLIENT_SECRET:?AUTH_CLIENT_SECRET is required}"
: "${CASDOOR_ADMIN_PASSWORD:?CASDOOR_ADMIN_PASSWORD is required}"
: "${CASDOOR_USER_PASSWORD:?CASDOOR_USER_PASSWORD is required}"
: "${CASDOOR_GUEST_PASSWORD:?CASDOOR_GUEST_PASSWORD is required}"
: "${CASDOOR_PUBLIC_URL:?CASDOOR_PUBLIC_URL is required}"
: "${APP_PUBLIC_URL:?APP_PUBLIC_URL is required}"
: "${CASDOOR_API_URL:?CASDOOR_API_URL is required}"

# Escape sed replacement metacharacters (&, |, backslash) in values.
esc() { printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'; }

CLIENT_SECRET=$(esc "$AUTH_CLIENT_SECRET")
ADMIN_PASSWORD=$(esc "$CASDOOR_ADMIN_PASSWORD")
USER_PASSWORD=$(esc "$CASDOOR_USER_PASSWORD")
GUEST_PASSWORD=$(esc "$CASDOOR_GUEST_PASSWORD")
PUBLIC_URL=$(esc "$CASDOOR_PUBLIC_URL")
APP_URL=$(esc "$APP_PUBLIC_URL")
API_URL=$(esc "$CASDOOR_API_URL")

SEED_TEMPLATE=/casdoor-template/init_data.json.template
if [ "${CASDOOR_DB_DRIVER:-sqlite}" = "postgres" ]; then
  SEED_TEMPLATE=/casdoor-template/init_data.pg.json.template
fi

sed -e "s|__AUTH_CLIENT_SECRET__|${CLIENT_SECRET}|g" \
    -e "s|__CASDOOR_ADMIN_PASSWORD__|${ADMIN_PASSWORD}|g" \
    -e "s|__CASDOOR_USER_PASSWORD__|${USER_PASSWORD}|g" \
    -e "s|__CASDOOR_GUEST_PASSWORD__|${GUEST_PASSWORD}|g" \
    -e "s|__CASDOOR_PUBLIC_URL__|${PUBLIC_URL}|g" \
    -e "s|__APP_PUBLIC_URL__|${APP_URL}|g" \
    -e "s|__CASDOOR_API_URL__|${API_URL}|g" \
    "$SEED_TEMPLATE" > "$STATE/conf/init_data.json"

DRIVER="${CASDOOR_DB_DRIVER:-sqlite}"
if [ "$DRIVER" = "postgres" ]; then
  if [ -z "${CASDOOR_DATA_SOURCE_NAME:-}" ]; then
    : "${CASDOOR_PG_HOST:?CASDOOR_PG_HOST is required for postgres}"
    : "${CASDOOR_PG_USER:?CASDOOR_PG_USER is required for postgres}"
    : "${CASDOOR_PG_PASSWORD:?CASDOOR_PG_PASSWORD is required for postgres}"
    : "${CASDOOR_PG_DB:?CASDOOR_PG_DB is required for postgres}"
    PG_PASSWORD_ESCAPED=$(printf '%s' "$CASDOOR_PG_PASSWORD" | sed "s/'/'\\\\''/g")
    CASDOOR_DATA_SOURCE_NAME="host=${CASDOOR_PG_HOST} port=${CASDOOR_PG_PORT:-5432} user=${CASDOOR_PG_USER} password='${PG_PASSWORD_ESCAPED}' dbname=${CASDOOR_PG_DB} sslmode=disable"
  fi
  : "${CASDOOR_DB_NAME:?CASDOOR_DB_NAME is required for postgres}"
  DSN=$(esc "$CASDOOR_DATA_SOURCE_NAME")
  DBNAME=$(esc "$CASDOOR_DB_NAME")
  sed -e "s|__CASDOOR_ADMIN_PASSWORD__|${ADMIN_PASSWORD}|g" \
      -e "s|__CASDOOR_PUBLIC_URL__|${PUBLIC_URL}|g" \
      -e "s|__CASDOOR_DATA_SOURCE_NAME__|${DSN}|g" \
      -e "s|__CASDOOR_DB_NAME__|${DBNAME}|g" \
      /casdoor-template/app.conf.postgres.template > "$STATE/conf/app.conf"
else
  sed -e "s|__CASDOOR_ADMIN_PASSWORD__|${ADMIN_PASSWORD}|g" \
      -e "s|__CASDOOR_PUBLIC_URL__|${PUBLIC_URL}|g" \
      /casdoor-template/app.conf.sqlite.template > "$STATE/conf/app.conf"
fi

chmod 600 "$STATE/conf/init_data.json" "$STATE/conf/app.conf"

# Casdoor resolves ./conf and ./tmp relative to the working directory.
cd "$STATE"
exec /server
