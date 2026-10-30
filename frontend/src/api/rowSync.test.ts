import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	BackendAccount,
	BackendCheckpoint,
	BackendPlannedPurchase,
	BackendPosting,
	FinancialModelDocument,
} from "@/api/contracts.ts";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	suspendUserScope,
} from "@/auth/resourceScope.ts";
import {
	applyRowOperations,
	diffFinancialModelDocuments,
	type RowOperation,
} from "@/api/rowSync.ts";
import { ok } from "@/mocks/fetch.ts";
import { ApiNetworkError } from "@/api/http.ts";

const account = (id: string, name = id): BackendAccount => ({
	id,
	name,
	kind: "cash",
	minBalance: null,
	maxBalance: null,
	color: null,
	enabled: true,
});

const checkpoint = (
	accountId: string,
	date: string,
	balance: number,
): BackendCheckpoint => ({
	AccountId: accountId,
	Balance: balance,
	observedAt: Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) + 86399,
});

const plannedPurchase = (
	id: string,
	priority: number,
): BackendPlannedPurchase => ({
	id,
	name: id,
	fundingAccountId: "a",
	cost: 50,
	earliestDate: "2026-09-01",
	enabled: true,
	priority,
});

const posting = (id: string, name = id): BackendPosting => ({
	id,
	name,
	sourceAccountId: null,
	destinations: null,
	amount: { resolver: "expression", config: { expression: "10" }, inputs: {} },
	postedTime: 1785542400,
	transactionTime: 1785542400,
	enabled: true,
});

const emptyDocument = (): FinancialModelDocument => ({
	sourcePath: "",
	accounts: [],
	checkpoints: [],
	evaluations: {
		financialIndependence: [],
		netWorthThreshold: [],
		accountBalance: [],
		postingFulfillment: [],
		cycleFulfillment: [],
	},
	postings: [],
	recurrenceRules: [],
	plannedPurchases: [],
});

describe("diffFinancialModelDocuments", () => {
	it("returns no operations for identical documents", () => {
		const document: FinancialModelDocument = {
			...emptyDocument(),
			accounts: [account("a")],
			postings: [posting("p")],
		};
		expect(
			diffFinancialModelDocuments(structuredClone(document), document),
		).toEqual([]);
	});

	it("emits creates, updates, deletes, and moves per collection", () => {
		const base: FinancialModelDocument = {
			...emptyDocument(),
			accounts: [account("keep"), account("rename"), account("drop")],
			postings: [posting("p1"), posting("p2")],
		};
		const next: FinancialModelDocument = {
			...emptyDocument(),
			accounts: [account("rename", "Renamed"), account("keep"), account("new")],
			postings: [posting("p2"), posting("p1")],
		};
		const operations = diffFinancialModelDocuments(base, next);
		const kinds = operations.map(
			(operation) => `${operation.kind}:${operation.action}`,
		);
		expect(kinds).toContain("account:create");
		expect(kinds).toContain("account:update");
		expect(kinds).toContain("account:delete");
		expect(kinds).toContain("account:move");
		const created = operations.find(
			(operation): operation is Extract<RowOperation, { action: "create" }> =>
				operation.action === "create" && operation.kind === "account",
		);
		expect(created?.row).toMatchObject({ id: "new" });
		const moves = operations.filter((operation) => operation.action === "move");
		expect(moves.length).toBeGreaterThan(0);
	});

	it("upserts changed checkpoints and deletes removed ones", () => {
		const base: FinancialModelDocument = {
			...emptyDocument(),
			checkpoints: [
				checkpoint("a", "2026-08-01", 100),
				checkpoint("a", "2026-08-02", 50),
			],
		};
		const next: FinancialModelDocument = {
			...emptyDocument(),
			checkpoints: [checkpoint("a", "2026-08-01", 150)],
		};
		const operations = diffFinancialModelDocuments(base, next);
		expect(operations).toContainEqual({
			kind: "checkpoint",
			action: "save",
			row: checkpoint("a", "2026-08-01", 150),
		});
		expect(operations).toContainEqual({
			kind: "checkpoint",
			action: "delete",
			accountId: "a",
			observedAt: 1785715199,
		});
	});

	it("diffs evaluation tables by instance id", () => {
		const base: FinancialModelDocument = {
			...emptyDocument(),
			evaluations: {
				...emptyDocument().evaluations,
				netWorthThreshold: [
					{
						instanceId: "t1",
						name: "T1",
						enabled: true,
						config: { target: 1 },
					},
				],
			},
		};
		const next: FinancialModelDocument = {
			...emptyDocument(),
			evaluations: {
				...emptyDocument().evaluations,
				netWorthThreshold: [
					{
						instanceId: "t1",
						name: "T1x",
						enabled: true,
						config: { target: 1 },
					},
					{
						instanceId: "t2",
						name: "T2",
						enabled: true,
						config: { target: 2 },
					},
				],
			},
		};
		const operations = diffFinancialModelDocuments(base, next);
		expect(operations).toContainEqual({
			kind: "evaluation",
			action: "update",
			evaluationType: "netWorthThreshold",
			instanceId: "t1",
			row: {
				instanceId: "t1",
				name: "T1x",
				enabled: true,
				config: { target: 1 },
			},
		});
		expect(operations).toContainEqual({
			kind: "evaluation",
			action: "create",
			evaluationType: "netWorthThreshold",
			row: {
				instanceId: "t2",
				name: "T2",
				enabled: true,
				config: { target: 2 },
			},
		});
	});
});

describe("applyRowOperations", () => {
	it("diffs planned purchases with moves and translates writes to legacy postings", async () => {
		const base: FinancialModelDocument = {
			...emptyDocument(),
			plannedPurchases: [
				plannedPurchase("keep", 0),
				plannedPurchase("drop", 1),
			],
		};
		const next: FinancialModelDocument = {
			...emptyDocument(),
			plannedPurchases: [
				{ ...plannedPurchase("keep", 1), cost: 75 },
				plannedPurchase("new", 0),
			],
		};
		const operations = diffFinancialModelDocuments(base, next);
		const kinds = operations.map(
			(operation) => `${operation.kind}:${operation.action}`,
		);
		expect(kinds).toContain("plannedPurchase:create");
		expect(kinds).toContain("plannedPurchase:update");
		expect(kinds).toContain("plannedPurchase:delete");
		expect(kinds).toContain("plannedPurchase:move");
		const seen = stubFetch(() =>
			ok({
				row: posting("new"),
				issues: [],
				persisted: true,
				revision: "r1",
			}),
		);
		const result = await applyRowOperations(operations);
		expect(result).toEqual({ ok: true, issues: [] });
		const urls = seen.map((call) => call.url);
		// Compat shim: standalone rows persist through legacy posting calls.
		expect(urls).toContain("/v1/postings");
		expect(urls).toContain("/v1/postings/reorder");
		expect(urls.some((url) => url.startsWith("/v1/postings/"))).toBe(true);
		const create = seen.find(
			(call) => call.url === "/v1/postings" && call.init?.method === "POST",
		);
		expect(JSON.parse(String(create?.init?.body))).toMatchObject({
			purchase: { priority: 0 },
			sourceAccountId: "a",
		});
	});

	const scopeId = `users/${"a".repeat(64)}`;
	beforeEach(() => {
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
	afterEach(() => {
		suspendUserScope();
		vi.unstubAllGlobals();
	});

	function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
		const seen: { url: string; init?: RequestInit }[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown, init?: RequestInit) => {
				seen.push({ url: String(url), init });
				return handler(String(url), init);
			}),
		);
		return seen;
	}

	it("applies operations in order and reports success", async () => {
		const seen = stubFetch(() =>
			ok({
				row: account("a"),
				issues: [],
				persisted: true,
				revision: "r1",
			}),
		);
		const operations: RowOperation[] = [
			{ kind: "account", action: "create", row: account("a") },
			{ kind: "account", action: "move", id: "a", beforeId: null },
		];
		const result = await applyRowOperations(operations);
		expect(result).toEqual({ ok: true, issues: [] });
		expect(seen.map((call) => call.url)).toEqual([
			"/v1/accounts",
			"/v1/accounts/reorder",
		]);
		expect(seen[0]?.init?.method).toBe("POST");
		expect(seen[1]?.init?.method).toBe("POST");
		expect(JSON.parse(String(seen[1]?.init?.body))).toEqual({
			id: "a",
			beforeId: "",
		});
		expect(new Headers(seen[0]?.init?.headers).get("Waypoint-Resource")).toBe(
			scopeId,
		);
	});

	it("stops at the first transport error", async () => {
		const seen = stubFetch(() => {
			throw new TypeError("Failed to fetch");
		});
		const operations: RowOperation[] = [
			{ kind: "account", action: "create", row: account("a") },
			{ kind: "account", action: "create", row: account("b") },
		];
		const result = await applyRowOperations(operations);
		expect(result).toBeInstanceOf(ApiNetworkError);
		expect(seen).toHaveLength(1);
	});

	it("stops at the first rejected write and returns issues", async () => {
		const seen = stubFetch(() =>
			ok({
				row: account("a"),
				issues: [{ severity: "error", code: "x", message: "bad", path: [] }],
				persisted: false,
				revision: "r0",
			}),
		);
		const operations: RowOperation[] = [
			{ kind: "account", action: "create", row: account("a") },
			{ kind: "account", action: "create", row: account("b") },
		];
		const result = await applyRowOperations(operations);
		expect(result).toEqual({
			ok: false,
			issues: [{ severity: "error", code: "x", message: "bad", path: [] }],
		});
		expect(seen).toHaveLength(1);
	});

	it("skips network access for an aborted save", async () => {
		const seen = stubFetch(() => ok({}));
		const operations: RowOperation[] = [
			{ kind: "account", action: "create", row: account("a") },
		];
		const controller = new AbortController();
		controller.abort();
		const result = await applyRowOperations(operations, {
			signal: controller.signal,
		});
		expect(result).toEqual({ ok: true, issues: [] });
		expect(seen).toHaveLength(0);
	});
});
