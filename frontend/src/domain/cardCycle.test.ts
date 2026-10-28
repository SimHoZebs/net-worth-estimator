import { describe, expect, it } from "vitest";
import type { AccountTransaction } from "./accountActivity.ts";
import {
	cycleOutflowTransactions,
	cycleSpentSoFar,
	resolveStatementCycle,
} from "./cardCycle.ts";

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

function charge(
	overrides: Partial<AccountTransaction> = {},
): AccountTransaction {
	return {
		id: "charge",
		movementId: "charge",
		date: "2026-10-20",
		name: "Card charge",
		source: "historical",
		direction: "out",
		category: "expense",
		counterparty: "External spending",
		from: "Card",
		to: "External spending",
		amount: 25,
		requested: 25,
		shortfall: 0,
		constraint: null,
		excluded: false,
		pending: false,
		void: false,
		...overrides,
	};
}

describe("cycle card charges", () => {
	it("counts pending charges without including user-excluded charges or card payments", () => {
		const recorded = charge();
		const pending = charge({ id: "pending", pending: true, excluded: true });
		const input = {
			transactions: [
				recorded,
				pending,
				charge({ id: "excluded", excluded: true }),
				charge({ id: "payment", direction: "in", category: "transfer" }),
				charge({ id: "pending-refund", direction: "in", pending: true }),
			],
			cycleStart: "2026-10-20",
			todayIso: "2026-10-22",
		};
		expect(cycleOutflowTransactions(input)).toEqual([recorded, pending]);
		expect(cycleSpentSoFar(input)).toBe(50);
		expect(pending.excluded).toBe(true);
	});

	it("keeps pending charges inside the inclusive cycle-to-today window", () => {
		const transactions = [
			"2026-10-19",
			"2026-10-20",
			"2026-10-22",
			"2026-10-23",
		].map((date) => charge({ id: date, date, pending: true, excluded: true }));
		const input = {
			transactions,
			cycleStart: "2026-10-20",
			todayIso: "2026-10-22",
		};
		expect(cycleOutflowTransactions(input).map((row) => row.date)).toEqual([
			"2026-10-20",
			"2026-10-22",
		]);
		expect(cycleSpentSoFar(input)).toBe(50);
	});
});
