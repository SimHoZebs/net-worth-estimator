import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	deterministicQueryKey,
	resetServerQueryCache,
	serverQueryClient,
} from "@/state/serverQuery.ts";
import { AuthBoundary } from "@/auth/AuthBoundary.tsx";
import {
	getServerModel,
	useServerModel,
	userResourceKey,
} from "@/state/workspaceResources.ts";
import { setServerRevisionFixture } from "@/mocks/workspace.ts";
import { NotificationCenter } from "@/components/NotificationCenter.tsx";
import { resetNotifications } from "@/state/notifications.ts";
import { getUserScope, suspendUserScope } from "@/auth/resourceScope.ts";
import { ok } from "@/mocks/fetch.ts";
import { useSession } from "@/auth/sessionContext.ts";
import { clearPersistedMemory } from "@/state/persisted.ts";
import {
	defaultSafeSpendingSettings,
	useSafeSpendingSettings,
} from "@/state/useSafeSpendingSettings.ts";
import { safeSpendingSettingsObserver } from "@/mocks/safeSpendingSettings.ts";
import { canonicalApiBaseUrl } from "@/auth/resourceScope.ts";
import { GUEST_USER_ID, GUEST_USER_SUBJECT } from "@/mocks/resource.ts";

const A = `users/${"a".repeat(64)}`;
const B = `users/${"b".repeat(64)}`;

// All identities share one shape: a canonical provisioned user id plus a
// provisioned subject, guests included. Only `authenticated` differs.
function session(id = A, authenticated = true) {
	return {
		enabled: true,
		authenticated,
		allowed: true,
		resource: {
			id,
			permissions: authenticated
				? ["user:read", "user:project", "user:write"]
				: ["user:read", "user:project"],
		},
		user: {
			subject: id === GUEST_USER_ID ? GUEST_USER_SUBJECT : id,
			name: "Account",
		},
	};
}

function response(body: unknown, resource: string | null = A) {
	const headers = new Headers({ "content-type": "application/json" });
	if (resource) headers.set("Waypoint-Resource", resource);
	return new Response(JSON.stringify(body), { headers });
}

const settingsByResource = new Map<string, unknown>();

function route(input: RequestInfo | URL, init?: RequestInit) {
	const url = String(input);
	// Echo the request assertion like the backend: the requesting scope is
	// captured before the network round-trip, while the current scope may
	// already have moved on (suspend during adoption).
	const requested = init?.headers
		? new Headers(init.headers).get("Waypoint-Resource")
		: null;
	const resource = requested ?? getUserScope().resource?.id ?? "";
	if (url.endsWith("/v1/safe-spending-settings")) {
		if ((init?.method ?? "GET") !== "GET") {
			const body = JSON.parse(String(init?.body ?? "{}")) as {
				settings?: unknown;
			};
			settingsByResource.set(resource, body.settings ?? null);
		}
		return ok({ settings: settingsByResource.get(resource) ?? null });
	}
	if (url.endsWith("/v1/financial-model"))
		return ok({ model: null, issues: [] });
	if (url.endsWith("/v1/amount-presets")) return ok({ presets: [] });
	if (url.endsWith("/v1/status")) return ok({ readOnly: false });
	return response(session());
}

function WorkspaceProbe() {
	const account = useSession();
	const revision = useServerModel().data?.revision;
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
			<NotificationCenter />
		</AuthBoundary>,
	);
}

beforeEach(() => {
	vi.stubGlobal("BroadcastChannel", undefined);
	settingsByResource.clear();
	suspendUserScope();
	clearPersistedMemory();
});
afterEach(() => {
	cleanup();
	delete window.__WAYPOINT_CONFIG__;
	resetServerQueryCache();
	resetNotifications();
	clearPersistedMemory();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("authentication resource isolation", () => {
	it("waits for resource-owned financial preferences before mounting children", async () => {
		let finish: (value: Response) => void = () => {};
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).endsWith("/v1/safe-spending-settings"))
				return new Promise<Response>((resolve) => {
					finish = resolve;
				});
			return response(session());
		});
		vi.stubGlobal("fetch", fetchMock);
		render(
			<AuthBoundary>
				<FinancialPreferencesProbe />
			</AuthBoundary>,
		);
		await waitFor(() =>
			expect(
				fetchMock.mock.calls.some(([input]) =>
					String(input).endsWith("/v1/safe-spending-settings"),
				),
			).toBe(true),
		);
		expect(screen.queryByTestId("financial-preferences")).toBeNull();
		await act(async () =>
			finish(
				response({
					settings: {
						...defaultSafeSpendingSettings(),
						reserve: 123,
						incomeRuleIds: ["private-a-income"],
					},
				}),
			),
		);
		expect(
			(await screen.findByTestId("financial-preferences")).textContent,
		).toBe("123:private-a-income");
	});

	it("resets financial preferences during a cross-tab identity check before the next owner's children mount", async () => {
		const fetcher = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) =>
				route(input, init),
		);
		vi.stubGlobal("fetch", fetcher);
		render(
			<AuthBoundary>
				<FinancialPreferencesProbe />
			</AuthBoundary>,
		);
		await screen.findByTestId("financial-preferences");
		act(() =>
			safeSpendingSettingsObserver.getState().updateSettings({
				reserve: 123456,
				incomeRuleIds: ["private-a-income"],
			}),
		);
		let finish: (value: Response) => void = () => {};
		let gated = false;
		fetcher.mockImplementation(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				if (!gated && String(input).endsWith("/v1/auth/session")) {
					gated = true;
					return new Promise<Response>((resolve) => {
						finish = resolve;
					});
				}
				return route(input, init);
			},
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
		await waitFor(() =>
			expect(screen.getByTestId("financial-preferences").textContent).toBe(
				"123456:private-a-income",
			),
		);
		await waitFor(() =>
			expect(
				fetcher.mock.calls.filter((call) =>
					String(call[0]).endsWith("/v1/auth/session"),
				),
			).toHaveLength(2),
		);
		expect(screen.getByTestId("financial-preferences").textContent).toBe(
			"123456:private-a-income",
		);
		await act(async () => finish(response(session(B), B)));
		await waitFor(() => expect(getUserScope().resource?.id).toBe(B));
		expect(safeSpendingSettingsObserver.getState().reserve).toBe(
			defaultSafeSpendingSettings().reserve,
		);
		await waitFor(() =>
			expect(screen.getByTestId("financial-preferences").textContent).toBe(
				`${defaultSafeSpendingSettings().reserve}:`,
			),
		);
	});

	it("clears live model and projection state before it first mounts a verified user", async () => {
		setServerRevisionFixture("previous-account-private-revision");
		serverQueryClient().setQueryData(userResourceKey("presets"), [
			{ id: "previous-private-recipe" },
		]);
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
		expect(
			serverQueryClient().getQueryData(userResourceKey("presets")),
		).toBeUndefined();
		expect(
			serverQueryClient().getQueryData(["old-projection"]),
		).toBeUndefined();
		expect(
			serverQueryClient()
				.getQueryCache()
				.getAll()
				.every(
					(query) =>
						query.queryKey[0] === "safe-spending-settings" ||
						query.state.data === undefined,
				),
		).toBe(true);
	});

	it.each([B, GUEST_USER_ID])(
		"keeps the old workspace during a cross-tab check and clears it before resource %s mounts",
		async (nextId) => {
			const fetcher = vi.fn(
				async (input: RequestInfo | URL, init?: RequestInit) =>
					route(input, init),
			);
			vi.stubGlobal("fetch", fetcher);
			renderWorkspace();
			await screen.findByTestId("active-workspace");
			act(() => setServerRevisionFixture("account-a-private-revision"));
			const oldKey = deterministicQueryKey("private-a-model", 10);
			serverQueryClient().setQueryData(oldKey, "private-a-result");
			let finish: (value: Response) => void = () => {};
			fetcher.mockImplementation(
				async (input: RequestInfo | URL, init?: RequestInit) => {
					if (String(input).endsWith("/v1/auth/session"))
						return new Promise<Response>((resolve) => {
							finish = resolve;
						});
					return route(input, init);
				},
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
			expect(getUserScope().status).toBe("ready");
			await waitFor(() =>
				expect(screen.getByTestId("active-workspace").textContent).toBe(
					`${A}:account-a-private-revision`,
				),
			);
			await waitFor(() =>
				expect(
					fetcher.mock.calls.filter((call) =>
						String(call[0]).endsWith("/v1/auth/session"),
					),
				).toHaveLength(2),
			);
			expect(screen.getByTestId("active-workspace").textContent).toBe(
				`${A}:account-a-private-revision`,
			);
			await act(async () =>
				finish(response(session(nextId, nextId !== GUEST_USER_ID), nextId)),
			);
			expect((await screen.findByTestId("active-workspace")).textContent).toBe(
				`${nextId}:empty`,
			);
			expect(serverQueryClient().getQueryData(oldKey)).toBeUndefined();
		},
	);

	it("does not accept an old session response after a newer account check completes", async () => {
		const fetcher = vi.fn(async (_input: unknown) => response(session()));
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
		await waitFor(() =>
			expect(
				fetcher.mock.calls.filter((call) =>
					String(call[0]).endsWith("/v1/auth/session"),
				),
			).toHaveLength(2),
		);
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
		expect(getUserScope().resource?.id).toBe(B);
	});

	it("preserves user data and completed results across a same-user check", async () => {
		const fetcher = vi.fn(async () => response(session()));
		vi.stubGlobal("fetch", fetcher);
		renderWorkspace();
		await screen.findByTestId("active-workspace");
		const key = deterministicQueryKey("private-a-model", 10);
		act(() => {
			setServerRevisionFixture("private-a-revision");
			serverQueryClient().setQueryData(key, "private-a-result");
			serverQueryClient().setQueryData(userResourceKey("presets"), [
				{ id: "private-a-recipe" },
			]);
			window.dispatchEvent(new Event("focus"));
		});
		// Same-user revalidation never unmounts the workspace.
		await waitFor(() =>
			expect(screen.getByTestId("active-workspace").textContent).toBe(
				`${A}:private-a-revision`,
			),
		);
		await waitFor(() =>
			expect(screen.getByTestId("active-workspace").textContent).toBe(
				`${A}:private-a-revision`,
			),
		);
		expect(getServerModel()?.revision).toBe("private-a-revision");
		expect(
			serverQueryClient().getQueryData(userResourceKey("presets")),
		).toEqual([{ id: "private-a-recipe" }]);
		expect(deterministicQueryKey("private-a-model", 10)).toEqual(key);
		expect(serverQueryClient().getQueryData(key)).toBe("private-a-result");
	});

	it.each([A, B])(
		"keeps the workspace during a failed check and isolates server data on move to user %s",
		async (nextId) => {
			const fetcher = vi.fn(async () => response(session()));
			vi.stubGlobal("fetch", fetcher);
			renderWorkspace();
			await screen.findByTestId("active-workspace");
			act(() => {
				setServerRevisionFixture("private-a-revision");
				serverQueryClient().setQueryData(userResourceKey("presets"), [
					{ id: "private-a-recipe" },
				]);
			});
			fetcher.mockImplementationOnce(
				async () => new Response("", { status: 503 }),
			);
			act(() => window.dispatchEvent(new Event("focus")));
			await screen.findByRole("alert");
			// Transient outages keep the verified workspace mounted with a
			// retry toast instead of wiping the UI.
			expect(screen.getByTestId("active-workspace")).toBeTruthy();
			expect(getUserScope().status).toBe("ready");
			expect(getServerModel()?.revision).toBe("private-a-revision");
			expect(
				serverQueryClient().getQueryData(userResourceKey("presets")),
			).toEqual([{ id: "private-a-recipe" }]);
			fetcher.mockImplementation(async () => response(session(nextId), nextId));
			act(() => window.dispatchEvent(new Event("focus")));
			await screen.findByTestId("active-workspace");
			expect(getUserScope().resource?.id).toBe(nextId);
			expect(getServerModel()?.revision).toBe(
				nextId === A ? "private-a-revision" : undefined,
			);
			expect(
				serverQueryClient().getQueryData(userResourceKey("presets")),
			).toEqual(nextId === A ? [{ id: "private-a-recipe" }] : undefined);
		},
	);

	it("resets active data and projection results after a permission change", async () => {
		const fetcher = vi.fn(async () => response(session()));
		vi.stubGlobal("fetch", fetcher);
		renderWorkspace();
		await screen.findByTestId("active-workspace");
		act(() => setServerRevisionFixture("old-write-capability"));
		const key = deterministicQueryKey("private-a-model", 10);
		serverQueryClient().setQueryData(key, "old-permissions-result");
		fetcher.mockImplementation(async () =>
			response({
				...session(),
				resource: { ...session().resource, permissions: ["user:read"] },
			}),
		);
		act(() => window.dispatchEvent(new Event("focus")));
		await waitFor(() =>
			expect(screen.getByTestId("active-workspace").textContent).toBe(
				`${A}:empty`,
			),
		);
		expect(serverQueryClient().getQueryData(key)).toBeUndefined();
		expect(getUserScope().resource?.permissions).toEqual(["user:read"]);
	});

	it("does not reuse server data when the API address changes for the same user", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(session())),
		);
		renderWorkspace();
		await screen.findByTestId("active-workspace");
		const key = deterministicQueryKey("private-a-model", 10);
		serverQueryClient().setQueryData(key, "first-api-result");
		act(() => {
			setServerRevisionFixture("first-api-data");
			serverQueryClient().setQueryData(userResourceKey("presets"), [
				{ id: "first-api-recipe" },
			]);
			window.__WAYPOINT_CONFIG__ = { apiBaseUrl: "/second-api" };
			window.dispatchEvent(new Event("focus"));
		});
		await waitFor(() =>
			expect(screen.getByTestId("active-workspace").textContent).toBe(
				`${A}:empty`,
			),
		);
		expect(getUserScope().apiBaseUrl).toBe(canonicalApiBaseUrl("/second-api"));
		expect(getServerModel()).toBeUndefined();
		expect(
			serverQueryClient().getQueryData(userResourceKey("presets")),
		).toBeUndefined();
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
		expect(getUserScope().status).toBe("pending");
	});

	it("mounts when the grant list is unusual and leaves enforcement to the server", async () => {
		const body = {
			...session(),
			resource: { ...session().resource, permissions: ["user:write"] },
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(body, A)),
		);
		renderWorkspace();
		expect((await screen.findByTestId("active-workspace")).textContent).toBe(
			`${A}:empty`,
		);
		expect(getUserScope().status).toBe("ready");
	});

	it.each([
		["missing resource", { ...session(), resource: undefined }, A],
		["missing header", session(), null],
		["wrong header", session(), B],
		[
			"guest without subject",
			{ ...session(GUEST_USER_ID, false), user: undefined },
			GUEST_USER_ID,
		],
		["missing subject", { ...session(), user: undefined }, A],
		[
			"non-canonical resource ID",
			{
				...session(),
				resource: { ...session().resource, id: "users/sample" },
			},
			"users/sample",
		],
	])("fails closed on %s", async (_name, body, header) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(body, header as string | null)),
		);
		renderWorkspace();
		await screen.findByRole("alert");
		expect(screen.queryByTestId("active-workspace")).toBeNull();
		expect(getUserScope().status).toBe("pending");
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
		expect(getUserScope().status).toBe("ready");
	});
});
