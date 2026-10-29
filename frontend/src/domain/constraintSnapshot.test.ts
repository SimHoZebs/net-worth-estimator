import { describe, expect, it } from "vitest";
import { testAccount } from "../mocks/account.ts";
import { movementFixture, projectionFixture } from "../mocks/projection.ts";
import { failureLedger } from "./constraintSnapshot.ts";
import type { MovementResult } from "./result.ts";

function move(overrides: Partial<MovementResult>): MovementResult {
	return movementFixture(overrides);
}

function checkingProjection(movements: MovementResult[]) {
	return projectionFixture({
		points: [
			{
				date: testAccount.startDate,
				total: 20000,
				balances: { checking: 20000 },
			},
		],
		movements,
	});
}

describe("failure ledger", () => {
	function decemberFailure() {
		return move({
			date: "2026-12-05",
			movementId: "renovation",
			name: "Home renovation",
			requested: 9000,
			realized: 6350,
			fromId: "checking",
			toId: null,
			constraintTypes: ["source-floor"],
			accountDeltas: [{ accountId: "checking", delta: -6350 }],
		});
	}

	it("selects the failure month as real rows with the failure flagged", () => {
		const failure = decemberFailure();
		const ledger = failureLedger({
			plan: testAccount,
			projection: checkingProjection([
				move({
					date: "2026-11-05",
					movementId: "living",
					name: "Everyday living",
					requested: 5400,
					realized: 5400,
					fromId: "checking",
					toId: null,
					accountDeltas: [{ accountId: "checking", delta: -5400 }],
				}),
				move({
					date: "2026-12-01",
					movementId: "pay",
					name: "Take-home pay",
					requested: 11200,
					realized: 11200,
					fromId: null,
					toId: "checking",
					accountDeltas: [{ accountId: "checking", delta: 11200 }],
				}),
				move({
					date: "2026-12-20",
					movementId: "living",
					name: "Everyday living",
					requested: 5400,
					realized: 5400,
					fromId: "checking",
					toId: null,
					accountDeltas: [{ accountId: "checking", delta: -5400 }],
				}),
				failure,
			]),
			failure,
		});
		// November stays out; December reads in time order with the same
		// figures the account dialog shows for these transactions.
		expect(ledger?.month).toBe("Dec 2026");
		expect(ledger?.overflow).toBe(0);
		expect(ledger?.rows.map((row) => row.transaction.name)).toEqual([
			"Take-home pay",
			"Home renovation",
			"Everyday living",
		]);
		expect(ledger?.rows.map((row) => row.failing)).toEqual([
			false,
			true,
			false,
		]);
		const failing = ledger?.rows.find((row) => row.failing);
		expect(failing?.transaction).toMatchObject({
			direction: "out",
			amount: 6350,
			requested: 9000,
			shortfall: 2650,
			counterparty: "External spending",
		});
		expect(failing?.planTransaction?.id).toBe("renovation");
		expect(ledger?.rows[0]?.planTransaction?.id).toBe("pay");
		expect(ledger?.summary).toContain(
			"during Dec 2026: Take-home pay Dec 1 +$11,200; " +
				"Home renovation Dec 5 −$6,350, short $2,650; " +
				"Everyday living Dec 20 −$5,400.",
		);
	});

	it("caps peers at the nearest transactions and always shows the failure", () => {
		const failure = move({
			date: "2026-12-15",
			movementId: "renovation",
			name: "Home renovation",
			requested: 9000,
			realized: 6350,
			fromId: "checking",
			toId: null,
			constraintTypes: ["source-floor"],
			accountDeltas: [{ accountId: "checking", delta: -6350 }],
		});
		const busy: MovementResult[] = [];
		for (let day = 1; day <= 7; day++) {
			busy.push(
				move({
					date: `2026-12-${String(day).padStart(2, "0")}`,
					movementId: `extra-${day}`,
					name: `Extra ${day}`,
					requested: 100,
					realized: 100,
					fromId: "checking",
					toId: null,
					accountDeltas: [{ accountId: "checking", delta: -100 }],
				}),
			);
		}
		const ledger = failureLedger({
			plan: testAccount,
			projection: checkingProjection([...busy, failure]),
			failure,
		});
		expect(ledger?.rows.map((row) => row.transaction.date)).toEqual([
			"2026-12-03",
			"2026-12-04",
			"2026-12-05",
			"2026-12-06",
			"2026-12-07",
			"2026-12-15",
		]);
		expect(ledger?.rows.filter((row) => row.failing)).toHaveLength(1);
		expect(ledger?.overflow).toBe(2);
		expect(ledger?.summary).toContain("plus 2 more");
	});

	it("returns null without an internal account", () => {
		const external = move({ fromId: null, toId: null });
		expect(
			failureLedger({
				plan: testAccount,
				projection: checkingProjection([external]),
				failure: external,
			}),
		).toBeNull();
	});
});
