import type { EditorTarget } from "../domain/planEdits.ts";
import { AccountEditor } from "./editors/AccountEditor.tsx";
import { AssumptionsEditor } from "./editors/AssumptionsEditor.tsx";
import type { EditorProps } from "./editors/EditorForm.tsx";
import { GoalEditor } from "./editors/GoalEditor.tsx";
import { MovementEditor } from "./editors/MovementEditor.tsx";

export type { EditorTarget } from "../domain/planEdits.ts";

export function PlanEditor({
	target,
	...props
}: EditorProps & { target: EditorTarget }) {
	switch (target.kind) {
		case "account":
			return (
				<AccountEditor
					key={target.item?.id ?? "new-account"}
					item={target.item}
					{...props}
				/>
			);
		case "movement":
			return (
				<MovementEditor
					key={target.item?.id ?? "new-movement"}
					item={target.item}
					{...props}
				/>
			);
		case "goal":
			return (
				<GoalEditor
					key={target.item?.id ?? "new-goal"}
					item={target.item}
					{...props}
				/>
			);
		case "assumptions":
			return <AssumptionsEditor {...props} />;
	}
}
