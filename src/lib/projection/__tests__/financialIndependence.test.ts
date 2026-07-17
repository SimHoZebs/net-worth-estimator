import { describe, expect, it } from "vitest";
import { evaluateFinancialIndependence } from "../engine/financialIndependence";
import type {
	FinancialIndependencePlan,
	Posting,
	ProjectionRow,
} from "../types/scenario";

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

const posting: Posting = {
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
		annualExpenseTarget: 1_200,
		annualExpenseGrowthRate: 0,
		withdrawalRate: 0.04,
		evaluationYears: 1,
		requiredConfidence: 0.9,
		sources: [],
		principalPolicy: "allow-drawdown",
		...overrides,
	};
}

describe("evaluateFinancialIndependence", () => {
	it("annualizes only explicitly selected realized cashflows", () => {
		const rows = Array.from({ length: 13 }, (_, month) => {
			const year = 2026 + Math.floor(month / 12);
			const monthOfYear = (month % 12) + 1;
			return row(
				`${year}-${String(monthOfYear).padStart(2, "0")}-01`,
				{ cash: 0 },
				{ pension: 100, salary: 10_000 },
			);
		});
		const result = evaluateFinancialIndependence({
			rows,
			postings: [posting],
			plan: plan({
				sources: [{ type: "cashflow", postingId: "pension", included: true }],
			}),
			projectionStartDate: "2026-01-01",
			projectionEndDate: "2027-02-01",
		});

		expect(result.rows[0].annualDirectIncome).toBe(1_200);
		expect(result.rows[0].totalAnnualCapacity).toBe(1_200);
		expect(result.milestones.firstCoverageDate).toBe("2026-01-01");
		expect(result.milestones.firstSelfSustainingDate).toBe("2026-01-01");
	});

	it("applies per-asset withdrawal-rate overrides without counting debt", () => {
		const result = evaluateFinancialIndependence({
			rows: [row("2026-01-01", { brokerage: 100_000, debt: -50_000 })],
			postings: [],
			plan: plan({
				annualExpenseTarget: 8_000,
				sources: [
					{
						type: "asset",
						accountId: "brokerage",
						included: true,
						withdrawalRateOverride: 0.08,
					},
					{ type: "asset", accountId: "debt", included: true },
				],
			}),
			projectionStartDate: "2026-01-01",
			projectionEndDate: "2027-02-01",
		});

		expect(result.rows[0].selectedAssetBalance).toBe(100_000);
		expect(result.rows[0].annualWithdrawalCapacity).toBe(8_000);
		expect(result.rows[0].isCovered).toBe(true);
	});

	it("distinguishes initial coverage from principal replenishment", () => {
		const result = evaluateFinancialIndependence({
			rows: [row("2026-01-01", { brokerage: 100_000 })],
			postings: [],
			plan: plan({
				annualExpenseTarget: 4_000,
				principalPolicy: "preserve-nominal-principal",
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
			}),
			projectionStartDate: "2026-01-01",
			projectionEndDate: "2027-02-01",
		});

		expect(result.milestones.firstCoverageDate).toBe("2026-01-01");
		expect(result.runOutcomes[0]).toMatchObject({
			expensesFullyCovered: true,
			principalReplenished: false,
			cycleEstablished: false,
		});
		expect(result.milestones.firstSelfSustainingDate).toBeNull();
	});

	it("does not replay growth already included in the candidate balance", () => {
		const candidate = row("2026-01-01", { brokerage: 100_000 });
		candidate.accountSnapshots[0].impacts = [
			{ postingId: "growth", delta: 10_000 },
		];
		const result = evaluateFinancialIndependence({
			rows: [candidate, row("2027-01-01", { brokerage: 100_000 })],
			postings: [{ ...posting, id: "growth", annualRate: 0.1 }],
			plan: plan({
				annualExpenseTarget: 10_000,
				withdrawalRate: 0.1,
				principalPolicy: "preserve-nominal-principal",
				sources: [{ type: "asset", accountId: "brokerage", included: true }],
			}),
			projectionStartDate: "2026-01-01",
			projectionEndDate: "2027-02-01",
		});

		expect(result.runOutcomes[0]).toMatchObject({
			endingSelectedAssetBalance: 90_000,
			principalReplenished: false,
			cycleEstablished: false,
		});
	});

	it("normalizes fractional evaluation years", () => {
		expect(() =>
			evaluateFinancialIndependence({
				rows: [row("2026-01-01", { brokerage: 100_000 })],
				postings: [],
				plan: plan({
					evaluationYears: 1.5,
					annualExpenseTarget: 4_000,
					sources: [{ type: "asset", accountId: "brokerage", included: true }],
				}),
				projectionStartDate: "2026-01-01",
				projectionEndDate: "2027-02-01",
			}),
		).not.toThrow();
	});

	it("does not report vacuous coverage when no sources are selected", () => {
		const result = evaluateFinancialIndependence({
			rows: [row("2026-01-01", { brokerage: 100_000 })],
			postings: [],
			plan: plan(),
			projectionStartDate: "2026-01-01",
			projectionEndDate: "2027-02-01",
		});

		expect(result.rows[0].coverageRatio).toBe(0);
		expect(result.milestones.firstCoverageDate).toBeNull();
		expect(result.runOutcomes).toEqual([]);
	});
});
