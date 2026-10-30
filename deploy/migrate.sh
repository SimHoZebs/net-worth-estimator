#!/bin/sh
# The one replaceable migration body for every deployment. See MIGRATIONS.md.
# The deployment adapter stops API writers and supplies this image's environment
# and durable data mount. Never invoke this script from server startup.
# No migration is pending. Retire a body only after every target is verified.
set -eu
exit 0
