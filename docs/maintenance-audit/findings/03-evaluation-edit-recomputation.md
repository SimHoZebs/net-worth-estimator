# Evaluation Edits Restart Projection Workers

Severity: High

Status: Resolved

## Evidence

- `src/components/evaluations/EvaluationList.tsx:53-58` commits numeric configuration on each change.
- `src/components/evaluations/EvaluationList.tsx:217-225` commits labels on each keystroke.
- `src/App.tsx:133-140` includes the full evaluation collection in projection settings.
- `src/hooks/useProjection.ts:34-94` and `src/hooks/useStochastic.ts:36-119` restart work when settings change.

## Impact

Presentation-only label edits abort deterministic and Monte Carlo work. Configuration typing can repeatedly restart expensive simulations before the user finishes an edit.

## Minimal Recommendation

Exclude presentation metadata such as labels from computation request identity. Keep form drafts local and commit calculation-affecting configuration on blur, explicit apply, or a bounded debounce.

## Verification

- Assert that label editing does not call either projection method.
- Assert that one committed configuration change starts exactly one new run.
- Manually verify provisional stochastic results remain visible during label editing.

## Resolution

- Evaluation labels are excluded from deterministic and stochastic computation request identity.
- FI and net-worth-threshold editors keep calculation-affecting edits in local drafts and commit them once through `Update analysis`.
- Evaluation-only recomputation retains base projection results while marking prior evaluation outcomes stale.
- Hook and editor tests verify that label typing starts no worker request and one applied configuration starts one request per worker.
