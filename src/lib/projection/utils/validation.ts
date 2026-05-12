import type {
	ScenarioPath,
	ScenarioValidationIssue,
	ScenarioValidationSeverity,
} from "../types/validation";

export function addIssue(
	issues: ScenarioValidationIssue[],
	severity: ScenarioValidationSeverity,
	code: string,
	message: string,
	path: ScenarioPath,
) {
	issues.push({ severity, code, message, path });
}

export function rowPath(
	fileName: string,
	rowNumber?: number,
	field?: string,
): ScenarioPath {
	const path: Array<string | number> = [fileName];

	if (rowNumber !== undefined) {
		path.push(rowNumber);
	}

	if (field !== undefined) {
		path.push(field);
	}

	return path;
}
