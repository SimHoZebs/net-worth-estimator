# Error feedback and layout stability

## Audit decisions

One error event reports in one place only. Compare the operation or load with
its current channel before adding feedback. Never mirror the same event in an
inline banner and a workspace toast.

| Surface | Presentation | Reason |
| --- | --- | --- |
| Page actions with a toast already firing (bank sync, Gmail, sharing save) | Workspace error toast only | The toast floats and needs no reserved box. Inline banners duplicated the toast with guessed text. |
| Page loads (flows, shared feed, groups, analysis, receipts) | Conditional shadcn `Alert` with a retry `Button` | The error appears only while content cannot render. No empty box exists while healthy. |
| Editors, confirmation dialogs, sharing form, detail forms, setup token | Canonical `FieldError` from `frontend/src/components/ui/field.tsx` | Native modal dialogs make workspace toasts inert. Feedback appears only while a message exists. Keep entered values and retry controls intact. Receipt review and receipt image keep a conditional `Alert` banner because `FieldError` has no action slot for their retry actions (`Retry receipt`, `Retry image`). |
| Evaluation removal and purchase reordering | Existing workspace error toast only | `performSave` already reports failures. A second banner adds duplicate feedback and shifts the page. |
| Full content load failures in account lists, recurring activity, inbox, connection settings, sharing, and forecast previews | Local replacement state | The affected content cannot render. Keep its error and retry local, rather than hide a blocking failure in a toast. Do not also toast the same failure. |
| Unsaved-change confirmation | Existing confirmation state | This is a deliberate change of task, not an operation error. |

`Alert` renders a banner only while a message exists. It keeps no
fixed-height empty box. `FieldError` renders only while a message exists.
Do not send dialog errors only to the
workspace notification center. Messages state one failure and one action in
one sentence. Failed edits keep entered values and retry controls intact;
the workspace notice carries the failure while the form keeps its state.

Regression specs follow the [integration-suite policy](../TESTING.md#integration-suite).
