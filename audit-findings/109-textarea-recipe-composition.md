---
id: 109
title: Compose the textarea from the shared input recipe
scope: ui-ux
status: needs-review
---

`control-styles.ts` declares one visual owner for control surface, focus ring, invalid, disabled, and dark states, consumed by `Input` and the React-free auth controls. `Textarea` repeats that whole class chain verbatim and differs only in sizing. Any change to the control contract must be applied in two places and silently leaves textareas behind when the shared recipe changes.

Compose the textarea from `inputClassName` plus its sizing overrides so the class merger resolves them, instead of copying the chain.

Verify with typecheck and a comparison of rendered `Input` and `Textarea` class lists for identical focus, invalid, disabled, and dark tokens. Confirm auth controls still use `inputClassName`.

References: `frontend/src/components/ui/textarea.tsx:9`; `frontend/src/components/ui/control-styles.ts:5-9,50-51`; `auth/better-auth/src/controls.ts:11,33`.
