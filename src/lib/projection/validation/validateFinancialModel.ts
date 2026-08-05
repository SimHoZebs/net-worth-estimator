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

	const checkpointKeys = new Set<string>();
	document.checkpoints.forEach((checkpoint, index) => {
		if (!accountIds.has(checkpoint.AccountId)) {
			addIssue(
				issues,
				"error",
				"checkpoint.account.missing",
				`Checkpoint account '${checkpoint.AccountId}' does not exist.`,
				paths.checkpoint(index, "AccountId"),
			);
		}

		const key = `${checkpoint.AccountId}\u0000${checkpoint.Date}`;
		if (checkpointKeys.has(key)) {
			addIssue(
				issues,
				"error",
				"checkpoint.account-date.duplicate",
				`Account '${checkpoint.AccountId}' has more than one checkpoint on ${checkpoint.Date}.`,
				paths.checkpoint(index),
			);
		}
		checkpointKeys.add(key);
	});

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
