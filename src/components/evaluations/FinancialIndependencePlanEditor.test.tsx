// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import { DEFAULT_FINANCIAL_INDEPENDENCE_PLAN } from "@/store";
import { FinancialIndependencePlanEditor } from "./FinancialIndependencePlanEditor";

afterEach(cleanup);

describe("FinancialIndependencePlanEditor", () => {
	it("keeps changes local and applies the complete draft once", () => {
		const onApply = vi.fn();
		render(
			<FinancialIndependencePlanEditor
				document={createBaseDocument()}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={1}
				onApply={onApply}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Annual spending"), {
			target: { value: "72000" },
		});
		fireEvent.click(screen.getByLabelText("brokerage"));

		expect(onApply).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Update analysis" }));

		expect(onApply).toHaveBeenCalledTimes(1);
		expect(onApply.mock.calls[0]?.[0]).toMatchObject({
			annualExpenseTarget: 72_000,
			sources: [{ type: "asset", accountId: "brokerage", included: true }],
		});
	});

	it("discards a dirty draft when the source revision changes", () => {
		const onApply = vi.fn();
		const view = render(
			<FinancialIndependencePlanEditor
				document={createBaseDocument()}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={1}
				onApply={onApply}
			/>,
		);

		fireEvent.click(screen.getByLabelText("brokerage"));
		expect(
			(
				screen.getByRole("button", {
					name: "Update analysis",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);

		view.rerender(
			<FinancialIndependencePlanEditor
				document={createBaseDocument()}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={2}
				onApply={onApply}
			/>,
		);

		expect(
			(screen.getByLabelText("brokerage") as HTMLInputElement).checked,
		).toBe(false);
		expect(
			(
				screen.getByRole("button", {
					name: "Update analysis",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("keeps spendable income and continuing postings mutually exclusive", () => {
		const onApply = vi.fn();
		const base = createBaseDocument();
		const growth = {
			...base.postings[0]!,
			id: "growth",
			label: "Growth",
			destinations: ["brokerage"],
		};
		render(
			<FinancialIndependencePlanEditor
				document={{ ...base, postings: [...base.postings, growth] }}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={1}
				onApply={onApply}
			/>,
		);

		fireEvent.click(screen.getByLabelText("brokerage"));
		fireEvent.click(screen.getByText("Advanced simulation policy"));
		const growthOptions = screen.getAllByLabelText("Growth");
		fireEvent.click(growthOptions[1]!);
		fireEvent.click(growthOptions[0]!);
		fireEvent.click(screen.getByRole("button", { name: "Update analysis" }));

		const applied = onApply.mock.calls[0]?.[0];
		expect(applied.continuingPostingIds).not.toContain("growth");
		expect(applied.sources).toContainEqual({
			type: "cashflow",
			postingId: "growth",
			included: true,
		});
	});

	it("removes continuing postings hidden by deselecting their last asset", () => {
		const onApply = vi.fn();
		const base = createBaseDocument();
		const plan = {
			...DEFAULT_FINANCIAL_INDEPENDENCE_PLAN,
			sources: [
				{ type: "asset" as const, accountId: "brokerage", included: true },
			],
			continuingPostingIds: ["invest"],
		};
		render(
			<FinancialIndependencePlanEditor
				document={base}
				plan={plan}
				sourceRevision={1}
				onApply={onApply}
			/>,
		);

		fireEvent.click(screen.getByLabelText("brokerage"));
		fireEvent.click(screen.getByRole("button", { name: "Update analysis" }));

		expect(onApply.mock.calls[0]?.[0].continuingPostingIds).toEqual([]);
	});
});
