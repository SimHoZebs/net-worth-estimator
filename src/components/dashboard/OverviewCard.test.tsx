// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	createBaseDocument,
	makeAccount,
	makePosting,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import { projectFinancialModelDocument } from "@/lib/projection/analysis/projectFinancialModel";
import { getFinancialIndependenceResult } from "@/lib/projection/evaluation/accessors";
import { selectFinancialIndependenceOutcomeIndex } from "@/lib/projection/evaluation/financialIndependence";
import {
	describeFinancialIndependenceOutcome,
	OverviewCard,
} from "./OverviewCard";

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

		expect(screen.getByText("On Jan 1, 2027, relying on:")).not.toBeNull();
		expect(
			screen.getByText("Spending input: dollars at FI start"),
		).not.toBeNull();
		expect(screen.getByText("Selected accounts")).not.toBeNull();
		expect(screen.getByText("Withdrawal rate")).not.toBeNull();
		expect(screen.getByText("Brokerage")).not.toBeNull();
		expect(screen.getByText("Roth IRA")).not.toBeNull();
		expect(screen.getByText("4%")).not.toBeNull();
		expect(screen.getByText("5%")).not.toBeNull();
		expect(
			screen.getByText(
				"This plan can fund spending starting at $300 per year for 1 year. Selected assets may finish below their starting balance under the chosen drawdown strategy.",
			),
		).not.toBeNull();

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

		expect(screen.getByText("Selected direct income")).not.toBeNull();
		expect(screen.getByText("Pension")).not.toBeNull();
		expect(screen.getByText("$0 / year")).not.toBeNull();

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
				row={{ ...row, annualDirectIncome: 12_000 }}
				outcome={outcome}
			/>,
		);
		expect(screen.getByText("$12,000 / year")).not.toBeNull();
	});

	it("describes growth, principal failure, shortfall, and no-window states", () => {
		const { plan, row, outcome } = buildSuccessfulResult();

		expect(
			describeFinancialIndependenceOutcome(
				{
					...plan,
					annualExpenseGrowthRate: 0.025,
					principalPolicy: "preserve-real-principal",
				},
				row,
				{ ...outcome, principalReplenished: true },
			),
		).toBe(
			"This plan can fund spending starting at $300 per year and growing 2.5% annually for 1 year. Selected assets collectively retain their inflation-adjusted starting value.",
		);
		expect(
			describeFinancialIndependenceOutcome(
				{ ...plan, principalPolicy: "preserve-nominal-principal" },
				row,
				{ ...outcome, principalReplenished: false },
			),
		).toBe(
			"This plan can fund spending starting at $300 per year for 1 year, but selected assets collectively do not retain their starting dollar value.",
		);
		expect(
			describeFinancialIndependenceOutcome(plan, row, {
				...outcome,
				expensesFullyCovered: false,
				withdrawals: { ...outcome.withdrawals, shortfallAmount: 125 },
			}),
		).toBe(
			"This plan cannot fully fund spending starting at $300 per year for 1 year. It leaves $125 unfunded across the test, so it does not satisfy the chosen portfolio-drawdown strategy.",
		);
		expect(
			describeFinancialIndependenceOutcome(plan, undefined, undefined),
		).toBe("No complete 1-year test fits in the projection horizon.");
	});
});

function buildSuccessfulResult() {
	const document = createBaseDocument({
		accounts: [
			makeAccount({ id: "brokerage", label: "Brokerage" }),
			makeAccount({ id: "roth", label: "Roth IRA" }),
		],
		postings: [
			makePosting({
				id: "opening-brokerage",
				destinations: ["brokerage"],
				arithmetic: "1000",
				frequency: "once",
				startDate: "2026-01-31",
			}),
			makePosting({
				id: "opening-roth",
				destinations: ["roth"],
				arithmetic: "2000",
				frequency: "once",
				startDate: "2026-01-31",
			}),
			makePosting({
				id: "future-brokerage",
				destinations: ["brokerage"],
				arithmetic: "9000",
				frequency: "once",
				startDate: "2027-01-01",
			}),
		],
	});
	const defaults = makeSettings();
	const settings = makeSettings({
		horizonYears: 2,
		evaluations: {
			...defaults.evaluations,
			financialIndependence: [
				{
					instanceId: "fi",
					label: "Financial independence",
					enabled: true,
					config: {
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
					},
				},
			],
		},
	});
	const plan = settings.evaluations.financialIndependence[0]!.config;
	const result = projectFinancialModelDocument(document, settings, {
		addedAccounts: [],
		addedPostings: [],
		disabledAccountIds: [],
		disabledPostingIds: [],
	});
	const analysis = getFinancialIndependenceResult(result, "fi")?.deterministic;
	if (!analysis) throw new Error("Missing FI analysis.");
	const selectedIndex = selectFinancialIndependenceOutcomeIndex(
		analysis.runOutcomes,
	);
	const row = analysis.rows[selectedIndex];
	const outcome = analysis.runOutcomes[selectedIndex];
	if (!row || !outcome) throw new Error("Missing FI candidate details.");
	return { document, plan, row, outcome };
}
