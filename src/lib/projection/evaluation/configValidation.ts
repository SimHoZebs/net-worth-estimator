import type { EvaluationType } from "../types/model";
import { validateFinancialIndependencePlan } from "./financialIndependence";
import { validateNetWorthThresholdConfig } from "./netWorthThreshold";
import { validatePostingFulfillmentConfig } from "./postingFulfillment";

export type EvaluationConfigValidator = (config: unknown) => unknown;

/**
 * Single validation entry for evaluation configs. Validation runs directly
 * against these functions; the execution registry in reference/ is not
 * involved.
 */
export const evaluationConfigValidators: Record<
	EvaluationType,
	EvaluationConfigValidator
> = {
	financialIndependence: validateFinancialIndependencePlan,
	netWorthThreshold: validateNetWorthThresholdConfig,
	postingFulfillment: validatePostingFulfillmentConfig,
};
