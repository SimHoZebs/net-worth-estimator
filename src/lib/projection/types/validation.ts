export type ScenarioPath = readonly (string | number)[];

export type ScenarioValidationSeverity = "error" | "warning";

export interface ScenarioValidationIssue {
	code: string;
	message: string;
	path: ScenarioPath;
	severity: ScenarioValidationSeverity;
}
