import { describe, expect, test } from "vitest";
import type { Account, Evaluation, Transaction } from "../domain/model.ts";
import {
	editorUrl,
	evidenceUrl,
	findAccount,
	groupUrl,
	pageUrl,
	parseUrl,
	resolveOverlayRoute,
	slugifyAccount,
	safeSpendingDetailUrl,
} from "./route.ts";

function account(id: string, name: string, archived = false): Account {
	return {
		id,
		name,
		kind: "cash",
		enabled: true,
		archived,
		balance: 100,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-01-31",
		balanceCheck: false,
		source: "test",
		readOnly: false,
	};
}

function transaction(id: string): Transaction {
	return {
		id,
		name: id,
		amount: 10,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		kind: "schedule",
		startDate: "2026-02-01",
		endDate: null,
		annualIncrease: 0,
		enabled: true,
		readOnly: false,
		claimScheduleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
		void: false,
	};
}

function evaluation(id: string): Evaluation {
	return {
		id,
		name: id,
		kind: "net-worth",
		target: 1000,
		accountId: null,
		enabled: true,
	};
}

const investTransaction = transaction("invest");
const goalEvaluation = evaluation("goal-1");

const model = {
	accounts: [
		account("checking", "Everyday checking"),
		account("savings", "Investment portfolio"),
		account("old", "Old account", true),
		account("new", "New", true),
	],
	transactions: [investTransaction],
	evaluations: [goalEvaluation],
};

describe("parseUrl", () => {
	test("page-only URLs resolve to their page", () => {
		expect(parseUrl("")).toEqual({ page: "outlook", overlay: null });
		expect(parseUrl("/")).toEqual({ page: "outlook", overlay: null });
		expect(parseUrl("/outlook")).toEqual({ page: "outlook", overlay: null });
		expect(parseUrl("/accounts")).toEqual({
			page: "accounts",
			overlay: null,
		});
	});

	test("planned purchases has a direct page route", () => {
		expect(parseUrl("/purchases")).toEqual({
			page: "purchases",
			overlay: null,
		});
		expect(pageUrl("purchases")).toBe("/purchases");
	});

	test("group detail is a query overlay on the groups page", () => {
		expect(parseUrl("/groups?group=abc-123")).toEqual({
			page: "groups",
			overlay: { type: "group", key: "abc-123" },
		});
		expect(groupUrl("abc-123")).toBe("/groups?group=abc-123");
		expect(
			resolveOverlayRoute(
				{ page: "groups", overlay: { type: "group", key: "abc-123" } },
				null,
			),
		).toEqual({ state: "ready", overlay: { kind: "group", id: "abc-123" } });
	});

	test("unknown pages fall back to outlook with an invalid overlay", () => {
		expect(parseUrl("/nope")).toEqual({
			page: "outlook",
			overlay: { type: "invalid" },
		});
		expect(parseUrl("/accounts/extra")).toEqual({
			page: "outlook",
			overlay: { type: "invalid" },
		});
	});

	test("account evidence parses on accounts and transactions pages", () => {
		expect(parseUrl("/accounts?account=checking")).toEqual({
			page: "accounts",
			overlay: { type: "account", key: "checking" },
		});
		expect(parseUrl("/transactions?account=checking")).toEqual({
			page: "transactions",
			overlay: { type: "account", key: "checking" },
		});
	});

	test("editors parse as query parameters", () => {
		expect(parseUrl("/accounts?edit-account=new")).toEqual({
			page: "accounts",
			overlay: { type: "accountEdit", key: "new" },
		});
		expect(parseUrl("/accounts?edit-account=checking")).toEqual({
			page: "accounts",
			overlay: { type: "accountEdit", key: "checking" },
		});
		expect(parseUrl("/transactions?edit-transaction=invest")).toEqual({
			page: "transactions",
			overlay: { type: "transactionEdit", key: "invest" },
		});
		expect(parseUrl("/outlook?edit-transaction=invest")).toEqual({
			page: "outlook",
			overlay: { type: "transactionEdit", key: "invest" },
		});
		expect(parseUrl("/accounts?edit-transaction=new")).toEqual({
			page: "accounts",
			overlay: { type: "transactionEdit", key: "new" },
		});
		expect(parseUrl("/outlook?edit-account=new")).toEqual({
			page: "outlook",
			overlay: { type: "accountEdit", key: "new" },
		});
		expect(parseUrl("/evaluations?edit-evaluation=goal-1")).toEqual({
			page: "evaluations",
			overlay: { type: "evaluationEdit", key: "goal-1" },
		});
		expect(parseUrl("/outlook?edit-evaluation=goal-1")).toEqual({
			page: "outlook",
			overlay: { type: "evaluationEdit", key: "goal-1" },
		});
		expect(parseUrl("/transactions?edit-schedule=new")).toEqual({
			page: "transactions",
			overlay: { type: "scheduleEdit", key: "new" },
		});
		expect(parseUrl("/accounts?edit-schedule=new")).toEqual({
			page: "accounts",
			overlay: { type: "scheduleEdit", key: "new" },
		});
	});

	test("outlook evidence and safe spending detail parse", () => {
		expect(parseUrl("/outlook?evidence=position")).toEqual({
			page: "outlook",
			overlay: { type: "position" },
		});
		expect(parseUrl("/outlook?evidence=shortfall")).toEqual({
			page: "outlook",
			overlay: { type: "shortfall" },
		});
		expect(parseUrl("/outlook?evidence=safe-spending")).toEqual({
			page: "outlook",
			overlay: { type: "safe-spending" },
		});
		expect(parseUrl("/outlook?detail=cycle")).toEqual({
			page: "outlook",
			overlay: { type: "safeSpendingDetail", tab: "cycle" },
		});
		expect(parseUrl("/outlook?detail=last-cycle")).toEqual({
			page: "outlook",
			overlay: { type: "safeSpendingDetail", tab: "last-cycle" },
		});
		expect(parseUrl("/outlook?detail=configure")).toEqual({
			page: "outlook",
			overlay: { type: "safeSpendingDetail", tab: "configure" },
		});
		expect(parseUrl("/outlook?detail=cycle&edit-transaction=invest")).toEqual({
			page: "outlook",
			overlay: {
				type: "safeSpendingDetail",
				tab: "cycle",
				editTransaction: "invest",
			},
		});
		expect(parseUrl("/outlook?detail=bogus")).toEqual({
			page: "outlook",
			overlay: { type: "invalid" },
		});
		expect(parseUrl("/accounts?detail=cycle")).toEqual({
			page: "accounts",
			overlay: { type: "safeSpendingDetail", tab: "cycle" },
		});
	});

	test("malformed overlays are invalid rather than silently dropped", () => {
		expect(parseUrl("/sources?account=checking")?.overlay).toEqual({
			type: "invalid",
		});
		expect(parseUrl("/accounts?account=")?.overlay).toEqual({
			type: "invalid",
		});
		expect(parseUrl("/accounts?group=g1")?.overlay).toEqual({
			type: "invalid",
		});
		expect(parseUrl("/accounts?account=a&evidence=position")?.overlay).toEqual({
			type: "invalid",
		});
		expect(parseUrl("/accounts?account=a&account=b")?.overlay).toEqual({
			type: "invalid",
		});
		expect(parseUrl("/accounts/%E0%A4%A")?.overlay).toEqual({
			type: "invalid",
		});
	});

	test("unrelated search parameters are ignored", () => {
		expect(parseUrl("/accounts?gmail=connected")).toEqual({
			page: "accounts",
			overlay: null,
		});
		expect(parseUrl("/accounts?account=checking&gmail=connected")).toEqual({
			page: "accounts",
			overlay: { type: "account", key: "checking" },
		});
	});
});

describe("slugifyAccount and findAccount", () => {
	test("names slugify to URL-safe segments", () => {
		expect(slugifyAccount("Everyday checking")).toBe("everyday-checking");
		expect(slugifyAccount("  Travel_savings!! ")).toBe("travel-savings");
	});

	test("exact ids win over slugs and archived accounts hide", () => {
		expect(findAccount(model, "checking")?.id).toBe("checking");
		expect(findAccount(model, "everyday-checking")?.id).toBe("checking");
		expect(findAccount(model, "Everyday-Checking")?.id).toBe("checking");
		expect(findAccount(model, "old")).toBeUndefined();
		expect(findAccount(model, "nope")).toBeUndefined();
	});
});

describe("resolveOverlayRoute", () => {
	test("account routes resolve without transaction or evaluation queries", () => {
		expect(
			resolveOverlayRoute(parseUrl("/accounts?account=checking"), {
				accounts: model.accounts,
				transactions: null,
				evaluations: null,
			}),
		).toMatchObject({
			state: "ready",
			overlay: {
				kind: "evidence",
				target: { kind: "account", id: "checking" },
			},
		});
	});

	test("transaction routes wait for their rows, not evaluation rows", () => {
		const route = parseUrl("/transactions?edit-transaction=invest");
		expect(
			resolveOverlayRoute(route, {
				accounts: [],
				transactions: null,
				evaluations: [],
			}),
		).toEqual({ state: "pending" });
		expect(
			resolveOverlayRoute(route, {
				accounts: null,
				transactions: model.transactions,
				evaluations: null,
			}),
		).toMatchObject({ state: "ready", overlay: { kind: "editor" } });
	});

	test("no overlay resolves to none, even without a model", () => {
		expect(
			resolveOverlayRoute({ page: "accounts", overlay: null }, null),
		).toEqual({
			state: "none",
		});
	});

	test("overlays wait for the model instead of failing", () => {
		expect(
			resolveOverlayRoute(
				{
					page: "accounts",
					overlay: { type: "account", key: "checking" },
				},
				null,
			),
		).toEqual({ state: "pending" });
	});

	test("invalid shapes resolve to unknown even without a model", () => {
		expect(
			resolveOverlayRoute(
				{ page: "outlook", overlay: { type: "invalid" } },
				null,
			),
		).toEqual({
			state: "unknown",
		});
	});

	test("account evidence resolves by id or slug", () => {
		expect(
			resolveOverlayRoute(
				{
					page: "accounts",
					overlay: { type: "account", key: "everyday-checking" },
				},
				model,
			),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "evidence",
				target: { kind: "account", id: "checking" },
			},
		});
		expect(
			resolveOverlayRoute(
				{ page: "accounts", overlay: { type: "account", key: "nope" } },
				model,
			),
		).toEqual({ state: "unknown" });
		expect(
			resolveOverlayRoute(
				{ page: "accounts", overlay: { type: "account", key: "old" } },
				model,
			),
		).toEqual({ state: "unknown" });
	});

	test("an account named New is evidence, not the new-account editor", () => {
		// Query parameters namespace the editor, so `account=new` is the
		// archived account named "New" and `edit-account=new` is creation.
		expect(
			resolveOverlayRoute(
				{ page: "accounts", overlay: { type: "account", key: "new" } },
				model,
			),
		).toEqual({ state: "unknown" });
		expect(parseUrl("/accounts?account=new")).toEqual({
			page: "accounts",
			overlay: { type: "account", key: "new" },
		});
		expect(parseUrl("/accounts?edit-account=new")).toEqual({
			page: "accounts",
			overlay: { type: "accountEdit", key: "new" },
		});
	});

	test("editors resolve existing items and the new form", () => {
		expect(
			resolveOverlayRoute(
				{
					page: "transactions",
					overlay: { type: "transactionEdit", key: "invest" },
				},
				model,
			),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "transaction", item: investTransaction },
			},
		});
		expect(
			resolveOverlayRoute(
				{
					page: "transactions",
					overlay: { type: "transactionEdit", key: "missing" },
				},
				model,
			),
		).toEqual({ state: "unknown" });
		expect(
			resolveOverlayRoute(
				{
					page: "transactions",
					overlay: { type: "scheduleEdit", key: "new" },
				},
				{ accounts: [], transactions: [], evaluations: [] },
			),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "schedule", item: null },
			},
		});

		expect(
			resolveOverlayRoute(
				{
					page: "transactions",
					overlay: { type: "evaluationEdit", key: "new" },
				},
				model,
			),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "evaluation", item: null },
			},
		});
	});

	test("unknown schedule ids do not resolve", () => {
		expect(
			resolveOverlayRoute(
				{
					page: "transactions",
					overlay: { type: "scheduleEdit", key: "invest" },
				},
				model,
			),
		).toEqual({ state: "unknown" });
	});

	test("outlook account evidence resolves by id or slug", () => {
		expect(
			resolveOverlayRoute(
				parseUrl("/outlook?account=everyday-checking"),
				model,
			),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "evidence",
				target: { kind: "account", id: "checking" },
			},
		});
		expect(
			resolveOverlayRoute(parseUrl("/outlook?account=nope"), model),
		).toEqual({
			state: "unknown",
		});
	});

	test("safe spending detail resolves with and without a stacked editor", () => {
		expect(
			resolveOverlayRoute(
				{
					page: "outlook",
					overlay: { type: "safeSpendingDetail", tab: "cycle" },
				},
				model,
			),
		).toEqual({
			state: "ready",
			overlay: { kind: "safeSpendingDetail", tab: "cycle", edit: null },
		});
		const stacked = resolveOverlayRoute(
			{
				page: "outlook",
				overlay: {
					type: "safeSpendingDetail",
					tab: "cycle",
					editTransaction: "invest",
				},
			},
			model,
		);
		expect(stacked).toEqual({
			state: "ready",
			overlay: {
				kind: "safeSpendingDetail",
				tab: "cycle",
				edit: { kind: "transaction", item: investTransaction },
			},
		});
		expect(
			resolveOverlayRoute(
				{
					page: "outlook",
					overlay: {
						type: "safeSpendingDetail",
						tab: "cycle",
						editTransaction: "missing",
					},
				},
				model,
			),
		).toEqual({ state: "unknown" });
	});
});

describe("URL builders round-trip through the parser", () => {
	test("page URLs stay canonical", () => {
		expect(pageUrl("accounts")).toBe("/accounts");
	});

	test("account evidence prefers slugs", () => {
		expect(
			evidenceUrl("accounts", { kind: "account", id: "checking" }, model),
		).toBe("/accounts?account=everyday-checking");
		expect(
			evidenceUrl("outlook", { kind: "account", id: "checking" }, model),
		).toBe("/outlook?account=everyday-checking");
		// Without resolved rows the id keeps the link unambiguous.
		expect(
			evidenceUrl("accounts", { kind: "account", id: "checking" }, null),
		).toBe("/accounts?account=checking");
		expect(
			parseUrl(
				evidenceUrl("accounts", { kind: "account", id: "checking" }, model),
			),
		).toEqual({
			page: "accounts",
			overlay: { type: "account", key: "everyday-checking" },
		});
	});

	test("editors serialize as query parameters", () => {
		expect(
			editorUrl("transactions", {
				kind: "transaction",
				item: investTransaction,
			}),
		).toBe("/transactions?edit-transaction=invest");
		expect(
			editorUrl("outlook", { kind: "transaction", item: investTransaction }),
		).toBe("/outlook?edit-transaction=invest");
		expect(editorUrl("transactions", { kind: "transaction", item: null })).toBe(
			"/transactions?edit-transaction=new",
		);
		expect(editorUrl("accounts", { kind: "schedule", item: null })).toBe(
			"/accounts?edit-schedule=new",
		);
		expect(
			parseUrl(editorUrl("transactions", { kind: "schedule", item: null })),
		).toEqual({
			page: "transactions",
			overlay: { type: "scheduleEdit", key: "new" },
		});
		expect(editorUrl("accounts", { kind: "account", item: null })).toBe(
			"/accounts?edit-account=new",
		);
		expect(
			editorUrl("evaluations", {
				kind: "evaluation",
				item: goalEvaluation,
			}),
		).toBe("/evaluations?edit-evaluation=goal-1");
		expect(
			parseUrl(
				editorUrl("outlook", { kind: "transaction", item: investTransaction }),
			),
		).toEqual({
			page: "outlook",
			overlay: { type: "transactionEdit", key: "invest" },
		});
		// Query parameters namespace the editor, so an account named
		// "Edit Transaction" still deep-links by slug and resolves.
		const reserved = account("move-1", "Edit Transaction");
		expect(editorUrl("accounts", { kind: "account", item: reserved })).toBe(
			"/accounts?edit-account=edit-transaction",
		);
		expect(
			resolveOverlayRoute(
				parseUrl(editorUrl("accounts", { kind: "account", item: reserved })),
				{
					...model,
					accounts: [reserved],
				},
			),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "account", item: reserved },
			},
		});
	});

	test("safe spending detail round-trips", () => {
		expect(
			parseUrl(safeSpendingDetailUrl("outlook", "last-cycle", "invest")),
		).toEqual({
			page: "outlook",
			overlay: {
				type: "safeSpendingDetail",
				tab: "last-cycle",
				editTransaction: "invest",
			},
		});
		expect(safeSpendingDetailUrl("outlook", "cycle")).toBe(
			"/outlook?detail=cycle",
		);
		expect(safeSpendingDetailUrl("outlook", "cycle", "invest")).toBe(
			"/outlook?detail=cycle&edit-transaction=invest",
		);
		expect(
			parseUrl(safeSpendingDetailUrl("outlook", "cycle", "invest")),
		).toEqual({
			page: "outlook",
			overlay: {
				type: "safeSpendingDetail",
				tab: "cycle",
				editTransaction: "invest",
			},
		});
	});

	test("names with special characters survive the round trip", () => {
		const special = {
			...model,
			accounts: [account("a1", "Café & Sons!")],
		};
		const url = evidenceUrl("accounts", { kind: "account", id: "a1" }, special);
		expect(parseUrl(url)).toEqual({
			page: "accounts",
			overlay: { type: "account", key: "caf-sons" },
		});
		expect(resolveOverlayRoute(parseUrl(url), special)).toEqual({
			state: "ready",
			overlay: { kind: "evidence", target: { kind: "account", id: "a1" } },
		});
	});
});
