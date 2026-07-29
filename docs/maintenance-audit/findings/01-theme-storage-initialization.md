# Theme Storage Initialization Breaks Tests

Severity: High

## Evidence

- `src/store.ts:338-345` checks for `window` but reads bare `localStorage.theme`.
- The stored value is asserted as `Theme` without validating `light`, `dark`, or `system`.
- `npm run test:run` fails while importing `src/components/evaluations/EvaluationList.test.tsx` because global `localStorage` is unavailable in the current Node/Vitest environment.

## Impact

The test suite cannot complete. A malformed browser storage value can also place an impossible value into `theme` and `resolvedTheme`.

## Minimal Recommendation

Read through guarded `window.localStorage.getItem("theme")`, catch storage access failures, and narrow the returned string against the allowed values before constructing the slice.

## Verification

- Test valid, missing, malformed, and inaccessible storage.
- Run `npm run test:run` and `npm run typecheck`.
