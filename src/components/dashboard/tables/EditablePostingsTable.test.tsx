// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Mock } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinancialModelDocument, Posting } from "@/lib/projection";
import { createBaseDocument } from "@/lib/projection/__fixtures__/documents";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import { EditablePostingsTable } from "./EditablePostingsTable";

afterEach(cleanup);

function renderTable({
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
			<EditablePostingsTable
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

describe("EditablePostingsTable", () => {
	it("compares dirty posting rows by ID after reordering", () => {
		const alpha = makePosting({ id: "alpha", label: "Alpha" });
		const beta = makePosting({ id: "beta", label: "Beta" });
		const document = createBaseDocument({ postings: [alpha, beta] });
		const reordered = createBaseDocument({ postings: [beta, alpha] });
		const { rerender } = renderTable({
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
			<EditablePostingsTable
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
		const { updatePosting } = renderTable({ document });
		const rate = screen.getByRole("spinbutton", {
			name: "Salary annual rate",
		}) as HTMLInputElement;

		expect(rate.value).toBe("0");
		fireEvent.change(rate, { target: { value: "" } });
		expect(updatePosting).not.toHaveBeenCalled();
		fireEvent.blur(rate);
		expect(rate.value).toBe("0");
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
		const { updatePosting } = renderTable({ document });
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
		const { updatePosting } = renderTable({ document });
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
		renderTable({ document: createBaseDocument({ postings: [posting] }) });

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
		const { updatePosting } = renderTable({ document });
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
});
