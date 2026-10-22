# SimpleFIN: delete the unused account-creation list

The mapper builds `Plan.Provisions`, a list describing accounts to create. The runner never consumes it. Instead, it builds and submits its own `store.SyncProvision` list.

Delete the mapper's `Provision` type, `Plan.Provisions` field, append block, obsolete assertion, and related comments. Use the existing runner/store path. The two lists cover different accounts, so making the runner consume the discarded list would be a behavior change rather than this deletion.

- Unused output: `backend/internal/simplefin/map.go:40-47,53,136-141`.
- Actual account-creation input: `backend/internal/simplefin/runner.go:173-182`.
- Tests: `backend/internal/simplefin/map_test.go:37-44,90-98`, `backend/internal/simplefin/runner_test.go:48-74`.

Verify mapper balance checks and skip counts, plus creation of unmapped accounts through the runner. The deletion candidates contain 15 production lines. Net savings remain unmeasured.
