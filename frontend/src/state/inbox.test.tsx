import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ok } from "../mocks/fetch.ts";
import {
	recordedRequests,
	setupQueryScope,
	teardownQueryScope,
	ServerQueryWrapper,
} from "../mocks/testScope.tsx";
import type { InboxShareItem } from "../pages/inboxApi.ts";
import { useAcceptInboxShare, useInbox, useInboxUnreadCount } from "./inbox.ts";

const wrapper = ServerQueryWrapper;

function share(overrides: Partial<InboxShareItem> = {}): InboxShareItem {
	return {
		kind: "share",
		ownerUserId: "user:alice",
		transactionId: "transaction-1",
		status: "pending",
		unread: true,
		dismissed: false,
		receivedAt: 2,
		...overrides,
	};
}

beforeEach(() => {
	setupQueryScope();
});

afterEach(() => {
	teardownQueryScope();
});

it("loads the pending inbox on mount with the verified user assertion", async () => {
	const fetcher = vi.fn(async () => ok({ items: [share()], unreadCount: 1 }));
	vi.stubGlobal("fetch", fetcher);
	const hook = renderHook(() => useInbox("pending"), { wrapper });
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(hook.result.current.data?.items).toEqual([share()]);
	expect(hook.result.current.data?.unreadCount).toBe(1);
	const requests = recordedRequests(fetcher);
	expect(requests).toHaveLength(1);
	expect(requests[0]).toMatchObject({
		url: "/v1/inbox?status=pending",
		method: "GET",
	});
});

it("reads the unread badge from the count-only endpoint", async () => {
	const fetcher = vi.fn(async () => ok({ unreadCount: 4 }));
	vi.stubGlobal("fetch", fetcher);
	const hook = renderHook(() => useInboxUnreadCount(), { wrapper });
	await waitFor(() => expect(hook.result.current.status).toBe("success"));
	expect(hook.result.current.data).toBe(4);
	const requests = recordedRequests(fetcher);
	expect(requests).toHaveLength(1);
	expect(requests[0]).toMatchObject({
		url: "/v1/inbox?status=all&countOnly=1",
	});
});

it("accepts once and refreshes every inbox entry", async () => {
	let accepted = false;
	const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
		if (init?.method === "POST") {
			accepted = true;
			return ok({ item: share({ status: "accepted" }) });
		}
		return ok({ items: accepted ? [] : [share()], unreadCount: 0 });
	});
	vi.stubGlobal("fetch", fetcher);
	const both = renderHook(
		() => ({ list: useInbox("pending"), accept: useAcceptInboxShare() }),
		{ wrapper },
	);
	await waitFor(() => expect(both.result.current.list.status).toBe("success"));
	await act(async () => {
		await both.result.current.accept.mutateAsync({
			ownerUserId: "user:alice",
			transactionId: "transaction-1",
		});
	});
	const posts = recordedRequests(fetcher).filter(
		(entry) => entry.url === "/v1/inbox/shares/accept",
	);
	expect(posts).toHaveLength(1);
	await waitFor(() => expect(both.result.current.list.data?.items).toEqual([]));
});
