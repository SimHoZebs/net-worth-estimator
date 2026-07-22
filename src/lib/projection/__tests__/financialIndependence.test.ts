import { describe, expect, it } from "vitest";
import {
	buildFinancialIndependenceCandidateDates,
	evaluateFinancialIndependence,
	validateFinancialIndependencePlan,
} from "../evaluation/financialIndependence";
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
		movementEvents: [],
		effectivePack: {
			version: SCENARIO_MODEL_VERSION,
			sourcePath: "test",
			accounts,
			postings,
			checkpoints: [],
			evaluations: [],
		},
		projectionStartDate: "2026-01-01",
		projectionEndDate,
	};
}

describe("evaluateFinancialIndependence", () => {
	it("rejects malformed optional source properties", () => {
		expect(() =>
			validateFinancialIndependencePlan({
				...plan(),
				sources: [
					{
						type: "asset",
						accountId: "brokerage",
						included: true,
						withdrawalRateOverride: Number.POSITIVE_INFINITY,
					},
				],
			}),
		).toThrow("Financial independence configuration is invalid.");
		expect(() =>
			validateFinancialIndependencePlan({
				...plan(),
				sources: [
					{
						type: "cashflow",
						postingId: "pension",
						included: true,
						laborDependent: "yes",
					},
				],
			}),
		).toThrow("Financial independence configuration is invalid.");
	});

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
			withdrawals: {
				requestedAmount: 0,
				realizedAmount: 0,
				shortfallAmount: 0,
				firstShortfallDate: null,
			},
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
			withdrawals: {
				shortfallAmount: 2_000,
				firstShortfallDate: "2026-07-01",
				relatedAccountIds: ["brokerage"],
			},
		});
		expect(result.runOutcomes[0].withdrawals.constraints).toContainEqual({
			type: "source-floor",
			count: 6,
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
		expect(result.runOutcomes[0].withdrawals).toMatchObject({
			firstShortfallDate: "2026-07-01",
			shortfallOccurrenceCount: 6,
			accounts: [{ accountId: "brokerage" }],
			firstShortfall: {
				requestedAmount: 500,
				realizedAmount: 0,
				shortfallAmount: 500,
				constraints: ["action-limit"],
			},
		});
		expect(result.runOutcomes[0].withdrawals.constraints).toContainEqual({
			type: "action-limit",
			count: 6,
		});
	});

	it("summarizes source-floor and action constraints across multiple assets", () => {
		const result = evaluateFinancialIndependence({
			path: path(
				[row("2026-01-01", { first: 50_000, second: 50_000 })],
				[],
				[account("first", 49_000), account("second", 48_000)],
			),
			plan: plan({
				annualExpenseTarget: 4_000,
				sources: [
					{ type: "asset", accountId: "first", included: true },
					{ type: "asset", accountId: "second", included: true },
				],
			}),
			candidateDates: ["2026-01-01"],
		});

		const summary = result.runOutcomes[0].withdrawals;
		expect(summary.requestedAmount).toBe(4_000);
		expect(summary.realizedAmount).toBe(3_000);
		expect(summary.shortfallAmount).toBe(1_000);
		expect(summary.accounts).toHaveLength(2);
		expect(summary.relatedAccountIds).toEqual(["first", "second"]);
		expect(summary.constraints.map((constraint) => constraint.type)).toEqual([
			"source-floor",
			"action-limit",
		]);
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

	it("carries current-year annual-cap usage into a behavior branch", () => {
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

	it("sorts and deduplicates candidates and excludes incomplete cycles", () => {
		const result = evaluateFinancialIndependence({
			path: path(
				[row("2026-01-01", { brokerage: 100_000 })],
				[],
				[account("brokerage")],
			),
			plan: plan({
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
			}),
			candidateDates: ["2026-03-01", "2026-02-01", "2026-01-01", "2026-02-01"],
		});

		expect(result.rows.map((candidate) => candidate.date)).toEqual([
			"2026-01-01",
			"2026-02-01",
		]);
	});

	it("starts the branch after all candidate-date events", () => {
		const growth: Posting = {
			...pension,
			id: "growth",
			label: "Growth",
			destinations: ["brokerage"],
			arithmetic: "10",
			frequency: "annual",
			startDate: "2026-01-01",
		};
		const rows = Array.from({ length: 13 }, (_, month) => {
			const year = 2026 + Math.floor(month / 12);
			const monthOfYear = (month % 12) + 1;
			return row(
				`${year}-${String(monthOfYear).padStart(2, "0")}-01`,
				{ brokerage: 110, cash: 0 },
				month === 0 ? { growth: 10, pension: 100 } : { pension: 100 },
			);
		});
		const result = evaluateFinancialIndependence({
			path: path(
				rows,
				[growth, pension],
				[account("brokerage"), account("cash")],
			),
			plan: plan({
				continuingPostingIds: ["growth"],
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

		expect(result.runOutcomes[0].endingSelectedAssetBalance).toBe(120);
	});

	it("observes base cashflow before dependent replay on the same date", () => {
		const contribution: Posting = {
			...pension,
			id: "contribution",
			label: "Contribution",
			destinations: ["brokerage"],
			arithmetic: "pension * 0.5",
			startDate: "2026-02-01",
			priority: 2,
		};
		const rows = Array.from({ length: 13 }, (_, month) => {
			const year = 2026 + Math.floor(month / 12);
			const monthOfYear = (month % 12) + 1;
			return row(
				`${year}-${String(monthOfYear).padStart(2, "0")}-01`,
				{ brokerage: 100_000, cash: 0 },
				{ pension: 200 },
			);
		});
		const result = evaluateFinancialIndependence({
			path: path(
				rows,
				[pension, contribution],
				[account("brokerage"), account("cash")],
			),
			plan: plan({
				annualExpenseTarget: 2_400,
				continuingPostingIds: ["contribution"],
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
			endingSelectedAssetBalance: 101_200,
			expensesFullyCovered: true,
		});
	});

	it("reuses the base path sampled rate for the same projection year", () => {
		const growth: Posting = {
			...pension,
			id: "sampled-growth",
			label: "Sampled growth",
			destinations: ["brokerage"],
			arithmetic: "brokerage * rate",
			frequency: "annual",
			annualRate: 0.1,
			volatility: 0.2,
			startDate: "2027-01-01",
		};
		const rows = Array.from({ length: 13 }, (_, month) => {
			const year = 2026 + Math.floor(month / 12);
			const monthOfYear = (month % 12) + 1;
			return row(
				`${year}-${String(monthOfYear).padStart(2, "0")}-01`,
				{ brokerage: 100, cash: 0 },
				{ pension: 100 },
			);
		});
		const result = evaluateFinancialIndependence({
			path: path(
				rows,
				[pension, growth],
				[account("brokerage"), account("cash")],
			),
			plan: plan({
				continuingPostingIds: ["sampled-growth"],
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
			stochasticRates: new Map([["sampled-growth", [0, 0.5]]]),
			candidateDates: ["2026-01-01"],
		});

		expect(result.runOutcomes[0].endingSelectedAssetBalance).toBe(150);
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
