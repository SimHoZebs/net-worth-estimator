---
id: 093
title: Scope the shared-database setup prohibition to conversion
scope: doc-audit-reference
status: accepted
---

The shared-database guide says not to put setup in the server entrypoint or an automatic startup dependency. `deploy/api-boot.sh` actually runs `setupdb` on every boot for diskless hosts, and the migration SOP distinguishes that fresh-schema provisioning from the conversion hook. A reader following the blanket ban would remove the wrapper that makes the Northflank boot work.

Scope the sentence to conversion only: version upgrades and data conversion stay out of the entrypoint, while fresh or current schema provisioning may run through `api-boot.sh` as the SOP describes.

Verify by re-reading the revised sentence against `api-boot.sh` and the migration SOP so no blanket prohibition remains.

References: `docs/shared-database.md:78-84`; `deploy/api-boot.sh:8-9`; `deploy/README.md:20`; `deploy/MIGRATIONS.md:31-33`.
