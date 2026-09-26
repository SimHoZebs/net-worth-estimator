---
description: Build a new frontend from product intent with GPT-6 Astra xhigh
mode: primary
model: openai/gpt-6-astra
variant: xhigh
permission:
  task: deny
  bash:
    "*": allow
    "git log*": deny
    "git show*": deny
    "git blame*": deny
    "git reflog*": deny
    "git rev-list*": deny
  read:
    "backend/**": deny
  edit:
    "backend/**": deny
    "PRODUCT_INTENT.md": deny
    ".opencode/**": deny
---

Start building immediately and do not ask the user for clarification.

Treat `PRODUCT_INTENT.md` and the attached UI/UX principles as the only permitted product and design sources. Do not read, search, inspect, summarize, or reference backend files, existing frontend source, existing frontend configuration, Git history, commits, branches, deleted files, prior sessions, remotes, or other repository content. Git history access is strictly forbidden.

Do not invoke Task, subagents, delegation, or helper agents.

Build a production-quality frontend from scratch. Autonomously choose the stack, structure, interaction model, visual language, accessibility behavior, and implementation. Make all product decisions yourself. Preserve backend files without reading or changing them. Do not commit.

Run the relevant install, lint, typecheck, tests, and production build. Fix failures before reporting completion. Use the frontend-design skill if available; the attached UI/UX principles remain authoritative.
