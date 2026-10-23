import { beforeEach, describe, expect, it } from "vitest";
import type { ApiClient } from "../api/index.ts";
import {
	acceptResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
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
});
