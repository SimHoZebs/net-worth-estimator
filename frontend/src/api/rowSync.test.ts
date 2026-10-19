import { describe, expect, it, vi } from "vitest";
import type {
	BackendAccount,
	BackendCheckpoint,
	BackendPosting,
	BackendRecurrenceRule,
	EvaluationInstance,
	FinancialModelDocument,
	RowWriteResponse,
} from "./contracts.ts";
import {
	applyRowOperations,
	diffFinancialModelDocuments,
	type RowOperation,
	type RowWriter,
} from "./rowSync.ts";

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
	Date: date,
	AccountId: accountId,
	Balance: balance,
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
			date: "2026-08-02",
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
	function writer() {
		const calls: RowOperation[] = [];
		const failWith: { error: Error | null } = { error: null };
		const record = <T>(
			operation: RowOperation,
			row: T = {} as T,
		): Error | RowWriteResponse<T> => {
			calls.push(operation);
			if (failWith.error) return failWith.error;
			return { row, issues: [], persisted: true, revision: "r1" };
		};
		const client = {
			createAccount: vi.fn(async (row: BackendAccount) =>
				record({ kind: "account", action: "create", row }, row),
			),
			updateAccount: vi.fn(async (id: string, row: BackendAccount) =>
				record({ kind: "account", action: "update", id, row }, row),
			),
			deleteAccount: vi.fn(async (id: string) =>
				record({ kind: "account", action: "delete", id }),
			),
			moveAccount: vi.fn(async (id: string, beforeId: string | null) =>
				record({ kind: "account", action: "move", id, beforeId }),
			),
			createPosting: vi.fn(async (row: BackendPosting) =>
				record({ kind: "posting", action: "create", row }, row),
			),
			updatePosting: vi.fn(async (id: string, row: BackendPosting) =>
				record({ kind: "posting", action: "update", id, row }, row),
			),
			deletePosting: vi.fn(async (id: string) =>
				record({ kind: "posting", action: "delete", id }),
			),
			movePosting: vi.fn(async (id: string, beforeId: string | null) =>
				record({ kind: "posting", action: "move", id, beforeId }),
			),
			createRule: vi.fn(async (row: BackendRecurrenceRule) =>
				record({ kind: "rule", action: "create", row }, row),
			),
			updateRule: vi.fn(async (id: string, row: BackendRecurrenceRule) =>
				record({ kind: "rule", action: "update", id, row }, row),
			),
			deleteRule: vi.fn(async (id: string) =>
				record({ kind: "rule", action: "delete", id }),
			),
			moveRule: vi.fn(async (id: string, beforeId: string | null) =>
				record({ kind: "rule", action: "move", id, beforeId }),
			),
			saveCheckpoint: vi.fn(async (row: BackendCheckpoint) =>
				record({ kind: "checkpoint", action: "save", row }, row),
			),
			deleteCheckpoint: vi.fn(async (accountId: string, date: string) =>
				record({ kind: "checkpoint", action: "delete", accountId, date }),
			),
			createEvaluation: vi.fn(
				async (row: EvaluationInstance, evaluationType: string) =>
					record(
						{ kind: "evaluation", action: "create", evaluationType, row },
						row,
					),
			),
			updateEvaluation: vi.fn(
				async (
					instanceId: string,
					row: EvaluationInstance,
					evaluationType: string,
				) =>
					record(
						{
							kind: "evaluation",
							action: "update",
							evaluationType,
							instanceId,
							row,
						},
						row,
					),
			),
			deleteEvaluation: vi.fn(async (instanceId: string) =>
				record({ kind: "evaluation", action: "delete", instanceId }),
			),
			moveEvaluation: vi.fn(
				async (
					evaluationType: string,
					instanceId: string,
					beforeId: string | null,
				) =>
					record({
						kind: "evaluation",
						action: "move",
						evaluationType,
						instanceId,
						beforeId,
					}),
			),
		} satisfies RowWriter;
		return { client, calls, failWith };
	}

	it("applies operations in order and reports success", async () => {
		const { client, calls } = writer();
		const operations: RowOperation[] = [
			{ kind: "account", action: "create", row: account("a") },
			{ kind: "account", action: "move", id: "a", beforeId: null },
		];
		const result = await applyRowOperations(client, operations);
		expect(result).toEqual({ ok: true, issues: [] });
		expect(calls).toEqual(operations);
		expect(client.createAccount).toHaveBeenCalledOnce();
	});

	it("stops at the first transport error", async () => {
		const { client, calls, failWith } = writer();
		failWith.error = new Error("boom");
		const operations: RowOperation[] = [
			{ kind: "account", action: "create", row: account("a") },
			{ kind: "account", action: "create", row: account("b") },
		];
		const result = await applyRowOperations(client, operations);
		expect(result).toBe(failWith.error);
		expect(calls).toHaveLength(1);
	});

	it("stops at the first rejected write and returns issues", async () => {
		const { client } = writer();
		client.createAccount.mockResolvedValueOnce({
			row: account("a"),
			issues: [{ severity: "error", code: "x", message: "bad", path: [] }],
			persisted: false,
			revision: "r0",
		});
		const operations: RowOperation[] = [
			{ kind: "account", action: "create", row: account("a") },
			{ kind: "account", action: "create", row: account("b") },
		];
		const result = await applyRowOperations(client, operations);
		expect(result).toEqual({
			ok: false,
			issues: [{ severity: "error", code: "x", message: "bad", path: [] }],
		});
		expect(client.createAccount).toHaveBeenCalledTimes(1);
	});
});
