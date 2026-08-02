import {
	AmountResolutionError,
	validateAmountDescriptor,
} from "../simulation/amountResolution";
import type { IncomeDataSnapshot } from "../types/income";
import type { Posting } from "../types/model";
import type { ModelValidationIssue } from "../types/validation";
import { addIssue } from "../utils/validation";
import type { ValidationPaths } from "./types";

function hasInvalidDateRange(
	startDate: string,
	endDate: string | null,
): boolean {
	return endDate !== null && Date.parse(endDate) < Date.parse(startDate);
}

export function validatePostingAmounts(
	issues: ModelValidationIssue[],
	postings: Posting[],
	accountIds: Set<string>,
	paths: ValidationPaths,
	incomeData?: IncomeDataSnapshot,
) {
	const postingIds = new Set(postings.map((posting) => posting.id));
	const incomeSourceIds = incomeData
		? new Set(incomeData.incomeSources.map((source) => source.id))
		: undefined;
	const taxProfileIds = incomeData
		? new Set(incomeData.taxProfiles.map((profile) => profile.id))
		: undefined;
	const dependencies = new Map<string, readonly string[]>();

	postings.forEach((posting, index) => {
		try {
			dependencies.set(
				posting.id,
				validateAmountDescriptor(posting.amount, {
					accountIds,
					postingIds,
					incomeSourceIds,
					taxProfileIds,
				}),
			);
		} catch (error) {
			if (error instanceof AmountResolutionError || error instanceof Error) {
				addIssue(
					issues,
					"error",
					"posting.amount.invalid",
					error.message,
					paths.posting(index, "amount"),
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
				paths.posting(index, "amount"),
			);
		}
	});

	return dependencies;
}

export function validatePostingRoutes(
	issues: ModelValidationIssue[],
	postings: Posting[],
	accountIds: Set<string>,
	paths: ValidationPaths,
) {
	const enabledIncomePostings = postings.filter(
		(posting) => posting.enabled && posting.amount.resolver === "income",
	);
	if (enabledIncomePostings.length > 1) {
		addIssue(
			issues,
			"error",
			"posting.income.multiple",
			"Only one enabled income posting is supported for the household income pipeline.",
			paths.postings(),
		);
	}

	postings.forEach((posting, index) => {
		if (posting.amount.resolver === "income") {
			if (posting.sourceAccountId !== null) {
				addIssue(
					issues,
					"error",
					"posting.income.source.invalid",
					"Income postings cannot withdraw from an account.",
					paths.posting(index, "sourceAccountId"),
				);
			}
			if (!posting.destinations || posting.destinations.length === 0) {
				addIssue(
					issues,
					"error",
					"posting.income.destination.missing",
					"Income postings must deposit their remaining amount into at least one account.",
					paths.posting(index, "destinations"),
				);
			}
			if (posting.annualCap !== null) {
				addIssue(
					issues,
					"error",
					"posting.income.cap.invalid",
					"Income postings use resolver-level caps, not a posting annual cap.",
					paths.posting(index, "annualCap"),
				);
			}
		}

		if (
			posting.sourceAccountId !== null &&
			!accountIds.has(posting.sourceAccountId)
		) {
			addIssue(
				issues,
				"error",
				"posting.source.missing",
				`Posting source account '${posting.sourceAccountId}' does not exist.`,
				paths.posting(index, "sourceAccountId"),
			);
		}

		if (posting.destinations !== null) {
			const seenIds = new Set<string>();
			posting.destinations.forEach((destinationId) => {
				if (!accountIds.has(destinationId)) {
					addIssue(
						issues,
						"error",
						"posting.destination.missing",
						`Posting destination account '${destinationId}' does not exist.`,
						paths.posting(index, "destinations"),
					);
				}
				if (seenIds.has(destinationId)) {
					addIssue(
						issues,
						"error",
						"posting.destinations.duplicate",
						`Destination account '${destinationId}' appears more than once.`,
						paths.posting(index, "destinations"),
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
				paths.posting(index),
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
				paths.posting(index),
			);
		}
		if (hasInvalidDateRange(posting.startDate, posting.endDate)) {
			addIssue(
				issues,
				"error",
				"posting.schedule.invalid",
				"Posting endDate must be the same as or later than startDate.",
				paths.posting(index, "endDate"),
			);
		}
	});
}
