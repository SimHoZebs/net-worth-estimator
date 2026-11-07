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
