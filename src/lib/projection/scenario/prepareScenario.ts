import type {
	FinancialModelDocument,
	ScenarioOverrides,
} from "../types/scenario";

export const EMPTY_SCENARIO_OVERRIDES: ScenarioOverrides = {
	addedAccounts: [],
	addedPostings: [],
	addedCheckpoints: [],
	disabledAccountIds: [],
	disabledPostingIds: [],
};

export const EMPTY_WHAT_IF_STATE = EMPTY_SCENARIO_OVERRIDES;

export function applyScenarioOverrides(
	document: FinancialModelDocument,
	overrides: ScenarioOverrides = EMPTY_SCENARIO_OVERRIDES,
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

export function prepareScenarioPack(
	pack: FinancialModelDocument,
	whatIfState: ScenarioOverrides = EMPTY_SCENARIO_OVERRIDES,
): FinancialModelDocument {
	return applyScenarioOverrides(pack, whatIfState);
}
