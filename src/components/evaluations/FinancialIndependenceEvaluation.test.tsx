// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createBaseDocument,
	makeAccount,
	makePosting,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import { projectFinancialModelDocument } from "@/lib/projection/analysis/projectFinancialModel";
import { FinancialIndependenceEvaluation } from "./FinancialIndependenceEvaluation";

vi.mock("@/components/dashboard/FinancialIndependenceChart", () => ({
	FinancialIndependenceChart: () => <div>FI balance chart</div>,
}));

afterEach(cleanup);

describe("FinancialIndependenceEvaluation", () => {
	it("shows the structured result for the selected ineligible candidate", () => {
		const { document, settings, result } = buildIneligibleProjection();
		const evaluation = settings.evaluations.financialIndependence[0]!;

		render(
			<FinancialIndependenceEvaluation
				evaluation={evaluation}
				document={document}
				result={result}
				sourceRevision={0}
			/>,
		);

		expect(screen.getByText("On Feb 1, 2027, relying on:")).not.toBeNull();
		expect(
			screen.getByText(
				"This plan cannot begin the 1-year test because it does not meet the minimum net worth gate and the initial funding-capacity gate.",
			),
		).not.toBeNull();
		expect(screen.getByText("Brokerage")).not.toBeNull();
		expect(screen.queryByText("Behavior evidence")).toBeNull();
		expect(screen.queryByText("Requested withdrawals")).toBeNull();
		expect(screen.queryByText("shortfall probability")).toBeNull();
		expect(screen.getByText("FI balance chart")).not.toBeNull();
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
						annualExpenseTargetBasis: "fi-date-dollars",
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
