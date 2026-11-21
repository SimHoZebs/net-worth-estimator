import { describe, expect, it } from "vitest";
import type { Account } from "./model.ts";
import { safeSpendingCards, selectedCardIds } from "./safeSpending.ts";

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: "account",
		name: "Account",
		kind: "cash",
		enabled: true,
		archived: false,
		balance: 0,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-01-31",
		balanceCheck: true,
		source: "Manual entry",
		readOnly: false,
		displayBasis: "available",
		...overrides,
	};
}

describe("card account choices", () => {
	it("selects cards by declared kind, not by name or id", () => {
		expect(
			safeSpendingCards([
				account({ id: "savings", name: "Credit Card Savings", kind: "cash" }),
				account({ id: "loan", name: "Visa loan", kind: "debt" }),
				account({ id: "plain", name: " Everyday card ", kind: "credit_card" }),
			]).map(({ id }) => id),
		).toEqual(["plain"]);
	});

	it("omits archived and disabled cards", () => {
		expect(
			safeSpendingCards([
				account({ id: "active", kind: "credit_card" }),
				account({ id: "old", kind: "credit_card", archived: true }),
				account({ id: "disabled", kind: "credit_card", enabled: false }),
			]).map(({ id }) => id),
		).toEqual(["active"]);
	});

	it("distinguishes automatic tracking from explicitly tracking none", () => {
		expect(selectedCardIds(null, ["card"])).toEqual(["card"]);
		expect(selectedCardIds([], ["card"])).toEqual([]);
		expect(selectedCardIds(["stale"], ["card"])).toEqual([]);
	});
});
