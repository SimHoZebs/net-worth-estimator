import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { acceptTestResource } from "@/mocks/resource.ts";
import { stubTestServer } from "@/mocks/waypointServer.ts";
import { summaryFixture } from "@/mocks/safeSpendingSummary.ts";
import { resetServerQueryCache, serverQueryClient } from "./serverQuery.ts";
import {
	safeSpendingSummaryOptions,
	useSafeSpendingSummary,
} from "./useSafeSpendingSummary.ts";
import {
	refreshAccounts,
	refreshTransactions,
	userResourceKey,
} from "./workspaceResources.ts";
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
	it("uses the scoped no-store transport with no as-of override", async () => {
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

	it("keeps cached summary data while the summary refetches", async () => {
		const revision = "synthetic";
		const options = safeSpendingSummaryOptions([revision, revision, revision]);
		const cache = serverQueryClient();
		cache.setQueryData([...userResourceKey("balances"), "latest"], {
			accounts: [],
			asOf: "2026-11-17",
			revision,
		});
		cache.setQueryData([...userResourceKey("transactions"), ""], {
			transactions: [],
			revision,
		});
		cache.setQueryData([...userResourceKey("rules"), ""], {
			schedules: [],
			revision,
		});
		cache.setQueryData(options.queryKey, summaryFixture());
		const server = stubTestServer();
		const deferred = { resolve: null as ((value: Response) => void) | null };
		const fetcher = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					deferred.resolve = resolve;
				}),
		);
		vi.stubGlobal("fetch", fetcher);
		const rendered = renderHook(() => useSafeSpendingSummary());
		expect(rendered.result.current.data).toEqual(summaryFixture());
		expect(rendered.result.current.isPending).toBe(false);
		const refetch = rendered.result.current.refetch();
		await waitFor(() =>
			expect(cache.isFetching({ queryKey: options.queryKey })).toBe(1),
		);
		expect(rendered.result.current.data).toEqual(summaryFixture());
		expect(rendered.result.current.isPending).toBe(false);
		deferred.resolve?.(server.ok(summaryFixture()));
		await refetch;
		expect(fetcher).toHaveBeenCalled();
	});

	it("refreshes the current-day summary at UTC midnight", async () => {
		const server = stubTestServer();
		const fetcher = vi.fn(async () => server.ok(summaryFixture()));
		vi.stubGlobal("fetch", fetcher);
		const cache = serverQueryClient();
		const options = safeSpendingSummaryOptions(["synthetic"]);
		const updatedAt = Date.parse("2026-11-17T23:59:58Z");
		cache.setQueryData(options.queryKey, summaryFixture(), { updatedAt });
		const now = vi.spyOn(Date, "now").mockReturnValue(updatedAt + 1_000);
		try {
			await cache.fetchQuery(options);
			expect(fetcher).not.toHaveBeenCalled();
			now.mockReturnValue(updatedAt + 2_000);
			await cache.fetchQuery(options);
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(options.refetchOnWindowFocus).toBe(true);
		} finally {
			now.mockRestore();
		}
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
			cache.setQueryData(options.queryKey, summaryFixture());
			await refresh();
			expect(cache.getQueryState(options.queryKey)?.isInvalidated).toBe(true);
		},
	);
});
