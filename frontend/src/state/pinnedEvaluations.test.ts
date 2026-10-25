import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiClient } from "../api/index.ts";
import {
	acceptResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import { resetNotifications, useNotifications } from "./notifications.ts";
import {
	resetPinnedEvaluationsClient,
	usePinnedEvaluationsStore,
} from "./pinnedEvaluations.ts";

function fakeClient(
	pins: string[],
	failPut = false,
): Pick<ApiClient, "getPinnedEvaluations" | "setPinnedEvaluations"> {
	return {
		getPinnedEvaluations: async () => ({ instanceIds: [...pins] }),
		setPinnedEvaluations: async (next: string[]) =>
			failPut
				? new Error("The server is read-only.")
				: { instanceIds: [...next] },
	} as Pick<ApiClient, "getPinnedEvaluations" | "setPinnedEvaluations">;
}

function countingClient(pins: string[]): {
	calls: () => number;
	client: ApiClient;
} {
	let calls = 0;
	return {
		calls: () => calls,
		client: {
			getPinnedEvaluations: async () => {
				calls += 1;
				return { instanceIds: [...pins] };
			},
			setPinnedEvaluations: async (next: string[]) => ({
				instanceIds: [...next],
			}),
		} as unknown as ApiClient,
	};
}

beforeEach(() => {
	acceptResourceScope(
		{
			apiBaseUrl: "http://localhost",
			resource: {
				id: "plans/sample",
				kind: "sample",
				permissions: ["plan:read", "plan:project"],
			},
			subject: null,
		},
		suspendResourceScope(),
	);
	usePinnedEvaluationsStore.setState({
		ids: null,
		loading: false,
		error: null,
	});
	resetPinnedEvaluationsClient();
});

afterEach(() => {
	resetNotifications();
});

describe("pinned evaluations", () => {
	it("clears pins at a resource transition before another account can render", async () => {
		await usePinnedEvaluationsStore
			.getState()
			.refresh(fakeClient(["private-a"]) as ApiClient);
		suspendResourceScope();
		expect(usePinnedEvaluationsStore.getState()).toMatchObject({
			ids: null,
			loading: false,
			error: null,
		});
	});

	it.each(["refresh", "toggle"] as const)(
		"ignores a late %s completion from the previous account",
		async (operation) => {
			let finish!: (value: { instanceIds: string[] }) => void;
			const pending = new Promise<{ instanceIds: string[] }>((resolve) => {
				finish = resolve;
			});
			const client = {
				getPinnedEvaluations: () => pending,
				setPinnedEvaluations: () => pending,
			} as unknown as ApiClient;
			const store = usePinnedEvaluationsStore.getState();
			const action =
				operation === "refresh"
					? store.refresh(client)
					: store.toggle("private-a", client);
			suspendResourceScope();
			usePinnedEvaluationsStore.getState().reset();
			finish({ instanceIds: ["private-a"] });
			await action;
			expect(usePinnedEvaluationsStore.getState()).toMatchObject({
				ids: null,
				loading: false,
				error: null,
			});
		},
	);

	it("loads pins in server order", async () => {
		const store = usePinnedEvaluationsStore.getState();
		await store.refresh(fakeClient(["b", "a"]) as ApiClient);
		expect(usePinnedEvaluationsStore.getState().ids).toEqual(["b", "a"]);
	});

	it("toggles optimistically and reverts on failure", async () => {
		const store = usePinnedEvaluationsStore.getState();
		await store.refresh(fakeClient([]) as ApiClient);
		const ok = await store.toggle("x", fakeClient([]) as ApiClient);
		expect(ok).toBe(true);
		expect(usePinnedEvaluationsStore.getState().ids).toEqual(["x"]);

		const failed = await store.toggle(
			"y",
			fakeClient(["x"], true) as ApiClient,
		);
		expect(failed).toBe(false);
		expect(usePinnedEvaluationsStore.getState().ids).toEqual(["x"]);
		expect(usePinnedEvaluationsStore.getState().error).toContain("read-only");
	});

	it("unpins an already-pinned evaluation", async () => {
		const store = usePinnedEvaluationsStore.getState();
		await store.refresh(fakeClient(["a", "b"]) as ApiClient);
		await store.toggle("a", fakeClient(["a", "b"]) as ApiClient);
		expect(usePinnedEvaluationsStore.getState().ids).toEqual(["b"]);
	});

	it("suppresses duplicate refreshes within the TTL and refetches with force", async () => {
		const store = usePinnedEvaluationsStore.getState();
		const first = countingClient(["a"]);
		await store.refresh(first.client);
		expect(usePinnedEvaluationsStore.getState().ids).toEqual(["a"]);

		const second = countingClient(["b"]);
		await store.refresh(second.client);
		expect(second.calls()).toBe(0);
		expect(usePinnedEvaluationsStore.getState().ids).toEqual(["a"]);

		await store.refresh(second.client, true);
		expect(second.calls()).toBe(1);
		expect(usePinnedEvaluationsStore.getState().ids).toEqual(["b"]);
	});

	it("refetches after an error without force", async () => {
		const store = usePinnedEvaluationsStore.getState();
		await store.refresh(fakeClient(["a"]) as ApiClient);
		const failed = await store.toggle(
			"y",
			fakeClient(["a"], true) as ApiClient,
		);
		expect(failed).toBe(false);
		expect(usePinnedEvaluationsStore.getState().error).toContain("read-only");

		const retry = countingClient(["a"]);
		await store.refresh(retry.client);
		expect(retry.calls()).toBe(1);
		expect(usePinnedEvaluationsStore.getState().ids).toEqual(["a"]);
		expect(usePinnedEvaluationsStore.getState().error).toBeNull();
	});

	it("floats failures with a reload action", async () => {
		const store = usePinnedEvaluationsStore.getState();
		const failed = await store.toggle(
			"y",
			fakeClient(["x"], true) as ApiClient,
		);
		expect(failed).toBe(false);
		const items = useNotifications.getState().items;
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			key: "evaluation-pins",
			kind: "error",
		});
		expect(items[0]?.message).toContain("read-only");
		expect(items[0]?.action?.label).toBe("Reload pins");
	});

	it("refetches after reset within the TTL", async () => {
		const store = usePinnedEvaluationsStore.getState();
		await store.refresh(countingClient(["a"]).client);
		store.reset();
		const next = countingClient(["b"]);
		await store.refresh(next.client);
		expect(next.calls()).toBe(1);
		expect(usePinnedEvaluationsStore.getState().ids).toEqual(["b"]);
	});
});
