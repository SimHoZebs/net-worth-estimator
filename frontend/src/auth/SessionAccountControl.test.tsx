import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.ts";
import { resetServerQueryCache } from "../state/serverQuery.ts";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import { resetNotifications } from "../state/notifications.ts";
import { AuthBoundary } from "./AuthBoundary.tsx";
import { redirectToSignIn } from "./navigation.ts";
import { SessionAccountControl } from "./SessionAccountControl.tsx";
import {
	defaultSafeSpendingSettings,
	useSafeSpendingSettings,
} from "../state/useSafeSpendingSettings.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import { getResourceScope } from "./resourceScope.ts";
import { remoteStorageKey } from "../state/remoteStorage.ts";

vi.mock("./navigation.ts", () => ({ redirectToSignIn: vi.fn() }));

const signedInSession = {
	enabled: true,
	authenticated: true,
	allowed: true,
	accountURL: "https://identity.example/account",
	resource: {
		id: `plans/${"a".repeat(64)}`,
		kind: "private",
		permissions: ["plan:read", "plan:project", "plan:write"],
	},
	user: { subject: "household-editor", name: "Sam Lee" },
};

function response(body: unknown, code = 200) {
	const headers = new Headers({ "content-type": "application/json" });
	if (
		body &&
		typeof body === "object" &&
		"resource" in body &&
		body.resource &&
		typeof body.resource === "object" &&
		"id" in body.resource
	)
		headers.set("Waypoint-Resource", String(body.resource.id));
	return new Response(JSON.stringify(body), {
		status: code,
		headers,
	});
}

function renderAccount() {
	return render(
		<AuthBoundary>
			<SessionAccountControl />
			<p>Workspace content</p>
			<NotificationCenter />
		</AuthBoundary>,
	);
}

beforeEach(() => {
	vi.stubGlobal("BroadcastChannel", undefined);
	vi.spyOn(ApiClient.prototype, "getSafeSpendingSettings").mockResolvedValue({
		settings: null,
	});
	vi.spyOn(ApiClient.prototype, "setSafeSpendingSettings").mockImplementation(
		async (settings) => ({ settings }),
	);
});

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	resetNotifications();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	vi.restoreAllMocks();
	window.history.replaceState(null, "", "/");
});

describe("session account controls", () => {
	it("renders nothing outside a session boundary", () => {
		const view = render(<SessionAccountControl />);
		expect(view.container.textContent).toBe("");
	});

	it("does not open a workspace for authentication-disabled discovery", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response({ enabled: false })),
		);
		renderAccount();
		await screen.findByRole("alert");
		expect(screen.queryByText("Workspace content")).toBeNull();
		expect(
			screen.queryByRole("button", { name: /sign in|sign out/i }),
		).toBeNull();
		expect(screen.queryByText("Account settings")).toBeNull();
		expect(screen.queryByText("Guest")).toBeNull();
	});

	it("offers allowed guests sign-in instead of account management or logout", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				response({
					...signedInSession,
					authenticated: false,
					resource: {
						id: "plans/sample",
						kind: "sample",
						permissions: ["plan:read", "plan:project"],
					},
					user: { subject: "", name: "" },
				}),
			),
		);
		renderAccount();
		await screen.findByText("Guest");
		expect(screen.getByText("Read-only preview")).toBeTruthy();
		expect(screen.queryByText("Account settings")).toBeNull();
		expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
		expect(redirectToSignIn).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
		expect(redirectToSignIn).toHaveBeenCalledOnce();
	});

	it("shows the signed-in identity and configured account link without role controls", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response(signedInSession)),
		);
		renderAccount();
		await screen.findByText("Sam Lee");
		expect(
			screen
				.getByRole("link", { name: "Account settings" })
				.getAttribute("href"),
		).toBe("#account");
		expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
		expect(screen.queryByRole("combobox")).toBeNull();
		expect(screen.queryByText("Editor")).toBeNull();
	});

	it("falls back to the subject for the in-app account link", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				response({
					...signedInSession,
					accountURL: undefined,
					user: { ...signedInSession.user, name: "" },
				}),
			),
		);
		renderAccount();
		await screen.findByText("household-editor");
		expect(screen.queryByText("Account settings")).toBeTruthy();
	});

	it("posts logout with same-origin credentials and announces a failed attempt", async () => {
		const fetcher = vi.fn(async (input: RequestInfo | URL) =>
			String(input).endsWith("/v1/auth/logout")
				? response({}, 503)
				: response(signedInSession),
		);
		vi.stubGlobal("fetch", fetcher);
		renderAccount();
		fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
		expect((await screen.findByRole("alert")).textContent).toBe(
			"Sign-out failed. Please retry.",
		);
		expect(fetcher).toHaveBeenCalledWith("/v1/auth/logout", {
			method: "POST",
			credentials: "same-origin",
			headers: { "Waypoint-Resource": signedInSession.resource.id },
		});
		expect(screen.getByText("Sam Lee")).toBeTruthy();
		expect(
			screen.getByRole<HTMLButtonElement>("button", { name: "Sign out" })
				.disabled,
		).toBe(false);
	});

	it("blocks logout before the POST while draft recovery data is volatile", async () => {
		const fetcher = vi.fn(async () => response(signedInSession));
		vi.stubGlobal("fetch", fetcher);
		renderAccount();
		const logoutButton = await screen.findByRole("button", {
			name: "Sign out",
		});
		const scope = getResourceScope();
		const engine = useWorkspaceStore.getState().engine;
		const recovery = {
			version: 1 as const,
			draft: null,
			draftPresentation: null,
			baseRevision: "unsaved-private-draft",
		};
		engine.volatileState = recovery;
		act(() => useWorkspaceStore.setState({ volatile: true }));
		fireEvent.click(logoutButton);
		expect((await screen.findByRole("alert")).textContent).toBe(
			"Your draft has recovery data. Discard the draft before signing out.",
		);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(useWorkspaceStore.getState().volatile).toBe(true);
		expect(useWorkspaceStore.getState().engine).toBe(engine);
		expect(engine.volatileState).toBe(recovery);
		expect(getResourceScope()).toBe(scope);
		expect(screen.getByText("Workspace content")).toBeTruthy();
		expect(
			screen.getByRole<HTMLButtonElement>("button", { name: "Sign out" })
				.disabled,
		).toBe(false);
	});

	it("allows logout after recovery resolves and leaves persisted scoped draft data untouched", async () => {
		const values = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		});
		const fetcher = vi.fn(async (input: RequestInfo | URL) =>
			String(input).endsWith("/v1/auth/logout")
				? response({ logoutURL: "#signed-out" })
				: response(signedInSession),
		);
		vi.stubGlobal("fetch", fetcher);
		renderAccount();
		const logoutButton = await screen.findByRole("button", {
			name: "Sign out",
		});
		const key = remoteStorageKey()!;
		const persisted = JSON.stringify({
			version: 1,
			draft: { name: "Persisted scoped draft" },
		});
		values.set(key, persisted);
		act(() => useWorkspaceStore.setState({ volatile: true }));
		fireEvent.click(logoutButton);
		await screen.findByRole("alert");
		act(() => useWorkspaceStore.setState({ volatile: false }));
		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
		await waitFor(() => expect(window.location.hash).toBe("#signed-out"));
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(values.get(key)).toBe(persisted);
	});

	it("blocks duplicate logout requests and clears the previous error on retry", async () => {
		let finishLogout: (value: Response) => void = () => {};
		let attempts = 0;
		const fetcher = vi.fn(async (input: RequestInfo | URL) => {
			if (!String(input).endsWith("/v1/auth/logout"))
				return response(signedInSession);
			attempts += 1;
			if (attempts === 1) return response({}, 503);
			return new Promise<Response>((resolve) => {
				finishLogout = resolve;
			});
		});
		vi.stubGlobal("fetch", fetcher);
		renderAccount();
		const logoutButton = await screen.findByRole("button", {
			name: "Sign out",
		});
		act(() =>
			useSafeSpendingSettings
				.getState()
				.updateSettings({ reserve: 123, incomeRuleIds: ["private-income"] }),
		);
		fireEvent.click(logoutButton);
		await screen.findByRole("alert");
		expect(useSafeSpendingSettings.getState().reserve).toBe(123);
		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
		const pending = screen.getByRole<HTMLButtonElement>("button", {
			name: "Signing out…",
		});
		expect(pending.disabled).toBe(true);
		expect(screen.queryByRole("alert")).toBeNull();
		fireEvent.click(pending);
		expect(attempts).toBe(2);
		await act(async () => finishLogout(response({ logoutURL: "#signed-out" })));
		await waitFor(() => expect(window.location.hash).toBe("#signed-out"));
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
	});

	it("announces network failures and leaves logout available for retry", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				if (String(input).endsWith("/v1/auth/logout"))
					throw new Error("Network unavailable.");
				return response(signedInSession);
			}),
		);
		renderAccount();
		fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
		expect((await screen.findByRole("alert")).textContent).toBe(
			"Network unavailable.",
		);
		expect(
			screen.getByRole<HTMLButtonElement>("button", { name: "Sign out" })
				.disabled,
		).toBe(false);
	});

	it("clears private financial preferences before a successful logout body finishes", async () => {
		let finish: (value: { logoutURL: string }) => void = () => {};
		const body = new Promise<{ logoutURL: string }>((resolve) => {
			finish = resolve;
		});
		const logoutResponse = response({});
		vi.spyOn(logoutResponse, "json").mockImplementation(() => body);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) =>
				String(input).endsWith("/v1/auth/logout")
					? logoutResponse
					: response(signedInSession),
			),
		);
		renderAccount();
		const logoutButton = await screen.findByRole("button", {
			name: "Sign out",
		});
		act(() =>
			useSafeSpendingSettings
				.getState()
				.updateSettings({ reserve: 99999, incomeRuleIds: ["private-income"] }),
		);
		fireEvent.click(logoutButton);
		// Explicit logout clears scoped data immediately. The verified shell
		// stays mounted stale until the provider redirect; private
		// preferences must already be reset to defaults.
		await waitFor(() =>
			expect(useSafeSpendingSettings.getState()).toMatchObject(
				defaultSafeSpendingSettings(),
			),
		);
		await act(async () => finish({ logoutURL: "#signed-out" }));
		await waitFor(() => expect(window.location.hash).toBe("#signed-out"));
	});

	it("completes provider logout after a same-account focus check during the POST", async () => {
		let finish: (response: Response) => void = () => {};
		const fetcher = vi.fn(async (input: RequestInfo | URL) =>
			String(input).endsWith("/v1/auth/logout")
				? new Promise<Response>((resolve) => {
						finish = resolve;
					})
				: response(signedInSession),
		);
		vi.stubGlobal("fetch", fetcher);
		renderAccount();
		fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
		act(() => window.dispatchEvent(new Event("focus")));
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
		await act(async () => finish(response({ logoutURL: "#signed-out" })));
		await waitFor(() => expect(window.location.hash).toBe("#signed-out"));
	});

	it.each(["guest", "different account", "own broadcast"])(
		"coordinates a delayed logout body with %s verification",
		async (change) => {
			if (change === "own broadcast") {
				const channels = new Set<TestBroadcastChannel>();
				class TestBroadcastChannel {
					onmessage: ((event: { data: unknown }) => void) | null = null;
					constructor() {
						channels.add(this);
					}
					postMessage(data: unknown) {
						const recipients = [...channels].filter(
							(channel) => channel !== this,
						);
						queueMicrotask(() => {
							for (const recipient of recipients)
								if (channels.has(recipient)) recipient.onmessage?.({ data });
						});
					}
					close() {
						channels.delete(this);
					}
				}
				vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
			}
			let finish: (value: { logoutURL: string }) => void = () => {};
			const body = new Promise<{ logoutURL: string }>((resolve) => {
				finish = resolve;
			});
			const logoutResponse = response({});
			vi.spyOn(logoutResponse, "json").mockImplementation(() => body);
			let current = signedInSession;
			let checks = 0;
			vi.stubGlobal(
				"fetch",
				vi.fn(async (input: RequestInfo | URL) => {
					if (String(input).endsWith("/v1/auth/logout")) return logoutResponse;
					checks += 1;
					return response(current);
				}),
			);
			renderAccount();
			await screen.findByText("Sam Lee");
			// Initial same-tab broadcast must settle before the explicit logout.
			await waitFor(() =>
				expect(checks).toBeGreaterThan(change === "own broadcast" ? 1 : 0),
			);
			await screen.findByRole("button", { name: "Sign out" });
			current =
				change === "different account"
					? {
							...signedInSession,
							resource: {
								...signedInSession.resource,
								id: `plans/${"b".repeat(64)}`,
							},
							user: { subject: "other-account", name: "Other account" },
						}
					: {
							...signedInSession,
							authenticated: false,
							resource: {
								id: "plans/sample",
								kind: "sample",
								permissions: ["plan:read", "plan:project"],
							},
							user: { subject: "", name: "" },
						};
			const before = checks;
			fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
			await waitFor(() => expect(logoutResponse.json).toHaveBeenCalled());
			if (change !== "own broadcast")
				act(() => window.dispatchEvent(new Event("focus")));
			await waitFor(() => expect(checks).toBeGreaterThan(before));
			await act(async () => finish({ logoutURL: "#signed-out" }));
			const different = change === "different account";
			await waitFor(() => {
				expect(window.location.hash).toBe(different ? "" : "#signed-out");
				expect(screen.queryByRole("alert")?.textContent).toBe(
					different
						? "Your session changed. Retry the session check."
						: undefined,
				);
			});
			expect(getResourceScope().resource?.id).toBe(
				different ? `plans/${"b".repeat(64)}` : undefined,
			);
		},
	);

	it("keeps local logout available after a session-discovery outage", async () => {
		let unavailable = false;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) =>
				String(input).endsWith("/v1/auth/logout")
					? response({ logoutURL: "#signed-out" })
					: unavailable
						? response({}, 503)
						: response(signedInSession),
			),
		);
		renderAccount();
		await screen.findByText("Sam Lee");
		unavailable = true;
		act(() => window.dispatchEvent(new Event("focus")));
		await screen.findByRole("alert");
		// Transient outages keep the workspace mounted with a single retry
		// toast instead of wiping to a full-screen error.
		expect(screen.getByText("Workspace content")).toBeTruthy();
		expect(screen.getAllByRole("alert")).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
		await waitFor(() => expect(window.location.hash).toBe("#signed-out"));
	});
});
