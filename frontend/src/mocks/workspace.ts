import type { ServerStatus } from "../api/index.ts";
import type { FinancialModel } from "../api/contracts.ts";
import { todayIso } from "../domain/format.ts";
import { serverQueryClient } from "../state/serverQuery.ts";
import {
	balancesQueryKey,
	getAccountBalances,
	userResourceKey,
} from "../state/workspaceResources.ts";
import {
	financialModelFixture,
	type FinancialModelFixture,
} from "./financialModel.ts";
import { fixtureModel } from "./model.ts";
import { transactionResponse } from "./transactionResponse.ts";
import { balanceRowsAt } from "./waypointServer.ts";

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
		serverQueryClient().setQueryData(balancesQueryKey(), {
			accounts: [],
			asOf: todayIso(),
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
		serverQueryClient().setQueryData(userResourceKey("terms"), {
			paymentTerms: [],
			revision,
		});
		return revision;
	}
	const model = effectiveModel;
	const current = balanceRowsAt(model);
	serverQueryClient().setQueryData(balancesQueryKey(), {
		accounts: current.accounts.map((row) => {
			// Preserve display-fixture ownership and balance-check flags while
			// balances follow the same actual-only replay as the HTTP fake.
			const displayAccount = data.accounts.find(
				(account) => account.id === row.id,
			);
			return {
				...row,
				hasCheckpoint: displayAccount?.balanceCheck ?? row.hasCheckpoint,
				archived: displayAccount?.archived ?? row.archived,
				syncOwned:
					displayAccount?.syncOwned ??
					displayAccount?.readOnly ??
					row.syncOwned,
				readOnly: displayAccount?.readOnly ?? row.readOnly,
			};
		}),
		asOf: current.asOf,
		revision,
	});
	serverQueryClient().setQueryData([...userResourceKey("rules"), ""], {
		schedules: model.schedules,
		revision,
	});
	serverQueryClient().setQueryData([...userResourceKey("transactions"), ""], {
		transactions: model.transactions.map(transactionResponse),
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
	serverQueryClient().setQueryData(userResourceKey("terms"), {
		paymentTerms: model.paymentTerms ?? [],
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
		serverQueryClient().setQueryData(balancesQueryKey(), {
			...cached,
			revision,
		});
	} else setServerModelFixture(financialModelFixture, { revision });
}
