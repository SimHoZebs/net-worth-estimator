---
id: 012
title: Use native date inputs for the flow range
scope: frontend-domain
status: rejected
---

The flow range is the only application consumer of the calendar. It maintains a calendar draft, converts between local dates and ISO days, and switches between a desktop Popover and mobile Dialog. This is legitimate library adoption, but preserving that experience costs application code.

Replace the month grid with two native date inputs using existing Input and Field components. Keep range presets and explicit Apply. Use one Dialog at every width, or an inline form. Delete the calendar primitive and direct react-day-picker dependency. Delete Popover only after confirming no remaining consumers. This subsumes the smaller alternative of keeping the calendar but always using a Dialog.

**Weight:** strong recommendation given tolerance for behavior changes. Users lose the two-month grid and desktop anchored popup. Keep valid ISO calendar days, ordered bounds, and the query payload. Removing the calendar eliminates its local-Date boundary; replacing local converters with UTC converters while keeping the calendar is not equivalent.

## References

- `frontend/src/pages/flows/FlowDateRangePicker.tsx:28-47,65-113,128-203` owns converters, draft, presets, calendar, and responsive containers.
- `frontend/src/components/ui/calendar.tsx:1` is 217 existing lines; `frontend/src/components/ui/popover.tsx:1` is 87 existing lines. These are source sizes, not net savings after replacement.
- `frontend/package.json:42` declares react-day-picker.
- `docs/ui-components.md:82-87` permits native date entry.

## Verification

Confirm calendar and Popover imports before deletion. Exercise presets, Apply, Cancel, empty/invalid dates, reversed bounds, and Escape at narrow and desktop widths. Confirm identical ISO query days in distant time zones. Run typecheck and build after dependency updates. Browser behavior was not tested in this audit.

## Decision

The user chose to retain the calendar range picker. Keep its calendar, dependency, local-date boundary, and responsive overlay behavior.
