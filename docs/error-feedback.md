# Error feedback and layout stability

## Audit decisions

One error event reports in one place only. Compare the operation or load with
its current channel before adding feedback. Never mirror the same event in an
inline banner and a workspace toast.

| Surface | Presentation | Reason |
| --- | --- | --- |
| Page actions with a toast already firing (bank sync, Gmail, sharing save) | Workspace error toast only | The toast floats and needs no reserved box. Inline banners duplicated the toast with guessed text. |
| Page loads (flows, shared feed, groups, analysis, receipts) | Conditional `ErrorNotice` with retry | The error appears only while content cannot render. No empty box exists while healthy. |
| Editors, confirmation dialogs, sharing form, detail forms, setup token | Conditional `FieldError` | Native modal dialogs make workspace toasts inert. Feedback appears only while a message exists. Keep entered values and retry controls intact. Receipt review keeps its conditional `ErrorNotice` banner because `FieldError` has no action slot for its retry actions. |
| Evaluation removal and purchase reordering | Existing workspace error toast only | `performSave` already reports failures. A second banner adds duplicate feedback and shifts the page. |
| Full content load failures in account lists, recurring activity, inbox, connection settings, sharing, and forecast previews | Local replacement state | The affected content cannot render. Keep its error and retry local, rather than hide a blocking failure in a toast. Do not also toast the same failure. |
| Unsaved-change confirmation | Existing confirmation state | This is a deliberate change of task, not an operation error. |

`ErrorNotice` renders a banner only while a message exists. It keeps no
fixed-height empty box. `FieldError` renders only while a message exists and
keeps its description ID for field contexts. Do not send dialog errors only to the
workspace notification center. Messages state one failure and one action in
one sentence. `ErrorNotice.test.tsx` covers failure, retry, and recovery
states. `errorLayout.spec.ts` verifies that feedback appears only in the
error state while values stay intact at desktop and mobile sizes. The receipt
browser tests also compare placeholder geometry with long image errors and
verify keyboard access to the retry action. Transaction-detail tests cover
simultaneous subscription and form-validation errors in one field slot.
