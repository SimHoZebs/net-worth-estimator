import { useQuery } from "@tanstack/react-query";
import { fetchServerStatus } from "@/lib/projection/sources/http/httpFinancialModelRepository";

export const SERVER_STATUS_QUERY_KEY = ["server-status"] as const;

export function useServerStatusQuery() {
	return useQuery({
		queryKey: SERVER_STATUS_QUERY_KEY,
		queryFn: () => fetchServerStatus(),
		staleTime: Infinity,
		retry: false,
	});
}
