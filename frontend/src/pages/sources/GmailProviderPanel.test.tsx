import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { statusOptions } from "../../state/workspaceResources.ts";
import { setupQueryScope, teardownQueryScope } from "../../mocks/testScope.tsx";
import { serverQueryClient } from "../../state/serverQuery.ts";
import { resetGmailClient } from "../../state/gmail.ts";
import { GmailProviderPanel } from "./GmailProviderPanel.tsx";

function stubGmailApi(state: {
	connected: boolean;
	lookbackDays?: number;
	failCredential?: boolean;
	unavailable?: boolean;
	failLookback?: boolean;
	receipts?: Record<string, unknown>[];
}) {
	const jsonHeaders = () => {
		const headers = new Headers({ "content-type": "application/json" });
		headers.set("Waypoint-Resource", "users/test");
		return headers;
	};
	const requests: { method: string; path: string; body?: unknown }[] = [];
	const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
		const raw = String(url);
		const full = raw.slice(raw.indexOf("/v1/"));
		const path = full.split("?")[0] ?? full;
		const method = init?.method ?? "GET";
		const record = (body?: unknown) => requests.push({ method, path, body });
		if (path === "/v1/integrations/gmail/credential") {
			if (state.unavailable)
				return new Response(
					JSON.stringify({ detail: "gmail is not configured" }),
					{
						status: 503,
						headers: jsonHeaders(),
					},
				);
			if (state.failCredential)
				return new Response(JSON.stringify({ detail: "boom" }), {
					status: 500,
					headers: jsonHeaders(),
				});
			if (method === "DELETE") {
				record();
				state.connected = false;
				return new Response(
					JSON.stringify({
						connected: false,
						lookbackDays: state.lookbackDays ?? 90,
					}),
					{ headers: jsonHeaders() },
				);
			}
			record();
			return new Response(
				JSON.stringify(
					state.connected
						? {
								connected: true,
								emailAddress: "reader@example.com",
								connectedAt: "2026-10-26T00:00:00Z",
								scopes: "https://www.googleapis.com/auth/gmail.readonly",
								lookbackDays: state.lookbackDays ?? 90,
							}
						: { connected: false, lookbackDays: state.lookbackDays ?? 90 },
				),
				{ headers: jsonHeaders() },
			);
		}
		if (path === "/v1/integrations/gmail/auth-url") {
			record();
			if (state.unavailable)
				return new Response(
					JSON.stringify({ detail: "gmail is not configured" }),
					{
						status: 503,
						headers: jsonHeaders(),
					},
				);
			return new Response(
				JSON.stringify({
					url: "https://accounts.google.com/o/oauth2/auth?state=test",
				}),
				{ headers: jsonHeaders() },
			);
		}
		if (path === "/v1/integrations/gmail/lookback") {
			const body = JSON.parse(String(init?.body)) as Record<string, number>;
			record(body);
			if (state.failLookback)
				return new Response(JSON.stringify({ detail: "boom" }), {
					status: 500,
					headers: jsonHeaders(),
				});
			state.lookbackDays = body.lookbackDays;
			return new Response(
				JSON.stringify({
					connected: state.connected,
					lookbackDays: body.lookbackDays,
				}),
				{ headers: jsonHeaders() },
			);
		}
		if (path === "/v1/status") {
			record();
			return new Response(
				JSON.stringify({
					readOnly: false,
					syncConfigured: false,
					syncQuotaUsed: 0,
					syncQuotaLimit: 24,
				}),
				{ headers: jsonHeaders() },
			);
		}
		if (path === "/v1/integrations/gmail/scan" && method === "POST") {
			record();
			return new Response(
				JSON.stringify({
					incremental: false,
					listed: 2,
					triaged: 2,
					receipts: 1,
					refunds: 0,
					needsReview: 1,
					skipped: 0,
					failed: 0,
					truncated: false,
				}),
				{ headers: jsonHeaders() },
			);
		}
		if (path === "/v1/integrations/gmail/receipts" && method === "GET") {
			record();
			return new Response(
				JSON.stringify({ receipts: state.receipts ?? [], nextCursor: "" }),
				{ headers: jsonHeaders() },
			);
		}
		if (
			path.startsWith("/v1/integrations/gmail/receipts/") &&
			method === "PATCH"
		) {
			const id = path.slice("/v1/integrations/gmail/receipts/".length);
			const body = JSON.parse(String(init?.body)) as {
				correction?: Record<string, unknown>;
			};
			record(body);
			const current = (state.receipts ?? []).find(
				(item) => (item as { id: string }).id === id,
			) as unknown as Record<string, unknown> | undefined;
			if (!current)
				return new Response(JSON.stringify({ detail: "not found" }), {
					status: 404,
					headers: jsonHeaders(),
				});
			const updated = {
				...current,
				status: "confirmed",
				correction: body.correction ?? null,
			};
			state.receipts = (state.receipts ?? []).map((item) =>
				(item as { id: string }).id === id ? updated : item,
			);
			return new Response(JSON.stringify({ receipt: updated }), {
				headers: jsonHeaders(),
			});
		}
		throw new Error(`unexpected request ${init?.method ?? "GET"} ${path}`);
	});
	vi.stubGlobal("fetch", fetcher);
	const cache = serverQueryClient();
	cache.setQueryData(statusOptions().queryKey, {
		readOnly: false,
		syncConfigured: false,
		syncQuotaUsed: 0,
		syncQuotaLimit: 24,
	});
	return requests;
}

beforeEach(() => {
	setupQueryScope();
});

afterEach(() => {
	teardownQueryScope();
	resetGmailClient();
	vi.restoreAllMocks();
});

it("renders disconnected state with the read-only scope notice", async () => {
	stubGmailApi({ connected: false });
	render(<GmailProviderPanel />);
	expect(
		await screen.findByRole("heading", {
			name: "Connect Gmail for receipt discovery",
		}),
	).toBeTruthy();
	expect(screen.getByText("Not connected")).toBeTruthy();
	expect(screen.getByText(/read-only access to/)).toBeTruthy();
	expect(screen.getByRole("button", { name: /Connect Gmail/ })).toBeTruthy();
});

it("starts consent through the server-built URL without rendering it", async () => {
	const requests = stubGmailApi({ connected: false });
	const descriptor = Object.getOwnPropertyDescriptor(window, "location");
	const assign = vi.fn();
	Object.defineProperty(window, "location", {
		value: { ...window.location, assign },
		writable: true,
	});
	try {
		render(<GmailProviderPanel />);
		fireEvent.click(
			await screen.findByRole("button", { name: /Connect Gmail/ }),
		);
		await waitFor(() => {
			expect(assign).toHaveBeenCalledWith(
				"https://accounts.google.com/o/oauth2/auth?state=test",
			);
		});
	} finally {
		if (descriptor) Object.defineProperty(window, "location", descriptor);
	}
	expect(
		requests.some(
			(request) =>
				request.method === "GET" &&
				request.path === "/v1/integrations/gmail/auth-url",
		),
	).toBe(true);
	// The URL carries single-use state: it navigates, never renders.
	expect(screen.queryByText(/accounts\.google\.com/)).toBeNull();
});

it("shows the connected account and saves the scan window", async () => {
	const requests = stubGmailApi({ connected: true, lookbackDays: 90 });
	render(<GmailProviderPanel />);
	expect(await screen.findByText(/reader@example\.com/)).toBeTruthy();
	const input = screen.getByLabelText(
		"Initial scan window (days)",
	) as HTMLInputElement;
	expect(input.value).toBe("90");
	fireEvent.change(input, { target: { value: "45" } });
	fireEvent.click(screen.getByRole("button", { name: "Save scan window" }));
	await waitFor(() => {
		expect(
			screen.getByText("Initial scan window set to 45 days."),
		).toBeTruthy();
	});
	expect(
		requests.some(
			(request) =>
				request.method === "PUT" &&
				request.path === "/v1/integrations/gmail/lookback" &&
				(request.body as Record<string, number>).lookbackDays === 45,
		),
	).toBe(true);
});

it("rejects an out-of-range scan window without a request", async () => {
	const requests = stubGmailApi({ connected: true });
	render(<GmailProviderPanel />);
	const input = await screen.findByLabelText("Initial scan window (days)");
	fireEvent.change(input, { target: { value: "400" } });
	expect(
		(
			screen.getByRole("button", {
				name: "Save scan window",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	expect(
		requests.some(
			(request) => request.path === "/v1/integrations/gmail/lookback",
		),
	).toBe(false);
});

it("disconnects after confirmation and keeps the lookback", async () => {
	const requests = stubGmailApi({ connected: true, lookbackDays: 45 });
	render(<GmailProviderPanel />);
	await screen.findByText(/reader@example\.com/);
	fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
	fireEvent.click(screen.getByRole("button", { name: "Yes, disconnect" }));
	expect(
		await screen.findByText(/Saved tokens are revoked and forgotten/),
	).toBeTruthy();
	expect(
		requests.some(
			(request) =>
				request.method === "DELETE" &&
				request.path === "/v1/integrations/gmail/credential",
		),
	).toBe(true);
	expect(
		await screen.findByRole("heading", {
			name: "Connect Gmail for receipt discovery",
		}),
	).toBeTruthy();
});

it("shows the unavailable state when the server has no OAuth client", async () => {
	stubGmailApi({ connected: false, unavailable: true });
	render(<GmailProviderPanel />);
	expect(await screen.findByText("Unavailable")).toBeTruthy();
	expect(screen.getByText(/has not configured Gmail/)).toBeTruthy();
	expect(screen.queryByRole("button", { name: /Connect Gmail/ })).toBeNull();
});

it("shows an error instead of onboarding when the credential fails", async () => {
	const state = { connected: false, failCredential: true };
	stubGmailApi(state);
	render(<GmailProviderPanel />);
	expect(
		await screen.findByText("The Gmail connection could not be loaded."),
	).toBeTruthy();
	expect(screen.queryByText("Not connected")).toBeNull();
	state.failCredential = false;
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(
		await screen.findByRole("heading", {
			name: "Connect Gmail for receipt discovery",
		}),
	).toBeTruthy();
});

it("announces the OAuth return outcome once and clears the flag", async () => {
	stubGmailApi({ connected: true });
	const replaceState = vi.fn();
	window.history.replaceState = replaceState;
	window.history.pushState(null, "", "/?gmail=connected");
	render(<GmailProviderPanel />);
	expect(await screen.findByText("Gmail connected.")).toBeTruthy();
	expect(replaceState).toHaveBeenCalled();
	const cleaned = String(replaceState.mock.calls[0]?.[2] ?? "");
	expect(cleaned).not.toContain("gmail=connected");
});

const sampleReceipt = {
	id: "receipt-row-1",
	gmailMessageId: "msg-1",
	verdict: "receipt",
	merchant: "Example Store",
	receiptDate: "2026-10-20",
	amountText: "$42.50",
	amountCents: 4250,
	currency: "USD",
	reference: "AB-12345",
	confidence: 0.95,
	provenance: { producer: "gmail-receipt-email", version: "v1" },
	status: "needs-review",
	scannedAt: "2026-11-01T12:00:00Z",
};

it("scans and lists extracted receipts with review standing", async () => {
	const requests = stubGmailApi({ connected: true, receipts: [sampleReceipt] });
	render(<GmailProviderPanel />);
	expect(await screen.findByText("Example Store")).toBeTruthy();
	expect(screen.getByText("Needs review")).toBeTruthy();
	expect(screen.getByText(/2026-10-20/)).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Scan now" }));
	expect(
		await screen.findByText(/Scan complete: 2 new, 1 receipt, 1 need review/),
	).toBeTruthy();
	expect(
		requests.some(
			(request) =>
				request.method === "POST" &&
				request.path === "/v1/integrations/gmail/scan",
		),
	).toBe(true);
});

it("confirms a low-confidence extraction without rewriting the original", async () => {
	stubGmailApi({ connected: true, receipts: [{ ...sampleReceipt }] });
	render(<GmailProviderPanel />);
	fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
	expect(await screen.findByText("Reviewed")).toBeTruthy();
	expect(screen.queryByText("Needs review")).toBeNull();
});

it("saves a correction over a low-confidence extraction", async () => {
	stubGmailApi({ connected: true, receipts: [{ ...sampleReceipt }] });
	render(<GmailProviderPanel />);
	await screen.findByText("Example Store");
	fireEvent.click(screen.getByRole("button", { name: "Correct" }));
	fireEvent.change(screen.getByLabelText("Merchant"), {
		target: { value: "Corrected Store" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
	expect(await screen.findByText("Corrected Store")).toBeTruthy();
	expect(await screen.findByText("Reviewed")).toBeTruthy();
});
