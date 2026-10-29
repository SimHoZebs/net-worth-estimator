import { useMemo } from "react";
import type {
	EvaluationTables,
	FinancialModelDocument,
} from "../api/contracts.ts";
import { useServerModel } from "./workspaceResources.ts";
import { getResourceScope } from "../auth/resourceScope.ts";

export interface ProjectionDocumentOptions {
	document?: FinancialModelDocument | null;
	evaluations?: EvaluationTables;
}

// Stored-only: position and forecast requests resolve the saved model.
// Draft keystrokes never issue backend queries; saves are the only invalidation.
export function useProjectionDocument({
	document,
	evaluations,
}: ProjectionDocumentOptions = {}) {
	const model = useServerModel().data;
	const storeDocument = model?.document ?? null;
	const saved = document !== undefined ? document : storeDocument;
	const source =
		getResourceScope().status === "ready" ? (saved ?? null) : null;
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
