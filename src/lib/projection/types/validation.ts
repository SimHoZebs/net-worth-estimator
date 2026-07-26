export type ModelPath = readonly (string | number)[];

export type ModelValidationSeverity = "error" | "warning";

export interface ModelValidationIssue {
	code: string;
	message: string;
	path: ModelPath;
	severity: ModelValidationSeverity;
}
