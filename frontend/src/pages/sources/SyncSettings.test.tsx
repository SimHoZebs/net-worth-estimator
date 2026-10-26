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
	{ id: "checking", name: "Checking" },
	{ id: "prime_card", name: "Prime Card" },
];

function stubApi(state: {
	configured: boolean;
	cards?: string[];
	failConnect?: boolean;
	failCards?: boolean;
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
		if (init?.method === "POST" && path === "/v1/sync/simplefin/credential") {
			const body = JSON.parse(String(init.body)) as Record<string, string>;
			requests.push({ method: "POST", path, body });
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
		if (init?.method === "DELETE" && path === "/v1/sync/simplefin/credential") {
			requests.push({ method: "DELETE", path });
			state.configured = false;
			return new Response(JSON.stringify({ configured: false }), {
				headers: jsonHeaders(),
			});
		}
		if (path === "/v1/sync/simplefin/credential")
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
		if (path === "/v1/sync/simplefin/cards") {
			if (state.failCards)
				return new Response(JSON.stringify({ detail: "boom" }), {
					status: 500,
					headers: jsonHeaders(),
				});
			if (init?.method === "PUT") {
				const body = JSON.parse(String(init.body)) as { cards: string[] };
				requests.push({ method: "PUT", path, body });
				state.cards = body.cards;
			}
			return new Response(JSON.stringify({ cards: state.cards ?? [] }), {
				headers: jsonHeaders(),
			});
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

it("shows the bridge link and keeps connect disabled until a token is pasted", async () => {
	stubApi({ configured: false });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	expect(await screen.findByText("Not connected")).toBeTruthy();
	expect(
		screen.getByRole("link", {
			name: /setup token from the SimpleFIN Bridge/i,
		}),
	).toBeTruthy();
	expect(screen.getByPlaceholderText("Paste your setup token").tagName).toBe(
		"INPUT",
	);
	const connect = screen.getByRole("button", { name: "Connect bank" });
	expect((connect as HTMLButtonElement).disabled).toBe(true);
	fireEvent.change(screen.getByPlaceholderText("Paste your setup token"), {
		target: { value: "dG9rZW4=" },
	});
	expect((connect as HTMLButtonElement).disabled).toBe(false);
});

it("connects with a setup token and shows the bridge host", async () => {
	const requests = stubApi({ configured: false });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.change(
		await screen.findByPlaceholderText("Paste your setup token"),
		{
			target: { value: "dG9rZW4=" },
		},
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect bank" }));
	expect(await screen.findByText("Connected")).toBeTruthy();
	expect(screen.getByText(/bridge\.example/)).toBeTruthy();
	expect(
		requests.some(
			(request) =>
				request.method === "POST" &&
				request.body !== undefined &&
				(request.body as Record<string, string>).setupToken === "dG9rZW4=",
		),
	).toBe(true);
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
	fireEvent.click(screen.getByRole("button", { name: "Connect bank" }));
	expect(
		await screen.findByText(
			"Could not connect. Check the token and try again.",
		),
	).toBeTruthy();
	expect(screen.queryByText("Connected")).toBeNull();
});

it("saves the card selection", async () => {
	const requests = stubApi({ configured: true, cards: [] });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	await screen.findByText("Connected");
	fireEvent.click(screen.getByLabelText("Prime Card"));
	fireEvent.click(screen.getByRole("button", { name: "Save cards" }));
	await waitFor(() => {
		expect(
			requests.some(
				(request) =>
					request.method === "PUT" &&
					JSON.stringify((request.body as { cards: string[] }).cards) ===
						JSON.stringify(["prime_card"]),
			),
		).toBe(true);
	});
});

it("connects with an already-claimed access URL", async () => {
	const requests = stubApi({ configured: false });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.click(await screen.findByText("Already have an access URL?"));
	const urlField = screen.getByPlaceholderText(
		"https://user:pass@host/simplefin",
	);
	fireEvent.change(urlField, {
		target: { value: "https://user:pass@bridge.example/simplefin" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Connect with URL" }));
	expect(await screen.findByText("Connected")).toBeTruthy();
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
	fireEvent.change(
		await screen.findByPlaceholderText("Paste your setup token"),
		{
			target: { value: "dG9rZW4=" },
		},
	);
	fireEvent.click(screen.getByText("Already have an access URL?"));
	const urlButton = screen.getByRole("button", {
		name: "Connect with URL",
	}) as HTMLButtonElement;
	expect(urlButton.disabled).toBe(true);
});

it("shows an inline error when cards fail to load", async () => {
	stubApi({ configured: true, cards: [], failCards: true });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	await screen.findByText("Connected");
	expect(
		await screen.findByText("The card selection could not be loaded."),
	).toBeTruthy();
	expect(screen.queryByRole("checkbox")).toBeNull();
	expect(
		(screen.getByRole("button", { name: "Disconnect" }) as HTMLButtonElement)
			.disabled,
	).toBe(false);
});

it("keeps save disabled until the selection changes", async () => {
	stubApi({ configured: true, cards: ["prime_card"] });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	await screen.findByText("Connected");
	expect(
		(screen.getByRole("button", { name: "Save cards" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(
		(screen.getByLabelText("Prime Card") as HTMLInputElement).checked,
	).toBe(true);
});

it("invalidates server status after connecting", async () => {
	stubApi({ configured: false });
	const { getResourceScope } = await import("../../auth/resourceScope.ts");
	const { serverQueryClient } = await import("../../state/serverQuery.ts");
	const { workspaceResourceKey } =
		await import("../../state/workspaceResources.ts");
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	fireEvent.change(
		await screen.findByPlaceholderText("Paste your setup token"),
		{
			target: { value: "dG9rZW4=" },
		},
	);
	serverQueryClient().setQueryData(
		workspaceResourceKey("status", getResourceScope()),
		{
			readOnly: false,
		},
	);
	fireEvent.click(screen.getByRole("button", { name: "Connect bank" }));
	await screen.findByText("Connected");
	await waitFor(() => {
		expect(
			serverQueryClient().getQueryState(
				workspaceResourceKey("status", getResourceScope()),
			)?.isInvalidated,
		).toBe(true);
	});
});
it("disconnects after confirmation", async () => {
	const requests = stubApi({ configured: true, cards: ["prime_card"] });
	render(<SyncSettings accounts={accounts} readOnly={false} />);
	await screen.findByText("Connected");
	fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
	const confirms = await screen.findAllByRole("button", { name: "Disconnect" });
	expect(confirms.length).toBeGreaterThan(1);
	fireEvent.click(confirms[confirms.length - 1]!);
	await screen.findByText("Not connected");
	expect(requests.some((request) => request.method === "DELETE")).toBe(true);
});

it("disables writes when read-only", async () => {
	stubApi({ configured: true, cards: [] });
	render(<SyncSettings accounts={accounts} readOnly={true} />);
	await screen.findByText("Connected");
	expect(
		(screen.getByRole("button", { name: "Save cards" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	expect(
		(screen.getByRole("button", { name: "Disconnect" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
});
