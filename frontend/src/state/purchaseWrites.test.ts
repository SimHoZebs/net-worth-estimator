// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import type { FinancialModel } from "../api/index.ts";
import type { PlannedPurchase } from "../domain/model.ts";
import { acceptOwnerResource } from "../mocks/resource.ts";
import { ok } from "../mocks/fetch.ts";
import { modelFixture, stubTestServer } from "../mocks/waypointServer.ts";
import { toast } from "../components/ui/toast.tsx";
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

let published: {
	id?: string;
	type?: unknown;
	description?: unknown;
	actionProps?: { children?: unknown; onClick?: unknown };
	onClose?: unknown;
}[] = [];

function seedPurchases(): FinancialModel {
	const model = modelFixture();
	model.plannedPurchases = [
		purchaseRow(wish("laptop"), 0),
		purchaseRow(wish("chair"), 1),
	];
	return model;
}

beforeEach(() => {
	owner();
	resetServerQueryCache();
	toast.close();
	published = [];
	vi.spyOn(toast, "add").mockImplementation((options) => {
		published.push(options);
		return options.id ?? "toast-test";
	});
	vi.unstubAllGlobals();
});

afterEach(() => {
	resetServerQueryCache();
	toast.close();
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
		(call) => call.method === "POST" && call.url === "/v1/planned-purchases",
	);
	expect(created?.body).toMatchObject({
		name: "desk",
		priority: 2,
	});
	// The authoritative purchase queue refetches after the persisted write.
	expect(
		server.calls.some(
			(call) => call.method === "GET" && call.url === "/v1/planned-purchases",
		),
	).toBe(true);
});

it("edits one wishlist row without moving it", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	expect(await savePurchaseEdit(wish("laptop", { amount: 600 }), 0)).toBe(true);
	const updated = server.calls.find(
		(call) =>
			call.method === "PATCH" && call.url === "/v1/planned-purchases/laptop",
	);
	expect(updated?.body).toMatchObject({ priority: 0 });
	expect(String(JSON.stringify(updated?.body))).toContain("600");
});

it("removes one wishlist row without touching the rest", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	expect(await removeSavedPurchase("laptop")).toBe(true);
	expect(
		server.calls.some(
			(call) =>
				call.method === "DELETE" && call.url === "/v1/planned-purchases/laptop",
		),
	).toBe(true);
	expect(
		server.calls.some(
			(call) =>
				call.method === "PATCH" && call.url === "/v1/planned-purchases/chair",
		),
	).toBe(false);
});

it("moves one row with a single reorder", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	const purchases = [wish("laptop"), wish("chair")];
	const built = movePurchaseOperations(purchases, "chair", -1);
	expect(built?.next.map((item) => item.id)).toEqual(["chair", "laptop"]);
	// The server move renumbers every priority, so no extra update writes.
	expect(built?.operations).toEqual([
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
			(call) =>
				call.method === "POST" && call.url === "/v1/planned-purchases/reorder",
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
		(method, path) => method === "POST" && path === "/v1/planned-purchases",
		{
			value: {},
			issues: [{ severity: "error", message: "Choose an account." }],
			saved: false,
			revision: "rev-1",
		},
	);
	expect(await saveNewPurchase(wish("desk"), 2)).toBe(false);
	expect(
		server.calls.some(
			(call) => call.method === "GET" && call.url === "/v1/planned-purchases",
		),
	).toBe(true);
});

it("reports a transport failure instead of implying a save", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	server.writeOnce(
		(method, path) =>
			method === "DELETE" && path === "/v1/planned-purchases/laptop",
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
		(method, path) => method === "POST" && path === "/v1/planned-purchases",
	);
	const pending = saveNewPurchase(wish("desk"), 2);
	await vi.waitFor(() => {
		expect(
			server.calls.some(
				(call) =>
					call.method === "POST" && call.url === "/v1/planned-purchases",
			),
		).toBe(true);
	});
	acceptOwnerResource("users/b");
	release(undefined);
	await expect(pending).resolves.toBe(false);
	// The shared lifecycle reports the switch before refreshing, so the new
	// resource sees no purchase fetch and no success for the old save.
	expect(
		server.calls.filter(
			(call) => call.method === "GET" && call.url === "/v1/planned-purchases",
		),
	).toEqual([]);
	expect(published.every((options) => options.type !== "success")).toBe(true);
});

it("never publishes an old failure into the new resource", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	server.writeOnce(
		(method, path) => method === "POST" && path === "/v1/planned-purchases",
		new Error("boom"),
	);
	const pending = saveNewPurchase(wish("desk"), 2);
	acceptOwnerResource("users/b");
	await expect(pending).resolves.toBe(false);
	const descriptions = published.map((options) =>
		typeof options.description === "string" ? options.description : "",
	);
	expect(descriptions.some((message) => message.includes("boom"))).toBe(false);
	expect(
		descriptions.some((message) =>
			message.includes("The purchase could not be added."),
		),
	).toBe(false);
});

it("serializes concurrent saves: the second save returns false", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	const release = server.holdWriteOnce(
		(method, path) => method === "POST" && path === "/v1/planned-purchases",
	);
	const first = saveNewPurchase(wish("desk"), 2);
	await vi.waitFor(() => {
		expect(
			server.calls.some(
				(call) =>
					call.method === "POST" && call.url === "/v1/planned-purchases",
			),
		).toBe(true);
	});
	// The shared lifecycle tracks the in-flight save, so the second save is
	// refused before reaching the server.
	await expect(saveNewPurchase(wish("lamp"), 3)).resolves.toBe(false);
	expect(
		server.calls.filter(
			(call) => call.method === "POST" && call.url === "/v1/planned-purchases",
		).length,
	).toBe(1);
	release(undefined);
	await expect(first).resolves.toBe(true);
});

it("fails on resource switch during the refresh, not just the request", async () => {
	const server = stubTestServer(undefined, seedPurchases());
	let releasePurchases!: (response: Response) => void;
	const purchasesGate = new Promise<Response>((resolve) => {
		releasePurchases = resolve;
	});
	server.holdPurchases(purchasesGate);
	const pending = saveNewPurchase(wish("desk"), 2);
	await vi.waitFor(() => {
		expect(
			server.calls.some(
				(call) => call.method === "GET" && call.url === "/v1/planned-purchases",
			),
		).toBe(true);
	});
	// The write persisted, but the authoritative reload now belongs to a
	// resource that is no longer current: no success, no stale notice.
	acceptOwnerResource("users/b");
	releasePurchases(
		ok({
			plannedPurchases: seedPurchases().plannedPurchases ?? [],
			revision: '"sha256-test"',
		}),
	);
	await expect(pending).resolves.toBe(false);
	expect(published.every((options) => options.type !== "success")).toBe(true);
	expect(published).toEqual([]);
});
