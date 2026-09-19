import { fetchServerStatus } from "@/lib/projection/sources/http/httpFinancialModelRepository";
import { useImmutableQuery } from "./types";

export const SERVER_STATUS_QUERY_KEY = ["server-status"] as const;

export function useServerStatusQuery() {
	return useImmutableQuery(SERVER_STATUS_QUERY_KEY, () => fetchServerStatus(), {
		retry: false,
	});
}
