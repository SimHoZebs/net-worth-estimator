import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	BackendAccount,
	BackendCheckpoint,
	BackendPlannedPurchase,
	BackendPosting,
	FinancialModel,
} from "@/api/contracts.ts";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	suspendUserScope,
} from "@/auth/resourceScope.ts";
import {
	applyRowOperations,
	diffFinancialModels,
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

const emptyModel = (): FinancialModel => ({
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

describe("diffFinancialModels", () => {
	it("returns no operations for identical models", () => {
		const model: FinancialModel = {
			...emptyModel(),
			accounts: [account("a")],
			postings: [posting("p")],
		};
		expect(diffFinancialModels(structuredClone(model), model)).toEqual([]);
	});

	it("emits creates, updates, deletes, and moves per collection", () => {
		const base: FinancialModel = {
			...emptyModel(),
			accounts: [account("keep"), account("rename"), account("drop")],
			postings: [posting("p1"), posting("p2")],
		};
		const next: FinancialModel = {
			...emptyModel(),
			accounts: [account("rename", "Renamed"), account("keep"), account("new")],
			postings: [posting("p2"), posting("p1")],
		};
		const operations = diffFinancialModels(base, next);
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
		const base: FinancialModel = {
			...emptyModel(),
			checkpoints: [
				checkpoint("a", "2026-08-01", 100),
				checkpoint("a", "2026-08-02", 50),
			],
		};
		const next: FinancialModel = {
			...emptyModel(),
			checkpoints: [checkpoint("a", "2026-08-01", 150)],
		};
		const operations = diffFinancialModels(base, next);
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
		const base: FinancialModel = {
			...emptyModel(),
			evaluations: {
				...emptyModel().evaluations,
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
		const next: FinancialModel = {
			...emptyModel(),
			evaluations: {
				...emptyModel().evaluations,
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
		const operations = diffFinancialModels(base, next);
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
	it("diffs planned purchases and uses their dedicated endpoints", async () => {
		const base: FinancialModel = {
			...emptyModel(),
			plannedPurchases: [
				plannedPurchase("keep", 0),
				plannedPurchase("drop", 1),
			],
		};
		const next: FinancialModel = {
			...emptyModel(),
			plannedPurchases: [
				{ ...plannedPurchase("keep", 1), cost: 75 },
				plannedPurchase("new", 0),
			],
		};
		const operations = diffFinancialModels(base, next);
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
		expect(urls).toContain("/v1/planned-purchases");
		expect(urls).toContain("/v1/planned-purchases/reorder");
		expect(urls.some((url) => url.startsWith("/v1/planned-purchases/"))).toBe(
			true,
		);
		expect(urls.some((url) => url.startsWith("/v1/postings"))).toBe(false);
		const create = seen.find(
			(call) =>
				call.url === "/v1/planned-purchases" && call.init?.method === "POST",
		);
		expect(JSON.parse(String(create?.init?.body))).toMatchObject({
			priority: 0,
			fundingAccountId: "a",
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
