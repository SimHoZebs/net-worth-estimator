---
id: 132
title: Use saved amount presets when creating a schedule
scope: frontend-domain
status: accepted
---

The schedule creation form offers a hardcoded list of amounts. The Amounts catalog loads saved presets and supports user edits. Changes there do not appear in schedule creation, and Investment growth refers to different inputs in the two lists.

Use the existing Amounts preset catalog and builder when creating a schedule. Carry over schedule-specific options as supported presets. The built-in Investment growth preset uses the selected account's live balance; custom presets may still use transaction amounts.

## References

- `frontend/src/components/editors/AddScheduleDialog.tsx:63-84,125-169,214-230` uses the separate schedule list.
- `frontend/src/domain/scheduleAmounts.ts:37-184` defines that list.
- `frontend/src/domain/amountCatalog.ts:133-151` and `backend/internal/store/adapters/sqlite/schema.go:815-867` define the shared Investment growth preset.
- `frontend/src/components/editors/amountTemplates.ts:7-12` loads saved presets.

## Verification

Source comparison confirms the lists are separate and differ for Investment growth.

Create or rename a preset in Amounts and confirm schedule creation offers it and submits the stored definition. Compare Investment growth in both places. Exercise the existing schedule-specific options and their saved values.
