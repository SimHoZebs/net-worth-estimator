// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TemplateOutput } from "@/lib/patterns";
import { getExpression, type IncomeDataSnapshot } from "@/lib/projection";
import { createBaseDocument } from "@/lib/projection/__fixtures__/documents";
import { TemplateWizard } from "./TemplateWizard";

afterEach(cleanup);

const incomeData: IncomeDataSnapshot = {
	incomeSources: [
		{
			id: "salary",
			label: "Salary",
			effectiveFrom: "2026-01-01",
			effectiveTo: null,
			annualGrossIncome: 120_000,
		},
	],
	taxProfiles: [
		{
			id: "federal",
			label: "Federal",
			deduction: 10_000,
			brackets: [{ upTo: null, rate: 0.2 }],
			sourceUrl: null,
		},
	],
};

describe("TemplateWizard", () => {
	it("preserves blank numeric input until Generate validates it", () => {
		render(
			<TemplateWizard
				document={createBaseDocument()}
				incomeData={incomeData}
				onApply={() => {}}
				onClose={() => {}}
			/>,
		);

		const contribution = screen.getByPlaceholderText("4") as HTMLInputElement;
		expect(contribution.value).toBe("4");
		fireEvent.change(contribution, { target: { value: "" } });

		fireEvent.click(screen.getByRole("button", { name: "Generate" }));
		expect(
			screen.getByText(/401\(k\) contribution rate must be a valid number/),
		).not.toBeNull();
		expect(contribution.value).toBe("");
	});

	it("generates one ordered income posting instead of separate tax postings", () => {
		const onApply = vi.fn();
		render(
			<TemplateWizard
				document={createBaseDocument()}
				incomeData={incomeData}
				onApply={onApply}
				onClose={() => {}}
			/>,
		);

		fireEvent.change(screen.getByPlaceholderText("e.g. Acme Salary"), {
			target: { value: "Acme Salary" },
		});
		fireEvent.change(screen.getByPlaceholderText("4"), {
			target: { value: "0" },
		});

		fireEvent.click(screen.getByRole("button", { name: "Generate" }));
		fireEvent.click(screen.getByRole("button", { name: "Add to model" }));

		expect(onApply).toHaveBeenCalledOnce();
		const output = onApply.mock.calls[0][0] as TemplateOutput;
		expect(output.postings[0]?.amount).toEqual({
			resolver: "income",
			config: {
				incomeSourceId: "salary",
				resolvers: [
					{
						resolver: "progressive-bracket",
						config: { profileId: "federal" },
						destinationAccountId: null,
					},
				],
			},
			inputs: {},
		});
		expect(output.postings.some((posting) => posting.id.endsWith("_tax"))).toBe(
			false,
		);
		expect(getExpression(output.postings[1]!)).toBe("acme_salary * 0.1");
	});
});
