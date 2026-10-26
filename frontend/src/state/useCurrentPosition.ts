import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiRequestOptions } from "../api/client.ts";
import type {
	CurrentPositionRequest,
	CurrentPositionResponse,
} from "../api/position.ts";
import { defaultScopedApiClient } from "../api/scopedClients.ts";
import { getResourceScope } from "../auth/resourceScope.ts";
import {
	useProjectionDocument,
	type ProjectionDocumentOptions,
} from "./useProjectionDocument.ts";
import { projectionStartDate } from "./projectionStartDate.ts";

interface PositionClient {
	getCurrentPosition(
		request: CurrentPositionRequest,
		options?: ApiRequestOptions,
	): Promise<Error | CurrentPositionResponse>;
}

export function useCurrentPosition({
	client,
	enabled = true,
	...options
}: ProjectionDocumentOptions & {
	client?: PositionClient;
	enabled?: boolean;
} = {}) {
	const api = useMemo(() => client ?? defaultScopedApiClient(), [client]);
	const { activeDocument, documentKey } = useProjectionDocument(options);
	const asOfDate = activeDocument ? projectionStartDate(activeDocument) : "";
	const scope = getResourceScope();
	const query = useQuery({
		queryKey: ["current-position", scope.key, documentKey, asOfDate],
		enabled: enabled && activeDocument !== null,
		queryFn: async ({ signal }) => {
			if (!activeDocument) throw new Error("No financial model is available.");
			const response = await api.getCurrentPosition(
				{ document: activeDocument, asOfDate },
				{ signal },
			);
			if (response instanceof Error) throw response;
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
