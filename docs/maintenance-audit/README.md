# Maintenance Audit

Audit date: 2026-07-25

This directory records a read-only maintenance audit of the net worth estimator. Each finding is isolated so it can be reviewed, implemented, and closed independently.

## Scope

The audit covered architecture, state ownership, component boundaries, data flow, type safety, duplication, file placement, generated artifacts, render performance, and verification hygiene.

## Current Shape

| Area | Current Shape | Primary Risk | Recommended Direction |
| --- | --- | --- | --- |
| Structure | 165 source files and 23,073 TS/TSX lines | Obsolete UI generations remain | Remove only confirmed orphans |
| State | Query cache, Zustand, and worker-hook state are mostly separated | Editing can restart expensive computation | Separate drafts from committed computation inputs |
| Components | Feature containers are generally cohesive | Root orchestration and some renderer ownership are broad | Correct small ownership boundaries |
| Type safety | Strict TypeScript is enabled | Active tables and external boundaries bypass narrowing | Restore generic inference and validate unknown input |
| Performance | Heavy derivations commonly use memoization | Charts and workers are recreated too frequently | Stabilize runtime instances and commit semantics |
| Hygiene | Worktree and tracked artifacts are clean | One test suite fails | Fix theme storage initialization first |

## Findings

| Severity | Finding |
| --- | --- |
| High | [Theme storage initialization breaks tests](findings/01-theme-storage-initialization.md) |
| High | [uPlot instances are recreated on data updates](findings/02-uplot-instance-lifecycle.md) |
| High | [Evaluation edits restart projection workers](findings/03-evaluation-edit-recomputation.md) |
| Medium | [Generic table typing is bypassed](findings/04-data-table-type-safety.md) |
| Medium | [Debounced stochastic settings can overwrite newer state](findings/05-stochastic-config-stale-write.md) |
| Medium | [External payloads are asserted rather than validated](findings/06-boundary-payload-validation.md) |
| Medium | [Worker lifecycle logic is duplicated](findings/07-worker-lifecycle-duplication.md) |
| Medium | [Numeric forms cannot represent incomplete drafts](findings/08-numeric-form-drafts.md) |
| Medium | [Chart formatting is duplicated and tests miss production code](findings/09-chart-formatting-duplication.md) |
| Low | [Confirmed orphan UI implementations remain](findings/10-orphan-ui-implementations.md) |
| Low | [App owns too many orchestration concerns](findings/11-app-orchestration-boundary.md) |
| Low | [Evaluation renderer has a hidden store dependency](findings/12-evaluation-renderer-store-coupling.md) |
| Low | [Shortfall view-model construction is embedded in rendering](findings/13-shortfall-view-model-boundary.md) |
| Low | [Table identity and dirty comparison are positional](findings/14-table-row-identity.md) |
| Low | [Technical overview names the wrong chart library](findings/15-technical-overview-chart-library.md) |

## Supporting Documents

- [Structural inventory](structural-inventory.md)
- [Recommended implementation plan](recommended-plan.md)
- [Verification record](verification.md)
- [Residual risks](residual-risks.md)
