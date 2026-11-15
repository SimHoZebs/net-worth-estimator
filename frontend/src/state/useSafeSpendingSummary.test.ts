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
	it("uses the generated scoped no-store transport with explicit inclusive ranges", async () => {
		const server = stubTestServer();
		const body = { revision: "synthetic", cashAfterBills: -216.58 };
		const fetcher = vi.fn(async () => server.ok(body));
		vi.stubGlobal("fetch", fetcher);
		const cache = serverQueryClient();
		expect(
			await cache.fetchQuery(
				safeSpendingSummaryOptions("2026-11-15", "2026-11-30", ["synthetic"]),
			),
		).toEqual(body);
		await cache.fetchQuery(
			safeSpendingSummaryOptions("2026-10-19", "2026-10-19", ["synthetic"]),
		);
		expect(fetcher).toHaveBeenCalledWith(
			"/v1/safe-spending-summary?start=2026-11-15&end=2026-11-30",
			expect.objectContaining({
				cache: "no-store",
				signal: expect.any(AbortSignal),
			}),
		);
		expect(fetcher).toHaveBeenCalledWith(
			"/v1/safe-spending-summary?start=2026-10-19&end=2026-10-19",
			expect.objectContaining({ cache: "no-store" }),
		);
	});
	it("separates summaries by model revision, range, and selected settings", () => {
		const current = safeSpendingSummaryOptions("2026-11-15", "2026-11-30", [
			"revision-a",
		]);
		expect(current.queryKey).not.toEqual(
			safeSpendingSummaryOptions("2026-11-15", "2026-11-30", ["revision-b"])
				.queryKey,
		);
		expect(current.queryKey).not.toEqual(
			safeSpendingSummaryOptions("2026-11-15", "2026-11-15", ["revision-a"])
				.queryKey,
		);
		expect(current.queryKey).not.toEqual(
			safeSpendingSummaryOptions("2026-11-16", "2026-11-30", ["revision-a"])
				.queryKey,
		);
		serverQueryClient().setQueryData(safeSpendingSettingsKey(), {
			...defaultSafeSpendingSettings(),
			spendingAccountIds: ["other-cash"],
		});
		expect(current.queryKey).not.toEqual(
			safeSpendingSummaryOptions("2026-11-15", "2026-11-30", ["revision-a"])
				.queryKey,
		);
	});
	it.each([refreshAccounts, refreshTransactions])(
		"invalidates cash evidence when workspace rows refresh",
		async (refresh) => {
			stubTestServer();
			const cache = serverQueryClient();
			const options = safeSpendingSummaryOptions("2026-11-15", "2026-11-30", [
				"synthetic",
			]);
			cache.setQueryData(options.queryKey, {
				revision: "synthetic",
				start: "2026-11-15",
				end: "2026-11-30",
				status: "missing",
				reasons: [],
				baselines: [],
				checkingAvailable: null,
				outstandingBillsTotal: null,
				cashAfterBills: null,
				confirmedMovements: [],
				outstandingObligations: [],
				selectedAccountIds: [],
			});
			await refresh();
			expect(cache.getQueryState(options.queryKey)?.isInvalidated).toBe(true);
		},
	);
});
