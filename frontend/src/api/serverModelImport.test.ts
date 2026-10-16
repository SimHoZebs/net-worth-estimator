import { describe, expect, it, vi } from "vitest";
import type { ApiRequestOptions } from "./client.ts";
import { ApiHttpError } from "./client.ts";
import type {
	BackendAccount,
	FinancialModelDocument,
	FinancialModelResponse,
	RowWriteResponse,
} from "./contracts.ts";
import type { RowWriter } from "./rowSync.ts";
import {
	importServerModel,
	ServerModelImportError,
	type ServerModelImportOptions,
} from "./serverModelImport.ts";

const emptyDocument: FinancialModelDocument = {
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

const document: FinancialModelDocument = {
	...emptyDocument,
	sourcePath: "models/reviewed-model",
	accounts: [account],
};

type FakeClient = {
	getModel: (
		options?: ApiRequestOptions,
	) => Promise<Error | FinancialModelResponse>;
} & { [K in keyof RowWriter]: RowWriter[K] };

function rowResponse<T>(row: T): RowWriteResponse<T> {
	return { row, issues: [], persisted: true, revision: "r1" };
}

function setup(
	preconditions: Partial<ServerModelImportOptions["preconditions"]> = {},
) {
	const getModel = vi.fn(
		async (): Promise<Error | FinancialModelResponse> => ({
			document: emptyDocument,
			issues: [],
		}),
	);
	const echoRow = (row: unknown) => rowResponse(row);
	const mocks = {
		getModel,
		createAccount: vi.fn(async (account: BackendAccount) => echoRow(account)),
		updateAccount: vi.fn(async (..._args: unknown[]) => echoRow({})),
		deleteAccount: vi.fn(async (..._args: unknown[]) => echoRow({})),
		moveAccount: vi.fn(async (..._args: unknown[]) => echoRow({})),
		createPosting: vi.fn(async (..._args: unknown[]) => echoRow({})),
		updatePosting: vi.fn(async (..._args: unknown[]) => echoRow({})),
		deletePosting: vi.fn(async (..._args: unknown[]) => echoRow({})),
		movePosting: vi.fn(async (..._args: unknown[]) => echoRow({})),
		createRule: vi.fn(async (..._args: unknown[]) => echoRow({})),
		updateRule: vi.fn(async (..._args: unknown[]) => echoRow({})),
		deleteRule: vi.fn(async (..._args: unknown[]) => echoRow({})),
		moveRule: vi.fn(async (..._args: unknown[]) => echoRow({})),
		saveCheckpoint: vi.fn(async (..._args: unknown[]) => echoRow({})),
		deleteCheckpoint: vi.fn(async (..._args: unknown[]) => echoRow({})),
		createEvaluation: vi.fn(async (..._args: unknown[]) => echoRow({})),
		updateEvaluation: vi.fn(async (..._args: unknown[]) => echoRow({})),
		deleteEvaluation: vi.fn(async (..._args: unknown[]) => echoRow({})),
		moveEvaluation: vi.fn(async (..._args: unknown[]) => echoRow({})),
	};
	const client = mocks as unknown as FakeClient;
	const recover = vi
		.fn<ServerModelImportOptions["recover"]>()
		.mockResolvedValue(true);
	const reload = vi
		.fn<ServerModelImportOptions["reload"]>()
		.mockResolvedValue(undefined);
	const options: ServerModelImportOptions = {
		client,
		authToken: "tab-token",
		preconditions: {
			hasWorkspace: true,
			readOnly: false,
			hasDraft: false,
			loading: false,
			...preconditions,
		},
		recover,
		reload,
	};
	return {
		mocks,
		recover,
		reload,
		run: () => importServerModel({ ...options, document }),
	};
}

describe("server model replacement", () => {
	it.each([
		{
			preconditions: { readOnly: true },
		},
		{
			preconditions: { hasDraft: true },
		},
		{
			preconditions: { loading: true },
		},
	])(
		"returns a precondition error without uploading: %j",
		async ({ preconditions }) => {
			const { run, mocks: client, recover, reload } = setup(preconditions);
			const result = await run();
			expect(result).toBeInstanceOf(ServerModelImportError);
			expect(client.getModel).not.toHaveBeenCalled();
			expect(client.createAccount).not.toHaveBeenCalled();
			expect(recover).not.toHaveBeenCalled();
			expect(reload).not.toHaveBeenCalled();
		},
	);

	it("creates the reviewed rows with the tab token, then reloads", async () => {
		const { run, mocks: client, recover, reload } = setup();
		expect(await run()).toBe(true);
		expect(client.getModel).toHaveBeenCalledOnce();
		expect(client.createAccount).toHaveBeenCalledExactlyOnceWith(
			account,
			expect.objectContaining({ authToken: "tab-token" }),
		);
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
		"propagates HTTP %i errors as values without a reload",
		async (status) => {
			const { run, mocks: client, reload } = setup();
			const error = new ApiHttpError({ status, message: "Server response" });
			client.getModel.mockResolvedValue(error);
			expect(await run()).toBe(error);
			expect(reload).not.toHaveBeenCalled();
		},
	);

	it("propagates a network error without changing its message or identity", async () => {
		const { run, mocks: client, reload } = setup();
		const error = new Error("Network unavailable");
		client.getModel.mockResolvedValue(error);
		expect(await run()).toBe(error);
		expect(reload).not.toHaveBeenCalled();
	});

	it("reports only validation errors and keeps the existing model without reloading", async () => {
		const { run, mocks: client, reload } = setup();
		client.createAccount.mockResolvedValue({
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
		const result = await run();
		expect(result).toBeInstanceOf(ServerModelImportError);
		expect(String((result as Error).message)).toContain("Account is missing.");
		expect(reload).not.toHaveBeenCalled();
	});

	it("accepts warning-only rows and reloads", async () => {
		const { run, mocks: client, reload } = setup();
		client.createAccount.mockResolvedValue({
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
			const { run, recover, mocks, reload } = setup({
				hasWorkspace: false,
				readOnly: true,
				hasDraft: true,
				loading: true,
			});
			recover.mockResolvedValue(activated);
			expect(await run()).toBe(activated);
			expect(recover).toHaveBeenCalledExactlyOnceWith(document);
			expect(mocks.getModel).not.toHaveBeenCalled();
			expect(reload).not.toHaveBeenCalled();
		},
	);
});
