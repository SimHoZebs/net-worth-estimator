import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { resolveCurrentPosition } from "../api/generated/endpoints.ts";
import type { PositionRequestBody } from "../api/generated/model/index.ts";
import type { CurrentPositionResponse } from "../api/position.ts";
import { currentPositionQueryKey, serverQueryClient } from "./serverQuery.ts";
import { projectionModelKey } from "./projectionKeys.ts";
import {
	projectionStartDate,
	projectionStartDateFromRows,
} from "./projectionSource.ts";
import {
	balancesOptions,
	checkpointsOptions,
	schedulesOptions,
	transactionsOptions,
} from "./workspaceResources.ts";
import { useUserScope } from "./useUserScope.ts";
import type { FinancialModel } from "../api/contracts.ts";

export function useCurrentPosition({
	model,
	enabled = true,
}: {
	model?: FinancialModel | null;
	enabled?: boolean;
} = {}) {
	// Position is backend-owned historical replay: it keys on the saved
	// rows only, never on forecast evaluation preferences.
	const scope = useUserScope();
	const rowActive =
		model === undefined && enabled && scope.status === "ready";
	const client = serverQueryClient();
	const balances = useQuery(
		{ ...balancesOptions(scope), enabled: rowActive },
		client,
	);
	const checkpoints = useQuery(
		{ ...checkpointsOptions(scope), enabled: rowActive },
		client,
	);
	const schedules = useQuery(
		{ ...schedulesOptions(scope), enabled: rowActive },
		client,
	);
	const transactions = useQuery(
		{ ...transactionsOptions(scope), enabled: rowActive },
		client,
	);
	const overrideModel = model !== undefined ? model : null;
	const baseModel = scope.status === "ready" ? overrideModel : null;
	const hasOverride = model !== undefined;
	const rowDataReady =
		checkpoints.data !== undefined &&
		schedules.data !== undefined &&
		transactions.data !== undefined;
	const rowPending =
		model === undefined &&
		(checkpoints.isPending ||
			schedules.isPending ||
			transactions.isPending);
	const rowRevision = useMemo(() => {
		if (!rowActive) return "";
		const parts: string[] = [];
		const take = (revision: string | null | undefined, content: unknown, name: string) => {
			if (revision) parts.push(`${name}:${revision}`);
			else if (content !== undefined) parts.push(`${name}:${JSON.stringify(content)}`);
		};
		take(balances.data?.revision, balances.data?.accounts, "balances");
		take(checkpoints.data?.revision, checkpoints.data?.checkpoints, "checkpoints");
		take(schedules.data?.revision, schedules.data?.schedules, "schedules");
		take(transactions.data?.revision, transactions.data?.transactions, "transactions");
		return parts.join("|");
	}, [
		rowActive,
		balances.data,
		checkpoints.data,
		schedules.data,
		transactions.data,
	]);
	const baseKey = useMemo(
		() =>
			hasOverride
				? projectionModelKey(baseModel)
				: rowRevision || "pending",
		[hasOverride, baseModel, rowRevision],
	);
	const asOfDate = useMemo(() => {
		if (hasOverride) return baseModel ? projectionStartDate(baseModel) : "";
		if (!rowDataReady) return "";
		return projectionStartDateFromRows({
			checkpoints: checkpoints.data!.checkpoints,
			schedules: schedules.data!.schedules,
			transactions: transactions.data!.transactions,
		});
	}, [hasOverride, baseModel, rowDataReady, checkpoints.data, schedules.data, transactions.data]);
	const hasBase = hasOverride
		? baseModel !== null
		: rowDataReady;
	const rowsError = hasOverride
		? null
		: balances.error ?? checkpoints.error ?? schedules.error ?? transactions.error ?? null;
	const query = useQuery({
		queryKey: currentPositionQueryKey(baseKey, asOfDate),
		enabled: enabled && hasBase && !rowsError,
		queryFn: async ({ signal }) => {
			if (!hasBase) throw new Error("No financial model is available.");
			// Stored-only: the server resolves the saved model. The local
			// derivation supplies only the as-of date.
			const response = (
				await resolveCurrentPosition(
					{
						asOfDate,
					} as unknown as PositionRequestBody,
					{ signal },
				)
			).data as unknown as CurrentPositionResponse;
			const issues = response.issues?.filter(
				(issue) => issue.severity === "error",
			);
			if (response.error || issues?.length)
				throw new Error(
					response.error || issues?.map((issue) => issue.message).join(" "),
				);
			if (!response.result)
				throw new Error("The server returned no current position.");
			return response.result;
		},
	});
	return {
		data: query.data ?? null,
		status: !enabled
			? ("disabled" as const)
			: rowsError
				? ("error" as const)
				: !hasBase
					? rowPending
						? ("pending" as const)
						: ("error" as const)
					: query.status,
		error: rowsError
			? (rowsError.message ?? "Rows could not be loaded.")
			: !hasBase
				? rowPending
					? null
					: "No financial model is available."
				: (query.error?.message ?? null),
		retry: () => {
			if (rowsError || (!hasBase && model === undefined)) {
				void checkpoints.refetch();
				void schedules.refetch();
				void transactions.refetch();
				void balances.refetch();
				return;
			}
			void query.refetch();
		},
	};
}
