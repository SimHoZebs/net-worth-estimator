import {
	act,
	fireEvent,
	render as renderComponent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	balancesOptions,
	statusOptions,
} from "../../state/workspaceResources.ts";
import { setupQueryScope, teardownQueryScope } from "../../mocks/testScope.tsx";
import { serverQueryClient } from "../../state/serverQuery.ts";
import { getUserScope } from "../../auth/resourceScope.ts";
import { userResourceKey } from "../../state/workspaceResources.ts";
import {
	refreshSyncSettings,
	resetSyncSettingsClient,
} from "../../state/syncSettings.ts";
import {
	resetNotifications,
	useNotifications,
} from "../../state/notifications.ts";
import {
	getAppliedSyncStamp,
	resetSyncWorkspaceRefresh,
} from "../../state/syncWorkspaceRefresh.ts";
import { SyncSettings } from "./SyncSettings.tsx";
import { createSubjectTestRouter } from "../../mocks/testRouter.tsx";
import { RouterProvider } from "@tanstack/react-router";
import type { ReactNode } from "react";

function render(subject: ReactNode) {
	const router = createSubjectTestRouter({
		subjectRoute: "/sources",
		subject,
		initialEntry: "/sources",
	});
	return renderComponent(<RouterProvider router={router} />);
}

const accounts = [
	{ id: "checking", name: "Checking", kind: "cash" as const, color: null },
	{
		id: "brokerage",
		name: "Brokerage",
		kind: "investment" as const,
		color: null,
	},
	{ id: "prime_card", name: "Prime Card", kind: "debt" as const, color: null },
	{ id: "home", name: "Home", kind: "property" as const, color: null },
];

function stubApi(state: {
	configured: boolean;
	loan?: boolean;
	links?: { modelAccountId: string; bridgeName: string }[];
	failConnect?: boolean;
	failLinks?: boolean;
	failBalances?: boolean;
	failCredential?: boolean;
	failIntegrations?: boolean;
	supersedeIssues?: {
		severity: string;
		code: string;
		message: string;
		path: unknown[];
	}[];
	supersedeError?: string;
	holdSupersede?: Promise<void>;
	emptyProviders?: boolean;
	extraProviders?: { id: string }[];
	throttled?: boolean;
	lastSyncAt?: string;
	syncError?: { code: string; message: string; scope?: string };
	syncEnabled?: boolean;
	readOnly?: boolean;
	holdStatus?: Promise<void>;
	gmailConnected?: boolean;
	gmailLookback?: number;
	failGmailCredential?: boolean;
	gmailUnavailable?: boolean;
}) {
	const jsonHeaders = () => {
		const headers = new Headers({ "content-type": "application/json" });
		headers.set("Waypoint-Resource", "users/test");
		return headers;
	};
	const requests: { method: string; path: string; body?: unknown }[] = [];
	const linkedIDs = new Set(
		(state.links ?? []).map((link) => link.modelAccountId),
	);
	const balanceRows = () =>
		accounts.map((account) => ({
			id: account.id,
			name: account.name,
			kind: state.loan && account.id === "home" ? "debt" : account.kind,
			display:
				state.loan && account.id === "prime_card"
					? {
							name: "Manual loan",
							interestScheduleId: "charge",
							paymentScheduleId: "payment",
							components: [
								{ accountId: "prime_card", role: "principal" },
								{ accountId: "home", role: "interest" },
							],
						}
					: undefined,
			enabled: true,
			archived: false,
			balance: 100,
			minBalance: null,
			maxBalance: null,
			color: account.color ?? undefined,
			observedOn: "2026-10-26",
			hasCheckpoint: linkedIDs.has(account.id),
			readOnly: linkedIDs.has(account.id),
			syncOwned: linkedIDs.has(account.id),
		}));
	const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
		const raw = String(url);
		const path = raw.slice(raw.indexOf("/v1/"));
		const method = init?.method ?? "GET";
		const record = (body?: unknown) => requests.push({ method, path, body });
		if (path === "/v1/integrations") {
			record();
			if (state.failIntegrations)
				return new Response(JSON.stringify({ detail: "boom" }), {
					status: 500,
					headers: jsonHeaders(),
				});
			return new Response(
				JSON.stringify({
					providers:
						state.emptyProviders === true
							? []
							: [
									{
										id: "simplefin",
										connected: state.configured,
										syncConfigured: state.configured
											? (state.syncEnabled ?? true)
											: false,
										...(state.configured
											? {
													connectedAt: "2026-10-26T00:00:00Z",
													detail: "bridge.example",
												}
											: {}),
									},
									...(state.extraProviders ?? []),
								],
				}),
				{ headers: jsonHeaders() },
			);
		}
		if (path === "/v1/sync/simplefin/credential") {
			if (state.failCredential)
				return new Response(JSON.stringify({ detail: "boom" }), {
					status: 500,
					headers: jsonHeaders(),
				});
			if (method === "POST") {
				const body = JSON.parse(String(init?.body)) as Record<string, string>;
				record(body);
				if (state.failConnect)
					return new Response(JSON.stringify({ detail: "bad token" }), {
						status: 400,
						headers: jsonHeaders(),
					});
				state.configured = true;
				return new Response(
					JSON.stringify({
						configured: true,
						bridgeHost: "bridge.example",
						updatedAt: "2026-10-26T00:00:00Z",
					}),
					{ headers: jsonHeaders() },
				);
			}
			if (method === "DELETE") {
				record();
				state.configured = false;
				return new Response(JSON.stringify({ configured: false }), {
					headers: jsonHeaders(),
				});
			}
			record();
			return new Response(
				JSON.stringify(
					state.configured
						? {
								configured: true,
								bridgeHost: "bridge.example",
								updatedAt: "2026-10-26T00:00:00Z",
							}
						: { configured: false },
				),
				{ headers: jsonHeaders() },
			);
		}
		if (path === "/v1/sync/simplefin/cards") {
			throw new Error("cards endpoint must not be called");
		}
		if (path === "/v1/integrations/gmail/credential") {
			record();
			if (state.gmailUnavailable)
				return new Response(
					JSON.stringify({ detail: "gmail is not configured" }),
					{
						status: 503,
						headers: jsonHeaders(),
					},
				);
			if (state.failGmailCredential)
				return new Response(JSON.stringify({ detail: "boom" }), {
					status: 500,
					headers: jsonHeaders(),
				});
			return new Response(
				JSON.stringify(
					state.gmailConnected
						? {
								connected: true,
								emailAddress: "reader@example.com",
								connectedAt: "2026-10-26T00:00:00Z",
								scopes: "https://www.googleapis.com/auth/gmail.readonly",
								lookbackDays: state.gmailLookback ?? 90,
							}
						: { connected: false, lookbackDays: state.gmailLookback ?? 90 },
				),
				{ headers: jsonHeaders() },
			);
		}
		if (
			path.startsWith("/v1/sync/simplefin/accounts/") &&
			path.endsWith("/supersede") &&
			method === "POST"
		) {
			const body = JSON.parse(String(init?.body)) as {
				manualAccountId: string;
			};
			record(body);
			await state.holdSupersede;
			if (state.supersedeError) {
				return new Response(JSON.stringify({ detail: state.supersedeError }), {
					status: 422,
					headers: jsonHeaders(),
				});
			}
			if (state.supersedeIssues) {
				return new Response(
					JSON.stringify({
						manualAccountId: body.manualAccountId,
						syncedAccountId: "checking",
						issues: state.supersedeIssues,
						saved: false,
						revision: "test",
					}),
					{ headers: jsonHeaders() },
				);
			}
			return new Response(
				JSON.stringify({
					manualAccountId: body.manualAccountId,
					syncedAccountId: "checking",
					issues: [],
					saved: true,
					revision: "test",
				}),
				{ headers: jsonHeaders() },
			);
		}
		if (path === "/v1/sync/simplefin/accounts") {
			record();
			if (state.failLinks)
				return new Response(JSON.stringify({ detail: "boom" }), {
					status: 500,
					headers: jsonHeaders(),
				});
			return new Response(
				JSON.stringify({
					links: (state.links ?? []).map((link, index) => ({
						bridgeAccountId: `bridge-${index}`,
						bridgeName: link.bridgeName,
						currency: "USD",
						lastSeenAt: "2026-10-26T00:00:00Z",
						modelAccountId: link.modelAccountId,
						origin: "manual",
					})),
				}),
				{ headers: jsonHeaders() },
			);
		}
		if (path === "/v1/sync/simplefin" && method === "POST") {
			record();
			if (state.throttled)
				return new Response(
					JSON.stringify({
						title: "Too Many Requests",
						status: 429,
						detail: "sync ran recently; retry after 5 hours",
					}),
					{ status: 429, headers: jsonHeaders() },
				);
			return new Response(
				JSON.stringify({
					checkpointsInserted: 1,
					checkpointsUpdated: 0,
					checkpointsSkipped: 0,
					pendingDeleted: 0,
					pendingInserted: 0,
					pendingUpdated: 0,
					settledConverted: 0,
					settledInserted: 0,
					accountsProvisioned: 0,
					skipped: {},
				}),
				{ headers: jsonHeaders() },
			);
		}
		if (path === "/v1/status") {
			record();
			await state.holdStatus;
			return new Response(
				JSON.stringify(
					state.configured
						? {
								readOnly: state.readOnly ?? false,
								syncConfigured: state.syncEnabled ?? true,
								lastSyncAt: state.lastSyncAt,
								syncQuotaUsed: 5,
								syncQuotaLimit: 24,
								...(state.syncError ? { syncError: state.syncError } : {}),
							}
						: {
								readOnly: state.readOnly ?? false,
								syncConfigured: false,
								syncQuotaUsed: 0,
								syncQuotaLimit: 24,
							},
				),
				{ headers: jsonHeaders() },
			);
		}
		if (path.startsWith("/v1/accounts/balances")) {
			record();
			if (state.failBalances)
				return new Response(JSON.stringify({ detail: "boom" }), {
					status: 500,
					headers: jsonHeaders(),
				});
			return new Response(
				JSON.stringify({
					accounts: balanceRows(),
					asOf: "2026-10-26",
					revision: "test",
				}),
				{ headers: jsonHeaders() },
			);
		}
		// A successful manual sync explicitly refreshes the workspace, so the
		// stub serves those reads with empty-but-valid payloads.
		if (method === "GET") {
			if (path === "/v1/financial-model") {
				record();
				return new Response(
					JSON.stringify({ model: null, issues: [], revision: "test" }),
					{ headers: jsonHeaders() },
				);
			}
			if (path === "/v1/amount-presets") {
				record();
				return new Response(JSON.stringify({ presets: [] }), {
					headers: jsonHeaders(),
				});
			}
			if (path.startsWith("/v1/transactions/catalog")) {
				record();
				return new Response(JSON.stringify({ items: [], revision: "test" }), {
					headers: jsonHeaders(),
				});
			}
			if (path.startsWith("/v1/transactions")) {
				record();
				return new Response(
					JSON.stringify({ transactions: [], revision: "test" }),
					{ headers: jsonHeaders() },
				);
			}
			if (path.startsWith("/v1/evaluations/summary")) {
				record();
				return new Response(
					JSON.stringify({ evaluations: {}, revision: "test" }),
					{ headers: jsonHeaders() },
				);
			}
			if (path.startsWith("/v1/checkpoints")) {
				record();
				return new Response(
					JSON.stringify({ checkpoints: [], revision: "test" }),
					{ headers: jsonHeaders() },
				);
			}
			if (path.startsWith("/v1/schedules")) {
				record();
				return new Response(
					JSON.stringify({ schedules: [], revision: "test" }),
					{ headers: jsonHeaders() },
				);
			}
			if (path.startsWith("/v1/planned-purchases")) {
				record();
				return new Response(
					JSON.stringify({ plannedPurchases: [], revision: "test" }),
					{ headers: jsonHeaders() },
				);
			}
		}
		throw new Error(`unexpected request ${init?.method ?? "GET"} ${path}`);
	});
	vi.stubGlobal("fetch", fetcher);
	// Seed status and balances synchronously so first render already sees
	// read-only gating and account labels; queries remain cached and shared.
	const cache = serverQueryClient();
	cache.setQueryData(statusOptions().queryKey, {
		readOnly: state.readOnly ?? false,
		hasModel: true,
		syncConfigured: state.configured ? (state.syncEnabled ?? true) : false,
		lastSyncAt: state.lastSyncAt,
		syncQuotaUsed: 5,
		syncQuotaLimit: 24,
	});
	cache.setQueryData(balancesOptions().queryKey, {
		accounts: balanceRows(),
		asOf: "2026-10-26",
		revision: "test",
	});
	return requests;
}

beforeEach(() => {
	setupQueryScope();
	resetSyncWorkspaceRefresh();
	resetNotifications();
});

afterEach(() => {
	teardownQueryScope();
	resetSyncSettingsClient();
	resetNotifications();
	resetSyncWorkspaceRefresh();
	vi.restoreAllMocks();
});

it("renders the registered provider from the integrations list", async () => {
	const requests = stubApi({ configured: true, links: [] });
	render(<SyncSettings />);
	expect(await screen.findByText("SimpleFIN")).toBeTruthy();
	expect(
		requests.some(
			(request) =>
				request.method === "GET" && request.path === "/v1/integrations",
		),
	).toBe(true);
});

it("falls back to the SimpleFIN section for an empty provider list", async () => {
	stubApi({ configured: false, emptyProviders: true });
	render(<SyncSettings />);
	expect(await screen.findByText("Not connected")).toBeTruthy();
	expect(
		screen.getByRole("heading", { name: "Connect bank accounts" }),
	).toBeTruthy();
});

it("shows an error instead of onboarding when the credential fails", async () => {
	const state = { configured: true, failCredential: true };
	stubApi(state);
	render(<SyncSettings />);
	expect(
		await screen.findByText("The sync connection could not be loaded."),
	).toBeTruthy();
	expect(screen.queryByText("Not connected")).toBeNull();
	state.failCredential = false;
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByText(/Connected since/)).toBeTruthy();
});

it("ignores unregistered provider IDs without extra sections", async () => {
	stubApi({
		configured: true,
		links: [],
		extraProviders: [{ id: "carrier-pigeon" }],
	});
	render(<SyncSettings />);
	expect(await screen.findByText("SimpleFIN")).toBeTruthy();
	expect(screen.queryByText("carrier-pigeon")).toBeNull();
});

it("renders the Gmail section for the registered gmail provider", async () => {
	stubApi({
		configured: true,
		links: [],
		extraProviders: [{ id: "gmail" }],
	});
	render(<SyncSettings />);
	expect(await screen.findByText("SimpleFIN")).toBeTruthy();
	expect(
		await screen.findByRole("heading", {
			name: "Connect Gmail for receipt discovery",
		}),
	).toBeTruthy();
});

it("shows an error when the provider list fails to load", async () => {
	const state = { configured: true, failIntegrations: true };
	stubApi(state);
	render(<SyncSettings />);
	expect(
		await screen.findByText("The sync connection could not be loaded."),
	).toBeTruthy();
	expect(screen.queryByText("SimpleFIN")).toBeNull();
	state.failIntegrations = false;
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByText("SimpleFIN")).toBeTruthy();
});

it("reconnects with a replacement token without disconnecting first", async () => {
	const requests = stubApi({ configured: true, links: [] });
	render(<SyncSettings />);
	await screen.findByText(/Connected since/);
	fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
	const token = await screen.findByPlaceholderText("Paste your setup token");
	expect(document.activeElement).toBe(token);
	fireEvent.change(token, { target: { value: "bmV3LXRva2Vu" } });
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
	await waitFor(() => {
		expect(
			useNotifications
				.getState()
				.items.some((item) => item.message === "SimpleFIN reconnected."),
		).toBe(true);
	});
	expect(screen.queryByPlaceholderText("Paste your setup token")).toBeNull();
	expect(
		requests.some(
			(request) =>
				request.method === "POST" &&
				request.path === "/v1/sync/simplefin/credential" &&
				(request.body as Record<string, string>).setupToken === "bmV3LXRva2Vu",
		),
	).toBe(true);
	// Rotation keeps the connection: no disconnect request was made.
	expect(requests.some((request) => request.method === "DELETE")).toBe(false);
});

it("cancels reconnect and keeps the saved connection", async () => {
	const requests = stubApi({ configured: true, links: [] });
	render(<SyncSettings />);
	await screen.findByText(/Connected since/);
	fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
	await screen.findByPlaceholderText("Paste your setup token");
	fireEvent.click(screen.getByRole("button", { name: "Cancel reconnect" }));
	expect(screen.queryByPlaceholderText("Paste your setup token")).toBeNull();
	expect(document.activeElement).toBe(
		screen.getByRole("button", { name: "Reconnect" }),
	);
	expect(
		requests.some(
			(request) =>
				request.method === "POST" &&
				request.path === "/v1/sync/simplefin/credential",
		),
	).toBe(false);
});

it("shows a complete setup guide without a prerequisite click", async () => {
	const requests = stubApi({ configured: false });
	render(<SyncSettings />);
	expect(await screen.findByText("Not connected")).toBeTruthy();
	for (const title of [
		"Link your banks in SimpleFIN",
		"Create a setup token for Waypoint",
		"Connect to Waypoint",
	]) {
		expect(screen.getByRole("heading", { name: title })).toBeTruthy();
	}
	expect(screen.getByText(/separate paid subscription/)).toBeTruthy();
	expect(
		screen
			.getByRole("link", { name: /Check bank support/ })
			.getAttribute("href"),
	).toBe("https://beta-bridge.simplefin.org/search-institutions");
	expect(
		screen
			.getByRole("link", { name: /Create a setup token/ })
			.getAttribute("href"),
	).toBe("https://beta-bridge.simplefin.org/my-account/tokens/create");
	expect(screen.getByLabelText("Setup token")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Connect SimpleFIN" }),
	).toBeTruthy();
	expect(requests.some((request) => request.method === "POST")).toBe(false);
});

it("connects through the inline token form and reports the connection", async () => {
	const requests = stubApi({ configured: false });
	render(<SyncSettings />);
	fireEvent.change(
		await screen.findByPlaceholderText("Paste your setup token"),
		{
			target: { value: "dG9rZW4=" },
		},
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
	await waitFor(() => {
		expect(screen.getByText(/Connected since/)).toBeTruthy();
	});
	expect(screen.getByText("Synced accounts")).toBeTruthy();
	expect(screen.queryByText("Not connected")).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Connect SimpleFIN" }),
	).toBeNull();
	expect(
		requests.some(
			(request) =>
				request.method === "POST" &&
				(request.body as Record<string, string>).setupToken === "dG9rZW4=",
		),
	).toBe(true);
});

it("only asks for a setup token and trims it before connecting", async () => {
	const requests = stubApi({ configured: false });
	render(<SyncSettings />);
	const token = await screen.findByLabelText("Setup token");
	expect(screen.queryByLabelText("Access URL")).toBeNull();
	expect(screen.queryByRole("button", { name: /access URL/i })).toBeNull();
	expect(screen.queryByText(/Each token works once/)).toBeNull();
	expect(screen.queryByText(/Your setup token grants/)).toBeNull();
	fireEvent.change(token, {
		target: { value: "  dG9rZW4=  " },
	});
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
	await screen.findByText(/Connected since/);
	expect(
		requests
			.filter((request) => request.method === "POST")
			.map((request) => request.body),
	).toEqual([{ setupToken: "dG9rZW4=" }]);
});

it("rejects a blank token without making a connection request", async () => {
	const requests = stubApi({ configured: false });
	render(<SyncSettings />);
	fireEvent.change(await screen.findByLabelText("Setup token"), {
		target: { value: "   " },
	});
	fireEvent.submit(screen.getByRole("form", { name: "Connect SimpleFIN" }));
	expect(
		await screen.findByText("Paste your setup token to connect."),
	).toBeTruthy();
	expect(requests.some((request) => request.method === "POST")).toBe(false);
});

it("focuses the token field from the returning-user shortcut", async () => {
	stubApi({ configured: false });
	render(<SyncSettings />);
	fireEvent.click(
		await screen.findByRole("button", { name: "I already have a token" }),
	);
	expect(document.activeElement).toBe(screen.getByLabelText("Setup token"));
});

it("refreshes status and links after connecting", async () => {
	const requests = stubApi({ configured: false });
	render(<SyncSettings />);
	fireEvent.change(
		await screen.findByPlaceholderText("Paste your setup token"),
		{
			target: { value: "dG9rZW4=" },
		},
	);
	const accountFetches = () =>
		requests.filter((request) => request.path === "/v1/sync/simplefin/accounts")
			.length;
	const before = accountFetches();
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
	await screen.findByText(/Connected since/);
	// The panel reads quota from /v1/status once the connection is stored.
	await screen.findByText(/19 out of 24 syncs available/);
	await waitFor(() => {
		expect(accountFetches()).toBeGreaterThan(before);
	});
});

it("lists every synced account", async () => {
	stubApi({
		configured: true,
		links: [
			{ modelAccountId: "checking", bridgeName: "Old Bridge Name" },
			{ modelAccountId: "prime_card", bridgeName: "Old Card Name" },
		],
	});
	render(<SyncSettings />);
	expect(await screen.findByText("Synced accounts")).toBeTruthy();
	expect(await screen.findByText("Checking")).toBeTruthy();
	expect(screen.getByText("Prime Card")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Checking" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Prime Card" })).toBeNull();
	expect(screen.queryByRole("button", { name: /Save cards/ })).toBeNull();
});

it("excludes visible loans from bank-link candidates", async () => {
	stubApi({
		configured: true,
		loan: true,
		links: [{ modelAccountId: "checking", bridgeName: "Checking" }],
	});
	render(<SyncSettings />);
	fireEvent.click(
		await screen.findByRole("button", { name: "More options for Checking" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Link existing account" }),
	);
	const dialog = await screen.findByRole("dialog", {
		name: "Link a manual account",
	});
	expect(
		within(dialog).queryByRole("button", { name: /Manual loan/ }),
	).toBeNull();
	expect(
		within(dialog).getByRole("button", { name: /Brokerage/ }),
	).toBeTruthy();
});

it("offers no link action on a synced loan", async () => {
	stubApi({
		configured: true,
		loan: true,
		links: [{ modelAccountId: "prime_card", bridgeName: "Bank loan" }],
	});
	render(<SyncSettings />);
	expect(await screen.findByText("Synced accounts")).toBeTruthy();
	expect(await screen.findByText("Manual loan")).toBeTruthy();
	// The server rejects loan components on both sides of a merge, so the
	// synced loan row offers no mapping action.
	expect(
		screen.queryByRole("button", { name: "More options for Manual loan" }),
	).toBeNull();
});

it("links a manual account to a synced account", async () => {
	const requests = stubApi({
		configured: true,
		links: [{ modelAccountId: "checking", bridgeName: "Old Bridge Name" }],
	});
	render(<SyncSettings />);
	fireEvent.click(
		await screen.findByRole("button", { name: "More options for Checking" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Link existing account" }),
	);
	expect(
		await screen.findByRole("heading", { name: "Link a manual account" }),
	).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: /Brokerage/ }));
	fireEvent.click(screen.getByRole("button", { name: "Link account" }));
	await waitFor(() => {
		expect(
			requests.some(
				(request) =>
					request.method === "POST" &&
					request.path === "/v1/sync/simplefin/accounts/bridge-0/supersede",
			),
		).toBe(true);
	});
	const request = requests.find(
		(candidate) =>
			candidate.method === "POST" &&
			candidate.path === "/v1/sync/simplefin/accounts/bridge-0/supersede",
	);
	expect(request?.body).toEqual({ manualAccountId: "brokerage" });
	await waitFor(() => {
		expect(
			useNotifications
				.getState()
				.items.some((item) =>
					item.message.includes("Brokerage is linked to the bank account"),
				),
		).toBe(true);
	});
});

it("keeps the link dialog open when validation rejects the merge", async () => {
	stubApi({
		configured: true,
		links: [{ modelAccountId: "checking", bridgeName: "Old Bridge Name" }],
		supersedeIssues: [
			{
				severity: "error",
				code: "evaluation.accountBalance.accountId.invalid",
				message:
					"A saved evaluation references this account. Remove it before linking.",
				path: [],
			},
		],
	});
	render(<SyncSettings />);
	fireEvent.click(
		await screen.findByRole("button", { name: "More options for Checking" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Link existing account" }),
	);
	fireEvent.click(screen.getByRole("button", { name: /Brokerage/ }));
	fireEvent.click(screen.getByRole("button", { name: "Link account" }));
	await waitFor(() => {
		expect(
			screen.queryByRole("heading", { name: "Link a manual account" }),
		).toBeTruthy();
	});
	expect(
		await screen.findByText(/A saved evaluation references this account/),
	).toBeTruthy();
	expect(
		screen.getByRole("heading", { name: "Link a manual account" }),
	).toBeTruthy();
});

it("shows an HTTP rejection inside the link dialog", async () => {
	stubApi({
		configured: true,
		links: [{ modelAccountId: "checking", bridgeName: "Old Bridge Name" }],
		supersedeError: "The account already has bank history.",
	});
	render(<SyncSettings />);
	fireEvent.click(
		await screen.findByRole("button", { name: "More options for Checking" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Link existing account" }),
	);
	const dialog = await screen.findByRole("dialog", {
		name: "Link a manual account",
	});
	fireEvent.click(within(dialog).getByRole("button", { name: /Brokerage/ }));
	fireEvent.click(within(dialog).getByRole("button", { name: "Link account" }));
	expect(
		await within(dialog).findByText(/The account already has bank history/),
	).toBeTruthy();
	expect(
		within(dialog).getByRole("button", { name: "Link account" }),
	).toBeTruthy();
});

it("disables Cancel while the link request is pending", async () => {
	let release!: () => void;
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	stubApi({
		configured: true,
		links: [{ modelAccountId: "checking", bridgeName: "Old Bridge Name" }],
		holdSupersede: hold,
	});
	render(<SyncSettings />);
	fireEvent.click(
		await screen.findByRole("button", { name: "More options for Checking" }),
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Link existing account" }),
	);
	const dialog = await screen.findByRole("dialog", {
		name: "Link a manual account",
	});
	fireEvent.click(within(dialog).getByRole("button", { name: /Brokerage/ }));
	fireEvent.click(within(dialog).getByRole("button", { name: "Link account" }));
	await waitFor(() => {
		expect(
			(
				within(dialog).getByRole("button", {
					name: "Cancel",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});
	expect(within(dialog).getByRole("button", { name: "Linking…" })).toBeTruthy();
	release();
	await waitFor(() => {
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});

it("falls back to the bridge name when the model account is gone", async () => {
	stubApi({
		configured: true,
		links: [{ modelAccountId: "deleted", bridgeName: "Old Bridge Name" }],
	});
	render(<SyncSettings />);
	expect(await screen.findByText("Synced accounts")).toBeTruthy();
	expect(await screen.findByText("Old Bridge Name")).toBeTruthy();
});

it("explains missing link options when balances fail to load", async () => {
	const state = {
		configured: true,
		links: [{ modelAccountId: "checking", bridgeName: "Old Bridge Name" }],
		failBalances: true,
	};
	stubApi(state);
	render(<SyncSettings />);
	expect(await screen.findByText("Synced accounts")).toBeTruthy();
	expect(
		await screen.findByText("The manual accounts could not be loaded."),
	).toBeTruthy();
	state.failBalances = false;
	fireEvent.click(screen.getByRole("button", { name: "Reload" }));
	expect(
		await screen.findByRole("button", {
			name: "More options for Checking",
		}),
	).toBeTruthy();
	await waitFor(() => {
		expect(
			screen.queryByText("The manual accounts could not be loaded."),
		).toBeNull();
	});
});

it("shows an empty state when no accounts are synced", async () => {
	stubApi({ configured: true, links: [] });
	render(<SyncSettings />);
	expect(await screen.findByText("No synced accounts yet.")).toBeTruthy();
});

it("shows an inline error when synced accounts fail to load", async () => {
	stubApi({ configured: true, failLinks: true });
	render(<SyncSettings />);
	expect(
		await screen.findByText("The synced accounts could not be loaded."),
	).toBeTruthy();
	expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
});

it("shows an error when the token is rejected", async () => {
	stubApi({ configured: false, failConnect: true });
	render(<SyncSettings />);
	fireEvent.change(
		await screen.findByPlaceholderText("Paste your setup token"),
		{
			target: { value: "bogus" },
		},
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(screen.getByRole("alert").textContent).toMatch(/Connection failed\./);
	expect(
		screen.getByLabelText("Setup token").getAttribute("aria-invalid"),
	).toBe("true");
	fireEvent.change(screen.getByLabelText("Setup token"), {
		target: { value: "new-token" },
	});
	expect(screen.queryByRole("alert")).toBeNull();
});

it("disconnects after confirmation", async () => {
	const requests = stubApi({
		configured: true,
		links: [{ modelAccountId: "checking", bridgeName: "Old Bridge Name" }],
	});
	render(<SyncSettings />);
	expect(await screen.findByText("Checking")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
	const confirms = await screen.findAllByRole("button", {
		name: "Confirm disconnect",
	});
	expect(confirms.length).toBeGreaterThan(0);
	fireEvent.click(confirms[confirms.length - 1]!);
	expect(
		await screen.findByRole("button", { name: "Connect SimpleFIN" }),
	).toBeTruthy();
	expect(screen.queryByRole("button", { name: /Checking/ })).toBeNull();
	expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
	expect(requests.some((request) => request.method === "DELETE")).toBe(true);
});

it("disables writes when read-only", async () => {
	stubApi({
		configured: true,
		readOnly: true,
		links: [{ modelAccountId: "checking", bridgeName: "Old Bridge Name" }],
	});
	render(<SyncSettings />);
	expect(await screen.findByText("Checking")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Checking" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Prime Card" })).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Connect SimpleFIN" }),
	).toBeNull();
	expect(
		(screen.getByRole("button", { name: "Disconnect" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(
		(screen.getByRole("button", { name: "Reconnect" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
});

it("explains read-only access and disables the credential form", async () => {
	stubApi({ configured: false, readOnly: true });
	render(<SyncSettings />);
	expect(
		(
			(await screen.findByRole("button", {
				name: "Connect SimpleFIN",
			})) as HTMLButtonElement
		).disabled,
	).toBe(true);
	expect(
		(screen.getByLabelText("Setup token") as HTMLInputElement).disabled,
	).toBe(true);
	expect(screen.getByText(/This workspace is read-only/)).toBeTruthy();
});

it("keeps the setup token in a single-line input", async () => {
	stubApi({ configured: false });
	render(<SyncSettings />);
	expect(
		(await screen.findByPlaceholderText("Paste your setup token")).tagName,
	).toBe("INPUT");
	expect(screen.getByLabelText("Setup token").getAttribute("type")).toBe(
		"password",
	);
	fireEvent.click(screen.getByRole("button", { name: "Show token" }));
	expect(screen.getByLabelText("Setup token").getAttribute("type")).toBe(
		"text",
	);
	fireEvent.click(screen.getByRole("button", { name: "Hide token" }));
	expect(screen.getByLabelText("Setup token").getAttribute("type")).toBe(
		"password",
	);
});

it("shows the last sync condition when the connection needs attention", async () => {
	stubApi({
		configured: true,
		links: [],
		syncError: {
			code: "con.auth",
			message: "Reauthenticate My Bank",
			scope: "connection",
		},
	});
	render(<SyncSettings />);
	expect(await screen.findByText("Reauthenticate My Bank")).toBeTruthy();
	expect(screen.getByText(/Other bank logins can keep syncing/)).toBeTruthy();
});

it("shows bridge quota usage when connected", async () => {
	stubApi({ configured: true, links: [] });
	render(<SyncSettings />);
	expect(
		await screen.findByText("19 out of 24 syncs available", { exact: false }),
	).toBeTruthy();
});

it("syncs now through the Sync now button", async () => {
	const requests = stubApi({ configured: true, links: [] });
	render(<SyncSettings />);
	fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
	await waitFor(() => {
		expect(
			requests.some(
				(request) =>
					request.method === "POST" && request.path === "/v1/sync/simplefin",
			),
		).toBe(true);
	});
	await waitFor(() =>
		expect(
			useNotifications
				.getState()
				.items.some((item) => item.message.includes("Sync complete")),
		).toBe(true),
	);
	expect(screen.getByRole("button", { name: "Sync now" })).toBeTruthy();
});

it("reports a throttled sync through the toast", async () => {
	const requests = stubApi({ configured: true, links: [], throttled: true });
	render(<SyncSettings />);
	fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
	await waitFor(() =>
		expect(
			useNotifications
				.getState()
				.items.some((item) => item.message.includes("sync ran recently")),
		).toBe(true),
	);
	// One event, one channel: no inline banner mirrors the toast.
	expect(screen.queryByText(/Could not sync now/)).toBeNull();
	// A failed trigger refreshes nothing.
	expect(requests.some((request) => request.path === "/v1/checkpoints")).toBe(
		false,
	);
});

it("disables Sync now when read-only", async () => {
	stubApi({ configured: true, links: [], readOnly: true });
	render(<SyncSettings />);
	expect(
		(
			(await screen.findByRole("button", {
				name: "Sync now",
			})) as HTMLButtonElement
		).disabled,
	).toBe(true);
});

it("refreshes the workspace after a successful manual sync", async () => {
	const requests = stubApi({ configured: true, links: [] });
	render(<SyncSettings />);
	fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
	await waitFor(() =>
		expect(
			useNotifications
				.getState()
				.items.some((item) => item.message.includes("Sync complete")),
		).toBe(true),
	);
	// The manual action owns the workspace refresh: it must not wait for the
	// scheduled monitor to notice the already-refreshed status.
	await waitFor(() => {
		expect(requests.some((request) => request.path === "/v1/checkpoints")).toBe(
			true,
		);
	});
});

it("does not move focus on the initial credential load", async () => {
	stubApi({ configured: true, links: [] });
	render(<SyncSettings />);
	await screen.findByText(/Connected since/);
	expect(document.activeElement).toBe(document.body);
});

it("awaits the manual status refresh before applying its sync stamp", async () => {
	const state: {
		configured: boolean;
		lastSyncAt: string;
		holdStatus?: Promise<void>;
	} = {
		configured: true,
		lastSyncAt: "before",
	};
	stubApi(state);
	render(<SyncSettings />);
	await screen.findByText(/19 out of 24 syncs available/);
	let finishStatus!: () => void;
	state.holdStatus = new Promise<void>((resolve) => {
		finishStatus = resolve;
	});
	state.lastSyncAt = "after";
	fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
	await waitFor(() =>
		expect(
			serverQueryClient().isFetching({ queryKey: userResourceKey("status") }),
		).toBe(1),
	);
	expect(getAppliedSyncStamp(getUserScope())).not.toBe("after");
	finishStatus();
	await waitFor(() =>
		expect(
			useNotifications
				.getState()
				.items.some((item) => item.message.includes("Sync complete")),
		).toBe(true),
	);
	expect(getAppliedSyncStamp(getUserScope())).toBe("after");
});

it("moves focus to the connected heading after connecting", async () => {
	stubApi({ configured: false });
	render(<SyncSettings />);
	fireEvent.change(
		await screen.findByPlaceholderText("Paste your setup token"),
		{
			target: { value: "dG9rZW4=" },
		},
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
	const heading = await screen.findByRole("heading", {
		name: /SimpleFIN.*Connected/,
	});
	expect(document.activeElement).toBe(heading);
});

it("moves focus to the connect heading after disconnecting", async () => {
	stubApi({ configured: true, links: [] });
	render(<SyncSettings />);
	await screen.findByText(/Connected since/);
	fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
	const confirms = await screen.findAllByRole("button", {
		name: "Confirm disconnect",
	});
	fireEvent.click(confirms[confirms.length - 1]!);
	const heading = await screen.findByRole("heading", {
		name: "Connect bank accounts",
	});
	expect(document.activeElement).toBe(heading);
});

it("does not steal focus when the connection appears from a background load", async () => {
	const state = { configured: false };
	stubApi(state);
	render(<SyncSettings />);
	await screen.findByPlaceholderText("Paste your setup token");
	const focused = document.activeElement;
	state.configured = true;
	await act(async () => {
		await refreshSyncSettings(true);
	});
	await screen.findByText(/Connected since/);
	expect(document.activeElement).toBe(focused);
});
