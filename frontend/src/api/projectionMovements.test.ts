import { describe, expect, it } from "vitest";
import { deriveFundingGaps } from "../domain/fundingGaps.ts";
import { testPlan } from "../test/plan.ts";
import { projectionFixture } from "../test/projection.ts";
import type { MovementEvent, ProjectionResult } from "./contracts.ts";
import { projectionMovements } from "./projectionMovements.ts";

function serverProjection(events: MovementEvent[]): ProjectionResult {
	return {
		timeline: { rows: [] },
		accountSummaries: [],
		totals: {
			externalInflowAmount: 0,
			externalOutflowAmount: 0,
			internalTransferAmount: 0,
		},
		milestones: {
			latestHistoricalDate: null,
			projectionStartDate: "2026-01-31",
		},
		summary: { currentNetWorth: 0, finalNetWorth: 0 },
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [],
			accountBalance: [],
			postingFulfillment: [],
		},
		movementEvents: events,
	};
}

function event(overrides: Partial<MovementEvent> = {}): MovementEvent {
	return {
		date: "2026-02-05",
		sequence: 1,
		origin: { type: "posting", postingId: "bill" },
		requestedAmount: 200,
		realizedAmount: 100,
		accountDeltas: [{ accountId: "checking", delta: -100 }],
		bindingConstraints: [{ type: "source-floor", accountId: "checking" }],
		availableAmount: 100,
		fulfillment: { unfulfilledAmount: 100, destinationLimitedAmount: 0 },
		...overrides,
	};
}

describe("projection movement evidence", () => {
	it("retains canonical fulfillment without a configured evaluation", () => {
		const movements = projectionMovements(serverProjection([event()]), null);
		expect(movements[0]).toMatchObject({
			movementId: "bill",
			fromId: "checking",
			available: 100,
			constraintTypes: ["source-floor"],
			fulfillment: { unfulfilledAmount: 100, destinationLimitedAmount: 0 },
		});
		const gaps = deriveFundingGaps({
			plan: testPlan,
			projection: projectionFixture({ movements }),
		});
		expect(gaps).toHaveLength(1);
		expect(gaps[0]?.unfulfilledAmount).toBe(100);
	});

	it("does not turn a destination ceiling into a funding gap", () => {
		const movements = projectionMovements(
			serverProjection([
				event({
					bindingConstraints: [
						{ type: "destination-ceiling", accountIds: ["loan"] },
					],
					fulfillment: { unfulfilledAmount: 0, destinationLimitedAmount: 100 },
				}),
			]),
			null,
		);
		expect(movements[0]?.constraintTypes).toEqual(["destination-ceiling"]);
		expect(
			deriveFundingGaps({
				plan: testPlan,
				projection: projectionFixture({ movements }),
			}),
		).toEqual([]);
	});

	it("preserves same-day execution order and excludes historical events", () => {
		const movements = projectionMovements(
			serverProjection([
				event({ date: "2026-01-30", sequence: 0 }),
				event({
					sequence: 1,
					origin: { type: "posting", postingId: "z-first" },
				}),
				event({
					sequence: 2,
					origin: { type: "posting", postingId: "a-second" },
				}),
			]),
			null,
		);
		expect(movements.map((movement) => movement.movementId)).toEqual([
			"z-first",
			"a-second",
		]);
	});
});
