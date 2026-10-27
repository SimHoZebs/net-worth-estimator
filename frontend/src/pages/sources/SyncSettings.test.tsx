import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { acceptTestResource } from "../../mocks/resource.ts";
import { resetServerQueryCache } from "../../state/serverQuery.ts";
import { resetSyncSettingsClient } from "../../state/syncSettings.ts";
import { SyncSettings } from "./SyncSettings.tsx";

vi.mock("../../components/Modal.tsx", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../components/Modal.tsx")>()),
	Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

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
}) {
	const jsonHeaders = () => {
		const headers = new Headers({ "content-type": "application/json" });
		headers.set("Waypoint-Resource", "plans/test");
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
		if (path === "/v1/status")
			return new Response(JSON.stringify({ readOnly: false }), {
				headers: jsonHeaders(),
			});
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

it("shows the bank sync button as not connected", async () => {
	stubApi({ configured: false });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	const button = await screen.findByRole("button", {
		name: /Update bank providers/,
	});
	expect(button).toBeTruthy();
	expect(screen.getByText("Not connected")).toBeTruthy();
	const describedBy = button.getAttribute("aria-describedby");
	expect(describedBy).toBeTruthy();
	expect(document.getElementById(describedBy!)?.textContent).toBe(
		"Not connected",
	);
	expect(button.textContent?.replace(/\s+/g, " ").trim()).toBe(
		"Update bank providers - Not connected",
	);
});

it("opens the provider chooser with SimpleFIN as the option", async () => {
	stubApi({ configured: false });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
	expect(await screen.findByText("SimpleFIN")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Connect SimpleFIN" }),
	).toBeTruthy();
});

it("connects through the token modal and reports one provider", async () => {
	const requests = stubApi({ configured: false });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
	fireEvent.change(
		await screen.findByPlaceholderText("Paste your setup token"),
		{
			target: { value: "dG9rZW4=" },
		},
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect bank" }));
	await waitFor(() => {
		expect(screen.getByText("1 connected")).toBeTruthy();
	});
	const card = screen.getByRole("button", { name: /Update bank providers/ });
	expect(
		document.getElementById(card.getAttribute("aria-describedby")!)
			?.textContent,
	).toBe("1 connected");
	expect(
		requests.some(
			(request) =>
				request.method === "POST" &&
				(request.body as Record<string, string>).setupToken === "dG9rZW4=",
		),
	).toBe(true);
});

it("connects with an already-claimed access URL", async () => {
	const requests = stubApi({ configured: false });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
	fireEvent.click(await screen.findByText("Already have an access URL?"));
	const urlField = screen.getByPlaceholderText(
		"https://user:pass@host/simplefin",
	);
	fireEvent.change(urlField, {
		target: { value: "https://user:pass@bridge.example/simplefin" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Connect with URL" }));
	await waitFor(() => {
		expect(screen.getByText("1 connected")).toBeTruthy();
	});
	expect(
		requests.some(
			(request) =>
				request.method === "POST" &&
				(request.body as Record<string, string>).accessUrl ===
					"https://user:pass@bridge.example/simplefin",
		),
	).toBe(true);
});

it("disables each connect button while the other field is filled", async () => {
	stubApi({ configured: false });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
	fireEvent.change(
		await screen.findByPlaceholderText("Paste your setup token"),
		{
			target: { value: "dG9rZW4=" },
		},
	);
	const urlButton = screen.getByRole("button", {
		name: "Connect with URL",
	}) as HTMLButtonElement;
	expect(urlButton.disabled).toBe(true);
	fireEvent.change(screen.getByPlaceholderText("Paste your setup token"), {
		target: { value: "" },
	});
	fireEvent.click(screen.getByText("Already have an access URL?"));
	fireEvent.change(
		screen.getByPlaceholderText("https://user:pass@host/simplefin"),
		{
			target: { value: "https://user:pass@bridge.example/simplefin" },
		},
	);
	expect(
		(screen.getByRole("button", { name: "Connect bank" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
});

it("refreshes status and links after connecting", async () => {
	const requests = stubApi({ configured: false });
	const { getResourceScope } = await import("../../auth/resourceScope.ts");
	const { serverQueryClient } = await import("../../state/serverQuery.ts");
	const { workspaceResourceKey } =
		await import("../../state/workspaceResources.ts");
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	serverQueryClient().setQueryData(
		workspaceResourceKey("status", getResourceScope()),
		{
			readOnly: false,
		},
	);
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
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
	fireEvent.click(screen.getByRole("button", { name: "Connect bank" }));
	await screen.findByText("1 connected");
	await waitFor(() => {
		expect(
			serverQueryClient().getQueryState(
				workspaceResourceKey("status", getResourceScope()),
			)?.isInvalidated,
		).toBe(true);
	});
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
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
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
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
	expect(await screen.findByText("Synced accounts")).toBeTruthy();
	expect(await screen.findByText("Old Bridge Name")).toBeTruthy();
});

it("shows an empty state when no accounts are synced", async () => {
	stubApi({ configured: true, links: [] });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
	expect(await screen.findByText("No synced accounts yet.")).toBeTruthy();
});

it("shows an inline error when synced accounts fail to load", async () => {
	stubApi({ configured: true, failLinks: true });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
	expect(
		await screen.findByText("The synced accounts could not be loaded."),
	).toBeTruthy();
	expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
});

it("shows an error when the token is rejected", async () => {
	stubApi({ configured: false, failConnect: true });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
	fireEvent.change(
		await screen.findByPlaceholderText("Paste your setup token"),
		{
			target: { value: "bogus" },
		},
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect bank" }));
	expect(
		await screen.findByText(
			"Could not connect. Check the token and try again.",
		),
	).toBeTruthy();
});

it("disconnects after confirmation", async () => {
	const requests = stubApi({
		configured: true,
		links: [{ modelAccountId: "checking", bridgeName: "Old Bridge Name" }],
	});
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
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
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
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

it("keeps the setup token in a single-line input", async () => {
	stubApi({ configured: false });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.click(
		await screen.findByRole("button", { name: /Update bank providers/ }),
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect SimpleFIN" }));
	expect(screen.getByPlaceholderText("Paste your setup token").tagName).toBe(
		"INPUT",
	);
});
