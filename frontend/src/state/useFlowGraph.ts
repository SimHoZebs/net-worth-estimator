import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { FlowGraph } from "../api/flows.ts";
import { requestFlowGraph } from "../api/flows.ts";
import { projectionModelKey } from "./projectionKeys.ts";
import { projectionStartDate } from "./projectionStartDate.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { useServerModel } from "./workspaceResources.ts";
import { useUserScope } from "./useUserScope.ts";

export interface FlowWindow {
	startDate: string;
	endDate: string;
}

/** Horizon years covering the window end from the projection start. The
 * range selects response dates; the horizon must still reach the window
 * end or its events never simulate. */
export function flowHorizonYears(start: string, end: string): number {
	if (end <= start) return 1;
	const startYear = Number(start.slice(0, 4));
	const endYear = Number(end.slice(0, 4));
	if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return 1;
	return Math.max(1, endYear - startYear + 1);
}

function flowGraphQueryKey(
	scopeKey: string,
	modelKey: string,
	window: FlowWindow,
): readonly unknown[] {
	return ["flow-graph", scopeKey, modelKey, window.startDate, window.endDate];
}

/** Time-bounded money-flow graph for the saved model. Date-filter changes
 * move the query key and refetch; the account focus stays client-side so
 * totals keep describing the whole window. Draft keystrokes never issue
 * backend queries: callers pass committed window state. */
export function useFlowGraph(window: FlowWindow | null) {
	const scope = useUserScope();
	const storeModel =
		useServerModel({ enabled: scope.status === "ready" }).data?.model ?? null;
	const baseModel = scope.status === "ready" ? storeModel : null;
	const baseKey = useMemo(() => projectionModelKey(baseModel), [baseModel]);
	const startDate = window?.startDate;
	const endDate = window?.endDate;
	return useQuery<FlowGraph, Error>(
		{
			queryKey: flowGraphQueryKey(scope.key, baseKey, {
				startDate: startDate ?? "",
				endDate: endDate ?? "",
			}),
			enabled:
				scope.status === "ready" &&
				baseModel !== null &&
				startDate !== undefined &&
				endDate !== undefined &&
				startDate !== "" &&
				endDate !== "" &&
				startDate <= endDate,
			queryFn: async ({ signal }) => {
				const model = baseModel;
				if (!model)
					throw new Error(
						"No server financial model is available for money flows. Load or replace a model before calculating.",
					);
				const start = projectionStartDate(model);
				return requestFlowGraph(
					{
						settings: {
							fallbackProjectionStartDate: start,
							horizonYears: flowHorizonYears(start, endDate!),
							evaluations: model.evaluations,
						},
						range: { startDate, endDate },
					},
					{ signal },
				);
			},
			staleTime: 30_000,
			retry: false,
		},
		serverQueryClient(),
	);
}
