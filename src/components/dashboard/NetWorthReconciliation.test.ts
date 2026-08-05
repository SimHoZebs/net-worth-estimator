import { describe, expect, it } from "vitest";
import type { ProjectionResult } from "@/lib/projection";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import { buildReconciliationRows } from "./NetWorthReconciliation";

const result: ProjectionResult = {
	timeline: {
		rows: [
			{
				date: "2026-01-31",
				isHistorical: true,
				netWorth: 1950,
				accountSnapshots: [
					{
						accountId: "checking",
						date: "2026-01-31",
						balance: 750,
						impacts: [],
					},
				],
				externalInflowAmount: 0,
				externalOutflowAmount: 0,
				internalTransferAmount: 0,
				checkpointCorrections: [
					{
						accountId: "checking",
						observedBalance: 750,
						modeledBalance: 700,
						adjustment: 50,
					},
				],
			},
		],
		sampledRows: [],
	},
	accountSummaries: [
		{
			accountId: "checking",
			label: "Checking",
			color: null,
			enabled: true,
			startingBalance: 800,
			endingBalance: 900,
		},
		{
			accountId: "brokerage",
			label: "Brokerage",
			color: null,
			enabled: true,
			startingBalance: 1200,
			endingBalance: 1300,
		},
	],
	totals: {
		externalInflowAmount: 0,
		externalOutflowAmount: 0,
		internalTransferAmount: 0,
	},
	milestones: {
		latestHistoricalDate: null,
		projectionStartDate: "2026-02-01",
	},
	summary: { currentNetWorth: 2000, finalNetWorth: 2200 },
	evaluations: {
		financialIndependence: [],
		netWorthThreshold: [],
		postingFulfillment: [],
	},
};

describe("buildReconciliationRows", () => {
	it("uses the latest absolute checkpoint without replacing modeled balances", () => {
		const document = createBaseDocument({
			checkpoints: [
				{ Date: "2026-01-01", AccountId: "checking", Balance: 700 },
				{ Date: "2026-01-31", AccountId: "checking", Balance: 750 },
			],
		});

		expect(buildReconciliationRows(document, result)).toEqual([
			{
				accountId: "checking",
				label: "Checking",
				checkpoint: {
					Date: "2026-01-31",
					AccountId: "checking",
					Balance: 750,
				},
				modeledBalanceAtCheckpoint: 700,
				projectionStartBalance: 800,
			},
			{
				accountId: "brokerage",
				label: "Brokerage",
				checkpoint: null,
				modeledBalanceAtCheckpoint: null,
				projectionStartBalance: 1200,
			},
		]);
	});
});
