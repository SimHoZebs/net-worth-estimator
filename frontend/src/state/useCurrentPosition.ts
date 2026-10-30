import { useQuery } from "@tanstack/react-query";
import { resolveCurrentPosition } from "../api/generated/endpoints.ts";
import type { PositionRequestBody } from "../api/generated/model/index.ts";
import type { CurrentPositionResponse } from "../api/position.ts";
import { currentPositionQueryKey } from "./serverQuery.ts";
import {
	useProjectionModel,
	type ProjectionModelOptions,
} from "./useProjectionModel.ts";
import { projectionStartDate } from "./projectionStartDate.ts";

export function useCurrentPosition({
	enabled = true,
	...options
}: ProjectionModelOptions & {
	enabled?: boolean;
} = {}) {
	const { activeModel, modelKey } = useProjectionModel(options);
	const asOfDate = activeModel ? projectionStartDate(activeModel) : "";
	const query = useQuery({
		queryKey: currentPositionQueryKey(modelKey, asOfDate),
		enabled: enabled && activeModel !== null,
		queryFn: async ({ signal }) => {
			if (!activeModel) throw new Error("No financial model is available.");
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
			: !activeModel
				? ("error" as const)
				: query.status,
		error: !activeModel
			? "No financial model is available."
			: (query.error?.message ?? null),
		retry: () => {
			void query.refetch();
		},
	};
}
