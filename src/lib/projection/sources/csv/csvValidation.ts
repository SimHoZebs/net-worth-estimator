import { ParseError, parseArithmetic } from "../../engine/arithmetic";
import type { Posting, ScenarioPack } from "../../types/scenario";
import { CSV_SCENARIO_FILE_NAMES } from "../../types/scenario";
import type { ScenarioValidationIssue } from "../../types/validation";
import { addIssue, rowPath } from "../../utils/validation";

function hasInvalidDateRange(
	startDate: string,
	endDate: string | null,
): boolean {
	return endDate !== null && Date.parse(endDate) < Date.parse(startDate);
}

function extractIdentifiers(arithmetic: string): string[] {
	const ids: string[] = [];
	const regex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(arithmetic)) !== null) {
		if (match[0] !== "abs" && match[0] !== "rate") {
			ids.push(match[0]);
		}
	}
	return ids;
}

function validateUniqueIds(
	issues: ScenarioValidationIssue[],
	fileName: string,
	codePrefix: string,
	rows: Array<{ id: string }>,
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
				rowPath(fileName, rowNumber, "id"),
			);
			return;
		}

		firstSeenRowById.set(row.id, rowNumber);
	});
}

function validatePostingArithmetic(
	issues: ScenarioValidationIssue[],
	postings: Posting[],
	accountIds: Set<string>,
) {
	const allowedIds = new Set([
		...postings.map((p) => p.id),
		...accountIds,
		"rate",
	]);

	const postingById = new Map(postings.map((posting) => [posting.id, posting]));

	postings.forEach((posting, index) => {
		const rowNumber = index + 2;
		const fileName = CSV_SCENARIO_FILE_NAMES.postings;

		try {
			parseArithmetic(posting.arithmetic);
		} catch (err) {
			if (err instanceof ParseError) {
				addIssue(
					issues,
					"error",
					"posting.arithmetic.parse",
					`Could not parse arithmetic expression: ${err.message}`,
					rowPath(fileName, rowNumber, "arithmetic"),
				);
			}
			return;
		}

		const identifiers = extractIdentifiers(posting.arithmetic);

		identifiers.forEach((ident) => {
			if (!allowedIds.has(ident)) {
				addIssue(
					issues,
					"error",
					"posting.arithmetic.unknown_identifier",
					`Identifier '${ident}' is not a posting or account ID.`,
					rowPath(fileName, rowNumber, "arithmetic"),
				);
			}
		});

		const postingsRefd = identifiers.filter(
			(ident) => !accountIds.has(ident) && postingById.has(ident),
		);

		if (postingsRefd.includes(posting.id)) {
			addIssue(
				issues,
				"error",
				"posting.arithmetic.self_reference",
				`Arithmetic expression references the posting's own ID '${posting.id}'.`,
				rowPath(fileName, rowNumber, "arithmetic"),
			);
			return;
		}

		for (const refId of postingsRefd) {
			const visitedIds = new Set<string>([posting.id]);
			let currentId: string | null = refId;

			while (currentId !== null) {
				if (visitedIds.has(currentId)) {
					addIssue(
						issues,
						"error",
						"posting.arithmetic.circular",
						`Arithmetic expression for '${posting.id}' creates a circular dependency chain.`,
						rowPath(fileName, rowNumber, "arithmetic"),
					);
					return;
				}

				visitedIds.add(currentId);

				const refPosting = postingById.get(currentId);
				if (!refPosting) {
					break;
				}

				const refIdentifiers = extractIdentifiers(refPosting.arithmetic);
				currentId = null;

				for (const nextId of refIdentifiers) {
					if (!accountIds.has(nextId) && postingById.has(nextId)) {
						currentId = nextId;
						break;
					}
				}
			}
		}
	});
}

function validatePostings(
	issues: ScenarioValidationIssue[],
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
				rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber, "sourceAccountId"),
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
						rowPath(
							CSV_SCENARIO_FILE_NAMES.postings,
							rowNumber,
							"destinations",
						),
					);
				}

				if (seenIds.has(destinationId)) {
					addIssue(
						issues,
						"error",
						"posting.destinations.duplicate",
						`Destination account '${destinationId}' appears more than once.`,
						rowPath(
							CSV_SCENARIO_FILE_NAMES.postings,
							rowNumber,
							"destinations",
						),
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
				rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber),
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
				rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber),
			);
		}

		if (hasInvalidDateRange(posting.startDate, posting.endDate)) {
			addIssue(
				issues,
				"error",
				"posting.schedule.invalid",
				"Posting endDate must be the same as or later than startDate.",
				rowPath(CSV_SCENARIO_FILE_NAMES.postings, rowNumber, "endDate"),
			);
		}
	});
}

export function validateCsvScenarioPack(
	pack: ScenarioPack,
): ScenarioValidationIssue[] {
	const issues: ScenarioValidationIssue[] = [];
	const accountIds = new Set(pack.accounts.map((account) => account.id));
	const postingIds = new Set(pack.postings.map((posting) => posting.id));

	validateUniqueIds(
		issues,
		CSV_SCENARIO_FILE_NAMES.accounts,
		"account.id",
		pack.accounts,
	);
	validateUniqueIds(
		issues,
		CSV_SCENARIO_FILE_NAMES.postings,
		"posting.id",
		pack.postings,
	);

	pack.accounts.forEach((account, index) => {
		if (postingIds.has(account.id)) {
			addIssue(
				issues,
				"error",
				"account.id.collision",
				`Account ID '${account.id}' collides with a posting ID. IDs must be unique across accounts and postings.`,
				rowPath(CSV_SCENARIO_FILE_NAMES.accounts, index + 2, "id"),
			);
		}
	});

	pack.checkpoints.forEach((checkpoint, index) => {
		if (!accountIds.has(checkpoint.AccountId)) {
			addIssue(
				issues,
				"error",
				"checkpoint.account.missing",
				`Checkpoint account '${checkpoint.AccountId}' does not exist.`,
				rowPath(CSV_SCENARIO_FILE_NAMES.checkpoints, index + 2, "AccountId"),
			);
		}
	});

	validatePostingArithmetic(issues, pack.postings, accountIds);
	validatePostings(issues, pack.postings, accountIds);

	pack.accounts.forEach((account, index) => {
		if (account.minBalance > account.maxBalance) {
			addIssue(
				issues,
				"error",
				"account.balance.bounds",
				`minBalance (${account.minBalance}) must not exceed maxBalance (${account.maxBalance}).`,
				rowPath(CSV_SCENARIO_FILE_NAMES.accounts, index + 2),
			);
		}
	});

	return issues;
}

export function summarizeValidationIssues(issues: ScenarioValidationIssue[]) {
	const errors = issues.filter((issue) => issue.severity === "error");
	const warnings = issues.filter((issue) => issue.severity === "warning");

	return {
		issues,
		errors,
		warnings,
		isValid: errors.length === 0,
	};
}
