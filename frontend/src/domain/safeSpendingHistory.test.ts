import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain/model.ts";
import { transactionFixture } from "@/mocks/projection.ts";
import { safeSpendingResults } from "./safeSpendingHistory.ts";

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

describe("safeSpendingResults", () => {
	it("keeps a posted paycheck under its own id without an explicit claim", () => {
		const results = safeSpendingResults({
			transactions: [
				posted({
					id: "pay-oct",
					name: "Payroll",
					amount: 7000,
					toId: "checking",
				}),
			],
			projectionTransactions: [
				transactionFixture({
					date: "2026-11-29",
					transactionId: "salary",
					requested: 7000,
					fromId: "gross_pay",
					toId: "checking",
				}),
			],
		});
		expect(results.find((row) => row.date === "2026-10-30")).toMatchObject({
			transactionId: "pay-oct",
			requested: 7000,
		});
	});

	it("keeps two distinct deposits attached to the same rule", () => {
		const results = safeSpendingResults({
			transactions: [
				posted({
					id: "pay-a",
					name: "Payroll",
					amount: 7000,
					toId: "checking",
					startDate: "2026-10-30",
					claimScheduleId: "salary",
					claimOccurrenceDate: "2026-10-30",
				}),
				posted({
					id: "pay-b",
					name: "Payroll",
					amount: 7000,
					toId: "checking",
					startDate: "2026-10-30",
					claimScheduleId: "salary",
					claimOccurrenceDate: "2026-10-30",
				}),
			],
			projectionTransactions: [
				transactionFixture({
					date: "2026-10-30",
					transactionId: "salary",
					requested: 7000,
					fromId: "gross_pay",
					toId: "checking",
				}),
			],
		});
		const salaryRows = results.filter((row) => row.transactionId === "salary");
		expect(salaryRows).toHaveLength(2);
	});

	it("keeps same-day projected fragments for one rule", () => {
		const results = safeSpendingResults({
			transactions: [],
			projectionTransactions: [
				transactionFixture({
					date: "2026-11-01",
					transactionId: "bill-rule",
					fromId: "checking",
					requested: 40,
				}),
				transactionFixture({
					date: "2026-11-01",
					transactionId: "bill-rule",
					fromId: "checking",
					requested: 60,
				}),
			],
		});
		expect(
			results.filter((row) => row.transactionId === "bill-rule"),
		).toHaveLength(2);
	});

	it("joins a posted row only on an explicit claimScheduleId", () => {
		const results = safeSpendingResults({
			transactions: [
				posted({
					id: "pay-oct",
					name: "Payroll",
					amount: 7000,
					toId: "checking",
					claimScheduleId: "salary",
					claimOccurrenceDate: "2026-10-30",
				}),
			],
			projectionTransactions: [
				transactionFixture({
					date: "2026-10-30",
					transactionId: "salary",
					requested: 7000,
					fromId: "gross_pay",
					toId: "checking",
				}),
			],
		});
		const salary = results.filter((row) => row.transactionId === "salary");
		expect(salary).toHaveLength(1);
		expect(salary[0]).toMatchObject({
			date: "2026-10-30",
			requested: 7000,
			claimed: true,
		});
	});

	it("shows a claimed bill on its own day and drops its duplicate projection", () => {
		const results = safeSpendingResults({
			transactions: [
				posted({
					id: "bank-housing",
					name: "BILT rent",
					amount: 2970.25,
					fromId: "checking",
					startDate: "2026-11-02",
					claimScheduleId: "housing",
					claimOccurrenceDate: "2026-11-01",
				}),
			],
			projectionTransactions: [
				transactionFixture({
					date: "2026-11-01",
					transactionId: "housing",
					requested: 3200,
					fromId: "checking",
					toId: null,
				}),
			],
		});
		const housing = results.filter((row) => row.transactionId === "housing");
		expect(housing).toHaveLength(1);
		expect(housing[0]).toMatchObject({
			date: "2026-11-02",
			requested: 2970.25,
			claimed: true,
		});
	});

	it("drops a projected duplicate of a posted one-time row", () => {
		const duplicate = {
			date: "2026-03-06",
			transactionId: "renovation",
			name: "Home renovation",
			requested: 9000,
			fromId: "checking",
			toId: null,
		};
		const results = safeSpendingResults({
			transactions: [
				posted({
					id: "renovation",
					name: "Home renovation",
					amount: 9000,
					fromId: "checking",
					startDate: "2026-03-06",
				}),
			],
			projectionTransactions: [transactionFixture(duplicate)],
		});
		expect(
			results.filter((row) => row.transactionId === "renovation"),
		).toHaveLength(1);
	});

	it("does not synthesize bill occurrences without selected bill schedules", () => {
		const results = safeSpendingResults({
			transactions: [],
			projectionTransactions: [],
		});
		expect(results).toEqual([]);
	});

	it("expands selected bill schedules into the window, once per occurrence", () => {
		const results = safeSpendingResults({
			transactions: [],
			projectionTransactions: [],
			billSchedules: [
				{
					id: "rent",
					name: "Rent",
					sourceAccountId: "checking",
					destinations: [],
					amount: {
						resolver: "expression",
						config: { expression: "1200" },
						inputs: {},
					},
					frequency: "monthly",
					startDate: "2026-10-15",
					endDate: null,
					annualCap: null,
					priority: 1,
					enabled: true,
				},
			],
			billWindowStart: "2026-10-01",
			billWindowEnd: "2026-11-30",
		});
		expect(
			results
				.filter((row) => row.transactionId === "rent")
				.map((row) => [row.date, row.requested]),
		).toEqual([
			["2026-10-15", 1200],
			["2026-11-15", 1200],
		]);
	});

	it("does not duplicate a bill the projection already supplied at a different amount", () => {
		const bill = {
			id: "sallie",
			name: "Sallie Mae Loan Payment",
			sourceAccountId: "checking",
			destinations: null,
			amount: {
				resolver: "expression",
				config: { expression: "91.08" },
				inputs: {},
			},
			frequency: "monthly",
			startDate: "2026-11-19",
			endDate: null,
			annualCap: null,
			priority: 1,
			enabled: true,
		};
		const results = safeSpendingResults({
			transactions: [],
			projectionTransactions: [
				transactionFixture({
					transactionId: "sallie",
					name: "Sallie Mae Loan Payment",
					date: "2026-11-19",
					fromId: "checking",
					toId: null,
					requested: 91,
					realized: 91,
				}),
			],
			billSchedules: [bill],
			billWindowStart: "2026-09-20",
			billWindowEnd: "2026-11-30",
		});
		expect(
			results.filter((row) => row.transactionId === "sallie"),
		).toHaveLength(1);
	});

	it("does not duplicate an occurrence claimed by a posted row", () => {
		const results = safeSpendingResults({
			transactions: [
				posted({
					id: "rent-payment",
					name: "Rent payment",
					amount: 1200,
					fromId: "checking",
					startDate: "2026-10-15",
					claimScheduleId: "rent",
					claimOccurrenceDate: "2026-10-15",
				}),
			],
			projectionTransactions: [],
			billSchedules: [
				{
					id: "rent",
					name: "Rent",
					sourceAccountId: "checking",
					destinations: [],
					amount: {
						resolver: "expression",
						config: { expression: "1200" },
						inputs: {},
					},
					frequency: "monthly",
					startDate: "2026-10-15",
					endDate: null,
					annualCap: null,
					priority: 1,
					enabled: true,
				},
			],
			billWindowStart: "2026-10-01",
			billWindowEnd: "2026-11-30",
		});
		expect(
			results
				.filter((row) => row.transactionId === "rent")
				.map((row) => [row.date, row.posted === true]),
		).toEqual([
			["2026-10-15", true],
			["2026-11-15", false],
		]);
	});
});
