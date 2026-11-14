---
id: 004
title: Replace the custom date-range widget
scope: frontend-domain
status: accepted
---

Priority: high for behavior adoption.

The flow date-range control still constructs its own month cells, month navigation, two-click range state, popup placement, focus queries, focus restoration, and Escape handler. The installed shadcn Calendar has no application importer. Replacing a few buttons and the mobile dialog left the central custom widget intact.

Replace `MonthCalendar` with shadcn Calendar in range mode and use shadcn Popover for desktop anchoring and dismissal. Compose a compact modal presentation where needed. Remove the anchoring helper only after migrating all its consumers. Preserve range presets, explicit Apply/Cancel where useful, and the existing date-only/UTC domain boundary. A native date or time input elsewhere is not automatically a defect.

References: `frontend/src/pages/flows/FlowDateRangePicker.tsx:60`, `frontend/src/pages/flows/FlowDateRangePicker.tsx:177`, `frontend/src/pages/flows/FlowDateRangePicker.tsx:191`, `frontend/src/pages/flows/FlowDateRangePicker.tsx:233`, `frontend/src/components/popoverAnchor.ts:30`, `frontend/src/components/ui/calendar.tsx:14`. Official composition: https://ui.shadcn.com/docs/components/base/date-picker.

Verification: keyboard day/month navigation, reversed and same-day ranges, preset selection, Apply/Cancel, Escape/return focus, responsive anchoring, and unchanged date-only values across timezone/DST boundaries.
