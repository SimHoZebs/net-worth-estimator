---
id: 100
title: Keep the backup command in one owner
scope: doc-audit-reference
status: accepted
---

## Scenario

Before a schema upgrade, an operator follows the migration SOP `deploy/MIGRATIONS.md` to take a private backup of the application database. The application database is the SQLite file on the host that holds provider tokens and financial data for every user, as `deploy/README.md:67-69` states. The SOP owns the exact backup commands at `deploy/MIGRATIONS.md:110,124-125`: SQLite's backup API or the `sqlite3 .backup` command, which writes a consistent copy of a database that may still be written, and the verification commands `PRAGMA integrity_check`, which must return exactly `ok`, and `PRAGMA foreign_key_check`, which must return no rows. The backup set, the database copy together with its `sha256sum.txt` hash file, also has its hash recorded with the source and target SHAs and the workflow run ID in the release checklist (`deploy/MIGRATIONS.md:112`; `docs/shared-database.md:96-98`).

The operator starts the backup workflow by stopping all API writers (`docs/shared-database.md:93-95`), and the verified backup plus its recorded hash come before any production change (`deploy/MIGRATIONS.md:107-116`). The shared-database guide `docs/shared-database.md:89-118` and the deploy README `deploy/README.md:67-77` each restate the same backup command and integrity-check contract in prose while pointing at the SOP. Operators read all three documents when preparing an upgrade, so a change in one can leave the other two stale.

No data format crosses a network boundary. The commands work on a SQLite database file on the host and produce a private backup set. The backup helper exists because copying a live database file directly can capture a half-written state, which is why `deploy/README.md:69` and `deploy/MIGRATIONS.md:110` both forbid copying the active file alone.

```mermaid
flowchart LR
  A[Operator stops all API writers before a schema upgrade] --> B[Follows the backup contract in deploy/MIGRATIONS.md]
  B --> C[runs sqlite3 .backup to a consistent copy of the SQLite database]
  C --> D[PRAGMA integrity_check returns ok and foreign_key_check returns no rows]
  D --> E[Backup set with sha256sum.txt and hash recorded in the release checklist]
  B --> F[The shared-database guide and deploy README restate the command in prose]
  F --> G[A path or verification change in the SOP leaves the restatements stale]
```

## Executive summary

The migration SOP `deploy/MIGRATIONS.md` owns the backup contract, but the shared-database guide `docs/shared-database.md` and the deploy README `deploy/README.md` each restate that backup and verification contract in prose. Three homes for safety-critical guidance drift easily, especially when one changes the file path or the verification step, so an operator can follow a stale restatement while the SOP states a different, correct contract. Keep one owning statement and point the other two docs at it.

## Recommended action

Keep the contract in the migration SOP and reduce the passages in the shared-database guide and the deploy README to pointers. No new command is introduced.

## Before and after

| | Backup guidance |
| --- | --- |
| Before | The backup command and integrity check are owned by the SOP but restated in the shared-database guide and the deploy README |
| After | One owning contract in the SOP, with pointers from both guides |

```mermaid
flowchart LR
  subgraph before[Before]
    A[Backup guidance restated in three docs]
  end
  subgraph after[After]
    B[One owning snippet]
    C[Pointers from the other docs]
  end
```

## Expected improvement

A change to the file path or verification step is made in one place, so the safety-critical instructions cannot disagree with each other. This is a maintenance-structure improvement; no benchmarks were run, so no speed or size gain is claimed.

## Alternatives considered

- Leave as is — three copies keep drifting whenever the path or verification step changes. Rejected.
- Keep all three statements and add a note to update them together — that relies on manual sync, which is the failure mode this finding flags. Rejected.

## Downside of rejecting

An operator following the guide or the README can back up to a stale path or skip the current verification step while the SOP states a different, correct contract.

## Verification

Search `.backup` across `docs/` and `deploy/` and confirm one owning snippet plus pointers. This is a proposed acceptance check, not a recorded result.

References: `docs/shared-database.md:89-118,99,110`; `deploy/README.md:67-77,72`; `deploy/MIGRATIONS.md:110,124-125`.
