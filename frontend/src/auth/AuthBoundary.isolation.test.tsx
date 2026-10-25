import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	deterministicQueryKey,
	resetServerQueryCache,
	serverQueryClient,
} from "../state/serverQuery.ts";
import {
	resetWorkspaceStore,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { AuthBoundary } from "./AuthBoundary.tsx";
import { getResourceScope, suspendResourceScope } from "./resourceScope.ts";
import { useSession } from "./sessionContext.ts";
import {
	appLocalStorage,
	clearPersistedMemory,
	SAFE_SPENDING_STORAGE_KEY,
} from "../state/persisted.ts";
import {
	defaultSafeSpendingSettings,
	useSafeSpendingSettings,
} from "../state/useSafeSpendingSettings.ts";
import { canonicalApiBaseUrl, resourceStorageKey } from "./resourceScope.ts";

const A = `plans/${"a".repeat(64)}`;
const B = `plans/${"b".repeat(64)}`;

function session(id = A) {
	return {
		enabled: true,
		authenticated: id !== "plans/sample",
		allowed: true,
		resource: {
			id,
			kind: id === "plans/sample" ? "sample" : "private",
			permissions: [
				"plan:read",
				"plan:project",
				...(id === "plans/sample" ? [] : ["plan:write"]),
			],
		},
		user: {
			subject: id === "plans/sample" ? "" : id,
			name: "Account",
		},
	};
}

function response(body: unknown, resource: string | null = A) {
	const headers = new Headers({ "content-type": "application/json" });
	if (resource) headers.set("X-Waypoint-Resource", resource);
	return new Response(JSON.stringify(body), { headers });
}

function WorkspaceProbe() {
	const account = useSession();
	const revision = useWorkspaceStore((state) => state.serverRevision);
	return (
		<p data-testid="active-workspace">
			{account?.session.resource?.id}:{revision ?? "empty"}
		</p>
	);
}

function FinancialPreferencesProbe() {
	const settings = useSafeSpendingSettings();
	return (
		<p data-testid="financial-preferences">
			{settings.reserve}:{settings.incomeRuleIds.join(",")}
		</p>
	);
}

function renderWorkspace() {
	return render(
		<AuthBoundary>
			<WorkspaceProbe />
		</AuthBoundary>,
	);
}

beforeEach(() => {
	vi.stubGlobal("BroadcastChannel", undefined);
	suspendResourceScope();
	clearPersistedMemory();
	resetWorkspaceStore();
});
afterEach(() => {
	cleanup();
	delete window.__WAYPOINT_CONFIG__;
	resetWorkspaceStore();
	resetServerQueryCache();
	clearPersistedMemory();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("authentication resource isolation", () => {
	it("waits for resource-owned financial preferences before mounting children", async () => {
		const key = resourceStorageKey(SAFE_SPENDING_STORAGE_KEY, {
			status: "ready",
			key: "fixture",
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: { id: A, kind: "private", permissions: ["plan:read"] },
			subject: A,
		});
		let finish: (raw: string) => void = () => {};
		const getItem = appLocalStorage.getItem;
		const read = vi
			.spyOn(appLocalStorage, "getItem")
			.mockImplementation((name) =>
				name === key
					? new Promise<string>((resolve) => {
							finish = resolve;
						})
					: getItem(name),
			);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(session())),
		);
		render(
			<AuthBoundary>
				<FinancialPreferencesProbe />
			</AuthBoundary>,
		);
		await waitFor(() => expect(read).toHaveBeenCalledWith(key));
		expect(screen.queryByTestId("financial-preferences")).toBeNull();
		await act(async () =>
			finish(
				JSON.stringify({
					state: { reserve: 123, incomeRuleIds: ["private-a-income"] },
					version: 4,
				}),
			),
		);
		expect(
			(await screen.findByTestId("financial-preferences")).textContent,
		).toBe("123:private-a-income");
	});

	it("resets financial preferences during a cross-tab identity check before the next owner's children mount", async () => {
		const fetcher = vi.fn(async () => response(session()));
		vi.stubGlobal("fetch", fetcher);
		render(
			<AuthBoundary>
				<FinancialPreferencesProbe />
			</AuthBoundary>,
		);
		await screen.findByTestId("financial-preferences");
		act(() =>
			useSafeSpendingSettings.getState().updateSettings({
				reserve: 123456,
				incomeRuleIds: ["private-a-income"],
			}),
		);
		let finish: (value: Response) => void = () => {};
		fetcher.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					finish = resolve;
				}),
		);
		act(() =>
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: "waypoint.session-change.v1",
					newValue: "changed",
				}),
			),
		);
		// Stale-while-revalidate keeps the previous owner's preferences
		// visible until discovery proves the new owner.
		expect(screen.getByTestId("financial-preferences").textContent).toBe(
			"123456:private-a-income",
		);
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
		expect(screen.getByTestId("financial-preferences").textContent).toBe(
			"123456:private-a-income",
		);
		await act(async () => finish(response(session(B), B)));
		expect(
			(await screen.findByTestId("financial-preferences")).textContent,
		).toBe(`${defaultSafeSpendingSettings().reserve}:`);
	});

	it("clears live model and projection state before it first mounts a verified workspace", async () => {
		useWorkspaceStore.setState({
			serverRevision: "previous-account-private-revision",
			serverPresets: [{ id: "previous-private-recipe" }] as never,
		});
		serverQueryClient().setQueryData(
			["old-projection"],
			"previous-private-result",
		);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(session())),
		);
		renderWorkspace();
		expect((await screen.findByTestId("active-workspace")).textContent).toBe(
			`${A}:empty`,
		);
		expect(useWorkspaceStore.getState().serverPresets).toBeNull();
		expect(serverQueryClient().getQueryCache().getAll()).toHaveLength(0);
	});

	it.each([B, "plans/sample"])(
		"keeps the old workspace during a cross-tab check and clears it before resource %s mounts",
		async (nextId) => {
			const fetcher = vi.fn(async () => response(session()));
			vi.stubGlobal("fetch", fetcher);
			renderWorkspace();
			await screen.findByTestId("active-workspace");
			act(() =>
				useWorkspaceStore.setState({
					serverRevision: "account-a-private-revision",
				}),
			);
			const oldKey = deterministicQueryKey("private-a-document", 10);
			serverQueryClient().setQueryData(oldKey, "private-a-result");
			let finish: (value: Response) => void = () => {};
			fetcher.mockImplementation(
				() =>
					new Promise<Response>((resolve) => {
						finish = resolve;
					}),
			);
			act(() =>
				window.dispatchEvent(
					new StorageEvent("storage", {
						key: "waypoint.session-change.v1",
						newValue: "signal-only",
					}),
				),
			);
			// Stale-while-revalidate: the previous workspace stays mounted
			// with its scope until the new resource is verified.
			expect(getResourceScope().status).toBe("ready");
			expect(screen.getByTestId("active-workspace").textContent).toBe(
				`${A}:account-a-private-revision`,
			);
			await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
			expect(screen.getByTestId("active-workspace").textContent).toBe(
				`${A}:account-a-private-revision`,
			);
			await act(async () => finish(response(session(nextId), nextId)));
			expect((await screen.findByTestId("active-workspace")).textContent).toBe(
				`${nextId}:empty`,
			);
			expect(serverQueryClient().getQueryData(oldKey)).toBeUndefined();
		},
	);

	it("does not accept an old session response after a newer account check completes", async () => {
		const fetcher = vi.fn(async () => response(session()));
		vi.stubGlobal("fetch", fetcher);
		renderWorkspace();
		await screen.findByTestId("active-workspace");
		let oldFinish: (value: Response) => void = () => {};
		fetcher.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					oldFinish = resolve;
				}),
		);
		act(() =>
			window.dispatchEvent(new Event("waypoint:authentication-required")),
		);
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
		fetcher.mockImplementation(async () => response(session(B), B));
		act(() =>
			window.dispatchEvent(new Event("waypoint:authentication-required")),
		);
		await waitFor(() =>
			expect(screen.getByTestId("active-workspace").textContent).toBe(
				`${B}:empty`,
			),
		);
		await act(async () => oldFinish(response(session(), A)));
		expect(screen.getByTestId("active-workspace").textContent).toBe(
			`${B}:empty`,
		);
		expect(getResourceScope().resource?.id).toBe(B);
	});

	it("preserves workspace data, recovery, and completed results across a same-account check", async () => {
		const fetcher = vi.fn(async () => response(session()));
		vi.stubGlobal("fetch", fetcher);
		renderWorkspace();
		await screen.findByTestId("active-workspace");
		const recovery = {
			version: 1 as const,
			draft: { name: "Private A draft" } as never,
			draftPresentation: null,
			baseRevision: "a",
		};
		const key = deterministicQueryKey("private-a-document", 10);
		act(() => {
			useWorkspaceStore.getState().engine.volatileState = recovery;
			useWorkspaceStore.setState({
				serverRevision: "private-a-revision",
				volatile: true,
			});
			serverQueryClient().setQueryData(key, "private-a-result");
			window.dispatchEvent(new Event("focus"));
		});
		// Same-account revalidation never unmounts the workspace.
		expect(screen.getByTestId("active-workspace").textContent).toBe(
			`${A}:private-a-revision`,
		);
		await waitFor(() =>
			expect(screen.getByTestId("active-workspace").textContent).toBe(
				`${A}:private-a-revision`,
			),
		);
		expect(useWorkspaceStore.getState().engine.volatileState).toBe(recovery);
		expect(useWorkspaceStore.getState().volatile).toBe(true);
		expect(deterministicQueryKey("private-a-document", 10)).toEqual(key);
		expect(serverQueryClient().getQueryData(key)).toBe("private-a-result");
	});

	it.each([A, B])(
		"keeps the workspace during a failed check and restores it only to account %s",
		async (nextId) => {
			const fetcher = vi.fn(async () => response(session()));
			vi.stubGlobal("fetch", fetcher);
			renderWorkspace();
			await screen.findByTestId("active-workspace");
			const recovery = {
				version: 1 as const,
				draft: { name: "Private A draft" } as never,
				draftPresentation: null,
				baseRevision: "a",
			};
			act(() => {
				useWorkspaceStore.getState().engine.volatileState = recovery;
				useWorkspaceStore.setState({ volatile: true });
			});
			fetcher.mockImplementationOnce(
				async () => new Response("", { status: 503 }),
			);
			act(() => window.dispatchEvent(new Event("focus")));
			await screen.findByRole("alert");
			// Transient outages keep the verified workspace mounted behind
			// a retry banner instead of wiping the UI.
			expect(screen.getByTestId("active-workspace")).toBeTruthy();
			expect(getResourceScope().status).toBe("ready");
			expect(useWorkspaceStore.getState().engine.volatileState).toBe(recovery);
			fetcher.mockImplementation(async () => response(session(nextId), nextId));
			act(() => window.dispatchEvent(new Event("focus")));
			await screen.findByTestId("active-workspace");
			expect(getResourceScope().resource?.id).toBe(nextId);
			expect(useWorkspaceStore.getState().engine.volatileState).toBe(
				nextId === A ? recovery : null,
			);
		},
	);

	it("resets active data and projection results after a permission change", async () => {
		const fetcher = vi.fn(async () => response(session()));
		vi.stubGlobal("fetch", fetcher);
		renderWorkspace();
		await screen.findByTestId("active-workspace");
		act(() =>
			useWorkspaceStore.setState({ serverRevision: "old-write-capability" }),
		);
		const key = deterministicQueryKey("private-a-document", 10);
		serverQueryClient().setQueryData(key, "old-permissions-result");
		fetcher.mockImplementation(async () =>
			response({
				...session(),
				resource: { ...session().resource, permissions: ["plan:read"] },
			}),
		);
		act(() => window.dispatchEvent(new Event("focus")));
		await waitFor(() =>
			expect(screen.getByTestId("active-workspace").textContent).toBe(
				`${A}:empty`,
			),
		);
		expect(serverQueryClient().getQueryData(key)).toBeUndefined();
		expect(getResourceScope().resource?.permissions).toEqual(["plan:read"]);
	});

	it("does not reuse data or recovery when the API address changes for the same account", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(session())),
		);
		renderWorkspace();
		await screen.findByTestId("active-workspace");
		const key = deterministicQueryKey("private-a-document", 10);
		serverQueryClient().setQueryData(key, "first-api-result");
		act(() => {
			useWorkspaceStore.setState({ serverRevision: "first-api-data" });
			useWorkspaceStore.getState().engine.volatileState = {
				version: 1,
				draft: { name: "First API draft" } as never,
				draftPresentation: null,
				baseRevision: "first-api",
			};
			window.__WAYPOINT_CONFIG__ = { apiBaseUrl: "/second-api" };
			window.dispatchEvent(new Event("focus"));
		});
		await waitFor(() =>
			expect(screen.getByTestId("active-workspace").textContent).toBe(
				`${A}:empty`,
			),
		);
		expect(getResourceScope().apiBaseUrl).toBe(
			canonicalApiBaseUrl("/second-api"),
		);
		expect(useWorkspaceStore.getState().engine.volatileState).toBeNull();
		expect(serverQueryClient().getQueryData(key)).toBeUndefined();
	});

	it("rejects discovery if its API address changes while the response is pending", async () => {
		let finish: (value: Response) => void = () => {};
		const fetcher = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					finish = resolve;
				}),
		);
		vi.stubGlobal("fetch", fetcher);
		renderWorkspace();
		await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
		window.__WAYPOINT_CONFIG__ = { apiBaseUrl: "/second-api" };
		await act(async () => finish(response(session())));
		expect((await screen.findByRole("alert")).textContent).toBe(
			"The API address changed. Retry the session check.",
		);
		expect(screen.queryByTestId("active-workspace")).toBeNull();
		expect(getResourceScope().status).toBe("pending");
	});

	it.each([
		["missing resource", { ...session(), resource: undefined }, A],
		["missing header", session(), null],
		["wrong header", session(), B],
		["guest private resource", { ...session(), authenticated: false }, A],
		["missing private subject", { ...session(), user: undefined }, A],
		[
			"invalid private resource ID",
			{ ...session(), resource: { ...session().resource, id: "plans/sample" } },
			"plans/sample",
		],
		[
			"missing read permission",
			{
				...session(),
				resource: { ...session().resource, permissions: ["plan:write"] },
			},
			A,
		],
	])("fails closed on %s", async (_name, body, header) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(body, header as string | null)),
		);
		renderWorkspace();
		await screen.findByRole("alert");
		expect(screen.queryByTestId("active-workspace")).toBeNull();
		expect(getResourceScope().status).toBe("pending");
	});

	it("verifies the resource across a strict-mode remount", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(session())),
		);
		render(
			<StrictMode>
				<AuthBoundary>
					<WorkspaceProbe />
				</AuthBoundary>
			</StrictMode>,
		);
		expect((await screen.findByTestId("active-workspace")).textContent).toBe(
			`${A}:empty`,
		);
		expect(getResourceScope().status).toBe("ready");
	});
});
