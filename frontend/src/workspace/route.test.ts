import { describe, expect, test } from "vitest";
import type { Account, Evaluation, Movement } from "../domain/model.ts";
import {
	discardHash,
	editorHash,
	evidenceHash,
	findAccount,
	pageHash,
	parseHash,
	resolveOverlayRoute,
	slugifyAccount,
	safeSpendingDetailHash,
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

function movement(id: string): Movement {
	return {
		id,
		name: id,
		amount: 10,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		frequency: "monthly",
		startDate: "2026-02-01",
		endDate: null,
		annualIncrease: 0,
		enabled: true,
		readOnly: false,
		claimRuleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
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

const investMovement = movement("invest");
const goalEvaluation = evaluation("goal-1");

const plan = {
	accounts: [
		account("checking", "Everyday checking"),
		account("savings", "Investment portfolio"),
		account("old", "Old account", true),
		account("new", "New", true),
	],
	movements: [investMovement],
	evaluations: [goalEvaluation],
};

describe("parseHash", () => {
	test("page-only hashes keep their legacy meaning", () => {
		expect(parseHash("")).toEqual({ page: "outlook", overlay: null });
		expect(parseHash("#")).toEqual({ page: "outlook", overlay: null });
		expect(parseHash("#accounts")).toEqual({
			page: "accounts",
			overlay: null,
		});
		expect(parseHash("#/accounts")).toEqual({
			page: "accounts",
			overlay: null,
		});
		expect(parseHash("#plan")).toEqual({ page: "accounts", overlay: null });
		expect(parseHash("#goals")).toEqual({
			page: "evaluations",
			overlay: null,
		});
	});

	test("unknown pages fall back to outlook with an invalid overlay", () => {
		expect(parseHash("#nope")).toEqual({
			page: "outlook",
			overlay: { type: "invalid" },
		});
	});

	test("account evidence parses on accounts and transactions pages", () => {
		expect(parseHash("#accounts/checking")).toEqual({
			page: "accounts",
			overlay: { type: "account", key: "checking" },
		});
		expect(parseHash("#transactions/checking")).toEqual({
			page: "transactions",
			overlay: { type: "account", key: "checking" },
		});
		expect(parseHash("#accounts/account/checking")).toEqual({
			page: "accounts",
			overlay: { type: "account", key: "checking" },
		});
	});

	test("editors parse in scoped and global forms", () => {
		expect(parseHash("#accounts/new")).toEqual({
			page: "accounts",
			overlay: { type: "accountEdit", key: "new" },
		});
		expect(parseHash("#accounts/checking/edit")).toEqual({
			page: "accounts",
			overlay: { type: "accountEdit", key: "checking" },
		});
		expect(parseHash("#transactions/invest/edit")).toEqual({
			page: "transactions",
			overlay: { type: "movementEdit", key: "invest" },
		});
		expect(parseHash("#outlook/edit-movement/invest")).toEqual({
			page: "outlook",
			overlay: { type: "movementEdit", key: "invest" },
		});
		expect(parseHash("#accounts/edit-movement/new")).toEqual({
			page: "accounts",
			overlay: { type: "movementEdit", key: "new" },
		});
		expect(parseHash("#outlook/edit-account/new")).toEqual({
			page: "outlook",
			overlay: { type: "accountEdit", key: "new" },
		});
		expect(parseHash("#evaluations/goal-1/edit")).toEqual({
			page: "evaluations",
			overlay: { type: "evaluationEdit", key: "goal-1" },
		});
		expect(parseHash("#outlook/edit-evaluation/goal-1")).toEqual({
			page: "outlook",
			overlay: { type: "evaluationEdit", key: "goal-1" },
		});
	});

	test.each([
		"#evaluations/goal-1",
		"#goals/goal-1",
		"#outlook/evaluation/goal-1",
		"#accounts/evaluation/goal-1",
		"#outlook/goal-1",
	])("retired evaluation evidence URL %s resolves to unknown", (hash) => {
		expect(resolveOverlayRoute(parseHash(hash), plan)).toEqual({
			state: "unknown",
		});
	});

	test("outlook evidence and safe spending detail parse", () => {
		expect(parseHash("#outlook/position")).toEqual({
			page: "outlook",
			overlay: { type: "position" },
		});
		expect(parseHash("#outlook/shortfall")).toEqual({
			page: "outlook",
			overlay: { type: "shortfall" },
		});
		expect(parseHash("#outlook/safe-spending")).toEqual({
			page: "outlook",
			overlay: { type: "safe-spending" },
		});
		expect(parseHash("#outlook/safe-spending-detail")).toEqual({
			page: "outlook",
			overlay: { type: "safeSpendingDetail", tab: "mandatory" },
		});
		expect(parseHash("#outlook/safe-spending-detail/cycle")).toEqual({
			page: "outlook",
			overlay: { type: "safeSpendingDetail", tab: "cycle" },
		});
		expect(
			parseHash("#outlook/safe-spending-detail/cycle/edit-movement/invest"),
		).toEqual({
			page: "outlook",
			overlay: {
				type: "safeSpendingDetail",
				tab: "cycle",
				editMovement: "invest",
			},
		});
		expect(
			parseHash("#outlook/safe-spending-detail/edit-movement/invest"),
		).toEqual({
			page: "outlook",
			overlay: {
				type: "safeSpendingDetail",
				tab: "mandatory",
				editMovement: "invest",
			},
		});
		expect(parseHash("#outlook/safe-spending-detail/bogus")).toEqual({
			page: "outlook",
			overlay: { type: "invalid" },
		});
		expect(parseHash("#accounts/safe-spending-detail")).toEqual({
			page: "accounts",
			overlay: { type: "safeSpendingDetail", tab: "mandatory" },
		});
	});

	test("discard parses on any page", () => {
		expect(parseHash("#sources/discard")).toEqual({
			page: "sources",
			overlay: { type: "discard" },
		});
	});

	test("malformed overlays are invalid rather than silently dropped", () => {
		expect(parseHash("#accounts/a/b/c")?.overlay).toEqual({
			type: "invalid",
		});
		expect(parseHash("#sources/checking")?.overlay).toEqual({
			type: "invalid",
		});
		expect(parseHash("#sources/new")?.overlay).toEqual({ type: "invalid" });
		expect(parseHash("#accounts/new/edit")?.overlay).toEqual({
			type: "invalid",
		});
		expect(parseHash("#accounts/%E0%A4%A")?.overlay).toEqual({
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
		expect(findAccount(plan, "checking")?.id).toBe("checking");
		expect(findAccount(plan, "everyday-checking")?.id).toBe("checking");
		expect(findAccount(plan, "Everyday-Checking")?.id).toBe("checking");
		expect(findAccount(plan, "old")).toBeUndefined();
		expect(findAccount(plan, "nope")).toBeUndefined();
	});
});

describe("resolveOverlayRoute", () => {
	test("no overlay resolves to none, even without a plan", () => {
		expect(
			resolveOverlayRoute({ page: "accounts", overlay: null }, null),
		).toEqual({ state: "none" });
	});

	test("overlays wait for the plan instead of failing", () => {
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

	test("invalid shapes resolve to unknown even without a plan", () => {
		expect(
			resolveOverlayRoute(
				{ page: "outlook", overlay: { type: "invalid" } },
				null,
			),
		).toEqual({ state: "unknown" });
	});

	test("account evidence resolves by id or slug", () => {
		expect(
			resolveOverlayRoute(
				{
					page: "accounts",
					overlay: { type: "account", key: "everyday-checking" },
				},
				plan,
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
				plan,
			),
		).toEqual({ state: "unknown" });
		expect(
			resolveOverlayRoute(
				{ page: "accounts", overlay: { type: "account", key: "old" } },
				plan,
			),
		).toEqual({ state: "unknown" });
	});

	test("unknown account ids do not steal reserved editor words", () => {
		// An archived account literally named "New" must not resolve as the
		// new-account editor: it resolves by id-or-slug or not at all.
		expect(
			resolveOverlayRoute(
				{ page: "accounts", overlay: { type: "account", key: "new" } },
				plan,
			),
		).toEqual({ state: "unknown" });
	});

	test("editors resolve existing items and the new form", () => {
		expect(
			resolveOverlayRoute(
				{
					page: "transactions",
					overlay: { type: "movementEdit", key: "invest" },
				},
				plan,
			),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "movement", item: investMovement },
			},
		});
		expect(
			resolveOverlayRoute(
				{
					page: "transactions",
					overlay: { type: "movementEdit", key: "missing" },
				},
				plan,
			),
		).toEqual({ state: "unknown" });
		expect(
			resolveOverlayRoute(
				{
					page: "evaluations",
					overlay: { type: "evaluationEdit", key: "new" },
				},
				plan,
			),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "editor",
				target: { kind: "evaluation", item: null },
			},
		});
	});

	test("outlook single segments resolve account evidence", () => {
		expect(
			resolveOverlayRoute(parseHash("#outlook/everyday-checking"), plan),
		).toEqual({
			state: "ready",
			overlay: {
				kind: "evidence",
				target: { kind: "account", id: "checking" },
			},
		});
		expect(resolveOverlayRoute(parseHash("#outlook/nope"), plan)).toEqual({
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
				plan,
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
					editMovement: "invest",
				},
			},
			plan,
		);
		expect(stacked).toEqual({
			state: "ready",
			overlay: {
				kind: "safeSpendingDetail",
				tab: "cycle",
				edit: { kind: "movement", item: investMovement },
			},
		});
		expect(
			resolveOverlayRoute(
				{
					page: "outlook",
					overlay: {
						type: "safeSpendingDetail",
						tab: "cycle",
						editMovement: "missing",
					},
				},
				plan,
			),
		).toEqual({ state: "unknown" });
	});
});

describe("hash builders round-trip through the parser", () => {
	test("page hashes stay canonical", () => {
		expect(pageHash("accounts")).toBe("#accounts");
	});

	test("account evidence prefers slugs and escapes reserved words", () => {
		expect(
			evidenceHash("accounts", { kind: "account", id: "checking" }, plan),
		).toBe("#accounts/everyday-checking");
		expect(
			evidenceHash("outlook", { kind: "account", id: "checking" }, plan),
		).toBe("#outlook/account/everyday-checking");
		// The archived account named "New" slugifies to a reserved word, so
		// the explicit id form keeps the link unambiguous.
		const reserved = {
			...plan,
			accounts: [account("abc", "New")],
		};
		expect(
			evidenceHash("accounts", { kind: "account", id: "abc" }, reserved),
		).toBe("#accounts/account/abc");
		expect(
			parseHash(
				evidenceHash("accounts", { kind: "account", id: "checking" }, plan),
			),
		).toEqual({
			page: "accounts",
			overlay: { type: "account", key: "everyday-checking" },
		});
	});

	test("editors serialize scoped on their home page and global elsewhere", () => {
		expect(
			editorHash("transactions", {
				kind: "movement",
				item: investMovement,
			}),
		).toBe("#transactions/invest/edit");
		expect(
			editorHash("outlook", { kind: "movement", item: investMovement }),
		).toBe("#outlook/edit-movement/invest");
		expect(editorHash("transactions", { kind: "movement", item: null })).toBe(
			"#transactions/new",
		);
		expect(editorHash("accounts", { kind: "account", item: null })).toBe(
			"#accounts/new",
		);
		expect(
			editorHash("evaluations", {
				kind: "evaluation",
				item: goalEvaluation,
			}),
		).toBe("#evaluations/goal-1/edit");
		expect(
			parseHash(
				editorHash("outlook", { kind: "movement", item: investMovement }),
			),
		).toEqual({
			page: "outlook",
			overlay: { type: "movementEdit", key: "invest" },
		});
	});

	test("safe spending detail and discard round-trip", () => {
		expect(safeSpendingDetailHash("outlook", "cycle")).toBe(
			"#outlook/safe-spending-detail/cycle",
		);
		expect(safeSpendingDetailHash("outlook", "cycle", "invest")).toBe(
			"#outlook/safe-spending-detail/cycle/edit-movement/invest",
		);
		expect(discardHash("sources")).toBe("#sources/discard");
		expect(
			parseHash(safeSpendingDetailHash("outlook", "cycle", "invest")),
		).toEqual({
			page: "outlook",
			overlay: {
				type: "safeSpendingDetail",
				tab: "cycle",
				editMovement: "invest",
			},
		});
	});

	test("names with special characters survive the round trip", () => {
		const special = {
			...plan,
			accounts: [account("a1", "Café & Sons!")],
		};
		const hash = evidenceHash(
			"accounts",
			{ kind: "account", id: "a1" },
			special,
		);
		expect(parseHash(hash)).toEqual({
			page: "accounts",
			overlay: { type: "account", key: "caf-sons" },
		});
		expect(resolveOverlayRoute(parseHash(hash), special)).toEqual({
			state: "ready",
			overlay: { kind: "evidence", target: { kind: "account", id: "a1" } },
		});
	});
});
