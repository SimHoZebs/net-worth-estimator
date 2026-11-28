---
id: 131
title: Read only current schedule recurrence
scope: frontend-domain
status: accepted
---

The current API supplies schedule recurrence. The browser still converts an older representation into a recurrence. Its adapter also fills in some missing or invalid fields, which can make a malformed response look like a usable schedule in the editor.

Keep a reader that validates the current recurrence fields and remove the old mapping and its compatibility tests. Preserve optional fields in the current contract. Leave database conversion in the one-time operator migration.

## References

- `frontend/src/domain/recurrence.ts:241-320` contains both read paths.
- `frontend/src/domain/recurrence.test.ts:128-169` tests the migration-era fallback.
- `frontend/src/api/generated/model/schedule.ts:10-25` and `frontend/src/api/generated/model/proposedNewSchedule.ts:9-17` define current payloads.
- `deploy/MIGRATIONS.md:51` tracks the database conversion.

## Verification

Source inspection confirms the current contract does not have a `frequency` field. Migration completion was not verified for every target.

Check schedule creation and editing, source timing and recurring-pattern previews with valid current recurrence values. Verify malformed current values do not prefill the form. Before deployment, verify the required one-time database upgrade on supported targets.
