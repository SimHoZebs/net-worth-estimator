# Debounced Stochastic Settings Can Overwrite Newer State

Severity: Medium

## Evidence

- `src/hooks/useDebouncedStochasticConfig.ts:38-49` stores a complete pending configuration in a timeout closure.
- The hook receives controlled `config` but does not cancel or rebase pending state when that value changes externally.

## Impact

An external update made during the two-second debounce window can be overwritten by the stale pending snapshot.

## Minimal Recommendation

Cancel or rebase pending edits when the controlled configuration changes. Prefer field-level drafts and construct the committed value from current controlled state at commit time.

## Verification

- Test an external configuration update while a draft is pending.
- Confirm the stale timeout cannot overwrite the external value.
- Confirm immediate apply still cancels the pending timeout.
