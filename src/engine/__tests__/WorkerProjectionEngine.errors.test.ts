// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerProjectionEngine } from "@/engine/WorkerProjectionEngine";
import {
	createBaseDocument,
	makeSettings,
} from "@/lib/projection/__fixtures__";

class CrashWorker {
	static instance: CrashWorker;

	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: (() => void) | null = null;
	postMessage = vi.fn();
	terminate = vi.fn();

	constructor() {
		CrashWorker.instance = this;
	}
}

describe("WorkerProjectionEngine crash diagnostics", () => {
	beforeEach(() => vi.stubGlobal("Worker", CrashWorker));
	afterEach(() => vi.unstubAllGlobals());

	it("includes browser error details when a worker module cannot load", async () => {
		const promise = new WorkerProjectionEngine().project({
			document: createBaseDocument(),
			projectionSettings: makeSettings(),
			overrides: {
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
		});

		CrashWorker.instance.onerror?.(
			new ErrorEvent("error", { message: "Failed to load worker module." }),
		);

		await expect(promise).rejects.toThrow(
			"Projection worker crashed. Failed to load worker module.",
		);
		expect(CrashWorker.instance.terminate).toHaveBeenCalledOnce();
	});
});
