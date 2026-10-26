import { useMemo } from "react";
import type {
	EvaluationTables,
	FinancialModelDocument,
} from "../api/contracts.ts";
import { deriveDraftDocument, useWorkspaceStore } from "./workspaceStore.ts";

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
	const storeDraft = useWorkspaceStore(
		(state) => state.workspace?.draft ?? null,
	);
	const storeDocument = useWorkspaceStore((state) => state.serverDocument);
	const draftPresentation = useWorkspaceStore(
		(state) => state.draftPresentation,
	);
	const savedPresentation = useWorkspaceStore(
		(state) => state.savedPresentation,
	);
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
	const source = draft ?? saved ?? null;
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
