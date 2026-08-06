import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	FinancialModelDocument,
	FinancialModelParseResult,
	FinancialModelRepository,
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

export function useFinancialModelQuery(repository: FinancialModelRepository) {
	return useQuery({
		queryKey: FINANCIAL_MODEL_QUERY_KEY,
		queryFn: () => repository.loadDocument(),
		staleTime: Infinity,
	});
}

export function useFinancialModelMutation(
	repository: FinancialModelRepository,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (document: FinancialModelDocument) => {
			if (!repository.save) {
				throw new Error(
					"This data source does not support saving model edits.",
				);
			}

			return repository.save.run(document).then(requireSuccessfulMutation);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: FINANCIAL_MODEL_QUERY_KEY });
		},
	});
}

export function useFinancialModelResetMutation(
	repository: FinancialModelRepository,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: () => {
			if (!repository.reset) {
				throw new Error(
					"This data source does not support resetting model edits.",
				);
			}

			return repository.reset.run().then(requireSuccessfulMutation);
		},
		onSuccess: (result) => {
			queryClient.setQueryData(FINANCIAL_MODEL_QUERY_KEY, result);
		},
	});
}
