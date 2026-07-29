# Shortfall View-Model Construction Is Embedded in Rendering

Severity: Low

## Evidence

- `src/components/dashboard/ShortfallDetailPanel.tsx:46-134` builds account cascades, constraint ownership, running balances, and account ordering.
- The same component renders the expandable detail UI from line 136 onward.

## Impact

Nontrivial financial event adaptation can only be tested through the component and makes the rendering function harder to review.

## Minimal Recommendation

Extract the cascade construction as a pure, colocated data builder. Keep the component and JSX structure intact unless a separate UI responsibility emerges.

## Verification

- Add focused tests for ordering, constrained accounts with no delta, running balances, and fallback source constraints.
- Confirm rendered output is unchanged.
