import type { ServerStatus } from "../api/index.ts";
import { serverQueryClient } from "../state/serverQuery.ts";
import {
	getServerModel,
	userResourceKey,
	type ServerModel,
} from "../state/workspaceResources.ts";
import { serverDocumentFingerprint } from "../state/remoteStorage.ts";
import {
	financialModelFixture,
	type FinancialModelFixture,
} from "./financialModel.ts";
import { fixtureAmount, fixtureDocument } from "./document.ts";

export function setServerStatusFixture(status: ServerStatus) {
	serverQueryClient().setQueryData(userResourceKey("status"), status);
}
export function setServerModelFixture(
	data: FinancialModelFixture = financialModelFixture,
	overrides: Partial<ServerModel> = {},
) {
	const document = fixtureDocument(data);
	const model: ServerModel = {
		document,
		issues: [],
		revision: '"test-revision"',
		fingerprint: serverDocumentFingerprint(document),
		...overrides,
	};
	serverQueryClient().setQueryData(userResourceKey("model"), model);
	serverQueryClient().setQueryData([...userResourceKey("balances"), "latest"], {
		accounts: data.accounts.map((account) => ({
			...account,
			hasCheckpoint: account.balanceCheck,
			syncOwned: account.readOnly,
		})),
		asOf: data.startDate,
		revision: model.revision,
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
			revision: model.revision,
		},
	);
	serverQueryClient().setQueryData(userResourceKey("eval-summary"), {
		evaluations: document.evaluations,
		revision: model.revision,
	});
	return model;
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
