# App Owns Too Many Orchestration Concerns

Severity: Low

## Evidence

`src/App.tsx` owns several independently changing responsibilities:

- Data source and query/mutation setup at lines 37-62
- Evaluation hydration at lines 93-113
- Theme media-query synchronization at lines 115-129
- Projection request construction and worker hooks at lines 131-186
- Save, reset, and template transitions at lines 188-236
- Comparison adaptation at lines 251-271
- Application composition at lines 278-494

The `ModelInputsInspector` prop shell is duplicated at lines 406-423 and 462-480.

## Impact

Changes to source handling, projection behavior, and shell rendering share one large integration surface and are difficult to test independently.

## Minimal Recommendation

Extract a projection orchestration hook and a source-action boundary, then deduplicate the inspector construction. Keep `App` responsible for composition and loading-state decisions.

## Verification

- Preserve all public child component APIs where practical.
- Test loading, invalid data, projection success, projection failure, save, reset, and template flows.
- Confirm the root subscribes only to state required for composition.
