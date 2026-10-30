import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	suspendUserScope,
} from "@/auth/resourceScope.ts";
import { resetNotifications, useNotifications } from "@/state/notifications.ts";
import {
	pinnedEvaluationsKey,
	refreshPins,
	resetPinnedEvaluationsClient,
	togglePin,
} from "@/state/pinnedEvaluations.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";

const scopeId = `users/${"a".repeat(64)}`;

function stubPins(initial: string[] = [], failWrite = false) {
	const seen: { url: string; init?: RequestInit }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: RequestInit) => {
			seen.push({ url: String(url), init });
			if (
				String(url).endsWith("/v1/pinned-evaluations") &&
				(!init?.method || init.method === "GET")
			)
				return ok({ instanceIds: initial });
			if (failWrite)
				return new Response(JSON.stringify({ title: "Read-only" }), {
					status: 403,
					headers: { "content-type": "application/json" },
				});
			const body = JSON.parse(String(init?.body ?? "{}")) as {
				instanceIds?: string[];
			};
			return ok({ instanceIds: body.instanceIds ?? [] });
		}),
	);
	return seen;
}

function ok(body: unknown) {
	return new Response(JSON.stringify(body), {
		headers: {
			"content-type": "application/json",
			"Waypoint-Resource": scopeId,
		},
	});
}

const pins = () =>
	serverQueryClient().getQueryData<string[]>(pinnedEvaluationsKey());

beforeEach(() => {
	resetNotifications();
	resetPinnedEvaluationsClient();
	vi.unstubAllGlobals();
	acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: scopeId,
				permissions: ["user:read", "user:project", "user:write"],
			},
			subject: scopeId,
		},
		suspendUserScope(),
	);
});

describe("query-owned pins", () => {
	it("loads in server order and deduplicates concurrent reads", async () => {
		const seen = stubPins(["b", "a"]);
		await Promise.all([refreshPins(), refreshPins()]);
		expect(pins()).toEqual(["b", "a"]);
		expect(seen.filter((call) => call.init?.method !== "PUT")).toHaveLength(1);
		await refreshPins();
		expect(seen.filter((call) => call.init?.method !== "PUT")).toHaveLength(1);
		await refreshPins(true);
		expect(seen.filter((call) => call.init?.method !== "PUT")).toHaveLength(2);
	});

	it("toggles and rolls back failures", async () => {
		stubPins(["a"]);
		await refreshPins();
		expect(await togglePin("b")).toBe(true);
		expect(pins()).toEqual(["a", "b"]);
		vi.unstubAllGlobals();
		stubPins(["a", "b"], true);
		expect(await togglePin("c")).toBe(false);
		expect(pins()).toEqual(["a", "b"]);
		expect(useNotifications.getState().items[0]?.action?.label).toBe(
			"Reload pins",
		);
		vi.unstubAllGlobals();
		stubPins(["b"]);
		expect(await togglePin("a")).toBe(true);
		expect(pins()).toEqual(["b"]);
	});

	it("serializes rapid toggles against the latest accepted order", async () => {
		const seen = stubPins([]);
		await refreshPins();
		await Promise.all([togglePin("a"), togglePin("b")]);
		expect(pins()).toEqual(["a", "b"]);
		const puts = seen.filter((call) => call.init?.method === "PUT");
		expect(JSON.parse(String(puts.at(-1)?.init?.body))).toEqual({
			instanceIds: ["a", "b"],
		});
	});

	it("loads the server baseline before a first toggle", async () => {
		const seen = stubPins(["existing"]);
		await togglePin("new");
		const puts = seen.filter((call) => call.init?.method === "PUT");
		expect(JSON.parse(String(puts[0]?.init?.body))).toEqual({
			instanceIds: ["existing", "new"],
		});
		expect(pins()).toEqual(["existing", "new"]);
	});

	it.each(["read", "write"])(
		"ignores a late %s from an old resource",
		async (operation) => {
			let finish!: (value: Response) => void;
			const pending = new Promise<Response>((resolve) => {
				finish = resolve;
			});
			let calls = 0;
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => {
					calls += 1;
					return pending;
				}),
			);
			if (operation === "write")
				serverQueryClient().setQueryData(pinnedEvaluationsKey(), []);
			const action =
				operation === "read" ? refreshPins() : togglePin("private-a");
			await vi.waitFor(() => expect(calls).toBeGreaterThan(0));
			suspendUserScope();
			finish(ok({ instanceIds: ["private-a"] }));
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
		stubPins(["a"]);
		await refreshPins();
		vi.unstubAllGlobals();
		stubPins(["a"], true);
		await togglePin("b");
		const seen = stubPins(["a"]);
		await refreshPins();
		expect(
			seen.filter((call) => !call.init?.method || call.init.method === "GET"),
		).toHaveLength(1);
	});
});
