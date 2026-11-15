---
id: 030
title: Let menu items own their highlight styling
scope: ui-ux
status: implemented
---

Select and dropdown popup class strings reach into descendants to override item focus/highlight, separators, nested triggers, and destructive colors. Item primitives already define their own accent/destructive states. This creates a second styling owner above them.

Delete the descendant state override block and accept standard item accent/destructive treatment. Keep popup positioning, viewport limits, and the existing translucency implementation. If subtle menu accent is intentionally encoded by the preset configuration, align that configuration with the accepted standard appearance so regeneration does not restore the overrides.

**Weight:** recommendation for reducing custom styling, not a large physical-line saving: these utilities occupy long class-string lines. The visible change is standard accent highlights and destructive colors instead of foreground tints. Do not claim the entire popup style string is nonstandard or delete required styling with it.

## References

- `frontend/src/components/ui/dropdown-menu.tsx:44,141` appends descendant selectors beginning with `**:data-[slot$=-item]:focus:bg-foreground/10` and ending with destructive-descendant overrides.
- `frontend/src/components/ui/select.tsx:86` repeats the block.
- `frontend/src/components/ui/dropdown-menu.tsx:78-99` and `frontend/src/components/ui/select.tsx:113` already style their items locally.
- `frontend/components.json:22-23` chooses translucent menus and subtle accents.
- [Official dropdown registry source](https://ui.shadcn.com/r/styles/base-nova/dropdown-menu.json) and [Select source](https://ui.shadcn.com/r/styles/base-nova/select.json) establish the base composition; configured variants require separate consideration.

## Verification

Implementation verified by light/dark screenshots, keyboard highlight/Escape, current Select label regressions, and local checks in README. components.json stays valid: its schema allows only subtle/bold menuAccent, not default; regeneration may restore preset-specific overrides.

Open transaction/sync menus and an editor select in both themes; check hover, keyboard highlight, disabled options, selected checks, nested Escape, and readable contrast. Confirm no remaining consumer depends on descendant overrides. Run lint/typecheck and capture changed static visuals. Rendering was not checked in this source audit.
