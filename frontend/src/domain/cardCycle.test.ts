import { describe, expect, it } from "vitest";
import type { AccountTransaction } from "./accountActivity.ts";
import {
	dailyAllowance,
	groupCycleSpending,
	resolveStatementCycle,
} from "./cardCycle.ts";

const transaction = (
	overrides: Partial<AccountTransaction> & { date: string },
): AccountTransaction => ({
	id: overrides.date + (overrides.name ?? ""),
	movementId: "m1",
	name: "Spend",
	source: "projected",
	direction: "out",
	category: "expense",
	counterparty: "Store",
	from: "Prime Card",
	to: "External spending",
	amount: 10,
	requested: 10,
	shortfall: 0,
	constraint: null,
	excluded: false,
	...overrides,
});

describe("resolveStatementCycle", () => {
	it("anchors the cycle to the statement day within the same month", () => {
		const cycle = resolveStatementCycle({
			todayIso: "2026-09-20",
			statementDay: 15,
		});
		expect(cycle.cycleStart).toBe("2026-09-15");
		expect(cycle.cycleEnd).toBe("2026-10-14");
		expect(cycle.daysTotal).toBe(30);
		expect(cycle.daysLeft).toBe(25);
	});

	it("uses the prior month anchor when today precedes the statement day", () => {
		const cycle = resolveStatementCycle({
			todayIso: "2026-09-10",
			statementDay: 15,
		});
		expect(cycle.cycleStart).toBe("2026-08-15");
		expect(cycle.cycleEnd).toBe("2026-09-14");
		expect(cycle.daysLeft).toBe(5);
	});
});

describe("dailyAllowance", () => {
	it("divides remaining budget across days left", () => {
		expect(dailyAllowance({ budget: 1000, spent: 400, daysLeft: 10 })).toBe(60);
	});
});

describe("groupCycleSpending", () => {
	it("groups current-cycle outflows by merchant", () => {
		const groups = groupCycleSpending({
			transactions: [
				transaction({ date: "2026-09-16", name: "Groceries", amount: 40 }),
				transaction({ date: "2026-09-17", name: "Groceries", amount: 20 }),
				transaction({
					date: "2026-09-18",
					name: "Fuel",
					counterparty: "Station",
					amount: 30,
				}),
				transaction({ date: "2026-09-10", name: "Before cycle", amount: 999 }),
			],
			cycleStart: "2026-09-15",
			todayIso: "2026-09-20",
		});
		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({ name: "Groceries", total: 60, count: 2 });
	});
});
