import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	canonicalApiBaseUrl,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import type { FinancialModelResponse, ServerStatus } from "../api/index.ts";
import {
	resetWorkspaceForResource,
	resetWorkspaceStore,
	suspendWorkspaceForVerification,
	type RemoteApiClient,
	useWorkspaceStore,
} from "./workspaceStore.ts";

function owner(id: string) {
	acceptResourceScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id,
				kind: "private",
				permissions: ["plan:read", "plan:write"],
			},
			subject: id,
		},
		suspendResourceScope(),
	);
}

beforeEach(() => {
	owner("plans/a");
	resetWorkspaceStore();
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
});
afterEach(() => {
	resetWorkspaceStore();
	suspendResourceScope();
	vi.unstubAllGlobals();
});

describe("workspace resource reset", () => {
	it("suspends old engine callbacks without deleting same-account data or recovery", async () => {
		let finish: (value: FinancialModelResponse) => void = () => {};
		useWorkspaceStore.getState().bindEngine({
			getStatus: async () => ({ readOnly: false }),
			getModel: () =>
				new Promise<FinancialModelResponse>((resolve) => {
					finish = resolve;
				}),
			listAmountPresets: async () => ({ presets: [] }),
		} as unknown as RemoteApiClient);
		useWorkspaceStore.setState({ serverRevision: "verified-account-data" });
		useWorkspaceStore.getState().bootWorkspace();
		const old = useWorkspaceStore.getState().engine;
		const pending = old.hydrationPromise;
		old.saveController = new AbortController();
		const recovery = {
			version: 1 as const,
			draft: null,
			draftPresentation: null,
			baseRevision: "private-draft",
		};
		old.volatileState = recovery;
		suspendResourceScope();
		suspendWorkspaceForVerification();
		expect(old.hydrationController?.signal.aborted).toBe(true);
		expect(old.saveController.signal.aborted).toBe(true);
		finish({ document: null, issues: [] });
		await pending;
		expect(useWorkspaceStore.getState().engine).not.toBe(old);
		expect(useWorkspaceStore.getState().engine.volatileState).toBe(recovery);
		expect(useWorkspaceStore.getState().serverRevision).toBe(
			"verified-account-data",
		);
	});

	it("aborts old model/save work and prevents late hydration from changing the new engine", async () => {
		let finishA: (value: FinancialModelResponse) => void = () => {};
		let finishB: (value: FinancialModelResponse) => void = () => {};
		const makeClient = (
			id: string,
			capture: (finish: (value: FinancialModelResponse) => void) => void,
		) =>
			({
				getStatus: async () => ({ readOnly: false }),
				getModel: () =>
					new Promise<FinancialModelResponse>((resolve) => capture(resolve)),
				listAmountPresets: async () => ({ presets: [{ id }] }),
			}) as unknown as RemoteApiClient;
		const first = makeClient("private-a-recipe", (finish) => {
			finishA = finish;
		});
		useWorkspaceStore.getState().bindEngine(first);
		useWorkspaceStore.getState().bootWorkspace();
		const old = useWorkspaceStore.getState().engine;
		const oldHydration = old.hydrationPromise;
		old.saveController = new AbortController();
		resetWorkspaceForResource();
		owner("plans/b");
		expect(old.hydrationController?.signal.aborted).toBe(true);
		expect(old.saveController.signal.aborted).toBe(true);
		useWorkspaceStore.getState().bindEngine(
			makeClient("private-b-recipe", (finish) => {
				finishB = finish;
			}),
		);
		useWorkspaceStore.getState().bootWorkspace();
		finishA({ document: null, issues: [] });
		await oldHydration;
		expect(useWorkspaceStore.getState().engine.hydrating).toBe(true);
		expect(useWorkspaceStore.getState().loading).toBe(true);
		expect(useWorkspaceStore.getState().serverPresets).toBeNull();
		expect(useWorkspaceStore.getState().serverDocument).toBeNull();
		const newHydration = useWorkspaceStore.getState().engine.hydrationPromise;
		finishB({ document: null, issues: [] });
		await newHydration;
		expect(useWorkspaceStore.getState().serverPresets).toEqual([
			{ id: "private-b-recipe" },
		]);
	});

	it("ignores a late status response instead of applying the previous account's access", async () => {
		let finish: (value: ServerStatus) => void = () => {};
		useWorkspaceStore.getState().bindEngine({
			getStatus: () =>
				new Promise<ServerStatus>((resolve) => {
					finish = resolve;
				}),
		} as unknown as RemoteApiClient);
		const pending = useWorkspaceStore.getState().refreshStatus();
		resetWorkspaceForResource();
		owner("plans/b");
		useWorkspaceStore.setState({
			status: { readOnly: true },
		});
		finish({ readOnly: false });
		await pending;
		expect(useWorkspaceStore.getState().status).toEqual({
			readOnly: true,
		});
	});

	it("ignores late recipe reads and writes from the previous account", async () => {
		let finishRead: (value: unknown) => void = () => {};
		let finishWrite: (value: unknown) => void = () => {};
		useWorkspaceStore.getState().bindEngine({
			listAmountPresets: () =>
				new Promise((resolve) => {
					finishRead = resolve;
				}),
			createAmountPreset: () =>
				new Promise((resolve) => {
					finishWrite = resolve;
				}),
		} as unknown as RemoteApiClient);
		const read = useWorkspaceStore.getState().refreshPresets();
		const write = useWorkspaceStore.getState().createPreset({} as never);
		resetWorkspaceForResource();
		owner("plans/b");
		useWorkspaceStore.setState({ serverPresets: [{ id: "b" }] as never });
		finishRead({ presets: [{ id: "private-a" }] });
		finishWrite({
			row: { id: "private-a-write" },
			persisted: true,
			issues: [],
		});
		await read;
		expect(await write).toBe(false);
		expect(useWorkspaceStore.getState().serverPresets).toEqual([{ id: "b" }]);
	});
});
