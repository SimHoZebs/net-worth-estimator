import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	independenceEnvelope,
	independenceItem,
	independenceRow,
} from "@/mocks/financialIndependence.ts";
import { IndependenceSpending } from "./IndependenceSpending.tsx";

afterEach(cleanup);

type RowOverrides = NonNullable<Parameters<typeof independenceRow>[1]>;

function candidate(overrides: RowOverrides = {}) {
	return independenceItem(
		independenceEnvelope({ rows: [independenceRow("2036-02-01", overrides)] }),
	).financialIndependence!.candidates[0]!;
}

describe("IndependenceSpending", () => {
	it("splits the spending target into income, withdrawals, and an explicit dollar gap", () => {
		const view = render(<IndependenceSpending candidate={candidate()} />);
		const bar = view.getByRole("img", {
			name: "Annual spending at Feb 2036: $80,000. Income funds $20,000, withdrawals fund $40,000, $20,000 is unfunded.",
		});
		expect(
			Array.from(bar.children).map((segment) => segment.getAttribute("style")),
		).toEqual([
			"--segment-width: 25%;",
			"--segment-width: 50%;",
			"--segment-width: 25%;",
		]);
		const legend = within(
			view.getByRole("list", { name: "Annual spending details" }),
		);
		expect(legend.getByText("Income")).toBeTruthy();
		expect(legend.getByText("Withdrawals")).toBeTruthy();
		expect(legend.getByText("Unfunded")).toBeTruthy();
		expect(view.getAllByText("$20,000", { exact: true })).toHaveLength(1);
		expect(view.getAllByText("$80,000", { exact: true })).toHaveLength(1);
		expect(view.queryByText(/of spending covered/)).toBeNull();
	});

	it.each([
		{
			annualDirectIncome: 20000,
			annualWithdrawalCapacity: 80000,
			expected: ["25%", "75%"],
		},
		{
			annualDirectIncome: 100000,
			annualWithdrawalCapacity: 0,
			expected: ["100%"],
		},
	])(
		"caps the spending bar and shows surplus capacity separately: $annualDirectIncome income",
		({ expected, ...amounts }) => {
			const view = render(
				<IndependenceSpending
					candidate={candidate({
						...amounts,
						totalAnnualCapacity: 100000,
						coverageRatio: 1.25,
						isCovered: true,
					})}
				/>,
			);
			const bar = view.getByRole("img");
			expect(
				Array.from(bar.children).map((segment) =>
					(segment as HTMLElement).style.getPropertyValue("--segment-width"),
				),
			).toEqual(expected);
			expect(view.getByText("$0", { exact: true })).toBeTruthy();
			expect(view.getByText("$20,000/yr extra funding capacity.")).toBeTruthy();
			expect(
				view.queryByText(/self-sustaining|independence reached/i),
			).toBeNull();
		},
	);

	it("shows an entirely unfunded budget when the engine reports zero capacity", () => {
		const view = render(
			<IndependenceSpending
				candidate={candidate({
					annualDirectIncome: 0,
					annualWithdrawalCapacity: 0,
					totalAnnualCapacity: 0,
					coverageRatio: 0,
				})}
			/>,
		);
		expect(view.getByRole("img").children).toHaveLength(1);
		expect(
			view.getByRole("img", { name: /\$80,000 is unfunded/ }),
		).toBeTruthy();
	});

	it.each<RowOverrides>([
		{ annualDirectIncome: null },
		{ annualWithdrawalCapacity: null },
		{ totalAnnualCapacity: null },
		{ annualExpenseTarget: null },
		{ annualExpenseTarget: 0 },
		{ coverageRatio: null },
		{ annualDirectIncome: -100 },
	])(
		"does not turn missing or invalid evidence into a zero-dollar gap: %j",
		(overrides) => {
			const view = render(
				<IndependenceSpending candidate={candidate(overrides)} />,
			);
			expect(
				view.getByText("Spending evidence is unavailable for this start date."),
			).toBeTruthy();
			expect(view.queryByRole("img")).toBeNull();
			expect(view.queryByText("Unfunded")).toBeNull();
		},
	);

	it("keeps a cent-sized gap visible once and preserves the accessible description", () => {
		const view = render(
			<IndependenceSpending
				candidate={candidate({
					annualExpenseTarget: 100,
					annualDirectIncome: 0,
					annualWithdrawalCapacity: 99.8,
					totalAnnualCapacity: 99.8,
					coverageRatio: 0.998,
				})}
			/>,
		);
		expect(view.getAllByText("$0.20", { exact: true })).toHaveLength(1);
		expect(view.getByRole("img", { name: /\$0.20 is unfunded/ })).toBeTruthy();
	});
});
