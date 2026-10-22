# SimpleFIN: merge the Sync and Trigger implementations

`Sync` handles scheduled/direct syncs. `Trigger` handles manual requests. Both call the existing `fetchAndApply` method, but duplicate the surrounding code that prevents overlapping syncs and handles Bridge retry waits. `Trigger` also checks and records the wait between successful manual syncs.

Merge that surrounding code into one private `runSync(ctx, manual bool)` method. Make `Sync` call it with `false` and `Trigger` with `true`. The manual flag controls the manual wait check and successful-manual-sync timestamp.

- Implementations: `backend/internal/simplefin/runner.go:123-149,246-284`.
- Existing tests: `backend/internal/simplefin/runner_test.go:103-383`.

Verify that the two entry methods cannot overlap, failures permit retry, Bridge retry waits work, and only successful manual syncs restart the manual wait. Include successful manual dry runs and both arrival orders. Run the SimpleFIN/API checks and the backend completion gate.

Risk is medium because concurrency and retry timing can change accidentally. Line savings remain unmeasured. The separate [HTTP error-handling cleanup](simplefin-retry-error-ownership.md) is not part of this merge.
