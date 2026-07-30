import { describe, expect, it } from "vitest";
import {
	buildFinancialIndependenceCandidateDates,
	evaluateFinancialIndependence,
	selectFinancialIndependenceOutcomeIndex,
	validateFinancialIndependencePlan,
} from "../evaluation/financialIndependence";
import type {
	Account,
	FinancialIndependencePlan,
	Posting,
	ProjectionPath,
	ProjectionRow,
} from "../types/model";
import { addMonthsClamped, daysBetween } from "../utils/date";

const realizedPostingAmountsByRow = new WeakMap<
	ProjectionRow,
	Record<string, number>
>();

function row(
	date: string,
	balances: Record<string, number>,
	realizedPostingAmountsById: Record<string, number> = {},
): ProjectionRow {
	const projectionRow: ProjectionRow = {
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
	};
	realizedPostingAmountsByRow.set(projectionRow, realizedPostingAmountsById);
	return projectionRow;
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
		annualExpenseTargetBasis: "fi-date-dollars",
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
	let sequence = 0;
	return {
		rows,
		movementEvents: rows.flatMap((projectionRow) =>
			Object.entries(realizedPostingAmountsByRow.get(projectionRow) ?? {}).map(
				([postingId, amount]) => ({
					date: projectionRow.date,
					sequence: sequence++,
					origin: { type: "posting" as const, postingId },
					requestedAmount: amount,
					realizedAmount: amount,
					accountDeltas: [],
				}),
			),
		),
		effectiveDocument: {
			sourcePath: "test",
			accounts,
			postings,
			evaluations: {
				financialIndependence: [],
				netWorthThreshold: [],
				postingFulfillment: [],
			},
		},
		projectionStartDate: "2026-01-01",
		projectionEndDate,
	};
}

function expectedAnnualRequests(
	baselineDate: string,
	candidateDate: string,
	annualExpenseTarget: number,
	annualExpenseGrowthRate: number,
) {
	return (
		Math.round(
			Array.from({ length: 12 }, (_, month) => {
				const periodStart = addMonthsClamped(candidateDate, month);
				const years = daysBetween(baselineDate, periodStart) / 365.2425;
				return (
					(annualExpenseTarget *
						(1 + annualExpenseGrowthRate) ** Math.max(0, years)) /
					12
				);
			}).reduce((sum, expense) => sum + expense, 0) * 100,
		) / 100
	);
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

	it("accepts but removes legacy labor-dependence metadata", () => {
		const normalized = validateFinancialIndependencePlan({
			...plan(),
			sources: [
				{
					type: "cashflow",
					postingId: "pension",
					included: true,
					laborDependent: true,
				},
			],
		});

		expect(normalized.sources).toEqual([
			{ type: "cashflow", postingId: "pension", included: true },
		]);
	});

	it("defaults a missing expense basis and rejects invalid explicit values", () => {
		const { annualExpenseTargetBasis: _missing, ...legacyPlan } = plan();

		expect(
			validateFinancialIndependencePlan(legacyPlan).annualExpenseTargetBasis,
		).toBe("projection-start-purchasing-power");
		expect(() =>
			validateFinancialIndependencePlan({
				...plan(),
				annualExpenseTargetBasis: "future-dollars",
			}),
		).toThrow("Financial independence configuration is invalid.");
	});

	it("normalizes overlapping income and continuing posting treatment", () => {
		const normalized = validateFinancialIndependencePlan({
			...plan(),
			sources: [{ type: "cashflow", postingId: "pension", included: true }],
			continuingPostingIds: ["pension", "portfolio-growth"],
		});

		expect(normalized.continuingPostingIds).toEqual(["portfolio-growth"]);
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

		expect(result.rows[0].assetContributions).toEqual([
			{
				accountId: "first",
				balance: 50_000,
				withdrawalRate: 0.04,
				annualWithdrawalCapacity: 2_000,
			},
			{
				accountId: "second",
				balance: 50_000,
				withdrawalRate: 0.04,
				annualWithdrawalCapacity: 2_000,
			},
		]);
		expect(result.rows[0].selectedAssetBalance).toBe(100_000);
		expect(result.rows[0].annualWithdrawalCapacity).toBe(4_000);
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

	it("reports effective rates and zero-balance selected assets", () => {
		const result = evaluateFinancialIndependence({
			path: path(
				[row("2026-01-01", { brokerage: 100_000, roth: 0 })],
				[],
				[account("brokerage"), account("roth")],
			),
			plan: plan({
				sources: [
					{ type: "asset", accountId: "brokerage", included: true },
					{
						type: "asset",
						accountId: "roth",
						included: true,
						withdrawalRateOverride: 0.05,
					},
				],
			}),
			candidateDates: ["2026-01-01"],
		});

		expect(result.rows[0].assetContributions).toEqual([
			{
				accountId: "brokerage",
				balance: 100_000,
				withdrawalRate: 0.04,
				annualWithdrawalCapacity: 4_000,
			},
			{
				accountId: "roth",
				balance: 0,
				withdrawalRate: 0.05,
				annualWithdrawalCapacity: 0,
			},
		]);
	});

	it("starts spending inflation at each FI candidate", () => {
		const candidateDate = "2030-01-31";
		const annualExpenseTarget = 1_200;
		const annualExpenseGrowthRate = 0.1;
		const result = evaluateFinancialIndependence({
			path: path(
				[row(candidateDate, { brokerage: 100_000 })],
				[],
				[account("brokerage")],
				"2031-01-31",
			),
			plan: plan({
				annualExpenseTarget,
				annualExpenseGrowthRate,
				principalPolicy: "preserve-real-principal",
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
			}),
			candidateDates: [candidateDate],
		});
		const outcome = result.runOutcomes[0];
		const expectedRequested = expectedAnnualRequests(
			candidateDate,
			candidateDate,
			annualExpenseTarget,
			annualExpenseGrowthRate,
		);

		expect(result.rows[0]).toMatchObject({
			annualExpenseTarget,
			isCovered: true,
			isEligible: true,
		});
		expect(outcome.status).toBe("evaluated");
		expect(outcome.withdrawals.requestedAmount).toBe(expectedRequested);
		expect(outcome.endingRealSelectedAssetBalance).toBeCloseTo(
			outcome.endingSelectedAssetBalance / (1 + annualExpenseGrowthRate),
		);
	});

	it("can value FI spending in projection-start purchasing power", () => {
		const projectionStartDate = "2026-01-01";
		const candidateDate = "2030-01-31";
		const annualExpenseTarget = 1_200;
		const annualExpenseGrowthRate = 0.1;
		const result = evaluateFinancialIndependence({
			path: path(
				[row(candidateDate, { brokerage: 100_000 })],
				[],
				[account("brokerage")],
				"2031-01-31",
			),
			plan: plan({
				annualExpenseTarget,
				annualExpenseTargetBasis: "projection-start-purchasing-power",
				annualExpenseGrowthRate,
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
			}),
			candidateDates: [candidateDate],
		});
		const candidateYears =
			daysBetween(projectionStartDate, candidateDate) / 365.2425;

		expect(result.rows[0].annualExpenseTarget).toBeCloseTo(
			annualExpenseTarget * (1 + annualExpenseGrowthRate) ** candidateYears,
		);
		expect(result.runOutcomes[0].withdrawals.requestedAmount).toBe(
			expectedAnnualRequests(
				projectionStartDate,
				candidateDate,
				annualExpenseTarget,
				annualExpenseGrowthRate,
			),
		);
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

	it("does not apply observed cashflow to branch balances a second time", () => {
		const rows = Array.from({ length: 13 }, (_, month) => {
			const year = 2026 + Math.floor(month / 12);
			const monthOfYear = (month % 12) + 1;
			return row(
				`${year}-${String(monthOfYear).padStart(2, "0")}-01`,
				{ cash: 100 },
				{ pension: 100 },
			);
		});
		const result = evaluateFinancialIndependence({
			path: path(rows, [pension], [account("cash")]),
			plan: plan({
				annualExpenseTarget: 1_200,
				sources: [
					{ type: "cashflow", postingId: "pension", included: true },
					{
						type: "asset",
						accountId: "cash",
						included: true,
						withdrawalRateOverride: 0,
					},
				],
			}),
			candidateDates: ["2026-01-01"],
		});

		expect(result.runOutcomes[0]).toMatchObject({
			endingSelectedAssetBalance: 100,
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
			monteCarloSample: {
				annualRatesByPostingId: new Map([["sampled-growth", [0, 0.5]]]),
			},
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

	it("retains monthly account balances only for the selected deterministic cycle", () => {
		const evaluationPath = path(
			[row("2026-01-01", { brokerage: 100_000 })],
			[],
			[account("brokerage")],
			"2027-03-01",
		);
		const result = evaluateFinancialIndependence({
			path: evaluationPath,
			plan: plan({
				principalPolicy: "preserve-nominal-principal",
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
			}),
			candidateDates: ["2026-01-01", "2026-02-01"],
		});

		expect(selectFinancialIndependenceOutcomeIndex(result.runOutcomes)).toBe(1);
		expect(result.runOutcomes[0].balanceTrajectory).toEqual([]);
		expect(result.runOutcomes[1].balanceTrajectory).toHaveLength(13);
		expect(result.runOutcomes[1].balanceTrajectory[0]).toEqual({
			date: "2026-02-01",
			accounts: [{ accountId: "brokerage", balance: 100_000 }],
		});
		expect(result.runOutcomes[1].balanceTrajectory[1]).toEqual({
			date: "2026-03-01",
			accounts: [{ accountId: "brokerage", balance: 99_900 }],
		});
		expect(result.runOutcomes[1].balanceTrajectory[12]).toEqual({
			date: "2027-02-01",
			accounts: [{ accountId: "brokerage", balance: 98_800 }],
		});

		const successful = evaluateFinancialIndependence({
			path: evaluationPath,
			plan: plan({
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
			}),
			candidateDates: ["2026-01-01", "2026-02-01"],
		});
		expect(
			selectFinancialIndependenceOutcomeIndex(successful.runOutcomes),
		).toBe(0);
		expect(successful.runOutcomes[0].balanceTrajectory).toHaveLength(13);
		expect(successful.runOutcomes[1].balanceTrajectory).toEqual([]);

		const allIneligible = evaluateFinancialIndependence({
			path: evaluationPath,
			plan: plan(),
			candidateDates: ["2026-01-01", "2026-02-01"],
		});
		expect(
			selectFinancialIndependenceOutcomeIndex(allIneligible.runOutcomes),
		).toBe(1);

		const stochastic = evaluateFinancialIndependence({
			path: evaluationPath,
			plan: plan({
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
			}),
			candidateDates: ["2026-01-01"],
			monteCarloSample: { annualRatesByPostingId: new Map() },
		});
		expect(stochastic.runOutcomes[0].balanceTrajectory).toEqual([]);
	});
});
