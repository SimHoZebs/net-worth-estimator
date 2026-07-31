import {
	AmountResolutionError,
	validateAmountDescriptor,
} from "../../simulation/amountResolution";
import type { FinancialModelDocument, Posting } from "../../types/model";
import {
	CSV_BEHAVIOR_FILE_NAMES,
	CSV_MODEL_FILE_NAMES,
	EVALUATION_TYPE_ORDER,
} from "../../types/model";
import type { ModelValidationIssue } from "../../types/validation";
import { addIssue, rowPath } from "../../utils/validation";

function hasInvalidDateRange(
	startDate: string,
	endDate: string | null,
): boolean {
	return endDate !== null && Date.parse(endDate) < Date.parse(startDate);
}

function validateUniqueIds(
	issues: ModelValidationIssue[],
	fileName: string,
	codePrefix: string,
	rows: Array<{ id: string }>,
	idColumn = "id",
) {
	const firstSeenRowById = new Map<string, number>();

	rows.forEach((row, index) => {
		const rowNumber = index + 2;
		const firstSeenRow = firstSeenRowById.get(row.id);

		if (firstSeenRow !== undefined) {
			addIssue(
				issues,
				"error",
				`${codePrefix}.duplicate`,
				`ID '${row.id}' is duplicated. First seen on row ${firstSeenRow}.`,
				rowPath(fileName, rowNumber, idColumn),
			);
			return;
		}

		firstSeenRowById.set(row.id, rowNumber);
	});
}

function validateEvaluationInstanceIds(
	issues: ModelValidationIssue[],
	document: FinancialModelDocument,
) {
	const seenInstanceIds = new Set<string>();

	for (const type of EVALUATION_TYPE_ORDER) {
		for (const evaluation of document.evaluations[type]) {
			if (seenInstanceIds.has(evaluation.instanceId)) {
				addIssue(
					issues,
					"error",
					"evaluation.instanceId.duplicate",
					`ID '${evaluation.instanceId}' is duplicated across behavior configuration files.`,
					[CSV_BEHAVIOR_FILE_NAMES[type]],
				);
				continue;
			}

			seenInstanceIds.add(evaluation.instanceId);
		}
	}
}

function validatePostingAmounts(
	issues: ModelValidationIssue[],
	postings: Posting[],
	accountIds: Set<string>,
) {
	const postingIds = new Set(postings.map((posting) => posting.id));
	const dependencies = new Map<string, readonly string[]>();

	postings.forEach((posting, index) => {
		const rowNumber = index + 2;
		const fileName = CSV_MODEL_FILE_NAMES.postings;

		try {
			dependencies.set(
				posting.id,
				validateAmountDescriptor(posting.amount, { accountIds, postingIds }),
			);
		} catch (err) {
			if (err instanceof AmountResolutionError || err instanceof Error) {
				addIssue(
					issues,
					"error",
					"posting.amount.invalid",
					err.message,
					rowPath(fileName, rowNumber, "amount"),
				);
			}
			return;
		}
		if (
			posting.amount.resolver !== "expression" &&
			(posting.annualRate !== 0 ||
				posting.annualGrowthRate !== 0 ||
				posting.volatility !== 0)
		) {
			addIssue(
				issues,
				"error",
				"posting.amount.non_expression_rates",
				"Non-expression amount resolvers require annualRate, annualGrowthRate, and volatility to be zero.",
				rowPath(fileName, rowNumber, "amount"),
			);
		}
	});

	const visiting = new Set<string>();
	const visited = new Set<string>();
	const cyclic = new Set<string>();
	function visit(id: string): boolean {
		if (visiting.has(id)) return true;
		if (visited.has(id)) return cyclic.has(id);
		visiting.add(id);
		let hasCycle = false;
		for (const dependency of dependencies.get(id) ?? []) {
			if (dependency === id || visit(dependency)) hasCycle = true;
		}
		visiting.delete(id);
		visited.add(id);
		if (hasCycle) cyclic.add(id);
		return hasCycle;
	}
	postings.forEach((posting, index) => {
		if (!visit(posting.id)) return;
		addIssue(
			issues,
			"error",
			"posting.amount.circular",
			`Amount resolution for '${posting.id}' creates a circular posting dependency.`,
			rowPath(CSV_MODEL_FILE_NAMES.postings, index + 2, "amount"),
		);
	});
}

function validatePostings(
	issues: ModelValidationIssue[],
	postings: Posting[],
	accountIds: Set<string>,
) {
	postings.forEach((posting, index) => {
		const rowNumber = index + 2;

		if (
			posting.sourceAccountId !== null &&
			!accountIds.has(posting.sourceAccountId)
		) {
			addIssue(
				issues,
				"error",
				"posting.source.missing",
				`Posting source account '${posting.sourceAccountId}' does not exist.`,
				rowPath(CSV_MODEL_FILE_NAMES.postings, rowNumber, "sourceAccountId"),
			);
		}

		if (posting.destinations !== null) {
			const seenIds = new Set<string>();

			posting.destinations.forEach((destinationId, _destIndex) => {
				if (!accountIds.has(destinationId)) {
					addIssue(
						issues,
						"error",
						"posting.destination.missing",
						`Posting destination account '${destinationId}' does not exist.`,
						rowPath(CSV_MODEL_FILE_NAMES.postings, rowNumber, "destinations"),
					);
				}

				if (seenIds.has(destinationId)) {
					addIssue(
						issues,
						"error",
						"posting.destinations.duplicate",
						`Destination account '${destinationId}' appears more than once.`,
						rowPath(CSV_MODEL_FILE_NAMES.postings, rowNumber, "destinations"),
					);
				}

				seenIds.add(destinationId);
			});
		}

		if (posting.sourceAccountId === null && posting.destinations === null) {
			addIssue(
				issues,
				"error",
				"posting.accounts.empty",
				"Postings must set sourceAccountId, destinations, or both.",
				rowPath(CSV_MODEL_FILE_NAMES.postings, rowNumber),
			);
		}

		if (
			posting.sourceAccountId &&
			posting.destinations?.includes(posting.sourceAccountId)
		) {
			addIssue(
				issues,
				"error",
				"posting.accounts.same",
				"Posting sourceAccountId must not appear in destinations.",
				rowPath(CSV_MODEL_FILE_NAMES.postings, rowNumber),
			);
		}

		if (hasInvalidDateRange(posting.startDate, posting.endDate)) {
			addIssue(
				issues,
				"error",
				"posting.schedule.invalid",
				"Posting endDate must be the same as or later than startDate.",
				rowPath(CSV_MODEL_FILE_NAMES.postings, rowNumber, "endDate"),
			);
		}
	});
}

export function validateCsvFinancialModel(
	document: FinancialModelDocument,
): ModelValidationIssue[] {
	const issues: ModelValidationIssue[] = [];
	const accountIds = new Set(document.accounts.map((account) => account.id));
	const postingIds = new Set(document.postings.map((posting) => posting.id));

	validateUniqueIds(
		issues,
		CSV_MODEL_FILE_NAMES.accounts,
		"account.id",
		document.accounts,
	);
	validateUniqueIds(
		issues,
		CSV_MODEL_FILE_NAMES.postings,
		"posting.id",
		document.postings,
	);
	validateEvaluationInstanceIds(issues, document);

	document.accounts.forEach((account, index) => {
		if (postingIds.has(account.id)) {
			addIssue(
				issues,
				"error",
				"account.id.collision",
				`Account ID '${account.id}' collides with a posting ID. IDs must be unique across accounts and postings.`,
				rowPath(CSV_MODEL_FILE_NAMES.accounts, index + 2, "id"),
			);
		}

		if (account.enabled && account.color === null) {
			addIssue(
				issues,
				"warning",
				"account.color.missing",
				`Enabled account '${account.id}' has no chart color. Charts will use a neutral fallback until a color is provided.`,
				rowPath(CSV_MODEL_FILE_NAMES.accounts, index + 2, "color"),
			);
		}
	});

	validatePostingAmounts(issues, document.postings, accountIds);
	validatePostings(issues, document.postings, accountIds);

	document.accounts.forEach((account, index) => {
		if (account.minBalance > account.maxBalance) {
			addIssue(
				issues,
				"error",
				"account.balance.bounds",
				`minBalance (${account.minBalance}) must not exceed maxBalance (${account.maxBalance}).`,
				rowPath(CSV_MODEL_FILE_NAMES.accounts, index + 2),
			);
		}
	});

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
