import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptTestResource } from "../../mocks/resource.ts";
import { resetServerQueryCache } from "../../state/serverQuery.ts";
import { resetSyncSettingsClient } from "../../state/syncSettings.ts";
import { SyncSettings } from "./SyncSettings.tsx";

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
	links?: { modelAccountId: string; bridgeName: string }[];
	failConnect?: boolean;
	failLinks?: boolean;
	throttled?: boolean;
	lastSyncAt?: string;
	syncEnabled?: boolean;
}) {
	const jsonHeaders = () => {
		const headers = new Headers({ "content-type": "application/json" });
		headers.set("Waypoint-Resource", "users/test");
		return headers;
	};
	const requests: { method: string; path: string; body?: unknown }[] = [];
	const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
		const raw = String(url);
		const path = raw.slice(raw.indexOf("/v1/"));
		const method = init?.method ?? "GET";
		const record = (body?: unknown) => requests.push({ method, path, body });
		if (path === "/v1/sync/simplefin/credential") {
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
		if (path === "/v1/status")
			return new Response(
				JSON.stringify(
					state.configured
						? {
								readOnly: false,
								syncConfigured: state.syncEnabled ?? true,
								lastSyncAt: state.lastSyncAt,
								syncQuotaUsed: 5,
								syncQuotaLimit: 24,
							}
						: {
								readOnly: false,
								syncConfigured: false,
								syncQuotaUsed: 0,
								syncQuotaLimit: 24,
							},
				),
				{ headers: jsonHeaders() },
			);
		throw new Error(`unexpected request ${init?.method ?? "GET"} ${path}`);
	});
	vi.stubGlobal("fetch", fetcher);
	return requests;
}

beforeEach(() => {
	acceptTestResource();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});

afterEach(() => {
	cleanup();
	resetSyncSettingsClient();
	resetServerQueryCache();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("shows a complete setup guide without a prerequisite click", async () => {
	const requests = stubApi({ configured: false });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
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
	render(<SyncSettings accounts={accounts} readOnly={false} />);
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
	render(<SyncSettings accounts={accounts} readOnly={false} />);
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
	render(<SyncSettings accounts={accounts} readOnly={false} />);
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
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.click(
		await screen.findByRole("button", { name: "I already have a token" }),
	);
	expect(document.activeElement).toBe(screen.getByLabelText("Setup token"));
});

it("refreshes status and links after connecting", async () => {
	const requests = stubApi({ configured: false });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
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
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	expect(await screen.findByText("Synced accounts")).toBeTruthy();
	expect(await screen.findByText("Checking")).toBeTruthy();
	expect(screen.getByText("Prime Card")).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: /Checking|Prime Card/ }),
	).toBeNull();
	expect(screen.queryByRole("button", { name: /Save cards/ })).toBeNull();
});

it("falls back to the bridge name when the model account is gone", async () => {
	stubApi({
		configured: true,
		links: [{ modelAccountId: "deleted", bridgeName: "Old Bridge Name" }],
	});
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	expect(await screen.findByText("Synced accounts")).toBeTruthy();
	expect(await screen.findByText("Old Bridge Name")).toBeTruthy();
});

it("shows an empty state when no accounts are synced", async () => {
	stubApi({ configured: true, links: [] });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	expect(await screen.findByText("No synced accounts yet.")).toBeTruthy();
});

it("shows an inline error when synced accounts fail to load", async () => {
	stubApi({ configured: true, failLinks: true });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	expect(
		await screen.findByText("The synced accounts could not be loaded."),
	).toBeTruthy();
	expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
});

it("shows an error when the token is rejected", async () => {
	stubApi({ configured: false, failConnect: true });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.change(
		await screen.findByPlaceholderText("Paste your setup token"),
		{
			target: { value: "bogus" },
		},
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(screen.getByRole("alert").textContent).toMatch(
		/Copy the entire setup token from SimpleFIN/,
	);
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
	render(<SyncSettings accounts={accounts} readOnly={false} />);
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
		links: [{ modelAccountId: "checking", bridgeName: "Old Bridge Name" }],
	});
	render(<SyncSettings accounts={accounts} readOnly={true} />);
	expect(await screen.findByText("Checking")).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: /Checking|Prime Card/ }),
	).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Connect SimpleFIN" }),
	).toBeNull();
	expect(
		(screen.getByRole("button", { name: "Disconnect" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
});

it("explains read-only access and disables the credential form", async () => {
	stubApi({ configured: false });
	render(<SyncSettings accounts={accounts} readOnly={true} />);
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
	render(<SyncSettings accounts={accounts} readOnly={false} />);
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

it("shows bridge quota usage when connected", async () => {
	stubApi({ configured: true, links: [] });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	expect(
		await screen.findByText("19 out of 24 syncs available", { exact: false }),
	).toBeTruthy();
});

it("syncs now through the Sync now button", async () => {
	const requests = stubApi({ configured: true, links: [] });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
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
		expect(screen.getByRole("status").textContent).toMatch(/Sync complete/),
	);
	expect(screen.getByRole("button", { name: "Sync now" })).toBeTruthy();
});

it("shows an inline error when sync is throttled", async () => {
	stubApi({ configured: true, links: [], throttled: true });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
	expect(
		await screen.findByText(/Could not sync now\. Check the connection/),
	).toBeTruthy();
});

it("disables Sync now when read-only", async () => {
	stubApi({ configured: true, links: [] });
	render(<SyncSettings accounts={accounts} readOnly={true} />);
	expect(
		(
			(await screen.findByRole("button", {
				name: "Sync now",
			})) as HTMLButtonElement
		).disabled,
	).toBe(true);
});
