import { describe, expect, test } from "vitest";
import type { Account, Evaluation, Transaction } from "../domain/model.ts";
import {
	editorPath,
	evidencePath,
	findAccount,
	groupPath,
	pagePath,
	parseRoute,
	resolveOverlayRoute,
	slugifyAccount,
	safeSpendingDetailPath,
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

describe("parseRoute", () => {
	test("page-only paths resolve to their page", () => {
		expect(parseRoute("/")).toEqual({ page: "outlook", overlay: null });
		expect(parseRoute("/accounts")).toEqual({
			page: "accounts",
			overlay: null,
		});
	});

	test("planned purchases has a direct page route", () => {
		expect(parseRoute("/purchases")).toEqual({
			page: "purchases",
			overlay: null,
		});
		expect(pagePath("purchases")).toBe("/purchases");
	});

	test("group detail is a nested groups path", () => {
		expect(parseRoute("/groups/abc-123")).toEqual({
			page: "groups",
			overlay: { type: "group", key: "abc-123" },
		});
		expect(groupPath("abc-123")).toBe("/groups/abc-123");
		expect(
			resolveOverlayRoute(
				{ page: "groups", overlay: { type: "group", key: "abc-123" } },
				null,
			),
		).toEqual({ state: "ready", overlay: { kind: "group", id: "abc-123" } });
	});

	test("unknown pages fall back to outlook with an invalid overlay", () => {
		expect(parseRoute("/nope")).toEqual({
			page: "outlook",
			overlay: { type: "invalid" },
		});
	});

	test("account evidence parses on accounts and transactions pages", () => {
		expect(parseRoute("/accounts?evidence=account&id=checking")).toEqual({
			page: "accounts",
			overlay: { type: "account", key: "checking" },
		});
		expect(parseRoute("/transactions?evidence=account&id=checking")).toEqual({
			page: "transactions",
			overlay: { type: "account", key: "checking" },
		});
	});

	test("editors parse as query params on any page", () => {
		expect(parseRoute("/accounts?editor=account&id=new")).toEqual({
			page: "accounts",
			overlay: { type: "accountEdit", key: "new" },
		});
		expect(parseRoute("/accounts?editor=account&id=checking")).toEqual({
			page: "accounts",
			overlay: { type: "accountEdit", key: "checking" },
		});
		expect(parseRoute("/transactions?editor=transaction&id=invest")).toEqual({
			page: "transactions",
			overlay: { type: "transactionEdit", key: "invest" },
		});
		expect(parseRoute("/outlook?editor=transaction&id=invest")).toEqual({
			page: "outlook",
			overlay: { type: "transactionEdit", key: "invest" },
		});
		expect(parseRoute("/accounts?editor=transaction&id=new")).toEqual({
			page: "accounts",
			overlay: { type: "transactionEdit", key: "new" },
		});
		expect(parseRoute("/outlook?editor=account&id=new")).toEqual({
			page: "outlook",
			overlay: { type: "accountEdit", key: "new" },
		});
		expect(parseRoute("/evaluations?editor=evaluation&id=goal-1")).toEqual({
			page: "evaluations",
			overlay: { type: "evaluationEdit", key: "goal-1" },
		});
		expect(parseRoute("/outlook?editor=evaluation&id=goal-1")).toEqual({
			page: "outlook",
			overlay: { type: "evaluationEdit", key: "goal-1" },
		});
		expect(parseRoute("/transactions?editor=schedule&id=new")).toEqual({
			page: "transactions",
			overlay: { type: "scheduleEdit", key: "new" },
		});
		expect(parseRoute("/accounts?editor=schedule&id=new")).toEqual({
			page: "accounts",
			overlay: { type: "scheduleEdit", key: "new" },
		});
	});

	test("outlook evidence and safe spending detail parse", () => {
		expect(parseRoute("/outlook?evidence=position")).toEqual({
			page: "outlook",
			overlay: { type: "position" },
		});
		expect(parseRoute("/outlook?evidence=shortfall")).toEqual({
			page: "outlook",
			overlay: { type: "shortfall" },
		});
		expect(parseRoute("/outlook?evidence=safe-spending")).toEqual({
			page: "outlook",
			overlay: { type: "safe-spending" },
		});
		expect(parseRoute("/outlook?detail=safe-spending")).toEqual({
			page: "outlook",
			overlay: { type: "safeSpendingDetail", tab: "cycle" },
		});
		expect(parseRoute("/outlook?detail=safe-spending&tab=cycle")).toEqual({
			page: "outlook",
			overlay: { type: "safeSpendingDetail", tab: "cycle" },
		});
		expect(parseRoute("/outlook?detail=safe-spending&tab=last-cycle")).toEqual({
			page: "outlook",
			overlay: { type: "safeSpendingDetail", tab: "last-cycle" },
		});
		expect(
			parseRoute(
				"/outlook?detail=safe-spending&tab=cycle&editTransaction=invest",
			),
		).toEqual({
			page: "outlook",
			overlay: {
				type: "safeSpendingDetail",
				tab: "cycle",
				editTransaction: "invest",
			},
		});
		expect(parseRoute("/outlook?detail=safe-spending&tab=bogus")).toEqual({
			page: "outlook",
			overlay: { type: "invalid" },
		});
		expect(parseRoute("/accounts?detail=safe-spending")).toEqual({
			page: "accounts",
			overlay: { type: "safeSpendingDetail", tab: "cycle" },
		});
	});

	test("unrelated query params are ignored", () => {
		expect(parseRoute("/accounts?gmail=connected")).toEqual({
			page: "accounts",
			overlay: null,
		});
	});

	test("malformed overlays are invalid rather than silently dropped", () => {
		expect(parseRoute("/accounts/a/b")?.overlay).toEqual({
			type: "invalid",
		});
		expect(parseRoute("/sources/checking")?.overlay).toEqual({
			type: "invalid",
		});
		expect(parseRoute("/sources?editor=account&id=new")?.page).toBe("sources");
		expect(parseRoute("/accounts?evidence=account")?.overlay).toEqual({
			type: "invalid",
		});
		expect(parseRoute("/accounts?editor=transaction")?.overlay).toEqual({
			type: "invalid",
		});
		expect(parseRoute("/accounts?id=checking")?.overlay).toEqual({
			type: "invalid",
		});
		expect(
			parseRoute("/accounts?evidence=position&editor=transaction&id=invest")
				?.overlay,
		).toEqual({ type: "invalid" });
		expect(parseRoute("/accounts/%E0%A4%A")?.overlay).toEqual({
			type: "invalid",
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
			resolveOverlayRoute(
				parseRoute("/accounts?evidence=account&id=checking"),
				{
					accounts: model.accounts,
					transactions: null,
					evaluations: null,
				},
			),
		).toMatchObject({
			state: "ready",
			overlay: {
				kind: "evidence",
				target: { kind: "account", id: "checking" },
			},
		});
	});

	test("transaction routes wait for their rows, not evaluation rows", () => {
		const route = parseRoute("/transactions?editor=transaction&id=invest");
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

	test("unknown account ids do not steal reserved editor words", () => {
		// An archived account literally named "New" must not resolve as the
		// new-account editor: it resolves by id-or-slug or not at all.
		expect(
			resolveOverlayRoute(
				{ page: "accounts", overlay: { type: "account", key: "new" } },
				model,
			),
		).toEqual({ state: "unknown" });
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

	test("outlook single segments resolve account evidence", () => {
		expect(
			resolveOverlayRoute(
				parseRoute("/outlook?evidence=account&id=everyday-checking"),
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
				parseRoute("/outlook?evidence=account&id=nope"),
				model,
			),
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
	test("page paths stay canonical", () => {
		expect(pagePath("accounts")).toBe("/accounts");
	});

	test("account evidence prefers slugs and escapes reserved words", () => {
		expect(
			evidencePath("accounts", { kind: "account", id: "checking" }, model),
		).toBe("/accounts?evidence=account&id=everyday-checking");
		expect(
			evidencePath("outlook", { kind: "account", id: "checking" }, model),
		).toBe("/outlook?evidence=account&id=everyday-checking");
		// The archived account named "New" slugifies to a reserved word, so
		// the explicit id form keeps the link unambiguous.
		const reserved = {
			...model,
			accounts: [account("abc", "New")],
		};
		expect(
			evidencePath("accounts", { kind: "account", id: "abc" }, reserved),
		).toBe("/accounts?evidence=account&id=abc");
		expect(
			parseRoute(
				evidencePath("accounts", { kind: "account", id: "checking" }, model),
			),
		).toEqual({
			page: "accounts",
			overlay: { type: "account", key: "everyday-checking" },
		});
	});

	test("editors serialize as query params on every page", () => {
		expect(
			editorPath("transactions", {
				kind: "transaction",
				item: investTransaction,
			}),
		).toBe("/transactions?editor=transaction&id=invest");
		expect(
			editorPath("outlook", { kind: "transaction", item: investTransaction }),
		).toBe("/outlook?editor=transaction&id=invest");
		expect(
			editorPath("transactions", { kind: "transaction", item: null }),
		).toBe("/transactions?editor=transaction&id=new");
		expect(editorPath("accounts", { kind: "schedule", item: null })).toBe(
			"/accounts?editor=schedule&id=new",
		);
		expect(
			parseRoute(editorPath("transactions", { kind: "schedule", item: null })),
		).toEqual({
			page: "transactions",
			overlay: { type: "scheduleEdit", key: "new" },
		});
		expect(editorPath("accounts", { kind: "account", item: null })).toBe(
			"/accounts?editor=account&id=new",
		);
		expect(
			editorPath("evaluations", {
				kind: "evaluation",
				item: goalEvaluation,
			}),
		).toBe("/evaluations?editor=evaluation&id=goal-1");
		expect(
			parseRoute(
				editorPath("outlook", { kind: "transaction", item: investTransaction }),
			),
		).toEqual({
			page: "outlook",
			overlay: { type: "transactionEdit", key: "invest" },
		});
		// An account literally named "New" slugifies to the reserved new-item
		// value, so the editor link uses the explicit id form and still
		// resolves to the account.
		const reserved = account("move-1", "New");
		expect(editorPath("accounts", { kind: "account", item: reserved })).toBe(
			"/accounts?editor=account&id=move-1",
		);
		expect(
			resolveOverlayRoute(
				parseRoute(editorPath("accounts", { kind: "account", item: reserved })),
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
			parseRoute(safeSpendingDetailPath("outlook", "last-cycle", "invest")),
		).toEqual({
			page: "outlook",
			overlay: {
				type: "safeSpendingDetail",
				tab: "last-cycle",
				editTransaction: "invest",
			},
		});
		expect(safeSpendingDetailPath("outlook", "cycle")).toBe(
			"/outlook?detail=safe-spending&tab=cycle",
		);
		expect(safeSpendingDetailPath("outlook", "cycle", "invest")).toBe(
			"/outlook?detail=safe-spending&tab=cycle&editTransaction=invest",
		);
		expect(
			parseRoute(safeSpendingDetailPath("outlook", "cycle", "invest")),
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
		const path = evidencePath(
			"accounts",
			{ kind: "account", id: "a1" },
			special,
		);
		expect(parseRoute(path)).toEqual({
			page: "accounts",
			overlay: { type: "account", key: "caf-sons" },
		});
		expect(resolveOverlayRoute(parseRoute(path), special)).toEqual({
			state: "ready",
			overlay: { kind: "evidence", target: { kind: "account", id: "a1" } },
		});
	});
});
