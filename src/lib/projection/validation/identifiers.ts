import type { FinancialModelDocument } from "../types/model";
import type { ModelValidationIssue } from "../types/validation";
import { addIssue } from "../utils/validation";
import { evaluationTypes } from "./paths";
import type { ValidationPaths } from "./types";

export function validateUniqueIds(
	issues: ModelValidationIssue[],
	rows: Array<{ id: string }>,
	codePrefix: string,
	path: (index: number, field?: string) => readonly (string | number)[],
) {
	const firstSeenRowById = new Map<string, number>();
	rows.forEach((row, index) => {
		const firstSeenRow = firstSeenRowById.get(row.id);
		if (firstSeenRow !== undefined) {
			addIssue(
				issues,
				"error",
				`${codePrefix}.duplicate`,
				`ID '${row.id}' is duplicated. First seen on row ${firstSeenRow}.`,
				path(index, "id"),
			);
			return;
		}
		firstSeenRowById.set(row.id, index + 2);
	});
}

export function validateEvaluationInstanceIds(
	issues: ModelValidationIssue[],
	document: FinancialModelDocument,
	paths: ValidationPaths,
) {
	const seenInstanceIds = new Set<string>();
	for (const type of evaluationTypes()) {
		for (const evaluation of document.evaluations[type]) {
			if (seenInstanceIds.has(evaluation.instanceId)) {
				addIssue(
					issues,
					"error",
					"evaluation.instanceId.duplicate",
					`ID '${evaluation.instanceId}' is duplicated across behavior configuration files.`,
					paths.evaluation(type),
				);
				continue;
			}
			seenInstanceIds.add(evaluation.instanceId);
		}
	}
}
