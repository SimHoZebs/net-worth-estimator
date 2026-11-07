import type { ServerStatus } from "../api/index.ts";
import type { FinancialModel } from "../api/contracts.ts";
import { serverQueryClient } from "../state/serverQuery.ts";
import { getAccountBalances, userResourceKey } from "../state/workspaceResources.ts";
import {
	financialModelFixture,
	type FinancialModelFixture,
} from "./financialModel.ts";
import { fixtureAmount, fixtureModel } from "./model.ts";

export function setServerStatusFixture(status: ServerStatus) {
	serverQueryClient().setQueryData(userResourceKey("status"), status);
}

/**
 * Row caches for the delete-guard. Production reads row queries instead of
 * the model document; this primes the four caches the guard needs.
 */
export function setServerModelOnly(
	data: FinancialModelFixture = financialModelFixture,
) {
	setServerModelFixture(data);
}

export interface ServerModelFixtureOverrides {
	revision?: string;
	model?: FinancialModel | null;
	hasModel?: boolean;
}

export function setServerModelFixture(
	data: FinancialModelFixture = financialModelFixture,
	overrides: ServerModelFixtureOverrides = {},
) {
	const revision = overrides.revision ?? '"test-revision"';
	const effectiveModel =
		overrides.model !== undefined ? overrides.model : fixtureModel(data);
	const hasModel = overrides.hasModel ?? effectiveModel !== null;
	// Empty server: no rows, presence flag false.
	if (!hasModel || !effectiveModel) {
		serverQueryClient().setQueryData(userResourceKey("status"), {
			readOnly: false,
			hasModel: false,
			syncConfigured: false,
			syncQuotaUsed: 0,
			syncQuotaLimit: 0,
		});
		serverQueryClient().setQueryData([...userResourceKey("balances"), "latest"], {
			accounts: [],
			asOf: data.startDate,
			revision,
		});
		serverQueryClient().setQueryData([...userResourceKey("rules"), ""], {
			schedules: [],
			revision,
		});
		serverQueryClient().setQueryData([...userResourceKey("transactions"), ""], {
			transactions: [],
			revision,
		});
		serverQueryClient().setQueryData(userResourceKey("eval-summary"), {
			evaluations: effectiveModel?.evaluations ?? {
				financialIndependence: [],
				netWorthThreshold: [],
				accountBalance: [],
				transactionFulfillment: [],
				cycleFulfillment: [],
			},
			revision,
		});
		serverQueryClient().setQueryData(
			[...userResourceKey("checkpoints"), "", "", ""],
			{ checkpoints: [], revision },
		);
		serverQueryClient().setQueryData(userResourceKey("purchases"), {
			plannedPurchases: [],
			revision,
		});
		return revision;
	}
	const model = effectiveModel;
	// Balances derive from the model accounts so raw bounds (sentinels) survive.
	const checkpointByAccount = new Map(
		model.checkpoints.map((checkpoint) => [checkpoint.AccountId, checkpoint]),
	);
	serverQueryClient().setQueryData([...userResourceKey("balances"), "latest"], {
		accounts: model.accounts.map((account) => {
			const checkpoint = checkpointByAccount.get(account.id);
			// Preserve display-fixture balance-check flags when data supplied them.
			const displayAccount = data.accounts.find((row) => row.id === account.id);
			return {
				...account,
				balance: checkpoint ? checkpoint.Balance : (displayAccount?.balance ?? 0),
				observedOn: data.startDate,
				hasCheckpoint: displayAccount?.balanceCheck ?? checkpoint !== undefined,
				archived: displayAccount?.archived ?? false,
				syncOwned: displayAccount?.readOnly ?? false,
				readOnly: displayAccount?.readOnly ?? false,
				observedBalance: checkpoint ? checkpoint.Balance : null,
				observedAt: checkpoint ? checkpoint.observedAt : null,
			};
		}),
		asOf: data.startDate,
		revision,
	});
	serverQueryClient().setQueryData([...userResourceKey("rules"), ""], {
		schedules: model.schedules,
		revision,
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
		revision,
	});
	serverQueryClient().setQueryData(userResourceKey("eval-summary"), {
		evaluations: model.evaluations,
		revision,
	});
	serverQueryClient().setQueryData(
		[...userResourceKey("checkpoints"), "", "", ""],
		{ checkpoints: model.checkpoints, revision },
	);
	serverQueryClient().setQueryData(userResourceKey("purchases"), {
		plannedPurchases: model.plannedPurchases ?? [],
		revision,
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
	return revision;
}
export function setServerRevisionFixture(revision: string) {
	const cached = getAccountBalances();
	if (cached) {
		serverQueryClient().setQueryData([...userResourceKey("balances"), "latest"], {
			...cached,
			revision,
		});
	} else setServerModelFixture(financialModelFixture, { revision });
}
