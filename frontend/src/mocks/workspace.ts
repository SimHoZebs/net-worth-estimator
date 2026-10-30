import type { ServerStatus } from "../api/index.ts";
import { serverQueryClient } from "../state/serverQuery.ts";
import {
	getServerModel,
	userResourceKey,
	type ServerModel,
} from "../state/workspaceResources.ts";
import { serverModelFingerprint } from "../state/remoteStorage.ts";
import {
	financialModelFixture,
	type FinancialModelFixture,
} from "./financialModel.ts";
import { fixtureAmount, fixtureModel } from "./model.ts";

export function setServerStatusFixture(status: ServerStatus) {
	serverQueryClient().setQueryData(userResourceKey("status"), status);
}
export function setServerModelFixture(
	data: FinancialModelFixture = financialModelFixture,
	overrides: Partial<ServerModel> = {},
) {
	const model = fixtureModel(data);
	const response: ServerModel = {
		model,
		issues: [],
		revision: '"test-revision"',
		fingerprint: serverModelFingerprint(model),
		...overrides,
	};
	serverQueryClient().setQueryData(userResourceKey("model"), response);
	serverQueryClient().setQueryData([...userResourceKey("balances"), "latest"], {
		accounts: data.accounts.map((account) => ({
			...account,
			hasCheckpoint: account.balanceCheck,
			syncOwned: account.readOnly,
		})),
		asOf: data.startDate,
		revision: response.revision,
	});
	serverQueryClient().setQueryData(
		[...userResourceKey("transactions"), "", "all"],
		{
			transactions: data.transactions.map((row) => ({
				...row,
				kind: row.frequency === "once" ? "posting" : "rule",
				sourceAccountId: row.fromId,
				destinations: row.toId ? [row.toId] : null,
				amount: fixtureAmount(row),
				annualCap: null,
				source: row.readOnly ? "simplefin" : "user",
				claim:
					row.claimRuleId && row.claimOccurrenceDate
						? {
								ruleId: row.claimRuleId,
								occurrenceDate: row.claimOccurrenceDate,
							}
						: null,
				postedTime: Math.floor(
					Date.parse(`${row.postedDate ?? row.startDate}T00:00:00Z`) / 1000,
				),
				transactionTime: Math.floor(
					Date.parse(`${row.startDate}T00:00:00Z`) / 1000,
				),
			})),
			revision: response.revision,
		},
	);
	serverQueryClient().setQueryData(userResourceKey("eval-summary"), {
		evaluations: model.evaluations,
		revision: response.revision,
	});
	return response;
}
export function setServerRevisionFixture(revision: string) {
	const model = getServerModel();
	if (model)
		serverQueryClient().setQueryData(userResourceKey("model"), {
			...model,
			revision,
		});
	else setServerModelFixture(financialModelFixture, { revision });
}
