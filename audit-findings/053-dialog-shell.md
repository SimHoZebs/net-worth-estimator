---
id: 053
title: Share one dialog shell and error style
scope: ui-ux
status: accepted
---

`DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl"` appears three times (`PatternReview.tsx:321`, `RecurringPatterns.tsx:71,248`), and `errorClassName = "m-0 shrink-0 overflow-auto text-sm leading-relaxed text-danger-text"` is copied verbatim (`PatternReview.tsx:47-48`, `RecurringPatterns.tsx:39-40`).

Keep one dialog-shell plus error-text owner (shared wrapper or token import in `components/analysis/`) and reuse it in all three dialogs.

Verify at 360px width and desktop: all three scroll internally without page scroll, share max width, and render identical error text.

References: `frontend/src/components/analysis/PatternReview.tsx:47-48,321`; `frontend/src/components/analysis/RecurringPatterns.tsx:39-40,71,248`.
