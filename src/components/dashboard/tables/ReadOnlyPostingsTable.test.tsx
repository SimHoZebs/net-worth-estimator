// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeAccount } from "@/lib/projection/__fixtures__/accounts";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import { ReadOnlyPostingsTable } from "./ReadOnlyPostingsTable";

afterEach(cleanup);

describe("ReadOnlyPostingsTable", () => {
	it("uses the same transaction-row presentation as history", () => {
		const checking = makeAccount({
			id: "checking",
			label: "Checking",
			color: "#2563eb",
		});
		render(
			<ReadOnlyPostingsTable
				postings={[
					makePosting({
						id: "salary",
						label: "Salary",
						destinations: ["checking"],
						arithmetic: "2500",
						frequency: "monthly",
						startDate: "2026-02-01",
					}),
				]}
				accounts={[checking]}
				projectionStartDate="2026-01-31"
				showAdvanced={false}
			/>,
		);

		expect(screen.queryByRole("table")).toBeNull();
		expect(screen.getByText("Salary")).not.toBeNull();
		expect(screen.getByText("Checking")).not.toBeNull();
		expect(screen.getByText("to")).not.toBeNull();
		expect(screen.getByText("+$2,500")).not.toBeNull();
		expect(screen.getByText(/Monthly from Feb 1, 2026/)).not.toBeNull();

		fireEvent.change(
			screen.getByPlaceholderText("Search scheduled transactions..."),
			{ target: { value: "Checking" } },
		);
		expect(screen.getByText("Salary")).not.toBeNull();
	});

	it("does not present a non-positive calculation as cash flow", () => {
		const checking = makeAccount({ id: "checking", label: "Checking" });
		render(
			<ReadOnlyPostingsTable
				postings={[
					makePosting({
						id: "invalid-inflow",
						label: "Invalid inflow",
						destinations: ["checking"],
						arithmetic: "-100",
					}),
				]}
				accounts={[checking]}
				projectionStartDate="2026-01-31"
				showAdvanced={false}
			/>,
		);

		expect(screen.getByText("$0")).not.toBeNull();
		expect(screen.getByText("No movement")).not.toBeNull();
		expect(screen.queryByText("+$100")).toBeNull();
	});

	it("shows generic resolver details and gates raw configuration", () => {
		const posting = makePosting({
			id: "custom",
			label: "Custom posting",
			destinations: ["checking"],
			amount: {
				resolver: "custom-resolver",
				config: {
					mode: "dynamic",
					steps: [{ resolver: "nested-step", config: { factor: 2 } }],
				},
				inputs: {},
			},
		});
		const checking = makeAccount({ id: "checking", label: "Checking" });
		const { rerender } = render(
			<ReadOnlyPostingsTable
				postings={[posting]}
				accounts={[checking]}
				projectionStartDate="2026-01-31"
				showAdvanced={false}
			/>,
		);

		expect(screen.getByText(/Custom resolver calculation/)).not.toBeNull();
		expect(screen.getByText("Nested step calculation")).not.toBeNull();
		expect(screen.getByText("dynamic")).not.toBeNull();
		expect(screen.queryByText("Raw amount configuration")).toBeNull();

		rerender(
			<ReadOnlyPostingsTable
				postings={[posting]}
				accounts={[checking]}
				projectionStartDate="2026-01-31"
				showAdvanced
			/>,
		);
		expect(screen.getByText("Raw amount configuration")).not.toBeNull();
	});

	it("places ended postings in a subordinate collapsed section", () => {
		const checking = makeAccount({ id: "checking", label: "Checking" });
		render(
			<ReadOnlyPostingsTable
				postings={[
					makePosting({
						id: "ended",
						label: "Ended posting",
						destinations: ["checking"],
						endDate: "2026-01-30",
					}),
					makePosting({
						id: "boundary",
						label: "Boundary posting",
						destinations: ["checking"],
						endDate: "2026-01-31",
					}),
					makePosting({
						id: "ongoing",
						label: "Ongoing posting",
						destinations: ["checking"],
						endDate: null,
					}),
				]}
				accounts={[checking]}
				projectionStartDate="2026-01-31"
				showAdvanced={false}
			/>,
		);

		const pastSummary = screen.getByText(
			"Past scheduled transactions · 1 transaction",
		);
		expect((pastSummary.closest("details") as HTMLDetailsElement).open).toBe(
			false,
		);
		expect(screen.getByText("2 current transactions")).not.toBeNull();
		expect(screen.getByText("Boundary posting")).not.toBeNull();
		expect(screen.getByText("Ongoing posting")).not.toBeNull();
		expect(screen.getByText("Ended posting").closest("details")).toBe(
			pastSummary.closest("details"),
		);
	});
});
