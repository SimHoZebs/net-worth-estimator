import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/index.ts";
import {
	acceptResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import { resetNotifications, useNotifications } from "./notifications.ts";
import {
	pinnedEvaluationsKey,
	refreshPins,
	resetPinnedEvaluationsClient,
	togglePin,
} from "./pinnedEvaluations.ts";
import { serverQueryClient } from "./serverQuery.ts";

function client(ids: string[] = [], fail = false) {
	return {
		getPinnedEvaluations: vi.fn(async () => ({ instanceIds: ids })),
		setPinnedEvaluations: vi.fn(async (next: string[]) =>
			fail ? new Error("Read-only") : { instanceIds: next },
		),
	} as unknown as ApiClient;
}

const pins = () =>
	serverQueryClient().getQueryData<string[]>(pinnedEvaluationsKey());

beforeEach(() => {
	resetNotifications();
	resetPinnedEvaluationsClient();
	acceptResourceScope(
		{
			apiBaseUrl: "http://localhost",
			resource: {
				id: "plans/sample",
				kind: "sample",
				permissions: ["plan:read"],
			},
			subject: null,
		},
		suspendResourceScope(),
	);
});

describe("query-owned pins", () => {
	it("loads in server order and deduplicates concurrent reads", async () => {
		const api = client(["b", "a"]);
		await Promise.all([refreshPins(api), refreshPins(api)]);
		expect(pins()).toEqual(["b", "a"]);
		expect(api.getPinnedEvaluations).toHaveBeenCalledTimes(1);
		await refreshPins(api);
		expect(api.getPinnedEvaluations).toHaveBeenCalledTimes(1);
		await refreshPins(api, true);
		expect(api.getPinnedEvaluations).toHaveBeenCalledTimes(2);
	});

	it("toggles and rolls back failures", async () => {
		await refreshPins(client(["a"]));
		expect(await togglePin("b", client())).toBe(true);
		expect(pins()).toEqual(["a", "b"]);
		expect(await togglePin("c", client([], true))).toBe(false);
		expect(pins()).toEqual(["a", "b"]);
		expect(useNotifications.getState().items[0]?.action?.label).toBe(
			"Reload pins",
		);
		expect(await togglePin("a", client())).toBe(true);
		expect(pins()).toEqual(["b"]);
	});

	it("serializes rapid toggles against the latest accepted order", async () => {
		const api = client();
		await refreshPins(api);
		await Promise.all([togglePin("a", api), togglePin("b", api)]);
		expect(pins()).toEqual(["a", "b"]);
		expect(api.setPinnedEvaluations).toHaveBeenNthCalledWith(2, ["a", "b"]);
	});

	it("loads the server baseline before a first toggle", async () => {
		const api = client(["existing"]);
		await togglePin("new", api);
		expect(api.setPinnedEvaluations).toHaveBeenCalledWith(["existing", "new"]);
		expect(pins()).toEqual(["existing", "new"]);
	});

	it.each(["read", "write"])(
		"ignores a late %s from an old resource",
		async (operation) => {
			let finish!: (value: { instanceIds: string[] }) => void;
			const pending = new Promise<{ instanceIds: string[] }>((resolve) => {
				finish = resolve;
			});
			const api = {
				getPinnedEvaluations: vi.fn(() => pending),
				setPinnedEvaluations: vi.fn(() => pending),
			} as unknown as ApiClient;
			if (operation === "write")
				serverQueryClient().setQueryData(pinnedEvaluationsKey(), []);
			const action =
				operation === "read" ? refreshPins(api) : togglePin("private-a", api);
			await vi.waitFor(() =>
				expect(
					operation === "read"
						? api.getPinnedEvaluations
						: api.setPinnedEvaluations,
				).toHaveBeenCalledOnce(),
			);
			suspendResourceScope();
			finish({ instanceIds: ["private-a"] });
			await action;
			expect(pins()).toBeUndefined();
			expect(
				serverQueryClient()
					.getQueryCache()
					.findAll({ queryKey: ["pinned-evaluations"] }),
			).toHaveLength(0);
		},
	);

	it("retries after a failed mutation without waiting for freshness expiry", async () => {
		await refreshPins(client(["a"]));
		await togglePin("b", client([], true));
		const api = client(["a"]);
		await refreshPins(api);
		expect(api.getPinnedEvaluations).toHaveBeenCalledOnce();
	});
});
