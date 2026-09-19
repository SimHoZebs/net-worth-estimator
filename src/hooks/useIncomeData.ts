import type { IncomeDataSource } from "@/lib/projection";
import { useImmutableQuery } from "./types";

export const INCOME_DATA_QUERY_KEY = ["income-data"] as const;

export function useIncomeDataQuery(dataSource: IncomeDataSource) {
	return useImmutableQuery(INCOME_DATA_QUERY_KEY, () => dataSource.load());
}
