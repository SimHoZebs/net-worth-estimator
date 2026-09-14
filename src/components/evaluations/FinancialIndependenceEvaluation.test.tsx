// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	EvaluationInstance,
	FinancialIndependenceAnalysis,
	FinancialModelDocument,
	ProjectionResult,
} from "@/lib/projection";
import { createBaseDocument, makeAccount } from "@/lib/projection/__fixtures__";
import { FinancialIndependenceEvaluation } from "./FinancialIndependenceEvaluation";

vi.mock("@/components/dashboard/FinancialIndependenceChart", () => ({
	FinancialIndependenceChart: () => <div>FI balance chart</div>,
}));

afterEach(cleanup);

describe("FinancialIndependenceEvaluation", () => {
	it("shows the structured result for the selected ineligible candidate", () => {
		const { document, evaluation, result } = buildIneligibleProjection();

		render(
			<FinancialIndependenceEvaluation
				evaluation={evaluation}
				document={document}
				result={result}
				sourceRevision={0}
			/>,
		);

		expect(screen.getByText("Feb 1, 2027")).not.toBeNull();
		expect(screen.getByText("1-year test")).not.toBeNull();
		expect(screen.getByText("Not ready")).not.toBeNull();
		expect(screen.getByRole("region", { name: "Net worth" })).not.toBeNull();
		expect(
			screen.getByRole("region", { name: "FI-date annual capacity" }),
		).not.toBeNull();
		expect(
			screen.queryByText("This plan cannot begin", { exact: false }),
		).toBeNull();
		expect(screen.getByText("Brokerage")).not.toBeNull();
		expect(screen.queryByText("Behavior evidence")).toBeNull();
		expect(screen.queryByText("Requested withdrawals")).toBeNull();
		expect(screen.queryByText("shortfall probability")).toBeNull();
		expect(screen.getByText("FI balance chart")).not.toBeNull();
	});
});

function buildIneligibleProjection(): {
	document: FinancialModelDocument;
	evaluation: EvaluationInstance<unknown>;
	result: ProjectionResult;
} {
	const document = createBaseDocument({
		accounts: [makeAccount({ id: "brokerage", label: "Brokerage" })],
		postings: [],
	});
	const evaluation: EvaluationInstance<unknown> = {
		instanceId: "fi",
		label: "Financial independence",
		enabled: true,
		config: {
			minimumNetWorth: 1_000_000,
			annualExpenseTarget: 100_000,
			annualExpenseTargetBasis: "fi-date-dollars",
			annualExpenseGrowthRate: 0,
			withdrawalRate: 0.04,
			evaluationYears: 1,
			requiredConfidence: 0.9,
			sources: [{ type: "asset", accountId: "brokerage", included: true }],
			continuingPostingIds: [],
			principalPolicy: "allow-drawdown",
		},
	};
	const analysis: FinancialIndependenceAnalysis = {
		rows: [
			{
				date: "2027-02-01",
				netWorth: 10_000,
				minimumNetWorth: 1_000_000,
				minimumNetWorthMet: false,
				annualDirectIncome: 0,
				assetContributions: [
					{
						accountId: "brokerage",
						balance: 10_000,
						withdrawalRate: 0.04,
						annualWithdrawalCapacity: 400,
					},
				],
				selectedAssetBalance: 10_000,
				annualWithdrawalCapacity: 400,
				totalAnnualCapacity: 400,
				annualExpenseTarget: 100_000,
				coverageRatio: 0.004,
				isCovered: false,
				isEligible: false,
			},
		],
		runOutcomes: [
			{
				candidateDate: "2027-02-01",
				status: "ineligible",
				minimumNetWorthMet: false,
				initialCoverageMet: false,
				expensesFullyCovered: false,
				hadWithdrawalShortfall: true,
				startingSelectedAssetBalance: 10_000,
				endingSelectedAssetBalance: 0,
				startingRealSelectedAssetBalance: 10_000,
				endingRealSelectedAssetBalance: 0,
				principalReplenished: false,
				cycleEstablished: false,
				withdrawals: {
					requestedAmount: 100_000,
					realizedAmount: 10_000,
					shortfallAmount: 90_000,
					firstShortfallDate: "2027-02-01",
					lastShortfallDate: "2028-01-01",
					shortfallOccurrenceCount: 12,
					constraints: [],
					relatedAccountIds: ["brokerage"],
					accounts: [],
					firstShortfall: null,
				},
				balanceTrajectory: [],
			},
		],
		milestones: { firstCoverageDate: null, firstSelfSustainingDate: null },
	};
	const result: ProjectionResult = {
		timeline: { rows: [], sampledRows: [] },
		accountSummaries: [],
		totals: {
			externalInflowAmount: 0,
			externalOutflowAmount: 0,
			internalTransferAmount: 0,
		},
		milestones: {
			latestHistoricalDate: null,
			projectionStartDate: "2026-02-01",
		},
		summary: { currentNetWorth: 10_000, finalNetWorth: 10_000 },
		evaluations: {
			financialIndependence: [
				{
					instanceId: "fi",
					label: "Financial independence",
					status: "not-satisfied",
					deterministic: JSON.parse(JSON.stringify(analysis)),
					probabilistic: null,
					diagnostics: [],
				},
			],
			netWorthThreshold: [],
			postingFulfillment: [],
		},
	};
	return { document, evaluation, result };
}
