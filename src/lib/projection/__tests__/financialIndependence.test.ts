import { describe, expect, it } from "vitest";
import {
	buildFinancialIndependenceCandidateDates,
	evaluateFinancialIndependence,
} from "../engine/financialIndependence";
import type {
	Account,
	FinancialIndependencePlan,
	Posting,
	ProjectionPath,
	ProjectionRow,
} from "../types/scenario";
import { SCENARIO_MODEL_VERSION } from "../types/scenario";

function row(
	date: string,
	balances: Record<string, number>,
	realizedPostingAmountsById: Record<string, number> = {},
): ProjectionRow {
	return {
		date,
		isHistorical: false,
		netWorth: Object.values(balances).reduce((sum, value) => sum + value, 0),
		accountSnapshots: Object.entries(balances).map(([accountId, balance]) => ({
			accountId,
			date,
			balance,
			impacts: [],
		})),
		externalInflowAmount: 0,
		externalOutflowAmount: 0,
		internalTransferAmount: 0,
		requestedPostingAmount: 0,
		realizedPostingAmount: 0,
		clampedPostingShortfallAmount: 0,
		requestedPostingAmountsById: realizedPostingAmountsById,
		realizedPostingAmountsById,
	};
}

function account(id: string, minBalance = 0): Account {
	return {
		id,
		label: id,
		minBalance,
		maxBalance: Number.POSITIVE_INFINITY,
		color: null,
		enabled: true,
	};
}

const pension: Posting = {
	id: "pension",
	label: "Pension",
	sourceAccountId: null,
	destinations: ["cash"],
	arithmetic: "100",
	frequency: "monthly",
	annualRate: 0,
	annualGrowthRate: 0,
	volatility: 0,
	startDate: "2026-01-01",
	endDate: null,
	annualCap: null,
	priority: 1,
	enabled: true,
};

function plan(
	overrides: Partial<FinancialIndependencePlan> = {},
): FinancialIndependencePlan {
	return {
		minimumNetWorth: 0,
		annualExpenseTarget: 1_200,
		annualExpenseGrowthRate: 0,
		withdrawalRate: 0.04,
		evaluationYears: 1,
		requiredConfidence: 0.9,
		sources: [],
		continuingPostingIds: [],
		principalPolicy: "allow-drawdown",
		...overrides,
	};
}

function path(
	rows: ProjectionRow[],
	postings: Posting[] = [],
	accounts: Account[] = [account("cash")],
	projectionEndDate = "2027-02-01",
): ProjectionPath {
	return {
		rows,
		effectivePack: {
			version: SCENARIO_MODEL_VERSION,
			sourcePath: "test",
			accounts,
			postings,
			checkpoints: [],
		},
		projectionStartDate: "2026-01-01",
		projectionEndDate,
	};
}

describe("evaluateFinancialIndependence", () => {
	it("annualizes only explicitly selected realized cashflows", () => {
		const rows = Array.from({ length: 14 }, (_, month) => {
			const year = 2026 + Math.floor(month / 12);
			const monthOfYear = (month % 12) + 1;
			return row(
				`${year}-${String(monthOfYear).padStart(2, "0")}-01`,
				{ cash: 0 },
				{ pension: 100, salary: 10_000 },
			);
		});
		const result = evaluateFinancialIndependence({
			path: path(rows, [pension]),
			plan: plan({
				sources: [{ type: "cashflow", postingId: "pension", included: true }],
			}),
			candidateDates: ["2026-01-01"],
		});

		expect(result.rows[0].annualDirectIncome).toBe(1_200);
		expect(result.rows[0].totalAnnualCapacity).toBe(1_200);
		expect(result.milestones.firstCoverageDate).toBe("2026-01-01");
		expect(result.milestones.firstSelfSustainingDate).toBe("2026-01-01");
	});

	it("can evaluate a zero-balance start before the first projected event", () => {
		const rows = Array.from({ length: 12 }, (_, month) => {
			const offset = month + 1;
			const year = 2026 + Math.floor(offset / 12);
			const monthOfYear = (offset % 12) + 1;
			return row(
				`${year}-${String(monthOfYear).padStart(2, "0")}-01`,
				{ cash: 0 },
				{ pension: 100 },
			);
		});
		const result = evaluateFinancialIndependence({
			path: path(rows, [pension]),
			plan: plan({
				sources: [{ type: "cashflow", postingId: "pension", included: true }],
			}),
			candidateDates: ["2026-01-01"],
		});

		expect(result.runOutcomes[0]).toMatchObject({
			status: "evaluated",
			cycleEstablished: true,
		});
	});

	it("keeps covered candidates ineligible until minimum net worth is met", () => {
		const result = evaluateFinancialIndependence({
			path: path(
				[row("2026-01-01", { brokerage: 100_000 })],
				[],
				[account("brokerage")],
			),
			plan: plan({
				minimumNetWorth: 150_000,
				annualExpenseTarget: 4_000,
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
			}),
			candidateDates: ["2026-01-01"],
		});

		expect(result.rows[0]).toMatchObject({
			isCovered: true,
			minimumNetWorthMet: false,
			isEligible: false,
		});
		expect(result.runOutcomes[0]).toMatchObject({
			status: "ineligible",
			cycleEstablished: false,
		});
	});

	it("enforces account floors and annual withdrawal capacity", () => {
		const result = evaluateFinancialIndependence({
			path: path(
				[row("2026-01-01", { brokerage: 100_000 })],
				[],
				[account("brokerage", 98_000)],
			),
			plan: plan({
				annualExpenseTarget: 4_000,
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
			}),
			candidateDates: ["2026-01-01"],
		});

		expect(result.runOutcomes[0]).toMatchObject({
			status: "evaluated",
			hadWithdrawalShortfall: true,
			endingSelectedAssetBalance: 98_000,
			cycleEstablished: false,
		});
	});

	it("never withdraws from an asset with a zero-rate override", () => {
		const result = evaluateFinancialIndependence({
			path: path(
				Array.from({ length: 14 }, (_, month) =>
					row(
						`202${6 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}-01`,
						{ brokerage: 100_000, cash: 0 },
						{ pension: month < 7 ? 1_000 : 0 },
					),
				),
				[pension],
				[account("brokerage"), account("cash")],
			),
			plan: plan({
				annualExpenseTarget: 6_000,
				sources: [
					{ type: "cashflow", postingId: "pension", included: true },
					{
						type: "asset",
						accountId: "brokerage",
						included: true,
						withdrawalRateOverride: 0,
					},
				],
			}),
			candidateDates: ["2026-01-01"],
		});

		expect(result.runOutcomes[0]).toMatchObject({
			hadWithdrawalShortfall: true,
			endingSelectedAssetBalance: 100_000,
		});
	});

	it("replays only explicitly selected continuing postings", () => {
		const growth: Posting = {
			...pension,
			id: "growth",
			label: "Growth",
			destinations: ["brokerage"],
			arithmetic: "brokerage * rate",
			annualRate: 0.12,
			startDate: "2026-02-01",
		};
		const rows = [row("2026-01-01", { brokerage: 100_000, cash: 0 })];
		const withoutGrowth = evaluateFinancialIndependence({
			path: path(rows, [growth], [account("brokerage"), account("cash")]),
			plan: plan({
				annualExpenseTarget: 4_000,
				principalPolicy: "preserve-nominal-principal",
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
			}),
			candidateDates: ["2026-01-01"],
		});
		const withGrowth = evaluateFinancialIndependence({
			path: path(rows, [growth], [account("brokerage"), account("cash")]),
			plan: plan({
				annualExpenseTarget: 4_000,
				principalPolicy: "preserve-nominal-principal",
				continuingPostingIds: ["growth"],
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
			}),
			candidateDates: ["2026-01-01"],
		});

		expect(withoutGrowth.runOutcomes[0].principalReplenished).toBe(false);
		expect(withGrowth.runOutcomes[0].principalReplenished).toBe(true);
	});

	it("carries current-year annual-cap usage into a policy branch", () => {
		const cappedGrowth: Posting = {
			...pension,
			id: "capped-growth",
			label: "Capped growth",
			destinations: ["brokerage"],
			arithmetic: "500",
			annualCap: 1_000,
			startDate: "2026-01-01",
		};
		const rows = Array.from({ length: 19 }, (_, month) => {
			const offset = month + 6;
			const year = 2026 + Math.floor(offset / 12);
			const monthOfYear = (offset % 12) + 1;
			return row(
				`${year}-${String(monthOfYear).padStart(2, "0")}-01`,
				{ brokerage: 100_000, cash: 0 },
				month === 0 ? { "capped-growth": 800 } : { pension: 100 },
			);
		});
		const result = evaluateFinancialIndependence({
			path: {
				...path(
					rows,
					[cappedGrowth, pension],
					[account("brokerage"), account("cash")],
					"2027-08-01",
				),
				projectionStartDate: "2026-01-01",
			},
			plan: plan({
				annualExpenseTarget: 1_200,
				continuingPostingIds: ["capped-growth"],
				sources: [
					{ type: "cashflow", postingId: "pension", included: true },
					{
						type: "asset",
						accountId: "brokerage",
						included: true,
						withdrawalRateOverride: 0,
					},
				],
			}),
			candidateDates: ["2026-07-01"],
		});

		// $200 remains on the 2026 cap, followed by a fresh $1,000 cap in 2027.
		expect(result.runOutcomes[0].endingSelectedAssetBalance).toBe(101_200);
	});

	it("uses one canonical monthly candidate schedule", () => {
		expect(
			buildFinancialIndependenceCandidateDates("2026-01-31", "2027-04-30", 1),
		).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
	});

	it("does not report vacuous coverage when no sources are selected", () => {
		const result = evaluateFinancialIndependence({
			path: path([row("2026-01-01", { brokerage: 100_000 })]),
			plan: plan(),
			candidateDates: ["2026-01-01"],
		});

		expect(result.rows[0].coverageRatio).toBe(0);
		expect(result.milestones.firstCoverageDate).toBeNull();
		expect(result.runOutcomes[0].status).toBe("ineligible");
	});
});
