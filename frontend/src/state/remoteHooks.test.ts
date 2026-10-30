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
import { createAccount } from "../api/generated/endpoints.ts";
import {
	ApiHttpError,
	type ApiRequestOptions,
	type FinancialModelDocument,
	type FinancialModelResponse,
	type ProjectionResult,
	type StochasticProjectionResult,
	type StochasticProjectionRequest,
} from "../api/index.ts";
import { serverDocumentFingerprint } from "./remoteStorage.ts";
import { fixtureDocument } from "../mocks/document.ts";
import { GUEST_USER_ID, GUEST_USER_SUBJECT } from "../mocks/resource.ts";
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
import { useSavedAccounts } from "./savedRows.ts";
import {
	useServerModel,
	useServerStatus,
	useAmountPresets,
	getServerModel,
	modelOptions,
	presetsOptions,
	statusOptions,
	reloadWorkspace,
	refreshAccounts,
	userResourceKey,
} from "./workspaceResources.ts";
import {
	importServerDocument,
	performSave,
	useWorkspaceWriteError,
	useWorkspaceSaving,
} from "./workspaceWrites.ts";
import { modelFixture, stubTestServer } from "../mocks/waypointServer.ts";

// Test observations read the canonical saved state. Query owns every
// request lifecycle and the server document is the only model: there is
// no replacement aggregate to maintain here.
function useRemoteWorkspace() {
	useWorkspaceStartup();
	const model = useServerModel();
	const status = useServerStatus();
	const presets = useAmountPresets();
	const mutationError = useWorkspaceWriteError();
	const saving = useWorkspaceSaving();
	const savedAccounts = useSavedAccounts();
	const document = model.data?.document ?? null;
	const error =
		(mutationError instanceof Error ? mutationError.message : null) ??
		model.error?.message ??
		(model.data && !model.data.document
			? "The server has no financial model to display."
			: null);
	return {
		serverDocument: document,
		savedAccounts,
		serverPresets: presets.data ?? null,
		presetError: presets.error?.message ?? null,
		status: status.data ?? null,
		error,
		loading: model.isFetching,
		saving,
		readOnly: Boolean(
			status.data?.readOnly ||
			(mutationError instanceof ApiHttpError && mutationError.status === 403),
		),
		authRequired:
			mutationError instanceof ApiHttpError && mutationError.status === 401,
		retry: () => reloadWorkspace(),
		importServerDocument: (next: FinancialModelDocument) =>
			importServerDocument(next),
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
				id: GUEST_USER_ID,
				permissions: ["user:read", "user:project"],
			},
			subject: GUEST_USER_SUBJECT,
		},
		suspendUserScope(),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	resetServerQueryCache();
	resetUiStore();
	resetNotifications();
});

describe("remote workspace state", () => {
	it("retains the loaded financial model after a failed background reload", async () => {
		const server = stubTestServer();
		const view = renderHook(() => useRemoteWorkspace());
		await waitFor(() => expect(view.result().loading).toBe(false));
		const previous = view.result().serverDocument;
		expect(previous).not.toBeNull();
		server.failModelOnce(new Error("offline"));
		await act(async () => reloadWorkspace());
		await view.settle();
		expect(view.result().serverDocument).toBe(previous);
		expect(view.result().error).not.toBeNull();
		// A later reload recovers without losing the saved document.
		await act(async () => reloadWorkspace());
		await view.settle();
		expect(view.result().error).toBeNull();
		expect(view.result().serverDocument).toEqual(previous);
		view.unmount();
	});

	// Regression: the mount effect used to abort its in-flight load on cleanup.
	// React's development double-mount tears that effect down immediately, and
	// the remount reused the same in-flight promise, so hydration never
	// completed and the app stayed on "Connecting to your Waypoint server".
	it("completes hydration across a strict-mode remount", async () => {
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
		expect(rendered.result().serverDocument).not.toBeNull();
		expect(rendered.result().error).toBeNull();
		rendered.unmount();
	});

	it("lets Query cancel the initial load on its last observer's unmount", async () => {
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
	});

	it("keeps session credentials out of workspace and UI state", async () => {
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
		expect(useUiStore.getState()).not.toHaveProperty("authToken");
		rendered.unmount();
	});

	it("uses a replacement client on an explicit Query refresh", async () => {
		const server = stubTestServer();
		const rendered = renderHookRTL(() => useWorkspaceStartup());
		await waitFor(() => expect(getServerModel()?.document).toBeDefined());
		expect(server.modelFetches()).toHaveLength(1);
		(server.model as FinancialModelDocument).accounts[0]!.name =
			"Replacement cash";
		await act(async () => reloadWorkspace());
		expect(server.modelFetches()).toHaveLength(2);
		expect(getServerModel()?.document?.accounts[0]?.name).toBe(
			"Replacement cash",
		);
		rendered.unmount();
	});

	it("reuses a pending load on client change and uses the new binding on retry", async () => {
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
		const server = stubTestServer();
		server.failPresetsOnce(new Error("Recipes unavailable"));
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(rendered.result().serverDocument).not.toBeNull();
		expect(rendered.result().error).toBeNull();
		expect(rendered.result().presetError).not.toBeNull();
		await rendered.result().refreshPresets();
		await rendered.settle();
		expect(rendered.result().serverPresets).toEqual([]);
		expect(rendered.result().presetError).toBeNull();
		rendered.unmount();
	});

	it("saves an account row and projects the refreshed saved document", async () => {
		stubTestServer();
		const view = renderHook(() => useRemoteWorkspace());
		await waitFor(() => expect(view.result().loading).toBe(false));
		const ok = await performSave({
			call: () =>
				createAccount({
					name: "Travel savings",
					kind: "cash",
					enabled: true,
					balance: 2500,
					observedAt: Date.parse("2026-02-15T23:59:59Z") / 1000,
				}),
			refresh: refreshAccounts,
			failureMessage: "The account could not be saved.",
		});
		expect(ok).toBe(true);
		await view.settle();
		const document = view.result().serverDocument!;
		expect(document.accounts.map((account) => account.name)).toContain(
			"Travel savings",
		);
		await waitFor(() =>
			expect(
				view.result().savedAccounts?.map((account) => account.name),
			).toContain("Travel savings"),
		);
		expect(view.result().error).toBeNull();
		view.unmount();

		// Projections consume the saved document as-is; no draft overlay exists.
		// The stub echoes the resource scope like the other projection fakes
		// so the client does not retire the scope on a mismatched response.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				const headers = new Headers({ "content-type": "application/json" });
				const resource = getUserScope().resource?.id;
				if (resource) headers.set("Waypoint-Resource", resource);
				return new Response(
					JSON.stringify({ result: projectionFixture(), issues: [] }),
					{ headers },
				);
			}),
		);
		const projected = renderHook(() =>
			useRemoteProjection({ document, years: 2, ranges: false }),
		);
		await projected.settle();
		expect(projected.result().base).toMatchObject({ inflows: 100 });
		expect(projected.result().baseError).toBeNull();
		projected.unmount();
		vi.unstubAllGlobals();
	});

	it("row save rejection keeps the saved document and never reports success", async () => {
		const server = stubTestServer();
		const view = renderHook(() => useRemoteWorkspace());
		await waitFor(() => expect(view.result().loading).toBe(false));
		server.writeOnce(
			(method, path) => method === "POST" && path === "/v1/accounts",
			{
				row: null,
				issues: [{ severity: "error", message: "Name is required." }],
				persisted: false,
				revision: '"rejected"',
			},
		);
		const ok = await performSave({
			call: () =>
				createAccount({
					name: "Travel savings",
					kind: "cash",
					enabled: true,
					balance: 2500,
					observedAt: Date.parse("2026-02-15T23:59:59Z") / 1000,
				}),
			refresh: refreshAccounts,
			failureMessage: "The account could not be saved.",
		});
		expect(ok).toBe(false);
		await view.settle();
		// The rejection refreshes authoritative state first, and the saved
		// rows are untouched.
		expect(server.modelFetches().length).toBeGreaterThanOrEqual(2);
		expect(view.result().serverDocument?.accounts).toHaveLength(2);
		const items = useNotifications.getState().items;
		expect(
			items.some(
				(item) =>
					item.kind === "error" && item.message.includes("Name is required."),
			),
		).toBe(true);
		expect(items.some((item) => item.kind === "success")).toBe(false);
		view.unmount();
	});

	it("a row save retired by a resource switch does not report success", async () => {
		const server = stubTestServer();
		const view = renderHook(() => useRemoteWorkspace());
		await waitFor(() => expect(view.result().loading).toBe(false));
		const release = server.holdWriteOnce(
			(method, path) => method === "POST" && path === "/v1/accounts",
		);
		const saving = performSave({
			call: () =>
				createAccount({
					name: "Travel savings",
					kind: "cash",
					enabled: true,
					balance: 2500,
					observedAt: Date.parse("2026-02-15T23:59:59Z") / 1000,
				}),
			refresh: refreshAccounts,
			failureMessage: "The account could not be saved.",
		});
		await waitFor(() =>
			expect(
				server.calls.filter(
					(call) => call.method === "POST" && call.url === "/v1/accounts",
				),
			).not.toHaveLength(0),
		);
		suspendUserScope();
		view.unmount();
		release(undefined);
		expect(await saving).toBe(false);
		expect(getServerModel()).toBeUndefined();
		expect(
			useNotifications.getState().items.some((item) => item.kind === "success"),
		).toBe(false);
	});

	it("creates rows when importing into an empty server", async () => {
		const server = stubTestServer();
		server.failModelOnce({
			document: null,
			issues: [],
		} as unknown as FinancialModelResponse);
		const rendered = renderHook(() => useRemoteWorkspace());
		await rendered.settle();
		expect(rendered.result().serverDocument).toBeNull();
		expect(
			await rendered.result().importServerDocument(fixtureDocument()),
		).toBe(true);
		await rendered.settle();
		expect(
			server.calls.filter(
				(call) => call.method === "POST" && call.url === "/v1/accounts",
			),
		).not.toHaveLength(0);
		expect(rendered.result().serverDocument).not.toBeNull();
		rendered.unmount();
	});

	it("surfaces a failed import without recording saved data", async () => {
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
		expect(rendered.result().serverDocument).toBeNull();
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

	it("refuses an import while the initial model query is pending", async () => {
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
		expect(projectionResultToLocal(result, document).transactions).toHaveLength(
			1,
		);
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
			{ AccountId: "cash", Balance: 100, observedAt: 1769903999 },
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

describe("saved-state resource scope", () => {
	it("isolates saved state per resource", async () => {
		const mount = async (id: string, accountName: string) => {
			acceptUserScope(
				{
					apiBaseUrl: canonicalApiBaseUrl(""),
					resource: {
						id,
						permissions: ["user:read", "user:project", "user:write"],
					},
					subject: id === GUEST_USER_ID ? GUEST_USER_SUBJECT : id,
				},
				suspendUserScope(),
			);
			resetServerQueryCache();
			const server = stubTestServer();
			server.model.accounts[0]!.name = accountName;
			const rendered = renderHook(() => useRemoteWorkspace());
			await waitFor(() => expect(rendered.result().loading).toBe(false));
			return { rendered, scope: getUserScope() };
		};
		const first = await mount("users/a", "A cash");
		expect(first.rendered.result().serverDocument?.accounts[0]?.name).toBe(
			"A cash",
		);
		first.rendered.unmount();
		const second = await mount("users/b", "B cash");
		expect(second.rendered.result().serverDocument?.accounts[0]?.name).toBe(
			"B cash",
		);
		expect(
			serverQueryClient().getQueryData(userResourceKey("model", first.scope)),
		).toBeUndefined();
		second.rendered.unmount();
		const sample = await mount(GUEST_USER_ID, "Cash");
		expect(sample.rendered.result().serverDocument?.accounts[0]?.name).toBe(
			"Cash",
		);
		sample.rendered.unmount();
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
