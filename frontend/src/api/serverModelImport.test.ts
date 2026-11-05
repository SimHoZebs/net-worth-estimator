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
	schedules: [],
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
	const fetcher = vi.fn(async () =>
		ok({
			issues: [],
			saved: true,
			revision: "r1",
		}),
	);
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
	it("sends one reviewed document to the import action, then reloads", async () => {
		const { run, fetcher, recover, reload } = setup();
		expect(await run()).toBe(true);
		expect(fetcher).toHaveBeenCalledOnce();
		const [url, init] = fetcher.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("/v1/model/import");
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toMatchObject({
			model: { sourcePath: "models/reviewed-model" },
		});
		expect(reload).toHaveBeenCalledOnce();
		expect(recover).not.toHaveBeenCalled();
	});

	it("does not reload a different resource after the import", async () => {
		const { run, fetcher, reload } = setup();
		fetcher.mockImplementationOnce(async () => {
			suspendUserScope();
			return ok({ issues: [], saved: true, revision: "r1" });
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
		fetcher.mockImplementation(async () =>
			ok({
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
				saved: false,
				revision: "r1",
			}),
		);
		const result = await run();
		expect(result).toBeInstanceOf(ServerModelImportError);
		expect(String((result as Error).message)).toContain("Account is missing.");
		expect(reload).not.toHaveBeenCalled();
	});

	it("accepts warning-only imports and reloads", async () => {
		const { run, fetcher, reload } = setup();
		fetcher.mockImplementation(async () =>
			ok({
				issues: [
					{
						severity: "warning",
						code: "age",
						path: [],
						message: "Checkpoint is old.",
					},
				],
				saved: true,
				revision: "r1",
			}),
		);
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
