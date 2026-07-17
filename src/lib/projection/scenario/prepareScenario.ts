import type { ScenarioPack, ScenarioWhatIfState } from "../types/scenario";

export const EMPTY_WHAT_IF_STATE: ScenarioWhatIfState = {
	addedAccounts: [],
	addedPostings: [],
	addedCheckpoints: [],
	disabledAccountIds: [],
	disabledPostingIds: [],
};

export function prepareScenarioPack(
	pack: ScenarioPack,
	whatIfState: ScenarioWhatIfState = EMPTY_WHAT_IF_STATE,
): ScenarioPack {
	const disabledAccountIds = new Set(whatIfState.disabledAccountIds);
	const disabledPostingIds = new Set(whatIfState.disabledPostingIds);

	const accounts = pack.accounts
		.filter((account) => !disabledAccountIds.has(account.id))
		.concat(whatIfState.addedAccounts);
	const accountIds = new Set(accounts.map((account) => account.id));

	return {
		...pack,
		accounts,
		postings: pack.postings
			.filter((posting) => !disabledPostingIds.has(posting.id))
			.concat(whatIfState.addedPostings),
		checkpoints: pack.checkpoints
			.concat(whatIfState.addedCheckpoints)
			.filter((checkpoint) => accountIds.has(checkpoint.AccountId)),
	};
}
