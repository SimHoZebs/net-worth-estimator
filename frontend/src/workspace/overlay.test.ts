import { describe, expect, test } from "vitest";
import type { Account, Evaluation, Transaction } from "../domain/model.ts";
import {
	editorSearch,
	evidenceSearch,
	findAccount,
	resolveOverlay,
	safeSpendingDetailSearch,
	slugifyAccount,
} from "./overlay.ts";
import {
	validateWorkspaceSearch,
	type WorkspaceSearch,
} from "./overlaySearch.ts";

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

function validate(raw: Record<string, unknown>): WorkspaceSearch {
	return validateWorkspaceSearch(raw);
}

function emptySearch(): WorkspaceSearch {
	return {
		evidence: undefined,
		editor: undefined,
		detail: undefined,
		id: undefined,
		tab: undefined,
		editTransaction: undefined,
		gmail: undefined,
	};
}

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

describe("resolveOverlay", () => {
	test("account evidence resolves without transaction or evaluation queries", () => {
		expect(
			resolveOverlay(validate({ evidence: "account", id: "checking" }), {
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

	test("transaction edits wait for their rows, not evaluation rows", () => {
		const search = validate({ editor: "transaction", id: "invest" });
		expect(
			resolveOverlay(search, {
				accounts: [],
				transactions: null,
				evaluations: [],
			}),
		).toEqual({ state: "pending" });
		expect(
			resolveOverlay(search, {
				accounts: null,
				transactions: model.transactions,
				evaluations: null,
			}),
		).toMatchObject({ state: "ready", overlay: { kind: "editor" } });
	});

	test("no overlay resolves to none, even without a model", () => {
		expect(resolveOverlay(validate({}), null)).toEqual({ state: "none" });
	});

	test("overlays wait for the model instead of failing", () => {
		expect(
			resolveOverlay(validate({ evidence: "account", id: "checking" }), null),
		).toEqual({ state: "pending" });
	});

	test("account evidence resolves by id or slug", () => {
		expect(
			resolveOverlay(
				validate({ evidence: "account", id: "everyday-checking" }),
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
			resolveOverlay(validate({ evidence: "account", id: "nope" }), model),
		).toEqual({ state: "unknown" });
		expect(
			resolveOverlay(validate({ evidence: "account", id: "old" }), model),
		).toEqual({ state: "unknown" });
	});

	test("unknown account ids do not steal reserved editor words", () => {
		// An archived account literally named "New" must not resolve as the
		// new-account editor: it resolves by id-or-slug or not at all.
		expect(
			resolveOverlay(validate({ evidence: "account", id: "new" }), model),
		).toEqual({ state: "unknown" });
	});

	test("editors resolve existing items and the new form", () => {
		expect(
			resolveOverlay(validate({ editor: "transaction", id: "invest" }), model),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "transaction", item: investTransaction },
			},
		});
		expect(
			resolveOverlay(validate({ editor: "transaction", id: "missing" }), model),
		).toEqual({ state: "unknown" });
		expect(
			resolveOverlay(validate({ editor: "schedule", id: "new" }), {
				accounts: [],
				transactions: [],
				evaluations: [],
			}),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "schedule", item: null },
			},
		});
		expect(
			resolveOverlay(validate({ editor: "evaluation", id: "new" }), model),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "evaluation", item: null },
			},
		});
		expect(
			resolveOverlay(validate({ editor: "account", id: "checking" }), model),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "account", item: model.accounts[0] },
			},
		});
		expect(
			resolveOverlay(validate({ editor: "account", id: "new" }), model),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "account", item: null },
			},
		});
		expect(
			resolveOverlay(validate({ editor: "evaluation", id: "goal-1" }), model),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "evaluation", item: goalEvaluation },
			},
		});
	});

	test("unknown schedule ids do not resolve", () => {
		expect(
			resolveOverlay(validate({ editor: "schedule", id: "invest" }), model),
		).toEqual({ state: "unknown" });
	});

	test("evidence kinds resolve without rows", () => {
		expect(resolveOverlay(validate({ evidence: "position" }), null)).toEqual({
			state: "ready",
			overlay: { kind: "evidence", target: { kind: "position" } },
		});
		expect(resolveOverlay(validate({ evidence: "shortfall" }), null)).toEqual({
			state: "ready",
			overlay: { kind: "evidence", target: { kind: "failure" } },
		});
		expect(
			resolveOverlay(validate({ evidence: "safe-spending" }), null),
		).toEqual({
			state: "ready",
			overlay: { kind: "evidence", target: { kind: "safe-spending" } },
		});
	});

	test("safe spending detail resolves with and without a stacked editor", () => {
		expect(
			resolveOverlay(validate({ detail: "safe-spending" }), model),
		).toEqual({
			state: "ready",
			overlay: { kind: "safeSpendingDetail", tab: "cycle", edit: null },
		});
		expect(
			resolveOverlay(
				validate({ detail: "safe-spending", tab: "last-cycle" }),
				model,
			),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "safeSpendingDetail",
				tab: "last-cycle",
				edit: null,
			},
		});
		expect(
			resolveOverlay(
				validate({
					detail: "safe-spending",
					tab: "cycle",
					editTransaction: "invest",
				}),
				model,
			),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "safeSpendingDetail",
				tab: "cycle",
				edit: { kind: "transaction", item: investTransaction },
			},
		});
		expect(
			resolveOverlay(
				validate({
					detail: "safe-spending",
					tab: "cycle",
					editTransaction: "missing",
				}),
				model,
			),
		).toEqual({ state: "unknown" });
	});
});

describe("search builders", () => {
	test("evidence search prefers slugs and escapes reserved words", () => {
		expect(evidenceSearch({ kind: "account", id: "checking" }, model)).toEqual({
			evidence: "account",
			id: "everyday-checking",
		});
		expect(evidenceSearch({ kind: "position" }, model)).toEqual({
			evidence: "position",
		});
		expect(evidenceSearch({ kind: "failure" }, model)).toEqual({
			evidence: "shortfall",
		});
		expect(evidenceSearch({ kind: "safe-spending" }, model)).toEqual({
			evidence: "safe-spending",
		});
		// The archived account named "New" slugifies to a reserved word, so
		// the explicit id form keeps the link unambiguous.
		const reserved = {
			...model,
			accounts: [account("abc", "New")],
		};
		expect(evidenceSearch({ kind: "account", id: "abc" }, reserved)).toEqual({
			evidence: "account",
			id: "abc",
		});
	});

	test("editors serialize as overlay search on every page", () => {
		expect(
			editorSearch({ kind: "transaction", item: investTransaction }),
		).toEqual({ editor: "transaction", id: "invest" });
		expect(editorSearch({ kind: "transaction", item: null })).toEqual({
			editor: "transaction",
			id: "new",
		});
		expect(editorSearch({ kind: "schedule", item: null })).toEqual({
			editor: "schedule",
			id: "new",
		});
		expect(editorSearch({ kind: "account", item: null })).toEqual({
			editor: "account",
			id: "new",
		});
		expect(editorSearch({ kind: "evaluation", item: goalEvaluation })).toEqual({
			editor: "evaluation",
			id: "goal-1",
		});
		// An account literally named "New" uses the explicit id form.
		const reserved = account("move-1", "New");
		expect(editorSearch({ kind: "account", item: reserved })).toEqual({
			editor: "account",
			id: "move-1",
		});
		expect(
			resolveOverlay(editorSearch({ kind: "account", item: reserved }), {
				...model,
				accounts: [reserved],
			}),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "account", item: reserved },
			},
		});
	});

	test("safe spending detail round-trips through resolve", () => {
		expect(safeSpendingDetailSearch("cycle")).toEqual({
			detail: "safe-spending",
			tab: "cycle",
		});
		expect(safeSpendingDetailSearch("last-cycle", "invest")).toEqual({
			detail: "safe-spending",
			tab: "last-cycle",
			editTransaction: "invest",
		});
		expect(
			resolveOverlay(safeSpendingDetailSearch("cycle", "invest"), model),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "safeSpendingDetail",
				tab: "cycle",
				edit: { kind: "transaction", item: investTransaction },
			},
		});
	});

	test("built search validates and resolves back", () => {
		const search = evidenceSearch({ kind: "account", id: "checking" }, model);
		expect(validate(search)).toEqual({
			...emptySearch(),
			evidence: "account",
			id: "everyday-checking",
		});
		expect(resolveOverlay(validate(search), model)).toEqual({
			state: "ready",
			overlay: {
				kind: "evidence",
				target: { kind: "account", id: "checking" },
			},
		});
	});

	test("names with special characters survive the round trip", () => {
		const special = {
			...model,
			accounts: [account("a1", "Café & Sons!")],
		};
		const search = evidenceSearch({ kind: "account", id: "a1" }, special);
		expect(validate(search)).toEqual({
			...emptySearch(),
			evidence: "account",
			id: "caf-sons",
		});
		expect(resolveOverlay(validate(search), special)).toEqual({
			state: "ready",
			overlay: {
				kind: "evidence",
				target: { kind: "account", id: "a1" },
			},
		});
	});
});
