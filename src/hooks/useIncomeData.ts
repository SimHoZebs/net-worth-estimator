import { useQuery } from "@tanstack/react-query";
import type { IncomeDataSource } from "@/lib/projection";

export const INCOME_DATA_QUERY_KEY = ["income-data"] as const;

export function useIncomeDataQuery(dataSource: IncomeDataSource) {
	return useQuery({
		queryKey: INCOME_DATA_QUERY_KEY,
		queryFn: () => dataSource.load(),
		staleTime: Infinity,
	});
}
