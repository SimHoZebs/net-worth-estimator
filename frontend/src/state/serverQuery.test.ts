import { afterEach, describe, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import {
	clearResourceQueryCache,
	cancelResourceQueries,
	deterministicQueryKey,
	resetServerQueryCache,
	serverQueryClient,
	stochasticQueryKey,
	currentPositionQueryKey,
	financialQueryFilter,
} from "./serverQuery.ts";

function owner(id: string) {
	acceptResourceScope(
		{
			apiBaseUrl: "https://plan.example",
			resource: {
				id,
				kind: "private",
				permissions: ["plan:read", "plan:project"],
			},
			subject: id,
		},
		suspendResourceScope(),
	);
}

afterEach(() => {
	resetServerQueryCache();
	suspendResourceScope();
});

describe("resource-scoped projection cache", () => {
	it("filters calculations by resource without matching session data", () => {
		owner("plans/a");
		const keys = [
			deterministicQueryKey("doc", 10),
			stochasticQueryKey("doc", 10, 100, 42, 0),
			currentPositionQueryKey("doc", "2026-01-01"),
		];
		const filter = financialQueryFilter(keys[0]![1] as string);
		for (const queryKey of keys)
			expect(filter.predicate({ queryKey })).toBe(true);
		expect(filter.predicate({ queryKey: ["session"] })).toBe(false);
		owner("plans/b");
		for (const queryKey of [
			deterministicQueryKey("doc", 10),
			stochasticQueryKey("doc", 10, 100, 42, 0),
			currentPositionQueryKey("doc", "2026-01-01"),
		])
			expect(filter.predicate({ queryKey })).toBe(false);
	});
	it("keeps calculations fresh beyond a minute but supports explicit invalidation", async () => {
		owner("plans/a");
		const client = serverQueryClient();
		for (const queryKey of [
			deterministicQueryKey("doc", 10),
			stochasticQueryKey("doc", 10, 100, 42, 0),
			currentPositionQueryKey("doc", "2026-01-01"),
		]) {
			client.setQueryData(queryKey, "cached", {
				updatedAt: Date.now() - 120_000,
			});
			const queryFn = vi.fn().mockResolvedValue("fresh");
			expect(await client.fetchQuery({ queryKey, queryFn })).toBe("cached");
			expect(queryFn).not.toHaveBeenCalled();
			await client.invalidateQueries({
				queryKey,
				exact: true,
				refetchType: "none",
			});
			expect(await client.fetchQuery({ queryKey, queryFn })).toBe("fresh");
			expect(queryFn).toHaveBeenCalledOnce();
		}
	});
	it("never reuses identical deterministic or stochastic inputs across accounts", () => {
		owner("plans/a");
		const deterministicA = deterministicQueryKey("same-document", 10);
		const stochasticA = stochasticQueryKey("same-document", 10, 100, 42, 0);
		serverQueryClient().setQueryData(deterministicA, "private-a-result");
		serverQueryClient().setQueryData(stochasticA, "private-a-bands");
		owner("plans/b");
		const deterministicB = deterministicQueryKey("same-document", 10);
		const stochasticB = stochasticQueryKey("same-document", 10, 100, 42, 0);
		expect(deterministicB).not.toEqual(deterministicA);
		expect(stochasticB).not.toEqual(stochasticA);
		expect(serverQueryClient().getQueryData(deterministicB)).toBeUndefined();
		expect(serverQueryClient().getQueryData(stochasticB)).toBeUndefined();
	});

	it("reuses results after a same-account verification", () => {
		owner("plans/a");
		const before = deterministicQueryKey("same-document", 10);
		expect(deterministicQueryKey("same-document", 10)).toEqual(before);
		owner("plans/a");
		expect(deterministicQueryKey("same-document", 10)).toEqual(before);
	});

	it("isolates deterministic cache entries by range", () => {
		owner("plans/a");
		const full = deterministicQueryKey("same-document", 10, "..2028-01-31");
		const narrowed = deterministicQueryKey(
			"same-document",
			10,
			"2026-01-31..2026-06-30",
		);
		serverQueryClient().setQueryData(full, "full-result");
		expect(serverQueryClient().getQueryData(narrowed)).toBeUndefined();
		expect(deterministicQueryKey("same-document", 10, "..2028-01-31")).toEqual(
			full,
		);
	});

	it("aborts old fetches, removes data, and ignores late non-cooperative results", async () => {
		owner("plans/a");
		const client = serverQueryClient();
		const key = deterministicQueryKey("same-document", 10);
		let signal: AbortSignal | undefined;
		let finish: (value: string) => void = () => {};
		const pending = client
			.fetchQuery({
				queryKey: key,
				queryFn: ({ signal: requestSignal }) => {
					signal = requestSignal;
					return new Promise<string>((resolve) => {
						finish = resolve;
					});
				},
			})
			.catch(() => null);
		await clearResourceQueryCache();
		expect(signal?.aborted).toBe(true);
		expect(client.getQueryCache().getAll()).toHaveLength(0);
		finish("late-private-a-result");
		await pending;
		expect(client.getQueryData(key)).toBeUndefined();
		expect(client.getQueryCache().getAll()).toHaveLength(0);
	});

	it("cancels verification-era work without losing completed same-account results", async () => {
		owner("plans/a");
		const client = serverQueryClient();
		const key = deterministicQueryKey("same-document", 10);
		client.setQueryData(key, "completed-result");
		let finish: (value: string) => void = () => {};
		let signal: AbortSignal | undefined;
		const pending = client
			.fetchQuery({
				queryKey: key,
				staleTime: 0,
				queryFn: ({ signal: requestSignal }) => {
					signal = requestSignal;
					return new Promise<string>((resolve) => {
						finish = resolve;
					});
				},
			})
			.catch(() => null);
		await cancelResourceQueries();
		owner("plans/a");
		finish("late-result");
		await pending;
		expect(signal?.aborted).toBe(true);
		expect(deterministicQueryKey("same-document", 10)).toEqual(key);
		expect(client.getQueryData(key)).toBe("completed-result");
	});
});
