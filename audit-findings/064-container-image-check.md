---
id: 064
title: Wire the standalone image test into CI
scope: deploy-build-test
status: accepted
---

`deploy/container.test.mjs` asserts image-level properties of the standalone backend image that nothing else checks: a non-root `app:app` user, no entrypoint, `/app/server` as the default command, the healthcheck target, and schema-only boot that does not provision the configured guest. It is gated on `DEPLOYMENT_TEST_IMAGE` and invoked only manually from `TESTING.md` and `deploy/README.md`. The `Tests` workflow builds the northflank target and runs the northflank container test instead, and the e2e gate builds the standalone image but does not assert those image-metadata invariants or the no-guest-at-boot behavior. A Dockerfile or `api-boot.sh` regression that breaks them can therefore pass every hosted gate.

Add a CI step that builds the standalone backend image and runs `node --test deploy/container.test.mjs` with `DEPLOYMENT_TEST_IMAGE` set. The `ml` job already builds from the same Dockerfile, so the smallest change is a second build of the default target followed by this test, or an e2e step against the image that gate already builds. The `deploy/analysis-migration.test.mjs` steps can share the same wiring.

Verify that the new step is green on a code push and that deliberately restoring an entrypoint or making boot provision the guest turns it red. Keep the existing northflank container test and the e2e gate unchanged.

References: `deploy/container.test.mjs:10-68,63-64`; `.github/workflows/tests.yml:98-112`; `TESTING.md:180`; `deploy/README.md:124`.
