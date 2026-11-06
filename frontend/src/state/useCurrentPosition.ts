import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { resolveCurrentPosition } from "../api/generated/endpoints.ts";
import type { PositionRequestBody } from "../api/generated/model/index.ts";
import type { CurrentPositionResponse } from "../api/position.ts";
import { currentPositionQueryKey } from "./serverQuery.ts";
import { projectionModelKey } from "./projectionKeys.ts";
import { projectionStartDate } from "./projectionStartDate.ts";
import { useServerModel } from "./workspaceResources.ts";
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
	// model only, never on forecast evaluation preferences.
	const scope = useUserScope();
	const modelQuery = useServerModel({
		enabled: model === undefined && enabled && scope.status === "ready",
	});
	const storeModel = modelQuery.data?.model ?? null;
	const saved = model !== undefined ? model : storeModel;
	const baseModel = scope.status === "ready" ? (saved ?? null) : null;
	const modelPending = model === undefined && modelQuery.isPending;
	const baseKey = useMemo(() => projectionModelKey(baseModel), [baseModel]);
	const asOfDate = baseModel ? projectionStartDate(baseModel) : "";
	const query = useQuery({
		queryKey: currentPositionQueryKey(baseKey, asOfDate),
		enabled: enabled && baseModel !== null,
		queryFn: async ({ signal }) => {
			if (!baseModel) throw new Error("No financial model is available.");
			// Stored-only: the server resolves the saved model. The local
			// model supplies only the as-of date.
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
			: !baseModel
				? modelPending
					? ("pending" as const)
					: ("error" as const)
				: query.status,
		error: !baseModel
			? modelPending
				? null
				: "No financial model is available."
			: (query.error?.message ?? null),
		retry: () => {
			if (!baseModel && model === undefined) {
				void modelQuery.refetch();
				return;
			}
			void query.refetch();
		},
	};
}
