# SimpleFIN: remove duplicate retry-error handling

The SimpleFIN runner already converts a Bridge rate-limit refusal into `TooSoonError`, its retry-wait error. The HTTP handler handles that error, but also contains a second branch for the raw Bridge error that the runner already converted.

Add direct tests that establish the runner's conversion, including wrapped errors and both supplied and fallback retry durations. Then delete the unreachable raw-error branch from the HTTP handler. Its existing `TooSoonError` branch remains responsible for HTTP `429` and `Retry-After`.

- Runner conversion: `backend/internal/simplefin/runner.go:276-281`.
- Duplicate HTTP handling: `backend/internal/api/sync_handlers.go:43-54`.

Verify the status and retry header through the real runner, plus ordinary failure and concurrent-sync responses. Run the SimpleFIN/API checks and the backend completion gate.

Risk is low once tests establish the conversion. Line savings remain unmeasured. This task is separate from [merging Sync and Trigger](simplefin-sync-guards.md).
