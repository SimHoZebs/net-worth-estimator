import type { EvaluationTables, FinancialModel } from "../api/contracts.ts";

/**
 * Cache identity for a saved model. The projection inputs are the full saved
 * model, so any model change starts a new calculation.
 */
export function projectionModelKey(model: FinancialModel | null): string {
	return model ? JSON.stringify(model) : "null";
}

/** Cache identity for request-local evaluation layering. */
export function projectionEvaluationKey(
	evaluations?: EvaluationTables,
): string {
	return evaluations ? JSON.stringify(evaluations) : "base";
}
