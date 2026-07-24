import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type DataSource,
	type FinancialModelDocument,
	toScenarioParseResult,
} from "@/lib/projection";

/** @deprecated Remove after all consumers migrate to FINANCIAL_MODEL_QUERY_KEY. */
export const SCENARIO_QUERY_KEY = ["scenario"] as const;

/** @deprecated Use useFinancialModelQuery; remove after legacy hook consumers migrate. */
export function useScenarioQuery(dataSource: DataSource) {
	return useQuery({
		queryKey: SCENARIO_QUERY_KEY,
		queryFn: async () => toScenarioParseResult(await dataSource.loadDocument()),
		staleTime: Infinity,
	});
}

/** @deprecated Use useFinancialModelMutation; remove after legacy hook consumers migrate. */
export function useScenarioMutation(dataSource: DataSource) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (pack: FinancialModelDocument) => {
			if (!dataSource.save) {
				throw new Error(
					"This data source does not support saving scenario edits.",
				);
			}
			const result = await dataSource.save.run(pack);
			if (
				!result.document ||
				result.issues.some((issue) => issue.severity === "error")
			) {
				throw new Error("The scenario contains validation errors.");
			}
			return toScenarioParseResult(result);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: SCENARIO_QUERY_KEY });
		},
	});
}

/** @deprecated Use useFinancialModelResetMutation; remove after legacy hook consumers migrate. */
export function useScenarioResetMutation(dataSource: DataSource) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () => {
			if (!dataSource.reset) {
				throw new Error(
					"This data source does not support resetting scenario edits.",
				);
			}
			const result = await dataSource.reset.run();
			if (
				!result.document ||
				result.issues.some((issue) => issue.severity === "error")
			) {
				throw new Error("The scenario contains validation errors.");
			}
			return toScenarioParseResult(result);
		},
		onSuccess: (result) => {
			queryClient.setQueryData(SCENARIO_QUERY_KEY, result);
		},
	});
}
