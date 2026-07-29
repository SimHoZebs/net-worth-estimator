# Table Identity and Dirty Comparison Are Positional

Severity: Low

## Evidence

- `src/components/ui/data-table.tsx:67-70` uses row index keys.
- `src/components/dashboard/tables/EditableCheckpointsTable.tsx:62-64` uses index keys.
- `src/components/dashboard/tables/EditablePostingsTable.tsx:75-80` compares working and original postings by array position.

## Impact

Filtering, insertion, deletion, or reordering can reuse DOM rows incorrectly or mark the wrong row as changed. Controlled fields reduce but do not eliminate the identity risk.

## Minimal Recommendation

Require or accept a stable row-key function in `DataTable`. Compare editable rows by stable IDs; define a composite checkpoint identity if checkpoints have no single ID.

## Verification

- Test insertion, deletion, filtering, and reorder behavior.
- Confirm dirty indicators remain attached to the intended row.
