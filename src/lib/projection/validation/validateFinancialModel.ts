import { isJsonValue } from "../evaluation/json";
import {
	EVALUATION_TYPE_ORDER,
	type EvaluationType,
	type FinancialModelDocument,
} from "../types/model";
import type { ModelValidationIssue } from "../types/validation";
import { addIssue } from "../utils/validation";
import { validateAccountBounds, validateAccountIdentity } from "./accounts";
import { validatePostingDependencies } from "./dependencies";
import {
	validateEvaluationInstanceIds,
	validateUniqueIds,
} from "./identifiers";
import { modelValidationPaths } from "./paths";
import { validatePostingAmounts, validatePostingRoutes } from "./postings";
import type { FinancialModelValidationOptions, ValidationPaths } from "./types";

export function validateFinancialModel(
	document: FinancialModelDocument,
	options: FinancialModelValidationOptions = {},
): ModelValidationIssue[] {
	const issues: ModelValidationIssue[] = [];
	const paths = options.paths ?? modelValidationPaths;
	const accountIds = new Set(document.accounts.map((account) => account.id));
	const postingIds = new Set(document.postings.map((posting) => posting.id));

	validateUniqueIds(issues, document.accounts, "account.id", paths.account);
	validateUniqueIds(issues, document.postings, "posting.id", paths.posting);
	validateEvaluationInstanceIds(issues, document, paths);
	if (options.evaluationRegistry) {
		for (const type of EVALUATION_TYPE_ORDER) {
			const definition = options.evaluationRegistry.get(type);
			for (const [index, evaluation] of document.evaluations[type].entries()) {
				if (!definition) {
					addEvaluationIssue(
						issues,
						paths,
						type,
						index,
						"No evaluator is registered for this evaluation type.",
					);
					continue;
				}
				try {
					const normalized = definition.validateConfig(evaluation.config);
					if (!isJsonValue(normalized)) {
						throw new Error("Evaluation config must be JSON-serializable.");
					}
				} catch (error) {
					addEvaluationIssue(
						issues,
						paths,
						type,
						index,
						error instanceof Error
							? error.message
							: "Evaluation config is invalid.",
					);
				}
			}
		}
	}
	validateAccountIdentity(issues, document.accounts, postingIds, paths);

	const dependencies = validatePostingAmounts(
		issues,
		document.postings,
		accountIds,
		paths,
		options.incomeData,
	);
	validatePostingDependencies(issues, document.postings, dependencies, paths);
	validatePostingRoutes(issues, document.postings, accountIds, paths);
	validateAccountBounds(issues, document.accounts, paths);

	return issues;
}

function addEvaluationIssue(
	issues: ModelValidationIssue[],
	paths: ValidationPaths,
	type: EvaluationType,
	index: number,
	message: string,
): void {
	addIssue(
		issues,
		"error",
		"evaluation.config.invalid",
		message,
		paths.evaluation(type, index),
	);
}

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
