#!/bin/sh
# Diskless boot: without a persistent disk the SQLite file is fresh on every
# boot, so provision schema idempotently before running the server. With a
# persistent volume the setup preserves existing data. When guest identity is
# configured, provision the guest destination row as well; repeat runs
# preserve the existing database and user rows. See deploy/README.md.
set -eu
: "${NET_WORTH_ESTIMATOR_DB:?NET_WORTH_ESTIMATOR_DB is required}"
if [ -n "${NET_WORTH_ESTIMATOR_GUEST_SUBJECT:-}" ]; then
  : "${NET_WORTH_ESTIMATOR_AUTH_ISSUER:?NET_WORTH_ESTIMATOR_AUTH_ISSUER is required for guest provisioning}"
  /app/setupdb --db "$NET_WORTH_ESTIMATOR_DB" \
    --issuer "$NET_WORTH_ESTIMATOR_AUTH_ISSUER" \
    --subject "$NET_WORTH_ESTIMATOR_GUEST_SUBJECT"
else
  /app/setupdb --db "$NET_WORTH_ESTIMATOR_DB"
fi
exec /app/server
