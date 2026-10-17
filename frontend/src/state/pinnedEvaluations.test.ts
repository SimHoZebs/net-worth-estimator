import { beforeEach, describe, expect, it } from "vitest";
import type { ApiClient } from "../api/index.ts";
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
	usePinnedEvaluationsStore.setState({
		ids: null,
		loading: false,
		error: null,
	});
	resetPinnedEvaluationsClient();
});

describe("pinned evaluations", () => {
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
