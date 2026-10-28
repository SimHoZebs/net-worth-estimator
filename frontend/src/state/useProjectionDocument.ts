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
	// The eval/view scope never rewrites plan data: the base document holds
	// the plan, the active document layers the request-local evaluations on
	// top. Keys hash the two halves separately so the base path cache stays
	// valid while eval/view prefs (reserve toggles, statement day, account
	// selection) only change the eval key.
	const baseDocument = source;
	const activeDocument = useMemo(
		() => (source && evaluations ? { ...source, evaluations } : source),
		[source, evaluations],
	);
	const baseKey = useMemo(
		() => (baseDocument ? JSON.stringify(baseDocument) : "null"),
		[baseDocument],
	);
	const evalKey = useMemo(
		() => (evaluations ? JSON.stringify(evaluations) : "base"),
		[evaluations],
	);
	const documentKey = useMemo(
		() => `${baseKey}::${evalKey}`,
		[baseKey, evalKey],
	);
	return { activeDocument, baseDocument, documentKey, baseKey, evalKey };
}
