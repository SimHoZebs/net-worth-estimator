// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TemplateOutput } from "@/lib/patterns";
import { getExpression } from "@/lib/projection";
import { createBaseDocument } from "@/lib/projection/__fixtures__/documents";
import { TemplateWizard } from "./TemplateWizard";

afterEach(cleanup);

describe("TemplateWizard", () => {
	it("preserves blank numeric input until Generate validates it", () => {
		render(
			<TemplateWizard
				document={createBaseDocument()}
				onApply={() => {}}
				onClose={() => {}}
			/>,
		);

		const income = screen.getByPlaceholderText("10000") as HTMLInputElement;
		expect(income.value).toBe("0");
		fireEvent.change(income, { target: { value: "" } });
		expect(income.value).toBe("");

		fireEvent.click(screen.getByRole("button", { name: "Generate" }));
		expect(
			screen.getByText(/Gross monthly income must be a valid number/),
		).not.toBeNull();
		expect(income.value).toBe("");
	});

	it("parses numeric strings on Generate and preserves zero", () => {
		const onApply = vi.fn();
		render(
			<TemplateWizard
				document={createBaseDocument()}
				onApply={onApply}
				onClose={() => {}}
			/>,
		);

		fireEvent.change(screen.getByPlaceholderText("e.g. Acme Salary"), {
			target: { value: "Acme Salary" },
		});
		fireEvent.change(screen.getByPlaceholderText("10000"), {
			target: { value: "10000.50" },
		});
		const taxRate = screen.getByPlaceholderText("22") as HTMLInputElement;
		fireEvent.change(taxRate, { target: { value: "0" } });
		expect(taxRate.value).toBe("0");

		fireEvent.click(screen.getByRole("button", { name: "Generate" }));
		fireEvent.click(screen.getByRole("button", { name: "Add to model" }));

		expect(onApply).toHaveBeenCalledOnce();
		const output = onApply.mock.calls[0][0] as TemplateOutput;
		expect(getExpression(output.postings[0])).toBe("10000.5");
		expect(
			getExpression(
				output.postings.find((posting) => posting.id.endsWith("_tax"))!,
			),
		).toBe("acme_salary * 0");
	});
});
