#!/bin/sh
# Diskless boot: without a persistent disk the SQLite file is fresh on every
# boot, so provision schema idempotently before running the server. With a
# persistent volume the setup preserves existing data. User workspaces,
# including the guest, follow the shared authorized-access path. Explicit
# setup can provision a destination before guest-data publication.
set -eu
: "${NET_WORTH_ESTIMATOR_DB:?NET_WORTH_ESTIMATOR_DB is required}"
/app/setupdb --db "$NET_WORTH_ESTIMATOR_DB"
exec /app/server
