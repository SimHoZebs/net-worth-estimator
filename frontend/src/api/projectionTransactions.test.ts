import { describe, expect, it } from "vitest";
import { deriveFundingGaps } from "../domain/fundingGaps.ts";
import { financialModelFixture } from "../mocks/financialModel.ts";
import { projectionFixture } from "../mocks/projection.ts";
import type {
	FinancialModelDocument,
	TransactionEvent,
	ProjectionResult,
} from "./contracts.ts";
import { projectionTransactions } from "./projectionTransactions.ts";

function serverProjection(events: TransactionEvent[]): ProjectionResult {
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
		transactionEvents: events,
	};
}

function event(overrides: Partial<TransactionEvent> = {}): TransactionEvent {
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

describe("projection transaction evidence", () => {
	it("retains canonical fulfillment without a configured evaluation", () => {
		const transactions = projectionTransactions(
			serverProjection([event()]),
			null,
		);
		expect(transactions[0]).toMatchObject({
			transactionId: "bill",
			fromId: "checking",
			available: 100,
			constraintTypes: ["source-floor"],
			fulfillment: { unfulfilledAmount: 100, destinationLimitedAmount: 0 },
		});
		const gaps = deriveFundingGaps({
			accounts: financialModelFixture.accounts,
			transactions: financialModelFixture.transactions,
			startDate: financialModelFixture.startDate,
			projection: projectionFixture({ transactions }),
		});
		expect(gaps).toHaveLength(1);
		expect(gaps[0]?.unfulfilledAmount).toBe(100);
	});

	it("does not turn a destination ceiling into a funding gap", () => {
		const transactions = projectionTransactions(
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
		expect(transactions[0]?.constraintTypes).toEqual(["destination-ceiling"]);
		expect(
			deriveFundingGaps({
				accounts: financialModelFixture.accounts,
				transactions: financialModelFixture.transactions,
				startDate: financialModelFixture.startDate,
				projection: projectionFixture({ transactions }),
			}),
		).toEqual([]);
	});

	it("preserves same-day execution order and excludes historical events", () => {
		const transactions = projectionTransactions(
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
		expect(
			transactions.map((transaction) => transaction.transactionId),
		).toEqual(["z-first", "a-second"]);
	});

	it("resolves names from the document index with postings winning ties", () => {
		const document = {
			checkpoints: [],
			postings: [
				{
					id: "bill",
					name: "Electric bill",
					sourceAccountId: "checking",
					destinations: ["utility"],
					enabled: true,
				},
			],
			recurrenceRules: [
				{
					id: "bill",
					name: "Stale rule bill",
					sourceAccountId: "savings",
					destinations: ["utility"],
					enabled: true,
				},
			],
		} as unknown as FinancialModelDocument;
		const transactions = projectionTransactions(
			serverProjection([event()]),
			document,
		);
		expect(transactions[0]).toMatchObject({
			transactionId: "bill",
			name: "Electric bill",
			fromId: "checking",
			toId: "utility",
		});
	});
});
