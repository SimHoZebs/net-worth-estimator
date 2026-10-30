// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	renderHook as renderHookRTL,
	waitFor,
} from "@testing-library/react";
import { createElement, Fragment, type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	getUserScope,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import {
	ApiHttpError,
	type ApiRequestOptions,
	type BackendPosting,
	type FinancialModelDocument,
	type FinancialModelResponse,
	type ProjectionResult,
	type StochasticProjectionResult,
	type StochasticProjectionRequest,
} from "../api/index.ts";
import type { Plan } from "../domain/model.ts";

import { serverDocumentFingerprint } from "./remoteStorage.ts";
import { memoryStorage } from "../mocks/storage.ts";
import {
	clearResourceQueryCache,
	resetServerQueryCache,
	serverQueryClient,
} from "./serverQuery.ts";
import { resetNotifications, useNotifications } from "./notifications.ts";
import { resetUiStore, useUiStore } from "./uiStore.ts";
import {
	projectionResultToLocal,
	stochasticResultToLocal,
	useRemoteProjection,
} from "./useRemoteProjection.ts";
import { useWorkspaceStartup } from "./useWorkspaceStartup.ts";
import {
	deriveDraftDocument,
	resetWorkspaceStore,
	useWorkspaceStore,
	draftConflict,
} from "./workspaceStore.ts";
import {
	useServerModel,
	useServerStatus,
	useAmountPresets,
	getServerModel,
	modelOptions,
	presetsOptions,
	statusOptions,
	reloadWorkspace,
	userResourceKey,
} from "./workspaceResources.ts";
import {
	saveWorkspace,
	importServerDocument,
	reloadDraft,
	stageAndSave,
	useWorkspaceWriteError,
	useWorkspaceSaving,
} from "./workspaceWrites.ts";
import { modelFixture, stubTestServer } from "../mocks/waypointServer.ts";

// Test observations compose the public owners.
function useRemoteWorkspace() {
	useWorkspaceStartup();
	const state = useWorkspaceStore();
	const model = useServerModel();
	const status = useServerStatus();
	const presets = useAmountPresets();
	const mutationError = useWorkspaceWriteError();
	const saving = useWorkspaceSaving();
	const conflict = draftConflict(state, model.data);
	const saved = model.data?.conversion?.plan;
	const error =
		state.error ??
		conflict ??
		(mutationError instanceof Error ? mutationError.message : null) ??
		model.error?.message ??
		(model.data && !model.data.document
			? "The server has no financial model to display."
			: null);
	return {
		...state,
		plan: saved ? (state.draft ?? saved) : null,
		workspace: saved
			? {
					saved,
					draft: state.draft,
					baseRevision: state.baseRevision,
					baseFingerprint: state.baseFingerprint,
					draftStale: Boolean(conflict),
				}
			: null,
		serverDocument: model.data?.document ?? null,
		serverPresets: presets.data ?? null,
		presetError: presets.error?.message ?? null,
		savedPresentation: model.data?.conversion?.presentation ?? null,
		adapterReport: model.data?.conversion?.report ?? null,
		status: status.data ?? null,
		recoveryDraft: saved ? null : state.draft,
		error,
		loading: model.isFetching,
		saving,
		stale: Boolean(conflict),
		draftStale: Boolean(conflict),
		readOnly: Boolean(
			status.data?.readOnly ||
			(mutationError instanceof ApiHttpError && mutationError.status === 403),
		),
		authRequired:
			mutationError instanceof ApiHttpError && mutationError.status === 401,
		save: () => saveWorkspace(),
		retry: () => reloadWorkspace(),
		reloadDraft: () => reloadDraft(),
		importServerDocument: (document: FinancialModelDocument) =>
			importServerDocument(document),
		refreshPresets: async () => {
			await serverQueryClient().invalidateQueries({
				queryKey: userResourceKey("presets"),
				refetchType: "none",
			});
			await serverQueryClient()
				.fetchQuery(presetsOptions())
				.catch(() => {});
		},
		refreshStatus: async () => {
			await serverQueryClient().fetchQuery({
				...statusOptions(),
				staleTime: 0,
			});
		},
	};
}

interface Rendered<T> {
	result: () => T;
	settle: () => Promise<void>;
	unmount: () => void;
	rerender: () => void;
}

function Passthrough({ children }: { children: ReactNode }) {
	return createElement(Fragment, null, children);
}

function renderHook<T>(callback: () => T): Rendered<T> {
	return renderHookWith(callback, { strictMode: false });
}

// React's development double-mount runs mount effects, tears them down, and
// runs them again. `strictMode` reproduces that so cleanup paths are exercised
// the way the browser runs them.
function renderHookWith<T>(
	callback: () => T,
	options: { strictMode: boolean },
): Rendered<T> {
	// Deterministic queries use this local cache. Scenario queries share the
	// server cache, which afterEach resets between cases.
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	function Wrapper({ children }: { children: ReactNode }) {
		const tree = createElement(QueryClientProvider, { client }, children);
		return options.strictMode
			? createElement(StrictMode, null, tree)
			: createElement(Passthrough, null, tree);
	}
	const rendered = renderHookRTL(callback, {
		wrapper: Wrapper,
		reactStrictMode: options.strictMode,
	});
	return {
		result: () => rendered.result.current,
		settle: async () => {
			await waitFor(() =>
				expect(
					serverQueryClient().isFetching({
						queryKey: userResourceKey("model"),
					}),
				).toBe(0),
			);
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
		},
		unmount: () => rendered.unmount(),
		rerender: () => rendered.rerender(),
	};
}

function scenarioStreamClient(cancelBody = true) {
	const streams: {
		signal: AbortSignal;
		send: (event: string, data: unknown) => void;
		close: () => void;
	}[] = [];
	const deterministicCalls: unknown[] = [];
	const stochasticCalls: unknown[] = [];
	const client = {
		projectDeterministic: vi.fn(async () => ({
			result: projectionFixture(),
			issues: [],
		})),
		projectStochastic: vi.fn(
			async (
				_request: StochasticProjectionRequest,
				options?: ApiRequestOptions,
			) => {
				const signal = options?.signal;
				if (!signal) throw new Error("Expected a query-owned signal");
				const body = new ReadableStream<Uint8Array>({
					start(controller) {
						streams.push({
							signal,
							send: (event, data) => {
								try {
									controller.enqueue(
										new TextEncoder().encode(
											`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
										),
									);
								} catch {
									// Late sends after retire/cancel are ignored.
								}
							},
							close: () => {
								try {
									controller.close();
								} catch {
									// Already closed by cancel.
								}
							},
						});
						if (cancelBody)
							signal.addEventListener(
								"abort",
								() => controller.error(signal.reason),
								{ once: true },
							);
					},
				});
				const headers = new Headers({
					"content-type": "text/event-stream",
				});
				const resource = getUserScope().resource?.id;
				if (resource) headers.set("Waypoint-Resource", resource);
				return new Response(body, { headers });
			},
		),
	};
	const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
		const path = String(url);
		const signal = init?.signal;
		const headers = new Headers();
		const resource = getUserScope().resource?.id;
		if (resource) headers.set("Waypoint-Resource", resource);
		if (path.endsWith("/v1/projections/deterministic")) {
			const body = init?.body ? JSON.parse(String(init.body)) : {};
			deterministicCalls.push(body);
			const result = await (
				client.projectDeterministic as (...args: unknown[]) => Promise<unknown>
			)(body, { signal: signal ?? undefined });
			if (result instanceof Error) throw result;
			headers.set("content-type", "application/json");
			return new Response(JSON.stringify(result), { headers });
		}
		if (path.endsWith("/v1/projections/stochastic")) {
			const body = init?.body ? JSON.parse(String(init.body)) : {};
			stochasticCalls.push(body);
			const response = (await (
				client.projectStochastic as (...args: unknown[]) => Promise<unknown>
			)(body, {
				signal: signal ?? undefined,
			})) as Response;
			if (response instanceof Error) throw response;
			return response;
		}
		throw new Error(`Unexpected projection fetch: ${path}`);
	});
	vi.stubGlobal("fetch", fetcher);
	const stream = (index = 0) => {
		const selected = streams.at(index);
		if (!selected) throw new Error("Expected an active scenario stream");
		return selected;
	};
	return { client, stream, fetcher, deterministicCalls, stochasticCalls };
}

function withTransactionAmount(plan: Plan, amount: number): Plan {
	return {
		...plan,
		transactions: plan.transactions.map((transaction) =>
			transaction.id === "salary" ? { ...transaction, amount } : transaction,
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
				name: "Cash",
				color: null,
				enabled: true,
				startingBalance: 100,
				endingBalance: 200,
			},
			{
				accountId: "loan",
				name: "Loan",
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
					name: "Reach target",
					status: "satisfied",
					deterministic: { reached: true, firstReachedDate: "2026-02-01" },
					probabilistic: null,
					diagnostics: [],
				},
			],
			accountBalance: [],
			postingFulfillment: [],
		},
		transactionEvents: [
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
					name: "Reach target",
					status: "satisfied",
					deterministic: { reached: true, firstReachedDate: "2026-02-01" },
					probabilistic: { probability: 0.75 },
					diagnostics: [],
				},
			],
			accountBalance: [],
			postingFulfillment: [
				{
					instanceId: "all",
					name: "All postings",
					status: "satisfied",
					deterministic: { postingIds: null },
					probabilistic: { fullFulfillmentProbability: 0.6 },
					diagnostics: [],
				},
			],
		},
	};
}

beforeEach(() => {
	acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: "users/sample",
				kind: "sample",
				permissions: ["user:read", "user:project"],
			},
			subject: null,
		},
		suspendUserScope(),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	resetServerQueryCache();
	resetUiStore();
	resetWorkspaceStore();
	resetNotifications();
});

describe("remote workspace state", () => {
	it("retains the loaded financial model after a failed background reload", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		const server = stubTestServer();
		const view = renderHook(() => useRemoteWorkspace());
		await waitFor(() => expect(view.result().loading).toBe(false));
		const previous = view.result().serverDocument;
		expect(previous).not.toBeNull();
		server.failModelOnce(new Error("offline"));
		await act(async () => reloadWorkspace());
		await view.settle();
		expect(view.result().serverDocument).toBe(previous);
		expect(view.result().workspace).not.toBeNull();
		expect(view.result().error).not.toBeNull();
		view.unmount();
	});

	it("preserves an unsaved draft during a background model reload", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		stubTestServer();
		const view = renderHook(() => useRemoteWorkspace());
		await waitFor(() => expect(view.result().loading).toBe(false));
		const edited = withTransactionAmount(view.result().plan!, 125);
		await act(async () => {
			expect(view.result().updatePlan(edited)).toBe(true);
		});
		await act(async () => {
			await reloadWorkspace();
		});
		expect(view.result().workspace?.draft?.transactions).toEqual(
			edited.transactions,
		);
		view.unmount();
	});

	it("does not publish an empty in-memory draft when saved-only data is checked again", async () => {
		stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const view = renderHook(() => useRemoteWorkspace());
		await waitFor(() => expect(view.result().loading).toBe(false));
		expect(view.result().workspace?.draft).toBeNull();
		await act(async () => reloadWorkspace());
		expect(view.result().workspace?.draft).toBeNull();
		view.unmount();
	});

	// Regression: the mount effect used to abort its in-flight load on cleanup.
	// React's development double-mount tears that effect down immediately, and
	// the remount reused the same in-flight promise, so hydration never
	// completed and the app stayed on "Connecting to your Waypoint server".
	it("completes hydration across a strict-mode remount", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		let resolveModel!: (value: Response) => void;
		server.holdModel(
			new Promise<Response>((resolve) => {
				resolveModel = resolve;
			}),
		);
		const rendered = renderHookWith(() => useRemoteWorkspace(), {
			strictMode: true,
		});
		await waitFor(() =>
			expect(
				server.calls.filter((call) => call.url.endsWith("/v1/status")),
			).not.toHaveLength(0),
		);
		await waitFor(() => expect(server.modelFetches()).not.toHaveLength(0));
		await waitFor(() =>
			expect(
				server.calls.filter((call) => call.url.endsWith("/v1/amount-presets")),
			).not.toHaveLength(0),
		);
		resolveModel(
			server.ok({
				document: modelFixture(),
				issues: [],
				revision: '"sha256-test"',
			}),
		);
		await rendered.settle();

		expect(rendered.result().loading).toBe(false);
		expect(rendered.result().workspace).not.toBeNull();
		expect(rendered.result().plan).not.toBeNull();
		expect(rendered.result().error).toBeNull();
		rendered.unmount();
	});

	it("lets Query cancel the initial load on its last observer's unmount", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		const server = stubTestServer();
		let resolveModel!: (value: Response) => void;
		server.holdModel(
			new Promise<Response>((resolve) => {
				resolveModel = resolve;
			}),
		);
		const rendered = renderHookRTL(() => useWorkspaceStartup());
		await waitFor(() => expect(server.modelFetches()).not.toHaveLength(0));
		const signal = (
			server.fetcher.mock.calls.find(([url]) =>
				String(url).endsWith("/v1/financial-model"),
			)?.[1] as RequestInit | undefined
		)?.signal as AbortSignal | undefined;
		rendered.unmount();
		expect(signal?.aborted).toBe(true);
		await act(async () => {
			resolveModel(
				server.ok({
					document: modelFixture(),
					issues: [],
					revision: '"sha256-test"',
				}),
			);
		});
		expect(getServerModel()).toBeUndefined();
		expect(useWorkspaceStore.getState().draft).toBeNull();
	});

	it("keeps session credentials out of workspace and UI state", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer();
		const rendered = renderHookRTL(() => useWorkspaceStartup());
		await waitFor(() =>
			expect(
				serverQueryClient().isFetching({
					queryKey: userResourceKey("model"),
				}),
			).toBe(0),
		);
		await act(async () => useUiStore.getState().setYears(10));
		expect(
			server.calls.filter((call) => call.url.endsWith("/v1/status")),
		).toHaveLength(1);
		await serverQueryClient().fetchQuery({
			...presetsOptions(),
			staleTime: 0,
		});
		expect(
			server.fetcher.mock.calls
				.filter(([url]) => String(url).endsWith("/v1/amount-presets"))
				.at(-1)?.[1],
		).not.toHaveProperty("authToken");
		expect(useWorkspaceStore.getState()).not.toHaveProperty("authToken");
		expect(useUiStore.getState()).not.toHaveProperty("authToken");
		rendered.unmount();
	});

	it("uses a replacement client on an explicit Query refresh", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		const server = stubTestServer();
		const rendered = renderHookRTL(() => useWorkspaceStartup());
		await waitFor(() => expect(getServerModel()?.document).toBeDefined());
		expect(server.modelFetches()).toHaveLength(1);
		(server.model as FinancialModelDocument).accounts[0]!.name =
			"Replacement cash";
		await act(async () => reloadWorkspace());
		expect(server.modelFetches()).toHaveLength(2);
		expect(getServerModel()?.conversion?.plan.accounts[0]?.name).toBe(
			"Replacement cash",
		);
		rendered.unmount();
	});

	it("ignores an active save's result after its resource retires", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		const server = stubTestServer();
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);
		const release = server.holdWriteOnce(
			(_method, path) => path === "/v1/recurrence-rules/salary",
		);
		const saving = saveWorkspace();
		await waitFor(() =>
			expect(
				server.calls.filter((call) =>
					call.url.endsWith("/v1/recurrence-rules/salary"),
				),
			).not.toHaveLength(0),
		);
		suspendUserScope();
		rendered.unmount();
		release(undefined);
		expect(await saving).toBe(false);
		expect(useWorkspaceStore.getState().draft?.transactions[0]?.amount).toBe(
			125,
		);
		expect(server.modelFetches()).toHaveLength(1);
	});

	it("reuses a pending load on client change and uses the new binding on retry", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		const server = stubTestServer();
		let resolveModel!: (value: Response) => void;
		server.holdModel(
			new Promise<Response>((resolve) => {
				resolveModel = resolve;
			}),
		);
		const rendered = renderHookRTL(() => useWorkspaceStartup());
		const pending = serverQueryClient().fetchQuery(modelOptions());
		await waitFor(() => expect(server.modelFetches()).not.toHaveLength(0));
		const signal = (
			server.fetcher.mock.calls.find(([url]) =>
				String(url).endsWith("/v1/financial-model"),
			)?.[1] as RequestInit | undefined
		)?.signal as AbortSignal | undefined;
		rendered.rerender();
		expect(
			serverQueryClient().getQueryState(userResourceKey("model"))?.fetchStatus,
		).toBe("fetching");
		expect(signal?.aborted).toBe(false);
		await act(async () => {
			resolveModel(
				server.ok({
					document: modelFixture(),
					issues: [],
					revision: '"sha256-test"',
				}),
			);
			await pending;
		});
		expect(getServerModel()?.document).not.toBeNull();
		await act(async () => reloadWorkspace());
		expect(server.modelFetches().length).toBeGreaterThanOrEqual(2);
		rendered.unmount();
	});

	it("keeps preset load errors separate from workspace recovery", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		const server = stubTestServer();
		server.failPresetsOnce(new Error("Recipes unavailable"));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(rendered.result().workspace).not.toBeNull();
		expect(rendered.result().error).toBeNull();
		expect(rendered.result().presetError).not.toBeNull();
		await rendered.result().refreshPresets();
		await rendered.settle();
		expect(rendered.result().serverPresets).toEqual([]);
		expect(rendered.result().presetError).toBeNull();
		rendered.unmount();
	});

	it("hydrates server state and keeps a draft in memory without credentials", async () => {
		stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();

		expect(rendered.result().status).toEqual({
			readOnly: false,
		});
		expect(
			rendered.result().plan?.accounts.map((account) => account.id),
		).toEqual(["cash", "loan"]);
		expect(rendered.result().adapterReport?.warnings.length).toBeGreaterThan(0);

		const edited = withTransactionAmount(rendered.result().plan!, 125);
		expect(rendered.result().updatePlan(edited)).toBe(true);
		await rendered.settle();
		expect(useWorkspaceStore.getState().draft?.transactions).toEqual(
			edited.transactions,
		);
		rendered.unmount();
		const rehydrated = renderHook(() => useRemoteWorkspace());
		await rehydrated.settle();
		expect(rehydrated.result().plan?.transactions[0]?.amount).toBe(125);
		rehydrated.unmount();
	});

	it("keeps a draft stale when the authoritative server document changed", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const first = renderHook(() => useRemoteWorkspace());
		await first.settle();
		expect(
			first
				.result()
				.updatePlan(withTransactionAmount(first.result().plan!, 125)),
		).toBe(true);
		expect(useWorkspaceStore.getState().baseFingerprint).toBe(
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
		const changedServer = stubTestServer(
			() => ({
				document: changedModel,
				issues: [],
			}),
			changedModel,
		);
		changedServer.setRevision('"sha256-changed"');
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();

		expect(rendered.result().stale).toBe(true);
		expect(rendered.result().draftStale).toBe(true);
		expect(rendered.result().workspace?.draft?.transactions[0]?.amount).toBe(
			125,
		);
		expect(rendered.result().error).not.toBeNull();
		expect(await rendered.result().save()).toBe(false);
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 150)),
		).toBe(false);
		expect(rendered.result().discard()).toBe(false);
		expect(
			changedServer.calls.filter((call) =>
				call.url.includes("/v1/recurrence-rules"),
			),
		).toHaveLength(0);

		expect(await rendered.result().retry()).toBeUndefined();
		await rendered.settle();
		expect(rendered.result().stale).toBe(true);
		expect(rendered.result().workspace?.draft?.transactions[0]?.amount).toBe(
			125,
		);
		expect(await rendered.result().reloadDraft()).toBe(true);
		await rendered.settle();
		expect(rendered.result().stale).toBe(false);
		expect(rendered.result().workspace?.draft).toBeNull();
		rendered.unmount();
	});

	it("treats a draft without server identity metadata as recovery-only", async () => {
		const server = stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const first = renderHook(() => useRemoteWorkspace());
		await first.settle();
		expect(
			first
				.result()
				.updatePlan(withTransactionAmount(first.result().plan!, 125)),
		).toBe(true);
		first.unmount();
		useWorkspaceStore.setState({ baseFingerprint: null, baseRevision: null });

		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(rendered.result().draftStale).toBe(true);
		expect(rendered.result().error).not.toBeNull();
		expect(await rendered.result().save()).toBe(false);
		expect(
			server.calls.filter((call) => call.url.includes("/v1/recurrence-rules")),
		).toHaveLength(0);
		rendered.unmount();
	});

	it("edits and saves without a server revision", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);
		await rendered.settle();
		expect(await rendered.result().save()).toBe(true);
		expect(
			server.calls.filter((call) =>
				call.url.endsWith("/v1/recurrence-rules/salary"),
			),
		).toHaveLength(1);
		rendered.unmount();
	});

	it("keeps a stored draft for recovery when hydration fails", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const first = renderHook(() => useRemoteWorkspace());
		await first.settle();
		expect(
			first
				.result()
				.updatePlan(withTransactionAmount(first.result().plan!, 125)),
		).toBe(true);
		first.unmount();
		resetServerQueryCache();

		const failedServer = stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		failedServer.failStatusOnce(new Error("connection unavailable"));
		failedServer.failModelOnce(new Error("connection unavailable"));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(rendered.result().workspace).toBeNull();
		expect(rendered.result().recoveryDraft?.transactions[0]?.amount).toBe(125);
		expect(rendered.result().error).not.toBeNull();
		rendered.unmount();
	});

	it("retains the last good model and draft when a refresh fails", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);
		server.failStatusOnce(new Error("connection unavailable"));
		server.failModelOnce(new Error("connection unavailable"));

		await rendered.result().retry();
		await rendered.settle();
		expect(rendered.result().workspace).not.toBeNull();
		expect(rendered.result().workspace?.draft?.transactions[0]?.amount).toBe(
			125,
		);
		expect(rendered.result().error).not.toBeNull();
		rendered.unmount();
	});

	it("defers refresh until a rejected save settles and retains the last good model", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => {
			throw new ApiHttpError({ message: "stale", status: 412 });
		});
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);

		const release = server.holdWriteOnce(
			(_method, path) => path === "/v1/recurrence-rules/salary",
		);
		const savePromise = rendered.result().save();
		server.failStatusOnce(new Error("connection unavailable"));
		server.failModelOnce(new Error("connection unavailable"));
		const retryPromise = rendered.result().retry();
		await waitFor(() =>
			expect(
				server.calls.filter((call) =>
					call.url.endsWith("/v1/recurrence-rules/salary"),
				),
			).not.toHaveLength(0),
		);
		release(undefined);
		expect(await savePromise).toBe(false);
		await retryPromise;
		await rendered.settle();
		expect(rendered.result().workspace).not.toBeNull();
		expect(rendered.result().workspace?.draft?.transactions[0]?.amount).toBe(
			125,
		);
		rendered.unmount();
	});

	it("reconciles a successful save before a queued retry hydrates", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);

		const release = server.holdWriteOnce(
			(_method, path) => path === "/v1/recurrence-rules/salary",
		);
		const savePromise = rendered.result().save();
		const retryPromise = rendered.result().retry();
		await waitFor(() =>
			expect(
				server.calls.filter((call) =>
					call.url.endsWith("/v1/recurrence-rules/salary"),
				),
			).not.toHaveLength(0),
		);
		release(undefined);
		expect(await savePromise).toBe(true);
		await retryPromise;
		await rendered.settle();
		expect(rendered.result().workspace?.draft).toBeNull();
		expect(rendered.result().plan?.transactions[0]?.amount).toBe(125);
		expect(rendered.result().draftStale).toBe(false);
		rendered.unmount();
	});

	it("preserves a queued save rejection through hydration", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => ({
			document: modelFixture(),
			issues: [
				{
					severity: "error",
					code: "invalid",
					message: "The server rejected this transaction.",
					path: [],
				},
			],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);

		const release = server.holdWriteOnce(
			(_method, path) => path === "/v1/recurrence-rules/salary",
		);
		const savePromise = rendered.result().save();
		const retryPromise = rendered.result().retry();
		await waitFor(() =>
			expect(
				server.calls.filter((call) =>
					call.url.endsWith("/v1/recurrence-rules/salary"),
				),
			).not.toHaveLength(0),
		);
		release(undefined);
		expect(await savePromise).toBe(false);
		await rendered.settle();
		expect(rendered.result().error).not.toBeNull();
		await retryPromise;
		await rendered.settle();
		expect(rendered.result().error).not.toBeNull();
		expect(rendered.result().workspace?.draft?.transactions[0]?.amount).toBe(
			125,
		);
		rendered.unmount();
	});

	it("does not cancel or replay an unsettled save when refresh is requested", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => new Error("offline"));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);

		const release = server.holdWriteOnce(
			(_method, path) => path === "/v1/recurrence-rules/salary",
		);
		const savePromise = rendered.result().save();
		let refreshed = false;
		const refresh = rendered
			.result()
			.retry()
			.then(() => {
				refreshed = true;
			});
		await waitFor(() =>
			expect(
				server.calls.filter((call) =>
					call.url.endsWith("/v1/recurrence-rules/salary"),
				),
			).not.toHaveLength(0),
		);
		expect(refreshed).toBe(false);
		expect(
			server.calls.filter((call) =>
				call.url.endsWith("/v1/recurrence-rules/salary"),
			),
		).toHaveLength(1);
		release(undefined);
		await savePromise;
		await refresh;
		await rendered.settle();
		expect(rendered.result().workspace?.draft?.transactions[0]?.amount).toBe(
			125,
		);
		expect(rendered.result().draftStale).toBe(false);
		rendered.unmount();
	});

	it("rejects draft disposal while a server save is active", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);
		const release = server.holdWriteOnce(
			(_method, path) => path === "/v1/recurrence-rules/salary",
		);
		const savePromise = rendered.result().save();
		await waitFor(() =>
			expect(
				server.calls.filter((call) =>
					call.url.endsWith("/v1/recurrence-rules/salary"),
				),
			).not.toHaveLength(0),
		);
		expect(rendered.result().discard()).toBe(false);
		await rendered.settle();
		expect(rendered.result().error).not.toBeNull();
		release(undefined);
		await savePromise;
		await rendered.settle();
		expect(rendered.result().workspace?.draft).toBeNull();
		rendered.unmount();
	});

	it("lets Query prevent overlapping saves and edits", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => {
			throw new ApiHttpError({ message: "stale", status: 412 });
		});
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);

		const release = server.holdWriteOnce(
			(_method, path) => path === "/v1/recurrence-rules/salary",
		);
		const firstSave = rendered.result().save();
		await waitFor(() =>
			expect(
				server.calls.filter((call) =>
					call.url.endsWith("/v1/recurrence-rules/salary"),
				),
			).toHaveLength(1),
		);
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 150)),
		).toBe(false);
		expect(await rendered.result().save()).toBe(false);
		release(undefined);
		await firstSave;
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 175)),
		).toBe(true);
		rendered.unmount();
	});

	it("preserves a failed import hydration error after a conflict", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => {
			throw new ApiHttpError({ message: "already exists", status: 409 });
		});
		server.failModelOnce({
			document: null,
			issues: [],
		} as unknown as FinancialModelResponse);
		server.failModelOnce(new Error("authoritative load failed"));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(await rendered.result().importServerDocument(modelFixture())).toBe(
			false,
		);
		await rendered.settle();
		expect(rendered.result().error).not.toBeNull();
		expect(await rendered.result().importServerDocument(modelFixture())).toBe(
			false,
		);
		expect(
			server.calls.filter(
				(call) => call.method === "POST" && call.url === "/v1/accounts",
			),
		).toHaveLength(2);
		rendered.unmount();
	});

	it("exposes an in-memory draft when the server has no model", async () => {
		stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const first = renderHook(() => useRemoteWorkspace());
		await first.settle();
		expect(
			first
				.result()
				.updatePlan(withTransactionAmount(first.result().plan!, 125)),
		).toBe(true);
		first.unmount();

		const emptyServer = stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		emptyServer.failModelOnce({
			document: null,
			issues: [],
		} as unknown as FinancialModelResponse);
		const recovery = renderHook(() => useRemoteWorkspace());
		await recovery.settle();
		expect(recovery.result().workspace).toBeNull();
		expect(recovery.result().recoveryDraft?.transactions[0]?.amount).toBe(125);
		recovery.unmount();
	});

	it("keeps a clean in-memory draft usable and discardable", async () => {
		stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const first = renderHook(() => useRemoteWorkspace());
		await first.settle();
		expect(
			first
				.result()
				.updatePlan(withTransactionAmount(first.result().plan!, 125)),
		).toBe(true);
		first.unmount();

		const rehydrated = renderHook(() => useRemoteWorkspace());
		await rehydrated.settle();
		expect(rehydrated.result().stale).toBe(false);
		expect(rehydrated.result().workspace?.draft?.transactions[0]?.amount).toBe(
			125,
		);
		expect(rehydrated.result().discard()).toBe(true);
		await rehydrated.settle();
		expect(rehydrated.result().workspace?.draft).toBeNull();
		expect(useWorkspaceStore.getState().draft).toBeNull();
		expect(useWorkspaceStore.getState().baseFingerprint).toBeNull();
		rehydrated.unmount();
	});

	it("returns false from discard when there is no draft", async () => {
		stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);
		await rendered.settle();

		expect(rendered.result().discard()).toBe(true);
		await rendered.settle();
		expect(rendered.result().workspace?.draft).toBeNull();
		expect(useWorkspaceStore.getState().draft).toBeNull();
		rendered.unmount();
	});

	it("saves, re-fetches the authoritative model, and clears the local draft", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => ({
			document: modelFixture(),
			issues: [
				{
					severity: "warning",
					code: "reviewed-warning",
					message: "Review the model warnings.",
					path: [],
				},
			],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);

		// Exercise reconciliation before the fetch promise returns, rather than rely on React's batched effects.
		const stop = serverQueryClient()
			.getQueryCache()
			.subscribe(() => {
				const model = getServerModel();
				if (model) useWorkspaceStore.getState().reconcile(model);
			});
		expect(await rendered.result().save()).toBe(true);
		stop();
		await rendered.settle();
		expect(
			server.calls.filter((call) =>
				call.url.startsWith("/v1/recurrence-rules/"),
			),
		).toHaveLength(1);
		expect(server.modelFetches()).toHaveLength(2);
		expect(rendered.result().workspace?.draft).toBeNull();
		expect(useWorkspaceStore.getState().draft).toBeNull();
		rendered.unmount();
	});

	it("retains the draft when a row write is rejected without an error issue", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		const server = stubTestServer();
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);
		server.writeOnce(
			(_method, path) => path === "/v1/recurrence-rules/salary",
			{
				row: modelFixture().recurrenceRules[0]!,
				revision: '"rejected"',
				issues: [],
				persisted: false,
			},
		);
		expect(await rendered.result().save()).toBe(false);
		await rendered.settle();
		expect(rendered.result().workspace?.draft?.transactions[0]?.amount).toBe(
			125,
		);
		expect(server.modelFetches()).toHaveLength(1);
		rendered.unmount();
	});

	it("clears a rejected write's temporary read-only guard after an authoritative reload", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		const server = stubTestServer();
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);
		server.writeOnce(
			(_method, path) => path === "/v1/recurrence-rules/salary",
			new ApiHttpError({ status: 403, message: "Read-only" }),
		);
		expect(await rendered.result().save()).toBe(false);
		await rendered.settle();
		expect(rendered.result().readOnly).toBe(true);
		await rendered.result().retry();
		await rendered.settle();
		expect(rendered.result().readOnly).toBe(false);
		expect(rendered.result().workspace?.draft?.transactions[0]?.amount).toBe(
			125,
		);
		rendered.unmount();
	});

	it("refuses a recovery import while the initial model query is pending", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		const server = stubTestServer();
		let finish!: (value: Response) => void;
		server.holdModel(
			new Promise<Response>((resolve) => {
				finish = resolve;
			}),
		);
		const rendered = renderHook(() => useRemoteWorkspace());
		expect(await importServerDocument(modelFixture())).toBe(false);
		expect(
			server.calls.filter(
				(call) => call.method === "POST" && call.url === "/v1/accounts",
			),
		).toHaveLength(0);
		expect(
			useNotifications
				.getState()
				.items.some((item) => item.message.includes("before importing")),
		).toBe(true);
		await act(async () =>
			finish(
				server.ok({ document: null, issues: [], revision: '"sha256-test"' }),
			),
		);
		await rendered.settle();
		rendered.unmount();
	});

	it("does not announce discard when there is no draft", () => {
		expect(useWorkspaceStore.getState().discard()).toBe(false);
		expect(useNotifications.getState().items).toHaveLength(0);
	});

	it("applies transaction edits as rule updates", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(
			rendered
				.result()
				.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
		).toBe(true);
		expect(await rendered.result().save()).toBe(true);
		expect(
			server.calls.filter((call) =>
				call.url.startsWith("/v1/recurrence-rules/"),
			),
		).toHaveLength(1);
		rendered.unmount();
	});

	it("lets an editor add and save a planned purchase without rewriting synced accounts or postings", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		const model = modelFixture();
		model.checkpoints[0]!.source = "simplefin";
		const pending: BackendPosting = {
			id: "01900000-0000-7000-8000-000000000001",
			name: "Pending bank charge",
			sourceAccountId: "cash",
			destinations: null,
			amount: {
				resolver: "expression",
				config: { expression: "25.15" },
				inputs: {},
			},
			postedTime: 0,
			transactionTime: 1769904300,
			enabled: false,
			source: "simplefin",
			pending: true,
		};
		model.postings = [pending];
		const server = stubTestServer(undefined, model);
		server.setStatus({ readOnly: true });
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(rendered.result().plan?.readOnly).toBe(true);
		server.setStatus({ readOnly: false });
		await rendered.result().refreshStatus();
		await rendered.settle();
		const plan = rendered.result().plan!;
		expect(rendered.result().readOnly).toBe(false);
		expect(plan.readOnly).toBe(false);
		expect(plan.accounts[0]?.readOnly).toBe(true);
		expect(plan.accounts[1]?.readOnly).toBe(false);
		expect(rendered.result().workspace?.draft).toBeNull();
		const purchase = {
			id: "01900000-0000-7000-8000-000000000002",
			name: "New laptop",
			amount: 1200,
			fromId: "cash",
			startDate: "2026-02-15",
			enabled: true,
			readOnly: false,
		};

		const accepted = rendered.result().updatePlan({
			...plan,
			plannedPurchases: [...plan.plannedPurchases, purchase],
		});
		await rendered.settle();
		expect(rendered.result().error).toBeNull();
		expect(accepted).toBe(true);
		expect(rendered.result().workspace?.draft?.plannedPurchases).toContainEqual(
			purchase,
		);
		server.setStatus({ readOnly: true });
		await rendered.result().refreshStatus();
		await rendered.settle();
		expect(rendered.result().plan?.readOnly).toBe(true);
		expect(rendered.result().plan?.accounts[1]?.readOnly).toBe(true);
		expect(await rendered.result().save()).toBe(false);
		expect(
			server.calls.filter(
				(call) => call.method === "POST" && call.url === "/v1/postings",
			),
		).toHaveLength(0);
		server.setStatus({ readOnly: false });
		await rendered.result().refreshStatus();
		await rendered.settle();
		expect(rendered.result().plan?.readOnly).toBe(false);
		expect(rendered.result().plan?.accounts[1]?.readOnly).toBe(false);
		expect(rendered.result().workspace?.draft?.plannedPurchases).toContainEqual(
			purchase,
		);
		expect(await rendered.result().save()).toBe(true);
		await rendered.settle();

		const postingCreates = server.calls.filter(
			(call) => call.method === "POST" && call.url === "/v1/postings",
		);
		expect(postingCreates).toHaveLength(1);
		expect(postingCreates[0]?.body).toMatchObject({
			id: purchase.id,
			sourceAccountId: "cash",
			amount: {
				resolver: "expression",
				config: { expression: "1200" },
				inputs: {},
			},
			purchase: { priority: 0 },
		});
		const otherWrites = server.calls.filter((call) =>
			["/v1/accounts", "/v1/checkpoints"].some((prefix) =>
				call.url.startsWith(prefix),
			),
		);
		expect(otherWrites).toHaveLength(0);
		expect(
			server.calls.filter(
				(call) =>
					call.method === "PATCH" && call.url.startsWith("/v1/postings/"),
			),
		).toHaveLength(0);
		expect(
			server.calls.filter(
				(call) =>
					call.method === "DELETE" && call.url.startsWith("/v1/postings"),
			),
		).toHaveLength(0);
		expect(rendered.result().serverDocument?.postings).toContainEqual(pending);
		expect(rendered.result().serverDocument?.accounts).toEqual(model.accounts);
		expect(rendered.result().serverDocument?.checkpoints).toEqual(
			model.checkpoints,
		);
		expect(rendered.result().workspace?.draft).toBeNull();
		expect(rendered.result().plan?.plannedPurchases).toContainEqual(
			expect.objectContaining({
				id: purchase.id,
				amount: purchase.amount,
				fromId: purchase.fromId,
			}),
		);
		expect(rendered.result().plan?.accounts[0]?.readOnly).toBe(true);
		expect(rendered.result().error).toBeNull();
		rendered.unmount();
	});

	it("saves immediately when an edit is staged through stageAndSave", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		const model = modelFixture();
		const server = stubTestServer(undefined, model);
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		const plan = rendered.result().plan!;
		const purchase = {
			id: "01900000-0000-7000-8000-000000000002",
			name: "New laptop",
			amount: 1200,
			fromId: "cash",
			startDate: "2026-02-15",
			enabled: true,
			readOnly: false,
		};
		expect(
			stageAndSave({
				...plan,
				plannedPurchases: [...plan.plannedPurchases, purchase],
			}),
		).toBe(true);
		await waitFor(() =>
			expect(
				server.calls.filter(
					(call) => call.method === "POST" && call.url === "/v1/postings",
				),
			).toHaveLength(1),
		);
		await rendered.settle();
		expect(rendered.result().workspace?.draft).toBeNull();
		expect(rendered.result().error).toBeNull();
		expect(rendered.result().plan?.plannedPurchases).toContainEqual(purchase);
		rendered.unmount();
	});

	it.each([
		{ fromReadOnly: true, toReadOnly: false },
		{ fromReadOnly: false, toReadOnly: true },
	])(
		"refreshes a stored draft's display locks on hydration from readOnly $fromReadOnly to $toReadOnly",
		async ({ fromReadOnly, toReadOnly }) => {
			vi.stubGlobal("localStorage", memoryStorage());
			const model = modelFixture();
			model.checkpoints[0]!.source = "simplefin";
			const server = stubTestServer(undefined, model);
			server.setStatus({ readOnly: fromReadOnly });
			const rendered = renderHook(() => useRemoteWorkspace());
			await rendered.settle();
			expect(
				rendered
					.result()
					.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
			).toBe(true);
			await rendered.settle();
			const baseFingerprint = rendered.result().workspace?.baseFingerprint;
			server.setStatus({ readOnly: toReadOnly });

			await rendered.result().retry();
			await rendered.settle();
			expect(rendered.result().plan?.readOnly).toBe(toReadOnly);
			expect(rendered.result().plan?.accounts[0]?.readOnly).toBe(true);
			expect(rendered.result().plan?.accounts[1]?.readOnly).toBe(toReadOnly);
			expect(rendered.result().draftPresentation?.accounts.loan?.readOnly).toBe(
				toReadOnly,
			);
			expect(rendered.result().workspace?.draft?.transactions[0]?.amount).toBe(
				125,
			);
			expect(rendered.result().workspace?.baseFingerprint).toBe(
				baseFingerprint,
			);
			expect(rendered.result().workspace?.draftStale).toBe(false);
			expect(rendered.result().serverDocument).toEqual(model);
			expect(
				rendered
					.result()
					.updatePlan(withTransactionAmount(rendered.result().plan!, 130)),
			).toBe(true);
			expect(
				server.calls.filter((call) =>
					call.url.includes("/v1/recurrence-rules"),
				),
			).toHaveLength(0);
			expect(
				server.calls.filter(
					(call) =>
						call.url.startsWith("/v1/accounts") && call.method !== "GET",
				),
			).toHaveLength(0);
			expect(
				server.calls.filter(
					(call) =>
						call.url.startsWith("/v1/checkpoints") && call.method !== "GET",
				),
			).toHaveLength(0);
			rendered.unmount();
		},
	);

	it.each([
		{ readOnly: true, writeBlocked: false },
		{ readOnly: false, writeBlocked: true },
	])(
		"still blocks saves with synced accounts when server readOnly is $readOnly and writeBlocked is $writeBlocked",
		async ({ readOnly, writeBlocked }) => {
			vi.stubGlobal("localStorage", memoryStorage());
			const model = modelFixture();
			model.checkpoints[0]!.source = "simplefin";
			const server = stubTestServer(undefined, model);
			const rendered = renderHook(() => useRemoteWorkspace());
			await rendered.settle();
			expect(
				rendered
					.result()
					.updatePlan(withTransactionAmount(rendered.result().plan!, 125)),
			).toBe(true);
			await rendered.settle();
			serverQueryClient().setQueryData(userResourceKey("status"), {
				readOnly: readOnly || writeBlocked,
			});

			expect(await rendered.result().save()).toBe(false);
			await rendered.settle();
			expect(rendered.result().error).toContain("The server is read-only.");
			expect(rendered.result().workspace?.draft).not.toBeNull();
			expect(
				server.calls.filter((call) =>
					call.url.includes("/v1/recurrence-rules"),
				),
			).toHaveLength(0);
			expect(
				server.calls.filter(
					(call) =>
						call.url.startsWith("/v1/accounts") && call.method !== "GET",
				),
			).toHaveLength(0);
			expect(
				server.calls.filter(
					(call) =>
						call.url.startsWith("/v1/checkpoints") && call.method !== "GET",
				),
			).toHaveLength(0);
			rendered.unmount();
		},
	);

	it("creates rows when importing into an empty server", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const empty = {
			...modelFixture(),
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
		} as FinancialModelDocument;
		const server = stubTestServer(undefined, empty);
		server.failModelOnce({
			document: null,
			issues: [],
		} as unknown as FinancialModelResponse);
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(await rendered.result().importServerDocument(modelFixture())).toBe(
			true,
		);
		expect(
			server.calls.filter(
				(call) => call.method === "POST" && call.url === "/v1/accounts",
			),
		).not.toHaveLength(0);
		rendered.unmount();
	});

	it("retains the draft when a successful response contains validation errors", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => ({
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
		const rendered = renderHook(() => useRemoteWorkspace());
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
		expect(server.modelFetches()).toHaveLength(1);
		expect(rendered.result().workspace?.draft?.accounts[0]?.name).toBe(
			"Keep rejected draft",
		);
		expect(useWorkspaceStore.getState().draft?.accounts[0]?.name).toBe(
			"Keep rejected draft",
		);
		expect(rendered.result().error).not.toBeNull();
		rendered.unmount();
	});

	it("retains a draft on 401 and generic save failures", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		stubTestServer(() => {
			throw new ApiHttpError({
				message: "Authentication is required.",
				status: 401,
			});
		});
		const first = renderHook(() => useRemoteWorkspace());
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
		expect(useWorkspaceStore.getState().draft?.accounts[0]?.name).toBe(
			"Keep me",
		);
		first.unmount();

		resetServerQueryCache();
		stubTestServer(() => new Error("temporary failure"));
		const second = renderHook(() => useRemoteWorkspace());
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
		expect(second.result().error).not.toBeNull();
		second.unmount();

		resetServerQueryCache();
		stubTestServer(() => {
			throw new ApiHttpError({
				message: "The server is read-only.",
				status: 403,
			});
		});
		const third = renderHook(() => useRemoteWorkspace());
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

	it("rejects a lossy edit the server cannot represent", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		const lossyPlan = {
			...rendered.result().plan!,
			assumptions: { inflation: 2, volatility: 0 },
		};
		expect(rendered.result().updatePlan(lossyPlan)).toBe(false);
		await rendered.settle();
		expect(rendered.result().error).not.toBeNull();
		rendered.unmount();
	});

	it("rejects a new assumptions edit without mutating the workspace", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
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
		expect(rendered.result().error).not.toBeNull();
		expect(
			server.calls.filter((call) => call.url.includes("/v1/recurrence-rules")),
		).toHaveLength(0);
		rendered.unmount();
	});

	// Adding an account is a first-class edit. It used to be rejected because
	// the new account's presentation-only fields were reported as lost values.
	it("accepts a new account and stages it as a draft", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		const plan = rendered.result().plan!;
		const edited = {
			...plan,
			accounts: [
				...plan.accounts,
				{
					...plan.accounts[0]!,
					id: "travel",
					name: "Travel savings",
					balance: 2500,
				},
			],
		};

		expect(rendered.result().updatePlan(edited)).toBe(true);
		await rendered.settle();
		expect(rendered.result().workspace?.draft).not.toBeNull();
		expect(
			rendered.result().plan?.accounts.some((a) => a.id === "travel"),
		).toBe(true);
		expect(rendered.result().error).toBeNull();
		rendered.unmount();
	});

	// A reserve evaluation is a backend account balance evaluation, so editing
	// one into the plan is accepted and becomes a real draft.
	it("accepts a new reserve evaluation and stages it as a draft", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		const plan = rendered.result().plan!;
		const edited = {
			...plan,
			evaluations: [
				...plan.evaluations,
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

		expect(rendered.result().updatePlan(edited)).toBe(true);
		await rendered.settle();
		expect(rendered.result().workspace?.draft).not.toBeNull();
		expect(
			rendered
				.result()
				.plan?.evaluations.some((evaluation) => evaluation.id === "reserve"),
		).toBe(true);
		expect(rendered.result().error).toBeNull();
		rendered.unmount();
	});

	it("allows a transaction amount edit represented by an expression posting", async () => {
		const storage = memoryStorage();
		vi.stubGlobal("localStorage", storage);
		const server = stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		const edited = withTransactionAmount(rendered.result().plan!, 125);

		expect(rendered.result().updatePlan(edited)).toBe(true);
		await rendered.settle();
		expect(rendered.result().workspace?.draft?.transactions[0]?.amount).toBe(
			125,
		);
		expect(
			deriveDraftDocument(
				rendered.result().workspace?.draft ?? null,
				rendered.result().serverDocument,
				rendered.result().draftPresentation ??
					rendered.result().savedPresentation,
			)?.recurrenceRules[0]?.amount,
		).toEqual({
			resolver: "expression",
			config: { expression: "125" },
			inputs: {},
		});
		expect(rendered.result().error).toBeNull();

		expect(await rendered.result().save()).toBe(true);
		const ruleWrites = server.calls.filter((call) =>
			call.url.startsWith("/v1/recurrence-rules/"),
		);
		expect(ruleWrites).toHaveLength(1);
		expect(ruleWrites[0]?.body).toMatchObject({
			amount: expect.objectContaining({
				resolver: "expression",
				config: expect.objectContaining({ expression: "125" }),
			}),
		});
		rendered.unmount();
	});

	it("retains an in-memory draft when save finds conversion losses", async () => {
		const server = stubTestServer(() => ({
			document: modelFixture(),
			issues: [],
		}));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		const lossyPlan = {
			...rendered.result().plan!,
			assumptions: { inflation: 2, volatility: 0 },
		};
		// Bypass form validation to stage a draft the converter rejects,
		// mirroring a draft that became lossy after the server model changed.
		const model = getServerModel();
		act(() => {
			useWorkspaceStore.setState({
				draft: lossyPlan,
				baseline: model?.conversion?.plan ?? null,
				draftPresentation:
					rendered.result().savedPresentation ??
					model?.conversion?.presentation ??
					null,
				baseFingerprint: model?.fingerprint ?? null,
				baseRevision: model?.revision ?? null,
				error: null,
			});
		});
		await rendered.settle();
		expect(rendered.result().workspace?.draft).toEqual(lossyPlan);
		expect(await rendered.result().save()).toBe(false);
		await rendered.settle();
		expect(
			server.calls.filter((call) => call.url.includes("/v1/recurrence-rules")),
		).toHaveLength(0);
		expect(rendered.result().workspace?.draft).toEqual(lossyPlan);
		expect(rendered.result().error).not.toBeNull();
		rendered.unmount();
	});
});

describe("remote projection mapping and SSE", () => {
	it("maps server rows, transaction events, totals, and threshold dates to the local projection", () => {
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
		expect(local.transactions[0]).toMatchObject({
			name: "Salary",
			fromId: null,
			toId: "cash",
			requested: 100,
			realized: 100,
			available: null,
		});
		expect(local.firstFailure).toBeNull();
		expect(local.evaluations[0]?.firstDate).toBe("2026-02-01");
		expect(local).toMatchObject({ inflows: 100, outflows: 0, transfers: 0 });
		const documentWithoutResult = {
			...document,
			evaluations: {
				...document.evaluations,
				netWorthThreshold: [
					...document.evaluations.netWorthThreshold,
					{
						instanceId: "missing",
						name: "Missing result",
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
		).evaluations.find((evaluation) => evaluation.evaluation.id === "missing");
		expect(indeterminate?.firstDate).toBeNull();
		expect(indeterminate?.evaluation.id).toBe("missing");
	});

	it("keeps start-date events when the start has no checkpoint", () => {
		const document = { ...modelFixture(), checkpoints: [] };
		const result = projectionFixture();
		result.milestones.projectionStartDate = "2026-01-31";
		result.transactionEvents = [
			{ ...result.transactionEvents![0]!, date: "2026-01-31" },
		];
		expect(projectionResultToLocal(result, document).transactions).toHaveLength(1);
	});

	it("accepts transaction events without account deltas", () => {
		const document = modelFixture();
		const result = projectionFixture();
		result.transactionEvents![0]!.accountDeltas = null;
		const local = projectionResultToLocal(result, document);
		expect(local.transactions[0]).toMatchObject({
			transactionId: "salary",
			requested: 100,
			realized: 100,
		});
	});

	it("maps binding evidence and excludes transactions on or before the plan start", () => {
		const document = modelFixture();
		const result = projectionFixture();
		const baseEvent = result.transactionEvents![0]!;
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
		result.transactionEvents = [
			historicalEvent,
			sourceFloorEvent,
			destinationEvent,
			annualEvent,
		] as ProjectionResult["transactionEvents"];

		const local = projectionResultToLocal(result, document);
		expect(local.transactions).toHaveLength(3);
		expect(local.transactions[0]).toMatchObject({
			available: 75,
			constraintTypes: ["source-floor"],
		});
		expect(typeof local.transactions[0]?.constraint).toBe("string");
		expect(local.transactions[1]).toMatchObject({
			available: null,
			constraintTypes: ["destination-ceiling"],
		});
		expect(typeof local.transactions[1]?.constraint).toBe("string");
		expect(local.transactions[2]).toMatchObject({
			available: null,
			constraintTypes: ["action-limit"],
		});
		expect(typeof local.transactions[2]?.constraint).toBe("string");
		expect(local.firstFailure).toBe(local.transactions[0]);
	});

	it("maps FI coverage to visual facts instead of prose", () => {
		const document = {
			...modelFixture(),
			evaluations: {
				...modelFixture().evaluations,
				financialIndependence: [
					{
						instanceId: "financial-independence",
						name: "Financial independence",
						enabled: true,
						config: {
							minimumNetWorth: 1500000,
							annualExpenseTarget: 80000,
							annualExpenseGrowthRate: 0.025,
							withdrawalRate: 0.04,
							evaluationYears: 10,
							requiredConfidence: 0.9,
							sources: [],
							continuingPostingIds: [],
							principalPolicy: "preserve-real-principal",
							annualExpenseTargetBasis: "fi-date-dollars",
						},
					},
				],
			},
		};
		const result = {
			...projectionFixture(),
			evaluations: {
				...projectionFixture().evaluations,
				financialIndependence: [
					{
						instanceId: "financial-independence",
						name: "Financial independence",
						status: "not-satisfied",
						deterministic: {
							rows: [
								{
									date: "2026-01-31",
									netWorth: 60000,
									minimumNetWorth: 1500000,
									minimumNetWorthMet: false,
									annualDirectIncome: 0,
									selectedAssetBalance: 100000,
									annualWithdrawalCapacity: 4000,
									totalAnnualCapacity: 4000,
									annualExpenseTarget: 80000,
									coverageRatio: 0.05,
									isCovered: false,
									isEligible: false,
								},
								{
									date: "2027-01-31",
									netWorth: 200000,
									minimumNetWorth: 1500000,
									minimumNetWorthMet: false,
									annualDirectIncome: 0,
									selectedAssetBalance: 300000,
									annualWithdrawalCapacity: 12000,
									totalAnnualCapacity: 12000,
									annualExpenseTarget: 82000,
									coverageRatio: 0.146,
									isCovered: false,
									isEligible: false,
								},
							],
							runOutcomes: [],
							milestones: {
								firstCoverageDate: null,
								firstSelfSustainingDate: null,
							},
						},
						probabilistic: null,
						diagnostics: [],
					},
				],
			},
		};
		const local = projectionResultToLocal(result, document);
		const item = local.otherEvaluations.find(
			(entry) => entry.id === "financial-independence",
		);
		expect(item?.outcomeDate).toBeNull();
		expect(item?.qualifier).toBeNull();
		expect(item?.progress?.fraction).toBe(0.05);
	});

	it("maps FI coverage to a bar without prose", () => {
		const document = {
			...modelFixture(),
			evaluations: {
				...modelFixture().evaluations,
				financialIndependence: [
					{
						instanceId: "financial-independence",
						name: "Financial independence",
						enabled: true,
						config: { annualExpenseTarget: 80000, evaluationYears: 10 },
					},
				],
			},
		};
		const result = {
			...projectionFixture(),
			evaluations: {
				...projectionFixture().evaluations,
				financialIndependence: [
					{
						instanceId: "financial-independence",
						name: "Financial independence",
						status: "not-satisfied",
						deterministic: {
							rows: [
								{
									date: "2026-01-31",
									netWorth: 2000000,
									minimumNetWorth: 1500000,
									minimumNetWorthMet: true,
									annualDirectIncome: 0,
									selectedAssetBalance: 1000000,
									annualWithdrawalCapacity: 40000,
									totalAnnualCapacity: 40000,
									annualExpenseTarget: 80000,
									coverageRatio: 0.5,
									isCovered: false,
									isEligible: false,
								},
							],
							runOutcomes: [],
							milestones: {
								firstCoverageDate: null,
								firstSelfSustainingDate: null,
							},
						},
						probabilistic: null,
						diagnostics: [],
					},
				],
			},
		};
		const local = projectionResultToLocal(result, document);
		expect(
			local.otherEvaluations.find(
				(entry) => entry.id === "financial-independence",
			),
		).toMatchObject({
			outcomeDate: null,
			qualifier: null,
			progress: { fraction: 0.5 },
		});
	});

	it("prefers the self-sustaining date over first coverage for FI", () => {
		const document = {
			...modelFixture(),
			evaluations: {
				...modelFixture().evaluations,
				financialIndependence: [
					{
						instanceId: "financial-independence",
						name: "Financial independence",
						enabled: true,
						config: { evaluationYears: 10, withdrawalRate: 0.04 },
					},
				],
			},
		};
		const result = {
			...projectionFixture(),
			evaluations: {
				...projectionFixture().evaluations,
				financialIndependence: [
					{
						instanceId: "financial-independence",
						name: "Financial independence",
						status: "satisfied",
						deterministic: {
							rows: [],
							runOutcomes: [],
							milestones: {
								firstCoverageDate: "2030-01-31",
								firstSelfSustainingDate: "2031-06-30",
							},
						},
						probabilistic: null,
						diagnostics: [],
					},
				],
			},
		};
		const local = projectionResultToLocal(result, document);
		expect(
			local.otherEvaluations.find(
				(entry) => entry.id === "financial-independence",
			),
		).toMatchObject({
			outcomeDate: "2031-06-30",
			qualifier: null,
			progress: null,
		});
	});

	it("explains coverage without a sustained cycle for FI", () => {
		const document = {
			...modelFixture(),
			evaluations: {
				...modelFixture().evaluations,
				financialIndependence: [
					{
						instanceId: "financial-independence",
						name: "Financial independence",
						enabled: true,
						config: { evaluationYears: 10 },
					},
				],
			},
		};
		const result = {
			...projectionFixture(),
			evaluations: {
				...projectionFixture().evaluations,
				financialIndependence: [
					{
						instanceId: "financial-independence",
						name: "Financial independence",
						status: "not-satisfied",
						deterministic: {
							rows: [],
							runOutcomes: [
								{
									candidateDate: "2030-01-31",
									status: "summary",
									firstShortfallDate: "2034-02-01",
								},
							],
							milestones: {
								firstCoverageDate: "2030-01-31",
								firstSelfSustainingDate: null,
							},
						},
						probabilistic: null,
						diagnostics: [],
					},
				],
			},
		};
		const local = projectionResultToLocal(result, document);
		expect(
			local.otherEvaluations.find(
				(entry) => entry.id === "financial-independence",
			),
		).toMatchObject({
			outcomeDate: "2030-01-31",
			progress: null,
		});
		expect(
			local.otherEvaluations.find(
				(entry) => entry.id === "financial-independence",
			)?.qualifier,
		).not.toBeNull();
	});

	it("maps a posting shortfall to a date and fulfillment bar", () => {
		const document = {
			...modelFixture(),
			evaluations: {
				...modelFixture().evaluations,
				postingFulfillment: [
					{
						instanceId: "fulfillment",
						name: "Planned transactions",
						enabled: true,
						config: { postingIds: null },
					},
				],
			},
		};
		const result = {
			...projectionFixture(),
			evaluations: {
				...projectionFixture().evaluations,
				postingFulfillment: [
					{
						instanceId: "fulfillment",
						name: "Planned transactions",
						status: "not-satisfied",
						deterministic: {
							firstUnderfulfilledDate: "2026-05-01",
							completionRate: 0.87,
						},
						probabilistic: null,
						diagnostics: [],
					},
				],
			},
		};
		const local = projectionResultToLocal(result, document);
		expect(
			local.otherEvaluations.find((entry) => entry.id === "fulfillment"),
		).toMatchObject({
			name: document.evaluations.postingFulfillment[0]!.name,
			outcomeDate: "2026-05-01",
			qualifier: null,
			progress: { fraction: 0.87 },
		});
	});

	it("maps full posting fulfillment to words without a bar", () => {
		const document = {
			...modelFixture(),
			evaluations: {
				...modelFixture().evaluations,
				postingFulfillment: [
					{
						instanceId: "fulfillment",
						name: "Posting fulfillment",
						enabled: true,
						config: { postingIds: null },
					},
				],
			},
		};
		const result = {
			...projectionFixture(),
			evaluations: {
				...projectionFixture().evaluations,
				postingFulfillment: [
					{
						instanceId: "fulfillment",
						name: "Planned transactions",
						status: "satisfied",
						deterministic: { completionRate: 1 },
						probabilistic: null,
						diagnostics: [],
					},
				],
			},
		};
		const local = projectionResultToLocal(result, document);
		expect(
			local.otherEvaluations.find((entry) => entry.id === "fulfillment"),
		).toMatchObject({
			status: "satisfied",
			postingIds: null,
			outcomeDate: null,
			progress: null,
		});
	});

	it("maps cycle spend to a spent-versus-budget bar", () => {
		const document = {
			...modelFixture(),
			evaluations: {
				...modelFixture().evaluations,
				cycleFulfillment: [
					{
						instanceId: "cycle",
						name: "Monthly spend",
						enabled: true,
						config: { accountIds: ["cash"], statementDay: 1, budget: 5000 },
					},
				],
			},
		};
		const over = {
			...projectionFixture(),
			evaluations: {
				...projectionFixture().evaluations,
				cycleFulfillment: [
					{
						instanceId: "cycle",
						name: "Monthly spend",
						status: "not-satisfied",
						deterministic: { spent: 5600, budget: 5000, withinBudget: false },
						probabilistic: null,
						diagnostics: [],
					},
				],
			},
		};
		const within = {
			...projectionFixture(),
			evaluations: {
				...projectionFixture().evaluations,
				cycleFulfillment: [
					{
						instanceId: "cycle",
						name: "Monthly spend",
						status: "satisfied",
						deterministic: { spent: 4200, budget: 5000, withinBudget: true },
						probabilistic: null,
						diagnostics: [],
					},
				],
			},
		};
		expect(
			projectionResultToLocal(over, document).otherEvaluations.find(
				(entry) => entry.id === "cycle",
			),
		).toMatchObject({
			progress: { fraction: 1.12 },
		});
		expect(
			projectionResultToLocal(within, document).otherEvaluations.find(
				(entry) => entry.id === "cycle",
			),
		).toMatchObject({
			progress: { fraction: 0.84 },
		});
	});

	it("maps stochastic bands and evaluation envelopes to RangeResult", () => {
		const range = stochasticResultToLocal(stochasticFixture());
		expect(range).toEqual({
			points: [{ date: "2026-02-01", lower: 10, median: 30, upper: 50 }],
			count: 4,
			evaluationSuccess: { target: 0.75 },
			failureShare: 0.4,
			financialIndependence: {},
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
		const seen: { url: string; init?: RequestInit }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown, init?: RequestInit) => {
				seen.push({ url: String(url), init });
				const headers = new Headers();
				const resource = getUserScope().resource?.id;
				if (resource) headers.set("Waypoint-Resource", resource);
				if (String(url).endsWith("/v1/projections/deterministic")) {
					headers.set("content-type", "application/json");
					return new Response(
						JSON.stringify({ result: projectionFixture(), issues: [] }),
						{ headers },
					);
				}
				if (String(url).endsWith("/v1/projections/stochastic")) {
					headers.set("content-type", "text/event-stream");
					return new Response(stream, { status: 200, headers });
				}
				throw new Error(`Unexpected fetch: ${String(url)}`);
			}),
		);
		const rendered = renderHook(() =>
			useRemoteProjection({
				document: modelFixture(),
				years: 2,
				ranges: true,
			}),
		);
		await rendered.settle();

		expect(rendered.result().base).toMatchObject({ inflows: 100 });
		expect(rendered.result().range).toMatchObject({
			count: 4,
			evaluationSuccess: { target: 0.75 },
			failureShare: 0.4,
		});
		expect(rendered.result().progress).toBe(1);
		expect(rendered.result().rangeError).toBeNull();
		const deterministicBody = JSON.parse(
			String(
				seen.find((call) => call.url.endsWith("/v1/projections/deterministic"))
					?.init?.body ?? "{}",
			),
		);
		expect(deterministicBody).toMatchObject({
			settings: expect.objectContaining({
				horizonYears: 2,
				fallbackProjectionStartDate: "2026-01-31",
			}),
		});
		const stochasticBody = JSON.parse(
			String(
				seen.find((call) => call.url.endsWith("/v1/projections/stochastic"))
					?.init?.body ?? "{}",
			),
		);
		expect(stochasticBody).toMatchObject({
			config: { runCount: 400, seed: 42 },
		});
		rendered.unmount();
		vi.unstubAllGlobals();
	});

	it("sends the horizon end as the default range", async () => {
		const stream = `event: result\ndata: ${JSON.stringify({ result: stochasticFixture() })}\n\n`;
		const seen: { url: string; init?: RequestInit }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown, init?: RequestInit) => {
				seen.push({ url: String(url), init });
				const headers = new Headers();
				const resource = getUserScope().resource?.id;
				if (resource) headers.set("Waypoint-Resource", resource);
				if (String(url).endsWith("/v1/projections/deterministic")) {
					headers.set("content-type", "application/json");
					return new Response(
						JSON.stringify({ result: projectionFixture(), issues: [] }),
						{ headers },
					);
				}
				headers.set("content-type", "text/event-stream");
				return new Response(stream, { status: 200, headers });
			}),
		);
		const rendered = renderHook(() =>
			useRemoteProjection({
				document: modelFixture(),
				years: 2,
				ranges: true,
			}),
		);
		await rendered.settle();
		const deterministicBody = JSON.parse(
			String(
				seen.find((call) => call.url.endsWith("/v1/projections/deterministic"))
					?.init?.body ?? "{}",
			),
		);
		expect(deterministicBody).toMatchObject({
			range: { endDate: "2028-01-31" },
		});
		const stochasticBody = JSON.parse(
			String(
				seen.find((call) => call.url.endsWith("/v1/projections/stochastic"))
					?.init?.body ?? "{}",
			),
		);
		expect(stochasticBody).not.toHaveProperty("range");
		rendered.unmount();
		vi.unstubAllGlobals();
	});

	it("sends a malformed start date as data instead of throwing during render", async () => {
		const broken = modelFixture();
		broken.checkpoints = [
			{ Date: "not-a-date", AccountId: "cash", Balance: 100 },
		];
		const seen: { url: string; init?: RequestInit }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown, init?: RequestInit) => {
				seen.push({ url: String(url), init });
				const headers = new Headers({ "content-type": "application/json" });
				const resource = getUserScope().resource?.id;
				if (resource) headers.set("Waypoint-Resource", resource);
				return new Response(
					JSON.stringify({ result: projectionFixture(), issues: [] }),
					{ headers },
				);
			}),
		);
		let thrown: unknown = null;
		let rendered: ReturnType<typeof renderHook> | null = null;
		try {
			rendered = renderHook(() =>
				useRemoteProjection({
					document: broken,
					years: 2,
					ranges: false,
				}),
			);
			await rendered.settle();
		} catch (cause) {
			thrown = cause;
		}
		expect(thrown).toBeNull();
		const malformedBody = JSON.parse(
			String(
				seen.find((call) => call.url.endsWith("/v1/projections/deterministic"))
					?.init?.body ?? "{}",
			),
		);
		expect(malformedBody).toMatchObject({ range: {} });
		rendered?.unmount();
		vi.unstubAllGlobals();
	});

	it("passes an explicit date range through to the deterministic body", async () => {
		const seen: { url: string; init?: RequestInit }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown, init?: RequestInit) => {
				seen.push({ url: String(url), init });
				const headers = new Headers({ "content-type": "application/json" });
				const resource = getUserScope().resource?.id;
				if (resource) headers.set("Waypoint-Resource", resource);
				return new Response(
					JSON.stringify({ result: projectionFixture(), issues: [] }),
					{ headers },
				);
			}),
		);
		const narrowed = { startDate: "2026-01-31", endDate: "2026-06-30" };
		const one = renderHook(() =>
			useRemoteProjection({
				document: modelFixture(),
				years: 2,
				ranges: false,
				dateRange: narrowed,
			}),
		);
		const two = renderHook(() =>
			useRemoteProjection({
				document: modelFixture(),
				years: 2,
				ranges: false,
			}),
		);
		await one.settle();
		await two.settle();
		const bodies = seen
			.filter((call) => call.url.endsWith("/v1/projections/deterministic"))
			.map((call) => JSON.parse(String(call.init?.body ?? "{}")));
		expect(bodies).toContainEqual(expect.objectContaining({ range: narrowed }));
		expect(bodies).toContainEqual(
			expect.objectContaining({ range: { endDate: "2028-01-31" } }),
		);
		one.unmount();
		two.unmount();
		vi.unstubAllGlobals();
	});

	it.each([0, 1] as const)(
		"shares progress and survives consumer %i leaving without a retry",
		async (leaving) => {
			const { client, stream } = scenarioStreamClient();
			const consume = () =>
				useRemoteProjection({
					document: modelFixture(),
					years: 2,
					ranges: true,
				});
			const consumers = [renderHook(consume), renderHook(consume)] as const;
			await consumers[0].settle();
			expect(client.projectStochastic).toHaveBeenCalledTimes(1);
			await act(async () => {
				stream().send("progress", { progress: { fraction: 0.25 } });
			});
			await waitFor(() => {
				for (const consumer of consumers)
					expect(consumer.result().progress).toBe(0.25);
			});
			await act(async () => {
				stream().send("partial", {
					progress: { fraction: 0.5 },
					partial: stochasticFixture(),
				});
			});
			await waitFor(() => {
				for (const consumer of consumers)
					expect(consumer.result().range).toMatchObject({ count: 4 });
			});
			const late = renderHook(consume);
			expect(late.result().progress).toBe(0.5);
			expect(late.result().range).toMatchObject({ count: 4 });
			consumers[leaving].unmount();
			late.unmount();
			expect(stream().signal.aborted).toBe(false);
			await act(async () => {
				stream().send("result", { result: stochasticFixture() });
				stream().close();
			});
			const remaining = consumers[leaving === 0 ? 1 : 0];
			await waitFor(() => expect(remaining.result().progress).toBe(1));
			expect(remaining.result().rangeError).toBeNull();
			expect(client.projectStochastic).toHaveBeenCalledTimes(1);
			remaining.unmount();
			const remounted = renderHook(consume);
			await remounted.settle();
			expect(remounted.result().progress).toBe(1);
			expect(client.projectStochastic).toHaveBeenCalledTimes(1);
			remounted.unmount();
		},
	);

	it("cancels the last subscriber and never reuses an unfinished snapshot", async () => {
		const { client, stream } = scenarioStreamClient();
		const consume = () =>
			useRemoteProjection({ document: modelFixture(), ranges: true });
		const first = renderHook(consume);
		await first.settle();
		await act(async () => {
			stream().send("partial", {
				progress: { fraction: 0.5 },
				partial: stochasticFixture(),
			});
		});
		await waitFor(() => expect(first.result().progress).toBe(0.5));
		first.unmount();
		expect(stream().signal.aborted).toBe(true);
		const second = renderHook(consume);
		await second.settle();
		expect(client.projectStochastic).toHaveBeenCalledTimes(2);
		expect(second.result().progress).toBe(0);
		expect(second.result().range).toBeNull();
		expect(useNotifications.getState().items).toHaveLength(0);
		second.unmount();
	});

	it("cancels explicitly without exposing a framework error or retry notice", async () => {
		const { client, stream } = scenarioStreamClient();
		const rendered = renderHook(() =>
			useRemoteProjection({ document: modelFixture(), ranges: true }),
		);
		await rendered.settle();
		await act(async () => {
			stream().send("partial", {
				progress: { fraction: 0.5 },
				partial: stochasticFixture(),
			});
		});
		await waitFor(() => expect(rendered.result().progress).toBe(0.5));
		await act(async () => rendered.result().abort());
		expect(stream().signal.aborted).toBe(true);
		expect(rendered.result().rangeError).toBeNull();
		expect(useNotifications.getState().items).toHaveLength(0);
		expect(client.projectStochastic).toHaveBeenCalledTimes(1);
		rendered.unmount();
	});

	it("lets Query restart a canceled stream under Strict Mode", async () => {
		const { stream } = scenarioStreamClient();
		const rendered = renderHookWith(
			() => useRemoteProjection({ document: modelFixture(), ranges: true }),
			{ strictMode: true },
		);
		await rendered.settle();
		expect(stream().signal.aborted).toBe(true);
		const active = stream(-1);
		expect(active.signal.aborted).toBe(false);
		await act(async () => {
			active.send("result", { result: stochasticFixture() });
			active.close();
		});
		await waitFor(() => expect(rendered.result().progress).toBe(1));
		expect(rendered.result().rangeError).toBeNull();
		expect(useNotifications.getState().items).toHaveLength(0);
		rendered.unmount();
	});

	it("detaches disabled consumers and cancels when none remain", async () => {
		const { stream } = scenarioStreamClient();
		let ranges = true;
		const first = renderHook(() =>
			useRemoteProjection({ document: modelFixture(), ranges }),
		);
		const second = renderHook(() =>
			useRemoteProjection({ document: modelFixture(), ranges }),
		);
		await first.settle();
		ranges = false;
		first.rerender();
		expect(stream().signal.aborted).toBe(false);
		second.rerender();
		expect(stream().signal.aborted).toBe(true);
		expect(first.result().range).toBeNull();
		expect(first.result().progress).toBe(0);
		first.unmount();
		second.unmount();
	});

	it.each(["button", "notice"])(
		"shares stream errors and retries through the %s",
		async (retryFrom) => {
			const { client, stream } = scenarioStreamClient();
			const consume = () =>
				useRemoteProjection({ document: modelFixture(), ranges: true });
			const first = renderHook(consume);
			const second = renderHook(consume);
			await first.settle();
			await act(async () => {
				stream().send("partial", {
					progress: { fraction: 0.5 },
					partial: stochasticFixture(),
				});
				stream().send("error", { error: "range failed" });
				stream().close();
			});
			await waitFor(() => {
				expect(first.result().rangeError).toBe("range failed");
				expect(second.result().rangeError).toBe("range failed");
			});
			expect(client.projectStochastic).toHaveBeenCalledTimes(1);
			await act(async () => {
				if (retryFrom === "button") second.result().retryRange();
				else {
					const action = useNotifications.getState().items[0]?.action;
					if (!action) throw new Error("Expected a shared retry notice");
					action.onAction();
				}
			});
			await waitFor(() =>
				expect(client.projectStochastic).toHaveBeenCalledTimes(2),
			);
			await waitFor(() => {
				expect(first.result().progress).toBe(0);
				expect(second.result().range).toBeNull();
				expect(second.result().rangeError).toBeNull();
			});
			await act(async () => {
				stream(1).send("result", { result: stochasticFixture() });
				stream(1).close();
			});
			await waitFor(() => {
				expect(first.result().progress).toBe(1);
				expect(second.result().progress).toBe(1);
			});
			expect(useNotifications.getState().items).toHaveLength(0);
			first.unmount();
			second.unmount();
		},
	);

	it("cancels shared work at session change and ignores late retired results", async () => {
		// Deliberately ignore abort in the transport to test the publication guard.
		const { client, stream } = scenarioStreamClient(false);
		const consume = () =>
			useRemoteProjection({ document: modelFixture(), ranges: true });
		const first = renderHook(consume);
		const second = renderHook(consume);
		await first.settle();
		await act(async () => {
			stream().send("partial", {
				progress: { fraction: 0.5 },
				partial: stochasticFixture(),
			});
		});
		await waitFor(() => expect(second.result().progress).toBe(0.5));
		await act(async () => {
			suspendUserScope();
			await clearResourceQueryCache();
			expect(stream().signal.aborted).toBe(true);
			first.unmount();
			second.unmount();
		});
		expect(stream().signal.aborted).toBe(true);
		await act(async () => {
			stream().send("result", { result: stochasticFixture() });
			stream().close();
		});
		expect(serverQueryClient().getQueryCache().getAll()).toHaveLength(0);
		expect(useNotifications.getState().items).toHaveLength(0);
		acceptUserScope(
			{
				apiBaseUrl: canonicalApiBaseUrl(""),
				resource: {
					id: "users/other",
					kind: "private",
					permissions: ["user:read", "user:project"],
				},
				subject: "other",
			},
			suspendUserScope(),
		);
		const nextOwner = renderHook(consume);
		await nextOwner.settle();
		expect(client.projectStochastic).toHaveBeenCalledTimes(2);
		expect(nextOwner.result().range).toBeNull();
		nextOwner.unmount();
		stream(1).close();
	});

	it("preserves an SSE error event as the range error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown) => {
				const headers = new Headers();
				const resource = getUserScope().resource?.id;
				if (resource) headers.set("Waypoint-Resource", resource);
				if (String(url).endsWith("/v1/projections/deterministic")) {
					headers.set("content-type", "application/json");
					return new Response(
						JSON.stringify({ result: projectionFixture(), issues: [] }),
						{ headers },
					);
				}
				headers.set("content-type", "text/event-stream");
				return new Response(
					'event: error\ndata: {"error":"range failed"}\n\n',
					{
						status: 200,
						headers,
					},
				);
			}),
		);
		const rendered = renderHook(() =>
			useRemoteProjection({
				document: modelFixture(),
				years: 1,
				ranges: true,
			}),
		);
		await rendered.settle();
		expect(rendered.result().rangeError).not.toBeNull();
		const items = useNotifications.getState().items;
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			key: "projection-range",
			kind: "error",
			message: "range failed",
		});
		expect(items[0]?.action?.label).toBe("Retry scenario calculation");
		rendered.unmount();
		vi.unstubAllGlobals();
	});

	it("floats deterministic failures with a retry action", async () => {
		const seen: { url: string }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown) => {
				seen.push({ url: String(url) });
				if (String(url).endsWith("/v1/projections/deterministic"))
					throw new Error("no numbers today");
				throw new Error(`Unexpected fetch: ${String(url)}`);
			}),
		);
		const rendered = renderHook(() =>
			useRemoteProjection({
				document: modelFixture(),
				years: 1,
				ranges: false,
			}),
		);
		await rendered.settle();
		expect(rendered.result().base).toBeNull();
		await waitFor(() => expect(rendered.result().baseError).not.toBeNull());
		const items = useNotifications.getState().items;
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			key: "projection",
			kind: "error",
			message: expect.any(String),
		});
		expect(items[0]?.action?.label).toBe("Retry calculation");
		const calls = seen.filter((call) =>
			call.url.endsWith("/v1/projections/deterministic"),
		).length;
		items[0]?.action?.onAction();
		await waitFor(() =>
			expect(
				seen.filter((call) =>
					call.url.endsWith("/v1/projections/deterministic"),
				).length,
			).toBeGreaterThan(calls),
		);
		rendered.unmount();
		vi.unstubAllGlobals();
	});

	it("reports a clear error instead of using example data without a document", async () => {
		const rendered = renderHook(() =>
			useRemoteProjection({ years: 2, ranges: false }),
		);
		await rendered.settle();
		expect(rendered.result().base).toBeInstanceOf(Error);
		expect(rendered.result().base).toBeInstanceOf(Error);
		rendered.unmount();
	});
});

describe("in-memory draft scope", () => {
	it("clears the in-memory draft when the active resource changes", async () => {
		vi.stubGlobal("localStorage", memoryStorage());
		const mount = async (id: string) => {
			acceptUserScope(
				{
					apiBaseUrl: canonicalApiBaseUrl(""),
					resource: {
						id,
						kind: id === "users/sample" ? "sample" : "private",
						permissions: ["user:read", "user:project", "user:write"],
					},
					subject: id === "users/sample" ? null : id,
				},
				suspendUserScope(),
			);
			resetWorkspaceStore();
			resetServerQueryCache();
			stubTestServer();
			const rendered = renderHook(() => useRemoteWorkspace());
			await rendered.settle();
			return rendered;
		};
		const first = await mount("users/a");
		expect(
			first
				.result()
				.updatePlan(withTransactionAmount(first.result().plan!, 125)),
		).toBe(true);
		first.unmount();
		const second = await mount("users/b");
		expect(second.result().workspace?.draft).toBeNull();
		expect(
			second
				.result()
				.updatePlan(withTransactionAmount(second.result().plan!, 175)),
		).toBe(true);
		second.unmount();
		const sample = await mount("users/sample");
		expect(sample.result().workspace?.draft).toBeNull();
		expect(sample.result().plan?.transactions[0]?.amount).toBe(100);
		sample.unmount();
	});

	it("uses a stable semantic server fingerprint", () => {
		const document = modelFixture();
		const reordered = {
			postings: document.postings,
			recurrenceRules: document.recurrenceRules,
			evaluations: document.evaluations,
			checkpoints: document.checkpoints,
			accounts: document.accounts,
			sourcePath: document.sourcePath,
		};
		const changed = modelFixture();
		changed.recurrenceRules[0] = {
			...changed.recurrenceRules[0]!,
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
});
