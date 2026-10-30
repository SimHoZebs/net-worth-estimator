import type { EditorTarget } from "../domain/accountEdits.ts";
import { AccountEditor } from "./editors/AccountEditor.tsx";
import { EvaluationEditor } from "./editors/EvaluationEditor.tsx";
import { TransactionEditor } from "./editors/TransactionEditor.tsx";

export type { EditorTarget } from "../domain/accountEdits.ts";

/**
 * Account-scoped workspace editor. Renders row editors directly; each
 * editor saves straight to the server and closes only after confirmed save.
 */
export function WorkspaceEditor({
	target,
	onClose,
}: {
	target: EditorTarget;
	onClose: () => void;
}) {
	switch (target.kind) {
		case "account":
			return (
				<AccountEditor
					key={target.item?.id ?? "new-account"}
					item={target.item}
					onSaved={onClose}
					onClose={onClose}
				/>
			);
		case "transaction":
			return (
				<TransactionEditor
					key={target.item?.id ?? "new-transaction"}
					item={target.item}
					onSaved={onClose}
					onClose={onClose}
				/>
			);
		case "evaluation":
			return (
				<EvaluationEditor
					key={target.item?.id ?? "new-evaluation"}
					item={target.item}
					onSaved={onClose}
					onClose={onClose}
				/>
			);
	}
}
