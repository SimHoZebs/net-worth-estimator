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
				showAdvanced={false}
			/>,
		);

		expect(screen.getByText("$0")).not.toBeNull();
		expect(screen.getByText("No movement")).not.toBeNull();
		expect(screen.queryByText("+$100")).toBeNull();
	});
});
