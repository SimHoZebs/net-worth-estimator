import { describe, expect, it } from "vitest";
import { buildPointDetails, groupPointAccounts } from "@/chart/pointDetails";
import type { Account } from "@/lib/projection";

const accounts: Account[] = [
	{
		id: "cash",
		label: "Cash",
		color: "green",
		enabled: true,
		minBalance: 0,
		maxBalance: 0,
	},
	{
		id: "loan",
		label: "Loan",
		color: "red",
		enabled: true,
		minBalance: 0,
		maxBalance: 0,
	},
	{
		id: "unused",
		label: "Unused",
		color: null,
		enabled: true,
		minBalance: 0,
		maxBalance: 0,
	},
];

describe("buildPointDetails", () => {
	it("uses semantic ranges and omits exact zero account values", () => {
		const details = buildPointDetails({
			row: {
				date: "2030-01-15",
				netWorth: 90,
				p50: 100,
				_p10: 50,
				_p90: 150,
				_p25: 75,
				_p75: 125,
				cash: 200,
				loan: -100,
				unused: 0,
			},
			accounts,
			hasStochasticData: true,
		});

		expect(details.netWorth).toBe(100);
		expect(details.netWorthLabel).toBe("Median net worth");
		expect(details.accounts.map((account) => account.id)).toEqual([
			"cash",
			"loan",
		]);
		expect(details.intervals).toEqual([
			{ label: "Likely range", percentiles: "P25-P75", lower: 75, upper: 125 },
			{ label: "Wider range", percentiles: "P10-P90", lower: 50, upper: 150 },
		]);
	});

	it("sorts account values by absolute significance", () => {
		const details = buildPointDetails({
			row: { date: "2030-01-15", netWorth: 100, cash: 25, loan: -75 },
			accounts,
			hasStochasticData: false,
		});

		expect(details.accounts.map((account) => account.id)).toEqual([
			"loan",
			"cash",
		]);
		expect(groupPointAccounts(details.accounts, 1)).toEqual({
			visible: [details.accounts[0]],
			hidden: [details.accounts[1]],
		});
	});
});
