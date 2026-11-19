import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptTestResource } from "@/mocks/resource.ts";
import { stubTestServer } from "@/mocks/waypointServer.ts";
import { resetServerQueryCache, serverQueryClient } from "./serverQuery.ts";
import { safeSpendingSummaryOptions } from "./useSafeSpendingSummary.ts";
import { refreshAccounts, refreshTransactions } from "./workspaceResources.ts";
import {
	safeSpendingSettingsKey,
	defaultSafeSpendingSettings,
} from "./useSafeSpendingSettings.ts";

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("safe spending summary query", () => {
	it("uses the scoped no-store transport with no cycle query", async () => {
		const server = stubTestServer();
		const body = { revision: "synthetic", safeToSpend: 200 };
		const fetcher = vi.fn(async () => server.ok(body));
		vi.stubGlobal("fetch", fetcher);
		const cache = serverQueryClient();
		expect(
			await cache.fetchQuery(safeSpendingSummaryOptions(["synthetic"])),
		).toEqual(body);
		expect(fetcher).toHaveBeenCalledWith(
			"/v1/safe-spending-summary",
			expect.objectContaining({
				cache: "no-store",
				signal: expect.any(AbortSignal),
			}),
		);
	});

	it("separates summaries by model revision and selected settings", () => {
		const current = safeSpendingSummaryOptions(["revision-a"]);
		expect(current.queryKey).not.toEqual(
			safeSpendingSummaryOptions(["revision-b"]).queryKey,
		);
		serverQueryClient().setQueryData(safeSpendingSettingsKey(), {
			...defaultSafeSpendingSettings(),
			spendingAccountIds: ["other-cash"],
		});
		expect(current.queryKey).not.toEqual(
			safeSpendingSummaryOptions(["revision-a"]).queryKey,
		);
	});

	it.each([refreshAccounts, refreshTransactions])(
		"invalidates the summary when workspace rows refresh",
		async (refresh) => {
			stubTestServer();
			const cache = serverQueryClient();
			const options = safeSpendingSummaryOptions(["synthetic"]);
			cache.setQueryData(options.queryKey, {
				revision: "synthetic",
				cashAsOf: "2026-11-15",
				status: "missing",
				reasons: [],
				selectedAccountIds: [],
				baselines: [],
				checkingAvailable: null,
				confirmedMovements: [],
				bills: [],
				payday: null,
				expectedPay: null,
				prePaydayBills: null,
				paydayBills: null,
				statementReserve: null,
				reserve: 200,
				prePaydayRoom: null,
				postIncomeRoom: null,
				safeToSpend: null,
				statements: [],
			});
			await refresh();
			expect(cache.getQueryState(options.queryKey)?.isInvalidated).toBe(true);
		},
	);
});
