import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ApiHttpError,
	type FinancialModelDocument,
	type FinancialModelResponse,
	type IncomeDataSnapshot,
	type ProjectionResult,
	type ServerStatus,
	type StochasticProjectionResult,
} from "../api/index.ts";
import type { Plan } from "../domain/model.ts";
import {
	loadRemoteState,
	persistRemoteState,
	REMOTE_STORAGE_KEY,
	serverDocumentFingerprint,
} from "./remoteStorage.ts";
import {
	projectionResultToLocal,
	stochasticResultToLocal,
	useRemoteProjection,
} from "./useRemoteProjection.ts";
import { useRemoteWorkspace } from "./useRemoteWorkspace.ts";

interface Runtime {
	useState<T>(
		initial: T | (() => T),
	): [T, (value: T | ((previous: T) => T)) => void];
	useEffect(
		effect: () => undefined | (() => void),
		dependencies?: readonly unknown[],
	): void;
	useRef<T>(initial: T): { current: T };
	useMemo<T>(factory: () => T, dependencies?: readonly unknown[]): T;
	useCallback<T>(callback: T, dependencies?: readonly unknown[]): T;
}

const runtime = vi.hoisted(() => ({ current: null as Runtime | null }));

vi.mock("react", () => ({
	useState: <T>(initial: T | (() => T)) => runtime.current!.useState(initial),
	useEffect: (
		effect: () => undefined | (() => void),
		dependencies?: readonly unknown[],
	) => runtime.current!.useEffect(effect, dependencies),
	useRef: <T>(initial: T) => runtime.current!.useRef(initial),
	useMemo: <T>(factory: () => T, dependencies?: readonly unknown[]) =>
		runtime.current!.useMemo(factory, dependencies),
	useCallback: <T>(callback: T, dependencies?: readonly unknown[]) =>
		runtime.current!.useCallback(callback, dependencies),
}));

interface Rendered<T> {
	result: () => T;
	settle: () => Promise<void>;
	unmount: () => void;
}

function sameDependencies(
	left: readonly unknown[] | undefined,
	right: readonly unknown[] | undefined,
): boolean {
	if (left === right) return true;
	if (!left || !right || left.length !== right.length) return false;
	return left.every((value, index) => Object.is(value, right[index]));
}

function renderHook<T>(callback: () => T): Rendered<T> {
	const values: unknown[] = [];
	const refs: { current: unknown }[] = [];
	const memos: { dependencies?: readonly unknown[]; value: unknown }[] = [];
	const effects: {
		dependencies?: readonly unknown[];
		cleanup?: () => void;
		effect: () => undefined | (() => void);
		initialized: boolean;
	}[] = [];
	let cursor = 0;
	let result!: T;
	let disposed = false;

	const hookRuntime: Runtime = {
		useState<T>(initial: T | (() => T)) {
			const index = cursor++;
			if (!(index in values))
				values[index] =
					typeof initial === "function" ? (initial as () => T)() : initial;
			return [
				values[index] as T,
				(value: T | ((previous: T) => T)) => {
					values[index] =
						typeof value === "function"
							? (value as (previous: T) => T)(values[index] as T)
							: value;
				},
			];
		},
		useEffect(effect, dependencies) {
			const index = cursor++;
			const previous = effects[index];
			if (!previous)
				effects[index] = { dependencies, effect, initialized: false };
			else
				effects[index] = {
					dependencies,
					cleanup: previous.cleanup,
					effect,
					initialized: previous.initialized,
				};
		},
		useRef<T>(initial: T) {
			const index = cursor++;
			if (!refs[index]) refs[index] = { current: initial };
			return refs[index] as { current: T };
		},
		useMemo<T>(factory: () => T, dependencies?: readonly unknown[]) {
			const index = cursor++;
			const previous = memos[index];
			if (!previous || !sameDependencies(previous.dependencies, dependencies))
				memos[index] = { dependencies, value: factory() };
			return memos[index]!.value as T;
		},
		useCallback<T>(callback: T, dependencies?: readonly unknown[]) {
			cursor++;
			void dependencies;
			return callback;
		},
	};

	const render = () => {
		if (disposed) return;
		cursor = 0;
		result = callback();
		effects.forEach((entry, index) => {
			const previous = effects[index];
			if (!previous) return;
			if (
				previous.initialized &&
				sameDependencies(previous.dependencies, entry.dependencies)
			)
				return;
			previous.cleanup?.();
			entry.initialized = true;
			const cleanup = entry.effect();
			if (typeof cleanup === "function") effects[index] = { ...entry, cleanup };
		});
	};

	runtime.current = hookRuntime;
	render();

	return {
		result: () => result,
		settle: async () => {
			for (let index = 0; index < 12; index++) {
				await Promise.resolve();
				render();
			}
		},
		unmount: () => {
			disposed = true;
			effects.forEach((entry) => {
				entry.cleanup?.();
			});
			runtime.current = null;
		},
	};
}

function memoryStorage(): Storage & { values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
		clear: () => values.clear(),
		key: (index) => [...values.keys()][index] ?? null,
		get length() {
			return values.size;
		},
	};
}

function modelFixture(): FinancialModelDocument {
	return {
		sourcePath: "/configs/household.json",
		accounts: [
			{
				id: "cash",
				label: "Cash",
				minBalance: 0,
				maxBalance: null,
				color: null,
				enabled: true,
			},
			{
				id: "loan",
				label: "Loan",
				minBalance: 0,
				maxBalance: null,
				color: null,
				enabled: true,
			},
		],
		checkpoints: [
			{ Date: "2026-01-31", AccountId: "cash", Balance: 100 },
			{ Date: "2026-01-31", AccountId: "loan", Balance: -40 },
		],
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [
				{
					instanceId: "target",
					label: "Reach target",
					enabled: true,
					config: { target: 500 },
				},
			],
			postingFulfillment: [],
		},
		postings: [
			{
				id: "salary",
				label: "Salary",
				sourceAccountId: null,
				destinations: ["cash"],
				amount: { resolver: "expression", config: { expression: "100" } },
				frequency: "monthly",
				annualRate: 0,
				annualGrowthRate: 0,
				volatility: 0,
				startDate: "2026-02-01",
				endDate: null,
				annualCap: null,
				priority: 1,
				enabled: true,
			},
		],
	};
}

function withMovementAmount(plan: Plan, amount: number): Plan {
	return {
		...plan,
		movements: plan.movements.map((movement) =>
			movement.id === "salary" ? { ...movement, amount } : movement,
		),
	};
}

function withAccountName(plan: Plan, name: string): Plan {
	return {
		...plan,
		accounts: plan.accounts.map((account) =>
			account.id === "cash" ? { ...account, name } : account,
		),
	};
}

function projectionFixture(): ProjectionResult {
	return {
		timeline: {
			rows: [
				{
					date: "2026-01-31",
					isHistorical: true,
					netWorth: 60,
					accountSnapshots: [
						{
							accountId: "cash",
							date: "2026-01-31",
							balance: 100,
							impacts: [],
						},
						{
							accountId: "loan",
							date: "2026-01-31",
							balance: -40,
							impacts: [],
						},
					],
					externalInflowAmount: 0,
					externalOutflowAmount: 0,
					internalTransferAmount: 0,
					checkpointCorrections: [],
				},
				{
					date: "2026-02-01",
					isHistorical: false,
					netWorth: 160,
					accountSnapshots: [
						{
							accountId: "cash",
							date: "2026-02-01",
							balance: 200,
							impacts: [],
						},
						{
							accountId: "loan",
							date: "2026-02-01",
							balance: -40,
							impacts: [],
						},
					],
					externalInflowAmount: 100,
					externalOutflowAmount: 0,
					internalTransferAmount: 0,
					checkpointCorrections: [],
				},
			],
		},
		accountSummaries: [
			{
				accountId: "cash",
				label: "Cash",
				color: null,
				enabled: true,
				startingBalance: 100,
				endingBalance: 200,
			},
			{
				accountId: "loan",
				label: "Loan",
				color: null,
				enabled: true,
				startingBalance: -40,
				endingBalance: -40,
			},
		],
		totals: {
			externalInflowAmount: 100,
			externalOutflowAmount: 0,
			internalTransferAmount: 0,
		},
		milestones: {
			latestHistoricalDate: "2026-01-31",
			projectionStartDate: "2026-01-31",
		},
		summary: { currentNetWorth: 60, finalNetWorth: 160 },
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [
				{
					instanceId: "target",
					label: "Reach target",
					status: "satisfied",
					deterministic: { reached: true, firstReachedDate: "2026-02-01" },
					probabilistic: null,
					diagnostics: [],
				},
			],
			postingFulfillment: [],
		},
		movementEvents: [
			{
				date: "2026-02-01",
				sequence: 0,
				origin: { type: "posting", postingId: "salary" },
				requestedAmount: 100,
				realizedAmount: 100,
				accountDeltas: [{ accountId: "cash", delta: 100 }],
			},
		],
	};
}

function stochasticFixture(): StochasticProjectionResult {
	return {
		config: { runCount: 4, seed: 42 },
		bands: [
			{
				date: "2026-02-01",
				isHistorical: false,
				netWorth: { p10: 10, p25: 20, p50: 30, p75: 40, p90: 50 },
			},
		],
		milestones: {
			finalNetWorthPercentiles: { p10: 10, p25: 20, p50: 30, p75: 40, p90: 50 },
		},
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [
				{
					instanceId: "target",
					label: "Reach target",
					status: "satisfied",
					deterministic: { reached: true, firstReachedDate: "2026-02-01" },
					probabilistic: { probability: 0.75 },
					diagnostics: [],
				},
			],
			postingFulfillment: [
				{
					instanceId: "all",
					label: "All postings",
					status: "satisfied",
					deterministic: { postingIds: null },
					probabilistic: { fullFulfillmentProbability: 0.6 },
					diagnostics: [],
				},
			],
		},
	};
}

function clientFixture(
	put: (document: FinancialModelDocument) => Error | FinancialModelResponse,
) {
	const model = modelFixture();
	const client = {
		getStatus: vi.fn(
			async (): Promise<ServerStatus> => ({
				readOnly: false,
				authEnabled: true,
			}),
		),
		getModel: vi.fn(
			async (): Promise<FinancialModelResponse> => ({
				document: model,
				issues: [],
				revision: '"sha256-test"',
			}),
		),
		getIncomeData: vi.fn(
			async (): Promise<IncomeDataSnapshot> => ({
				incomeSources: [],
				taxProfiles: [],
			}),
		),
		putModel: vi.fn(async (document: FinancialModelDocument) => put(document)),
	};
	return { client, model };
}

afterEach(() => {
	vi.unstubAllGlobals();
	runtime.current = null;
});

describe("remote workspace state", () => {
	it("hydrates server state and persists a draft without storing the bearer token", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() =>
			useRemoteWorkspace({ client, authToken: "secret-token" }),
		);
		await rendered.settle();

		expect(rendered.result().status).toEqual({
			readOnly: false,
			authEnabled: true,
		});
		expect(
			rendered.result().plan?.accounts.map((account) => account.id),
		).toEqual(["cash", "loan"]);
		expect(rendered.result().incomeData).toEqual({
			incomeSources: [],
			taxProfiles: [],
		});
		expect(rendered.result().adapterReport?.warnings.length).toBeGreaterThan(0);

		const edited = withMovementAmount(rendered.result().plan!, 125);
		expect(rendered.result().updatePlan(edited)).toBe(true);
		await rendered.settle();
		const raw = storage.getItem(REMOTE_STORAGE_KEY) ?? "";
		expect(raw).toContain("125");
		expect(raw).not.toContain("secret-token");
		expect(loadRemoteState()).toMatchObject({
			version: 1,
			draft: { movements: [{ id: "salary", amount: 125 }] },
		});
		rendered.unmount();
		const rehydrated = renderHook(() =>
			useRemoteWorkspace({ client, authToken: "secret-token" }),
		);
		await rehydrated.settle();
		expect(rehydrated.result().plan?.movements[0]?.amount).toBe(125);
		rehydrated.unmount();
	});

	it("keeps a draft stale when the authoritative server document changed", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client: firstClient } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const first = renderHook(() => useRemoteWorkspace({ client: firstClient }));
		await first.settle();
		expect(
			first.result().updatePlan(withMovementAmount(first.result().plan!, 125)),
		).toBe(true);
		const stored = loadRemoteState();
		expect(stored).not.toBeInstanceOf(Error);
		if (stored instanceof Error || stored === null)
			throw new Error("Expected a stored remote draft.");
		expect(stored.baseFingerprint).toBe(
			serverDocumentFingerprint(modelFixture()),
		);
		first.unmount();

		const changedModel = modelFixture();
		const changedPosting = changedModel.postings[0]!;
		changedModel.postings[0] = {
			...changedPosting,
			amount: {
				resolver: "expression",
				config: { expression: "200" },
				inputs: {},
			},
		};
		const { client: changedClient } = clientFixture(() => ({
			document: changedModel,
			issues: [],
		}));
		changedClient.getModel.mockResolvedValue({
			document: changedModel,
			issues: [],
			revision: '"sha256-changed"',
		});
		const rendered = renderHook(() =>
			useRemoteWorkspace({ client: changedClient }),
		);
		await rendered.settle();

		expect(rendered.result().stale).toBe(true);
		expect(rendered.result().draftStale).toBe(true);
		expect(rendered.result().volatile).toBe(true);
		expect(rendered.result().workspace?.draft?.movements[0]?.amount).toBe(125);
		expect(rendered.result().error).toContain("stale");
		expect(await rendered.result().save()).toBe(false);
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 150)),
		).toBe(false);
		expect(rendered.result().discard()).toBe(false);
		expect(changedClient.putModel).not.toHaveBeenCalled();

		expect(await rendered.result().retry()).toBeUndefined();
		await rendered.settle();
		expect(rendered.result().stale).toBe(true);
		expect(rendered.result().workspace?.draft?.movements[0]?.amount).toBe(125);
		expect(await rendered.result().reloadDraft()).toBe(true);
		await rendered.settle();
		expect(rendered.result().stale).toBe(false);
		expect(rendered.result().workspace?.draft).toBeNull();
		rendered.unmount();
	});

	it("treats a draft without server identity metadata as recovery-only", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const first = renderHook(() => useRemoteWorkspace({ client }));
		await first.settle();
		expect(
			first.result().updatePlan(withMovementAmount(first.result().plan!, 125)),
		).toBe(true);
		first.unmount();
		const raw = JSON.parse(
			storage.getItem(REMOTE_STORAGE_KEY) ?? "{}",
		) as Record<string, unknown>;
		delete raw.baseFingerprint;
		delete raw.baseRevision;
		storage.setItem(REMOTE_STORAGE_KEY, JSON.stringify(raw));

		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(rendered.result().draftStale).toBe(true);
		expect(rendered.result().error).toContain("no recorded server identity");
		expect(await rendered.result().save()).toBe(false);
		expect(client.putModel).not.toHaveBeenCalled();
		rendered.unmount();
	});

	it("blocks editing when the server omits a model revision", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		client.getModel.mockResolvedValue({ document: modelFixture(), issues: [] });
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 125)),
		).toBe(false);
		await rendered.settle();
		expect(rendered.result().error).toContain("content identity");
		expect(client.putModel).not.toHaveBeenCalled();
		rendered.unmount();
	});

	it("keeps a stored draft available for export when hydration fails", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client: firstClient } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const first = renderHook(() => useRemoteWorkspace({ client: firstClient }));
		await first.settle();
		expect(
			first.result().updatePlan(withMovementAmount(first.result().plan!, 125)),
		).toBe(true);
		first.unmount();

		const { client: failedClient } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		failedClient.getStatus.mockResolvedValue(
			new Error("connection unavailable") as never,
		);
		const rendered = renderHook(() =>
			useRemoteWorkspace({ client: failedClient }),
		);
		await rendered.settle();
		expect(rendered.result().workspace).toBeNull();
		expect(rendered.result().recoveryDraft?.movements[0]?.amount).toBe(125);
		expect(rendered.result().error).toContain("connection unavailable");
		rendered.unmount();
	});

	it("surfaces a draft for recovery when retry fails after a workspace was loaded", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 125)),
		).toBe(true);
		client.getStatus.mockResolvedValue(
			new Error("connection unavailable") as never,
		);

		await rendered.result().retry();
		await rendered.settle();
		expect(rendered.result().workspace).toBeNull();
		expect(rendered.result().recoveryDraft?.movements[0]?.amount).toBe(125);
		expect(rendered.result().error).toContain("connection unavailable");
		rendered.unmount();
	});

	it("does not restore a stale workspace after a save loses a hydration race", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 125)),
		).toBe(true);

		let resolvePut!: (value: Error | FinancialModelResponse) => void;
		client.putModel.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvePut = resolve;
				}),
		);
		const savePromise = rendered.result().save();
		client.getStatus.mockResolvedValue(
			new Error("connection unavailable") as never,
		);
		await rendered.result().retry();
		resolvePut(new ApiHttpError({ message: "stale", status: 412 }));
		expect(await savePromise).toBe(false);
		await rendered.settle();
		expect(rendered.result().workspace).toBeNull();
		expect(rendered.result().recoveryDraft?.movements[0]?.amount).toBe(125);
		rendered.unmount();
	});

	it("reconciles a successful save before a queued retry hydrates", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		let current = structuredClone(modelFixture());
		let revision = '"sha256-initial"';
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		client.getModel.mockImplementation(async () => ({
			document: structuredClone(current),
			issues: [],
			revision,
		}));
		let resolvePut!: () => void;
		client.putModel.mockImplementation(
			(document) =>
				new Promise((resolve) => {
					resolvePut = () => {
						current = structuredClone(document);
						revision = '"sha256-next"';
						resolve({
							document: structuredClone(current),
							issues: [],
							revision,
						});
					};
				}),
		);
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 125)),
		).toBe(true);

		const savePromise = rendered.result().save();
		const retryPromise = rendered.result().retry();
		resolvePut();
		expect(await savePromise).toBe(true);
		await retryPromise;
		await rendered.settle();
		expect(rendered.result().workspace?.draft).toBeNull();
		expect(rendered.result().plan?.movements[0]?.amount).toBe(125);
		expect(rendered.result().draftStale).toBe(false);
		rendered.unmount();
	});

	it("preserves a queued save rejection through hydration", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 125)),
		).toBe(true);

		let resolvePut!: (value: FinancialModelResponse) => void;
		client.putModel.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvePut = resolve;
				}),
		);
		const savePromise = rendered.result().save();
		const retryPromise = rendered.result().retry();
		resolvePut({
			document: modelFixture(),
			revision: '"sha256-test"',
			issues: [
				{
					severity: "error",
					code: "invalid",
					message: "The server rejected this movement.",
					path: [],
				},
			],
		});
		expect(await savePromise).toBe(false);
		await rendered.settle();
		expect(rendered.result().error).toContain(
			"The server rejected this movement.",
		);
		await retryPromise;
		await rendered.settle();
		expect(rendered.result().error).toContain(
			"The server rejected this movement.",
		);
		expect(rendered.result().workspace?.draft?.movements[0]?.amount).toBe(125);
		rendered.unmount();
	});

	it("cancels an unsettled save on retry and restores the workspace", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 125)),
		).toBe(true);
		client.putModel.mockImplementation(() => new Promise(() => {}));

		const savePromise = rendered.result().save();
		await rendered.result().retry();
		await rendered.settle();
		expect(rendered.result().workspace?.draft?.movements[0]?.amount).toBe(125);
		expect(rendered.result().draftStale).toBe(false);
		void savePromise;
		rendered.unmount();
	});

	it("rejects draft disposal while a server save is active", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 125)),
		).toBe(true);
		let resolvePut!: (value: Error | FinancialModelResponse) => void;
		client.putModel.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvePut = resolve;
				}),
		);
		const savePromise = rendered.result().save();
		expect(rendered.result().discard()).toBe(false);
		await rendered.settle();
		expect(rendered.result().error).toContain("server operation");
		resolvePut({
			document: modelFixture(),
			issues: [],
			revision: '"sha256-test"',
		});
		await savePromise;
		await rendered.settle();
		expect(rendered.result().workspace?.draft).toBeNull();
		rendered.unmount();
	});

	it("does not let a canceled save clear a newer save lock", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 125)),
		).toBe(true);

		const resolvers: Array<(value: Error | FinancialModelResponse) => void> =
			[];
		client.putModel.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvers.push(resolve);
				}),
		);
		const firstSave = rendered.result().save();
		await rendered.result().retry();
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 150)),
		).toBe(true);
		const secondSave = rendered.result().save();
		resolvers[0]?.(new ApiHttpError({ message: "stale", status: 412 }));
		await firstSave;
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 175)),
		).toBe(false);
		void secondSave;
		rendered.unmount();
	});

	it("preserves a failed import hydration error after a 412", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(
			() => new ApiHttpError({ message: "already exists", status: 412 }),
		);
		client.getModel
			.mockResolvedValueOnce({ document: null, issues: [] })
			.mockRejectedValue(new Error("authoritative load failed"));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(await rendered.result().importServerDocument(modelFixture())).toBe(
			false,
		);
		await rendered.settle();
		expect(rendered.result().error).toContain("authoritative load failed");
		expect(rendered.result().error).not.toContain(
			"latest server model has been loaded",
		);
		expect(await rendered.result().importServerDocument(modelFixture())).toBe(
			false,
		);
		expect(client.putModel).toHaveBeenCalledTimes(2);
		rendered.unmount();
	});

	it("exposes a stored draft when the server has no model", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client: firstClient } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const first = renderHook(() => useRemoteWorkspace({ client: firstClient }));
		await first.settle();
		expect(
			first.result().updatePlan(withMovementAmount(first.result().plan!, 125)),
		).toBe(true);
		first.unmount();

		const { client: emptyClient } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		emptyClient.getModel.mockResolvedValue({
			document: null,
			issues: [],
		} as FinancialModelResponse);
		const recovery = renderHook(() =>
			useRemoteWorkspace({ client: emptyClient }),
		);
		await recovery.settle();
		expect(recovery.result().workspace).toBeNull();
		expect(recovery.result().recoveryDraft?.movements[0]?.amount).toBe(125);
		recovery.unmount();
	});

	it("keeps a clean stored draft usable and discardable", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const first = renderHook(() => useRemoteWorkspace({ client }));
		await first.settle();
		expect(
			first.result().updatePlan(withMovementAmount(first.result().plan!, 125)),
		).toBe(true);
		first.unmount();

		const rehydrated = renderHook(() => useRemoteWorkspace({ client }));
		await rehydrated.settle();
		expect(rehydrated.result().stale).toBe(false);
		expect(rehydrated.result().workspace?.draft?.movements[0]?.amount).toBe(
			125,
		);
		expect(rehydrated.result().discard()).toBe(true);
		await rehydrated.settle();
		expect(rehydrated.result().workspace?.draft).toBeNull();
		expect(loadRemoteState()).toMatchObject({
			draft: null,
			baseFingerprint: null,
			baseRevision: null,
		});
		rehydrated.unmount();
	});

	it("returns false from discard and preserves a volatile draft when storage fails", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 125)),
		).toBe(true);
		await rendered.settle();
		vi.spyOn(storage, "setItem").mockImplementationOnce(() => {
			throw new Error("quota exceeded");
		});

		expect(rendered.result().discard()).toBe(false);
		await rendered.settle();
		expect(rendered.result().volatile).toBe(true);
		expect(rendered.result().workspace?.draft?.movements[0]?.amount).toBe(125);
		expect(rendered.result().error).toContain("could not store");

		await rendered.result().retry();
		await rendered.settle();
		expect(rendered.result().workspace?.draft?.movements[0]?.amount).toBe(125);
		rendered.unmount();
	});

	it("saves, re-fetches the authoritative model, and clears the local draft", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client, model } = clientFixture(() => ({
			document: model,
			issues: [
				{
					severity: "warning",
					code: "reviewed-warning",
					message: "Review the model warnings.",
					path: [],
				},
			],
		}));
		const rendered = renderHook(() =>
			useRemoteWorkspace({ client, authToken: "write-token" }),
		);
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 125)),
		).toBe(true);

		expect(await rendered.result().save()).toBe(true);
		await rendered.settle();
		expect(client.putModel).toHaveBeenCalledWith(
			expect.objectContaining({
				sourcePath: "/configs/household.json",
				postings: [
					expect.objectContaining({
						amount: expect.objectContaining({
							resolver: "expression",
							config: expect.objectContaining({ expression: "125" }),
						}),
					}),
				],
			}),
			expect.objectContaining({ authToken: "write-token" }),
		);
		expect(client.getModel).toHaveBeenCalledTimes(2);
		expect(rendered.result().workspace?.draft).toBeNull();
		expect(loadRemoteState()).toMatchObject({ version: 1, draft: null });
		rendered.unmount();
	});

	it("sends the server revision when saving a remote draft", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		let current = structuredClone(modelFixture());
		let revision = '"sha256-initial"';
		const client = {
			getStatus: vi.fn(
				async (): Promise<ServerStatus> => ({
					readOnly: false,
					authEnabled: false,
				}),
			),
			getModel: vi.fn(
				async (): Promise<FinancialModelResponse> => ({
					document: structuredClone(current),
					issues: [],
					revision,
				}),
			),
			getIncomeData: vi.fn(
				async (): Promise<IncomeDataSnapshot> => ({
					incomeSources: [],
					taxProfiles: [],
				}),
			),
			putModel: vi.fn(
				async (
					document: FinancialModelDocument,
				): Promise<FinancialModelResponse> => {
					current = structuredClone(document);
					revision = '"sha256-next"';
					return { document: structuredClone(current), issues: [], revision };
				},
			),
		};
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withMovementAmount(rendered.result().plan!, 125)),
		).toBe(true);
		expect(await rendered.result().save()).toBe(true);
		expect(client.putModel).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ ifMatch: '"sha256-initial"' }),
		);
		rendered.unmount();
	});

	it("uses an If-Match wildcard when importing into an empty server", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		let stored: FinancialModelDocument | null = null;
		const client = {
			getStatus: vi.fn(
				async (): Promise<ServerStatus> => ({
					readOnly: false,
					authEnabled: false,
				}),
			),
			getModel: vi.fn(
				async (): Promise<FinancialModelResponse> => ({
					document: stored,
					issues: [],
				}),
			),
			getIncomeData: vi.fn(
				async (): Promise<IncomeDataSnapshot> => ({
					incomeSources: [],
					taxProfiles: [],
				}),
			),
			putModel: vi.fn(
				async (
					document: FinancialModelDocument,
				): Promise<FinancialModelResponse> => {
					stored = structuredClone(document);
					return {
						document: structuredClone(document),
						issues: [],
						revision: '"sha256-imported"',
					};
				},
			),
		};
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(await rendered.result().importServerDocument(modelFixture())).toBe(
			true,
		);
		expect(client.putModel).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ ifMatch: "*" }),
		);
		rendered.unmount();
	});

	it("retains the draft when a successful response contains validation errors", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [
				{
					severity: "error",
					code: "invalid-posting",
					message: "Posting salary is invalid.",
					path: ["postings", 0],
				},
			],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(
					withAccountName(rendered.result().plan!, "Keep rejected draft"),
				),
		).toBe(true);

		expect(await rendered.result().save()).toBe(false);
		await rendered.settle();
		expect(client.getModel).toHaveBeenCalledTimes(1);
		expect(rendered.result().workspace?.draft?.accounts[0]?.name).toBe(
			"Keep rejected draft",
		);
		expect(loadRemoteState()).toMatchObject({
			version: 1,
			draft: {
				accounts: expect.arrayContaining([
					expect.objectContaining({ name: "Keep rejected draft" }),
				]),
			},
		});
		expect(rendered.result().error).toContain("Posting salary is invalid.");
		expect(rendered.result().error).toContain("remains available locally");
		rendered.unmount();
	});

	it("retains a draft on 401 and generic save failures", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const unauthorized = clientFixture(
			() =>
				new ApiHttpError({
					message: "Authentication is required.",
					status: 401,
				}),
		);
		const first = renderHook(() =>
			useRemoteWorkspace({
				client: unauthorized.client,
				authToken: "bad-token",
			}),
		);
		await first.settle();
		expect(
			first
				.result()
				.updatePlan(withAccountName(first.result().plan!, "Keep me")),
		).toBe(true);
		expect(await first.result().save()).toBe(false);
		await first.settle();
		expect(first.result().workspace?.draft?.accounts[0]?.name).toBe("Keep me");
		expect(first.result().authRequired).toBe(true);
		expect(loadRemoteState()).toMatchObject({
			draft: {
				accounts: expect.arrayContaining([
					expect.objectContaining({ name: "Keep me" }),
				]),
			},
		});
		first.unmount();

		const failed = clientFixture(() => new Error("temporary failure"));
		const second = renderHook(() =>
			useRemoteWorkspace({ client: failed.client }),
		);
		await second.settle();
		expect(
			second
				.result()
				.updatePlan(withAccountName(second.result().plan!, "Keep this too")),
		).toBe(true);
		expect(await second.result().save()).toBe(false);
		await second.settle();
		expect(second.result().workspace?.draft?.accounts[0]?.name).toBe(
			"Keep this too",
		);
		expect(second.result().error).toContain("temporary failure");
		second.unmount();

		const forbidden = clientFixture(
			() =>
				new ApiHttpError({ message: "The server is read-only.", status: 403 }),
		);
		const third = renderHook(() =>
			useRemoteWorkspace({ client: forbidden.client }),
		);
		await third.settle();
		expect(
			third
				.result()
				.updatePlan(withAccountName(third.result().plan!, "Read-only draft")),
		).toBe(true);
		expect(await third.result().save()).toBe(false);
		await third.settle();
		expect(third.result().readOnly).toBe(true);
		expect(third.result().workspace?.draft?.accounts[0]?.name).toBe(
			"Read-only draft",
		);
		third.unmount();
	});

	it("rejects a lossy display import until explicit conversion review exists", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		const lossyPlan = {
			...rendered.result().plan!,
			assumptions: { inflation: 2, volatility: 0 },
		};
		expect(rendered.result().replace(lossyPlan)).toBe(false);
		await rendered.settle();
		expect(rendered.result().error).toContain("explicit conversion review");
		rendered.unmount();
	});

	it("rejects a new assumptions edit without mutating the workspace", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		const plan = rendered.result().plan!;
		const edited = { ...plan, assumptions: { inflation: 2, volatility: 0 } };

		expect(rendered.result().updatePlan(edited)).toBe(false);
		await rendered.settle();
		expect(rendered.result().workspace?.draft).toBeNull();
		expect(rendered.result().plan?.assumptions).toEqual({
			inflation: 0,
			volatility: 0,
		});
		expect(rendered.result().error).toContain("assumptions");
		expect(rendered.result().error).toContain("inflation");
		expect(client.putModel).not.toHaveBeenCalled();
		rendered.unmount();
	});

	it("rejects a new account annual return edit without mutating the workspace", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		const plan = rendered.result().plan!;
		const edited = {
			...plan,
			accounts: plan.accounts.map((account) =>
				account.id === "cash" ? { ...account, annualReturn: 3 } : account,
			),
		};

		expect(rendered.result().updatePlan(edited)).toBe(false);
		await rendered.settle();
		expect(rendered.result().workspace?.draft).toBeNull();
		expect(rendered.result().plan?.accounts[0]?.annualReturn).toBe(0);
		expect(rendered.result().error).toContain("annualReturn");
		expect(rendered.result().error).toContain("annual return");
		rendered.unmount();
	});

	it("rejects a new reserve goal without mutating the workspace", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		const plan = rendered.result().plan!;
		const edited = {
			...plan,
			goals: [
				...plan.goals,
				{
					id: "reserve",
					name: "Reserve",
					kind: "reserve" as const,
					target: 1000,
					accountId: "cash",
					enabled: true,
				},
			],
		};

		expect(rendered.result().updatePlan(edited)).toBe(false);
		await rendered.settle();
		expect(rendered.result().workspace?.draft).toBeNull();
		expect(
			rendered.result().plan?.goals.some((goal) => goal.id === "reserve"),
		).toBe(false);
		expect(rendered.result().error).toContain("goals.reserve");
		expect(rendered.result().error).toContain("Reserve goals");
		rendered.unmount();
	});

	it("allows a movement amount edit represented by an expression posting", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		const edited = withMovementAmount(rendered.result().plan!, 125);

		expect(rendered.result().updatePlan(edited)).toBe(true);
		await rendered.settle();
		expect(rendered.result().workspace?.draft?.movements[0]?.amount).toBe(125);
		expect(rendered.result().draftDocument?.postings[0]?.amount).toEqual({
			resolver: "expression",
			config: { expression: "125" },
			inputs: {},
		});
		expect(rendered.result().error).toBeNull();

		expect(await rendered.result().save()).toBe(true);
		expect(client.putModel).toHaveBeenCalledWith(
			expect.objectContaining({
				postings: [
					expect.objectContaining({
						amount: expect.objectContaining({
							resolver: "expression",
							config: expect.objectContaining({ expression: "125" }),
						}),
					}),
				],
			}),
			expect.anything(),
		);
		rendered.unmount();
	});

	it("retains a stored draft when save finds conversion losses", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const { client } = clientFixture(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const first = renderHook(() => useRemoteWorkspace({ client }));
		await first.settle();
		const lossyPlan = {
			...first.result().plan!,
			assumptions: { inflation: 2, volatility: 0 },
		};
		expect(
			persistRemoteState({
				version: 1,
				draft: lossyPlan,
				draftSidecar: first.result().savedSidecar,
				baseFingerprint: serverDocumentFingerprint(modelFixture()),
				baseRevision: '"sha256-test"',
				snapshot: null,
			}),
		).toBeNull();
		first.unmount();

		const rendered = renderHook(() => useRemoteWorkspace({ client }));
		await rendered.settle();
		expect(rendered.result().workspace?.draft).toEqual(lossyPlan);
		expect(await rendered.result().save()).toBe(false);
		await rendered.settle();
		expect(client.putModel).not.toHaveBeenCalled();
		expect(rendered.result().workspace?.draft).toEqual(lossyPlan);
		expect(rendered.result().error).toContain("assumptions");
		expect(rendered.result().error).toContain("remains available locally");
		rendered.unmount();
	});
});

describe("remote projection mapping and SSE", () => {
	it("maps server rows, movement events, totals, and threshold dates to the local projection", () => {
		const document = modelFixture();
		const result = projectionFixture();
		result.timeline.rows[0]!.netWorth = 90;
		const local = projectionResultToLocal(result, document);
		expect(local.points.map((point) => point.date)).toEqual([
			"2026-01-31",
			"2026-02-01",
		]);
		expect(local.currentNetWorth).toBe(60);
		expect(local.points[0]?.total).toBe(90);
		expect(local.points[1]?.balances).toEqual({ cash: 200, loan: -40 });
		expect(local.movements[0]).toMatchObject({
			name: "Salary",
			fromId: null,
			toId: "cash",
			requested: 100,
			realized: 100,
			available: null,
		});
		expect(local.firstFailure).toBeNull();
		expect(local.goals[0]?.firstDate).toBe("2026-02-01");
		expect(local).toMatchObject({ inflows: 100, outflows: 0, transfers: 0 });
		const documentWithoutResult = {
			...document,
			evaluations: {
				...document.evaluations,
				netWorthThreshold: [
					...document.evaluations.netWorthThreshold,
					{
						instanceId: "missing",
						label: "Missing result",
						enabled: true,
						config: { target: 900 },
					},
				],
			},
		};
		const withoutResult = {
			...projectionFixture(),
			evaluations: {
				...projectionFixture().evaluations,
				netWorthThreshold: [],
			},
		};
		const indeterminate = projectionResultToLocal(
			withoutResult,
			documentWithoutResult,
		).goals.find((goal) => goal.goal.id === "missing");
		expect(indeterminate?.firstDate).toBeNull();
		expect(indeterminate?.goal.name).toContain("indeterminate");
	});

	it("keeps start-date events when the start has no checkpoint", () => {
		const document = { ...modelFixture(), checkpoints: [] };
		const result = projectionFixture();
		result.milestones.projectionStartDate = "2026-01-31";
		result.movementEvents = [
			{ ...result.movementEvents![0]!, date: "2026-01-31" },
		];
		expect(projectionResultToLocal(result, document).movements).toHaveLength(1);
	});

	it("accepts movement events without account deltas", () => {
		const document = modelFixture();
		const result = projectionFixture();
		result.movementEvents![0]!.accountDeltas = null;
		const local = projectionResultToLocal(result, document);
		expect(local.movements[0]).toMatchObject({
			movementId: "salary",
			requested: 100,
			realized: 100,
		});
	});

	it("maps binding evidence and excludes movements on or before the plan start", () => {
		const document = modelFixture();
		const result = projectionFixture();
		const baseEvent = result.movementEvents![0]!;
		const historicalEvent = { ...baseEvent, date: "2026-01-31" };
		const sourceFloorEvent = {
			...baseEvent,
			date: "2026-02-02",
			sequence: 1,
			requestedAmount: 200,
			realizedAmount: 100,
			accountDeltas: [{ accountId: "cash", delta: -100 }],
		};
		Object.assign(sourceFloorEvent, {
			bindingConstraints: [{ type: "source-floor", accountId: "cash" }],
			availableAmount: 75,
		});
		const destinationEvent = {
			...baseEvent,
			date: "2026-02-03",
			sequence: 2,
			requestedAmount: 200,
			realizedAmount: 100,
		};
		Object.assign(destinationEvent, {
			bindingConstraints: [
				{ type: "destination-ceiling", accountIds: ["cash"] },
			],
		});
		const annualEvent = {
			...baseEvent,
			date: "2026-02-04",
			sequence: 3,
			requestedAmount: 200,
			realizedAmount: 100,
		};
		Object.assign(annualEvent, {
			bindingConstraints: [{ type: "action-limit" }],
		});
		result.movementEvents = [
			historicalEvent,
			sourceFloorEvent,
			destinationEvent,
			annualEvent,
		] as ProjectionResult["movementEvents"];

		const local = projectionResultToLocal(result, document);
		expect(local.movements).toHaveLength(3);
		expect(local.movements[0]).toMatchObject({
			available: 75,
			constraint: "Protected account balance",
			constraintTypes: ["source-floor"],
		});
		expect(local.movements[1]).toMatchObject({
			available: null,
			constraint: "Destination account ceiling",
			constraintTypes: ["destination-ceiling"],
		});
		expect(local.movements[2]).toMatchObject({
			available: null,
			constraint: "Annual movement limit",
			constraintTypes: ["action-limit"],
		});
		expect(local.firstFailure).toBe(local.movements[0]);
	});

	it("maps stochastic bands and evaluation envelopes to RangeResult", () => {
		const range = stochasticResultToLocal(stochasticFixture());
		expect(range).toEqual({
			points: [{ date: "2026-02-01", lower: 10, median: 30, upper: 50 }],
			count: 4,
			goalSuccess: { target: 0.75 },
			failureShare: 0.4,
		});
	});

	it("calls deterministic and POST-SSE projections and maps partial then result events", async () => {
		const stochastic = stochasticFixture();
		const progress = {
			phase: "stochastic-runs",
			completedRuns: 2,
			totalRuns: 4,
			fraction: 0.5,
			evaluationWorkloads: [],
		};
		const stream = `event: progress\ndata: ${JSON.stringify({ progress })}\n\nevent: partial\ndata: ${JSON.stringify({ progress, partial: stochastic })}\n\nevent: result\ndata: ${JSON.stringify({ result: stochastic })}\n\n`;
		const client = {
			projectDeterministic: vi.fn(async () => ({
				result: projectionFixture(),
				issues: [],
			})),
			projectStochastic: vi.fn(
				async () =>
					new Response(stream, {
						status: 200,
						headers: { "content-type": "text/event-stream" },
					}),
			),
		};
		const rendered = renderHook(() =>
			useRemoteProjection({
				client,
				document: modelFixture(),
				years: 2,
				ranges: true,
				authToken: "projection-token",
			}),
		);
		await rendered.settle();

		expect(rendered.result().base).toMatchObject({ inflows: 100 });
		expect(rendered.result().range).toMatchObject({
			count: 4,
			goalSuccess: { target: 0.75 },
			failureShare: 0.4,
		});
		expect(rendered.result().progress).toBe(1);
		expect(rendered.result().rangeError).toBeNull();
		expect(client.projectDeterministic).toHaveBeenCalledWith(
			expect.objectContaining({
				settings: expect.objectContaining({
					horizonYears: 2,
					fallbackProjectionStartDate: "2026-01-31",
				}),
			}),
			expect.objectContaining({ authToken: "projection-token" }),
		);
		expect(client.projectStochastic).toHaveBeenCalledWith(
			expect.objectContaining({ config: { runCount: 400, seed: 42 } }),
			expect.objectContaining({ authToken: "projection-token" }),
		);
		rendered.unmount();
	});

	it("preserves an SSE error event as the range error", async () => {
		const client = {
			projectDeterministic: vi.fn(async () => ({
				result: projectionFixture(),
				issues: [],
			})),
			projectStochastic: vi.fn(
				async () =>
					new Response('event: error\ndata: {"error":"range failed"}\n\n', {
						status: 200,
						headers: { "content-type": "text/event-stream" },
					}),
			),
		};
		const rendered = renderHook(() =>
			useRemoteProjection({
				client,
				document: modelFixture(),
				years: 1,
				ranges: true,
			}),
		);
		await rendered.settle();
		expect(rendered.result().rangeError).toBe("range failed");
		rendered.unmount();
	});

	it("reports a clear error instead of using example data without a document", async () => {
		const rendered = renderHook(() =>
			useRemoteProjection({ years: 2, ranges: false }),
		);
		await rendered.settle();
		expect(rendered.result().base).toBeInstanceOf(Error);
		expect((rendered.result().base as Error).message).toContain(
			"No server financial model",
		);
		rendered.unmount();
	});
});

describe("remote draft storage", () => {
	it("uses a stable semantic server fingerprint", () => {
		const document = modelFixture();
		const reordered = {
			postings: document.postings,
			evaluations: document.evaluations,
			checkpoints: document.checkpoints,
			accounts: document.accounts,
			sourcePath: document.sourcePath,
		};
		const changed = modelFixture();
		changed.postings[0] = {
			...changed.postings[0]!,
			amount: {
				resolver: "expression",
				config: { expression: "200" },
				inputs: {},
			},
		};
		expect(serverDocumentFingerprint(reordered)).toBe(
			serverDocumentFingerprint(document),
		);
		expect(serverDocumentFingerprint(changed)).not.toBe(
			serverDocumentFingerprint(document),
		);
	});

	it("round-trips a versioned draft and rejects malformed data", () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const state = {
			version: 1 as const,
			draft: null,
			draftSidecar: null,
			snapshot: null,
		};
		expect(persistRemoteState(state)).toBeNull();
		expect(loadRemoteState()).toEqual(state);
		storage.setItem(REMOTE_STORAGE_KEY, "{bad");
		expect(loadRemoteState()).toBeInstanceOf(Error);
	});
});
