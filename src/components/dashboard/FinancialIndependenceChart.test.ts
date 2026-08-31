// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinancialIndependenceDetailedRunOutcome } from "@/lib/projection";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import {
	buildFinancialIndependenceBalanceData,
	buildFinancialIndependenceBalanceIndex,
	buildFinancialIndependenceBalanceTooltip,
	buildFinancialIndependenceChartOptions,
	FinancialIndependenceChart,
	type FinancialIndependenceChartAccount,
} from "./FinancialIndependenceChart";

vi.mock("@/components/ui/UPlotChart", () => ({
	UPlotChart: () => createElement("div", null, "uPlot account balances"),
}));

afterEach(cleanup);

const accounts: FinancialIndependenceChartAccount[] = [
	{ id: "brokerage", label: "Brokerage <main>", color: "#123456" },
	{ id: "roth", label: "Roth IRA", color: "#abcdef" },
];

describe("FinancialIndependenceChart", () => {
	it("renders only the counterfactual account trajectory for ineligible plans", () => {
		const outcome = {
			...makeOutcome(),
			status: "ineligible" as const,
			minimumNetWorthMet: false,
			initialCoverageMet: false,
			cycleEstablished: false,
		};
		render(
			createElement(FinancialIndependenceChart, {
				document: createBaseDocument(),
				outcome,
			}),
		);

		expect(screen.getByText("Opening and month-end balances")).not.toBeNull();
		expect(screen.getByText("Counterfactual preview")).not.toBeNull();
		expect(screen.queryByText("Initial annual funding capacity")).toBeNull();
		expect(screen.queryByText("Selected account balances")).toBeNull();
		expect(screen.getByText("uPlot account balances")).not.toBeNull();
	});

	it("aligns monthly balances in selected source order", () => {
		const outcome = makeOutcome();
		const balanceIndex = buildFinancialIndependenceBalanceIndex(outcome);
		const data = buildFinancialIndependenceBalanceData(
			outcome,
			["brokerage", "roth"],
			balanceIndex,
		);

		expect(data[0]).toEqual([
			new Date(2026, 0, 1).getTime(),
			new Date(2026, 1, 1).getTime(),
		]);
		expect(data[1]).toEqual([100_000, 98_000]);
		expect(data[2]).toEqual([50_000, 51_000]);
	});

	it("shows visible points and exact escaped hover values", () => {
		const options = buildFinancialIndependenceChartOptions(accounts);
		expect(options.legend).toEqual({ show: false });
		expect(options.series[1]?.points).toMatchObject({ show: true, size: 6 });
		expect(options.series[2]?.points).toMatchObject({ show: true, size: 6 });
		const range = options.scales?.y?.range;
		expect(typeof range).toBe("function");
		if (typeof range === "function") {
			expect(range({} as never, 98_000, 100_000, "y")).toEqual([
				96_000, 102_000,
			]);
		}

		const outcome = makeOutcome();
		const tooltip = buildFinancialIndependenceBalanceTooltip(
			outcome,
			accounts,
			buildFinancialIndependenceBalanceIndex(outcome),
			1,
		);
		expect(tooltip).toContain("Feb 1, 2026");
		expect(tooltip).toContain("Brokerage &lt;main&gt;");
		expect(tooltip).toContain("$98,000");
		expect(tooltip).toContain("$51,000");
		expect(tooltip).toContain("$149,000");
		expect(tooltip).not.toContain("Brokerage <main>");
	});

	it("preserves first-match balances when a trajectory row is ambiguous", () => {
		const outcome = makeOutcome();
		outcome.balanceTrajectory[0]?.accounts.push({
			accountId: "brokerage",
			balance: 999_999,
		});
		const balanceIndex = buildFinancialIndependenceBalanceIndex(outcome);

		expect(balanceIndex[0]?.get("brokerage")).toBe(100_000);
		expect(
			buildFinancialIndependenceBalanceData(
				outcome,
				["brokerage"],
				balanceIndex,
			)[1],
		).toEqual([100_000, 98_000]);
	});
});

function makeOutcome(): FinancialIndependenceDetailedRunOutcome {
	return {
		candidateDate: "2026-01-01",
		status: "evaluated",
		minimumNetWorthMet: true,
		initialCoverageMet: true,
		expensesFullyCovered: true,
		hadWithdrawalShortfall: false,
		startingSelectedAssetBalance: 150_000,
		endingSelectedAssetBalance: 149_000,
		startingRealSelectedAssetBalance: 150_000,
		endingRealSelectedAssetBalance: 149_000,
		principalReplenished: true,
		cycleEstablished: true,
		withdrawals: {
			requestedAmount: 1_000,
			realizedAmount: 1_000,
			shortfallAmount: 0,
			firstShortfallDate: null,
			lastShortfallDate: null,
			shortfallOccurrenceCount: 0,
			constraints: [],
			relatedAccountIds: [],
			accounts: [],
			firstShortfall: null,
		},
		balanceTrajectory: [
			{
				date: "2026-01-01",
				accounts: [
					{ accountId: "brokerage", balance: 100_000 },
					{ accountId: "roth", balance: 50_000 },
				],
			},
			{
				date: "2026-02-01",
				accounts: [
					{ accountId: "brokerage", balance: 98_000 },
					{ accountId: "roth", balance: 51_000 },
				],
			},
		],
	};
}
