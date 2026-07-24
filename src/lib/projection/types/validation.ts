export type ModelPath = readonly (string | number)[];

export type ModelValidationSeverity = "error" | "warning";

export interface ModelValidationIssue {
	code: string;
	message: string;
	path: ModelPath;
	severity: ModelValidationSeverity;
}

/**
 * @deprecated Use ModelPath. Remove after downstream consumers migrate to the
 * canonical API and the compatibility window closes.
 */
export type ScenarioPath = ModelPath;
/**
 * @deprecated Use ModelValidationSeverity. Remove after downstream consumers
 * migrate to the canonical API and the compatibility window closes.
 */
export type ScenarioValidationSeverity = ModelValidationSeverity;
/**
 * @deprecated Use ModelValidationIssue. Remove after downstream consumers
 * migrate to the canonical API and the compatibility window closes.
 */
export type ScenarioValidationIssue = ModelValidationIssue;
