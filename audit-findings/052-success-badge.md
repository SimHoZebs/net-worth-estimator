---
id: 052
title: Own the success badge in one place
scope: ui-ux
status: accepted
---

`badgeVariants` (`components/ui/badge.tsx:9-21`) has no success variant, so pattern review invents it at each call site with the same ternary (`variant={... ? "default" : "secondary"} className={... ? "bg-success-bg text-success-text" : undefined}`) at `PatternReview.tsx:93-96,157-160,502-513`. Tokens themselves are legitimate (`styles/tokens.css:13-14,74-75`).

Add `success` to the Badge owner and replace the three ternaries with it. `reviewChips` tone (`patternReview.ts:25-29,176-192`) then maps directly to the variant.

Verify light plus dark screenshots: confirmed chips keep emerald styling and contrast, and no `bg-success-bg` overrides remain in `components/analysis/`.

References: `frontend/src/components/ui/badge.tsx:9-21`; `frontend/src/components/analysis/PatternReview.tsx:93-96,157-160,502-513`.
