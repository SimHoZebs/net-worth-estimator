import { describe, expect, it } from "vitest";
import type { Account } from "./model.ts";
import { toAccountCard } from "./accountCards.ts";

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: "cash",
		name: "Checking 8472",
		kind: "cash",
		enabled: true,
		archived: false,
		balance: 100,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-01-31",
		balanceCheck: true,
		source: "Synced balance check",
		displayBasis: "available",
		readOnly: true,
		...overrides,
	};
}

describe("toAccountCard institution", () => {
	it("uses the linked bank name when present", () => {
		const card = toAccountCard({
			account: account({ institution: "Chase", syncedName: "Checking 8472" }),
			projection: null,
		});
		expect(card.institution).toBe("Chase");
	});

	it("never labels the generic sync source as an institution", () => {
		const card = toAccountCard({ account: account(), projection: null });
		expect(card.institution).toBe("");
	});
});

describe("toAccountCard kind", () => {
	it("uses the declared credit card kind instead of guessing from a name", () => {
		const card = toAccountCard({
			account: account({
				id: "card",
				name: "A plain account name",
				kind: "credit_card",
				balance: -500,
				maxBalance: 1000,
			}),
			projection: null,
		});
		expect(card.kind).toBe("credit_card");
		expect(card.roles).toEqual(["debt"]);
		expect(card.balanceLabel).toBe("Current balance owed");
		expect(card.creditUtilization).toBe(50);
		expect(card.metrics).toContainEqual({
			label: "Credit limit",
			value: "$1,000",
		});
	});

	it("does not turn a debt named like a card into a credit card", () => {
		const card = toAccountCard({
			account: account({
				id: "loan",
				name: "Visa Signature loan",
				kind: "debt",
				balance: -500,
				maxBalance: 1000,
			}),
			projection: null,
		});
		expect(card.kind).toBe("loan");
		expect(card.balanceLabel).toBe("Outstanding balance");
		expect(card.creditUtilization).toBeUndefined();
	});

	it("shows a positive card balance as credit, not an amount owed", () => {
		const card = toAccountCard({
			account: account({ kind: "credit_card", balance: 40, maxBalance: 1000 }),
			projection: null,
		});
		expect(card.balanceLabel).toBe("Credit balance");
		expect(card.creditUtilization).toBe(0);
	});

	it("keeps cash out of the liability group", () => {
		const card = toAccountCard({
			account: account({ id: "checking", kind: "cash", balance: -50 }),
			projection: null,
		});
		expect(card.roles).toEqual(["cash"]);
		expect(card.creditUtilization).toBeUndefined();
	});
});
