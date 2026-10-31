import { useQuery } from "@tanstack/react-query";
import { resolveCurrentPosition } from "../api/generated/endpoints.ts";
import type { PositionRequestBody } from "../api/generated/model/index.ts";
import type { CurrentPositionResponse } from "../api/position.ts";
import { currentPositionQueryKey } from "./serverQuery.ts";
import { useProjectionModel } from "./useProjectionModel.ts";
import { projectionStartDate } from "./projectionStartDate.ts";
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
	const { baseModel, baseKey } = useProjectionModel({ model });
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
				? ("error" as const)
				: query.status,
		error: !baseModel
			? "No financial model is available."
			: (query.error?.message ?? null),
		retry: () => {
			void query.refetch();
		},
	};
}
