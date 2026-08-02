import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	DataSource,
	FinancialModelDocument,
	FinancialModelParseResult,
} from "@/lib/projection";
import { FinancialModelValidationError } from "@/lib/projection";

export const FINANCIAL_MODEL_QUERY_KEY = ["financial-model"] as const;

function requireSuccessfulMutation(
	result: FinancialModelParseResult,
): FinancialModelParseResult {
	if (
		!result.document ||
		result.issues.some((issue) => issue.severity === "error")
	) {
		throw new FinancialModelValidationError(result);
	}
	return result;
}

export function useFinancialModelQuery(dataSource: DataSource) {
	return useQuery({
		queryKey: FINANCIAL_MODEL_QUERY_KEY,
		queryFn: () => dataSource.loadDocument(),
		staleTime: Infinity,
	});
}

export function useFinancialModelMutation(dataSource: DataSource) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (document: FinancialModelDocument) => {
			if (!dataSource.save) {
				throw new Error(
					"This data source does not support saving model edits.",
				);
			}

			return dataSource.save.run(document).then(requireSuccessfulMutation);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: FINANCIAL_MODEL_QUERY_KEY });
		},
	});
}

export function useFinancialModelResetMutation(dataSource: DataSource) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: () => {
			if (!dataSource.reset) {
				throw new Error(
					"This data source does not support resetting model edits.",
				);
			}

			return dataSource.reset.run().then(requireSuccessfulMutation);
		},
		onSuccess: (result) => {
			queryClient.setQueryData(FINANCIAL_MODEL_QUERY_KEY, result);
		},
	});
}
