import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { FlowGraph } from "../api/flows.ts";
import { requestFlowGraph } from "../api/flows.ts";
import type { FlowWindow } from "../domain/flowWindow.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { projectionStartDateFromRows } from "./projectionSource.ts";
import {
	balancesOptions,
	checkpointsOptions,
	evalSummaryOptions,
	schedulesOptions,
	transactionsOptions,
} from "./workspaceResources.ts";
import { normalizedEvaluations } from "./projectionSource.ts";
import { useUserScope } from "./useUserScope.ts";

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
	const active = scope.status === "ready";
	const client = serverQueryClient();
	const balances = useQuery({ ...balancesOptions(scope), enabled: active }, client);
	const checkpoints = useQuery({ ...checkpointsOptions(scope), enabled: active }, client);
	const schedules = useQuery({ ...schedulesOptions(scope), enabled: active }, client);
	const transactions = useQuery({ ...transactionsOptions(scope), enabled: active }, client);
	const summary = useQuery({ ...evalSummaryOptions(scope), enabled: active }, client);
	const rowsReady =
		active &&
		balances.data !== undefined &&
		checkpoints.data !== undefined &&
		schedules.data !== undefined &&
		transactions.data !== undefined &&
		summary.data !== undefined;
	const baseKey = useMemo(() => {
		if (!rowsReady) return "pending";
		const parts: string[] = [];
		const take = (revision: string | null | undefined, content: unknown, name: string) => {
			if (revision) parts.push(`${name}:${revision}`);
			else parts.push(`${name}:${JSON.stringify(content)}`);
		};
		take(balances.data!.revision, balances.data!.accounts, "balances");
		take(checkpoints.data!.revision, checkpoints.data!.checkpoints, "checkpoints");
		take(schedules.data!.revision, schedules.data!.schedules, "schedules");
		take(transactions.data!.revision, transactions.data!.transactions, "transactions");
		take(summary.data!.revision, summary.data!.evaluations, "evaluations");
		return parts.join("|");
	}, [rowsReady, balances.data, checkpoints.data, schedules.data, transactions.data, summary.data]);
	const startDate = window?.startDate;
	const endDate = window?.endDate;
	return useQuery<FlowGraph, Error>(
		{
			queryKey: flowGraphQueryKey(scope.key, baseKey, {
				startDate: startDate ?? "",
				endDate: endDate ?? "",
			}),
			enabled:
				rowsReady &&
				startDate !== undefined &&
				endDate !== undefined &&
				startDate !== "" &&
				endDate !== "" &&
				startDate <= endDate,
			queryFn: async ({ signal }) => {
				if (!rowsReady)
					throw new Error(
						"No server financial model is available for money flows. Load or replace a model before calculating.",
					);
				const start = projectionStartDateFromRows({
					checkpoints: checkpoints.data!.checkpoints,
					schedules: schedules.data!.schedules,
					transactions: transactions.data!.transactions,
				});
				return requestFlowGraph(
					{
						settings: {
							fallbackProjectionStartDate: start,
							horizonYears: flowHorizonYears(start, endDate!),
							evaluations: normalizedEvaluations(summary.data!.evaluations),
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
