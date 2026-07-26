import type { FinancialModelDocument, ModelOverrides } from "../types/model";

export const EMPTY_MODEL_OVERRIDES: ModelOverrides = {
	addedAccounts: [],
	addedPostings: [],
	addedCheckpoints: [],
	disabledAccountIds: [],
	disabledPostingIds: [],
};

export function applyModelOverrides(
	document: FinancialModelDocument,
	overrides: ModelOverrides = EMPTY_MODEL_OVERRIDES,
): FinancialModelDocument {
	const disabledAccountIds = new Set(overrides.disabledAccountIds);
	const disabledPostingIds = new Set(overrides.disabledPostingIds);

	const accounts = document.accounts
		.filter((account) => !disabledAccountIds.has(account.id))
		.concat(overrides.addedAccounts);
	const accountIds = new Set(accounts.map((account) => account.id));

	return {
		...document,
		accounts,
		postings: document.postings
			.filter((posting) => !disabledPostingIds.has(posting.id))
			.concat(overrides.addedPostings),
		checkpoints: document.checkpoints
			.concat(overrides.addedCheckpoints)
			.filter((checkpoint) => accountIds.has(checkpoint.AccountId)),
	};
}

export function prepareFinancialModelDocument(
	document: FinancialModelDocument,
	overrides: ModelOverrides = EMPTY_MODEL_OVERRIDES,
): FinancialModelDocument {
	return applyModelOverrides(document, overrides);
}
