// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import type { FinancialModelDocument } from "../api/index.ts";
import type { PlannedPurchase } from "../domain/model.ts";
import { acceptOwnerResource } from "../mocks/resource.ts";
import { ok } from "../mocks/fetch.ts";
import { modelFixture, stubTestServer } from "../mocks/waypointServer.ts";
import { resetNotifications, useNotifications } from "./notifications.ts";
import { resetServerQueryCache } from "./serverQuery.ts";
import {
	movePurchaseOperations,
	moveSavedPurchase,
	purchaseRow,
	removeSavedPurchase,
	saveNewPurchase,
	savePurchaseEdit,
} from "./purchaseWrites.ts";

function owner() {
	acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: "users/a",
				permissions: ["user:read", "user:write"],
			},
			subject: "users/a",
		},
		suspendUserScope(),
	);
}

function wish(
	id: string,
	overrides: Partial<PlannedPurchase> = {},
): PlannedPurchase {
	return {
		id,
		name: id,
		amount: 500,
		fromId: "cash",
		startDate: "2026-09-24",
		enabled: true,
		readOnly: false,
		...overrides,
	};
}

function purchasePosting(id: string, priority: number) {
	const stamp = Math.floor(new Date("2026-09-24T00:00:00Z").getTime() / 1000);
	return {
		id,
		name: id,
		sourceAccountId: "cash",
		destinations: null,
		amount: {
			resolver: "expression",
			config: { expression: "500" },
			inputs: {},
		},
		postedTime: stamp,
		transactionTime: stamp,
		purchase: { priority },
		enabled: true,
	};
}

function seedPurchases(): FinancialModelDocument {
	const model = modelFixture();
	(model.postings as unknown[]).push(
		purchasePosting("laptop", 0),
		purchasePosting("chair", 1),
	);
	return model;
}

beforeEach(() => {
	owner();
	resetServerQueryCache();
	resetNotifications();
	vi.unstubAllGlobals();
});

afterEach(() => {
	resetServerQueryCache();
	resetNotifications();
	suspendUserScope();
	vi.unstubAllGlobals();
});

it("builds backend rows with the queue index as priority", () => {
	expect(purchaseRow(wish("laptop"), 2)).toMatchObject({
		id: "laptop",
		fundingAccountId: "cash",
		cost: 500,
		earliestDate: "2026-09-24",
		enabled: true,
		priority: 2,
	});
});

it("adds one wishlist row at the end of the queue", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	expect(await saveNewPurchase(wish("desk"), 2)).toBe(true);
	const created = server.calls.find(
		(call) => call.method === "POST" && call.url === "/v1/postings",
	);
	expect(created?.body).toMatchObject({
		name: "desk",
		purchase: { priority: 2 },
	});
	// The authoritative model refetches after the persisted write.
	expect(
		server.calls.some(
			(call) => call.method === "GET" && call.url === "/v1/financial-model",
		),
	).toBe(true);
});

it("edits one wishlist row without moving it", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	expect(await savePurchaseEdit(wish("laptop", { amount: 600 }), 0)).toBe(true);
	const updated = server.calls.find(
		(call) => call.method === "PATCH" && call.url === "/v1/postings/laptop",
	);
	expect(updated?.body).toMatchObject({ purchase: { priority: 0 } });
	expect(String(JSON.stringify(updated?.body))).toContain("600");
});

it("removes one wishlist row without touching the rest", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	expect(await removeSavedPurchase("laptop")).toBe(true);
	expect(
		server.calls.some(
			(call) => call.method === "DELETE" && call.url === "/v1/postings/laptop",
		),
	).toBe(true);
	expect(
		server.calls.some(
			(call) => call.method === "PATCH" && call.url === "/v1/postings/chair",
		),
	).toBe(false);
});

it("moves one row with priority updates and a single reorder", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	const purchases = [wish("laptop"), wish("chair")];
	const built = movePurchaseOperations(purchases, "chair", -1);
	expect(built?.next.map((item) => item.id)).toEqual(["chair", "laptop"]);
	// Both rows changed queue index, so both carry a new priority.
	expect(
		built?.operations.filter((operation) => operation.action === "update")
			.length,
	).toBe(2);
	expect(
		built?.operations.filter((operation) => operation.action === "move"),
	).toEqual([
		{
			kind: "plannedPurchase",
			action: "move",
			id: "chair",
			beforeId: "laptop",
		},
	]);
	const result = await moveSavedPurchase(purchases, "chair", -1);
	expect(result.ok).toBe(true);
	expect(result.next?.map((item) => item.id)).toEqual(["chair", "laptop"]);
	expect(
		server.calls.some(
			(call) => call.method === "POST" && call.url === "/v1/postings/reorder",
		),
	).toBe(true);
});

it("reports a no-op move without any server call", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	const purchases = [wish("laptop"), wish("chair")];
	expect(movePurchaseOperations(purchases, "laptop", -1)).toBeNull();
	const result = await moveSavedPurchase(purchases, "laptop", -1);
	expect(result).toEqual({ ok: true, next: null });
	expect(server.calls).toEqual([]);
});

it("refreshes authoritative state after a rejected write", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	server.writeOnce(
		(method, path) => method === "POST" && path === "/v1/postings",
		{
			row: {},
			issues: [{ severity: "error", message: "Choose an account." }],
			persisted: false,
			revision: "rev-1",
		},
	);
	expect(await saveNewPurchase(wish("desk"), 2)).toBe(false);
	expect(
		server.calls.some(
			(call) => call.method === "GET" && call.url === "/v1/financial-model",
		),
	).toBe(true);
});

it("reports a transport failure instead of implying a save", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	server.writeOnce(
		(method, path) => method === "DELETE" && path === "/v1/postings/laptop",
		new Error("boom"),
	);
	expect(await removeSavedPurchase("laptop")).toBe(false);
});

it("refuses writes before the workspace is ready", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	suspendUserScope();
	expect(await saveNewPurchase(wish("desk"), 2)).toBe(false);
	expect(server.calls).toEqual([]);
});

it("fails a pending save on resource switch without a stale refresh", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	const release = server.holdWriteOnce(
		(method, path) => method === "POST" && path === "/v1/postings",
	);
	const pending = saveNewPurchase(wish("desk"), 2);
	await vi.waitFor(() => {
		expect(
			server.calls.some(
				(call) => call.method === "POST" && call.url === "/v1/postings",
			),
		).toBe(true);
	});
	acceptOwnerResource("users/b");
	release(undefined);
	await expect(pending).resolves.toBe(false);
	// The shared lifecycle reports the switch before refreshing, so the new
	// resource sees no model fetch and no success for the old save.
	expect(server.modelFetches()).toEqual([]);
	expect(
		useNotifications.getState().items.some((item) => item.kind === "success"),
	).toBe(false);
});

it("never publishes an old failure into the new resource", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	server.writeOnce(
		(method, path) => method === "POST" && path === "/v1/postings",
		new Error("boom"),
	);
	const pending = saveNewPurchase(wish("desk"), 2);
	acceptOwnerResource("users/b");
	await expect(pending).resolves.toBe(false);
	const messages = useNotifications
		.getState()
		.items.map((item) => item.message);
	expect(messages.some((message) => message.includes("boom"))).toBe(false);
	expect(
		messages.some((message) =>
			message.includes("The purchase could not be added."),
		),
	).toBe(false);
});

it("serializes concurrent saves: the second save returns false", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	const release = server.holdWriteOnce(
		(method, path) => method === "POST" && path === "/v1/postings",
	);
	const first = saveNewPurchase(wish("desk"), 2);
	await vi.waitFor(() => {
		expect(
			server.calls.some(
				(call) => call.method === "POST" && call.url === "/v1/postings",
			),
		).toBe(true);
	});
	// The shared lifecycle tracks the in-flight save, so the second save is
	// refused before reaching the server.
	await expect(saveNewPurchase(wish("lamp"), 3)).resolves.toBe(false);
	expect(
		server.calls.filter(
			(call) => call.method === "POST" && call.url === "/v1/postings",
		).length,
	).toBe(1);
	release(undefined);
	await expect(first).resolves.toBe(true);
});

it("fails on resource switch during the refresh, not just the request", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	let releaseModel!: (response: Response) => void;
	const modelGate = new Promise<Response>((resolve) => {
		releaseModel = resolve;
	});
	server.holdModel(modelGate);
	const pending = saveNewPurchase(wish("desk"), 2);
	await vi.waitFor(() => {
		expect(
			server.calls.some(
				(call) => call.method === "GET" && call.url === "/v1/financial-model",
			),
		).toBe(true);
	});
	// The write persisted, but the authoritative reload now belongs to a
	// resource that is no longer current: no success, no stale notice.
	acceptOwnerResource("users/b");
	releaseModel(
		ok({ document: seedPurchases(), issues: [], revision: '"sha256-test"' }),
	);
	await expect(pending).resolves.toBe(false);
	expect(
		useNotifications.getState().items.some((item) => item.kind === "success"),
	).toBe(false);
	expect(useNotifications.getState().items).toEqual([]);
});
