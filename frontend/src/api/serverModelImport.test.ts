import { afterEach, describe, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import { ok } from "../mocks/fetch.ts";
import { ApiHttpError, ApiNetworkError } from "./http.ts";
import { UserScopeError } from "./scopedRequest.ts";
import type { BackendAccount, FinancialModel } from "./contracts.ts";
import {
	importServerModel,
	ServerModelImportError,
	type ServerModelImportOptions,
} from "./serverModelImport.ts";

const emptyModel: FinancialModel = {
	sourcePath: "models/current",
	accounts: [],
	checkpoints: [],
	postings: [],
	recurrenceRules: [],
	evaluations: {
		financialIndependence: [],
		netWorthThreshold: [],
		accountBalance: [],
		postingFulfillment: [],
	},
};

const account: BackendAccount = {
	id: "checking",
	name: "Checking",
	kind: "cash",
	minBalance: null,
	maxBalance: null,
	color: null,
	enabled: true,
};

const model: FinancialModel = {
	...emptyModel,
	sourcePath: "models/reviewed-model",
	accounts: [account],
};

function rowResponse(row: unknown) {
	return { row, issues: [], persisted: true, revision: "r1" };
}

function setup(
	preconditions: Partial<ServerModelImportOptions["preconditions"]> = {},
) {
	acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: `users/${"a".repeat(64)}`,
				permissions: ["user:read", "user:write", "user:project"],
			},
			subject: "account-a",
		},
		suspendUserScope(),
	);
	const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
		const path = String(url);
		const method = init?.method ?? "GET";
		if (path.endsWith("/v1/financial-model"))
			return ok({ model: emptyModel, issues: [], revision: "r-model" });
		if (method === "DELETE" || path.endsWith("/reorder"))
			return ok({ revision: "r1" });
		return ok(rowResponse(JSON.parse(String(init?.body ?? "{}"))));
	});
	vi.stubGlobal("fetch", fetcher);
	const recover = vi.fn(async () => true);
	const reload = vi.fn(async () => {});
	const options: ServerModelImportOptions = {
		preconditions: {
			hasWorkspace: true,
			readOnly: false,
			loading: false,
			...preconditions,
		},
		recover,
		reload,
	};
	return {
		fetcher,
		recover,
		reload,
		run: () => importServerModel({ ...options, model }),
	};
}

afterEach(() => {
	suspendUserScope();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("server model replacement", () => {
	it("does not start writes if the resource changes after the initial read", async () => {
		const { run, fetcher, reload } = setup();
		fetcher.mockImplementationOnce(async () => {
			suspendUserScope();
			return ok({ model: emptyModel, issues: [], revision: "r-model" });
		});
		expect(await run()).toBeInstanceOf(UserScopeError);
		expect(
			fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
		).toHaveLength(0);
		expect(reload).not.toHaveBeenCalled();
	});

	it("does not reload a different resource after the last write", async () => {
		const { run, fetcher, reload } = setup();
		fetcher.mockImplementation(async (url, init) => {
			if (
				String(url).endsWith("/v1/accounts") &&
				(init?.method ?? "GET") === "POST"
			) {
				suspendUserScope();
				return ok(rowResponse(account));
			}
			return ok({ model: emptyModel, issues: [], revision: "r-model" });
		});
		expect(await run()).toBeInstanceOf(UserScopeError);
		expect(reload).not.toHaveBeenCalled();
	});

	it.each([
		{
			preconditions: { readOnly: true },
		},
		{
			preconditions: { loading: true },
		},
	])(
		"returns a precondition error without uploading: %j",
		async ({ preconditions }) => {
			const { run, fetcher, recover, reload } = setup(preconditions);
			const result = await run();
			expect(result).toBeInstanceOf(ServerModelImportError);
			expect(fetcher).not.toHaveBeenCalled();
			expect(recover).not.toHaveBeenCalled();
			expect(reload).not.toHaveBeenCalled();
		},
	);

	it("creates reviewed rows through generated endpoints, then reloads", async () => {
		const { run, fetcher, recover, reload } = setup();
		expect(await run()).toBe(true);
		const posts = fetcher.mock.calls.filter(
			([, init]) => (init?.method ?? "GET") === "POST",
		);
		expect(posts).toHaveLength(1);
		expect(posts[0]?.[0]).toBe("/v1/accounts");
		expect(JSON.parse(String(posts[0]?.[1]?.body))).toMatchObject({
			id: "checking",
		});
		expect(reload).toHaveBeenCalledOnce();
		expect(recover).not.toHaveBeenCalled();
	});

	it("waits for authoritative reload before reporting successful activation", async () => {
		const { run, reload } = setup();
		const gate = { complete: () => {} };
		const pendingReload = new Promise<void>((resolve) => {
			gate.complete = resolve;
		});
		reload.mockReturnValue(pendingReload);
		const settled = vi.fn();
		const operation = run().then(settled);
		await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
		expect(settled).not.toHaveBeenCalled();
		gate.complete();
		await operation;
		expect(settled).toHaveBeenCalledExactlyOnceWith(true);
	});

	it.each([401, 403, 500])(
		"propagates HTTP %i errors without a reload",
		async (status) => {
			const { run, fetcher, reload } = setup();
			fetcher.mockImplementationOnce(async () =>
				ok({ title: "Server response" }, status),
			);
			const result = await run();
			expect(result).toBeInstanceOf(ApiHttpError);
			expect(result).toMatchObject({ status });
			expect(reload).not.toHaveBeenCalled();
		},
	);

	it("wraps a network error in the shared taxonomy, preserving the cause", async () => {
		const { run, fetcher, reload } = setup();
		const error = new Error("Network unavailable");
		fetcher.mockRejectedValueOnce(error);
		const result = await run();
		expect(result).toBeInstanceOf(ApiNetworkError);
		expect((result as Error).cause).toBe(error);
		expect(reload).not.toHaveBeenCalled();
	});

	it("reports only validation errors and keeps the existing model without reloading", async () => {
		const { run, fetcher, reload } = setup();
		fetcher.mockImplementation(async (url, init) => {
			if (
				String(url).endsWith("/v1/accounts") &&
				(init?.method ?? "GET") === "POST"
			)
				return ok({
					row: account,
					issues: [
						{
							severity: "error",
							code: "account",
							path: [],
							message: "Account is missing.",
						},
						{
							severity: "warning",
							code: "age",
							path: [],
							message: "Checkpoint is old.",
						},
					],
					persisted: false,
					revision: "r1",
				});
			return ok({ model: emptyModel, issues: [], revision: "r-model" });
		});
		const result = await run();
		expect(result).toBeInstanceOf(ServerModelImportError);
		expect(String((result as Error).message)).toContain("Account is missing.");
		expect(reload).not.toHaveBeenCalled();
	});

	it("accepts warning-only rows and reloads", async () => {
		const { run, fetcher, reload } = setup();
		fetcher.mockImplementation(async (url, init) => {
			if (
				String(url).endsWith("/v1/accounts") &&
				(init?.method ?? "GET") === "POST"
			)
				return ok({
					row: account,
					issues: [
						{
							severity: "warning",
							code: "age",
							path: [],
							message: "Checkpoint is old.",
						},
					],
					persisted: true,
					revision: "r1",
				});
			return ok({ model: emptyModel, issues: [], revision: "r-model" });
		});
		expect(await run()).toBe(true);
		expect(reload).toHaveBeenCalledOnce();
	});

	it("preserves unexpected reload rejections rather than reporting success", async () => {
		const { run, reload } = setup();
		const failure = new Error("Reload failed");
		reload.mockRejectedValue(failure);
		await expect(run()).rejects.toBe(failure);
	});
});

describe("initial server model recovery", () => {
	it.each([true, false])(
		"delegates activation and returns %s without applying replacement guards",
		async (activated) => {
			const { run, recover, fetcher, reload } = setup({
				hasWorkspace: false,
				readOnly: true,
				loading: true,
			});
			recover.mockResolvedValue(activated);
			expect(await run()).toBe(activated);
			expect(recover).toHaveBeenCalledExactlyOnceWith(model);
			expect(fetcher).not.toHaveBeenCalled();
			expect(reload).not.toHaveBeenCalled();
		},
	);
});
