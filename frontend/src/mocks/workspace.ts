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
/**
 * Model resource only. Leaves narrow row caches untouched so a test can
 * supply its own local rows through props.
 */
export function setServerModelOnly(
	data: FinancialModelFixture = financialModelFixture,
) {
	const model = fixtureModel(data);
	const response: ServerModel = {
		model,
		issues: [],
		revision: '"test-revision"',
		fingerprint: serverModelFingerprint(model),
	};
	serverQueryClient().setQueryData(userResourceKey("model"), response);
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
	serverQueryClient().setQueryData([...userResourceKey("rules"), ""], {
		schedules: model.schedules,
		revision: response.revision,
	});
	serverQueryClient().setQueryData([...userResourceKey("transactions"), ""], {
		transactions: data.transactions
			.filter((row) => row.kind === "transaction")
			.map((row) => ({
				...row,
				sourceAccountId: row.fromId,
				destinations: row.toId ? [row.toId] : null,
				amount: fixtureAmount(row),
				annualCap: null,
				source: row.readOnly ? "banksync" : "user",
				claim:
					row.claimScheduleId && row.claimOccurrenceDate
						? {
								scheduleId: row.claimScheduleId,
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
	});
	serverQueryClient().setQueryData(userResourceKey("eval-summary"), {
		evaluations: model.evaluations,
		revision: response.revision,
	});
	serverQueryClient().setQueryData(
		[...userResourceKey("checkpoints"), "", "", ""],
		{ checkpoints: model.checkpoints, revision: response.revision },
	);
	serverQueryClient().setQueryData(userResourceKey("purchases"), {
		plannedPurchases: model.plannedPurchases ?? [],
		revision: response.revision,
	});
	// Presence is a status flag. Keep an explicit fixture when a test has
	// already set one (for example, a read-only workspace).
	if (!serverQueryClient().getQueryData(userResourceKey("status")))
		serverQueryClient().setQueryData(userResourceKey("status"), {
			readOnly: false,
			hasModel: true,
			syncConfigured: false,
			syncQuotaUsed: 0,
			syncQuotaLimit: 0,
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
