// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PointDetails } from "@/chart/pointDetails";
import { PointDetailsPanel } from "./PointDetailsPanel";

const details: PointDetails = {
	date: "Jan 15, 2030",
	netWorth: 700,
	netWorthLabel: "Median net worth",
	intervals: [
		{
			label: "Likely range",
			percentiles: "P25-P75",
			lower: 600,
			upper: 800,
		},
	],
	accounts: Array.from({ length: 8 }, (_, index) => ({
		id: `account-${index}`,
		label: `Account ${index}`,
		color: null,
		value: 800 - index * 100,
	})),
};

describe("PointDetailsPanel", () => {
	it("groups less significant mobile accounts and can reveal them", () => {
		render(<PointDetailsPanel details={details} />);

		expect(screen.getByText("Other accounts (2)")).toBeTruthy();
		expect(screen.queryByText("Account 7")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Show all accounts" }));

		expect(screen.getByText("Account 7")).toBeTruthy();
		expect(screen.queryByText("Other accounts (2)")).toBeNull();
	});

	it("allows a selected point to be cleared", () => {
		const onClear = vi.fn();
		render(<PointDetailsPanel details={details} onClear={onClear} />);

		fireEvent.click(screen.getByRole("button", { name: "Clear" }));

		expect(onClear).toHaveBeenCalledOnce();
	});
});
