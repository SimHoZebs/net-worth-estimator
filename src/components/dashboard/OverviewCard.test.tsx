// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { selectFinancialIndependenceCandidateDate } from "@/components/evaluations/FinancialIndependenceEvaluation";
import {
	createBaseDocument,
	makeAccount,
	makePosting,
	makeSettings,
} from "@/lib/projection/__fixtures__";
import { projectFinancialModelDocument } from "@/lib/projection/analysis/projectFinancialModel";
import { stochasticProject } from "@/lib/projection/analysis/projectStochastic";
import { getFinancialIndependenceResult } from "@/lib/projection/evaluation/accessors";
import { OverviewCard } from "./OverviewCard";

afterEach(cleanup);

describe("OverviewCard", () => {
	it("shows the committed FI success rule and test period", () => {
		const document = createBaseDocument();
		const settings = makeSettings();
		const plan = settings.evaluations.financialIndependence[0]!.config;
		const result = projectFinancialModelDocument(document, settings, {
			addedAccounts: [],
			addedPostings: [],
			disabledAccountIds: [],
			disabledPostingIds: [],
		});
		const analysis = getFinancialIndependenceResult(
			result,
			"fi",
		)?.deterministic;
		if (!analysis) throw new Error("Missing FI analysis.");

		render(
			<OverviewCard
				result={result}
				document={document}
				instanceId="fi"
				plan={plan}
				candidateDate={selectFinancialIndependenceCandidateDate(analysis)}
			/>,
		);

		expect(
			screen.getByText("1-year test · preserve purchasing power"),
		).not.toBeNull();
		expect(
			screen.getByText(
				"All spending must be funded and selected assets must retain their inflation-adjusted starting value.",
			),
		).not.toBeNull();
	});

	it("shows the latest testable candidate and each asset's capacity", () => {
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
		const settings = makeSettings({
			horizonYears: 2,
			evaluations: {
				...makeSettings().evaluations,
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
		const analysis = getFinancialIndependenceResult(
			result,
			"fi",
		)?.deterministic;
		if (!analysis) throw new Error("Missing FI analysis.");
		const candidateDate = selectFinancialIndependenceCandidateDate(analysis);

		render(
			<OverviewCard
				result={result}
				document={document}
				instanceId="fi"
				plan={plan}
				candidateDate={candidateDate}
			/>,
		);

		expect(candidateDate).toBe("2027-02-01");
		expect(screen.getByText("Snapshot Feb 1, 2027")).not.toBeNull();
		expect(screen.getByText("$500/yr")).not.toBeNull();
		expect(screen.getByText("Brokerage")).not.toBeNull();
		expect(screen.getByText("Roth IRA")).not.toBeNull();
		expect(screen.getByText("$400")).not.toBeNull();
		expect(screen.getByText("$100")).not.toBeNull();
	});

	it("does not present zero values when no complete FI test fits", () => {
		const document = createBaseDocument();
		const defaults = makeSettings();
		const settings = makeSettings({
			evaluations: {
				...defaults.evaluations,
				financialIndependence: [
					{
						...defaults.evaluations.financialIndependence[0]!,
						config: {
							...defaults.evaluations.financialIndependence[0]!.config,
							evaluationYears: 2,
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
		const analysis = getFinancialIndependenceResult(
			result,
			"fi",
		)?.deterministic;
		if (!analysis) throw new Error("Missing FI analysis.");
		const noWindowStochasticResult = stochasticProject(
			document,
			settings,
			{
				addedAccounts: [],
				addedPostings: [],
				disabledAccountIds: [],
				disabledPostingIds: [],
			},
			{ runCount: 2, seed: 42 },
		);

		render(
			<OverviewCard
				result={result}
				document={document}
				instanceId="fi"
				plan={plan}
				candidateDate={selectFinancialIndependenceCandidateDate(analysis)}
				stochasticResult={noWindowStochasticResult}
			/>,
		);

		expect(screen.getByText("No complete test window")).not.toBeNull();
		expect(screen.getAllByText("Not evaluated").length).toBeGreaterThan(1);
		expect(
			screen.getByText(
				"A complete FI test does not fit in the projection horizon",
			),
		).not.toBeNull();
		expect(screen.queryByText("$0/yr")).toBeNull();
	});
});
