// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
	FinancialIndependenceDetailedRunOutcome,
	FinancialIndependencePlan,
	FinancialIndependenceRow,
} from "@/lib/projection";
import {
	createBaseDocument,
	makeAccount,
	makePosting,
} from "@/lib/projection/__fixtures__";
import { OverviewCard } from "./OverviewCard";

afterEach(cleanup);

describe("OverviewCard", () => {
	it("replaces the FI metric dashboard with a structured source result", () => {
		const { document, plan, row, outcome } = buildSuccessfulResult();

		render(
			<OverviewCard
				document={document}
				plan={plan}
				row={row}
				outcome={outcome}
			/>,
		);

		expect(screen.getByText("Jan 1, 2027")).not.toBeNull();
		expect(
			screen.getByText("Spending target in dollars at FI start"),
		).not.toBeNull();
		expect(screen.getByText("Passed")).not.toBeNull();
		expect(screen.getByText("$500 / $300")).not.toBeNull();
		expect(screen.getByText("capacity / target")).not.toBeNull();
		expect(screen.getByText("Spending growth: 0% / year")).not.toBeNull();
		expect(
			screen.getByText("Principal target: Drawdown allowed"),
		).not.toBeNull();
		expect(screen.getByText("Withdrawal rate")).not.toBeNull();
		expect(screen.getByText("Annual capacity")).not.toBeNull();
		expect(screen.queryByText("Selected accounts")).toBeNull();
		expect(screen.getByText("Brokerage")).not.toBeNull();
		expect(screen.getByText("Roth IRA")).not.toBeNull();
		expect(screen.getByText("4%")).not.toBeNull();
		expect(screen.getByText("5%")).not.toBeNull();
		expect(screen.queryByText("Total from accounts")).toBeNull();
		expect(screen.queryByText("Result")).toBeNull();

		for (const removedLabel of [
			"FI coverage",
			"Deterministic first coverage",
			"Candidate status",
			"Success test",
		]) {
			expect(screen.queryByText(removedLabel)).toBeNull();
		}
	});

	it("names selected direct income separately from account withdrawals", () => {
		const { document, plan, row, outcome } = buildSuccessfulResult();
		const pension = makePosting({ id: "pension", label: "Pension" });

		const { rerender } = render(
			<OverviewCard
				document={{ ...document, postings: [...document.postings, pension] }}
				plan={{
					...plan,
					sources: [
						...plan.sources,
						{ type: "cashflow", postingId: "pension", included: true },
					],
				}}
				row={{ ...row, annualDirectIncome: 0 }}
				outcome={outcome}
			/>,
		);

		expect(screen.getByText("Annual direct income")).not.toBeNull();
		expect(screen.getByText("Pension")).not.toBeNull();
		expect(screen.getByText("$0")).not.toBeNull();

		rerender(
			<OverviewCard
				document={{ ...document, postings: [...document.postings, pension] }}
				plan={{
					...plan,
					sources: [
						...plan.sources,
						{ type: "cashflow", postingId: "pension", included: true },
					],
				}}
				row={{
					...row,
					annualDirectIncome: 12_000,
					totalAnnualCapacity: row.annualWithdrawalCapacity + 12_000,
				}}
				outcome={outcome}
			/>,
		);
		expect(screen.getByText("$12,000")).not.toBeNull();
		expect(screen.getByText("$12,500 / $300")).not.toBeNull();
		expect(screen.queryByText("Total available / year")).toBeNull();
	});

	it("shows FI readiness gates independently without narrative failure copy", () => {
		const { document, plan, row, outcome } = buildSuccessfulResult();

		render(
			<OverviewCard
				document={document}
				plan={plan}
				row={{
					...row,
					minimumNetWorth: row.netWorth - 1,
					annualExpenseTarget: row.totalAnnualCapacity + 1,
				}}
				outcome={{
					...outcome,
					status: "ineligible",
					minimumNetWorthMet: true,
					initialCoverageMet: false,
				}}
			/>,
		);

		const netWorthGate = screen.getByRole("region", {
			name: "Net worth",
		});
		const fundingGate = screen.getByRole("region", {
			name: "FI-date annual capacity",
		});
		expect(within(netWorthGate).getByText("Met")).not.toBeNull();
		expect(within(netWorthGate).getByText("$12,000 / $11,999")).not.toBeNull();
		expect(within(netWorthGate).getByText("current / minimum")).not.toBeNull();
		expect(within(fundingGate).getByText("Below")).not.toBeNull();
		expect(within(fundingGate).getByText("$500 / $501")).not.toBeNull();
		expect(within(fundingGate).getByText("capacity / target")).not.toBeNull();
		expect(
			screen.queryByText("This plan cannot begin", { exact: false }),
		).toBeNull();
	});

	it("separates FI-date capacity from later test failures", () => {
		const { document, plan, row, outcome } = buildSuccessfulResult();
		const { rerender } = render(
			<OverviewCard
				document={document}
				plan={plan}
				row={row}
				outcome={{
					...outcome,
					expensesFullyCovered: false,
					withdrawals: { ...outcome.withdrawals, shortfallAmount: 125 },
				}}
			/>,
		);

		expect(screen.getByText("$125 short")).not.toBeNull();
		const capacity = screen.getByRole("region", {
			name: "FI-date annual capacity",
		});
		expect(within(capacity).getByText("Met")).not.toBeNull();

		rerender(
			<OverviewCard
				document={document}
				plan={{ ...plan, principalPolicy: "preserve-nominal-principal" }}
				row={row}
				outcome={{ ...outcome, principalReplenished: false }}
			/>,
		);
		expect(screen.getByText("Principal below target")).not.toBeNull();
		expect(
			screen.getByText("Principal target: Starting dollars"),
		).not.toBeNull();

		rerender(
			<OverviewCard
				document={document}
				plan={plan}
				row={undefined}
				outcome={undefined}
			/>,
		);
		expect(
			screen.getByText(
				"No complete 1-year test fits in the projection horizon.",
			),
		).not.toBeNull();
	});
});

function buildSuccessfulResult() {
	const document = createBaseDocument({
		accounts: [
			makeAccount({ id: "brokerage", label: "Brokerage" }),
			makeAccount({ id: "roth", label: "Roth IRA" }),
		],
		postings: [],
	});
	const plan: FinancialIndependencePlan = {
		minimumNetWorth: 0,
		annualExpenseTarget: 300,
		annualExpenseTargetBasis: "fi-date-dollars",
		annualExpenseGrowthRate: 0,
		withdrawalRate: 0.04,
		evaluationYears: 1,
		requiredConfidence: 0.9,
		sources: [
			{ type: "asset", accountId: "brokerage", included: true },
			{
				type: "asset",
				accountId: "roth",
				included: true,
				withdrawalRateOverride: 0.05,
			},
		],
		continuingPostingIds: [],
		principalPolicy: "allow-drawdown",
	};
	const row: FinancialIndependenceRow = {
		date: "2027-01-01",
		netWorth: 12_000,
		minimumNetWorth: 0,
		minimumNetWorthMet: true,
		annualDirectIncome: 0,
		assetContributions: [
			{
				accountId: "brokerage",
				balance: 10_000,
				withdrawalRate: 0.04,
				annualWithdrawalCapacity: 400,
			},
			{
				accountId: "roth",
				balance: 2_000,
				withdrawalRate: 0.05,
				annualWithdrawalCapacity: 100,
			},
		],
		selectedAssetBalance: 12_000,
		annualWithdrawalCapacity: 500,
		totalAnnualCapacity: 500,
		annualExpenseTarget: 300,
		coverageRatio: 500 / 300,
		isCovered: true,
		isEligible: true,
	};
	const outcome: FinancialIndependenceDetailedRunOutcome = {
		candidateDate: "2027-01-01",
		status: "evaluated",
		minimumNetWorthMet: true,
		initialCoverageMet: true,
		expensesFullyCovered: true,
		hadWithdrawalShortfall: false,
		startingSelectedAssetBalance: 12_000,
		endingSelectedAssetBalance: 12_000,
		startingRealSelectedAssetBalance: 12_000,
		endingRealSelectedAssetBalance: 12_000,
		principalReplenished: true,
		cycleEstablished: true,
		withdrawals: {
			requestedAmount: 300,
			realizedAmount: 300,
			shortfallAmount: 0,
			firstShortfallDate: null,
			lastShortfallDate: null,
			shortfallOccurrenceCount: 0,
			constraints: [],
			relatedAccountIds: [],
			accounts: [],
			firstShortfall: null,
		},
		balanceTrajectory: [],
	};
	return { document, plan, row, outcome };
}
