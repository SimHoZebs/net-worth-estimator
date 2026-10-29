import type { EditorTarget } from "../domain/accountEdits.ts";
import { AccountEditor } from "./editors/AccountEditor.tsx";
import type { EditorProps } from "./editors/EditorForm.tsx";
import { EvaluationEditor } from "./editors/EvaluationEditor.tsx";
import { TransactionEditor } from "./editors/TransactionEditor.tsx";

export type { EditorTarget } from "../domain/accountEdits.ts";

/**
 * Account-scoped workspace editor. Renders row editors directly; the
 * `Plan` aggregate is only the draft/review layer underneath.
 */
export function WorkspaceEditor({
	target,
	...props
}: EditorProps & { target: EditorTarget }) {
	switch (target.kind) {
		case "account":
			return (
				<AccountEditor
					key={target.item?.id ?? "new-account"}
					item={target.item}
					onSaved={props.onClose}
					onClose={props.onClose}
				/>
			);
		case "transaction":
			return (
				<TransactionEditor
					key={target.item?.id ?? "new-transaction"}
					item={target.item}
					onSaved={props.onClose}
					onClose={props.onClose}
				/>
			);
		case "evaluation":
			return (
				<EvaluationEditor
					key={target.item?.id ?? "new-evaluation"}
					item={target.item}
					onSaved={props.onClose}
					onClose={props.onClose}
				/>
			);
	}
}
