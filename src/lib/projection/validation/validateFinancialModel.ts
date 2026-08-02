import type { FinancialModelDocument } from "../types/model";
import type { ModelValidationIssue } from "../types/validation";
import { validateAccountBounds, validateAccountIdentity } from "./accounts";
import { validatePostingDependencies } from "./dependencies";
import {
	validateEvaluationInstanceIds,
	validateUniqueIds,
} from "./identifiers";
import { modelValidationPaths } from "./paths";
import { validatePostingAmounts, validatePostingRoutes } from "./postings";
import type { FinancialModelValidationOptions } from "./types";

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
