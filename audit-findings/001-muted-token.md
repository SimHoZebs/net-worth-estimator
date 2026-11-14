---
id: 001
title: Restore the meaning of muted
scope: ui-ux
status: accepted
---

Priority: high. This is a concrete semantic conflict, not a preference about branding.

shadcn uses `muted` for a subdued background and `muted-foreground` for text. The application assigns `--muted: var(--muted-foreground)` and deliberately omits the actual preset muted surface. Stock components using `bg-muted`, including skeletons, buttons, and dialog footers, therefore receive a text-tone color as their background.

Migrate secondary-text consumers to `text-muted-foreground` and chart text/strokes to explicit chart or foreground tokens. Restore the preset `--muted` value in both themes, then retire the conflicting application alias. Keep extra financial status colors only where they communicate a real state the preset does not define.

References: `frontend/src/styles/tokens.css:25`, `frontend/src/styles/index.css:22`, `frontend/src/styles/index.css:128`, `frontend/src/components/ui/button.tsx:12`, `frontend/src/components/ui/skeleton.tsx:7`. Official token meanings: https://ui.shadcn.com/docs/theming.

Verification: inspect computed muted background and foreground colors on a stock button, skeleton, dialog footer, and table hover in both themes. Check contrast and chart-label legibility after migrating consumers. No rendered contrast failure was measured in this audit.
