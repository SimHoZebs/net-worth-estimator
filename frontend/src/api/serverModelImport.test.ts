import { describe, expect, it, vi } from "vitest";
import { type ApiClient, ApiHttpError } from "./client.ts";
import type { FinancialModelDocument } from "./contracts.ts";
import {
	importServerModel,
	ServerModelImportError,
	type ServerModelImportOptions,
} from "./serverModelImport.ts";

const document: FinancialModelDocument = {
	sourcePath: "models/reviewed-model",
	accounts: [],
	checkpoints: [],
	postings: [],
	evaluations: {
		financialIndependence: [],
		netWorthThreshold: [],
		postingFulfillment: [],
	},
};

function setup(
	preconditions: Partial<ServerModelImportOptions["preconditions"]> = {},
) {
	const putModel = vi
		.fn<ApiClient["putModel"]>()
		.mockResolvedValue({ document, issues: [] });
	const recover = vi
		.fn<ServerModelImportOptions["recover"]>()
		.mockResolvedValue(true);
	const reload = vi
		.fn<ServerModelImportOptions["reload"]>()
		.mockResolvedValue(undefined);
	const options: ServerModelImportOptions = {
		client: { putModel },
		authToken: "tab-token",
		preconditions: {
			hasWorkspace: true,
			readOnly: false,
			hasDraft: false,
			loading: false,
			revision: '"reviewed-revision"',
			...preconditions,
		},
		recover,
		reload,
	};
	return {
		putModel,
		recover,
		reload,
		run: () => importServerModel({ ...options, document }),
	};
}

describe("server model replacement", () => {
	it.each([
		{
			preconditions: { readOnly: true },
			message: "The server is read-only. The selected model was not uploaded.",
		},
		{
			preconditions: { hasDraft: true },
			message:
				"Save or discard your temporary server plan before importing another model.",
		},
		{
			preconditions: { loading: true },
			message:
				"Wait for the current server operation to finish before importing a model.",
		},
		{
			preconditions: { revision: null },
			message:
				"The server did not provide a model content identity. Reload the current model before importing.",
		},
		{
			preconditions: { revision: "" },
			message:
				"The server did not provide a model content identity. Reload the current model before importing.",
		},
	])(
		"returns a precondition error without uploading: $message",
		async ({ preconditions, message }) => {
			const { run, putModel, recover, reload } = setup(preconditions);
			const result = await run();
			expect(result).toBeInstanceOf(ServerModelImportError);
			expect(result).toHaveProperty("message", message);
			expect(putModel).not.toHaveBeenCalled();
			expect(recover).not.toHaveBeenCalled();
			expect(reload).not.toHaveBeenCalled();
		},
	);

	it("uploads the reviewed document with its revision and tab token, then reloads", async () => {
		const { run, putModel, recover, reload } = setup();
		expect(await run()).toBe(true);
		expect(putModel).toHaveBeenCalledExactlyOnceWith(document, {
			authToken: "tab-token",
			ifMatch: '"reviewed-revision"',
		});
		expect(reload).toHaveBeenCalledOnce();
		expect(putModel.mock.invocationCallOrder[0]).toBeLessThan(
			reload.mock.invocationCallOrder[0]!,
		);
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

	it("reloads a stale revision once and returns the existing conflict message without retrying the write", async () => {
		const { run, putModel, reload } = setup();
		const conflict = new ApiHttpError({ status: 412, message: "Stale model" });
		putModel.mockResolvedValue(conflict);
		const result = await run();
		expect(result).toBeInstanceOf(ServerModelImportError);
		expect(result).toHaveProperty(
			"message",
			"The server model changed while this import was being reviewed. The latest model has been loaded; review it before importing again.",
		);
		expect(result).toHaveProperty("cause", conflict);
		expect(putModel).toHaveBeenCalledOnce();
		expect(reload).toHaveBeenCalledOnce();
		expect(putModel.mock.invocationCallOrder[0]).toBeLessThan(
			reload.mock.invocationCallOrder[0]!,
		);
	});

	it.each([401, 403, 500])(
		"propagates HTTP %i errors as values without a reload",
		async (status) => {
			const { run, putModel, reload } = setup();
			const error = new ApiHttpError({ status, message: "Server response" });
			putModel.mockResolvedValue(error);
			expect(await run()).toBe(error);
			expect(reload).not.toHaveBeenCalled();
		},
	);

	it("propagates a network error without changing its message or identity", async () => {
		const { run, putModel, reload } = setup();
		const error = new Error("Network unavailable");
		putModel.mockResolvedValue(error);
		expect(await run()).toBe(error);
		expect(reload).not.toHaveBeenCalled();
	});

	it("reports only validation errors and keeps the existing model without reloading", async () => {
		const { run, putModel, reload } = setup();
		putModel.mockResolvedValue({
			document,
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
				{
					severity: "error",
					code: "posting",
					path: [],
					message: "Posting is invalid.",
				},
			],
		});
		const result = await run();
		expect(result).toBeInstanceOf(ServerModelImportError);
		expect(result).toHaveProperty(
			"message",
			"The server rejected this model: Account is missing. Posting is invalid.",
		);
		expect(reload).not.toHaveBeenCalled();
	});

	it("retains the fallback validation message when the server provides no detail", async () => {
		const { run, putModel, reload } = setup();
		putModel.mockResolvedValue({
			document,
			issues: [{ severity: "error", code: "invalid", path: [], message: "" }],
		});
		expect(await run()).toHaveProperty(
			"message",
			"The server rejected this model.",
		);
		expect(reload).not.toHaveBeenCalled();
	});

	it("accepts warning-only models and reloads their canonical state", async () => {
		const { run, putModel, reload } = setup();
		putModel.mockResolvedValue({
			document,
			issues: [
				{
					severity: "warning",
					code: "age",
					path: [],
					message: "Checkpoint is old.",
				},
			],
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
			const { run, recover, putModel, reload } = setup({
				hasWorkspace: false,
				readOnly: true,
				hasDraft: true,
				loading: true,
				revision: null,
			});
			recover.mockResolvedValue(activated);
			expect(await run()).toBe(activated);
			expect(recover).toHaveBeenCalledExactlyOnceWith(document);
			expect(putModel).not.toHaveBeenCalled();
			expect(reload).not.toHaveBeenCalled();
		},
	);
});
