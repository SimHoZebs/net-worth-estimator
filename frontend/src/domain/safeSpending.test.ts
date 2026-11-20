import { describe, expect, it } from "vitest";
import type { Account } from "./model.ts";
import {
	monthEndIso,
	nextMonthRange,
	safeSpendingCards,
	selectedCardIds,
} from "./safeSpending.ts";

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

describe("month helpers", () => {
	it("finds the end of the current month", () => {
		expect(monthEndIso("2026-10-08")).toBe("2026-10-31");
		expect(monthEndIso("2026-02-10")).toBe("2026-02-28");
	});

	it("finds next month range", () => {
		expect(nextMonthRange("2026-10-08")).toEqual({
			start: "2026-11-01",
			end: "2026-11-30",
		});
		expect(nextMonthRange("2026-12-15")).toEqual({
			start: "2027-01-01",
			end: "2027-01-31",
		});
	});
});

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
