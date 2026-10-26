import { useMemo } from "react";
import type {
	EvaluationTables,
	FinancialModelDocument,
} from "../api/contracts.ts";
import { deriveDraftDocument, useWorkspaceStore } from "./workspaceStore.ts";
import { useServerModel } from "./workspaceResources.ts";
import { getResourceScope } from "../auth/resourceScope.ts";

export interface ProjectionDocumentOptions {
	document?: FinancialModelDocument | null;
	draftDocument?: FinancialModelDocument | null;
	evaluations?: EvaluationTables;
}

// Position and forecast requests must resolve the same draft and saved model.
export function useProjectionDocument({
	document,
	draftDocument,
	evaluations,
}: ProjectionDocumentOptions = {}) {
	const storeDraft = useWorkspaceStore((state) => state.draft);
	const model = useServerModel().data;
	const storeDocument = model?.document ?? null;
	const draftPresentation = useWorkspaceStore(
		(state) => state.draftPresentation,
	);
	const savedPresentation = model?.conversion?.presentation ?? null;
	const derivedDraft = useMemo(
		() =>
			deriveDraftDocument(
				storeDraft,
				storeDocument,
				draftPresentation ?? savedPresentation,
			),
		[storeDraft, storeDocument, draftPresentation, savedPresentation],
	);
	const draft = draftDocument !== undefined ? draftDocument : derivedDraft;
	const saved = document !== undefined ? document : storeDocument;
	const source =
		getResourceScope().status === "ready" ? (draft ?? saved ?? null) : null;
	const activeDocument = useMemo(
		() => (source && evaluations ? { ...source, evaluations } : source),
		[source, evaluations],
	);
	const documentKey = useMemo(
		() => (activeDocument ? JSON.stringify(activeDocument) : "null"),
		[activeDocument],
	);
	return { activeDocument, documentKey };
}
