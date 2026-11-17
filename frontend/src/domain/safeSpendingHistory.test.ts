import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain/model.ts";
import { postedTransactionResults } from "./safeSpendingHistory.ts";

const posted = (overrides: Partial<Transaction>): Transaction => ({
	kind: "transaction",
	id: "posted-row",
	name: "Posted row",
	amount: 0,
	amountKnown: true,
	fromId: null,
	toId: null,
	startDate: "2026-10-30",
	endDate: null,
	annualIncrease: 0,
	enabled: true,
	readOnly: false,
	claimScheduleId: null,
	claimOccurrenceDate: null,
	postedDate: null,
	pending: false,
	void: false,
	syncOwned: true,
	category: null,
	categorySource: null,
	transactionTime: null,
	...overrides,
});

describe("postedTransactionResults", () => {
	it("keeps enabled posted transactions with their own id and day", () => {
		expect(
			postedTransactionResults([
				posted({
					id: "pay-oct",
					name: "Payroll",
					amount: 7000,
					toId: "checking",
				}),
			]),
		).toEqual([
			expect.objectContaining({
				date: "2026-10-30",
				transactionId: "pay-oct",
				name: "Payroll",
				requested: 7000,
				posted: true,
				claimed: false,
			}),
		]);
	});

	it("uses the rule id for a claimed row but keeps the actual day", () => {
		expect(
			postedTransactionResults([
				posted({
					id: "rent-payment",
					name: "Rent payment",
					amount: 1200,
					fromId: "checking",
					startDate: "2026-10-17",
					claimScheduleId: "rent",
					claimOccurrenceDate: "2026-10-15",
				}),
			]),
		).toEqual([
			expect.objectContaining({
				date: "2026-10-17",
				transactionId: "rent",
				claimed: true,
			}),
		]);
	});

	it("skips non-transactions and disabled, void, pending or undated rows", () => {
		expect(
			postedTransactionResults([
				posted({ id: "schedule", kind: "schedule" }),
				posted({ id: "disabled", enabled: false }),
				posted({ id: "void", void: true }),
				posted({ id: "pending", pending: true }),
				posted({ id: "undated", startDate: undefined as unknown as string }),
			]),
		).toEqual([]);
	});
});
