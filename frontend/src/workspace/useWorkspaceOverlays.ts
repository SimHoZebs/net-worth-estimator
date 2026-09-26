import { useState } from "react";
import type { EvidenceTarget } from "../components/EvidenceDialog.tsx";
import type { EditorTarget } from "../components/PlanEditor.tsx";
import type { Plan } from "../domain/model.ts";

export function useWorkspaceOverlays({
	plan,
	discard,
}: {
	plan: Plan;
	discard: () => boolean | Promise<boolean>;
}) {
	const [editor, setEditor] = useState<EditorTarget | null>(null);
	const [returnToAccount, setReturnToAccount] = useState<string | null>(null);
	const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);
	const [discardOpen, setDiscardOpen] = useState(false);
	const [discarding, setDiscarding] = useState(false);
	const tryChange = () => {
		const editable = plan.movements.filter(
			(movement) =>
				movement.enabled &&
				!movement.readOnly &&
				movement.provenance === "planned",
		);
		setEditor({
			kind: "movement",
			item:
				editable.find((movement) => movement.id === "invest") ??
				editable[0] ??
				null,
		});
	};
	const editFromEvidence = (target: EditorTarget) => {
		setReturnToAccount(evidence?.kind === "account" ? evidence.id : null);
		setEditor(target);
	};
	const closeEditor = () => {
		setEditor(null);
		if (returnToAccount) setEvidence({ kind: "account", id: returnToAccount });
		setReturnToAccount(null);
	};
	const confirmDiscard = async () => {
		if (discarding) return;
		setDiscarding(true);
		try {
			if (await discard()) setDiscardOpen(false);
		} finally {
			setDiscarding(false);
		}
	};
	return {
		editor,
		evidence,
		discardOpen,
		discarding,
		openEditor: setEditor,
		openEvidence: setEvidence,
		tryChange,
		editFromEvidence,
		closeEditor,
		closeEvidence: () => setEvidence(null),
		openDiscard: () => setDiscardOpen(true),
		closeDiscard: () => setDiscardOpen(false),
		confirmDiscard,
	};
}

export type WorkspaceOverlays = ReturnType<typeof useWorkspaceOverlays>;
