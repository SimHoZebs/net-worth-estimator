# Outlook: delete the unreachable notice branch

`pending` is defined as `base === null`, but Outlook later tests `base === null && !pending`. That condition cannot be true. Its body repeats notices already rendered by the live return path.

Delete the unreachable branch. Use the existing live return as the sole notice owner rather than creating another condition or component.

- Condition and duplicate: `frontend/src/pages/Outlook.tsx:81-116,125-146`.

Verify initial loading, projection failure, stale projection with retry, and range failure. The audit measured 28 lines in the unreachable branch, including 22 copied notice lines.
