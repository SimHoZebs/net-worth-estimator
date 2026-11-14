---
id: 008
title: Make table adoption substantive
scope: contracts-types
status: accepted
---

Priority: medium.

The table adapter explicitly puts the old spacing, colors, and hover behavior ahead of shadcn defaults. It bypasses the installed Table container to retain another scroll owner. TanStack is used with an empty row model for headers, and another empty model for a pager, while callers still supply body JSX. This adds library machinery without adopting its row model.

Choose a straightforward preset Table composition for simple/server-driven lists. Use TanStack where actual row/column behavior benefits from it, including valid manual server pagination where needed. Remove the competing appearance recipes and unnecessary header-only machinery. Retain a thin accessible caption/scroll composition if useful; deleting every abstraction is not the goal.

References: `frontend/src/components/DataTable.tsx:23`, `frontend/src/components/DataTable.tsx:42`, `frontend/src/components/DataTable.tsx:137`, `frontend/src/components/DataTable.tsx:181`, `frontend/src/components/DataTable.tsx:252`, `frontend/src/components/ui/table.tsx:4`.

Verification: one keyboard-scrollable region, accessible caption and column headers, row alignment, selection/sorting where supported, zero/one/multiple-page behavior, server page boundaries, and preset density/hover appearance. No performance saving is claimed without measurement.
