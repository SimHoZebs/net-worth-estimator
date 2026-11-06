# Error feedback and layout stability

## Audit decisions

Error feedback must not insert a banner above existing controls.

| Surface | Presentation | Reason |
| --- | --- | --- |
| Editors, confirmation dialogs, sharing forms, receipt review, analysis actions, source connections | Always-mounted reserved `ErrorNotice` | The error stays near the failed action. Native modal dialogs make workspace toasts inert. |
| Setup token, transaction category, independence configuration, session recovery | Always-mounted `FieldError` | Compact feedback preserves control positions and field description targets. |
| Evaluation removal and purchase reordering | Existing workspace error toast only | `performSave` already reports failures. A second banner adds duplicate feedback and shifts the page. |
| Additive load failures in groups, shared feed, flows, account details, sync status, receipts, and analysis | Reserved feedback | Refetch failure must not push existing content down. |
| Receipt image failure | Error replaces the image placeholder | A separate banner below the image shifts the image actions. |
| Full content load failures in account lists, recurring activity, inbox, connection settings, sharing, and forecast previews | Local replacement state | The affected content cannot render. Keep its error and retry local, rather than hide a blocking failure in a toast. |
| Unsaved-change confirmation | Existing confirmation state | This is a deliberate change of task, not an operation error. |

Reserved notices use a fixed-height scroll container. Long messages and retry
actions remain available without moving controls. The container accepts keyboard
focus only when it contains an error. Empty slots contain no hidden error copy.
Field feedback reserves three text lines and retains its description ID.

Do not replace reserved height with `min-height`. A wrapped server message can
exceed a minimum and move the controls again. Do not send dialog errors only to
the workspace notification center. Keep entered values and retry controls intact.

## Verification

`ErrorNotice.test.tsx` covers empty, failure, retry, and recovery states.
`errorLayout.spec.ts` compares real browser rectangles before and after account
validation and repeated failed saves at desktop and mobile sizes.
The receipt browser tests also compare placeholder geometry with long image
errors and verify keyboard access to the retry action. Transaction-detail tests
cover simultaneous subscription and form-validation errors in one reserved slot.
