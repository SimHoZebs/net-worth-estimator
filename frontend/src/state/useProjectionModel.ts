import { useMemo } from "react";
import type { EvaluationTables, FinancialModel } from "../api/contracts.ts";
import { useServerModel } from "./workspaceResources.ts";
import { getUserScope } from "../auth/resourceScope.ts";

export interface ProjectionModelOptions {
	model?: FinancialModel | null;
	evaluations?: EvaluationTables;
}

// Position and forecast requests resolve the saved model.
export function useProjectionModel({
	model,
	evaluations,
}: ProjectionModelOptions = {}) {
	const response = useServerModel().data;
	const storeModel = response?.model ?? null;
	const saved = model !== undefined ? model : storeModel;
	const source = getUserScope().status === "ready" ? (saved ?? null) : null;
	// The active model layers request-local evaluations onto the saved model.
	// Separate keys let evaluation preferences reuse the base path cache.
	const baseModel = source;
	const activeModel = useMemo(
		() => (source && evaluations ? { ...source, evaluations } : source),
		[source, evaluations],
	);
	const baseKey = useMemo(
		() => (baseModel ? JSON.stringify(baseModel) : "null"),
		[baseModel],
	);
	const evalKey = useMemo(
		() => (evaluations ? JSON.stringify(evaluations) : "base"),
		[evaluations],
	);
	const modelKey = useMemo(() => `${baseKey}::${evalKey}`, [baseKey, evalKey]);
	return { activeModel, baseModel, modelKey, baseKey, evalKey };
}
