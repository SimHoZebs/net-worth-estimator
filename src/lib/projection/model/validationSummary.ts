import type { ModelValidationIssue } from "../types/validation";

/**
 * Presentation grouping over server-provided diagnostics. No validation
 * rules live here; the Go backend is the single source of truth.
 */
export function summarizeValidationIssues(issues: ModelValidationIssue[]) {
	const errors = issues.filter((issue) => issue.severity === "error");
	const warnings = issues.filter((issue) => issue.severity === "warning");
	return {
		issues,
		errors,
		warnings,
		isValid: errors.length === 0,
	};
}
