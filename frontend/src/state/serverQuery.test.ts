import { afterEach, describe, expect, it } from "vitest";
import {
	acceptResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import {
	clearResourceQueryCache,
	deterministicQueryKey,
	resetServerQueryCache,
	serverQueryClient,
	stochasticQueryKey,
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

	it("uses a new generation after verification even when a resource ID returns", () => {
		owner("plans/a");
		const before = deterministicQueryKey("same-document", 10);
		expect(deterministicQueryKey("same-document", 10)).toEqual(before);
		owner("plans/a");
		expect(deterministicQueryKey("same-document", 10)).not.toEqual(before);
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
});
