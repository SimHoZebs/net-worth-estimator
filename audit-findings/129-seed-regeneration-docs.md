---
id: 129
title: Keep one working recipe for regenerating the ML seed
scope: doc-audit-reference
status: accepted
---

Two guides change into `ml/` and then export to `ml/seed.sqlite3`. That relative path resolves to `ml/ml/seed.sqlite3` in the checkout, so the instructions do not export where they say they do.

Make the evaluation README the owner of the full regeneration command. Write the export to a task scratch directory and document a separate, deliberate copy to the repository seed. Link to that procedure from the other guides.

## References

- `docs/eval-datasets.md:117-130` and `ml/eval/store/README.md:18-27` duplicate the incorrect path.
- `ml/eval/README.md:88-125` explains seed export and verification.
- `ml/eval/harness.py:61-82,240-243` handles the export option.

## Verification

From `ml/`, the read-only command `realpath -m ml/seed.sqlite3` resolves to the nested path. The export was not run because it writes a database.

Resolve both paths from the documented working directory and confirm the staging path is outside the checkout and the copy destination is the canonical seed. Verify the seed after an authorized regeneration.
