# Numeric Forms Cannot Represent Incomplete Drafts

Severity: Medium

## Evidence

- `src/components/patterns/IncomeForm.tsx:98-169` renders zero as an empty string and converts an empty input directly to zero.
- `src/components/dashboard/tables/EditablePostingsTable.tsx:153-188` commits `Number(event.target.value)` on every keystroke.
- Similar behavior exists in editable checkpoint inputs.

## Impact

Valid zero values appear blank. Empty, partial, and temporarily invalid input cannot exist independently from committed domain state, making editing brittle.

## Minimal Recommendation

Keep raw numeric strings local to the form or editable row. Parse, clamp, and commit on blur, Enter, or explicit apply while displaying committed values when not editing.

## Verification

- Test zero, blank, decimal prefixes, invalid text where permitted, cancel, and commit.
- Confirm invalid drafts never reach persisted domain state.
