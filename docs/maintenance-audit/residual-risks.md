# Residual Risks

## Runtime Version

The observed test failure occurred on Node v26.3.1. It may not reproduce on older CI versions, but the storage access remains insufficiently guarded and accepts malformed persisted values regardless of runtime.

## Performance Measurement

Chart and worker churn were established from active dependency and lifecycle paths, not from browser profiling. Profiling is still required to quantify improvement and detect secondary bottlenecks.

## Build Output

The ignored local `dist/` directory contains stale scenario-era output. It was not tracked or modified during the audit. A clean production build must be part of implementation verification.

## Static Orphan Detection

The orphan list is based on repository-wide static import and symbol searches. Before deletion, verify there are no external consumers, dynamic imports, documentation examples, or pending branches relying on those exports.

## Compatibility Surface

Scenario-named aliases and routes appear locally orphaned but are explicitly retained by `TECHNICAL_OVERVIEW.md`. Their removal requires a deliberate compatibility-window decision and is outside this maintenance cleanup.

## Unmeasured Data Scale

Broad editor subscriptions and render-time map/set construction may become significant for large financial models, but current data size was not profiled. Optimize those paths only after measuring or establishing realistic scale limits.
