import { WorkspaceEditor } from "./WorkspaceEditor.tsx";
import type { EditorTarget } from "../domain/accountEdits.ts";
import type { EditorProps } from "./editors/EditorForm.tsx";

export type { EditorTarget } from "../domain/accountEdits.ts";

/** @deprecated Use WorkspaceEditor. Kept for the store/auth rebase. */
export function PlanEditor({
	target,
	...props
}: EditorProps & { target: EditorTarget }) {
	return <WorkspaceEditor target={target} {...props} />;
}
