import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ok } from "../mocks/fetch.ts";
import {
	ServerQueryWrapper,
	setupQueryScope,
	teardownQueryScope,
} from "../mocks/testScope.tsx";
import type { InboxShareItem } from "./inboxApi.ts";
import { InboxPage } from "./InboxPage.tsx";

const wrapper = ServerQueryWrapper;

function item(overrides: Partial<InboxShareItem> = {}): InboxShareItem {
	return {
		kind: "share",
		ownerUserId: "user:alice",
		postingId: "posting-1",
		senderDisplayName: "Alice",
		status: "pending",
		unread: true,
		dismissed: false,
		receivedAt: 2,
		posting: {
			id: "posting-1",
			name: "Dinner bill",
			sourceAccountId: null,
			destinations: null,
			amount: {
				resolver: "expression",
				config: { expression: "42.5" },
			},
			postedTime: 1782950400,
			transactionTime: 1782950400,
			enabled: true,
		},
		...overrides,
	};
}

function stubInbox(items: InboxShareItem[], unreadCount = items.length) {
	const requested: string[] = [];
	const bodies: unknown[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: RequestInit) => {
			const path = String(url);
			requested.push(`${init?.method ?? "GET"} ${path}`);
			if (init?.method === "POST") {
				bodies.push(init.body ? JSON.parse(String(init.body)) : null);
				const last = items[0] ?? item();
				return ok({
					item: {
						...last,
						status:
							path === "/v1/inbox/shares/accept"
								? "accepted"
								: path === "/v1/inbox/shares/decline"
									? "declined"
									: last.status,
						copyPostingId:
							path === "/v1/inbox/shares/accept"
								? "copy-1"
								: last.copyPostingId,
						dismissed:
							path === "/v1/inbox/shares/dismiss" ? true : last.dismissed,
						unread: path === "/v1/inbox/shares/read" ? false : last.unread,
					},
				});
			}
			if (path.startsWith("/v1/inbox?")) {
				const params = new URLSearchParams(path.slice("/v1/inbox?".length));
				const status = params.get("status") ?? "pending";
				const showDismissed = params.get("showDismissed") === "1";
				const visible = items.filter(
					(entry) =>
						(status === "all" || entry.status === status) &&
						(showDismissed || !entry.dismissed),
				);
				return ok({ items: visible, unreadCount });
			}
			throw new Error(`unexpected request ${path}`);
		}),
	);
	return { requested, bodies };
}

beforeEach(() => {
	setupQueryScope();
});

afterEach(() => {
	teardownQueryScope();
});

it("shows pending shares with sender and preview", async () => {
	stubInbox([item()]);
	render(<InboxPage />, { wrapper });
	await waitFor(() => expect(screen.getByText("Dinner bill")).toBeTruthy());
	expect(screen.getByText(/Shared by Alice/)).toBeTruthy();
	expect(screen.getByText("New")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Accept and save a copy" }),
	).toBeTruthy();
});

it("shows the empty state when there is nothing pending", async () => {
	stubInbox([]);
	render(<InboxPage />, { wrapper });
	await waitFor(() => expect(screen.getByText("Nothing waiting")).toBeTruthy());
});

it("accepts a share without duplicating the request", async () => {
	const { requested, bodies } = stubInbox([item()]);
	render(<InboxPage />, { wrapper });
	await waitFor(() => expect(screen.getByText("Dinner bill")).toBeTruthy());
	fireEvent.click(
		screen.getByRole("button", { name: "Accept and save a copy" }),
	);
	await waitFor(() =>
		expect(
			requested.filter((entry) => entry === "POST /v1/inbox/shares/accept"),
		).toHaveLength(1),
	);
	expect(bodies).toEqual([{ owner: "users/alice", postingId: "posting-1" }]);
});

it("hides dismissed shares until the toggle reveals them", async () => {
	stubInbox([item({ dismissed: true })]);
	render(<InboxPage />, { wrapper });
	await waitFor(() => expect(screen.getByText("Nothing waiting")).toBeTruthy());
	fireEvent.click(screen.getByLabelText("Show hidden items"));
	await waitFor(() => expect(screen.getByText("Dinner bill")).toBeTruthy());
	expect(screen.getByText("Hidden")).toBeTruthy();
});

it("explains canceled shares without a preview", async () => {
	stubInbox([item({ status: "canceled", unread: false, posting: undefined })]);
	render(<InboxPage />, { wrapper });
	fireEvent.click(screen.getByRole("tab", { name: "Canceled" }));
	await waitFor(() =>
		expect(screen.getByText("Shared transaction")).toBeTruthy(),
	);
	expect(
		screen.getByText("This share was taken back before you decided."),
	).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: "Accept and save a copy" }),
	).toBeNull();
});
