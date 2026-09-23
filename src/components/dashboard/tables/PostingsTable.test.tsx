// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Mock } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinancialModelDocument, Posting } from "@/lib/projection";
import { makeAccount } from "@/lib/projection/__fixtures__/accounts";
import { createBaseDocument } from "@/lib/projection/__fixtures__/documents";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import { PostingsTable } from "./PostingsTable";

afterEach(cleanup);

function renderEditableTable({
	document,
	displayDocument = document,
	workingDocument = displayDocument,
	updatePosting = vi.fn<(id: string, changes: Partial<Posting>) => void>(),
}: {
	document: FinancialModelDocument;
	displayDocument?: FinancialModelDocument;
	workingDocument?: FinancialModelDocument | null;
	updatePosting?: Mock<(id: string, changes: Partial<Posting>) => void>;
}) {
	return {
		updatePosting,
		...render(
			<PostingsTable
				editable
				displayDocument={displayDocument}
				document={document}
				isDirty
				workingDocument={workingDocument}
				projectionStartDate="2026-01-01"
				updatePosting={updatePosting}
				deletePosting={() => {}}
				addPosting={() => {}}
			/>,
		),
	};
}

describe("PostingsTable", () => {
	it("compares dirty posting rows by ID after reordering", () => {
		const alpha = makePosting({ id: "alpha", label: "Alpha" });
		const beta = makePosting({ id: "beta", label: "Beta" });
		const document = createBaseDocument({ postings: [alpha, beta] });
		const reordered = createBaseDocument({ postings: [beta, alpha] });
		const { rerender } = renderEditableTable({
			document,
			displayDocument: reordered,
			workingDocument: reordered,
		});

		expect(screen.getByDisplayValue("Alpha").className).not.toContain(
			"border-tertiary-border",
		);
		expect(screen.getByDisplayValue("Beta").className).not.toContain(
			"border-tertiary-border",
		);

		const changedBeta = { ...beta, label: "Changed Beta" };
		const changed = createBaseDocument({ postings: [changedBeta, alpha] });
		rerender(
			<PostingsTable
				editable
				displayDocument={changed}
				document={document}
				isDirty
				workingDocument={changed}
				projectionStartDate="2026-01-01"
				updatePosting={() => {}}
				deletePosting={() => {}}
				addPosting={() => {}}
			/>,
		);

		expect(screen.getByDisplayValue("Changed Beta").className).toContain(
			"border-tertiary-border",
		);
		expect(screen.getByDisplayValue("Alpha").className).not.toContain(
			"border-tertiary-border",
		);
	});

	it("keeps required numeric drafts local and commits them on Enter", () => {
		const posting = makePosting({
			id: "salary",
			label: "Salary",
			annualRate: 0,
		});
		const document = createBaseDocument({ postings: [posting] });
		const { updatePosting } = renderEditableTable({ document });
		const rate = screen.getByRole("spinbutton", {
			name: "Salary annual rate",
		}) as HTMLInputElement;

		expect(rate.value).toBe("0");
		fireEvent.change(rate, { target: { value: "" } });
		expect(updatePosting).not.toHaveBeenCalled();
		fireEvent.blur(rate);
		// Required blanks stay visible with an announced error instead of
		// silently reverting to the committed value.
		expect(rate.value).toBe("");
		expect(rate.getAttribute("aria-invalid")).toBe("true");
		expect(
			screen.getByText(/Salary annual rate: enter a number/),
		).not.toBeNull();
		expect(updatePosting).not.toHaveBeenCalled();

		fireEvent.change(rate, { target: { value: "0.25" } });
		expect(updatePosting).not.toHaveBeenCalled();
		fireEvent.keyDown(rate, { key: "Enter" });
		expect(updatePosting).toHaveBeenCalledWith("salary", { annualRate: 0.25 });
	});

	it("restores a numeric draft on Escape without committing it", () => {
		const posting = makePosting({
			id: "salary",
			label: "Salary",
			annualGrowthRate: 0.1,
		});
		const document = createBaseDocument({ postings: [posting] });
		const { updatePosting } = renderEditableTable({ document });
		const growth = screen.getByRole("spinbutton", {
			name: "Salary annual growth rate",
		}) as HTMLInputElement;

		fireEvent.change(growth, { target: { value: "0.2" } });
		fireEvent.keyDown(growth, { key: "Escape" });

		expect(growth.value).toBe("0.1");
		expect(updatePosting).not.toHaveBeenCalled();
	});

	it("restores an expression draft on Escape without committing it", () => {
		const posting = makePosting({
			id: "salary",
			label: "Salary",
			arithmetic: "100",
		});
		const document = createBaseDocument({ postings: [posting] });
		const { updatePosting } = renderEditableTable({ document });
		const expression = screen.getByRole("textbox", {
			name: "Salary amount expression",
		}) as HTMLInputElement;

		fireEvent.change(expression, { target: { value: "200" } });
		fireEvent.keyDown(expression, { key: "Escape" });

		expect(expression.value).toBe("100");
		expect(updatePosting).not.toHaveBeenCalled();
	});

	it("shows structured details for non-expression calculations", () => {
		const posting = makePosting({
			id: "custom",
			label: "Custom",
			amount: {
				resolver: "external-source",
				config: { sourceId: "market-feed", enabled: true },
				inputs: {},
			},
		});
		renderEditableTable({
			document: createBaseDocument({ postings: [posting] }),
		});

		expect(screen.getByText("External source calculation")).not.toBeNull();
		expect(screen.getByText("Source ID")).not.toBeNull();
		expect(screen.getByText("market-feed")).not.toBeNull();
		expect(screen.getByText("True")).not.toBeNull();
	});

	it("commits nullable numeric drafts on blur and clamps minimum values", () => {
		const posting = makePosting({
			id: "salary",
			label: "Salary",
			annualCap: 100,
			priority: 2,
		});
		const document = createBaseDocument({ postings: [posting] });
		const { updatePosting } = renderEditableTable({ document });
		const cap = screen.getByRole("spinbutton", {
			name: "Salary annual cap",
		});
		const priority = screen.getByRole("spinbutton", {
			name: "Salary priority",
		});

		fireEvent.change(cap, { target: { value: "" } });
		fireEvent.blur(cap);
		fireEvent.change(priority, { target: { value: "-2" } });
		fireEvent.blur(priority);

		expect(updatePosting).toHaveBeenNthCalledWith(1, "salary", {
			annualCap: null,
		});
		expect(updatePosting).toHaveBeenNthCalledWith(2, "salary", { priority: 1 });
	});

	it("uses the same transaction-row presentation as history", () => {
		const checking = makeAccount({
			id: "checking",
			label: "Checking",
			color: "#2563eb",
		});
		render(
			<PostingsTable
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
			<PostingsTable
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
			<PostingsTable
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
			<PostingsTable
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
			<PostingsTable
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
