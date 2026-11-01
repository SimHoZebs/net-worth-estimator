import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ok } from "../../mocks/fetch.ts";
import {
	ServerQueryWrapper,
	setupQueryScope,
	teardownQueryScope,
} from "../../mocks/testScope.tsx";
import { SharedFeed } from "./SharedFeed.tsx";
import type { FeedItem } from "./sharedFeedApi.ts";

const wrapper = ServerQueryWrapper;

const MEMBERS = [
	{ accountId: "user:aaa", displayName: "Dana" },
	{ accountId: "user:bbb", displayName: "Alex" },
];

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
	return {
		ownerUserId: "user:aaa",
		sourceDisplayName: "Dana",
		audiences: [{ type: "group", id: "g1", name: "Cabin" }],
		posting: {
			id: "p1",
			name: "Groceries",
			transactionTime: 1781472000,
			amount: { resolver: "expression", config: { expression: "42.5" }, inputs: {} },
		},
		...overrides,
	};
}

function stubFeed(pages: Array<{ items: FeedItem[]; nextCursor?: string }>) {
	const requested: string[] = [];
	let calls = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: RequestInit) => {
			const path = String(url);
			requested.push(`${init?.method ?? "GET"} ${path}`);
			if (path.startsWith("/v1/shared/groups/g1/feed")) {
				const page = pages[Math.min(calls, pages.length - 1)];
				calls += 1;
				const total = pages.flatMap((entry) => entry.items);
				return ok({
					groupId: "g1",
					items: page.items,
					totals: {
						count: total.length,
						totalAmount: 60.5,
						varyingCount: 1,
						pendingCount: 1,
					},
					page: {
						nextCursor: page.nextCursor ?? "",
						hasMore: Boolean(page.nextCursor),
					},
				});
			}
			if (path === "/v1/shared/copies" && init?.method === "POST") {
				return ok({ posting: { id: "copy1" } }, 201);
			}
			throw new Error(`unexpected request ${init?.method} ${path}`);
		}),
	);
	return requested;
}

beforeEach(() => setupQueryScope());
afterEach(() => {
	teardownQueryScope();
	vi.unstubAllGlobals();
});

it("lists shared transactions with source, totals, and pending marker", async () => {
	stubFeed([
		{
			items: [
				feedItem(),
				feedItem({
					ownerUserId: "user:bbb",
					sourceDisplayName: "Alex",
					audiences: [{ type: "direct", name: "Alex" }],
					posting: {
						id: "p2",
						name: "Dinner",
						transactionTime: 1781472000,
						pending: true,
						amount: {
							resolver: "expression",
							config: { expression: "balance * 2" },
							inputs: {},
						},
					},
				}),
			],
		},
	]);
	render(<SharedFeed groupId="g1" members={MEMBERS} />, { wrapper });
	await waitFor(() => expect(screen.getByText("Groceries")).toBeTruthy());
	expect(screen.getByText("Shared by Dana · Cabin · Jun 14, 2026")).toBeTruthy();
	expect(screen.getByText("$42.50")).toBeTruthy();
	expect(screen.getByText("Shared by Alex · Direct share · Jun 14, 2026 · Pending")).toBeTruthy();
	expect(screen.getByText("Varies")).toBeTruthy();
	expect(
		screen.getByText("2 transactions · $60.50 shared · 1 calculated amount not summed · 1 pending"),
	).toBeTruthy();
});

it("pages through the feed without repeating items", async () => {
	stubFeed([
		{ items: [feedItem()], nextCursor: "cursor-1" },
		{ items: [feedItem({ posting: { id: "p3", name: "Fuel", transactionTime: 1781472000, amount: { resolver: "expression", config: { expression: "18" }, inputs: {} } } })] },
	]);
	render(<SharedFeed groupId="g1" members={MEMBERS} />, { wrapper });
	await waitFor(() => expect(screen.getByText("Groceries")).toBeTruthy());
	fireEvent.click(screen.getByText("Show more shared transactions"));
	await waitFor(() => expect(screen.getByText("Fuel")).toBeTruthy());
	expect(screen.getAllByText("Groceries")).toHaveLength(1);
});

it("refetches when the member filter changes", async () => {
	const requested = stubFeed([{ items: [feedItem()] }]);
	render(<SharedFeed groupId="g1" members={MEMBERS} />, { wrapper });
	await waitFor(() => expect(screen.getByText("Groceries")).toBeTruthy());
	fireEvent.change(screen.getByLabelText("Member"), {
		target: { value: "user:bbb" },
	});
	await waitFor(() =>
		expect(
			requested.some((entry) => entry.includes("member=users%2Fbbb")),
		).toBe(true),
	);
});

it("saves an independent copy from a feed row", async () => {
	stubFeed([{ items: [feedItem()] }]);
	render(<SharedFeed groupId="g1" members={MEMBERS} />, { wrapper });
	await waitFor(() => expect(screen.getByText("Groceries")).toBeTruthy());
	fireEvent.click(screen.getByText("Save a copy of Groceries"));
	await waitFor(() =>
		expect(screen.getByText("Saved to your transactions")).toBeTruthy(),
	);
});

it("shows the empty state when nothing matches", async () => {
	stubFeed([{ items: [] }]);
	render(<SharedFeed groupId="g1" members={MEMBERS} />, { wrapper });
	await waitFor(() =>
		expect(screen.getByText("No shared transactions")).toBeTruthy(),
	);
});

it("shows the feed error with a retry action", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("oops", { status: 500 })),
	);
	render(<SharedFeed groupId="g1" members={MEMBERS} />, { wrapper });
	await waitFor(() =>
		expect(
			screen.getByText("Shared transactions could not be loaded."),
		).toBeTruthy(),
	);
	expect(screen.getByText("Retry")).toBeTruthy();
});
