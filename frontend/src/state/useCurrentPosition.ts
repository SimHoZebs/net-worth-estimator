import { useQuery } from "@tanstack/react-query";
import { resolveCurrentPosition } from "../api/generated/endpoints.ts";
import type { PositionRequestBody } from "../api/generated/model/index.ts";
import type { CurrentPositionResponse } from "../api/position.ts";
import { currentPositionQueryKey } from "./serverQuery.ts";
import {
	useProjectionDocument,
	type ProjectionDocumentOptions,
} from "./useProjectionDocument.ts";
import { projectionStartDate } from "./projectionStartDate.ts";

export function useCurrentPosition({
	enabled = true,
	...options
}: ProjectionDocumentOptions & {
	enabled?: boolean;
} = {}) {
	const { activeDocument, documentKey } = useProjectionDocument(options);
	const asOfDate = activeDocument ? projectionStartDate(activeDocument) : "";
	const query = useQuery({
		queryKey: currentPositionQueryKey(documentKey, asOfDate),
		enabled: enabled && activeDocument !== null,
		queryFn: async ({ signal }) => {
			if (!activeDocument) throw new Error("No financial model is available.");
			// Stored-only: the server resolves the saved model. The local
			// document supplies only the as-of date.
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
			: !activeDocument
				? ("error" as const)
				: query.status,
		error: !activeDocument
			? "No financial model is available."
			: (query.error?.message ?? null),
		retry: () => {
			void query.refetch();
		},
	};
}
