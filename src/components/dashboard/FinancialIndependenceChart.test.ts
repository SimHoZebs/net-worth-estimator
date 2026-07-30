import { describe, expect, it } from "vitest";
import type { FinancialIndependenceRunOutcome } from "@/lib/projection";
import {
	buildFinancialIndependenceBalanceData,
	buildFinancialIndependenceBalanceTooltip,
	buildFinancialIndependenceChartOptions,
	type FinancialIndependenceChartAccount,
} from "./FinancialIndependenceChart";

const accounts: FinancialIndependenceChartAccount[] = [
	{ id: "brokerage", label: "Brokerage <main>", color: "#123456" },
	{ id: "roth", label: "Roth IRA", color: "#abcdef" },
];

describe("FinancialIndependenceChart", () => {
	it("aligns monthly balances in selected source order", () => {
		const outcome = makeOutcome();
		const data = buildFinancialIndependenceBalanceData(outcome, [
			"brokerage",
			"roth",
		]);

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

		const tooltip = buildFinancialIndependenceBalanceTooltip(
			makeOutcome(),
			accounts,
			1,
		);
		expect(tooltip).toContain("Feb 1, 2026");
		expect(tooltip).toContain("Brokerage &lt;main&gt;");
		expect(tooltip).toContain("$98,000");
		expect(tooltip).toContain("$51,000");
		expect(tooltip).toContain("$149,000");
		expect(tooltip).not.toContain("Brokerage <main>");
	});
});

function makeOutcome(): FinancialIndependenceRunOutcome {
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
