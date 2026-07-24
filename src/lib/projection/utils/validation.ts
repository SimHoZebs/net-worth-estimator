import type {
	ModelPath,
	ModelValidationIssue,
	ModelValidationSeverity,
} from "../types/validation";

export function addIssue(
	issues: ModelValidationIssue[],
	severity: ModelValidationSeverity,
	code: string,
	message: string,
	path: ModelPath,
) {
	issues.push({ severity, code, message, path });
}

export function rowPath(
	fileName: string,
	rowNumber?: number,
	field?: string,
): ModelPath {
	const path: Array<string | number> = [fileName];

	if (rowNumber !== undefined) {
		path.push(rowNumber);
	}

	if (field !== undefined) {
		path.push(field);
	}

	return path;
}
