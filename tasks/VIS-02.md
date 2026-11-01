# VIS-02 — Build interactive money-flow visualization

**Status:** Backlog  
**Area:** Money-flow visualization  
**Source:** [https://app.notion.com/p/40bee37bd028816aae72cc51eabbe355](https://app.notion.com/p/40bee37bd028816aae72cc51eabbe355)  
**Depends on:** [VIS-01](./VIS-01.md), [VIS-03](./VIS-03.md)

**User story:** As a user, I want an intuitive diagram of money movement.

### Acceptance criteria

- [ ] Show origins/destinations as nodes and directional edges.
- [ ] Encode flow magnitude with thickness.
- [ ] Re-render with date and account filters.
- [ ] Selecting an edge reveals its source transactions.
- [ ] Aggregate dense data with drilldowns.
- [ ] Provide an accessible text/table alternative.

### Implementation notes and boundaries

Sankey-like UI is an option; the graph contract should not depend on one renderer. VIS-03 is a native Notion prerequisite in addition to the original story text.

**Scope:** Planning / not implemented in this export. Do not infer completed code from these checklists.
