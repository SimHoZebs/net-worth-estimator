---
id: 065
title: Delete the dead snapshot index pair
scope: deploy-build-test
status: accepted
---

## Scenario

This is repository housekeeping, not a screen or a user action, so no request crosses a runtime boundary. At the repository root sit two tracked files added by the single baseline commit `32252b84`: `.snapshot-index`, a 39 KB binary Git index snapshot, and `.snapshot-index.lock`, a zero-byte lock file. A Git index is the staging-area file that records which files are tracked and their checksums; committing a snapshot of it captured a baseline of an older frontend layout. No application code starts this work and no tracked source references either filename, so there is no runtime producer or reader to name — the files are inert content from that baseline commit. The format is a binary index file plus an empty lock companion, and the pair remains only because the baseline was committed. The layout they describe — `package-lock.json`, `biome.json`, `components.json`, a root-level `src/App.tsx`, and `.github/workflows/ci.yml` — no longer exists in the checkout, so the pair can only invite a reader to mistake an old baseline for current state.

## Executive summary

`.snapshot-index` is a 39 KB binary Git index snapshot and `.snapshot-index.lock` is a zero-byte file, both tracked at the repository root. No tracked source references either name. Their last change added an obsolete layout, `package-lock.json`, `biome.json`, `components.json`, a root-level `src/App.tsx`, and `.github/workflows/ci.yml`, none of which exist in the current checkout.

They are dead weight that invites a reader to treat an old baseline as current state. The recommendation is simply to delete both files.

## Recommended action

Delete both files from the repository. No new code is written and no callers need updating, because no tracked source references either name.

## Before and after

Before: two tracked files at the repository root preserve a Git index snapshot and an empty lock file from an obsolete layout.

After: the pair is removed; there is no replacement and nothing points at them.

```mermaid
flowchart LR
  A[.snapshot-index] -->|delete| C[removed from repository]
  B[.snapshot-index.lock] --> C
```

## Expected improvement

The repository no longer carries a stale baseline that a reader could mistake for current state. This is a structural improvement to clarity, not a measured improvement; no benchmark or timing was run.

## Alternatives considered

- Leave as is: rejected because the files have no tracked caller and describe a layout that no longer exists, so they can only mislead.
- Refresh the snapshot to the current layout: rejected because the finding records no consumer of the files, so there is nothing to refresh for.

## Downside of rejecting

The obsolete snapshot and its lock file remain at the repository root, continuing to invite a reader to treat a layout that no longer exists as the current baseline.

## Verification

Verify that no tracked file references the names and that the full test dispatcher `scripts/test --gate --no-browser --without-backend` is unaffected. Evidence gap: an external snapshot tool not represented in this repository could read these paths by convention; confirm with whoever owns that tooling if such a tool is known to exist. These are proposed acceptance checks; no result was recorded.

References: `.snapshot-index` and `.snapshot-index.lock` at the repository root; added by commit `32252b84`.
