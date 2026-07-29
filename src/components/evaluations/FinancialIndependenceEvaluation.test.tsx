// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	createBaseDocument,
	makeAccount,
	makePosting,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import { projectFinancialModelDocument } from "@/lib/projection/analysis/projectFinancialModel";
import { stochasticProject } from "@/lib/projection/analysis/projectStochastic";
import { FinancialIndependenceEvaluation } from "./FinancialIndependenceEvaluation";

afterEach(cleanup);

describe("FinancialIndependenceEvaluation", () => {
	it("aligns an ineligible summary and evidence to the latest candidate", () => {
		const { document, settings, result } = buildIneligibleProjection();
		const evaluation = settings.evaluations.financialIndependence[0]!;
		const stochasticResult = stochasticProject(
			document,
			settings,
			emptyOverrides,
			{ runCount: 2, seed: 42 },
		);

		render(
			<FinancialIndependenceEvaluation
				evaluation={evaluation}
				document={document}
				result={result}
				stochasticResult={stochasticResult}
				sourceRevision={0}
			/>,
		);

		expect(screen.getByText("Snapshot Feb 1, 2027")).not.toBeNull();
		const candidateMetric = screen.getByText(
			"Diagnostic candidate",
		).parentElement;
		if (!candidateMetric) throw new Error("Missing candidate metric.");
		expect(within(candidateMetric).getByText("Feb 1, 2027")).not.toBeNull();

		const withdrawalMetric = screen.getByText(
			"Requested withdrawals",
		).parentElement;
		if (!withdrawalMetric) throw new Error("Missing withdrawal metric.");
		expect(within(withdrawalMetric).getByText("Not evaluated")).not.toBeNull();

		const probabilityMetric = screen.getByText(
			"shortfall probability",
		).parentElement;
		if (!probabilityMetric) throw new Error("Missing probability metric.");
		expect(within(probabilityMetric).getByText("Not evaluated")).not.toBeNull();
		expect(
			within(probabilityMetric).getByText(
				"0 of 2 independent Monte Carlo samples were eligible",
			),
		).not.toBeNull();
	});
});

const emptyOverrides = {
	addedAccounts: [],
	addedPostings: [],
	disabledAccountIds: [],
	disabledPostingIds: [],
};

function buildIneligibleProjection() {
	const document = createBaseDocument({
		accounts: [makeAccount({ id: "brokerage", label: "Brokerage" })],
		postings: [
			makePosting({
				id: "opening-brokerage",
				destinations: ["brokerage"],
				arithmetic: "1000",
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
						minimumNetWorth: 1_000_000,
						annualExpenseTarget: 100_000,
						annualExpenseGrowthRate: 0,
						withdrawalRate: 0.04,
						evaluationYears: 1,
						requiredConfidence: 0.9,
						sources: [
							{
								type: "asset",
								accountId: "brokerage",
								included: true,
							},
						],
						continuingPostingIds: [],
						principalPolicy: "allow-drawdown",
					},
				},
			],
		},
	});
	const result = projectFinancialModelDocument(
		document,
		settings,
		emptyOverrides,
	);
	return { document, settings, result };
}
