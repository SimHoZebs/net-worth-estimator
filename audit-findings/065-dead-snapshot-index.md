---
id: 065
title: Delete the dead snapshot index pair
scope: deploy-build-test
status: accepted
---

`.snapshot-index` is a 39 KB binary Git index snapshot and `.snapshot-index.lock` is a zero-byte file, both tracked at the repository root. No tracked source references either name. Their last change added an obsolete layout — `package-lock.json`, `biome.json`, `components.json`, a root-level `src/App.tsx`, and `.github/workflows/ci.yml` — none of which exist in the current checkout. They are dead weight that invites a reader to treat an old baseline as current state.

Delete both files. No callers need updating.

Verify that no tracked file references the names and that the full test dispatcher `scripts/test --gate --no-browser --without-backend` is unaffected. Evidence gap: an external snapshot tool not represented in this repository could read these paths by convention; confirm with whoever owns that tooling if such a tool is known to exist.

References: `.snapshot-index` and `.snapshot-index.lock` at the repository root; added by commit `32252b84`.
