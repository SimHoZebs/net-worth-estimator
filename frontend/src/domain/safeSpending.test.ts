import { describe, expect, it } from "vitest";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { transactionFixture } from "../mocks/projection.ts";
import {
	cashCushion,
	checkingAccountId,
	checkingShortfall,
	cycleAllowance,
	filterTransactionsById,
	groupMandatorySpending,
	monthEndIso,
	nextMonthObligations,
	nextMonthRange,
	paycheckBeforeReserve,
	realizedCheckingOutflows,
	remainingMonthlyObligations,
	spendingBalance,
} from "./safeSpending.ts";

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

describe("checking", () => {
	it("prefers the checking account id", () => {
		expect(checkingAccountId(financialModelFixture)).toBe("checking");
	});
});

describe("cashCushion", () => {
	it("subtracts spending since the checkpoint and remaining obligations", () => {
		expect(
			cashCushion({
				checking: 5000,
				spentSinceStart: 700,
				remainingObligations: 3200,
			}),
		).toBe(1100);
	});

	it("ignores the blind window when the checkpoint is current", () => {
		expect(
			cashCushion({
				checking: 5000,
				spentSinceStart: 0,
				remainingObligations: 0,
			}),
		).toBe(5000);
	});
});

describe("realizedCheckingOutflows", () => {
	const transactions = [
		transactionFixture({
			date: "2026-10-02",
			transactionId: "start-day",
			name: "Start day",
			fromId: "checking",
			toId: null,
			requested: 100,
			realized: 100,
		}),
		transactionFixture({
			date: "2026-10-05",
			transactionId: "rent",
			name: "Rent",
			fromId: "checking",
			toId: null,
			requested: 2874,
			realized: 2874,
		}),
		transactionFixture({
			date: "2026-10-05",
			transactionId: "shortfall-bill",
			name: "Shortfall",
			fromId: "checking",
			toId: null,
			requested: 500,
			realized: 200,
		}),
		transactionFixture({
			date: "2026-10-20",
			transactionId: "later",
			name: "Later",
			fromId: "checking",
			toId: null,
			requested: 300,
			realized: 300,
		}),
	];

	it("sums realized outflows after the start through today", () => {
		expect(
			realizedCheckingOutflows({
				transactions,
				checkingIds: ["checking"],
				after: "2026-10-02",
				through: "2026-10-08",
			}),
		).toBe(3074);
	});

	it("returns zero when today is the projection start", () => {
		expect(
			realizedCheckingOutflows({
				transactions,
				checkingIds: ["checking"],
				after: "2026-10-02",
				through: "2026-10-02",
			}),
		).toBe(0);
	});
});

describe("checkingShortfall", () => {
	const transactions = [
		transactionFixture({
			date: "2026-10-13",
			transactionId: "car-loan",
			name: "Car loan",
			fromId: "checking",
			toId: null,
			requested: 403,
			realized: 276,
		}),
		transactionFixture({
			date: "2026-10-15",
			transactionId: "living",
			name: "Living",
			fromId: "checking",
			toId: null,
			requested: 2400,
			realized: 0,
		}),
		transactionFixture({
			date: "2026-10-15",
			transactionId: "paid",
			name: "Paid",
			fromId: "checking",
			toId: null,
			requested: 91,
			realized: 91,
		}),
		transactionFixture({
			date: "2026-11-15",
			transactionId: "later",
			name: "Later",
			fromId: "checking",
			toId: null,
			requested: 2400,
			realized: 0,
		}),
	];

	it("sums canonical unfulfilled amounts with the first short date", () => {
		expect(
			checkingShortfall({
				transactions,
				checkingIds: ["checking"],
				after: "2026-10-09",
				through: "2026-10-31",
			}),
		).toEqual({ total: 2527, firstDate: "2026-10-13" });
	});

	it("ignores fully paid transactions and other windows", () => {
		expect(
			checkingShortfall({
				transactions,
				checkingIds: ["checking"],
				after: "2026-10-31",
				through: "2026-11-30",
			}),
		).toEqual({ total: 2400, firstDate: "2026-11-15" });
	});

	it("returns zero when nothing is short", () => {
		expect(
			checkingShortfall({
				transactions: transactions.filter(
					(item) => item.transactionId === "paid",
				),
				checkingIds: ["checking"],
				after: "2026-10-09",
				through: "2026-10-31",
			}),
		).toEqual({ total: 0, firstDate: null });
	});

	it("ignores destination limits and nonreportable residuals", () => {
		expect(
			checkingShortfall({
				transactions: [
					transactionFixture({
						date: "2026-10-13",
						fulfillment: {
							unfulfilledAmount: 0,
							destinationLimitedAmount: 2650,
						},
					}),
					transactionFixture({
						date: "2026-10-14",
						requested: 101,
						realized: 100,
						fulfillment: {
							unfulfilledAmount: 0,
							destinationLimitedAmount: 0,
						},
					}),
				],
				checkingIds: ["checking"],
				after: "2026-10-09",
				through: "2026-10-31",
			}),
		).toEqual({ total: 0, firstDate: null });
	});

	it("keeps a reportable shortfall when public amounts round to the same value", () => {
		expect(
			checkingShortfall({
				transactions: [
					transactionFixture({
						date: "2026-10-13",
						requested: 100,
						realized: 100,
						fulfillment: {
							unfulfilledAmount: 1,
							destinationLimitedAmount: 0,
						},
					}),
				],
				checkingIds: ["checking"],
				after: "2026-10-09",
				through: "2026-10-31",
			}),
		).toEqual({ total: 1, firstDate: "2026-10-13" });
	});
});

describe("cycleAllowance", () => {
	it("subtracts fixed obligations, spent, and reserve from paycheck", () => {
		expect(
			cycleAllowance({
				paycheck: 7579,
				fixedObligations: 5000,
				spent: 1200,
				reserve: 725,
			}),
		).toBe(654);
	});

	it("matches allowance plus spent", () => {
		expect(
			cycleAllowance({
				paycheck: 7579,
				fixedObligations: 5000,
				spent: 1200,
				reserve: 725,
			}),
		).toBe(7579 - 5000 - 1200 - 725);
	});
});

describe("paycheckBeforeReserve", () => {
	it("subtracts fixed bills and the closed balance from the paycheck", () => {
		expect(
			paycheckBeforeReserve({
				paycheck: 7579.4,
				fixedObligations: 4181.87,
				closedTotal: 2601.55,
			}),
		).toBeCloseTo(795.98, 2);
	});

	it("returns null without a closing observation", () => {
		expect(
			paycheckBeforeReserve({
				paycheck: 7579.4,
				fixedObligations: 4181.87,
				closedTotal: null,
			}),
		).toBeNull();
	});
});

describe("projection-derived safe spending", () => {
	const transactions = [
		transactionFixture({
			date: "2026-10-10",
			transactionId: "housing",
			name: "Housing",
			fromId: "checking",
			toId: null,
			requested: 3200,
			realized: 3200,
		}),
		transactionFixture({
			date: "2026-10-20",
			transactionId: "living",
			name: "Living",
			fromId: "checking",
			toId: null,
			requested: 1000,
			realized: 1000,
		}),
		transactionFixture({
			date: "2026-11-01",
			transactionId: "housing",
			name: "Housing",
			fromId: "checking",
			toId: null,
			requested: 3200,
			realized: 3200,
		}),
		transactionFixture({
			date: "2026-10-15",
			transactionId: "pay",
			name: "Pay",
			fromId: null,
			toId: "checking",
			requested: 7579,
			realized: 7579,
		}),
	];

	it("sums remaining obligations through month end", () => {
		expect(
			remainingMonthlyObligations({
				transactions,
				checkingIds: ["checking"],
				todayIso: "2026-10-08",
			}),
		).toEqual({ total: 4200, monthEnd: "2026-10-31" });
	});

	it("sums next month obligations", () => {
		expect(
			nextMonthObligations({
				transactions,
				checkingIds: ["checking"],
				todayIso: "2026-10-08",
			}),
		).toEqual({ total: 3200, start: "2026-11-01", end: "2026-11-30" });
	});
});

describe("groupMandatorySpending", () => {
	const transactions = [
		transactionFixture({
			date: "2026-10-10",
			transactionId: "housing",
			name: "Housing",
			fromId: "checking",
			toId: null,
			requested: 3200,
			realized: 3200,
		}),
		transactionFixture({
			date: "2026-10-20",
			transactionId: "living",
			name: "Living",
			fromId: "checking",
			toId: null,
			requested: 1000,
			realized: 1000,
		}),
		transactionFixture({
			date: "2026-10-25",
			transactionId: "living",
			name: "Living",
			fromId: "checking",
			toId: null,
			requested: 500,
			realized: 500,
		}),
		transactionFixture({
			date: "2026-11-01",
			transactionId: "housing",
			name: "Housing",
			fromId: "checking",
			toId: null,
			requested: 3200,
			realized: 3200,
		}),
	];

	it("groups a window by transaction with totals and dates", () => {
		const groups = groupMandatorySpending({
			transactions,
			checkingIds: ["checking"],
			start: "2026-10-09",
			end: "2026-10-31",
		});
		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({
			transactionId: "housing",
			total: 3200,
			count: 1,
		});
		expect(groups[1]).toMatchObject({
			transactionId: "living",
			total: 1500,
			count: 2,
			dates: ["2026-10-20", "2026-10-25"],
		});
	});

	it("excludes transactions outside the window", () => {
		const groups = groupMandatorySpending({
			transactions,
			checkingIds: ["checking"],
			start: "2026-11-01",
			end: "2026-11-30",
		});
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ transactionId: "housing", total: 3200 });
	});

	it("combines outflows from every selected account", () => {
		const groups = groupMandatorySpending({
			transactions: [
				...transactions,
				transactionFixture({
					date: "2026-10-12",
					transactionId: "savings-transfer",
					name: "Savings transfer",
					fromId: "savings",
					toId: null,
					requested: 400,
					realized: 400,
				}),
			],
			checkingIds: ["checking", "savings"],
			start: "2026-10-09",
			end: "2026-10-31",
		});
		expect(groups).toHaveLength(3);
		expect(groups.map((group) => group.transactionId).sort()).toEqual([
			"housing",
			"living",
			"savings-transfer",
		]);
	});
});

describe("spendingBalance", () => {
	it("sums the selected accounts and ignores unknown ids", () => {
		expect(
			spendingBalance(financialModelFixture, ["checking", "savings"]),
		).toBe(60250);
		expect(
			spendingBalance(financialModelFixture, ["checking", "missing"]),
		).toBe(18250);
		expect(spendingBalance(financialModelFixture, [])).toBe(0);
	});
});

describe("filterTransactionsById", () => {
	const transactions = [
		transactionFixture({ transactionId: "housing", date: "2026-10-10" }),
		transactionFixture({ transactionId: "living", date: "2026-10-11" }),
	];

	it("keeps every transaction when no selection exists", () => {
		expect(filterTransactionsById(transactions, null)).toHaveLength(2);
	});

	it("keeps only selected bills", () => {
		const filtered = filterTransactionsById(transactions, ["living"]);
		expect(filtered).toHaveLength(1);
		expect(filtered[0]!.transactionId).toBe("living");
	});
});
