import { describe, expect, it } from "vitest";
import type { Schedule } from "@/api/generated/model/schedule.ts";
import type { Transaction } from "@/domain/model.ts";
import { transactionFixture } from "@/mocks/projection.ts";
import {
	safeSpendingResults,
	selectObligationResults,
} from "./safeSpendingHistory.ts";

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

const schedule = (overrides: Partial<Schedule>): Schedule => ({
	id: "salary",
	name: "Salary",
	sourceAccountId: "gross_pay",
	destinations: ["checking"],
	amount: {
		resolver: "expression",
		config: { expression: "7000" },
		inputs: {},
	},
	frequency: "monthly",
	startDate: "2026-01-01",
	endDate: null,
	annualCap: null,
	priority: 1,
	enabled: true,
	...overrides,
});

describe("safeSpendingResults", () => {
	it("maps a posted paycheck to the selected income source", () => {
		const results = safeSpendingResults({
			transactions: [
				posted({
					id: "pay-oct",
					name: "Payroll",
					amount: 7000,
					toId: "checking",
				}),
			],
			rules: [
				{
					...posted({}),
					kind: "schedule",
					id: "salary",
					amount: 0,
					fromId: "gross_pay",
					toId: "checking",
				},
			],
			schedules: [schedule({})],
			incomeAccountIds: ["checking"],
			incomeScheduleIds: ["salary"],
			billScheduleIds: [],
			billWindowStart: "2026-10-19",
			billWindowEnd: "2026-11-30",
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
			transactionId: "salary",
			requested: 7000,
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
			rules: [],
			schedules: [
				schedule({
					id: "housing",
					name: "Housing",
					sourceAccountId: "checking",
					destinations: null,
					amount: {
						resolver: "expression",
						config: { expression: "3200" },
						inputs: {},
					},
				}),
			],
			incomeAccountIds: ["checking"],
			incomeScheduleIds: [],
			billScheduleIds: ["housing"],
			billWindowStart: "2026-10-19",
			billWindowEnd: "2026-11-30",
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
			rules: [],
			schedules: [],
			incomeAccountIds: ["checking"],
			incomeScheduleIds: [],
			billScheduleIds: [],
			billWindowStart: "2026-03-01",
			billWindowEnd: "2026-03-31",
			projectionTransactions: [transactionFixture(duplicate)],
		});
		expect(
			results.filter((row) => row.transactionId === "renovation"),
		).toHaveLength(1);
	});

	it("fills a selected bill occurrence missing from posted and projected rows", () => {
		const results = safeSpendingResults({
			transactions: [],
			rules: [],
			schedules: [
				schedule({
					id: "phone",
					name: "Phone",
					sourceAccountId: "checking",
					destinations: null,
					amount: {
						resolver: "expression",
						config: { expression: "50" },
						inputs: {},
					},
				}),
			],
			incomeAccountIds: ["checking"],
			incomeScheduleIds: [],
			billScheduleIds: ["phone"],
			billWindowStart: "2026-10-19",
			billWindowEnd: "2026-11-30",
			projectionTransactions: [],
		});
		expect(
			results.find(
				(row) => row.transactionId === "phone" && row.date === "2026-11-01",
			),
		).toMatchObject({ requested: 50, fromId: "checking" });
	});

	it("keeps unclaimed posted outflows out of bills when a projected bill represents them", () => {
		const unclaimed = transactionFixture({
			date: "2026-11-01",
			transactionId: "unclaimed",
			fromId: "checking",
			requested: 50,
			posted: true,
			claimed: false,
		});
		const claimed = transactionFixture({
			date: "2026-11-02",
			transactionId: "claimed",
			fromId: "checking",
			requested: 60,
			posted: true,
			claimed: true,
		});
		const projected = transactionFixture({
			date: "2026-11-01",
			transactionId: "bill-rule",
			fromId: "checking",
			requested: 70,
		});
		const distinct = transactionFixture({
			date: "2026-11-01",
			transactionId: "distinct",
			fromId: "checking",
			requested: 500,
			posted: true,
			claimed: false,
		});
		expect(
			selectObligationResults([unclaimed, distinct, claimed, projected], null, [
				"bill-rule",
			]).map((row) => row.transactionId),
		).toEqual(["distinct", "claimed", "bill-rule"]);
		expect(
			selectObligationResults(
				[unclaimed, claimed, projected],
				["unclaimed"],
			).map((row) => row.transactionId),
		).toEqual(["unclaimed"]);
	});

	it("keeps an unclaimed posted one-time outflow when no projected bill represents it", () => {
		const actual = transactionFixture({
			date: "2026-03-06",
			transactionId: "renovation",
			fromId: "checking",
			requested: 9000,
			posted: true,
			claimed: false,
		});
		expect(
			selectObligationResults([actual], null, ["housing"]).map(
				(row) => row.transactionId,
			),
		).toEqual(["renovation"]);
	});
});
